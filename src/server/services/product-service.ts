import fs from "fs/promises";
import path from "path";
import type {
  ActiveBatchState,
  BatchModelSelection,
  BatchSnapshot,
  BatchJob,
  BatchJobAttempt,
  BatchPromptConfig,
  BootstrapState,
  CatalogModel,
  CatalogModelPhoto,
  ClientRecord,
  GeneratedImageMetadata,
  GeneratedOutput,
  ImageGenerationProvider,
  PoseInput,
  ProductPromptOverrides,
  ProductListItem,
  ProductManifest,
  ProductPoseState
} from "../../shared/types";
import { paths } from "../config";
import { ProductRepository } from "../storage/product-repository";
import { JobRepository } from "../storage/job-repository";
import { RuntimeStateRepository } from "../storage/runtime-state-repository";
import { copyDirectory, ensureDir, fileExists, sanitizeId, writeJsonFile } from "../utils/fs-helpers";
import { normalizeGeneratedImage, loadImageAsProviderInput } from "../utils/image-utils";
import { PromptService } from "./prompt-service";
import { InputScannerService } from "./input-scanner-service";
import { BatchPromptConfigService } from "./batch-prompt-config-service";
import { BatchHistoryService } from "./batch-history-service";

export class ProductService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly scanner: InputScannerService,
    private readonly promptService: PromptService,
    private readonly provider: ImageGenerationProvider,
    private readonly batchPromptConfigService: BatchPromptConfigService,
    private readonly batchHistoryService: BatchHistoryService,
    private readonly jobRepository: JobRepository,
    private readonly runtimeStateRepository: RuntimeStateRepository
  ) {}

  async listProducts(): Promise<ProductListItem[]> {
    const manifests = await this.repository.listProducts();
    return manifests.map((item) => ({
      productId: item.productId,
      status: item.status,
      approvedCount: Object.values(item.approved).reduce((sum, outputIds) => sum + outputIds.length, 0),
      totalApprovedNeeded: 4,
      category: item.category
    }));
  }

  async getProduct(productId: string): Promise<ProductManifest> {
    const manifest = await this.repository.getProduct(productId);
    if (!manifest) {
      throw new Error(`Product not found: ${productId}`);
    }
    return manifest;
  }

  async getBootstrapState(): Promise<BootstrapState> {
    return this.runtimeStateRepository.getBootstrapState();
  }

  async setBootstrapState(nextState: BootstrapState): Promise<void> {
    this.runtimeStateRepository.setBootstrapState(nextState);
    await this.batchHistoryService.syncActiveBatchFromCurrent(mapBootstrapStatusToBatchStatus(nextState.status));
  }

  async getActiveBatchState(): Promise<ActiveBatchState | null> {
    return this.runtimeStateRepository.getActiveBatchState();
  }

  async setActiveBatchState(state: ActiveBatchState): Promise<void> {
    this.runtimeStateRepository.setActiveBatchState(state);
  }

  async saveCurrentBatchSnapshot(): Promise<ActiveBatchState> {
    const activeBatch = await this.getActiveBatchState();
    if (!activeBatch) {
      throw new Error("No active batch available to save.");
    }
    const snapshotId = `snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const snapshotRoot = path.join(paths.savedBatchesDir, activeBatch.batchId, snapshotId);
    await ensureDir(snapshotRoot);
    await Promise.all([
      copyDirectory(path.join(activeBatch.sessionRoot, "jobs"), path.join(snapshotRoot, "jobs")),
      copyDirectory(path.join(activeBatch.sessionRoot, "output"), path.join(snapshotRoot, "output")),
      copyDirectory(path.join(activeBatch.sessionRoot, "approved"), path.join(snapshotRoot, "approved")),
      copyDirectory(activeBatch.stagedInputRoot, path.join(snapshotRoot, "input"))
    ]);

    await this.batchHistoryService.logEvent(activeBatch.batchId, {
      type: "batch_saved",
      message: "Snapshot manual del batch guardado."
    });
    const snapshot: BatchSnapshot = {
      snapshotId,
      batchId: activeBatch.batchId,
      createdAt: new Date().toISOString(),
      rootPath: snapshotRoot,
      inputPath: path.join(snapshotRoot, "input"),
      outputPath: path.join(snapshotRoot, "output"),
      approvedPath: path.join(snapshotRoot, "approved"),
      jobsPath: path.join(snapshotRoot, "jobs"),
      statePath: path.join(snapshotRoot, "state")
    };
    this.batchHistoryService.saveSnapshot(snapshot);

    const nextState: ActiveBatchState = {
      ...activeBatch,
      snapshotCount: activeBatch.snapshotCount + 1,
      lastSavedAt: new Date().toISOString()
    };
    await this.setActiveBatchState(nextState);
    await writeJsonFile(path.join(snapshotRoot, "snapshot.json"), nextState);
    await this.batchHistoryService.syncActiveBatchFromCurrent();
    return nextState;
  }

  async syncInputs(): Promise<ProductManifest[]> {
    return this.scanner.syncProducts();
  }

  async createBatchFromCurrentInput(
    promptConfig: BatchPromptConfig,
    clientId?: string,
    modelSelection?: { modelId: string; selectedPhotoIds: string[] }
  ) {
    return this.batchHistoryService.createBatchFromCurrentInput(promptConfig, clientId, modelSelection);
  }

  async findNextReviewableProductId(preferredId?: string): Promise<string | null> {
    const products = await this.repository.listProducts();
    if (products.length === 0) {
      return null;
    }
    if (preferredId && products.some((item) => item.productId === preferredId)) {
      return preferredId;
    }
    const prioritized = products.find((item) => item.status === "in_review")
      ?? products.find((item) => item.status === "generating")
      ?? products.find((item) => item.status === "pending")
      ?? products.find((item) => item.status === "error")
      ?? products[0];
    if (!prioritized) {
      return null;
    }
    return prioritized.productId;
  }

  async approveVariant(productId: string, poseId: string, outputId: string): Promise<ProductManifest> {
    return this.selectPoseOutput(productId, poseId, outputId);
  }

  async selectPoseOutput(productId: string, poseId: string, outputId: string): Promise<ProductManifest> {
    const manifest = await this.getProduct(productId);
    const output = manifest.outputs.find((item) => item.outputId === outputId && item.poseId === poseId);
    if (!output) {
      throw new Error(`Output ${outputId} for pose ${poseId} not found.`);
    }
    manifest.approved[poseId] = [outputId];
    manifest.status = computeProductStatus(manifest);
    await this.repository.saveProduct(manifest);
    await this.batchHistoryService.syncActiveBatchFromCurrent(undefined, productId);
    await this.logBatchEvent("product_approved", "Salida aprobada para la pose.", { productId, poseId });
    return manifest;
  }

  async finalizeProductApproval(productId: string, currentSelections?: Record<string, string>): Promise<ProductManifest> {
    const manifest = await this.getProduct(productId);
    for (const pose of manifest.poses) {
      const currentVisibleOutputId = currentSelections?.[pose.poseId];
      if (currentVisibleOutputId) {
        const currentVisibleOutput = manifest.outputs.find((item) => item.poseId === pose.poseId && item.outputId === currentVisibleOutputId);
        if (currentVisibleOutput) {
          manifest.approved[pose.poseId] = [currentVisibleOutput.outputId];
          continue;
        }
      }
      if ((manifest.approved[pose.poseId] ?? []).length > 0) {
        continue;
      }
      const latest = this.getLatestOutputForPose(manifest, pose.poseId);
      if (!latest) {
        throw new Error(`Pose ${pose.poseId} aun no tiene una imagen generada.`);
      }
      manifest.approved[pose.poseId] = [latest.outputId];
    }
    if (!hasMinimumApprovedSet(manifest)) {
      throw new Error("No se pudo completar la seleccion final del producto.");
    }
    manifest.status = "approved";
    await this.repository.saveProduct(manifest);
    await this.exportApproved(manifest);
    await this.batchHistoryService.syncActiveBatchFromCurrent("completed", productId);
    await this.logBatchEvent("product_approved", "Producto aprobado completamente.", { productId });
    return manifest;
  }

  async regeneratePose(
    productId: string,
    poseId: string,
    promptOverride?: string,
    providerModelId?: string
  ): Promise<ProductManifest> {
    const manifest = await this.getProduct(productId);
    const poseState = getPoseState(manifest, poseId);
    if (providerModelId?.trim()) {
      const batchPromptConfig = await this.batchPromptConfigService.get();
      await this.batchPromptConfigService.set({
        ...batchPromptConfig,
        providerSettings: {
          ...batchPromptConfig.providerSettings,
          modelId: providerModelId.trim()
        }
      });
    }
    poseState.status = "pending";
    poseState.regenerateCount += 1;
    poseState.lastError = undefined;
    poseState.promptOverride = promptOverride?.trim() ?? poseState.promptOverride ?? "";
    manifest.status = "pending";
    await this.repository.saveProduct(manifest);
    await this.batchHistoryService.syncActiveBatchFromCurrent("running", productId);
    await this.logBatchEvent("pose_regenerated", "Pose enviada a regeneracion.", { productId, poseId });
    return manifest;
  }

  async generateMissingPoseOutputs(productId: string, poseInput: PoseInput): Promise<void> {
    const manifest = await this.getProduct(productId);
    const poseState = getPoseState(manifest, poseInput.poseId);

    poseState.status = "generating";
    manifest.status = "generating";
    manifest.lastError = undefined;
    await this.repository.saveProduct(manifest);
    await this.batchHistoryService.syncActiveBatchFromCurrent("running", productId);
    await this.logBatchEvent("generation_started", "Generacion de pose iniciada.", { productId, poseId: poseInput.poseId });

    try {
      const batchPromptConfig = await this.batchPromptConfigService.get();
      const batchModelSelection = await this.getRequiredModelSelection();
      const garmentImages = await Promise.all(manifest.garmentImages.map((filePath) => loadImageAsProviderInput(filePath)));
      const { modelImages, poseImage } = await this.buildModelAndPoseInputs(batchModelSelection, poseInput.filePath);
      const providerInput = poseState.promptOverride?.trim()
        ? {
            productId: manifest.productId,
            category: manifest.category,
            poseId: poseInput.poseId,
            poseLabel: poseInput.label,
            modelImages,
            garmentImages,
            poseImage,
            variantCount: 1,
            prompt: poseState.promptOverride.trim(),
            providerSettings: batchPromptConfig.providerSettings
          }
        : this.promptService.buildProviderInput({
            productId: manifest.productId,
            category: manifest.category,
            poseId: poseInput.poseId,
            poseLabel: poseInput.label,
            modelImages,
            garmentImages,
            poseImage,
            variantCount: 1,
            promptOverride: poseState.promptOverride,
            batchPromptConfig,
            productGeneralPrompt: manifest.promptOverrides?.generalPrompt,
            productPosePrompt: manifest.promptOverrides?.posePrompts?.[poseInput.poseId],
            providerSettings: batchPromptConfig.providerSettings
          });
      poseState.lastPromptUsed = providerInput.prompt;
      await this.repository.saveProduct(manifest);

      const generated = await this.provider.generateVariantsForPose(providerInput);
      const batchPromptConfigResolved = await this.batchPromptConfigService.get();
      const systemPrompt = this.promptService.getResolvedSystemPrompt(batchPromptConfigResolved);
      const userPrompt = this.promptService.buildUserPrompt(
        manifest.category,
        poseInput.poseId,
        manifest.productId,
        poseState.promptOverride,
        {
          batchPromptConfig: batchPromptConfigResolved,
          productGeneralPrompt: manifest.promptOverrides?.generalPrompt,
          productPosePrompt: manifest.promptOverrides?.posePrompts?.[poseInput.poseId]
        }
      );
      this.repository.addPromptHistory({
        entryId: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        batchId: (await this.requireActiveBatchState()).batchId,
        productId: manifest.productId,
        poseId: poseInput.poseId,
        systemPrompt,
        userPrompt,
        finalPrompt: providerInput.prompt,
        providerModelId: batchPromptConfig.providerSettings.modelId || this.provider.modelName,
        source: poseState.regenerateCount > 0 ? "regeneration" : "generation",
        createdAt: new Date().toISOString()
      });
      const outputs = await Promise.all(
        generated.map((image, index) => this.saveOutputFiles(
          manifest,
          poseInput.poseId,
          "a",
          providerInput.prompt,
          batchPromptConfig.providerSettings.modelId || this.provider.modelName,
          image
        ))
      );
      const latestOutput = outputs[0];
      if (!latestOutput) {
        throw new Error(`No output was produced for ${manifest.productId} ${poseInput.poseId}.`);
      }
      manifest.outputs = manifest.outputs.concat(outputs);
      manifest.approved[poseInput.poseId] = [latestOutput.outputId];
      poseState.status = "ready";
      poseState.lastError = undefined;
      manifest.status = computeProductStatus(manifest);
      await this.repository.saveProduct(manifest);
      await this.batchHistoryService.syncActiveBatchFromCurrent(undefined, productId);
      await this.logBatchEvent("generation_finished", "Generacion de pose finalizada.", { productId, poseId: poseInput.poseId });
    } catch (error) {
      poseState.status = "error";
      poseState.lastError = error instanceof Error ? error.message : "Unknown generation error";
      manifest.status = "error";
      manifest.lastError = poseState.lastError;
      await this.repository.saveProduct(manifest);
      await this.batchHistoryService.syncActiveBatchFromCurrent("error", productId);
      throw error;
    }
  }

  private async saveOutputFiles(
    manifest: ProductManifest,
    poseId: string,
    variantKey: "a",
    prompt: string,
    resolvedModelName: string,
    image: Awaited<ReturnType<ImageGenerationProvider["generateVariantsForPose"]>>[number]
  ): Promise<GeneratedOutput> {
    const revision = this.getNextPoseRevision(manifest, poseId);
    const outputId = `${manifest.productId}-${poseId}-${variantKey}-${revision}`;
    const activeBatch = await this.requireActiveBatchState();
    const productOutputDir = path.join(activeBatch.sessionRoot, "output", manifest.productId);
    const fileName = `${manifest.productId}-${poseId}-${variantKey}-${revision}.jpg`;
    const filePath = path.join(productOutputDir, fileName);
    const metadataPath = path.join(productOutputDir, `${outputId}.json`);
    await fs.mkdir(productOutputDir, { recursive: true });
    const normalized = await normalizeGeneratedImage(image.bytes);
    await fs.writeFile(filePath, normalized);
    const metadata: GeneratedImageMetadata = {
      prompt,
      poseId,
      variantKey,
      provider: this.provider.providerName,
      model: resolvedModelName,
      endpoint: this.provider.methodName,
      timestamp: new Date().toISOString(),
      responseId: image.responseId,
      notes: [
        "Salida adaptada localmente a 1000x1000 JPG con densidad 72 ppp.",
        "El MVP no garantiza Adobe RGB; se guarda en JPEG estandar generado con Sharp."
      ]
    };
    await writeJsonFile(metadataPath, metadata);
    return {
      outputId,
      poseId,
      variantKey,
      fileName,
      filePath,
      metadataPath,
      status: "ready",
      metadata
    };
  }

  async exportApproved(manifest: ProductManifest): Promise<void> {
    if (!hasMinimumApprovedSet(manifest)) {
      throw new Error(`Cannot export product ${manifest.productId}: at least 1 approval per pose is required.`);
    }
    const targetDir = path.join(paths.approvedDir, manifest.productId);
    const activeBatch = await this.requireActiveBatchState();
    const batchApprovedDir = path.join(activeBatch.sessionRoot, "approved", manifest.productId);
    await fs.rm(batchApprovedDir, { recursive: true, force: true });
    await fs.mkdir(batchApprovedDir, { recursive: true });
    const approvedOutputs = manifest.poses
      .map((pose, index) => ({ pose, index }))
      .flatMap(({ pose }) => (manifest.approved[pose.poseId] ?? []).map((outputId) => {
        const output = manifest.outputs.find((item) => item.outputId === outputId);
        if (!output) {
          throw new Error(`Approved output missing for pose ${pose.poseId}`);
        }
        return output;
      }));

    await Promise.all(approvedOutputs.map(async (output, outputIndex) => {
      const index = outputIndex + 1;
      const finalPath = path.join(batchApprovedDir, `MK-${manifest.sku ?? manifest.productId}-${index}.jpg`);
      const buffer = await fs.readFile(output.filePath);
      await fs.writeFile(finalPath, buffer);
    }));
  }

  async getReviewPageModel(productId: string): Promise<{
    product: ProductManifest;
    allProducts: ProductListItem[];
    currentIndex: number;
    providerModelId: string;
  }> {
    const products = await this.listProducts();
    const product = await this.getProduct(productId);
    const batchPromptConfig = await this.batchPromptConfigService.get();
    await this.applyPromptPreviews(product);
    await this.batchHistoryService.syncActiveBatchFromCurrent(undefined, productId);
    const currentIndex = products.findIndex((item) => item.productId === productId);
    return {
      product,
      allProducts: products,
      currentIndex,
      providerModelId: batchPromptConfig.providerSettings.modelId
    };
  }

  async listBatches(filters?: {
    status?: "all" | "draft" | "running" | "in_review" | "paused" | "completed" | "archived" | "error";
    clientId?: string;
    search?: string;
  }) {
    return this.batchHistoryService.listBatches(filters);
  }

  listClients() {
    return this.batchHistoryService.listClients();
  }

  listModels(filters?: { clientId?: string; includeFree?: boolean }) {
    return this.batchHistoryService.listModels(filters);
  }

  createClient(input: { name: string; notes?: string }): ClientRecord {
    const name = input.name.trim();
    if (!name) {
      throw new Error("El nombre del cliente es obligatorio.");
    }
    const clientId = sanitizeClientId(name);
    this.batchHistoryService.saveClient({
      clientId,
      name,
      notes: input.notes?.trim() || undefined
    });
    const saved = this.listClients().find((client) => client.clientId === clientId);
    if (!saved) {
      throw new Error("No se pudo guardar el cliente.");
    }
    return saved;
  }

  async createModel(input: {
    name: string;
    clientId?: string;
    ageGroup?: CatalogModel["ageGroup"];
    gender: CatalogModel["gender"];
    includesFullBody: boolean;
    includesFace: boolean;
    includesHands: boolean;
    includesFeet: boolean;
    includesSwimwear: boolean;
    photos: Array<{ buffer: Buffer; originalName: string }>;
  }): Promise<CatalogModel> {
    const name = input.name.trim();
    if (!name) {
      throw new Error("El nombre del modelo es obligatorio.");
    }
    if (input.photos.length < 1) {
      throw new Error("Debes cargar al menos una foto del modelo.");
    }
    if (input.photos.length > 10) {
      throw new Error("Solo se permiten hasta 10 fotos por modelo.");
    }
    const now = new Date().toISOString();
    const modelId = `model-${sanitizeId(name)}-${Date.now().toString(36)}`;
    const modelRoot = path.join(paths.modelCatalogDir, modelId);
    const photos: CatalogModelPhoto[] = input.photos.map((photo, index) => {
      const ext = path.extname(photo.originalName).toLowerCase() || ".jpg";
      return {
        photoId: `${modelId}-photo-${index + 1}`,
        modelId,
        filePath: path.join(modelRoot, `photo-${index + 1}${ext}`),
        sortOrder: index
      };
    });

    const model: CatalogModel = {
      modelId,
      clientId: input.clientId?.trim() || undefined,
      name,
      ageGroup: input.ageGroup,
      gender: input.gender,
      includesFullBody: input.includesFullBody,
      includesFace: input.includesFace,
      includesHands: input.includesHands,
      includesFeet: input.includesFeet,
      includesSwimwear: input.includesSwimwear,
      createdAt: now,
      updatedAt: now,
      photos
    };

    await this.batchHistoryService.saveModel(model, input.photos);
    return this.batchHistoryService.getModel(modelId) ?? model;
  }

  async updateModel(input: {
    modelId: string;
    name: string;
    clientId?: string;
    ageGroup?: CatalogModel["ageGroup"];
    gender: CatalogModel["gender"];
    includesFullBody: boolean;
    includesFace: boolean;
    includesHands: boolean;
    includesFeet: boolean;
    includesSwimwear: boolean;
    keepPhotoIds: string[];
    photos: Array<{ buffer: Buffer; originalName: string }>;
  }): Promise<CatalogModel> {
    const existing = this.batchHistoryService.getModel(input.modelId);
    if (!existing) {
      throw new Error("El modelo no existe.");
    }
    const name = input.name.trim();
    if (!name) {
      throw new Error("El nombre del modelo es obligatorio.");
    }
    const keptPhotos = existing.photos.filter((photo) => input.keepPhotoIds.includes(photo.photoId));
    const totalPhotos = keptPhotos.length + input.photos.length;
    if (totalPhotos < 1) {
      throw new Error("El modelo debe conservar al menos una foto.");
    }
    if (totalPhotos > 10) {
      throw new Error("Solo se permiten hasta 10 fotos por modelo.");
    }

    const now = new Date().toISOString();
    const modelRoot = path.join(paths.modelCatalogDir, existing.modelId);
    const newPhotos: CatalogModelPhoto[] = input.photos.map((photo, index) => {
      const ext = path.extname(photo.originalName).toLowerCase() || ".jpg";
      const suffix = `${Date.now().toString(36)}-${index + 1}`;
      return {
        photoId: `${existing.modelId}-photo-${suffix}`,
        modelId: existing.modelId,
        filePath: path.join(modelRoot, `photo-${suffix}${ext}`),
        sortOrder: keptPhotos.length + index
      };
    });

    const mergedPhotos = keptPhotos.concat(newPhotos).map((photo, index) => ({
      ...photo,
      sortOrder: index
    }));

    const nextModel: CatalogModel = {
      ...existing,
      clientId: input.clientId?.trim() || undefined,
      name,
      ageGroup: input.ageGroup,
      gender: input.gender,
      includesFullBody: input.includesFullBody,
      includesFace: input.includesFace,
      includesHands: input.includesHands,
      includesFeet: input.includesFeet,
      includesSwimwear: input.includesSwimwear,
      updatedAt: now,
      photos: mergedPhotos
    };

    const removedFilePaths = existing.photos
      .filter((photo) => !input.keepPhotoIds.includes(photo.photoId))
      .map((photo) => photo.filePath);

    try {
      await this.batchHistoryService.updateModel(
        nextModel,
        input.photos.map((photo, index) => ({
          ...photo,
          filePath: newPhotos[index]?.filePath ?? ""
        })),
        removedFilePaths
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("FOREIGN KEY")) {
        throw new Error("No se pueden quitar fotos que estan siendo usadas por uno o mas batches.");
      }
      throw error;
    }

    return this.batchHistoryService.getModel(existing.modelId) ?? nextModel;
  }

  async deleteModel(modelId: string): Promise<void> {
    const model = this.batchHistoryService.getModel(modelId);
    if (!model) {
      throw new Error("El modelo no existe.");
    }
    try {
      await this.batchHistoryService.deleteModel(modelId);
    } catch (error) {
      if (error instanceof Error && error.message.includes("FOREIGN KEY")) {
        throw new Error("No se puede eliminar este modelo porque esta siendo usado por uno o mas batches.");
      }
      throw error;
    }
  }

  async getBatchSnapshots(batchId: string) {
    return this.batchHistoryService.getBatchSnapshots(batchId);
  }

  async activateBatch(batchId: string): Promise<void> {
    await this.batchHistoryService.activateBatch(batchId);
  }

  async archiveBatch(batchId: string) {
    return this.batchHistoryService.archiveBatch(batchId);
  }

  async duplicateBatch(batchId: string) {
    return this.batchHistoryService.duplicateBatch(batchId);
  }

  async getBatchEvents(batchId: string) {
    return this.batchHistoryService.getBatchEvents(batchId);
  }

  async getBatchDetail(batchId: string): Promise<{
    batch: Awaited<ReturnType<BatchHistoryService["getBatch"]>>;
    products: ProductManifest[];
    events: Awaited<ReturnType<BatchHistoryService["getBatchEvents"]>>;
    snapshots: Awaited<ReturnType<BatchHistoryService["getBatchSnapshots"]>>;
    jobs: Array<BatchJob & { attemptsHistory: BatchJobAttempt[] }>;
    promptHistory: ReturnType<ProductRepository["listPromptHistory"]>;
  }> {
    const [batch, products, events, snapshots] = await Promise.all([
      this.batchHistoryService.getBatch(batchId),
      this.repository.listProducts(batchId),
      this.batchHistoryService.getBatchEvents(batchId),
      this.batchHistoryService.getBatchSnapshots(batchId)
    ]);
    const jobs = this.jobRepository.listJobs(batchId);
    const attempts = this.jobRepository.listAttemptsForBatch(batchId);
    const attemptsByJob = new Map<string, BatchJobAttempt[]>();
    for (const attempt of attempts) {
      const bucket = attemptsByJob.get(attempt.jobId) ?? [];
      bucket.push(attempt);
      attemptsByJob.set(attempt.jobId, bucket);
    }

    return {
      batch,
      products,
      events,
      snapshots,
      jobs: jobs.map((job) => ({
        ...job,
        attemptsHistory: attemptsByJob.get(job.jobId) ?? []
      })),
      promptHistory: this.repository.listPromptHistory(batchId, 80)
    };
  }

  async deleteBatch(batchId: string) {
    return this.batchHistoryService.deleteBatch(batchId);
  }

  async setBatchModelSelection(input: { batchId: string; modelId: string; selectedPhotoIds: string[] }): Promise<void> {
    await this.batchHistoryService.saveBatchModelSelection(input);
  }

  async validateOutputFiles(manifest: ProductManifest): Promise<ProductManifest> {
    let changed = false;
    for (const output of manifest.outputs) {
      const exists = await fileExists(output.filePath);
      if (!exists) {
        output.status = "error";
        output.error = "Output file missing on disk.";
        changed = true;
      }
    }
    if (changed) {
      manifest.status = computeProductStatus(manifest);
      await this.repository.saveProduct(manifest);
    }
    return manifest;
  }

  private async applyPromptPreviews(manifest: ProductManifest): Promise<void> {
    const batchPromptConfig = await this.batchPromptConfigService.get();
    const resolvedSystemPrompt = this.promptService.getResolvedSystemPrompt(batchPromptConfig);
    for (const pose of manifest.poses) {
      pose.promptPreview = this.promptService.buildEditorPrompt({
        poseId: pose.poseId,
        category: manifest.category,
        productId: manifest.productId,
        batchPromptConfig,
        productGeneralPrompt: manifest.promptOverrides?.generalPrompt,
        productPosePrompt: manifest.promptOverrides?.posePrompts?.[pose.poseId]
      });
      if (pose.promptOverride) {
        pose.promptOverride = normalizeEditorPrompt(pose.promptOverride, resolvedSystemPrompt);
      }
      if (pose.lastPromptUsed) {
        pose.lastPromptUsed = normalizeEditorPrompt(pose.lastPromptUsed, resolvedSystemPrompt);
      }
    }
    await this.repository.saveProduct(manifest);
  }

  private getLatestOutputForPose(manifest: ProductManifest, poseId: string): GeneratedOutput | null {
    const outputs = manifest.outputs.filter((item) => item.poseId === poseId && item.status === "ready");
    return outputs.at(-1) ?? null;
  }

  private getNextPoseRevision(manifest: ProductManifest, poseId: string): number {
    return manifest.outputs.filter((item) => item.poseId === poseId).length + 1;
  }

  private async logBatchEvent(
    type: "generation_started" | "generation_finished" | "product_approved" | "pose_regenerated" | "model_changed",
    message: string,
    details: { productId?: string; poseId?: string }
  ): Promise<void> {
    const active = await this.batchHistoryService.getActiveBatch();
    if (!active) {
      return;
    }
    await this.batchHistoryService.logEvent(active.batchId, {
      type,
      message,
      productId: details.productId,
      poseId: details.poseId
    });
  }

  private async requireActiveBatchState(): Promise<ActiveBatchState> {
    const activeBatch = await this.getActiveBatchState();
    if (!activeBatch) {
      throw new Error("No active batch available.");
    }
    return activeBatch;
  }

  private async getRequiredModelSelection(): Promise<BatchModelSelection> {
    const activeBatch = await this.requireActiveBatchState();
    const selection = this.batchHistoryService.getBatchModelSelection(activeBatch.batchId);
    if (!selection || selection.selectedPhotoIds.length !== 4) {
      throw new Error("No hay 4 fotos de modelo seleccionadas para este batch.");
    }
    return selection;
  }

  private async buildModelAndPoseInputs(selection: BatchModelSelection, poseFilePath: string) {
    const model = this.batchHistoryService.getModel(selection.modelId);
    if (!model) {
      throw new Error(`Modelo no encontrado: ${selection.modelId}`);
    }
    const selectedPaths = selection.selectedPhotoIds
      .map((photoId) => model.photos.find((photo) => photo.photoId === photoId)?.filePath)
      .filter((filePath): filePath is string => Boolean(filePath));
    if (!selectedPaths.length) {
      throw new Error("El modelo seleccionado no tiene fotos activas para enviar a la API.");
    }
    const identityPaths = selectedPaths.filter((filePath) => filePath !== poseFilePath);
    const fallbackIdentityPaths = identityPaths.length > 0 ? identityPaths : [poseFilePath];
    return {
      modelImages: await Promise.all(fallbackIdentityPaths.map((filePath) => loadImageAsProviderInput(filePath))),
      poseImage: await loadImageAsProviderInput(poseFilePath)
    };
  }
}

function getPoseState(manifest: ProductManifest, poseId: string): ProductPoseState {
  const poseState = manifest.poses.find((pose) => pose.poseId === poseId);
  if (!poseState) {
    throw new Error(`Pose ${poseId} not configured for ${manifest.productId}`);
  }
  return poseState;
}

function hasMinimumApprovedSet(manifest: ProductManifest): boolean {
  return manifest.poses.every((pose) => (manifest.approved[pose.poseId] ?? []).length >= 1);
}

function computeProductStatus(manifest: ProductManifest): ProductManifest["status"] {
  if (manifest.poses.some((pose) => pose.status === "error")) {
    return "error";
  }
  if (manifest.poses.some((pose) => pose.status === "generating")) {
    return "generating";
  }
  if (manifest.poses.every((pose) => pose.status === "ready")) {
    return manifest.status === "approved" ? "approved" : "in_review";
  }
  return "pending";
}

function normalizeEditorPrompt(value: string | undefined, systemPrompt: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("System instructions:")) {
    return trimmed;
  }
  const systemBlock = systemPrompt.trim();
  if (!systemBlock) {
    return trimmed;
  }
  return `${systemBlock}\n\nUser prompt:\n${trimmed}`;
}

function mapBootstrapStatusToBatchStatus(status: BootstrapState["status"]): "running" | "completed" | "error" | "paused" {
  if (status === "running") {
    return "running";
  }
  if (status === "completed") {
    return "completed";
  }
  if (status === "error") {
    return "error";
  }
  return "paused";
}

function sanitizeClientId(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
