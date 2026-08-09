import pino from "pino";

import { loadConfig } from "@/lib/config";

let loggerInstance: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (loggerInstance) {
    return loggerInstance;
  }

  const config = loadConfig();
  const isDev = process.env.NODE_ENV !== "production";

  loggerInstance = pino({
    level: config.logging.level,
    ...(isDev
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:standard" },
          },
        }
      : {}),
  });

  return loggerInstance;
}
