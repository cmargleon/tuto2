import express from "express";
import { ApiController } from "../controllers/api-controller";
import { PageController } from "../controllers/page-controller";

export function createRouter(
  apiController: ApiController,
  pageController: PageController,
  wizardUploadMiddleware: express.RequestHandler
): express.Router {
  const router = express.Router();

  router.get("/", pageController.home);
  router.get("/home", pageController.reviewHome);
  router.get("/generate-images", pageController.generateImages);
  router.get("/batches", pageController.batches);
  router.get("/batches/:id", pageController.batchDetail);
  router.get("/clients", pageController.clients);
  router.get("/review/:id", pageController.review);

  router.get("/api/products", apiController.getProducts);
  router.get("/api/batches", apiController.getBatches);
  router.get("/api/models", apiController.getModels);
  router.get("/api/product/:id", apiController.getProduct);
  router.get("/api/status", apiController.getStatus);
  router.get("/api/bootstrap", apiController.getBootstrap);
  router.post("/api/clients", apiController.createClient);
  router.post("/api/wizard/setup", wizardUploadMiddleware, apiController.setupBatch);
  router.post("/api/batch/save-state", apiController.saveBatch);
  router.post("/api/batches/:id/open", apiController.openBatch);
  router.post("/api/batches/:id/continue", apiController.continueBatch);
  router.post("/api/batches/:id/archive", apiController.archiveBatch);
  router.post("/api/batches/:id/duplicate", apiController.duplicateBatch);
  router.post("/api/batches/:id/delete", apiController.deleteBatch);
  router.post("/api/product/:id/approve", apiController.approve);
  router.post("/api/product/:id/finalize-approval", apiController.finalizeApproval);
  router.post("/api/product/:id/regenerate/:poseId", apiController.regenerate);
  router.post("/api/product/:id/change-model", apiController.changeModel);

  return router;
}
