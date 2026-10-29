/**
 * Allow only same-origin relative paths for post-login redirects.
 * Rejects protocol-relative (`//evil.com`), backslash tricks, and absolute URLs.
 */
export function safeInternalRedirectPath(
  value: unknown,
  fallback = "/",
): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return fallback;
  if (trimmed.startsWith("//")) return fallback;
  if (trimmed.includes("\\")) return fallback;
  if (trimmed.includes("://")) return fallback;
  // Disallow control characters and encoded protocol-relative tricks.
  if (/[\u0000-\u001f]/.test(trimmed)) return fallback;
  try {
    const decoded = decodeURIComponent(trimmed);
    if (decoded.startsWith("//") || decoded.includes("://")) return fallback;
  } catch {
    return fallback;
  }
  return trimmed;
}
