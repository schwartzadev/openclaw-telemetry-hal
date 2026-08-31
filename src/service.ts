import { onDiagnosticEvent } from "openclaw/plugin-sdk";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
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
    logger: { info: (msg: string) => void; warn?: (msg: string) => void };
  }) => void | Promise<void>;
  stop?: () => void | Promise<void>;
};

/** Where llm.usage comes from once the service is running. */
export type UsageSource = "internal" | "public" | "public-live" | "none";

export type TelemetryService = OpenClawPluginService & {
  write: (evt: TelemetryEventInput) => void;
  /** True once start() ran with config.enabled === true. */
  isStarted: () => boolean;
  /**
   * "internal": subscribed via onInternalDiagnosticEvent (model.usage arrives).
   * "public": only the public onDiagnosticEvent listener could be installed;
   *   the gateway emits model.usage as a *trusted* event and the public
   *   listener filters trusted events out, so nothing is expected to arrive
   *   and the llm_output hook in index.ts supplies llm.usage instead.
   * "public-live": the public listener has in fact delivered a model.usage
   *   (a gateway that emits it untrusted); the bus is the source from then on.
   * "none": service not started.
   */
  usageSource: () => UsageSource;
  /** True when llm.usage is known to arrive from the diagnostic bus. */
  busDeliversUsage: () => boolean;
};

const PLUGIN_ID = "telemetry-hal";

/**
 * Where hook events go when the service is NOT running (no config block, or
 * hooks firing before start()). This is the only path that may write without
 * the writer/rotation/integrity pipeline, and it still stamps ts/seq, still
 * redacts with the default patterns, and marks the line with fallback:true so
 * consumers can tell the two apart.
 */
const FALLBACK_FILE_PATH =
  process.env.OPENCLAW_TELEMETRY_FILE ??
  `${process.env.OPENCLAW_STATE_DIR ?? `${homedir()}/.openclaw`}/logs/telemetry.jsonl`;

/**
 * model.usage is emitted by the gateway with emitTrustedDiagnosticEvent. The
 * public `onDiagnosticEvent` exported from "openclaw/plugin-sdk" is a wrapper
 * over onInternalDiagnosticEvent that DROPS trusted events, so a plugin that
 * subscribes through it never sees model.usage (the fable run: 0 llm.usage
 * lines even with the service on). onInternalDiagnosticEvent is exported from
 * the "openclaw/plugin-sdk/diagnostic-runtime" subpath (2026.5.18 onwards at
 * runtime; its .d.ts only declares it from 2026.6.x). The specifier is kept in
 * a variable so TypeScript does not resolve the module: the plugin's lockfile
 * pins the 2026.5.18 types, and a static import would fail to type-check there
 * -- or fail to *load* on a gateway without the subpath. Loading it dynamically
 * keeps the plugin usable on any version; the caller falls back to the public
 * listener when the subpath or the export is missing.
 */
const DIAGNOSTIC_RUNTIME_MODULE = "openclaw/plugin-sdk/diagnostic-runtime";

type DiagnosticListener = (evt: any, metadata?: any) => void;
type DiagnosticSubscription = { unsubscribe: () => void; source: "internal" | "public" };

async function subscribeModelUsage(listener: DiagnosticListener): Promise<DiagnosticSubscription> {
  try {
    const mod = (await import(DIAGNOSTIC_RUNTIME_MODULE)) as Record<string, unknown>;
    const onInternal = mod.onInternalDiagnosticEvent;
    if (typeof onInternal === "function") {
      const unsubscribe = onInternal((evt: any, metadata: any) => {
        if (evt?.type === "model.usage") listener(evt, metadata);
      });
      return { unsubscribe: typeof unsubscribe === "function" ? unsubscribe : () => {}, source: "internal" };
    }
  } catch {
    // subpath not exported by this SDK version, or not aliased by the loader
  }
  const unsubscribe = onDiagnosticEvent((evt: any) => {
    if (evt?.type === "model.usage") listener(evt);
  });
  return { unsubscribe, source: "public" };
}

function safeSerialize(evt: object): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(evt, (_key, value) => {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  });
}

