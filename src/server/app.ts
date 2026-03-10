import express from "express";
import fs from "fs/promises";
import path from "path";
import multer from "multer";
import { config } from "./config";
import { ProductRepository } from "./storage/product-repository";
import { PromptService } from "./services/prompt-service";
import { InputScannerService } from "./services/input-scanner-service";
import { ProductService } from "./services/product-service";
import { FalSeedreamImageProvider } from "./providers/fal-seedream-image-provider";
import { JobRunner } from "./jobs/job-runner";
import { BootstrapService } from "./services/bootstrap-service";
import { ApiController } from "./controllers/api-controller";
import { PageController } from "./controllers/page-controller";
import { createRouter } from "./routes";
import { logger } from "./utils/logger";
import { BatchPromptConfigService } from "./services/batch-prompt-config-service";
import { BatchUploadService } from "./services/batch-upload-service";
import { BatchHistoryService } from "./services/batch-history-service";
import { sqliteDatabase } from "./storage/sqlite-database";
import { RuntimeStateRepository } from "./storage/runtime-state-repository";
import { BatchRepository } from "./storage/batch-repository";
import { LegacyJsonMigrationService } from "./services/legacy-json-migration-service";
import { JobRepository } from "./storage/job-repository";

async function main(): Promise<void> {
  sqliteDatabase.initialize();
  const runtimeStateRepository = new RuntimeStateRepository();
  const batchRepository = new BatchRepository();
  const jobRepository = new JobRepository();
  const repository = new ProductRepository(runtimeStateRepository);
  const scanner = new InputScannerService(repository, runtimeStateRepository);
  const promptService = new PromptService();
  const batchPromptConfigService = new BatchPromptConfigService(batchRepository, runtimeStateRepository);
  const batchHistoryService = new BatchHistoryService(batchRepository, repository, runtimeStateRepository);
  const legacyJsonMigrationService = new LegacyJsonMigrationService(batchRepository, repository, runtimeStateRepository);
  const provider = new FalSeedreamImageProvider();
  const productService = new ProductService(
    repository,
    scanner,
    promptService,
    provider,
    batchPromptConfigService,
    batchHistoryService,
    jobRepository,
    runtimeStateRepository
  );
  const jobRunner = new JobRunner(productService, runtimeStateRepository, jobRepository, config.maxConcurrency);
  const bootstrapService = new BootstrapService(scanner, repository, productService, jobRunner);
  const batchUploadService = new BatchUploadService();
  const apiController = new ApiController(productService, bootstrapService, jobRunner, batchUploadService);
  const pageController = new PageController(productService);

  await legacyJsonMigrationService.migrateIfNeeded();
  batchRepository.ensureDefaultClients([
    {
      clientId: "barbie",
      name: "Barbie",
      notes: "Cuenta base para catalogos de Barbie."
    },
    {
      clientId: "under-armour",
      name: "Under Armour",
      notes: "Cuenta base para catalogos y batches de Under Armour."
    }
  ]);
  jobRunner.recoverRunningJobs();

  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 200 } });
  const wizardUploadMiddleware = upload.fields([
    { name: "garmentFiles", maxCount: 200 },
    { name: "modelFiles", maxCount: 50 },
    { name: "poseFiles", maxCount: 20 }
  ]);
  app.set("view engine", "ejs");
  app.set("views", path.join(process.cwd(), "src", "client", "views"));
  app.use(express.json({ limit: "10mb" }));
  app.use("/assets", express.static(path.join(process.cwd(), "src", "client", "public")));
  app.get("/favicon.ico", (_request, response) => {
    response.status(204).end();
  });
  app.get("/files", async (request, response, next) => {
    try {
      const relativePath = typeof request.query.path === "string" ? request.query.path : "";
      const normalizedRelative = relativePath.replaceAll("/", path.sep);
      const fullPath = path.resolve(config.dataDir, normalizedRelative);
      if (!fullPath.startsWith(config.dataDir)) {
        response.status(400).send("Invalid file path.");
        return;
      }
      try {
        await fs.access(fullPath);
      } catch {
        response.status(404).send("File not found.");
        return;
      }
      response.sendFile(fullPath);
    } catch (error) {
      next(error);
    }
  });
  app.use(createRouter(apiController, pageController, wizardUploadMiddleware));

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    logger.error("Unhandled application error.", error);
    response.status(500).json({ error: error instanceof Error ? error.message : "Unexpected server error" });
  });

  app.listen(config.port, () => {
    logger.info(`Server listening on http://localhost:${config.port}`);
  });
}

void main().catch((error) => {
  logger.error("Fatal startup error.", error);
  process.exitCode = 1;
});
