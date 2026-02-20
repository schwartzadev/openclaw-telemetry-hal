import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createTelemetryService } from "./src/service.js";

export default {
  id: "telemetry-hal",
  name: "OpenClaw Telemetry for HAL",
  description: "Captures tool calls, LLM usage, and message events to JSONL",
  register(api: OpenClawPluginApi) {
    const svc = createTelemetryService();
    api.registerService(svc);

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
        durationMs: evt.durationMs,
        success: !evt.error,
        error: evt.error,
        sessionKey: ctx.sessionKey,
        agentId: ctx.agentId,
      });
    });

    api.on("message_received", (evt, ctx) => {
      svc.write({
        type: "message.in",
        channel: ctx.channelId,
        from: evt.from,
        content: evt.content,
        contentLength: evt.content?.length,
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

    api.on("before_agent_start", (evt, ctx) => {
      svc.write({
        type: "agent.start",
        sessionKey: ctx.sessionKey,
        agentId: ctx.agentId,
        prompt: evt.prompt,
        promptLength: evt.prompt?.length,
        messages: evt.messages,
      });
    });

    api.on("agent_end", (evt, ctx) => {
      svc.write({
        type: "agent.end",
        sessionKey: ctx.sessionKey,
        agentId: ctx.agentId,
        messages: evt.messages,
        success: evt.success,
        durationMs: evt.durationMs,
        error: evt.error,
      });
    });
  },
};
