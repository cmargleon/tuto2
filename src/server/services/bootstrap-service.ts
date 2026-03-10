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
    await this.scanner.prepareFreshRun();
    const startedAt = new Date().toISOString();
    await this.productService.setBootstrapState({
      status: "running",
      startedAt,
      finishedAt: undefined,
      lastError: undefined,
      pendingJobs: 0,
      runningJobs: 0,
      completedJobs: 0,
      totalProducts: 0
    });
    try {
      const products = await this.scanner.syncProducts();
      this.poses = await this.scanner.loadPoses();
      await Promise.all(products.map((manifest) => this.productService.validateOutputFiles(manifest)));
      const jobs = buildPendingJobs(products, this.poses);
      this.jobRunner.enqueueMany(jobs);
      await this.productService.setBootstrapState({
        status: "completed",
        startedAt,
        finishedAt: new Date().toISOString(),
        pendingJobs: this.jobRunner.getState().pendingJobs,
        runningJobs: this.jobRunner.getState().runningJobs,
        completedJobs: products.length,
        totalProducts: products.length
      });
      logger.info("Bootstrap completed.", { products: products.length, jobs: jobs.length, concurrency: config.maxConcurrency });
    } catch (error) {
      const lastError = error instanceof Error ? error.message : "Unknown bootstrap error";
      await this.productService.setBootstrapState({
        status: "error",
        startedAt,
        finishedAt: new Date().toISOString(),
        lastError,
        pendingJobs: this.jobRunner.getState().pendingJobs,
        runningJobs: this.jobRunner.getState().runningJobs,
        completedJobs: 0,
        totalProducts: (await this.repository.listProducts()).length
      });
      logger.error("Bootstrap failed.", error);
    } finally {
      this.running = false;
    }
  }

  async resumeCurrentBatch(): Promise<void> {
    if (this.running) {
      throw new Error("Ya hay un bootstrap en ejecucion.");
    }
    this.running = true;
    const startedAt = new Date().toISOString();
    await this.productService.setBootstrapState({
      status: "running",
      startedAt,
      finishedAt: undefined,
      lastError: undefined,
      pendingJobs: 0,
      runningJobs: 0,
      completedJobs: 0,
      totalProducts: 0
    });

    try {
      const products = await this.repository.listProducts();
      this.poses = await this.scanner.loadPoses();
      const jobs = buildPendingJobs(products, this.poses);
      this.jobRunner.enqueueMany(jobs);
      await this.productService.setBootstrapState({
        status: "completed",
        startedAt,
        finishedAt: new Date().toISOString(),
        pendingJobs: this.jobRunner.getState().pendingJobs,
        runningJobs: this.jobRunner.getState().runningJobs,
        completedJobs: products.filter((item) => item.status === "approved").length,
        totalProducts: products.length
      });
      logger.info("Batch resumed.", { products: products.length, jobs: jobs.length, concurrency: config.maxConcurrency });
    } catch (error) {
      const lastError = error instanceof Error ? error.message : "Unknown resume error";
      await this.productService.setBootstrapState({
        status: "error",
        startedAt,
        finishedAt: new Date().toISOString(),
        lastError,
        pendingJobs: this.jobRunner.getState().pendingJobs,
        runningJobs: this.jobRunner.getState().runningJobs,
        completedJobs: 0,
        totalProducts: (await this.repository.listProducts()).length
      });
      logger.error("Resume failed.", error);
    } finally {
      this.running = false;
    }
  }

  getPoses(): PoseInput[] {
    return this.poses;
  }
}

function buildPendingJobs(products: ProductManifest[], poses: PoseInput[]): Array<{ productId: string; pose: PoseInput }> {
  const jobs: Array<{ productId: string; pose: PoseInput }> = [];
  for (const product of products) {
    for (const pose of product.poses) {
      const poseConfig = poses.find((item) => item.poseId === pose.poseId);
      if (!poseConfig) {
        continue;
      }
      const readyCount = product.outputs.filter((output) => output.poseId === pose.poseId && output.status === "ready").length;
      if (readyCount < pose.variantCount) {
        jobs.push({ productId: product.productId, pose: poseConfig });
      }
    }
  }
  return jobs;
}
