import path from "path";
import type { Request, Response } from "express";
import type { AnalyticsFilters } from "../../shared/types";
import { ProductService } from "../services/product-service";
import { config, falModelOptions } from "../config";
import { PromptService } from "../services/prompt-service";
import { defaultPromptConfig } from "../services/batch-prompt-config-service";

export class PageController {
  constructor(private readonly productService: ProductService) {}

  home = async (_request: Request, response: Response): Promise<void> => {
    response.render("generate-images", {
      activeMenu: "generate-images",
      basename: path.basename,
      fileUrl: (filePath: string) => `/files?path=${encodeURIComponent(path.relative(config.dataDir, filePath).replaceAll("\\", "/"))}`,
      defaultSystemPrompt: PromptService.getDefaultSystemPrompt(),
      falModelOptions,
      defaultProviderSettings: defaultPromptConfig.providerSettings,
      clients: this.productService.listClients(),
      availableModels: serializeModels(this.productService.listModels({ includeFree: true })),
      selectedClientId: readOptionalQuery(_request.query.clientId)
    });
  };

  generateImages = async (_request: Request, response: Response): Promise<void> => {
    response.render("generate-images", {
      activeMenu: "generate-images",
      basename: path.basename,
      fileUrl: (filePath: string) => `/files?path=${encodeURIComponent(path.relative(config.dataDir, filePath).replaceAll("\\", "/"))}`,
      defaultSystemPrompt: PromptService.getDefaultSystemPrompt(),
      falModelOptions,
      defaultProviderSettings: defaultPromptConfig.providerSettings,
      clients: this.productService.listClients(),
      availableModels: serializeModels(this.productService.listModels({ includeFree: true })),
      selectedClientId: readOptionalQuery(_request.query.clientId)
    });
  };

  clients = async (_request: Request, response: Response): Promise<void> => {
    const clients = this.productService.listClients();
    const allBatches = await this.productService.listBatches();
    response.render("clients", {
      activeMenu: "clients",
      clients: clients.map((client) => ({
        ...client,
        recentBatches: allBatches.filter((batch) => batch.clientId === client.clientId).slice(0, 4),
        completedCount: allBatches.filter((batch) => batch.clientId === client.clientId && batch.status === "completed").length,
        inReviewCount: allBatches.filter((batch) => batch.clientId === client.clientId && batch.status === "in_review").length,
        errorCount: allBatches.filter((batch) => batch.clientId === client.clientId && batch.status === "error").length
      })),
      basename: path.basename,
      fileUrl: (filePath: string) => `/files?path=${encodeURIComponent(path.relative(config.dataDir, filePath).replaceAll("\\", "/"))}`
    });
  };

  models = async (_request: Request, response: Response): Promise<void> => {
    response.render("models", {
      activeMenu: "models",
      clients: this.productService.listClients(),
      models: this.productService.listModels({ includeFree: true }),
      basename: path.basename,
      fileUrl: (filePath: string) => `/files?path=${encodeURIComponent(path.relative(config.dataDir, filePath).replaceAll("\\", "/"))}`
    });
  };

  batches = async (_request: Request, response: Response): Promise<void> => {
    const status = readOptionalQuery(_request.query.status);
    const clientId = readOptionalQuery(_request.query.clientId);
    const search = readOptionalQuery(_request.query.q);
    const batches = await this.productService.listBatches({
      status: (status as "all" | "draft" | "running" | "in_review" | "paused" | "completed" | "archived" | "error" | undefined) ?? "all",
      clientId: clientId || undefined,
      search: search || undefined
    });
    response.render("batches", {
      activeMenu: "batches",
      batches: await Promise.all(batches.map(async (batch) => ({
        ...batch,
        snapshots: await this.productService.getBatchSnapshots(batch.batchId)
      }))),
      filters: {
        status: status || "all",
        clientId: clientId || "",
        q: search || ""
      },
      clients: this.productService.listClients(),
      basename: path.basename,
      fileUrl: (filePath: string) => `/files?path=${encodeURIComponent(path.relative(config.dataDir, filePath).replaceAll("\\", "/"))}`
    });
  };

