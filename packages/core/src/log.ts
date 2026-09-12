import pino from "pino";
import { randomUUID } from "node:crypto";
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: {
    resource: {
      "service.name": process.env.SERVICE_NAME ?? "agent-wiki",
      "service.version": process.env.IMAGE_TAG ?? "dev",
      "deployment.environment.name": process.env.NODE_ENV ?? "development",
    },
  },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  messageKey: "body",
  formatters: {
    level(label) {
      return {
        severityText: label.toUpperCase(),
        severityNumber: (
          {
            trace: 1,
            debug: 5,
            info: 9,
            warn: 13,
            error: 17,
            fatal: 21,
          } as Record<string, number>
        )[label],
      };
    },
  },
  redact: [
    "req.headers",
    "authorization",
    "password",
    "token",
    "content",
    "prompt",
  ],
});
export function log(
  level: "info" | "warn" | "error",
  event: string,
  attrs: Record<string, unknown> = {},
) {
  logger[level](
    {
      eventName: event,
      attributes: {
        "agent_wiki.event_id": randomUUID(),
        ...Object.fromEntries(
          Object.entries(attrs).map(([k, v]) => ["agent_wiki." + k, v]),
        ),
      },
    },
    event,
  );
}
