import XXH from "xxhashjs";

import { createHash } from "node:crypto";

import { loadConfig } from "@/lib/config";

export type HashDigests = {
  xxhash: string;
  sha256: string;
};

export type HashResult = {
  algorithm: "xxhash" | "sha256";
  hash: string;
  digests: HashDigests;
};

function finalizeDigests(xxhash: string, sha256: string): HashResult {
  const config = loadConfig();
  const digests: HashDigests = { xxhash, sha256 };
  const algorithm = config.deduplication.algorithm;
  return {
    algorithm,
    hash: digests[algorithm],
    digests,
  };
}

export async function hashFileBuffer(data: Buffer): Promise<HashResult> {
  const xxhash = XXH.h64(0)
    .update(data)
    .digest()
    .toString(16)
    .padStart(16, "0");
  const sha256 = createHash("sha256").update(data).digest("hex");
  return finalizeDigests(xxhash, sha256);
}

/** Incrementally hash a readable stream without buffering the whole object. */
export async function hashFileStream(
  stream: NodeJS.ReadableStream,
): Promise<HashResult> {
  const xx = XXH.h64(0);
  const sha = createHash("sha256");
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    xx.update(buf);
    sha.update(buf);
  }
  return finalizeDigests(
    xx.digest().toString(16).padStart(16, "0"),
    sha.digest("hex"),
  );
}

/**
 * Streaming hasher for the configured primary algorithm only.
 * Used during upload assemble so we don't pay for a second full-file SHA-256
 * pass on every multi-GB video.
 */
export function createPrimaryContentHasher() {
  const algorithm = loadConfig().deduplication.algorithm;
  if (algorithm === "sha256") {
    const sha = createHash("sha256");
    return {
      update(buf: Buffer) {
        sha.update(buf);
      },
      digest(): HashResult {
        return finalizeDigests("", sha.digest("hex"));
      },
    };
  }

  const xx = XXH.h64(0);
  return {
    update(buf: Buffer) {
      xx.update(buf);
    },
    digest(): HashResult {
      return finalizeDigests(
        xx.digest().toString(16).padStart(16, "0"),
        "",
      );
    },
  };
}
