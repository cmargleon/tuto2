import type { PoseInput, ProductManifest } from "../../shared/types";
import { config } from "../config";
import { JobRunner } from "../jobs/job-runner";
import { ProductRepository } from "../storage/product-repository";
import { logger } from "../utils/logger";
import { InputScannerService } from "./input-scanner-service";
import { ProductService } from "./product-service";

export class BootstrapService {
  private poses: PoseInput[] = [];
  private running = false;

  constructor(
    private readonly scanner: InputScannerService,
    private readonly repository: ProductRepository,
    private readonly productService: ProductService,
    private readonly jobRunner: JobRunner
  ) {}

  async start(): Promise<void> {
    if (this.running) {
      throw new Error("Ya hay un bootstrap en ejecucion.");
    }
    this.running = true;
    try {
      const activeBatch = await this.productService.getActiveBatchState();
      const batchId = activeBatch?.batchId;
      await (batchId ? this.scanner.prepareFreshRunForBatch(batchId) : this.scanner.prepareFreshRun());
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      await this.productService.setBootstrapState({
        status: "running",
        startedAt,
        finishedAt: undefined,
        lastError: undefined,
        pendingJobs: 0,
        runningJobs: 0,
        completedJobs: 0,
        totalProducts: 0
      }, batchId);
      try {
        const products = batchId ? await this.scanner.syncProductsForBatch(batchId) : await this.scanner.syncProducts();
        this.poses = batchId ? await this.scanner.loadPosesForBatch(batchId) : await this.scanner.loadPoses();
        await Promise.all(products.map((manifest) => this.productService.validateOutputFiles(manifest, batchId)));
        const jobs = buildPendingJobs(products, this.poses, batchId);
        this.jobRunner.enqueueMany(jobs);
        await this.productService.setBootstrapState({
          status: "completed",
          startedAt,
          finishedAt: new Date().toISOString(),
          pendingJobs: this.jobRunner.getState(batchId).pendingJobs,
          runningJobs: this.jobRunner.getState(batchId).runningJobs,
          completedJobs: products.length,
          totalProducts: products.length
        }, batchId);
        logger.info("Bootstrap completed.", {
          batchId,
          products: products.length,
          jobs: jobs.length,
          concurrency: config.maxConcurrency,
          durationMs: Date.now() - startedMs
        });
      } catch (error) {
        const lastError = error instanceof Error ? error.message : "Unknown bootstrap error";
        await this.productService.setBootstrapState({
          status: "error",
          startedAt,
          finishedAt: new Date().toISOString(),
          lastError,
          pendingJobs: this.jobRunner.getState(batchId).pendingJobs,
          runningJobs: this.jobRunner.getState(batchId).runningJobs,
          completedJobs: 0,
          totalProducts: (await this.repository.listProducts(batchId)).length
        }, batchId);
        logger.error("Bootstrap failed.", {
          batchId,
          durationMs: Date.now() - startedMs,
          error
        });
      }
    } finally {
      this.running = false;
    }
  }

  async resumeCurrentBatch(): Promise<void> {
    if (this.running) {
      throw new Error("Ya hay un bootstrap en ejecucion.");
    }
    this.running = true;
    const activeBatch = await this.productService.getActiveBatchState();
    const batchId = activeBatch?.batchId;
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    await this.productService.setBootstrapState({
      status: "running",
      startedAt,
      finishedAt: undefined,
      lastError: undefined,
      pendingJobs: 0,
      runningJobs: 0,
      completedJobs: 0,
      totalProducts: 0
    }, batchId);

    try {
      const products = await this.repository.listProducts(batchId);
      this.poses = batchId ? await this.scanner.loadPosesForBatch(batchId) : await this.scanner.loadPoses();
      const jobs = buildPendingJobs(products, this.poses, batchId);
      this.jobRunner.enqueueMany(jobs);
      await this.productService.setBootstrapState({
        status: "completed",
        startedAt,
        finishedAt: new Date().toISOString(),
        pendingJobs: this.jobRunner.getState(batchId).pendingJobs,
        runningJobs: this.jobRunner.getState(batchId).runningJobs,
        completedJobs: products.filter((item) => item.status === "approved").length,
        totalProducts: products.length
      }, batchId);
      logger.info("Batch resumed.", {
        batchId,
        products: products.length,
        jobs: jobs.length,
        concurrency: config.maxConcurrency,
        durationMs: Date.now() - startedMs
      });
    } catch (error) {
      const lastError = error instanceof Error ? error.message : "Unknown resume error";
      await this.productService.setBootstrapState({
        status: "error",
        startedAt,
        finishedAt: new Date().toISOString(),
        lastError,
        pendingJobs: this.jobRunner.getState(batchId).pendingJobs,
        runningJobs: this.jobRunner.getState(batchId).runningJobs,
        completedJobs: 0,
        totalProducts: (await this.repository.listProducts(batchId)).length
      }, batchId);
      logger.error("Resume failed.", {
        batchId,
        durationMs: Date.now() - startedMs,
        error
      });
    } finally {
      this.running = false;
    }
  }

  getPoses(): PoseInput[] {
    return this.poses;
  }

  async resolvePoses(batchId?: string): Promise<PoseInput[]> {
    if (batchId) {
      return this.scanner.loadPosesForBatch(batchId);
    }
    if (this.poses.length > 0) {
      return this.poses;
    }
    return this.scanner.loadPoses();
  }
}

function buildPendingJobs(
  products: ProductManifest[],
  poses: PoseInput[],
  batchId?: string
): Array<{ batchId: string; productId: string; pose: PoseInput; priority: number }> {
  if (!batchId) {
    return [];
  }
  const jobs: Array<{ batchId: string; productId: string; pose: PoseInput; priority: number }> = [];
  for (const product of products) {
    for (const pose of product.poses) {
      const poseConfig = poses.find((item) => item.poseId === pose.poseId);
      if (!poseConfig) {
        continue;
      }
      const readyCount = product.outputs.filter((output) => output.poseId === pose.poseId && output.status === "ready").length;
      if (readyCount < pose.variantCount) {
        jobs.push({ batchId, productId: product.productId, pose: poseConfig, priority: 0 });
      }
    }
  }
  return jobs;
}
