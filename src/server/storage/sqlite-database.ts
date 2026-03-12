import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { paths } from "../config";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS batches (
  batch_id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(client_id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  current_product_id TEXT,
  snapshot_count INTEGER NOT NULL DEFAULT 0,
  input_root TEXT NOT NULL,
  jobs_root TEXT NOT NULL,
  output_root TEXT NOT NULL,
  approved_root TEXT NOT NULL,
  state_root TEXT NOT NULL,
  notes TEXT,
  last_error TEXT,
  count_products INTEGER NOT NULL DEFAULT 0,
  count_generating INTEGER NOT NULL DEFAULT 0,
  count_in_review INTEGER NOT NULL DEFAULT 0,
  count_approved INTEGER NOT NULL DEFAULT 0,
  count_error INTEGER NOT NULL DEFAULT 0,
  count_outputs INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS batch_prompt_configs (
  batch_id TEXT PRIMARY KEY REFERENCES batches(batch_id) ON DELETE CASCADE,
  system_prompt TEXT NOT NULL,
  general_prompt TEXT NOT NULL,
  pose_prompts_json TEXT NOT NULL,
  background_config_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS batch_pose_prompts (
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
  pose_id TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  PRIMARY KEY (batch_id, pose_id)
);

CREATE TABLE IF NOT EXISTS batch_provider_settings (
  batch_id TEXT PRIMARY KEY REFERENCES batches(batch_id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  image_size_type TEXT NOT NULL,
  image_size_preset TEXT,
  image_width INTEGER,
  image_height INTEGER,
  seed INTEGER,
  sync_mode INTEGER NOT NULL DEFAULT 0,
  enable_safety_checker INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS batch_model_selection (
  batch_id TEXT PRIMARY KEY REFERENCES batches(batch_id) ON DELETE CASCADE,
  model_id TEXT NOT NULL REFERENCES models(model_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS batch_model_selection_photos (
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL REFERENCES model_photos(photo_id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, photo_id)
);

CREATE TABLE IF NOT EXISTS batch_events (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  message TEXT NOT NULL,
  product_id TEXT,
  pose_id TEXT,
  meta_json TEXT
);

CREATE TABLE IF NOT EXISTS products (
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  sku TEXT,
  garment_images_json TEXT NOT NULL,
  selected_model TEXT NOT NULL,
  prompt_general_override TEXT NOT NULL DEFAULT '',
  prompt_pose_overrides_json TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_error TEXT,
  PRIMARY KEY (batch_id, product_id)
);

CREATE TABLE IF NOT EXISTS product_garment_images (
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, product_id, file_path),
  FOREIGN KEY (batch_id, product_id) REFERENCES products(batch_id, product_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_pose_prompt_overrides (
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  pose_id TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  PRIMARY KEY (batch_id, product_id, pose_id),
  FOREIGN KEY (batch_id, product_id) REFERENCES products(batch_id, product_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_poses (
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  pose_id TEXT NOT NULL,
  variant_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  regenerate_count INTEGER NOT NULL DEFAULT 0,
  provider_model_id TEXT NOT NULL DEFAULT '',
  last_error TEXT,
  prompt_override TEXT NOT NULL DEFAULT '',
  last_prompt_used TEXT NOT NULL DEFAULT '',
  prompt_preview TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (batch_id, product_id, pose_id),
  FOREIGN KEY (batch_id, product_id) REFERENCES products(batch_id, product_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS outputs (
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
  output_id TEXT NOT NULL,
  usage_id TEXT,
  product_id TEXT NOT NULL,
  pose_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  variant_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  metadata_path TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  metadata_json TEXT,
  PRIMARY KEY (batch_id, output_id),
  FOREIGN KEY (batch_id, product_id) REFERENCES products(batch_id, product_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS approvals (
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  pose_id TEXT NOT NULL,
  output_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, product_id, pose_id, output_id),
  FOREIGN KEY (batch_id, output_id) REFERENCES outputs(batch_id, output_id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id, product_id) REFERENCES products(batch_id, product_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS prompt_history (
  entry_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  pose_id TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt TEXT NOT NULL,
  final_prompt TEXT NOT NULL,
  provider_model_id TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id, product_id) REFERENCES products(batch_id, product_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bootstrap_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at TEXT,
  finished_at TEXT,
  status TEXT NOT NULL,
  last_error TEXT,
  pending_jobs INTEGER NOT NULL DEFAULT 0,
  running_jobs INTEGER NOT NULL DEFAULT 0,
  completed_jobs INTEGER NOT NULL DEFAULT 0,
  total_products INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS active_batch_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  batch_id TEXT REFERENCES batches(batch_id) ON DELETE SET NULL,
  session_root TEXT NOT NULL,
  staged_input_root TEXT NOT NULL,
  started_at TEXT NOT NULL,
  snapshot_count INTEGER NOT NULL DEFAULT 0,
  last_saved_at TEXT
);

CREATE TABLE IF NOT EXISTS batch_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  root_path TEXT NOT NULL,
  input_path TEXT NOT NULL,
  output_path TEXT NOT NULL,
  approved_path TEXT NOT NULL,
  jobs_path TEXT NOT NULL,
  state_path TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  pose_id TEXT NOT NULL,
  pose_label TEXT NOT NULL,
  pose_file_path TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  last_error TEXT,
  FOREIGN KEY (batch_id, product_id) REFERENCES products(batch_id, product_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS job_attempts (
  attempt_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  pose_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS runtime_state (
  state_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  client_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  model_id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(client_id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  age_group TEXT,
  gender TEXT NOT NULL,
  includes_full_body INTEGER NOT NULL DEFAULT 0,
  includes_face INTEGER NOT NULL DEFAULT 1,
  includes_hands INTEGER NOT NULL DEFAULT 0,
  includes_feet INTEGER NOT NULL DEFAULT 0,
  includes_swimwear INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_photos (
  photo_id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(model_id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  event_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(client_id) ON DELETE SET NULL,
  product_id TEXT,
  pose_id TEXT,
  category TEXT,
  provider TEXT,
  provider_model_id TEXT,
  event_type TEXT NOT NULL,
  event_source TEXT,
  request_id TEXT,
  timestamp TEXT NOT NULL,
  duration_ms INTEGER,
  cost_estimate REAL,
  provider_reported_cost REAL,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS cost_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_model_id TEXT NOT NULL,
  size_tier TEXT NOT NULL,
  unit_cost REAL NOT NULL,
  currency TEXT NOT NULL,
  unit_label TEXT NOT NULL,
  source TEXT NOT NULL,
  notes TEXT,
  effective_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_usage (
  usage_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(client_id) ON DELETE SET NULL,
  product_id TEXT NOT NULL,
  pose_id TEXT NOT NULL,
  category TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_model_id TEXT NOT NULL,
  request_id TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt TEXT NOT NULL,
  final_prompt TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  prompt_excerpt TEXT NOT NULL,
  image_size_label TEXT NOT NULL,
  seed INTEGER,
  sync_mode INTEGER NOT NULL DEFAULT 0,
  enable_safety_checker INTEGER NOT NULL DEFAULT 1,
  background_mode TEXT,
  selected_model_id TEXT,
  source_photo_id TEXT,
  selected_photo_ids_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  output_count INTEGER NOT NULL DEFAULT 0,
  cost_snapshot_key TEXT REFERENCES cost_snapshots(snapshot_key) ON DELETE SET NULL,
  cost_estimate REAL NOT NULL DEFAULT 0,
  provider_reported_cost REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  approved_at TEXT,
  error_message TEXT,
  metadata_json TEXT,
  FOREIGN KEY (batch_id, product_id) REFERENCES products(batch_id, product_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_analytics_rollups (
  rollup_key TEXT PRIMARY KEY,
  rollup_date TEXT NOT NULL,
  client_id TEXT,
  provider_model_id TEXT,
  generations INTEGER NOT NULL DEFAULT 0,
  regenerations INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  approvals INTEGER NOT NULL DEFAULT 0,
  cost_estimate_total REAL NOT NULL DEFAULT 0,
  provider_reported_cost_total REAL NOT NULL DEFAULT 0,
  avg_duration_ms REAL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_effectiveness (
  prompt_hash TEXT PRIMARY KEY,
  prompt_excerpt TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  regeneration_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  approval_count INTEGER NOT NULL DEFAULT 0,
  avg_duration_ms REAL,
  avg_approval_latency_ms REAL,
  total_estimated_cost REAL NOT NULL DEFAULT 0,
  last_used_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_timestamp ON analytics_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_batch ON analytics_events(batch_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_generation_usage_started ON generation_usage(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_usage_batch ON generation_usage(batch_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_usage_client ON generation_usage(client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_usage_model ON generation_usage(provider_model_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_usage_category ON generation_usage(category, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_usage_status ON generation_usage(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_usage_prompt_hash ON generation_usage(prompt_hash, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_snapshots_model_tier ON cost_snapshots(provider_model_id, size_tier);
`;

const CURRENT_USER_VERSION = 6;

export class SqliteDatabase {
  private db: Database.Database | null = null;

  get connection(): Database.Database {
    if (!this.db) {
      this.initialize();
    }
    if (!this.db) {
      throw new Error("SQLite database is not available.");
    }
    return this.db;
  }

  initialize(): void {
    if (this.db) {
      return;
    }

    fs.mkdirSync(path.dirname(paths.databaseFile), { recursive: true });
    const db = new Database(paths.databaseFile);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
    migrateSchemaIfNeeded(db);
    this.db = db;
  }
}

export const sqliteDatabase = new SqliteDatabase();

function migrateSchemaIfNeeded(db: Database.Database): void {
  const currentVersion = Number(db.pragma("user_version", { simple: true }) ?? 0);
  const outputsInfo = db.pragma("table_info(outputs)") as Array<{ name: string; pk: number }>;
  const outputsUsesLegacyPrimaryKey = outputsInfo.some((column) => column.name === "output_id" && column.pk === 1)
    && !outputsInfo.some((column) => column.name === "batch_id" && column.pk > 0);
  const batchColumns = db.pragma("table_info(batches)") as Array<{ name: string }>;
  const hasBatchClientId = batchColumns.some((column) => column.name === "client_id");
  const batchPromptColumns = db.pragma("table_info(batch_prompt_configs)") as Array<{ name: string }>;
  const hasBackgroundConfigJson = batchPromptColumns.some((column) => column.name === "background_config_json");
  const modelColumns = db.pragma("table_info(models)") as Array<{ name: string }>;
  const hasLegacyModelAge = modelColumns.some((column) => column.name === "age");
  const hasModelAgeGroup = modelColumns.some((column) => column.name === "age_group");
  const hasModelSwimwear = modelColumns.some((column) => column.name === "includes_swimwear");
  const poseColumns = db.pragma("table_info(product_poses)") as Array<{ name: string }>;
  const hasPoseProviderModelId = poseColumns.some((column) => column.name === "provider_model_id");
  const outputColumns = db.pragma("table_info(outputs)") as Array<{ name: string }>;
  const hasOutputUsageId = outputColumns.some((column) => column.name === "usage_id");

  if (
    currentVersion >= CURRENT_USER_VERSION
    && !outputsUsesLegacyPrimaryKey
    && hasBatchClientId
    && hasBackgroundConfigJson
    && hasModelAgeGroup
    && hasModelSwimwear
    && hasPoseProviderModelId
    && hasOutputUsageId
  ) {
    return;
  }

  db.pragma("foreign_keys = OFF");
  const transaction = db.transaction(() => {
    if (outputsUsesLegacyPrimaryKey) {
      db.exec(`
        CREATE TABLE outputs_new (
          batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
          output_id TEXT NOT NULL,
          product_id TEXT NOT NULL,
          pose_id TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          variant_key TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_path TEXT NOT NULL,
          metadata_path TEXT NOT NULL,
          status TEXT NOT NULL,
          error TEXT,
          metadata_json TEXT,
          PRIMARY KEY (batch_id, output_id),
          FOREIGN KEY (batch_id, product_id) REFERENCES products(batch_id, product_id) ON DELETE CASCADE
        );

        INSERT OR IGNORE INTO outputs_new (
          batch_id, output_id, product_id, pose_id, sort_order, variant_key, file_name, file_path, metadata_path, status, error, metadata_json
        )
        SELECT
          batch_id, output_id, product_id, pose_id, sort_order, variant_key, file_name, file_path, metadata_path, status, error, metadata_json
        FROM outputs;

        CREATE TABLE approvals_new (
          batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
          product_id TEXT NOT NULL,
          pose_id TEXT NOT NULL,
          output_id TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (batch_id, product_id, pose_id, output_id),
          FOREIGN KEY (batch_id, output_id) REFERENCES outputs_new(batch_id, output_id) ON DELETE CASCADE,
          FOREIGN KEY (batch_id, product_id) REFERENCES products(batch_id, product_id) ON DELETE CASCADE
        );

        INSERT OR IGNORE INTO approvals_new (
          batch_id, product_id, pose_id, output_id, sort_order
        )
        SELECT
          batch_id, product_id, pose_id, output_id, sort_order
        FROM approvals;

        DROP TABLE approvals;
        DROP TABLE outputs;
        ALTER TABLE outputs_new RENAME TO outputs;
        ALTER TABLE approvals_new RENAME TO approvals;
      `);
    }

    if (!hasBatchClientId) {
      db.exec(`
        ALTER TABLE batches ADD COLUMN client_id TEXT REFERENCES clients(client_id) ON DELETE SET NULL;
      `);
    }

    if (!hasBackgroundConfigJson) {
      db.exec(`
        ALTER TABLE batch_prompt_configs ADD COLUMN background_config_json TEXT NOT NULL DEFAULT '{}';
      `);
    }

    if (!hasModelAgeGroup) {
      db.exec(`
        ALTER TABLE models ADD COLUMN age_group TEXT;
      `);
    }

    if (!hasModelSwimwear) {
      db.exec(`
        ALTER TABLE models ADD COLUMN includes_swimwear INTEGER NOT NULL DEFAULT 0;
      `);
    }

    if (!hasPoseProviderModelId) {
      db.exec(`
        ALTER TABLE product_poses ADD COLUMN provider_model_id TEXT NOT NULL DEFAULT '';
      `);
    }

    if (!hasOutputUsageId) {
      db.exec(`
        ALTER TABLE outputs ADD COLUMN usage_id TEXT;
      `);
    }

    if (hasLegacyModelAge) {
      db.exec(`
        UPDATE models
        SET age_group = CASE
          WHEN age IS NULL THEN NULL
          WHEN age <= 12 THEN 'nino'
          WHEN age <= 17 THEN 'adolescente'
          WHEN age <= 29 THEN 'adulto_joven'
          WHEN age <= 59 THEN 'adulto'
          WHEN age <= 74 THEN 'jubilado'
          ELSE 'anciano'
        END
        WHERE age_group IS NULL AND age IS NOT NULL;
      `);
    }

    db.exec(`
      INSERT OR IGNORE INTO batch_pose_prompts (batch_id, pose_id, prompt_text)
      SELECT
        batch_prompt_configs.batch_id,
        json_each.key,
        json_each.value
      FROM batch_prompt_configs, json_each(batch_prompt_configs.pose_prompts_json)
      WHERE json_each.value IS NOT NULL AND TRIM(CAST(json_each.value AS TEXT)) != '';

      INSERT OR IGNORE INTO product_garment_images (batch_id, product_id, file_path, sort_order)
      SELECT
        products.batch_id,
        products.product_id,
        json_each.value,
        CAST(json_each.key AS INTEGER)
      FROM products, json_each(products.garment_images_json)
      WHERE json_each.value IS NOT NULL AND TRIM(CAST(json_each.value AS TEXT)) != '';

      INSERT OR IGNORE INTO product_pose_prompt_overrides (batch_id, product_id, pose_id, prompt_text)
      SELECT
        products.batch_id,
        products.product_id,
        json_each.key,
        json_each.value
      FROM products, json_each(products.prompt_pose_overrides_json)
      WHERE json_each.value IS NOT NULL AND TRIM(CAST(json_each.value AS TEXT)) != '';
    `);

    db.pragma(`user_version = ${CURRENT_USER_VERSION}`);
  });

  transaction();
  db.pragma("foreign_keys = ON");
}
