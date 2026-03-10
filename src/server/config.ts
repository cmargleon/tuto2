import dotenv from "dotenv";
import path from "path";

dotenv.config();

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric env var ${name}: ${raw}`);
  }
  return parsed;
}

function resolveDir(input: string): string {
  return path.resolve(process.cwd(), input);
}

function readList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  return values.length > 0 ? Array.from(new Set(values)) : fallback;
}

export const config = {
  port: readNumber("PORT", 3000),
  dataDir: resolveDir(process.env.DATA_DIR ?? "./data"),
  maxConcurrency: readNumber("MAX_CONCURRENCY", 2),
  requestTimeoutMs: readNumber("REQUEST_TIMEOUT_MS", 120000),
  retryCount: readNumber("RETRY_COUNT", 2),
  defaultCategory: process.env.DEFAULT_CATEGORY ?? "parte_alta",
  falKey: process.env.FAL_KEY ?? "",
  falModel: process.env.FAL_MODEL ?? "fal-ai/bytedance/seedream/v4.5/edit"
};

export const falModelOptions = readList("FAL_MODEL_OPTIONS", [
  "fal-ai/bytedance/seedream/v4.5/edit",
  "fal-ai/nano-banana/edit",
  "fal-ai/gemini-3.1-flash-image-preview/edit"
]);

export const paths = {
  databaseFile: path.join(config.dataDir, "app.db"),
  inputRoot: path.join(config.dataDir, "input"),
  garmentsDir: path.join(config.dataDir, "input", "garments"),
  modelsDir: path.join(config.dataDir, "input", "models"),
  posesDir: path.join(config.dataDir, "input", "poses"),
  batchesDir: path.join(config.dataDir, "batches"),
  archiveDir: path.join(config.dataDir, "archive"),
  jobsDir: path.join(config.dataDir, "jobs"),
  outputDir: path.join(config.dataDir, "output"),
  approvedDir: path.join(config.dataDir, "approved"),
  stateDir: path.join(config.dataDir, "state"),
  bootstrapStateFile: path.join(config.dataDir, "state", "bootstrap-state.json"),
  activeBatchFile: path.join(config.dataDir, "state", "active-batch.json"),
  promptConfigFile: path.join(config.dataDir, "state", "prompt-config.json"),
  savedBatchesDir: path.join(config.dataDir, "archive", "saved-batches"),
  batchRegistryFile: path.join(config.dataDir, "batches", "registry.json")
};
