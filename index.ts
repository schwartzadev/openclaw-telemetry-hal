import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createTelemetryService } from "./src/service.js";

export default {
  id: "telemetry",
  name: "OpenClaw Telemetry",
  description: "Captures tool calls, LLM usage, and message events to JSONL",
  version: "0.2.0",
  register(api: OpenClawPluginApi) {
    const svc = createTelemetryService();
    api.registerService(svc);

    // ── Tool calls (fires for main + subagents) ──
    api.on("before_tool_call", (evt, ctx) => {
      svc.write({
        type: "tool.start",
        toolName: evt.toolName,
        params: evt.params,
        sessionKey: ctx.sessionKey,
        agentId: ctx.agentId,
      });
    });

    api.on("after_tool_call", (evt, ctx) => {
      svc.write({
        type: "tool.end",
        toolName: evt.toolName,
        params: evt.params,
        result: evt.result,
        durationMs: evt.durationMs,
        success: !evt.error,
        error: evt.error,
        sessionKey: ctx.sessionKey,
        agentId: ctx.agentId,
      });
    });

    // ── Messages ──
    api.on("message_received", (evt, ctx) => {
      svc.write({
        type: "message.in",
        channel: ctx.channelId,
        from: evt.from,
        content: evt.content,
        contentLength: evt.content?.length ?? 0,
        timestamp: evt.timestamp,
        metadata: evt.metadata,
      });
    });

    api.on("message_sending", (evt, ctx) => {
      svc.write({
        type: "message.sending",
        channel: ctx.channelId,
        to: evt.to,
        content: evt.content,
      });
    });

    api.on("message_sent", (evt, ctx) => {
      svc.write({
        type: "message.out",
        channel: ctx.channelId,
        to: evt.to,
        content: evt.content,
        success: evt.success,
        error: evt.error,
      });
    });

    // ── Agent lifecycle (fires for main + subagents) ──
    api.on("before_agent_start", (evt, ctx) => {
      svc.write({
        type: "agent.start",
        sessionKey: ctx.sessionKey,
        agentId: ctx.agentId,
        prompt: evt.prompt,
        promptLength: evt.prompt?.length ?? 0,
        messageCount: evt.messages?.length,
      });
    });

    api.on("agent_end", (evt, ctx) => {
      svc.write({
        type: "agent.end",
        sessionKey: ctx.sessionKey,
        agentId: ctx.agentId,
        success: evt.success,
        durationMs: evt.durationMs,
        messageCount: evt.messages?.length,
        error: evt.error,
      });
    });

    // ── Session lifecycle ──
    api.on("session_start", (evt, ctx) => {
      svc.write({
        type: "session.start",
        sessionId: evt.sessionId,
        agentId: ctx.agentId,
      });
    });

    api.on("session_end", (evt, ctx) => {
      svc.write({
        type: "session.end",
        sessionId: evt.sessionId,
        agentId: ctx.agentId,
        messageCount: evt.messageCount,
        durationMs: evt.durationMs,
      });
    });

    // Note: LLM usage is captured via onDiagnosticEvent in src/service.ts start()
  },
};
