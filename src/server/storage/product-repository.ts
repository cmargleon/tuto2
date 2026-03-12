import type {
  GeneratedImageMetadata,
  GeneratedOutput,
  PromptHistoryEntry,
  ProductManifest,
  ProductPoseState
} from "../../shared/types";
import { RuntimeStateRepository } from "./runtime-state-repository";
import { sqliteDatabase } from "./sqlite-database";

type ProductRow = {
  batchId: string;
  productId: string;
  sourceName: string;
  sku?: string | null;
  garmentImagesJson: string;
  promptGeneralOverride: string;
  promptPoseOverridesJson: string;
  category: ProductManifest["category"];
  status: ProductManifest["status"];
  createdAt: string;
  updatedAt: string;
  lastError?: string | null;
};

type PoseRow = {
  batchId: string;
  productId: string;
  poseId: string;
  variantCount: number;
  status: ProductPoseState["status"];
  regenerateCount: number;
  providerModelId: string;
  lastError?: string | null;
  promptOverride: string;
  lastPromptUsed: string;
  promptPreview: string;
};

type OutputRow = {
  outputId: string;
  usageId?: string | null;
  batchId: string;
  productId: string;
  poseId: string;
  sortOrder: number;
  variantKey: GeneratedOutput["variantKey"];
  fileName: string;
  filePath: string;
  metadataPath: string;
  status: GeneratedOutput["status"];
  error?: string | null;
  metadataJson?: string | null;
};

type ApprovalRow = {
  batchId: string;
  productId: string;
  poseId: string;
  outputId: string;
  sortOrder: number;
};

type GarmentImageRow = {
  productId: string;
  filePath: string;
  sortOrder: number;
};

type PosePromptOverrideRow = {
  productId: string;
  poseId: string;
  promptText: string;
};

type PromptHistoryRow = {
  entryId: string;
  batchId: string;
  productId: string;
  poseId: string;
  systemPrompt: string;
  userPrompt: string;
  finalPrompt: string;
  providerModelId: string;
  source: PromptHistoryEntry["source"];
  createdAt: string;
};

export class ProductRepository {
  private readonly db = sqliteDatabase.connection;

  constructor(private readonly runtimeStateRepository: RuntimeStateRepository) {}

  async init(): Promise<void> {
    return Promise.resolve();
  }

