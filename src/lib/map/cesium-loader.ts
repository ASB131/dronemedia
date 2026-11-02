/** Load prebuilt Cesium from /public/cesium (not bundled — avoids Turbopack parse errors). */

const CESIUM_BASE = "/cesium/";
const SCRIPT_URL = `${CESIUM_BASE}Cesium.js`;
const STYLESHEET_URL = `${CESIUM_BASE}Widgets/widgets.css`;

export type CesiumNamespace = typeof import("cesium");

declare global {
  interface Window {
    Cesium?: CesiumNamespace;
    CESIUM_BASE_URL?: string;
  }
}

let loadPromise: Promise<CesiumNamespace> | null = null;

function ensureStylesheet() {
  if (document.querySelector(`link[href="${STYLESHEET_URL}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLESHEET_URL;
  document.head.appendChild(link);
}

export function loadCesium(): Promise<CesiumNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Cesium requires a browser"));
  }

  window.CESIUM_BASE_URL = CESIUM_BASE;

  if (window.Cesium) {
    return Promise.resolve(window.Cesium);
  }

  if (!loadPromise) {
    loadPromise = new Promise((resolve, reject) => {
      ensureStylesheet();
      const existing = document.querySelector(
        `script[src="${SCRIPT_URL}"]`,
      ) as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener("load", () => {
          if (window.Cesium) resolve(window.Cesium);
          else reject(new Error("Cesium global missing after load"));
        });
        existing.addEventListener("error", () =>
          reject(new Error("Cesium script failed")),
        );
        return;
      }

      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (window.Cesium) resolve(window.Cesium);
        else reject(new Error("Cesium global missing after load"));
      };
      script.onerror = () => reject(new Error("Cesium script failed to load"));
      document.head.appendChild(script);
    });
  }

  return loadPromise;
}
