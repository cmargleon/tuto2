import type { PoseInput } from "../../shared/types";
import { JobRepository, buildJobId } from "../storage/job-repository";
import { RuntimeStateRepository } from "../storage/runtime-state-repository";
import { logger } from "../utils/logger";
import { ProductService } from "../services/product-service";

interface PendingJob {
  productId: string;
  pose: PoseInput;
}

export class JobRunner {
  private readonly activeProducts = new Set<string>();
  private activeCount = 0;
  private running = false;
  private currentProductId: string | null = null;

  constructor(
    private readonly productService: ProductService,
    private readonly runtimeStateRepository: RuntimeStateRepository,
    private readonly jobRepository: JobRepository,
    private readonly maxConcurrency: number
  ) {}

  enqueue(job: PendingJob): void {
    const batchId = this.getActiveBatchId();
    if (!batchId) {
      return;
    }
    this.jobRepository.upsertJob(batchId, job.productId, job.pose, 0);
    this.kick();
  }

  enqueuePriority(job: PendingJob): void {
    const batchId = this.getActiveBatchId();
    if (!batchId) {
      return;
    }
    this.jobRepository.upsertJob(batchId, job.productId, job.pose, 10);
    this.kick();
  }

  enqueueMany(jobs: PendingJob[]): void {
    const batchId = this.getActiveBatchId();
    if (!batchId) {
      return;
    }
    this.jobRepository.replaceBatchJobs(batchId, jobs.map((job) => ({
      ...job,
      priority: 0
    })));
    this.kick();
  }

  getState(): { pendingJobs: number; runningJobs: number } {
    const batchId = this.getActiveBatchId();
    if (!batchId) {
      return { pendingJobs: 0, runningJobs: this.activeCount };
    }
    return this.jobRepository.getCounts(batchId);
  }

  recoverRunningJobs(): void {
    this.jobRepository.recoverRunningJobs(this.getActiveBatchId() ?? undefined);
  }

  private kick(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    queueMicrotask(() => void this.drain());
  }

  private async drain(): Promise<void> {
    const batchId = this.getActiveBatchId();
    if (!batchId) {
      this.running = false;
      return;
    }

    while (this.activeCount < this.maxConcurrency) {
      const nextJob = this.pickNextJob(batchId);
      if (!nextJob) {
        break;
      }
      this.startJob(batchId, nextJob);
    }
    this.running = false;
  }

  private pickNextJob(batchId: string): PendingJob | null {
    const pendingJobs = this.jobRepository.listPendingJobs(batchId);
    if (pendingJobs.length === 0) {
      return null;
    }

    const nextPriority = pendingJobs.find((item) => item.priority > 0 && !this.activeProducts.has(item.productId));
    if (nextPriority) {
      this.currentProductId = nextPriority.productId;
      return this.toPendingJob(nextPriority);
    }

    if (!this.currentProductId) {
      this.currentProductId = pendingJobs[0]?.productId ?? null;
    }

    const currentProductHasRunningJob = this.currentProductId ? this.activeProducts.has(this.currentProductId) : false;
    const nextForCurrent = this.currentProductId
      ? pendingJobs.find((item) => item.productId === this.currentProductId && !this.activeProducts.has(item.productId))
      : undefined;

    if (nextForCurrent) {
      return this.toPendingJob(nextForCurrent);
    }

    const currentStillQueued = this.currentProductId
      ? pendingJobs.some((item) => item.productId === this.currentProductId)
      : false;

    if (!currentStillQueued && !currentProductHasRunningJob) {
      this.currentProductId = pendingJobs[0]?.productId ?? null;
      const fallback = this.currentProductId
        ? pendingJobs.find((item) => item.productId === this.currentProductId)
        : pendingJobs[0];
      return fallback ? this.toPendingJob(fallback) : null;
    }

    return null;
  }

  private startJob(batchId: string, job: PendingJob): void {
    const jobId = buildJobId(batchId, job.productId, job.pose.poseId);
    this.activeCount += 1;
    this.activeProducts.add(job.productId);
    this.jobRepository.markRunning(jobId);
    void this.runJob(batchId, job, jobId)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown job error";
        this.jobRepository.markError(jobId, message);
        logger.error("Job failed.", error);
      })
      .finally(() => {
        this.activeCount -= 1;
        this.activeProducts.delete(job.productId);
        const pendingJobs = this.jobRepository.listPendingJobs(batchId);
        const currentStillQueued = pendingJobs.some((item) => item.productId === job.productId);
        const currentStillRunning = this.activeProducts.has(job.productId);
        if (!currentStillQueued && !currentStillRunning && this.currentProductId === job.productId) {
          this.currentProductId = null;
        }
        this.kick();
      });
  }

  private async runJob(batchId: string, job: PendingJob, jobId: string): Promise<void> {
    logger.info(`Generating ${job.productId} ${job.pose.poseId}`);
    await this.productService.generateMissingPoseOutputs(job.productId, job.pose);
    this.jobRepository.markCompleted(jobId);
    logger.info(`Finished ${job.productId} ${job.pose.poseId}`);
  }

  private getActiveBatchId(): string | null {
    return this.runtimeStateRepository.getActiveBatchState()?.batchId ?? null;
  }

  private toPendingJob(job: { productId: string; poseId: string; poseLabel: string; poseFilePath: string }): PendingJob {
    return {
      productId: job.productId,
      pose: {
        poseId: job.poseId,
        label: job.poseLabel,
        filePath: job.poseFilePath,
        description: job.poseLabel
      }
    };
  }
}
