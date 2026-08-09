export type ParsedCubeLut = {
  title: string | null;
  size: number;
  /** Interleaved RGB floats, length size^3 * 3, domain-normalized to 0–1. */
  data: Float32Array;
};

const MAX_CUBE_BYTES = 8 * 1024 * 1024;
const MIN_SIZE = 2;
const MAX_SIZE = 128;

export function assertCubeFileLimits(fileName: string, byteLength: number) {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith(".cube")) {
    throw new Error("Only .cube LUT files are supported");
  }
  if (byteLength <= 0 || byteLength > MAX_CUBE_BYTES) {
    throw new Error("LUT file must be between 1 byte and 8 MB");
  }
}

/** Lightweight header checks before storing an upload. */
export function validateCubeText(text: string): { title: string | null; size: number } {
  let title: string | null = null;
  let size: number | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const titleMatch = /^TITLE\s+(.+)$/i.exec(line);
    if (titleMatch) {
      title = titleMatch[1]!.replace(/^"|"$/g, "").trim() || null;
      continue;
    }

    const sizeMatch = /^LUT_3D_SIZE\s+(\d+)$/i.exec(line);
    if (sizeMatch) {
      size = Number(sizeMatch[1]);
      continue;
    }

    if (/^LUT_1D_SIZE\b/i.test(line)) {
      throw new Error("1D LUTs are not supported; upload a 3D .cube");
    }
  }

  if (size == null || !Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
    throw new Error(`Invalid or missing LUT_3D_SIZE (expected ${MIN_SIZE}–${MAX_SIZE})`);
  }

  return { title, size };
}

export function parseCubeLut(text: string): ParsedCubeLut {
  const { title, size } = validateCubeText(text);
  const expected = size * size * size;
  const data = new Float32Array(expected * 3);
  let write = 0;

  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^(TITLE|LUT_3D_SIZE|LUT_1D_SIZE|DOMAIN_MIN|DOMAIN_MAX)\b/i.test(line)) {
      const domainMinMatch = /^DOMAIN_MIN\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)$/i.exec(
        line,
      );
      if (domainMinMatch) {
        domainMin = [
          Number(domainMinMatch[1]),
          Number(domainMinMatch[2]),
          Number(domainMinMatch[3]),
        ];
      }
      const domainMaxMatch = /^DOMAIN_MAX\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)$/i.exec(
        line,
      );
      if (domainMaxMatch) {
        domainMax = [
          Number(domainMaxMatch[1]),
          Number(domainMaxMatch[2]),
          Number(domainMaxMatch[3]),
        ];
      }
      continue;
    }

    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    if (![r, g, b].every(Number.isFinite)) {
      throw new Error("Corrupt .cube data row");
    }
    if (write + 3 > data.length) {
      throw new Error("Too many data rows in .cube file");
    }
    data[write++] = r;
    data[write++] = g;
    data[write++] = b;
  }

  if (write !== data.length) {
    throw new Error(
      `Expected ${expected} RGB triplets, found ${write / 3}`,
    );
  }

  // Normalize if DOMAIN is non-standard (rare for preview LUTs).
  const needsNorm =
    domainMin.some((v, i) => v !== 0 || domainMax[i] !== 1);
  if (needsNorm) {
    for (let i = 0; i < data.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        const min = domainMin[c]!;
        const max = domainMax[c]!;
        const span = max - min || 1;
        data[i + c] = (data[i + c]! - min) / span;
      }
    }
  }

  return { title, size, data };
}

export const LUT_MAX_BYTES = MAX_CUBE_BYTES;

export function lutStorageKey(lutId: string) {
  return `luts/${lutId}.cube`;
}
