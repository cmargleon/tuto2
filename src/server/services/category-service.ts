import fs from "fs/promises";
import path from "path";
import type { ProductCategory } from "../../shared/types";
import { config } from "../config";

interface ProductMetadata {
  sku?: string;
  category?: ProductCategory;
}

const keywordMap: Array<{ pattern: RegExp; category: ProductCategory }> = [
  { pattern: /(dress|vestido)/i, category: "vestido" },
  { pattern: /(pant|jean|denim|falda|skirt|short|legging)/i, category: "parte_baja" },
  { pattern: /(bra|bralette|panty|brief|lingerie-set)/i, category: "interior_coordinado" },
  { pattern: /(top-interior|int-top)/i, category: "interior_superior" },
  { pattern: /(bottom-interior|int-bottom)/i, category: "interior_inferior" },
  { pattern: /(flat|product-only|sin-modelo)/i, category: "producto_sin_modelo" },
  { pattern: /(shirt|blouse|top|tee|camisa|blusa|sueter|hoodie|jacket)/i, category: "parte_alta" }
];

export async function readOptionalProductMetadata(productRoot: string): Promise<ProductMetadata | null> {
  const metadataPath = path.join(productRoot, "product.json");
  try {
    const raw = await fs.readFile(metadataPath, "utf8");
    return JSON.parse(raw) as ProductMetadata;
  } catch {
    return null;
  }
}

export function classifyCategory(sourceName: string, metadata?: ProductMetadata | null): ProductCategory {
  if (metadata?.category) {
    return metadata.category;
  }
  const matched = keywordMap.find((entry) => entry.pattern.test(sourceName));
  if (matched) {
    return matched.category;
  }
  return config.defaultCategory as ProductCategory;
}