export function createTelemetryService(): TelemetryService {
  let fileWriter: TelemetryWriter | null = null;
  let syslogWriter: SyslogWriter | null = null;
  let unsubDiag: (() => void) | null = null;
  let usageSource: UsageSource = "none";
  let logger: { info: (msg: string) => void; warn?: (msg: string) => void } | null = null;
  let redactor = createRedactor();
  const fallbackRedactor = createRedactor({ enabled: true });
  let integrity = createIntegrityChain();
  let rateLimiter = createRateLimiter();
  let seq = 0;
  let started = false;
  // "disabled" = operator explicitly set config.enabled=false: write nothing.
  // "unconfigured" = no config block at all: fall back to raw stamped writes
  // so a mis-provisioned box still leaves a trail (and says so in the log).
  let mode: "starting" | "started" | "unconfigured" | "disabled" = "starting";
  let droppedSinceLast = 0;

  const fallbackWrite = (evt: TelemetryEventInput) => {
    try {
      const stamped = {
        ...fallbackRedactor.redact(evt),
        seq: ++seq,
        ts: Date.now(),
        fallback: true,
      };
      mkdirSync(dirname(FALLBACK_FILE_PATH), { recursive: true });
      appendFileSync(FALLBACK_FILE_PATH, `${safeSerialize(stamped)}\n`);
    } catch {}
  };

  const writeEvent = (evt: TelemetryEventInput) => {
    if (!started) {
      if (mode !== "disabled") fallbackWrite(evt);
      return;
    }
    try {
      if (!rateLimiter.allow()) {
        // Never drop silently: the next admitted event carries the count.
        droppedSinceLast++;
        return;
      }
      const redacted = redactor.redact(evt);
      const enriched: TelemetryEvent = {
        ...redacted,
        seq: ++seq,
        ts: Date.now(),
        ...(droppedSinceLast > 0 ? { droppedSinceLast } : {}),
      } as TelemetryEvent;
      droppedSinceLast = 0;
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
          sessionKey: (evt as { sessionKey?: string })?.sessionKey,
        };
        fileWriter?.write(fallback);
      } catch {}
      logger?.info("telemetry: write error (captured)");
    }
  };

  return {
    id: PLUGIN_ID,
    write: writeEvent,
    isStarted: () => started,
    usageSource: () => usageSource,
    busDeliversUsage: () => usageSource === "internal" || usageSource === "public-live",
    async start(ctx) {
      logger = ctx.logger;
      const warn = ctx.logger.warn ?? ctx.logger.info;
      const entry = ctx.config.plugins?.entries?.[PLUGIN_ID];
      const cfg = entry?.config as TelemetryConfig | undefined;
      if (!cfg?.enabled) {
        // This is the state the fable run was in: plugins.entries.telemetry-hal
        // = {enabled:true} (plugin loads, hooks fire) but no .config block, so
        // the service never started and nothing was stamped/redacted/rotated.
        // Say so loudly instead of returning in silence.
        mode = cfg?.enabled === false ? "disabled" : "unconfigured";
        warn(
          mode === "disabled"
            ? `telemetry: service disabled by plugins.entries.${PLUGIN_ID}.config.enabled=false; hook events are discarded`
            : `telemetry: plugins.entries.${PLUGIN_ID}.config.enabled is not set; service NOT started (no rotation/integrity/llm.usage). Hook events fall back to ${FALLBACK_FILE_PATH} with default redaction`,
        );
        return;
      }

      const filePath = cfg.filePath ?? `${ctx.stateDir}/logs/telemetry.jsonl`;
      fileWriter = createTelemetryWriter(filePath, cfg.rotate);
      ctx.logger.info(`telemetry: ${filePath}`);

      if (cfg.rotate?.enabled) ctx.logger.info("telemetry: rotation enabled");
      // Redaction is ON unless the operator explicitly turns it off. The
      // upstream default (off unless redact.enabled === true) meant a service
      // enabled by hand wrote raw tool arguments and message bodies -- the
      // not-started fallback path already redacted by default, so the started
      // path must not be the weaker of the two.
      if (cfg.redact?.enabled === false) {
        warn("telemetry: redaction DISABLED by config.redact.enabled=false");
      } else {
        try {
          redactor = createRedactor({ ...cfg.redact, enabled: true });
          ctx.logger.info(
            `telemetry: redaction enabled${cfg.redact?.enabled === undefined ? " (default)" : ""}`,
          );
        } catch (error) {
          // A pattern that fails to compile must not take the pipeline down:
          // keep the built-in patterns and say which config was ignored.
          redactor = createRedactor({ enabled: true, replacement: cfg.redact?.replacement });
          warn(
            `telemetry: config.redact.patterns rejected (${
              error instanceof Error ? error.message : String(error)
            }); using default patterns`,
          );
        }
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

      started = true;
      mode = "started";

      // model.usage is emitted once per agent run (aggregate of every model
      // call in the run) by the gateway when config.diagnostics.enabled !== false.
      // costUsd is the gateway's estimate from its model cost table. The
      // session store's per-message usage.cost is finer-grained (per call,
      // split by bucket); this event is the cheap cross-check, not the ledger.
      const subscription = await subscribeModelUsage((evt: any, metadata?: any) => {
        if (usageSource === "public") usageSource = "public-live";
        writeEvent({
          type: "llm.usage",
          source: "model.usage",
          trusted: metadata?.trusted,
          sessionKey: evt.sessionKey,
          sessionId: evt.sessionId,
          agentId: evt.agentId,
          runId: evt.runId,
          channel: evt.channel,
          provider: evt.provider,
          model: evt.model,
          inputTokens: evt.usage?.input,
          outputTokens: evt.usage?.output,
          cacheTokens: evt.usage?.cacheRead,
          cacheWriteTokens: evt.usage?.cacheWrite,
          promptTokens: evt.usage?.promptTokens,
          totalTokens: evt.usage?.total,
          lastCallUsage: evt.lastCallUsage,
          contextLimit: evt.context?.limit,
          contextUsed: evt.context?.used,
          durationMs: evt.durationMs,
          costUsd: evt.costUsd,
        } as TelemetryEventInput);
      });
      unsubDiag = subscription.unsubscribe;
      usageSource = subscription.source;
      if (subscription.source === "internal") {
        ctx.logger.info("telemetry: llm.usage from the internal diagnostic bus (model.usage)");
      } else {
        warn(
          `telemetry: ${DIAGNOSTIC_RUNTIME_MODULE} unavailable; public onDiagnosticEvent drops trusted model.usage, so llm.usage comes from the llm_output hook (no costUsd)`,
        );
      }
    },
    async stop() {
      unsubDiag?.();
      unsubDiag = null;
      usageSource = "none";
      logger = null;
      started = false;
      await fileWriter?.flush();
      fileWriter = null;
      await syslogWriter?.close();
      syslogWriter = null;
    },
  };
}
