import fs from "fs/promises";
import path from "path";
import type {
  ActiveBatchState,
  BatchCounts,
  BatchEvent,
  BatchManifest,
  BatchModelSelection,
  BatchPromptConfig,
  BatchSnapshot,
  BatchStatus,
  CatalogModel,
  ClientRecord,
  ProductManifest
} from "../../shared/types";
import { paths } from "../config";
import { clearDirectory, copyDirectory, ensureDir, sanitizeId } from "../utils/fs-helpers";
import { BatchRepository } from "../storage/batch-repository";
import { ProductRepository } from "../storage/product-repository";
import { RuntimeStateRepository } from "../storage/runtime-state-repository";
import { AnalyticsService } from "./analytics-service";

export class BatchHistoryService {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly batchRepository: BatchRepository,
    private readonly productRepository: ProductRepository,
    private readonly runtimeStateRepository: RuntimeStateRepository,
    private readonly analyticsService: AnalyticsService
  ) {}

  async ensureStructure(): Promise<void> {
    await Promise.all([
      ensureDir(paths.batchesDir),
      ensureDir(paths.archiveDir),
      ensureDir(paths.savedBatchesDir),
      ensureDir(paths.inputRoot),
      ensureDir(paths.modelCatalogDir),
      ensureDir(paths.jobsDir),
      ensureDir(paths.outputDir),
      ensureDir(paths.approvedDir),
      ensureDir(paths.stateDir)
    ]);
  }

  async createBatchFromCurrentInput(
    promptConfig: BatchPromptConfig,
    clientId?: string,
    modelSelection?: { modelId: string; selectedPhotoIds: string[] }
  ): Promise<BatchManifest> {
    return this.withMutationLock(async () => {
      await this.ensureStructure();
      const batchId = this.createBatchId();
      const roots = this.batchRepository.buildBatchRoots(paths.batchesDir, batchId);
      await this.prepareBatchFolders(roots);

      const now = new Date().toISOString();
      const manifest: BatchManifest = {
        batchId,
        name: batchId,
        clientId: clientId || undefined,
        status: "draft",
        createdAt: now,
        updatedAt: now,
        active: true,
        currentProductId: null,
        promptConfig,
        counts: emptyCounts(),
        snapshotCount: 0,
        inputRoot: roots.inputRoot,
        jobsRoot: roots.jobsRoot,
        outputRoot: roots.outputRoot,
        approvedRoot: roots.approvedRoot,
        stateRoot: roots.stateRoot
      };

      this.batchRepository.saveBatch(manifest);
      if (modelSelection?.modelId && modelSelection.selectedPhotoIds.length > 0) {
        this.batchRepository.saveBatchModelSelection({
          batchId,
          modelId: modelSelection.modelId,
          selectedPhotoIds: modelSelection.selectedPhotoIds
        });
      }
      this.runtimeStateRepository.setDraftPromptConfig(promptConfig);
      this.runtimeStateRepository.setActiveBatchState({
        batchId,
        sessionRoot: path.dirname(roots.inputRoot),
        stagedInputRoot: roots.inputRoot,
        startedAt: now,
        snapshotCount: 0
      });
      this.batchRepository.setOnlyActiveBatch(batchId);
      this.appendEvent(batchId, {
        type: "batch_created",
        message: "Batch creado desde el wizard."
      });
      return this.requireBatch(batchId);
    });
  }

  async activateBatch(batchId: string): Promise<BatchManifest> {
    return this.withMutationLock(async () => {
      const manifest = this.requireBatch(batchId);
      this.runtimeStateRepository.setActiveBatchState({
        batchId,
        sessionRoot: path.dirname(manifest.inputRoot),
        stagedInputRoot: manifest.inputRoot,
        startedAt: manifest.createdAt,
        snapshotCount: manifest.snapshotCount
      });
      this.batchRepository.setOnlyActiveBatch(batchId);
      this.batchRepository.saveBatch({
        ...manifest,
        active: true,
        updatedAt: new Date().toISOString()
      });
      this.appendEvent(batchId, {
        type: "batch_activated",
        message: "Batch activado en runtime actual."
      });
      return this.requireBatch(batchId);
    });
  }

  async syncActiveBatchFromCurrent(nextStatus?: BatchStatus, currentProductId?: string | null): Promise<void> {
    await this.withMutationLock(async () => {
      const activeBatch = this.runtimeStateRepository.getActiveBatchState();
      if (!activeBatch) {
        return;
      }

      const manifest = this.requireBatch(activeBatch.batchId);
      const products = await this.productRepository.listProducts(activeBatch.batchId);
      const counts = this.computeCounts(products);
      const updated: BatchManifest = {
        ...manifest,
        promptConfig: this.batchRepository.getPromptConfig(activeBatch.batchId) ?? manifest.promptConfig,
        counts,
        currentProductId: currentProductId ?? manifest.currentProductId ?? null,
        status: nextStatus ?? this.computeBatchStatus(products, manifest.status),
        snapshotCount: activeBatch.snapshotCount,
        active: true,
        updatedAt: new Date().toISOString()
      };
      this.batchRepository.saveBatch(updated);
    });
  }

  async listBatches(filters?: {
    status?: BatchStatus | "all";
    clientId?: string;
    search?: string;
  }): Promise<BatchManifest[]> {
    await this.ensureStructure();
    return this.batchRepository.listBatches(filters);
  }

  async getBatch(batchId: string): Promise<BatchManifest> {
    return this.requireBatch(batchId);
  }

  async getBatchEvents(batchId: string): Promise<BatchEvent[]> {
    return this.batchRepository.listEvents(batchId);
  }

  async getBatchSnapshots(batchId: string): Promise<BatchSnapshot[]> {
    return this.batchRepository.listSnapshots(batchId);
  }

  listClients(): ClientRecord[] {
    return this.batchRepository.listClients();
  }

  listModels(filters?: { clientId?: string; includeFree?: boolean }) {
    return this.batchRepository.listModels(filters);
  }

  saveClient(client: ClientRecord): void {
    this.batchRepository.saveClient(client);
  }

  async saveModel(model: CatalogModel, files: Array<{ buffer: Buffer; originalName: string }>): Promise<void> {
    await this.ensureStructure();
    const modelRoot = path.join(paths.modelCatalogDir, model.modelId);
    await ensureDir(modelRoot);
    await Promise.all(model.photos.map((photo, index) => {
      const file = files[index];
      if (!file) {
        throw new Error(`Falta la foto ${index + 1} para el modelo ${model.name}.`);
      }
      return fs.writeFile(photo.filePath, file.buffer);
    }));
    this.batchRepository.saveModel(model);
  }

  async updateModel(
    model: CatalogModel,
    newFiles: Array<{ buffer: Buffer; originalName: string; filePath: string }>,
    removedFilePaths: string[]
  ): Promise<void> {
    await this.ensureStructure();
    const modelRoot = path.join(paths.modelCatalogDir, model.modelId);
    await ensureDir(modelRoot);
    await Promise.all(removedFilePaths.map(async (filePath) => {
      try {
        await fs.rm(filePath, { force: true });
      } catch {
        return;
      }
    }));
    await Promise.all(newFiles.map((file) => fs.writeFile(file.filePath, file.buffer)));
    this.batchRepository.saveModel(model);
  }

  getModel(modelId: string) {
    return this.batchRepository.getModel(modelId);
  }

  async deleteModel(modelId: string): Promise<void> {
    const model = this.batchRepository.getModel(modelId);
    this.batchRepository.deleteModel(modelId);
    if (model) {
      await fs.rm(path.join(paths.modelCatalogDir, modelId), {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
      });
    }
  }

  getBatchModelSelection(batchId: string) {
    return this.batchRepository.getBatchModelSelection(batchId);
  }

  async saveBatchModelSelection(selection: BatchModelSelection): Promise<void> {
    await this.withMutationLock(async () => {
      this.batchRepository.saveBatchModelSelection(selection);
      const manifest = this.requireBatch(selection.batchId);
      this.batchRepository.saveBatch({
        ...manifest,
        selectedModelId: selection.modelId,
        selectedModelPhotoIds: selection.selectedPhotoIds,
        updatedAt: new Date().toISOString()
      });
      this.appendEvent(selection.batchId, {
        type: "model_changed",
        message: "Modelo del batch actualizado.",
        meta: {
          modelId: selection.modelId,
          selectedPhotoCount: selection.selectedPhotoIds.length
        }
      });
    });
  }

  saveSnapshot(snapshot: BatchSnapshot): void {
    this.batchRepository.saveSnapshot(snapshot);
  }

  async archiveBatch(batchId: string): Promise<BatchManifest> {
    return this.withMutationLock(async () => {
      const manifest = this.requireBatch(batchId);
      const archivedAt = new Date().toISOString();
      const updated: BatchManifest = {
        ...manifest,
        status: "archived",
        archivedAt,
        active: false,
        updatedAt: archivedAt
      };
      this.batchRepository.saveBatch(updated);
      if (this.runtimeStateRepository.getActiveBatchState()?.batchId === batchId) {
        this.runtimeStateRepository.clearActiveBatchState();
      }
      this.appendEvent(batchId, {
        type: "batch_archived",
        message: "Batch archivado."
      });
      return this.requireBatch(batchId);
    });
  }

  async deleteBatch(batchId: string): Promise<{ deletedActive: boolean }> {
    return this.withMutationLock(async () => {
      const manifest = this.requireBatch(batchId);
      const active = this.runtimeStateRepository.getActiveBatchState();
      const deletedActive = active?.batchId === batchId;
      if (deletedActive && manifest.status === "running") {
        throw new Error("No se puede eliminar un batch activo mientras esta en ejecucion.");
      }

      this.batchRepository.deleteBatch(batchId);
      if (deletedActive) {
        this.runtimeStateRepository.clearActiveBatchState();
        this.runtimeStateRepository.setBootstrapState({
          status: "idle",
          pendingJobs: 0,
          runningJobs: 0,
          completedJobs: 0,
          totalProducts: 0
        });
      }

      await fs.rm(path.dirname(manifest.inputRoot), {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 120
      });

      return { deletedActive };
    });
  }

  async duplicateBatch(batchId: string): Promise<BatchManifest> {
    return this.withMutationLock(async () => {
      const source = this.requireBatch(batchId);
      const nextBatchId = this.createBatchId();
      const roots = this.batchRepository.buildBatchRoots(paths.batchesDir, nextBatchId);
      await this.prepareBatchFolders(roots);
      await copyDirectory(source.inputRoot, roots.inputRoot);
      await copyDirectory(source.outputRoot, roots.outputRoot);
      await copyDirectory(source.approvedRoot, roots.approvedRoot);

      const now = new Date().toISOString();
      const duplicated: BatchManifest = {
        ...source,
        batchId: nextBatchId,
        name: `${source.name} copia`,
        createdAt: now,
        updatedAt: now,
        archivedAt: undefined,
        active: false,
        status: source.status === "archived" ? "paused" : source.status,
        inputRoot: roots.inputRoot,
        jobsRoot: roots.jobsRoot,
        outputRoot: roots.outputRoot,
        approvedRoot: roots.approvedRoot,
        stateRoot: roots.stateRoot
      };

      this.batchRepository.saveBatch(duplicated);
      await this.productRepository.duplicateBatchProducts(source.batchId, nextBatchId, (filePath) => {
        return filePath.replace(path.dirname(source.inputRoot), path.dirname(roots.inputRoot));
      });
      const selection = this.batchRepository.getBatchModelSelection(source.batchId);
      if (selection) {
        this.batchRepository.saveBatchModelSelection({
          batchId: nextBatchId,
          modelId: selection.modelId,
          selectedPhotoIds: selection.selectedPhotoIds
        });
      }

      this.appendEvent(nextBatchId, {
        type: "batch_duplicated",
        message: `Batch duplicado desde ${batchId}.`,
        meta: {
          sourceBatchId: batchId
        }
      });
      return this.requireBatch(nextBatchId);
    });
  }

  async logEvent(batchId: string, event: Omit<BatchEvent, "id" | "timestamp">): Promise<void> {
    await this.withMutationLock(async () => {
      this.appendEvent(batchId, event);
    });
  }

  async getActiveBatch(): Promise<ActiveBatchState | null> {
    return this.runtimeStateRepository.getActiveBatchState();
  }

  async setActiveBatch(batchId: string, startedAt: string, snapshotCount: number, lastSavedAt?: string): Promise<void> {
    const manifest = this.requireBatch(batchId);
    this.runtimeStateRepository.setActiveBatchState({
      batchId,
      sessionRoot: path.dirname(manifest.inputRoot),
      stagedInputRoot: manifest.inputRoot,
      startedAt,
      snapshotCount,
      lastSavedAt
    });
  }

  private requireBatch(batchId: string): BatchManifest {
    const batch = this.batchRepository.getBatch(batchId);
    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }
    return batch;
  }

  private computeCounts(products: ProductManifest[]): BatchCounts {
    return {
      products: products.length,
      generating: products.filter((item) => item.status === "generating").length,
      inReview: products.filter((item) => item.status === "in_review").length,
      approved: products.filter((item) => item.status === "approved").length,
      error: products.filter((item) => item.status === "error").length,
      outputs: products.reduce((sum, item) => sum + item.outputs.length, 0)
    };
  }

  private computeBatchStatus(products: ProductManifest[], fallback: BatchStatus): BatchStatus {
    if (products.length === 0) {
      return fallback;
    }
    if (products.some((item) => item.status === "error")) {
      return "error";
    }
    if (products.every((item) => item.status === "approved")) {
      return "completed";
    }
    if (products.some((item) => item.status === "generating")) {
      return "running";
    }
    if (products.some((item) => item.status === "in_review")) {
      return "in_review";
    }
    return "paused";
  }

  private async prepareBatchFolders(roots: Pick<BatchManifest, "inputRoot" | "jobsRoot" | "outputRoot" | "approvedRoot" | "stateRoot">): Promise<void> {
    await Promise.all([
      ensureDir(path.join(roots.inputRoot, "garments")),
      ensureDir(path.join(roots.inputRoot, "models")),
      ensureDir(path.join(roots.inputRoot, "poses")),
      ensureDir(roots.jobsRoot),
      ensureDir(roots.outputRoot),
      ensureDir(roots.approvedRoot),
      ensureDir(roots.stateRoot)
    ]);
  }

  private appendEvent(batchId: string, event: Omit<BatchEvent, "id" | "timestamp">): void {
    const entry: BatchEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      ...event
    };
    this.batchRepository.appendEvent(batchId, entry);
    const batch = this.batchRepository.getBatch(batchId);
    if (!batch) {
      return;
    }
    this.analyticsService.recordEvent({
      eventId: entry.id,
      batchId,
      clientId: batch.clientId,
      productId: entry.productId,
      poseId: entry.poseId,
      providerModelId: batch.promptConfig.providerSettings.modelId,
      eventType: entry.type,
      eventSource: event.type === "pose_regenerated" || event.type === "model_changed" || event.type === "provider_model_changed" || event.type === "prompt_changed"
        ? "user"
        : "system",
      timestamp: entry.timestamp,
      metadata: {
        batchName: batch.name,
        batchStatus: batch.status,
        ...(entry.meta ?? {})
      }
    });
  }

  private createBatchId(): string {
    return `batch-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  }

  private async withMutationLock<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release: (() => void) | undefined;
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      release?.();
    }
  }
}

function emptyCounts(): BatchCounts {
  return {
    products: 0,
    generating: 0,
    inReview: 0,
    approved: 0,
    error: 0,
    outputs: 0
  };
}
