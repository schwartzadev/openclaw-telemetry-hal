import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createTelemetryService } from "./src/service.js";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";

const FALLBACK_FILE_PATH =
  process.env.OPENCLAW_TELEMETRY_FILE ?? `${homedir()}/.openclaw/logs/telemetry.jsonl`;

function safeSerialize(payload: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(payload, (_key, value) => {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  });
}

export default {
  id: "telemetry-hal",
  name: "OpenClaw Telemetry for HAL",
  description: "Captures tool calls, LLM usage, and message events to JSONL",
  register(api: OpenClawPluginApi) {
    const svc = createTelemetryService();
    api.registerService(svc);
    const ctxOf = (evt: any, legacyCtx?: any) => legacyCtx ?? evt?.context ?? evt?.ctx ?? {};
    const emit = (payload: Record<string, unknown>) => {
      try {
        svc.write(payload as any);
      } catch {}
      try {
        mkdirSync(dirname(FALLBACK_FILE_PATH), { recursive: true });
        appendFileSync(FALLBACK_FILE_PATH, `${safeSerialize(payload)}\n`);
      } catch {}
    };

    api.on("before_tool_call", (evt: any, legacyCtx?: any) => {
      const ctx = ctxOf(evt, legacyCtx);
      emit({
        type: "tool.start",
        toolName: evt.toolName,
        params: evt.params,
        sessionKey: ctx.sessionKey ?? evt.sessionKey,
        agentId: ctx.agentId ?? evt.agentId,
      });
    });

    api.on("after_tool_call", (evt: any, legacyCtx?: any) => {
      const ctx = ctxOf(evt, legacyCtx);
      emit({
        type: "tool.end",
        toolName: evt.toolName,
        durationMs: evt.durationMs,
        success: !evt.error,
        error: evt.error,
        sessionKey: ctx.sessionKey ?? evt.sessionKey,
        agentId: ctx.agentId ?? evt.agentId,
      });
    });

    api.on("message_received", (evt: any, legacyCtx?: any) => {
      const ctx = ctxOf(evt, legacyCtx);
      emit({
        type: "message.in",
        channel: ctx.channelId ?? evt.channelId ?? evt.channel ?? "unknown",
        from: evt.from ?? evt.senderId ?? "unknown",
        content: evt.content ?? evt.text,
        contentLength: evt.content?.length,
        timestamp: evt.timestamp,
        metadata: evt.metadata,
      });
    });

    api.on("message_sending", (evt: any, legacyCtx?: any) => {
      const ctx = ctxOf(evt, legacyCtx);
      emit({
        type: "message.sending",
        channel: ctx.channelId ?? evt.channelId ?? evt.channel ?? "unknown",
        to: evt.to ?? evt.target ?? "unknown",
        content: evt.content ?? evt.text,
      });
    });

    api.on("message_sent", (evt: any, legacyCtx?: any) => {
      const ctx = ctxOf(evt, legacyCtx);
      emit({
        type: "message.out",
        channel: ctx.channelId ?? evt.channelId ?? evt.channel ?? "unknown",
        to: evt.to ?? evt.target ?? "unknown",
        content: evt.content ?? evt.text,
        success: evt.success ?? !evt.error,
        error: evt.error,
      });
    });

    api.on("before_agent_start", (evt: any, legacyCtx?: any) => {
      const ctx = ctxOf(evt, legacyCtx);
      emit({
        type: "agent.start",
        sessionKey: ctx.sessionKey ?? evt.sessionKey,
        agentId: ctx.agentId ?? evt.agentId,
        prompt: evt.prompt,
        promptLength: evt.prompt?.length,
        messages: evt.messages,
      });
    });

    api.on("agent_end", (evt: any, legacyCtx?: any) => {
      const ctx = ctxOf(evt, legacyCtx);
      emit({
        type: "agent.end",
        sessionKey: ctx.sessionKey ?? evt.sessionKey,
        agentId: ctx.agentId ?? evt.agentId,
        messages: evt.messages,
        success: evt.success,
        durationMs: evt.durationMs,
        error: evt.error,
      });
    });
  },
};
