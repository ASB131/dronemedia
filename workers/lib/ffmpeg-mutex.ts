/**
 * Serialize ffmpeg-heavy jobs in a single worker process so proxy/HLS and
 * sequence export cannot stack multi-GB RSS peaks.
 */
let chain: Promise<void> = Promise.resolve();

export async function withFfmpegLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = chain;
  chain = previous.then(() => gate);
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
