import path from "path";
import type {
  BatchModelSelection,
  BatchCounts,
  CatalogModel,
  CatalogModelPhoto,
  BatchEvent,
  BatchManifest,
  BatchPromptConfig,
  BatchSnapshot,
  BatchStatus,
  ClientRecord,
  FalCustomImageSize,
  FalImageSizePreset,
  FalProviderSettings
} from "../../shared/types";
import { sanitizeId } from "../utils/fs-helpers";
import { sqliteDatabase } from "./sqlite-database";

interface BatchRow {
  batchId: string;
  clientId?: string | null;
  clientName?: string | null;
  name: string;
  status: BatchStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  active: number;
  currentProductId?: string | null;
  snapshotCount: number;
  inputRoot: string;
  jobsRoot: string;
  outputRoot: string;
  approvedRoot: string;
  stateRoot: string;
  notes?: string;
  lastError?: string;
  countProducts: number;
  countGenerating: number;
  countInReview: number;
  countApproved: number;
  countError: number;
  countOutputs: number;
}

interface PromptRow {
  systemPrompt: string;
  generalPrompt: string;
  posePromptsJson: string;
  backgroundConfigJson: string;
  modelId: string;
  imageSizeType: string;
  imageSizePreset?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  seed?: number | null;
  syncMode: number;
  enableSafetyChecker: number;
}

interface ModelRow {
  modelId: string;
  clientId?: string | null;
  clientName?: string | null;
  name: string;
  ageGroup?: string | null;
  gender: CatalogModel["gender"];
  includesFullBody: number;
  includesFace: number;
  includesHands: number;
  includesFeet: number;
  includesSwimwear: number;
  createdAt: string;
  updatedAt: string;
}

interface ModelPhotoRow {
  photoId: string;
  modelId: string;
  filePath: string;
  sortOrder: number;
}

export class BatchRepository {
  private readonly db = sqliteDatabase.connection;

  listBatches(filters?: {
    status?: BatchStatus | "all";
    clientId?: string;
    search?: string;
  }): BatchManifest[] {
    const clauses: string[] = [];
    const params: Record<string, string> = {};

    if (filters?.status && filters.status !== "all") {
      clauses.push("batches.status = @status");
      params.status = filters.status;
    }

    if (filters?.clientId) {
      clauses.push("batches.client_id = @clientId");
      params.clientId = filters.clientId;
    }

    if (filters?.search) {
      clauses.push("(LOWER(batches.name) LIKE @search OR LOWER(COALESCE(clients.name, '')) LIKE @search OR LOWER(batches.batch_id) LIKE @search)");
      params.search = `%${filters.search.trim().toLowerCase()}%`;
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`
      SELECT
        batches.batch_id AS batchId,
        batches.client_id AS clientId,
        batches.name AS name,
        batches.status AS status,
        batches.created_at AS createdAt,
        batches.updated_at AS updatedAt,
        batches.archived_at AS archivedAt,
        batches.active AS active,
        batches.current_product_id AS currentProductId,
        batches.snapshot_count AS snapshotCount,
        batches.input_root AS inputRoot,
        batches.jobs_root AS jobsRoot,
        batches.output_root AS outputRoot,
        batches.approved_root AS approvedRoot,
        batches.state_root AS stateRoot,
        batches.notes AS notes,
        batches.last_error AS lastError,
        batches.count_products AS countProducts,
        batches.count_generating AS countGenerating,
        batches.count_in_review AS countInReview,
        batches.count_approved AS countApproved,
        batches.count_error AS countError,
        batches.count_outputs AS countOutputs,
        clients.name AS clientName
      FROM batches
      LEFT JOIN clients ON clients.client_id = batches.client_id
      ${whereClause}
      ORDER BY batches.created_at DESC
    `).all(params) as BatchRow[];

    return rows.map((row) => this.mapBatchRow(row));
  }

