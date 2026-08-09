import Redis from "ioredis";

import { auth } from "@/auth";
import { getRedisUrl, loadConfig } from "@/lib/config";
import { CHANNEL_KEY } from "@/lib/notifications/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.approvalStatus !== "approved") {
    return new Response("Unauthorized", { status: 401 });
  }

  const config = loadConfig();
  if (!config.notifications.sse.enabled) {
    return new Response("SSE disabled", { status: 503 });
  }

  const userId = session.user.id;
  const subscriber = new Redis(getRedisUrl());
  const channel = CHANNEL_KEY(userId);

  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();

      const push = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      push(JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }));

      await subscriber.subscribe(channel);
      subscriber.on("message", (_ch, message) => {
        push(message);
      });

      heartbeat = setInterval(() => {
        push(JSON.stringify({ type: "heartbeat", timestamp: new Date().toISOString() }));
      }, config.notifications.sse.heartbeatIntervalSeconds * 1000);
    },
    async cancel() {
      if (heartbeat) clearInterval(heartbeat);
      await subscriber.unsubscribe(channel);
      await subscriber.quit();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
