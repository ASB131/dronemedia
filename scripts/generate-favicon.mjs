import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(
  process.env.USERPROFILE || "",
  ".cursor/projects/f-drone-media-repo/assets",
  "c__Users_asb19_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_image-d15c00bc-6535-46de-944c-4303e486c755.png",
);
const outDir = path.join(__dirname, "../public/icons");

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

for (let i = 0; i < data.length; i += 4) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  if (r > 210 && g > 210 && b > 210) {
    data[i + 3] = 0;
  } else if (r > 175 && g > 180 && b > 185) {
    const avg = (r + g + b) / 3;
    const t = Math.max(0, Math.min(1, (avg - 165) / 70));
    data[i + 3] = Math.round(data[i + 3] * (1 - t));
  }
}

const transparent = await sharp(data, {
  raw: { width: info.width, height: info.height, channels: 4 },
}).png().toBuffer();

const trim = await sharp(transparent).trim({ threshold: 8 }).png().toBuffer();

await sharp(trim)
  .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(path.join(outDir, "icon-512.png"));

await sharp(trim)
  .resize(192, 192, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(path.join(outDir, "icon-192.png"));

await sharp(trim)
  .resize(410, 410, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .extend({
    top: 51,
    bottom: 51,
    left: 51,
    right: 51,
    background: { r: 15, g: 20, b: 25, alpha: 1 },
  })
  .png()
  .toFile(path.join(outDir, "icon-maskable-512.png"));

await sharp(trim)
  .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(path.join(outDir, "icon.png"));

await sharp(trim)
  .resize(32, 32, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(path.join(outDir, "favicon-32.png"));

// SVG wrapper referencing PNG is awkward for favicon; write a minimal SVG with embedded PNG
const png512 = await sharp(trim)
  .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
const b64 = png512.toString("base64");
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" role="img">
  <image width="512" height="512" xlink:href="data:image/png;base64,${b64}"/>
</svg>
`;
import fs from "fs";
fs.writeFileSync(path.join(outDir, "icon.svg"), svg);

console.log("icons written to", outDir);
