import fs from "fs/promises";
import path from "path";
import type { BatchPromptConfig } from "../../shared/types";
import { clearDirectory, ensureDir, sanitizeId } from "../utils/fs-helpers";

export interface UploadedFilePayload {
  buffer: Buffer;
  originalName: string;
  relativePath?: string;
}

export interface BatchUploadPayload {
  garments: UploadedFilePayload[];
  models: UploadedFilePayload[];
  poses: UploadedFilePayload[];
  promptConfig: BatchPromptConfig;
}

export class BatchUploadService {
  async replaceInputBatch(inputRoot: string, payload: BatchUploadPayload): Promise<void> {
    if (payload.garments.length === 0) {
      throw new Error("Debes cargar al menos una imagen o carpeta de productos.");
    }
    if (payload.models.length === 0) {
      throw new Error("Debes cargar al menos una imagen de modelo.");
    }
    if (payload.poses.length < 4) {
      throw new Error("Debes cargar 4 imagenes de pose.");
    }

    const garmentsDir = path.join(inputRoot, "garments");
    const modelsDir = path.join(inputRoot, "models");
    const posesDir = path.join(inputRoot, "poses");

    await Promise.all([
      clearDirectory(garmentsDir),
      clearDirectory(modelsDir),
      clearDirectory(posesDir)
    ]);

    await Promise.all([
      this.writeGarments(garmentsDir, payload.garments),
      this.writeFlatFiles(modelsDir, payload.models),
      this.writePoses(posesDir, payload.poses.slice(0, 4))
    ]);
  }

  private async writeGarments(targetRoot: string, files: UploadedFilePayload[]): Promise<void> {
    const groupingContext = buildGarmentGroupingContext(files);
    const singleImages = files.filter((file) => !resolveGarmentGroup(file.relativePath, groupingContext));
    const grouped = new Map<string, UploadedFilePayload[]>();

    for (const file of files) {
      const folderHint = resolveGarmentGroup(file.relativePath, groupingContext);
      if (!folderHint) {
        continue;
      }
      const key = sanitizeId(folderHint);
      const bucket = grouped.get(key) ?? [];
      bucket.push(file);
      grouped.set(key, bucket);
    }

    await Promise.all(Array.from(grouped.entries()).map(async ([folderId, groupedFiles]) => {
      const targetDir = path.join(targetRoot, folderId);
      await ensureDir(targetDir);
      await Promise.all(groupedFiles.map((file) => {
        const targetPath = path.join(targetDir, sanitizeFileName(path.basename(file.originalName)));
        return fs.writeFile(targetPath, file.buffer);
      }));
    }));

    await Promise.all(singleImages.map(async (file) => {
      const baseName = sanitizeId(path.parse(file.originalName).name) || `product-${Date.now()}`;
      const targetPath = path.join(targetRoot, `${baseName}${normalizeExtension(file.originalName)}`);
      await fs.writeFile(targetPath, file.buffer);
    }));
  }

  private async writeFlatFiles(targetDir: string, files: UploadedFilePayload[]): Promise<void> {
    await ensureDir(targetDir);
    await Promise.all(files.map(async (file, index) => {
      const baseName = sanitizeId(path.parse(file.originalName).name) || `file-${index + 1}`;
      const targetPath = path.join(targetDir, `${baseName}${normalizeExtension(file.originalName)}`);
      await fs.writeFile(targetPath, file.buffer);
    }));
  }

  private async writePoses(targetDir: string, files: UploadedFilePayload[]): Promise<void> {
    await ensureDir(targetDir);
    await Promise.all(files.map(async (file, index) => {
      const targetPath = path.join(targetDir, `pose-${index + 1}${normalizeExtension(file.originalName)}`);
      await fs.writeFile(targetPath, file.buffer);
    }));
  }
}

function buildGarmentGroupingContext(files: UploadedFilePayload[]): { firstSegments: Set<string>; maxDepth: number } {
  const firstSegments = new Set<string>();
  let maxDepth = 0;
  for (const file of files) {
    if (!file.relativePath) {
      continue;
    }
    const parts = file.relativePath.replaceAll("\\", "/").split("/").filter(Boolean);
    if (parts.length > 1) {
      firstSegments.add(parts[0] ?? "");
      maxDepth = Math.max(maxDepth, parts.length);
    }
  }
  return { firstSegments, maxDepth };
}

function resolveGarmentGroup(
  relativePath: string | undefined,
  context: { firstSegments: Set<string>; maxDepth: number }
): string | null {
  if (!relativePath) {
    return null;
  }
  const normalized = relativePath.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return null;
  }
  if (context.firstSegments.size === 1 && context.maxDepth >= 3) {
    return parts[1] ?? null;
  }
  return parts[0] ?? null;
}

function normalizeExtension(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return ext || ".jpg";
}

function sanitizeFileName(fileName: string): string {
  const ext = normalizeExtension(fileName);
  const base = sanitizeId(path.parse(fileName).name) || "image";
  return `${base}${ext}`;
}
