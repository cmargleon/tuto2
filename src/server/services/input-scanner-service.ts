import fs from "fs/promises";
import path from "path";
import type { PoseInput, ProductManifest, ProductPoseState } from "../../shared/types";
import { paths } from "../config";
import { readOptionalProductMetadata, classifyCategory } from "./category-service";
import { getPoseTemplates } from "./pose-config";
import { ProductRepository } from "../storage/product-repository";
import { RuntimeStateRepository } from "../storage/runtime-state-repository";
import { BatchRepository } from "../storage/batch-repository";
import { clearDirectory, ensureDir, listDirectories, listImageFiles, sanitizeId } from "../utils/fs-helpers";

interface ProductCandidate {
  productId: string;
  sourceName: string;
  garmentImages: string[];
  productRoot: string;
}

export class InputScannerService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly runtimeStateRepository: RuntimeStateRepository,
    private readonly batchRepository: BatchRepository
  ) {}

  async ensureStructure(): Promise<void> {
    await Promise.all([
      ensureDir(paths.garmentsDir),
      ensureDir(paths.posesDir),
      ensureDir(paths.archiveDir),
      ensureDir(paths.jobsDir),
      ensureDir(paths.outputDir),
      ensureDir(paths.approvedDir),
      ensureDir(paths.stateDir)
    ]);
  }

  async prepareFreshRun(): Promise<void> {
    await this.ensureStructure();
    const activeBatch = this.runtimeStateRepository.getActiveBatchState();
    await Promise.all([
      clearDirectory(paths.jobsDir),
      clearDirectory(paths.outputDir),
      clearDirectory(paths.approvedDir),
      clearDirectory(paths.stateDir, [".gitkeep", "sample-job.manifest.json", "prompt-config.example.json"]),
      activeBatch ? clearDirectory(path.join(activeBatch.sessionRoot, "output")) : Promise.resolve(),
      activeBatch ? clearDirectory(path.join(activeBatch.sessionRoot, "approved")) : Promise.resolve(),
      activeBatch ? clearDirectory(path.join(activeBatch.sessionRoot, "jobs")) : Promise.resolve(),
      activeBatch ? clearDirectory(path.join(activeBatch.sessionRoot, "state")) : Promise.resolve()
    ]);
  }

  getActiveBatchInfo(): { batchId: string; sessionRoot: string; stagedInputRoot: string } {
    const activeBatch = this.runtimeStateRepository.getActiveBatchState();
    if (!activeBatch) {
      throw new Error("No active batch available.");
    }
    return {
      batchId: activeBatch.batchId,
      sessionRoot: activeBatch.sessionRoot,
      stagedInputRoot: activeBatch.stagedInputRoot
    };
  }

  async loadPoses(): Promise<PoseInput[]> {
    const { batchId } = this.getActiveBatchInfo();
    const selection = this.batchRepository.getBatchModelSelection(batchId);
    if (!selection || selection.selectedPhotoIds.length !== 4) {
      throw new Error("Expected exactly 4 selected model photos to derive poses for the batch.");
    }
    const model = this.batchRepository.getModel(selection.modelId);
    if (!model) {
      throw new Error(`Model not found for batch pose derivation: ${selection.modelId}.`);
    }
    const photosById = new Map(model.photos.map((photo) => [photo.photoId, photo.filePath]));
    const poseFiles = selection.selectedPhotoIds
      .map((photoId) => photosById.get(photoId))
      .filter((filePath): filePath is string => Boolean(filePath));
    if (poseFiles.length !== 4) {
      throw new Error("The selected model photos could not be resolved into 4 pose references.");
    }
    return poseFiles.map((filePath, index) => ({
      poseId: `pose${index + 1}`,
      label: `Pose ${index + 1}`,
      filePath,
      description: path.basename(filePath)
    }));
  }

  async syncProducts(): Promise<ProductManifest[]> {
    await this.ensureStructure();
    const { garmentsDir } = this.getInputDirs();
    const batchId = this.getActiveBatchInfo().batchId;
    const candidates = await this.discoverProducts(garmentsDir);
    const existing = await this.repository.listProducts(batchId);
    const existingMap = new Map(existing.map((item) => [item.productId, item]));
    const candidateIds = new Set(candidates.map((item) => item.productId));
    const synced: ProductManifest[] = [];

    await Promise.all(
      existing
        .filter((item) => !candidateIds.has(item.productId))
        .map((item) => this.repository.deleteProduct(item.productId, batchId))
    );

    for (const candidate of candidates) {
      const metadata = await readOptionalProductMetadata(candidate.productRoot);
      const current = existingMap.get(candidate.productId);
      const category = current?.category ?? classifyCategory(candidate.sourceName, metadata);
      const poses = mergePoseState(current?.poses, category);
      const manifest: ProductManifest = {
        productId: candidate.productId,
        sourceName: candidate.sourceName,
        sku: metadata?.sku,
        garmentImages: candidate.garmentImages,
        promptOverrides: current?.promptOverrides ?? {
          generalPrompt: "",
          posePrompts: {}
        },
        category,
        poses,
        outputs: current?.outputs ?? [],
        approved: current?.approved ?? {},
        status: current?.status ?? "pending",
        createdAt: current?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastError: current?.lastError
      };

      await this.repository.saveProduct(manifest, batchId);
      synced.push(manifest);
    }

    return synced.sort((a, b) => a.productId.localeCompare(b.productId));
  }

  private async discoverProducts(garmentsDir: string): Promise<ProductCandidate[]> {
    const garmentDirs = await listDirectories(garmentsDir);
    const topLevelImages = await listImageFiles(garmentsDir);
    const grouped: ProductCandidate[] = [];

    // Each garment folder is a single product. Every image inside that folder
    // becomes a garment reference that will be sent to the provider together.
    for (const directory of garmentDirs) {
      const garmentImages = await listImageFiles(directory);
      if (garmentImages.length === 0) {
        continue;
      }
      grouped.push({
        productId: sanitizeId(path.basename(directory)),
        sourceName: path.basename(directory),
        garmentImages,
        productRoot: directory
      });
    }

    for (const filePath of topLevelImages) {
      const baseName = path.parse(filePath).name;
      grouped.push({
        productId: sanitizeId(baseName),
        sourceName: baseName,
        garmentImages: [filePath],
        productRoot: garmentsDir
      });
    }

    if (grouped.length === 0) {
      const entries = await fs.readdir(garmentsDir, { withFileTypes: true });
      if (entries.length === 0) {
        throw new Error(`No garment inputs found in ${garmentsDir}.`);
      }
    }

    return grouped;
  }

  private getInputDirs(): { garmentsDir: string; posesDir: string } {
    const activeBatch = this.runtimeStateRepository.getActiveBatchState();
    if (activeBatch?.stagedInputRoot) {
      return {
        garmentsDir: path.join(activeBatch.stagedInputRoot, "garments"),
        posesDir: path.join(activeBatch.stagedInputRoot, "poses")
      };
    }

    return {
      garmentsDir: paths.garmentsDir,
      posesDir: paths.posesDir
    };
  }

}

function mergePoseState(current: ProductPoseState[] | undefined, category: ProductManifest["category"]): ProductPoseState[] {
  const currentMap = new Map((current ?? []).map((pose) => [pose.poseId, pose]));
  return getPoseTemplates(category).map((template) => ({
    poseId: template.poseId,
    variantCount: 1,
    status: currentMap.get(template.poseId)?.status ?? "pending",
    regenerateCount: currentMap.get(template.poseId)?.regenerateCount ?? 0,
    lastError: currentMap.get(template.poseId)?.lastError,
    promptOverride: currentMap.get(template.poseId)?.promptOverride ?? "",
    lastPromptUsed: currentMap.get(template.poseId)?.lastPromptUsed ?? "",
    promptPreview: currentMap.get(template.poseId)?.promptPreview ?? ""
  }));
}