  analytics = async (request: Request, response: Response): Promise<void> => {
    const filters: AnalyticsFilters = {
      from: readOptionalQuery(request.query.from) || undefined,
      to: readOptionalQuery(request.query.to) || undefined,
      clientId: readOptionalQuery(request.query.clientId) || undefined,
      providerModelId: readOptionalQuery(request.query.providerModelId) || undefined,
      category: (readOptionalQuery(request.query.category) || "all") as AnalyticsFilters["category"],
      batchId: readOptionalQuery(request.query.batchId) || undefined,
      status: (readOptionalQuery(request.query.status) || "all") as AnalyticsFilters["status"]
    };
    response.render("analytics", {
      activeMenu: "analytics",
      dashboard: this.productService.getAnalyticsDashboard(filters),
      filterOptions: this.productService.getAnalyticsFilterOptions(),
      basename: path.basename,
      fileUrl: (filePath: string) => `/files?path=${encodeURIComponent(path.relative(config.dataDir, filePath).replaceAll("\\", "/"))}`
    });
  };

  batchDetail = async (request: Request, response: Response): Promise<void> => {
    const batchId = typeof request.params.id === "string" ? request.params.id : "";
    const detail = await this.productService.getBatchDetail(batchId);
    response.render("batch-detail", {
      activeMenu: "batches",
      detail,
      basename: path.basename,
      fileUrl: (filePath: string) => `/files?path=${encodeURIComponent(path.relative(config.dataDir, filePath).replaceAll("\\", "/"))}`
    });
  };

  review = async (request: Request, response: Response): Promise<void> => {
    const requestedId = typeof request.params.id === "string" ? request.params.id : undefined;
    await this.renderReviewPage(requestedId, response);
  };

  reviewHome = async (_request: Request, response: Response): Promise<void> => {
    await this.renderReviewPage(undefined, response);
  };

  private async renderReviewPage(requestedId: string | undefined, response: Response): Promise<void> {
    const productId = await this.productService.findNextReviewableProductId();
    if (!productId) {
      response.render("generate-images", {
        activeMenu: "generate-images",
        basename: path.basename,
        fileUrl: (filePath: string) => `/files?path=${encodeURIComponent(path.relative(config.dataDir, filePath).replaceAll("\\", "/"))}`,
        defaultSystemPrompt: PromptService.getDefaultSystemPrompt(),
        falModelOptions,
        defaultProviderSettings: defaultPromptConfig.providerSettings,
        clients: this.productService.listClients(),
        availableModels: serializeModels(this.productService.listModels({ includeFree: true })),
        selectedClientId: ""
      });
      return;
    }
    const currentId = await this.productService.findNextReviewableProductId(requestedId ?? productId) ?? productId;
    const pageModel = await this.productService.getReviewPageModel(currentId);
    const currentIndex = pageModel.currentIndex >= 0 ? pageModel.currentIndex : 0;
    const previous = pageModel.allProducts[currentIndex - 1]?.productId ?? null;
    const next = pageModel.allProducts[currentIndex + 1]?.productId ?? null;

    response.render("review", {
      product: pageModel.product,
      allProducts: pageModel.allProducts,
      currentProviderModelId: pageModel.providerModelId,
      falModelOptions,
      currentIndex,
      previous,
      next,
      activeMenu: "home",
      basename: path.basename,
      fileUrl: (filePath: string) => `/files?path=${encodeURIComponent(path.relative(config.dataDir, filePath).replaceAll("\\", "/"))}`
    });
  }
}

function readOptionalQuery(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function serializeModels(models: ReturnType<ProductService["listModels"]>) {
  return models.map((model) => ({
    ...model,
    photos: model.photos.map((photo) => ({
      ...photo,
      previewUrl: `/files?path=${encodeURIComponent(path.relative(config.dataDir, photo.filePath).replaceAll("\\", "/"))}`
    }))
  }));
}
