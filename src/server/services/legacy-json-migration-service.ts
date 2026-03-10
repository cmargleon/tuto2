import fs from "fs/promises";
import path from "path";
import type { ActiveBatchState, BatchEvent, BatchManifest, BatchPromptConfig, BootstrapState, ProductManifest } from "../../shared/types";
import { paths } from "../config";
import { readJsonFile } from "../utils/fs-helpers";
import { BatchRepository } from "../storage/batch-repository";
import { ProductRepository } from "../storage/product-repository";
import { RuntimeStateRepository } from "../storage/runtime-state-repository";
import { defaultPromptConfig } from "./batch-prompt-config-service";

export class LegacyJsonMigrationService {
  constructor(
    private readonly batchRepository: BatchRepository,
    private readonly productRepository: ProductRepository,
    private readonly runtimeStateRepository: RuntimeStateRepository
  ) {}

  async migrateIfNeeded(): Promise<void> {
    await this.migrateDraftPromptConfig();
    await this.migrateBootstrapState();
    await this.migrateSavedBatches();
    await this.migrateCurrentRuntime();
    await this.migrateActiveBatchState();
  }

  private async migrateDraftPromptConfig(): Promise<void> {
    const promptConfig = await readJsonFile<BatchPromptConfig>(paths.promptConfigFile, defaultPromptConfig);
    this.runtimeStateRepository.setDraftPromptConfig(promptConfig);
  }

  private async migrateBootstrapState(): Promise<void> {
    const bootstrapState = await readJsonFile<BootstrapState>(paths.bootstrapStateFile, {
      status: "idle",
      pendingJobs: 0,
      runningJobs: 0,
      completedJobs: 0,
      totalProducts: 0
    });
    this.runtimeStateRepository.setBootstrapState(bootstrapState);
  }

  private async migrateSavedBatches(): Promise<void> {
    const entries = await fs.readdir(paths.batchesDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const batchRoot = path.join(paths.batchesDir, entry.name);
      const manifest = await readJsonFile<BatchManifest | null>(path.join(batchRoot, "batch.json"), null);
      if (!manifest) {
        continue;
      }

      if (!this.batchRepository.getBatch(manifest.batchId)) {
        this.batchRepository.saveBatch(manifest);
      }

      const events = await readJsonFile<BatchEvent[]>(path.join(batchRoot, "events.json"), []);
      const existingIds = new Set(this.batchRepository.listEvents(manifest.batchId).map((item) => item.id));
      for (const event of events) {
        if (!existingIds.has(event.id)) {
          this.batchRepository.appendEvent(manifest.batchId, event);
          existingIds.add(event.id);
        }
      }

      const jobsDir = manifest.jobsRoot || path.join(batchRoot, "jobs");
      const jobEntries = await fs.readdir(jobsDir, { withFileTypes: true }).catch(() => []);
      for (const jobEntry of jobEntries) {
        if (!jobEntry.isFile() || !jobEntry.name.endsWith(".json")) {
          continue;
        }
        const product = await readJsonFile<ProductManifest | null>(path.join(jobsDir, jobEntry.name), null);
        if (!product) {
          continue;
        }
        const existingProduct = await this.productRepository.getProduct(product.productId, manifest.batchId);
        if (!existingProduct) {
          await this.productRepository.saveProduct(product, manifest.batchId);
        }
      }
    }
  }

  private async migrateCurrentRuntime(): Promise<void> {
    const activeBatch = await readJsonFile<ActiveBatchState | null>(paths.activeBatchFile, null);
    if (!activeBatch?.batchId) {
      return;
    }

    const existingBatch = this.batchRepository.getBatch(activeBatch.batchId);
    if (!existingBatch) {
      const batchRoot = activeBatch.sessionRoot;
      const roots = {
        inputRoot: activeBatch.stagedInputRoot,
        jobsRoot: path.join(batchRoot, "jobs"),
        outputRoot: path.join(batchRoot, "output"),
        approvedRoot: path.join(batchRoot, "approved"),
        stateRoot: path.join(batchRoot, "state")
      };
      const promptConfig = await readJsonFile<BatchPromptConfig>(paths.promptConfigFile, defaultPromptConfig);
      const now = new Date().toISOString();
      this.batchRepository.saveBatch({
        batchId: activeBatch.batchId,
        name: activeBatch.batchId,
        status: "paused",
        createdAt: activeBatch.startedAt || now,
        updatedAt: now,
        active: true,
        currentProductId: null,
        promptConfig,
        counts: {
          products: 0,
          generating: 0,
          inReview: 0,
          approved: 0,
          error: 0,
          outputs: 0
        },
        snapshotCount: activeBatch.snapshotCount ?? 0,
        ...roots
      });
    }

    const jobEntries = await fs.readdir(paths.jobsDir, { withFileTypes: true }).catch(() => []);
    for (const jobEntry of jobEntries) {
      if (!jobEntry.isFile() || !jobEntry.name.endsWith(".json")) {
        continue;
      }
      const product = await readJsonFile<ProductManifest | null>(path.join(paths.jobsDir, jobEntry.name), null);
      if (!product) {
        continue;
      }
      const existingProduct = await this.productRepository.getProduct(product.productId, activeBatch.batchId);
      if (!existingProduct) {
        await this.productRepository.saveProduct(product, activeBatch.batchId);
      }
    }
  }

  private async migrateActiveBatchState(): Promise<void> {
    const activeBatch = await readJsonFile<ActiveBatchState | null>(paths.activeBatchFile, null);
    if (!activeBatch?.batchId) {
      return;
    }
    if (!this.batchRepository.getBatch(activeBatch.batchId)) {
      return;
    }
    this.runtimeStateRepository.setActiveBatchState(activeBatch);
    this.batchRepository.setOnlyActiveBatch(activeBatch.batchId);
  }
}
