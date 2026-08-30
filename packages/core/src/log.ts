import { randomUUID } from "node:crypto";

/** Structured JSON logs; every line carries a correlation_id. */
export function createLogger(correlationId: string = randomUUID()) {
  const write = (level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) => {
    console.log(
      JSON.stringify({
        level,
        msg,
        correlation_id: correlationId,
        ts: new Date().toISOString(),
        ...extra,
      }),
    );
  };
  return {
    correlationId,
    info: (msg: string, extra?: Record<string, unknown>) => write("info", msg, extra),
    warn: (msg: string, extra?: Record<string, unknown>) => write("warn", msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => write("error", msg, extra),
  };
}
