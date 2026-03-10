import fs from "fs/promises";
import path from "path";
import type { PoseInput, ProductManifest, ProductPoseState } from "../../shared/types";
import { paths } from "../config";
import { readOptionalProductMetadata, classifyCategory } from "./category-service";
import { getPoseTemplates } from "./pose-config";
import { ProductRepository } from "../storage/product-repository";
import { RuntimeStateRepository } from "../storage/runtime-state-repository";
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
    private readonly runtimeStateRepository: RuntimeStateRepository
  ) {}

  async ensureStructure(): Promise<void> {
    await Promise.all([
      ensureDir(paths.garmentsDir),
      ensureDir(paths.modelsDir),
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

  async loadModels(): Promise<string[]> {
    return listImageFiles(this.getInputDirs().modelsDir);
  }

  async loadPoses(): Promise<PoseInput[]> {
    const { posesDir } = this.getInputDirs();
    const poseFiles = await listImageFiles(posesDir);
    const firstFour = poseFiles.slice(0, 4);
    if (firstFour.length < 4) {
      throw new Error(`Expected 4 pose images in ${posesDir}, found ${firstFour.length}.`);
    }
    return firstFour.map((filePath, index) => ({
      poseId: `pose${index + 1}`,
      label: `Pose ${index + 1}`,
      filePath,
      description: path.basename(filePath)
    }));
  }

  async syncProducts(): Promise<ProductManifest[]> {
    await this.ensureStructure();
    const { garmentsDir, modelsDir } = this.getInputDirs();
    const models = await this.loadModels();
    if (models.length === 0) {
      throw new Error(`No model images found in ${modelsDir}.`);
    }
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
      const selectedModel = current?.selectedModel
        ?? pickDeterministicModel(models, candidate.productId);
      const poses = mergePoseState(current?.poses, category);
      const manifest: ProductManifest = {
        productId: candidate.productId,
        sourceName: candidate.sourceName,
        sku: metadata?.sku,
        garmentImages: candidate.garmentImages,
        selectedModel,
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

  private getInputDirs(): { garmentsDir: string; modelsDir: string; posesDir: string } {
    const activeBatch = this.runtimeStateRepository.getActiveBatchState();
    if (activeBatch?.stagedInputRoot) {
      return {
        garmentsDir: path.join(activeBatch.stagedInputRoot, "garments"),
        modelsDir: path.join(activeBatch.stagedInputRoot, "models"),
        posesDir: path.join(activeBatch.stagedInputRoot, "poses")
      };
    }

    return {
      garmentsDir: paths.garmentsDir,
      modelsDir: paths.modelsDir,
      posesDir: paths.posesDir
    };
  }

}

function pickDeterministicModel(models: string[], productId: string): string {
  let hash = 0;
  for (const char of productId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  const selected = models[hash % models.length];
  if (!selected) {
    throw new Error("Unable to select a model image.");
  }
  return selected;
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
