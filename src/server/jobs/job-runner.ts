import type { PoseInput } from "../../shared/types";
import { JobRepository, buildJobId } from "../storage/job-repository";
import { RuntimeStateRepository } from "../storage/runtime-state-repository";
import { logger } from "../utils/logger";
import { ProductService } from "../services/product-service";

interface PendingJob {
  batchId: string;
  productId: string;
  pose: PoseInput;
  priority: number;
}

export class JobRunner {
  private readonly activeProducts = new Set<string>();
  private activeCount = 0;
  private running = false;
  private readonly currentProductIds = new Map<string, string | null>();
  private rerunRequested = false;
  private priorityOnlyRequested = false;

  constructor(
    private readonly productService: ProductService,
    private readonly runtimeStateRepository: RuntimeStateRepository,
    private readonly jobRepository: JobRepository,
    private readonly maxConcurrency: number
  ) {}

  enqueue(job: PendingJob): void {
    this.jobRepository.upsertJob(job.batchId, job.productId, job.pose, job.priority);
    this.kick();
  }

  enqueuePriority(job: PendingJob): void {
    this.jobRepository.upsertJob(job.batchId, job.productId, job.pose, job.priority);
    this.kick({ priorityOnly: true });
  }

  enqueueMany(jobs: PendingJob[]): void {
    const batchId = jobs[0]?.batchId;
    if (!batchId) {
      return;
    }
    this.jobRepository.replaceBatchJobs(batchId, jobs.map((job) => ({
      productId: job.productId,
      pose: job.pose,
      priority: 0
    })));
    this.kick();
  }

  getState(batchId?: string): { pendingJobs: number; runningJobs: number } {
    const resolvedBatchId = batchId ?? this.getActiveBatchId();
    if (!resolvedBatchId) {
      return { pendingJobs: 0, runningJobs: this.activeCount };
    }
    return this.jobRepository.getCounts(resolvedBatchId);
  }

  recoverRunningJobs(batchId?: string): void {
    this.jobRepository.recoverRunningJobs(batchId ?? this.getActiveBatchId() ?? undefined);
    this.kick();
  }

  private kick(options?: { priorityOnly?: boolean }): void {
    if (options?.priorityOnly) {
      this.priorityOnlyRequested = true;
    }
    if (this.running) {
      this.rerunRequested = true;
      return;
    }
    this.running = true;
    queueMicrotask(() => void this.drain());
  }

  private async drain(): Promise<void> {
    const priorityOnly = this.priorityOnlyRequested;
    this.priorityOnlyRequested = false;
    while (this.activeCount < this.maxConcurrency) {
      const nextJob = this.pickNextJobAcrossBatches(priorityOnly);
      if (!nextJob) {
        break;
      }
      this.startJob(nextJob);
    }
    this.running = false;
    const hasPendingJobs = priorityOnly
      ? this.hasPendingPriorityJobs()
      : this.jobRepository.listPendingBatchIds().length > 0;
    if ((this.rerunRequested || hasPendingJobs || this.priorityOnlyRequested) && this.activeCount < this.maxConcurrency) {
      this.rerunRequested = false;
      this.kick({ priorityOnly: this.priorityOnlyRequested || hasPendingJobs && priorityOnly });
    }
  }

  private pickNextJobAcrossBatches(priorityOnly = false): PendingJob | null {
    if (!priorityOnly) {
      const activeBatchId = this.getActiveBatchId();
      if (activeBatchId) {
        return this.pickNextJob(activeBatchId, false);
      }
    }
    const pendingBatchIds = this.jobRepository.listPendingBatchIds();
    for (const batchId of pendingBatchIds) {
      const nextJob = this.pickNextJob(batchId, priorityOnly);
      if (nextJob) {
        return nextJob;
      }
    }
    return null;
  }

