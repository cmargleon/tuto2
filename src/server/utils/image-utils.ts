import fs from "fs/promises";
import mime from "mime-types";
import sharp from "sharp";
import type { ProviderImageInput } from "../../shared/types";

export async function loadImageAsProviderInput(filePath: string): Promise<ProviderImageInput> {
  const fileBuffer = await fs.readFile(filePath);
  const mimeType = mime.lookup(filePath) || "image/jpeg";
  return {
    mimeType,
    dataBase64: fileBuffer.toString("base64"),
    name: filePath
  };
}

export async function normalizeGeneratedImage(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .resize(1000, 1000, { fit: "cover", position: "center" })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 92, mozjpeg: true })
    .withMetadata({ density: 72 })
    .toBuffer();
}
