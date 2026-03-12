import type { Request, Response } from "express";
import type { AnalyticsFilters } from "../../shared/types";
import { ProductService } from "../services/product-service";
import { BootstrapService } from "../services/bootstrap-service";
import { JobRunner } from "../jobs/job-runner";
import { BatchUploadService } from "../services/batch-upload-service";
import { defaultPromptConfig } from "../services/batch-prompt-config-service";

export class ApiController {
  constructor(
    private readonly productService: ProductService,
    private readonly bootstrapService: BootstrapService,
    private readonly jobRunner: JobRunner,
    private readonly batchUploadService: BatchUploadService
  ) {}

  getProducts = async (_request: Request, response: Response): Promise<void> => {
    response.json(await this.productService.listProducts());
  };

  getBatches = async (_request: Request, response: Response): Promise<void> => {
    response.json({
      batches: await this.productService.listBatches()
    });
  };

  getModels = async (request: Request, response: Response): Promise<void> => {
    const clientId = typeof request.query.clientId === "string" ? request.query.clientId.trim() : "";
    response.json({
      models: this.productService.listModels({
        clientId: clientId || undefined,
        includeFree: true
      })
    });
  };

  createClient = async (request: Request, response: Response): Promise<void> => {
    const { name, notes } = request.body as { name?: string; notes?: string };
    const client = this.productService.createClient({
      name: name ?? "",
      notes: notes ?? ""
    });
    response.json({
      ok: true,
      client
    });
  };

  createModel = async (request: Request, response: Response): Promise<void> => {
    const files = (request.files as Express.Multer.File[] | undefined) ?? [];
    const model = await this.productService.createModel({
      name: typeof request.body.name === "string" ? request.body.name : "",
      clientId: typeof request.body.clientId === "string" ? request.body.clientId : "",
      ageGroup: typeof request.body.ageGroup === "string" && request.body.ageGroup.trim()
        ? request.body.ageGroup as Parameters<ProductService["createModel"]>[0]["ageGroup"]
        : undefined,
      gender: request.body.gender === "male" ? "male" : "female",
      includesFullBody: request.body.includesFullBody === "true",
      includesFace: request.body.includesFace !== "false",
      includesHands: request.body.includesHands === "true",
      includesFeet: request.body.includesFeet === "true",
      includesSwimwear: request.body.includesSwimwear === "true",
      photos: files.map((file) => ({
        buffer: file.buffer,
        originalName: file.originalname
      }))
    });
    response.json({
      ok: true,
      model
    });
  };

  updateModel = async (request: Request, response: Response): Promise<void> => {
    const files = (request.files as Express.Multer.File[] | undefined) ?? [];
    const keepPhotoIds = parseJsonField<string[]>(request.body.keepPhotoIds, []);
    const model = await this.productService.updateModel({
      modelId: readParam(request.params.id, "id"),
      name: typeof request.body.name === "string" ? request.body.name : "",
      clientId: typeof request.body.clientId === "string" ? request.body.clientId : "",
      ageGroup: typeof request.body.ageGroup === "string" && request.body.ageGroup.trim()
        ? request.body.ageGroup as Parameters<ProductService["updateModel"]>[0]["ageGroup"]
        : undefined,
      gender: request.body.gender === "male" ? "male" : "female",
      includesFullBody: request.body.includesFullBody === "true",
      includesFace: request.body.includesFace !== "false",
      includesHands: request.body.includesHands === "true",
      includesFeet: request.body.includesFeet === "true",
      includesSwimwear: request.body.includesSwimwear === "true",
      keepPhotoIds,
      photos: files.map((file) => ({
        buffer: file.buffer,
        originalName: file.originalname
      }))
    });
    response.json({
      ok: true,
      model
    });
  };

  deleteModel = async (request: Request, response: Response): Promise<void> => {
    await this.productService.deleteModel(readParam(request.params.id, "id"));
    response.json({ ok: true });
  };

  getProduct = async (request: Request, response: Response): Promise<void> => {
    response.json(await this.productService.getProduct(readParam(request.params.id, "id")));
  };

  getStatus = async (_request: Request, response: Response): Promise<void> => {
    response.json({
      bootstrap: await this.productService.getBootstrapState(),
      activeBatch: await this.productService.getActiveBatchState(),
      jobs: this.jobRunner.getState()
    });
  };

  getBootstrap = async (_request: Request, response: Response): Promise<void> => {
    response.json({
      bootstrap: await this.productService.getBootstrapState(),
      activeBatch: await this.productService.getActiveBatchState(),
      poses: this.bootstrapService.getPoses(),
      jobs: this.jobRunner.getState()
    });
  };

  getAnalytics = async (request: Request, response: Response): Promise<void> => {
    const filters: AnalyticsFilters = {
      from: typeof request.query.from === "string" && request.query.from.trim() ? request.query.from.trim() : undefined,
      to: typeof request.query.to === "string" && request.query.to.trim() ? request.query.to.trim() : undefined,
      clientId: typeof request.query.clientId === "string" && request.query.clientId.trim() ? request.query.clientId.trim() : undefined,
      providerModelId: typeof request.query.providerModelId === "string" && request.query.providerModelId.trim() ? request.query.providerModelId.trim() : undefined,
      category: typeof request.query.category === "string" && request.query.category.trim()
        ? request.query.category.trim() as AnalyticsFilters["category"]
        : "all",
      batchId: typeof request.query.batchId === "string" && request.query.batchId.trim() ? request.query.batchId.trim() : undefined,
      status: typeof request.query.status === "string" && request.query.status.trim()
        ? request.query.status.trim() as AnalyticsFilters["status"]
        : "all"
    };
    response.json({
      dashboard: this.productService.getAnalyticsDashboard(filters),
      filterOptions: this.productService.getAnalyticsFilterOptions()
    });
  };

