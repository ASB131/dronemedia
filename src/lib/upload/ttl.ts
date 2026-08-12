/** Assembled-but-never-committed uploads are purged after this age. */
export const COMPLETE_UNCOMMITTED_TTL_MS = 6 * 60 * 60 * 1000;

/** Failed commit / assemble leftovers — shorter than incomplete TTL (24h). */
export const FAILED_UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;