  private pickNextJob(batchId: string, priorityOnly = false): PendingJob | null {
    const pendingJobs = this.jobRepository.listPendingJobs(batchId);
    if (pendingJobs.length === 0) {
      return null;
    }

    const activeKeyFor = (productId: string) => `${batchId}:${productId}`;
    const currentProductId = this.currentProductIds.get(batchId) ?? null;
    const highestPriorityPending = pendingJobs.find((item) => item.priority > 0);
    if (highestPriorityPending) {
      if (this.activeProducts.has(activeKeyFor(highestPriorityPending.productId))) {
        return null;
      }
      this.currentProductIds.set(batchId, highestPriorityPending.productId);
      return this.toPendingJob(batchId, highestPriorityPending);
    }

    if (priorityOnly) {
      return null;
    }

    if (!currentProductId) {
      this.currentProductIds.set(batchId, pendingJobs[0]?.productId ?? null);
    }

    const effectiveCurrentProductId = this.currentProductIds.get(batchId) ?? null;
    const currentProductHasRunningJob = effectiveCurrentProductId ? this.activeProducts.has(activeKeyFor(effectiveCurrentProductId)) : false;
    const nextForCurrent = effectiveCurrentProductId
      ? pendingJobs.find((item) => item.productId === effectiveCurrentProductId && !this.activeProducts.has(activeKeyFor(item.productId)))
      : undefined;

    if (nextForCurrent) {
      return this.toPendingJob(batchId, nextForCurrent);
    }

    const currentStillQueued = effectiveCurrentProductId
      ? pendingJobs.some((item) => item.productId === effectiveCurrentProductId)
      : false;

    if (!currentStillQueued && !currentProductHasRunningJob) {
      this.currentProductIds.set(batchId, pendingJobs[0]?.productId ?? null);
      const nextCurrentProductId = this.currentProductIds.get(batchId) ?? null;
      const fallback = nextCurrentProductId
        ? pendingJobs.find((item) => item.productId === nextCurrentProductId)
        : pendingJobs[0];
      return fallback ? this.toPendingJob(batchId, fallback) : null;
    }

    return null;
  }

  private startJob(job: PendingJob): void {
    const jobId = buildJobId(job.batchId, job.productId, job.pose.poseId);
    const activeProductKey = `${job.batchId}:${job.productId}`;
    this.activeCount += 1;
    this.activeProducts.add(activeProductKey);
    this.jobRepository.markRunning(jobId);
    logger.withContext({
      batchId: job.batchId,
      productId: job.productId,
      poseId: job.pose.poseId,
      jobId
    }, () => {
      void this.runJob(job, jobId)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Unknown job error";
          this.jobRepository.markError(jobId, message);
          logger.error("Job failed.", { error, batchId: job.batchId, productId: job.productId, poseId: job.pose.poseId, jobId });
        })
        .finally(() => {
          this.activeCount -= 1;
          this.activeProducts.delete(activeProductKey);
          const pendingJobs = this.jobRepository.listPendingJobs(job.batchId);
          const currentStillQueued = pendingJobs.some((item) => item.productId === job.productId);
          const currentStillRunning = this.activeProducts.has(activeProductKey);
          if (!currentStillQueued && !currentStillRunning && this.currentProductIds.get(job.batchId) === job.productId) {
            this.currentProductIds.set(job.batchId, null);
          }
          this.kick({ priorityOnly: job.priority > 0 });
        });
    });
  }

  private async runJob(job: PendingJob, jobId: string): Promise<void> {
    const startedAt = Date.now();
    logger.info("Generating pose output.", { batchId: job.batchId, productId: job.productId, poseId: job.pose.poseId, jobId });
    await this.productService.generateMissingPoseOutputs(job.productId, job.pose, job.batchId);
    this.jobRepository.markCompleted(jobId);
    logger.info("Finished pose output.", {
      batchId: job.batchId,
      productId: job.productId,
      poseId: job.pose.poseId,
      jobId,
      durationMs: Date.now() - startedAt
    });
  }

  private getActiveBatchId(): string | null {
    return this.runtimeStateRepository.getActiveBatchState()?.batchId ?? null;
  }

  private toPendingJob(
    batchId: string,
    job: { productId: string; poseId: string; poseLabel: string; poseFilePath: string; priority?: number }
  ): PendingJob {
    return {
      batchId,
      productId: job.productId,
      pose: {
        poseId: job.poseId,
        label: job.poseLabel,
        filePath: job.poseFilePath,
        description: job.poseLabel
      },
      priority: job.priority ?? 0
    };
  }

  private hasPendingPriorityJobs(): boolean {
    return this.jobRepository.listPendingBatchIds().some((batchId) =>
      this.jobRepository.listPendingJobs(batchId).some((job) => job.priority > 0)
    );
  }
}
