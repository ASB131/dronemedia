import sharp from "sharp";

/** Simple 8x8 average hash → 16-char hex (good enough for near-duplicate grouping). */
export async function computeAverageHash(image: Buffer): Promise<string> {
  const { data, info } = await sharp(image)
    .rotate()
    .greyscale()
    .resize(8, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = info.width * info.height;
  let sum = 0;
  for (let i = 0; i < pixels; i += 1) sum += data[i]!;
  const avg = sum / pixels;

  let bits = "";
  for (let i = 0; i < pixels; i += 1) {
    bits += data[i]! >= avg ? "1" : "0";
  }

  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex.padStart(16, "0");
}