  saveBatch = async (_request: Request, response: Response): Promise<void> => {
    const snapshot = await this.productService.saveCurrentBatchSnapshot();
    response.json({
      ok: true,
      batchId: snapshot.batchId,
      snapshotCount: snapshot.snapshotCount,
      lastSavedAt: snapshot.lastSavedAt
    });
  };

  setupBatch = async (request: Request, response: Response): Promise<void> => {
    const files = request.files as Record<string, Express.Multer.File[]> | undefined;
    const garmentMeta = parseJsonField<Array<{ clientId: string; relativePath?: string }>>(request.body.garmentMeta, []);
    const promptConfig = parseJsonField(request.body.promptConfig, {
      ...defaultPromptConfig,
      posePrompts: {} as Record<string, string>
    });
    const clientId = typeof request.body.clientId === "string" ? request.body.clientId.trim() : "";
    const modelSelection = parseJsonField<{ modelId?: string; selectedPhotoIds?: string[] }>(request.body.modelSelection, {});
    if (!modelSelection.modelId || !Array.isArray(modelSelection.selectedPhotoIds) || modelSelection.selectedPhotoIds.length < 1) {
      response.status(400).json({ error: "Debes seleccionar un modelo y al menos 1 foto del modelo." });
      return;
    }

    const batch = await this.productService.createBatchFromCurrentInput(promptConfig, clientId || undefined, {
      modelId: modelSelection.modelId ?? "",
      selectedPhotoIds: Array.isArray(modelSelection.selectedPhotoIds) ? modelSelection.selectedPhotoIds : []
    });
    await this.batchUploadService.replaceInputBatch(batch.inputRoot, {
      garments: mapUploadedFiles(files?.garmentFiles ?? [], garmentMeta),
      promptConfig
    });
    await this.bootstrapService.start();
    response.json({
      ok: true,
      nextUrl: "/home"
    });
  };

  openBatch = async (request: Request, response: Response): Promise<void> => {
    const batchId = readParam(request.params.id, "id");
    await this.productService.activateBatch(batchId);
    response.json({
      ok: true,
      nextUrl: "/home"
    });
  };

  continueBatch = async (request: Request, response: Response): Promise<void> => {
    const batchId = readParam(request.params.id, "id");
    await this.productService.activateBatch(batchId);
    await this.bootstrapService.resumeCurrentBatch();
    response.json({
      ok: true,
      nextUrl: "/home"
    });
  };

  archiveBatch = async (request: Request, response: Response): Promise<void> => {
    const batchId = readParam(request.params.id, "id");
    response.json({
      ok: true,
      batch: await this.productService.archiveBatch(batchId)
    });
  };

  duplicateBatch = async (request: Request, response: Response): Promise<void> => {
    const batchId = readParam(request.params.id, "id");
    response.json({
      ok: true,
      batch: await this.productService.duplicateBatch(batchId)
    });
  };

  deleteBatch = async (request: Request, response: Response): Promise<void> => {
    const batchId = readParam(request.params.id, "id");
    const result = await this.productService.deleteBatch(batchId);
    response.json({
      ok: true,
      deletedActive: result.deletedActive,
      nextUrl: result.deletedActive ? "/" : undefined
    });
  };

  approve = async (request: Request, response: Response): Promise<void> => {
    const productId = readParam(request.params.id, "id");
    const { poseId, outputId } = request.body as { poseId?: string; outputId?: string };
    if (!poseId || !outputId) {
      response.status(400).json({ error: "poseId and outputId are required." });
      return;
    }
    const manifest = await this.productService.approveVariant(productId, poseId, outputId);
    response.json({
      product: manifest,
      nextProductId: manifest.status === "approved"
        ? await this.productService.findNextReviewableProductId()
        : null
    });
  };

  finalizeApproval = async (request: Request, response: Response): Promise<void> => {
    const productId = readParam(request.params.id, "id");
    const { currentSelections } = request.body as { currentSelections?: Record<string, string> };
    const manifest = await this.productService.finalizeProductApproval(productId, currentSelections);
    response.json({
      product: manifest,
      nextProductId: await this.productService.findNextReviewableProductId()
    });
  };

  regenerate = async (request: Request, response: Response): Promise<void> => {
    const productId = readParam(request.params.id, "id");
    const poseId = readParam(request.params.poseId, "poseId");
    const { promptOverride, providerModelId } = request.body as { promptOverride?: string; providerModelId?: string };
    const manifest = await this.productService.regeneratePose(productId, poseId, promptOverride, providerModelId);
    const pose = this.bootstrapService.getPoses().find((item) => item.poseId === poseId);
    if (!pose) {
      response.status(404).json({ error: `Pose ${poseId} not found in loaded pose inputs.` });
      return;
    }
    this.jobRunner.enqueuePriority({ productId: manifest.productId, pose });
    response.json({
      ok: true,
      productId: manifest.productId,
      poseId,
      status: manifest.status
    });
  };

}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapUploadedFiles(
  files: Express.Multer.File[],
  metadata: Array<{ clientId: string; relativePath?: string }>
): Array<{ buffer: Buffer; originalName: string; relativePath?: string }> {
  const metadataMap = new Map(metadata.map((item) => [item.clientId, item]));
  return files.map((file) => {
    const [firstPart, ...nameParts] = file.originalname.split("__");
    const clientId = firstPart ?? "";
    const resolvedName = nameParts.join("__") || file.originalname;
    const meta = metadataMap.get(clientId);
    return {
      buffer: file.buffer,
      originalName: resolvedName,
      relativePath: meta?.relativePath
    };
  });
}

function readParam(value: string | string[] | undefined, name: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new Error(`Missing route param: ${name}`);
}
