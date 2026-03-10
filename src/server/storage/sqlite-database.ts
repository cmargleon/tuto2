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
  pose_prompts_json TEXT NOT NULL
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
`;

const CURRENT_USER_VERSION = 2;

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

  if (currentVersion >= CURRENT_USER_VERSION && !outputsUsesLegacyPrimaryKey && hasBatchClientId) {
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
