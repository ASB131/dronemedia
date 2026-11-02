import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cesiumBuild = join(root, "node_modules", "cesium", "Build", "Cesium");
const dest = join(root, "public", "cesium");

if (!existsSync(cesiumBuild)) {
  console.warn("copy-cesium-assets: cesium not installed, skipping");
  process.exit(0);
}

const dirs = ["Assets", "ThirdParty", "Workers", "Widgets"];
if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true });
}
mkdirSync(dest, { recursive: true });

for (const dir of dirs) {
  cpSync(join(cesiumBuild, dir), join(dest, dir), { recursive: true });
}

console.log("copy-cesium-assets: copied Cesium runtime assets to public/cesium");