  async listProducts(batchId?: string): Promise<ProductManifest[]> {
    const resolvedBatchId = this.resolveBatchId(batchId);
    if (!resolvedBatchId) {
      return [];
    }

    const productRows = this.db.prepare(`
      SELECT
        batch_id AS batchId,
        product_id AS productId,
        source_name AS sourceName,
        sku,
        garment_images_json AS garmentImagesJson,
        prompt_general_override AS promptGeneralOverride,
        prompt_pose_overrides_json AS promptPoseOverridesJson,
        category,
        status,
        created_at AS createdAt,
        updated_at AS updatedAt,
        last_error AS lastError
      FROM products
      WHERE batch_id = ?
      ORDER BY product_id ASC
    `).all(resolvedBatchId) as ProductRow[];

    if (productRows.length === 0) {
      return [];
    }

    const poseRows = this.db.prepare(`
      SELECT
        batch_id AS batchId,
        product_id AS productId,
        pose_id AS poseId,
        variant_count AS variantCount,
        status,
        regenerate_count AS regenerateCount,
        provider_model_id AS providerModelId,
        last_error AS lastError,
        prompt_override AS promptOverride,
        last_prompt_used AS lastPromptUsed,
        prompt_preview AS promptPreview
      FROM product_poses
      WHERE batch_id = ?
      ORDER BY pose_id ASC
    `).all(resolvedBatchId) as PoseRow[];

    const outputRows = this.db.prepare(`
      SELECT
        output_id AS outputId,
        usage_id AS usageId,
        batch_id AS batchId,
        product_id AS productId,
        pose_id AS poseId,
        sort_order AS sortOrder,
        variant_key AS variantKey,
        file_name AS fileName,
        file_path AS filePath,
        metadata_path AS metadataPath,
        status,
        error,
        metadata_json AS metadataJson
      FROM outputs
      WHERE batch_id = ?
      ORDER BY product_id ASC, sort_order ASC, output_id ASC
    `).all(resolvedBatchId) as OutputRow[];

    const garmentImageRows = this.db.prepare(`
      SELECT
        product_id AS productId,
        file_path AS filePath,
        sort_order AS sortOrder
      FROM product_garment_images
      WHERE batch_id = ?
      ORDER BY product_id ASC, sort_order ASC, file_path ASC
    `).all(resolvedBatchId) as GarmentImageRow[];

    const posePromptOverrideRows = this.db.prepare(`
      SELECT
        product_id AS productId,
        pose_id AS poseId,
        prompt_text AS promptText
      FROM product_pose_prompt_overrides
      WHERE batch_id = ?
      ORDER BY product_id ASC, pose_id ASC
    `).all(resolvedBatchId) as PosePromptOverrideRow[];

    const approvalRows = this.db.prepare(`
      SELECT
        batch_id AS batchId,
        product_id AS productId,
        pose_id AS poseId,
        output_id AS outputId,
        sort_order AS sortOrder
      FROM approvals
      WHERE batch_id = ?
      ORDER BY product_id ASC, pose_id ASC, sort_order ASC
    `).all(resolvedBatchId) as ApprovalRow[];

    const posesByProduct = new Map<string, ProductPoseState[]>();
    for (const row of poseRows) {
      const bucket = posesByProduct.get(row.productId) ?? [];
      bucket.push({
        poseId: row.poseId,
        variantCount: row.variantCount,
        status: row.status,
        regenerateCount: row.regenerateCount,
        providerModelId: row.providerModelId || undefined,
        lastError: row.lastError ?? undefined,
        promptOverride: row.promptOverride,
        lastPromptUsed: row.lastPromptUsed,
        promptPreview: row.promptPreview
      });
      posesByProduct.set(row.productId, bucket);
    }

    const outputsByProduct = new Map<string, GeneratedOutput[]>();
    for (const row of outputRows) {
      const bucket = outputsByProduct.get(row.productId) ?? [];
      bucket.push({
        outputId: row.outputId,
        usageId: row.usageId ?? undefined,
        poseId: row.poseId,
        variantKey: row.variantKey,
        fileName: row.fileName,
        filePath: row.filePath,
        metadataPath: row.metadataPath,
        status: row.status,
        error: row.error ?? undefined,
        metadata: parseJson<GeneratedImageMetadata | undefined>(row.metadataJson ?? "", undefined)
      });
      outputsByProduct.set(row.productId, bucket);
    }

    const approvalsByProduct = new Map<string, Record<string, string[]>>();
    for (const row of approvalRows) {
      const bucket = approvalsByProduct.get(row.productId) ?? {};
      const poseBucket = bucket[row.poseId] ?? [];
      poseBucket.push(row.outputId);
      bucket[row.poseId] = poseBucket;
      approvalsByProduct.set(row.productId, bucket);
    }

    const garmentImagesByProduct = new Map<string, string[]>();
    for (const row of garmentImageRows) {
      const bucket = garmentImagesByProduct.get(row.productId) ?? [];
      bucket.push(row.filePath);
      garmentImagesByProduct.set(row.productId, bucket);
    }

    const posePromptOverridesByProduct = new Map<string, Record<string, string>>();
    for (const row of posePromptOverrideRows) {
      const bucket = posePromptOverridesByProduct.get(row.productId) ?? {};
      bucket[row.poseId] = row.promptText;
      posePromptOverridesByProduct.set(row.productId, bucket);
    }

    return productRows.map((row) => normalizeManifest({
      productId: row.productId,
      sourceName: row.sourceName,
      sku: row.sku ?? undefined,
      garmentImages: garmentImagesByProduct.get(row.productId) ?? parseJson<string[]>(row.garmentImagesJson, []),
      promptOverrides: {
        generalPrompt: row.promptGeneralOverride,
        posePrompts: posePromptOverridesByProduct.get(row.productId) ?? parseJson<Record<string, string>>(row.promptPoseOverridesJson, {})
      },
      category: row.category,
      poses: posesByProduct.get(row.productId) ?? [],
      outputs: outputsByProduct.get(row.productId) ?? [],
      approved: approvalsByProduct.get(row.productId) ?? {},
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastError: row.lastError ?? undefined
    })).sort((a, b) => a.productId.localeCompare(b.productId));
  }

  async getProduct(productId: string, batchId?: string): Promise<ProductManifest | null> {
    const products = await this.listProducts(batchId);
    return products.find((item) => item.productId === productId) ?? null;
  }