  getBatch(batchId: string): BatchManifest | null {
    const row = this.db.prepare(`
      SELECT
        batches.batch_id AS batchId,
        batches.client_id AS clientId,
        batches.name AS name,
        batches.status AS status,
        batches.created_at AS createdAt,
        batches.updated_at AS updatedAt,
        batches.archived_at AS archivedAt,
        batches.active AS active,
        batches.current_product_id AS currentProductId,
        batches.snapshot_count AS snapshotCount,
        batches.input_root AS inputRoot,
        batches.jobs_root AS jobsRoot,
        batches.output_root AS outputRoot,
        batches.approved_root AS approvedRoot,
        batches.state_root AS stateRoot,
        batches.notes AS notes,
        batches.last_error AS lastError,
        batches.count_products AS countProducts,
        batches.count_generating AS countGenerating,
        batches.count_in_review AS countInReview,
        batches.count_approved AS countApproved,
        batches.count_error AS countError,
        batches.count_outputs AS countOutputs,
        clients.name AS clientName
      FROM batches
      LEFT JOIN clients ON clients.client_id = batches.client_id
      WHERE batches.batch_id = ?
    `).get(batchId) as BatchRow | undefined;

    return row ? this.mapBatchRow(row) : null;
  }

  saveBatch(batch: BatchManifest): void {
    const promptConfig = batch.promptConfig;
    const providerSettings = promptConfig.providerSettings;
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO batches (
          batch_id, name, status, created_at, updated_at, archived_at, active, current_product_id,
          client_id,
          snapshot_count, input_root, jobs_root, output_root, approved_root, state_root, notes,
          last_error, count_products, count_generating, count_in_review, count_approved, count_error, count_outputs
        )
        VALUES (
          @batchId, @name, @status, @createdAt, @updatedAt, @archivedAt, @active, @currentProductId,
          @clientId,
          @snapshotCount, @inputRoot, @jobsRoot, @outputRoot, @approvedRoot, @stateRoot, @notes,
          @lastError, @countProducts, @countGenerating, @countInReview, @countApproved, @countError, @countOutputs
        )
        ON CONFLICT(batch_id) DO UPDATE SET
          name = excluded.name,
          status = excluded.status,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          archived_at = excluded.archived_at,
          active = excluded.active,
          current_product_id = excluded.current_product_id,
          client_id = excluded.client_id,
          snapshot_count = excluded.snapshot_count,
          input_root = excluded.input_root,
          jobs_root = excluded.jobs_root,
          output_root = excluded.output_root,
          approved_root = excluded.approved_root,
          state_root = excluded.state_root,
          notes = excluded.notes,
          last_error = excluded.last_error,
          count_products = excluded.count_products,
          count_generating = excluded.count_generating,
          count_in_review = excluded.count_in_review,
          count_approved = excluded.count_approved,
          count_error = excluded.count_error,
          count_outputs = excluded.count_outputs
      `).run({
        batchId: batch.batchId,
        name: batch.name,
        status: batch.status,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
        archivedAt: batch.archivedAt ?? null,
        active: batch.active ? 1 : 0,
        currentProductId: batch.currentProductId ?? null,
        clientId: batch.clientId ?? null,
        snapshotCount: batch.snapshotCount,
        inputRoot: batch.inputRoot,
        jobsRoot: batch.jobsRoot,
        outputRoot: batch.outputRoot,
        approvedRoot: batch.approvedRoot,
        stateRoot: batch.stateRoot,
        notes: batch.notes ?? null,
        lastError: batch.lastError ?? null,
        countProducts: batch.counts.products,
        countGenerating: batch.counts.generating,
        countInReview: batch.counts.inReview,
        countApproved: batch.counts.approved,
        countError: batch.counts.error,
        countOutputs: batch.counts.outputs
      });

      this.db.prepare(`
        INSERT INTO batch_prompt_configs (batch_id, system_prompt, general_prompt, pose_prompts_json, background_config_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(batch_id) DO UPDATE SET
          system_prompt = excluded.system_prompt,
          general_prompt = excluded.general_prompt,
          pose_prompts_json = excluded.pose_prompts_json,
          background_config_json = excluded.background_config_json
      `).run(
        batch.batchId,
        promptConfig.systemPrompt,
        promptConfig.generalPrompt,
        JSON.stringify(promptConfig.posePrompts ?? {}),
        JSON.stringify(promptConfig.backgroundConfig ?? {})
      );

      this.db.prepare(`DELETE FROM batch_pose_prompts WHERE batch_id = ?`).run(batch.batchId);
      const insertPosePrompt = this.db.prepare(`
        INSERT INTO batch_pose_prompts (batch_id, pose_id, prompt_text)
        VALUES (?, ?, ?)
      `);
      Object.entries(promptConfig.posePrompts ?? {}).forEach(([poseId, promptText]) => {
        if (!promptText.trim()) {
          return;
        }
        insertPosePrompt.run(batch.batchId, poseId, promptText);
      });

      this.db.prepare(`
        INSERT INTO batch_provider_settings (
          batch_id, model_id, image_size_type, image_size_preset, image_width, image_height, seed, sync_mode, enable_safety_checker
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(batch_id) DO UPDATE SET
          model_id = excluded.model_id,
          image_size_type = excluded.image_size_type,
          image_size_preset = excluded.image_size_preset,
          image_width = excluded.image_width,
          image_height = excluded.image_height,
          seed = excluded.seed,
          sync_mode = excluded.sync_mode,
          enable_safety_checker = excluded.enable_safety_checker
      `).run(
        batch.batchId,
        providerSettings.modelId,
        isCustomImageSize(providerSettings.imageSize) ? "custom" : "preset",
        isCustomImageSize(providerSettings.imageSize) ? null : providerSettings.imageSize,
        isCustomImageSize(providerSettings.imageSize) ? providerSettings.imageSize.width : null,
        isCustomImageSize(providerSettings.imageSize) ? providerSettings.imageSize.height : null,
        typeof providerSettings.seed === "number" ? providerSettings.seed : null,
        providerSettings.syncMode ? 1 : 0,
        providerSettings.enableSafetyChecker ? 1 : 0
      );

      this.db.prepare(`DELETE FROM batch_model_selection WHERE batch_id = ?`).run(batch.batchId);
      this.db.prepare(`DELETE FROM batch_model_selection_photos WHERE batch_id = ?`).run(batch.batchId);
      if (batch.selectedModelId) {
        this.db.prepare(`
          INSERT INTO batch_model_selection (batch_id, model_id)
          VALUES (?, ?)
        `).run(batch.batchId, batch.selectedModelId);

        const insertSelectedPhoto = this.db.prepare(`
          INSERT INTO batch_model_selection_photos (batch_id, photo_id, sort_order)
          VALUES (?, ?, ?)
        `);
        (batch.selectedModelPhotoIds ?? []).forEach((photoId, index) => {
          insertSelectedPhoto.run(batch.batchId, photoId, index);
        });
      }
    })();
  }

  deleteBatch(batchId: string): void {
    this.db.prepare("DELETE FROM batches WHERE batch_id = ?").run(batchId);
  }

  setOnlyActiveBatch(batchId: string | null): void {
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE batches
        SET
          active = CASE WHEN batch_id = @batchId THEN 1 ELSE 0 END,
          status = CASE
            WHEN batch_id != @batchId AND status = 'running' THEN 'paused'
            ELSE status
          END
      `).run({
        batchId
      });
    })();
  }

  getPromptConfig(batchId: string): BatchPromptConfig | null {
    const row = this.db.prepare(`
      SELECT
        pc.system_prompt AS systemPrompt,
        pc.general_prompt AS generalPrompt,
        pc.pose_prompts_json AS posePromptsJson,
        pc.background_config_json AS backgroundConfigJson,
        ps.model_id AS modelId,
        ps.image_size_type AS imageSizeType,
        ps.image_size_preset AS imageSizePreset,
        ps.image_width AS imageWidth,
        ps.image_height AS imageHeight,
        ps.seed AS seed,
        ps.sync_mode AS syncMode,
        ps.enable_safety_checker AS enableSafetyChecker
      FROM batch_prompt_configs pc
      JOIN batch_provider_settings ps ON ps.batch_id = pc.batch_id
      WHERE pc.batch_id = ?
    `).get(batchId) as PromptRow | undefined;

    if (!row) {
      return null;
    }

    const posePromptRows = this.db.prepare(`
      SELECT pose_id AS poseId, prompt_text AS promptText
      FROM batch_pose_prompts
      WHERE batch_id = ?
      ORDER BY pose_id ASC
    `).all(batchId) as Array<{ poseId: string; promptText: string }>;

    return {
      systemPrompt: row.systemPrompt,
      generalPrompt: row.generalPrompt,
      posePrompts: posePromptRows.length > 0
        ? Object.fromEntries(posePromptRows.map((item) => [item.poseId, item.promptText]))
        : parseJson<Record<string, string>>(row.posePromptsJson, {}),
      backgroundConfig: parseJson<BatchPromptConfig["backgroundConfig"]>(row.backgroundConfigJson, {
        mode: "white",
        bokehIntensity: 45,
        lightingStyle: "clear_soft_daylight",
        scene: "none",
        dominantColor: "white",
        backgroundProminence: "minimal",
        contrast: "soft",
        realismLevel: "catalogo_realista",
        subjectSeparation: "strong",
        noPeople: true,
        noProps: true,
        noText: true,
        customInstructions: ""
      }),
      providerSettings: this.mapProviderSettings(row)
    };
  }

  listEvents(batchId: string): BatchEvent[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        type,
        timestamp,
        message,
        product_id AS productId,
        pose_id AS poseId,
        meta_json AS metaJson
      FROM batch_events
      WHERE batch_id = ?
      ORDER BY timestamp ASC
    `).all(batchId) as Array<{
      id: string;
      type: BatchEvent["type"];
      timestamp: string;
      message: string;
      productId?: string | null;
      poseId?: string | null;
      metaJson?: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      timestamp: row.timestamp,
      message: row.message,
      productId: row.productId ?? undefined,
      poseId: row.poseId ?? undefined,
      meta: parseJson<Record<string, string | number | boolean | null> | undefined>(row.metaJson ?? "", undefined)
    }));
  }

  appendEvent(batchId: string, event: BatchEvent): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO batch_events (
        id, batch_id, type, timestamp, message, product_id, pose_id, meta_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      batchId,
      event.type,
      event.timestamp,
      event.message,
      event.productId ?? null,
      event.poseId ?? null,
      event.meta ? JSON.stringify(event.meta) : null
    );
  }

  listClients(): ClientRecord[] {
    return this.db.prepare(`
      SELECT
        clients.client_id AS clientId,
        clients.name AS name,
        clients.notes AS notes,
        COUNT(batches.batch_id) AS batchCount,
        SUM(CASE WHEN batches.active = 1 THEN 1 ELSE 0 END) AS activeBatchCount
      FROM clients
      LEFT JOIN batches ON batches.client_id = clients.client_id
      GROUP BY clients.client_id, clients.name, clients.notes
      ORDER BY clients.updated_at DESC, clients.name ASC
    `).all() as ClientRecord[];
  }

  saveClient(client: ClientRecord): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO clients (client_id, name, notes, created_at, updated_at)
      VALUES (@clientId, @name, @notes, @createdAt, @updatedAt)
      ON CONFLICT(client_id) DO UPDATE SET
        name = excluded.name,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `).run({
      clientId: client.clientId,
      name: client.name,
      notes: client.notes ?? null,
      createdAt: now,
      updatedAt: now
    });
  }

  ensureDefaultClients(clients: ClientRecord[]): void {
    clients.forEach((client) => this.saveClient(client));
  }

  listModels(filters?: { clientId?: string; includeFree?: boolean }): CatalogModel[] {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (filters?.clientId) {
      if (filters.includeFree) {
        clauses.push("(models.client_id = @clientId OR models.client_id IS NULL)");
      } else {
        clauses.push("models.client_id = @clientId");
      }
      params.clientId = filters.clientId;
    }
    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const modelRows = this.db.prepare(`
      SELECT
        models.model_id AS modelId,
        models.client_id AS clientId,
        clients.name AS clientName,
        models.name AS name,
        models.age_group AS ageGroup,
        models.gender AS gender,
        models.includes_full_body AS includesFullBody,
        models.includes_face AS includesFace,
        models.includes_hands AS includesHands,
        models.includes_feet AS includesFeet,
        models.includes_swimwear AS includesSwimwear,
        models.created_at AS createdAt,
        models.updated_at AS updatedAt
      FROM models
      LEFT JOIN clients ON clients.client_id = models.client_id
      ${whereClause}
      ORDER BY models.updated_at DESC, models.name ASC
    `).all(params) as ModelRow[];

    const photoRows = this.db.prepare(`
      SELECT
        photo_id AS photoId,
        model_id AS modelId,
        file_path AS filePath,
        sort_order AS sortOrder
      FROM model_photos
      ORDER BY model_id ASC, sort_order ASC, photo_id ASC
    `).all() as ModelPhotoRow[];

    const photosByModel = new Map<string, CatalogModelPhoto[]>();
    for (const row of photoRows) {
      const bucket = photosByModel.get(row.modelId) ?? [];
      bucket.push({
        photoId: row.photoId,
        modelId: row.modelId,
        filePath: row.filePath,
        sortOrder: row.sortOrder
      });
      photosByModel.set(row.modelId, bucket);
    }

    return modelRows.map((row) => ({
      modelId: row.modelId,
      clientId: row.clientId ?? undefined,
      clientName: row.clientName ?? undefined,
      name: row.name,
      ageGroup: row.ageGroup ? row.ageGroup as CatalogModel["ageGroup"] : undefined,
      gender: row.gender,
      includesFullBody: Boolean(row.includesFullBody),
      includesFace: Boolean(row.includesFace),
      includesHands: Boolean(row.includesHands),
      includesFeet: Boolean(row.includesFeet),
      includesSwimwear: Boolean(row.includesSwimwear),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      photos: photosByModel.get(row.modelId) ?? []
    }));
  }

  getModel(modelId: string): CatalogModel | null {
    return this.listModels().find((model) => model.modelId === modelId) ?? null;
  }

  saveModel(model: CatalogModel): void {
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO models (
          model_id, client_id, name, age_group, gender, includes_full_body, includes_face, includes_hands, includes_feet, includes_swimwear, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(model_id) DO UPDATE SET
          client_id = excluded.client_id,
          name = excluded.name,
          age_group = excluded.age_group,
          gender = excluded.gender,
          includes_full_body = excluded.includes_full_body,
          includes_face = excluded.includes_face,
          includes_hands = excluded.includes_hands,
          includes_feet = excluded.includes_feet,
          includes_swimwear = excluded.includes_swimwear,
          updated_at = excluded.updated_at
      `).run(
        model.modelId,
        model.clientId ?? null,
        model.name,
        model.ageGroup ?? null,
        model.gender,
        model.includesFullBody ? 1 : 0,
        model.includesFace ? 1 : 0,
        model.includesHands ? 1 : 0,
        model.includesFeet ? 1 : 0,
        model.includesSwimwear ? 1 : 0,
        model.createdAt,
        model.updatedAt
      );

      const existingPhotoRows = this.db.prepare(`
        SELECT photo_id AS photoId
        FROM model_photos
        WHERE model_id = ?
      `).all(model.modelId) as Array<{ photoId: string }>;
      const nextPhotoIds = new Set(model.photos.map((photo) => photo.photoId));
      const deletePhoto = this.db.prepare(`DELETE FROM model_photos WHERE photo_id = ?`);
      existingPhotoRows
        .filter((row) => !nextPhotoIds.has(row.photoId))
        .forEach((row) => {
          deletePhoto.run(row.photoId);
        });

      const insertPhoto = this.db.prepare(`
        INSERT INTO model_photos (photo_id, model_id, file_path, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(photo_id) DO UPDATE SET
          file_path = excluded.file_path,
          sort_order = excluded.sort_order
      `);
      model.photos.forEach((photo, index) => {
        insertPhoto.run(photo.photoId, model.modelId, photo.filePath, index, model.createdAt);
      });
    })();
  }

  deleteModel(modelId: string): void {
    this.db.prepare(`DELETE FROM models WHERE model_id = ?`).run(modelId);
  }

  getBatchModelSelection(batchId: string): BatchModelSelection | null {
    const selection = this.db.prepare(`
      SELECT batch_id AS batchId, model_id AS modelId
      FROM batch_model_selection
      WHERE batch_id = ?
    `).get(batchId) as { batchId: string; modelId: string } | undefined;
    if (!selection) {
      return null;
    }
    const photoRows = this.db.prepare(`
      SELECT photo_id AS photoId
      FROM batch_model_selection_photos
      WHERE batch_id = ?
      ORDER BY sort_order ASC, photo_id ASC
    `).all(batchId) as Array<{ photoId: string }>;
    return {
      batchId,
      modelId: selection.modelId,
      selectedPhotoIds: photoRows.map((row) => row.photoId)
    };
  }

  saveBatchModelSelection(selection: BatchModelSelection): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM batch_model_selection WHERE batch_id = ?`).run(selection.batchId);
      this.db.prepare(`DELETE FROM batch_model_selection_photos WHERE batch_id = ?`).run(selection.batchId);
      this.db.prepare(`
        INSERT INTO batch_model_selection (batch_id, model_id)
        VALUES (?, ?)
      `).run(selection.batchId, selection.modelId);
      const insertPhoto = this.db.prepare(`
        INSERT INTO batch_model_selection_photos (batch_id, photo_id, sort_order)
        VALUES (?, ?, ?)
      `);
      selection.selectedPhotoIds.forEach((photoId, index) => {
        insertPhoto.run(selection.batchId, photoId, index);
      });
    })();
  }

  listSnapshots(batchId: string): BatchSnapshot[] {
    return this.db.prepare(`
      SELECT
        snapshot_id AS snapshotId,
        batch_id AS batchId,
        created_at AS createdAt,
        root_path AS rootPath,
        input_path AS inputPath,
        output_path AS outputPath,
        approved_path AS approvedPath,
        jobs_path AS jobsPath,
        state_path AS statePath,
        notes
      FROM batch_snapshots
      WHERE batch_id = ?
      ORDER BY created_at DESC
    `).all(batchId) as BatchSnapshot[];
  }

  saveSnapshot(snapshot: BatchSnapshot): void {
    this.db.prepare(`
      INSERT INTO batch_snapshots (
        snapshot_id, batch_id, created_at, root_path, input_path, output_path, approved_path, jobs_path, state_path, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(snapshot_id) DO UPDATE SET
        created_at = excluded.created_at,
        root_path = excluded.root_path,
        input_path = excluded.input_path,
        output_path = excluded.output_path,
        approved_path = excluded.approved_path,
        jobs_path = excluded.jobs_path,
        state_path = excluded.state_path,
        notes = excluded.notes
    `).run(
      snapshot.snapshotId,
      snapshot.batchId,
      snapshot.createdAt,
      snapshot.rootPath,
      snapshot.inputPath,
      snapshot.outputPath,
      snapshot.approvedPath,
      snapshot.jobsPath,
      snapshot.statePath,
      snapshot.notes ?? null
    );
  }

  buildBatchRoots(baseDir: string, batchId: string): Pick<BatchManifest, "inputRoot" | "jobsRoot" | "outputRoot" | "approvedRoot" | "stateRoot"> {
    const batchRoot = path.join(baseDir, sanitizeId(batchId));
    return {
      inputRoot: path.join(batchRoot, "input"),
      jobsRoot: path.join(batchRoot, "jobs"),
      outputRoot: path.join(batchRoot, "output"),
      approvedRoot: path.join(batchRoot, "approved"),
      stateRoot: path.join(batchRoot, "state")
    };
  }

  private mapBatchRow(row: BatchRow): BatchManifest {
    const promptConfig = this.getPromptConfig(row.batchId);
    const modelSelection = this.getBatchModelSelection(row.batchId);
    if (!promptConfig) {
      throw new Error(`Prompt config missing for batch ${row.batchId}.`);
    }

    return {
      batchId: row.batchId,
      name: row.name,
      clientId: row.clientId ?? undefined,
      clientName: row.clientName ?? undefined,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
      active: Boolean(row.active),
      currentProductId: row.currentProductId ?? null,
      promptConfig,
      counts: {
        products: row.countProducts,
        generating: row.countGenerating,
        inReview: row.countInReview,
        approved: row.countApproved,
        error: row.countError,
        outputs: row.countOutputs
      },
      snapshotCount: row.snapshotCount,
      inputRoot: row.inputRoot,
      jobsRoot: row.jobsRoot,
      outputRoot: row.outputRoot,
      approvedRoot: row.approvedRoot,
      stateRoot: row.stateRoot,
      notes: row.notes,
      lastError: row.lastError,
      selectedModelId: modelSelection?.modelId,
      selectedModelPhotoIds: modelSelection?.selectedPhotoIds ?? []
    };
  }

  private mapProviderSettings(row: PromptRow): FalProviderSettings {
    const imageSize: FalProviderSettings["imageSize"] = row.imageSizeType === "custom"
      ? {
          width: Number(row.imageWidth ?? 1024),
          height: Number(row.imageHeight ?? 1024)
        } satisfies FalCustomImageSize
      : ((row.imageSizePreset ?? "square_hd") as FalImageSizePreset);

    return {
      modelId: row.modelId,
      imageSize,
      seed: typeof row.seed === "number" ? row.seed : null,
      syncMode: Boolean(row.syncMode),
      enableSafetyChecker: Boolean(row.enableSafetyChecker)
    };
  }
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isCustomImageSize(value: FalProviderSettings["imageSize"]): value is FalCustomImageSize {
  return typeof value === "object" && value !== null;
}
