import { onDiagnosticEvent } from "openclaw/plugin-sdk";
import { createIntegrityChain } from "./integrity.js";
import { createRateLimiter } from "./ratelimit.js";
import { createRedactor } from "./redact.js";
import { createSyslogWriter, type SyslogWriter } from "./syslog.js";
import type {
  TelemetryConfig,
  TelemetryEvent,
  TelemetryEventInput,
} from "./types.js";
import { createTelemetryWriter, type TelemetryWriter } from "./writer.js";

/**
 * Minimal local interface matching the OpenClawPluginService contract.
 *
 * The canonical type lives in openclaw's internal plugin types but is not
 * re-exported from the public `openclaw/plugin-sdk` barrel, so we define a
 * structurally-compatible substitute here.
 */
type OpenClawPluginService = {
  id: string;
  start: (ctx: {
    config: Record<string, unknown> & { plugins?: { entries?: Record<string, { config?: unknown }> } };
    stateDir: string;
    logger: { info: (msg: string) => void };
  }) => void | Promise<void>;
  stop?: () => void | Promise<void>;
};

export type TelemetryService = OpenClawPluginService & {
  write: (evt: TelemetryEventInput) => void;
};

export function createTelemetryService(): TelemetryService {
  let fileWriter: TelemetryWriter | null = null;
  let syslogWriter: SyslogWriter | null = null;
  let unsubDiag: (() => void) | null = null;
  let logger: { info: (msg: string) => void } | null = null;
  let redactor = createRedactor();
  let integrity = createIntegrityChain();
  let rateLimiter = createRateLimiter();
  let seq = 0;

  const writeEvent = (evt: TelemetryEventInput) => {
    try {
      if (!rateLimiter.allow()) {
        return;
      }
      const redacted = redactor.redact(evt);
      const enriched: TelemetryEvent = {
        ...redacted,
        seq: ++seq,
        ts: Date.now(),
      } as TelemetryEvent;
      const signed = integrity.sign(enriched);

      fileWriter?.write(signed);
      syslogWriter?.write(signed);
    } catch (error) {
      try {
        const fallback = {
          type: "telemetry.error",
          seq: ++seq,
          ts: Date.now(),
          error:
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error),
          sourceType: (evt as { type?: string })?.type ?? "unknown",
        };
        fileWriter?.write(fallback);
      } catch {}
      logger?.info("telemetry: write error (captured)");
    }
  };

  return {
    id: "telemetry-hal",
    write: writeEvent,
    async start(ctx) {
      logger = ctx.logger;
      const cfg = ctx.config.plugins?.entries?.['telemetry-hal']?.config as
        | TelemetryConfig
        | undefined;
      if (!cfg?.enabled) {
        return;
      }

      const filePath = cfg.filePath ?? `${ctx.stateDir}/logs/telemetry.jsonl`;
      fileWriter = createTelemetryWriter(filePath, cfg.rotate);
      ctx.logger.info(`telemetry: ${filePath}`);

      if (cfg.rotate?.enabled) ctx.logger.info("telemetry: rotation enabled");
      if (cfg.redact?.enabled) {
        redactor = createRedactor(cfg.redact);
        ctx.logger.info("telemetry: redaction enabled");
      }
      if (cfg.integrity?.enabled) {
        integrity = createIntegrityChain(cfg.integrity);
        ctx.logger.info("telemetry: integrity enabled");
      }
      if (cfg.rateLimit?.enabled) {
        rateLimiter = createRateLimiter(cfg.rateLimit);
        ctx.logger.info("telemetry: rate limiting enabled");
      }
      if (cfg.syslog?.enabled && cfg.syslog.host) {
        syslogWriter = createSyslogWriter(cfg.syslog);
        ctx.logger.info(
          `telemetry: syslog -> ${cfg.syslog.host}:${cfg.syslog.port ?? 514}`,
        );
      }

      unsubDiag = onDiagnosticEvent((evt) => {
        if (evt.type === "model.usage") {
          writeEvent({
            type: "llm.usage",
            sessionKey: evt.sessionKey,
            provider: evt.provider,
            model: evt.model,
            inputTokens: evt.usage.input,
            outputTokens: evt.usage.output,
            cacheTokens: evt.usage.cacheRead,
            durationMs: evt.durationMs,
            costUsd: evt.costUsd,
          });
        }
      });
    },
    async stop() {
      unsubDiag?.();
      unsubDiag = null;
      logger = null;
      await fileWriter?.flush();
      fileWriter = null;
      await syslogWriter?.close();
      syslogWriter = null;
    },
  };
}