  async saveProduct(manifest: ProductManifest, batchId?: string): Promise<void> {
    const resolvedBatchId = this.requireBatchId(batchId);
    const nextManifest = normalizeManifest({
      ...manifest,
      updatedAt: new Date().toISOString()
    });

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO products (
          batch_id, product_id, source_name, sku, garment_images_json, selected_model,
          prompt_general_override, prompt_pose_overrides_json, category, status, created_at, updated_at, last_error
        )
        VALUES (
          @batchId, @productId, @sourceName, @sku, @garmentImagesJson, '',
          @promptGeneralOverride, @promptPoseOverridesJson, @category, @status, @createdAt, @updatedAt, @lastError
        )
        ON CONFLICT(batch_id, product_id) DO UPDATE SET
          source_name = excluded.source_name,
          sku = excluded.sku,
          garment_images_json = excluded.garment_images_json,
          selected_model = excluded.selected_model,
          prompt_general_override = excluded.prompt_general_override,
          prompt_pose_overrides_json = excluded.prompt_pose_overrides_json,
          category = excluded.category,
          status = excluded.status,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          last_error = excluded.last_error
      `).run({
        batchId: resolvedBatchId,
        productId: nextManifest.productId,
        sourceName: nextManifest.sourceName,
        sku: nextManifest.sku ?? null,
        garmentImagesJson: JSON.stringify(nextManifest.garmentImages),
        promptGeneralOverride: nextManifest.promptOverrides?.generalPrompt ?? "",
        promptPoseOverridesJson: JSON.stringify(nextManifest.promptOverrides?.posePrompts ?? {}),
        category: nextManifest.category,
        status: nextManifest.status,
        createdAt: nextManifest.createdAt,
        updatedAt: nextManifest.updatedAt,
        lastError: nextManifest.lastError ?? null
      });

      this.db.prepare(`
        DELETE FROM product_poses
        WHERE batch_id = ? AND product_id = ?
      `).run(resolvedBatchId, nextManifest.productId);

      this.db.prepare(`
        DELETE FROM product_garment_images
        WHERE batch_id = ? AND product_id = ?
      `).run(resolvedBatchId, nextManifest.productId);

      this.db.prepare(`
        DELETE FROM product_pose_prompt_overrides
        WHERE batch_id = ? AND product_id = ?
      `).run(resolvedBatchId, nextManifest.productId);

      this.db.prepare(`
        DELETE FROM approvals
        WHERE batch_id = ? AND product_id = ?
      `).run(resolvedBatchId, nextManifest.productId);

      this.db.prepare(`
        DELETE FROM outputs
        WHERE batch_id = ? AND product_id = ?
      `).run(resolvedBatchId, nextManifest.productId);

      const insertPose = this.db.prepare(`
        INSERT INTO product_poses (
          batch_id, product_id, pose_id, variant_count, status, regenerate_count, last_error,
          provider_model_id, prompt_override, last_prompt_used, prompt_preview
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertGarmentImage = this.db.prepare(`
        INSERT INTO product_garment_images (batch_id, product_id, file_path, sort_order)
        VALUES (?, ?, ?, ?)
      `);

      nextManifest.garmentImages.forEach((filePath, index) => {
        insertGarmentImage.run(resolvedBatchId, nextManifest.productId, filePath, index);
      });

      const insertPosePromptOverride = this.db.prepare(`
        INSERT INTO product_pose_prompt_overrides (batch_id, product_id, pose_id, prompt_text)
        VALUES (?, ?, ?, ?)
      `);

      Object.entries(nextManifest.promptOverrides?.posePrompts ?? {}).forEach(([poseId, promptText]) => {
        if (!promptText.trim()) {
          return;
        }
        insertPosePromptOverride.run(resolvedBatchId, nextManifest.productId, poseId, promptText);
      });

      for (const pose of nextManifest.poses) {
        insertPose.run(
          resolvedBatchId,
          nextManifest.productId,
          pose.poseId,
          pose.variantCount,
          pose.status,
          pose.regenerateCount,
          pose.lastError ?? null,
          pose.providerModelId ?? "",
          pose.promptOverride ?? "",
          pose.lastPromptUsed ?? "",
          pose.promptPreview ?? ""
        );
      }

      const insertOutput = this.db.prepare(`
        INSERT INTO outputs (
          output_id, usage_id, batch_id, product_id, pose_id, sort_order, variant_key, file_name, file_path,
          metadata_path, status, error, metadata_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      nextManifest.outputs.forEach((output, index) => {
        insertOutput.run(
          output.outputId,
          output.usageId ?? null,
          resolvedBatchId,
          nextManifest.productId,
          output.poseId,
          index,
          output.variantKey,
          output.fileName,
          output.filePath,
          output.metadataPath,
          output.status,
          output.error ?? null,
          output.metadata ? JSON.stringify(output.metadata) : null
        );
      });

      const insertApproval = this.db.prepare(`
        INSERT INTO approvals (
          batch_id, product_id, pose_id, output_id, sort_order
        )
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const [poseId, outputIds] of Object.entries(nextManifest.approved)) {
        outputIds.forEach((outputId, index) => {
          insertApproval.run(resolvedBatchId, nextManifest.productId, poseId, outputId, index);
        });
      }
    })();
  }

  async deleteProduct(productId: string, batchId?: string): Promise<void> {
    const resolvedBatchId = this.requireBatchId(batchId);
    this.db.prepare(`
      DELETE FROM products
      WHERE batch_id = ? AND product_id = ?
    `).run(resolvedBatchId, productId);
  }

  async duplicateBatchProducts(sourceBatchId: string, targetBatchId: string, pathTransform: (filePath: string) => string): Promise<void> {
    const products = await this.listProducts(sourceBatchId);
    for (const product of products) {
      const duplicated: ProductManifest = {
        ...product,
        garmentImages: product.garmentImages.map(pathTransform),
        outputs: product.outputs.map((output) => ({
          ...output,
          filePath: pathTransform(output.filePath),
          metadataPath: pathTransform(output.metadataPath)
        }))
      };
      await this.saveProduct(duplicated, targetBatchId);
    }
  }

  addPromptHistory(entry: PromptHistoryEntry): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO prompt_history (
        entry_id, batch_id, product_id, pose_id, system_prompt, user_prompt, final_prompt, provider_model_id, source, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.entryId,
      entry.batchId,
      entry.productId,
      entry.poseId,
      entry.systemPrompt,
      entry.userPrompt,
      entry.finalPrompt,
      entry.providerModelId,
      entry.source,
      entry.createdAt
    );
  }

  listPromptHistory(batchId?: string, limit = 50): PromptHistoryEntry[] {
    const resolvedBatchId = this.resolveBatchId(batchId);
    if (!resolvedBatchId) {
      return [];
    }

    return this.db.prepare(`
      SELECT
        entry_id AS entryId,
        batch_id AS batchId,
        product_id AS productId,
        pose_id AS poseId,
        system_prompt AS systemPrompt,
        user_prompt AS userPrompt,
        final_prompt AS finalPrompt,
        provider_model_id AS providerModelId,
        source,
        created_at AS createdAt
      FROM prompt_history
      WHERE batch_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(resolvedBatchId, limit) as PromptHistoryRow[];
  }

  private resolveBatchId(batchId?: string): string | null {
    if (batchId) {
      return batchId;
    }
    return this.runtimeStateRepository.getActiveBatchState()?.batchId ?? null;
  }

  private requireBatchId(batchId?: string): string {
    const resolvedBatchId = this.resolveBatchId(batchId);
    if (!resolvedBatchId) {
      throw new Error("No active batch selected.");
    }
    return resolvedBatchId;
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

function normalizeManifest(manifest: ProductManifest): ProductManifest {
  const approved = Object.fromEntries(
    Object.entries(manifest.approved ?? {}).map(([poseId, value]) => [
      poseId,
      Array.isArray(value) ? value : value ? [value] : []
    ])
  );
  return {
    ...manifest,
    approved,
    promptOverrides: {
      generalPrompt: manifest.promptOverrides?.generalPrompt ?? "",
      posePrompts: manifest.promptOverrides?.posePrompts ?? {}
    },
    poses: manifest.poses.map((pose) => ({
      ...pose,
      providerModelId: pose.providerModelId ?? "",
      promptOverride: pose.promptOverride ?? "",
      lastPromptUsed: pose.lastPromptUsed ?? "",
      promptPreview: pose.promptPreview ?? ""
    }))
  };
}
