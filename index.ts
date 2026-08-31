import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createHash } from "node:crypto";
import { createTelemetryService } from "./src/service.js";

/**
 * Upper bound on the number of context messages copied into a single
 * agent.start / agent.end event. The first event after a gateway (re)start has
 * no cursor for the session, so the whole history would otherwise be copied
 * once; the session store already holds the full transcript, so we keep the
 * tail only and mark the truncation.
 */
const MAX_DELTA_MESSAGES = 50;
/** Bound on the run-id dedupe set (insertion-ordered; oldest evicted). */
const MAX_TRACKED_RUNS = 2000;
/** Bound on the per-session system-prompt hash map (insertion-ordered). */
const MAX_TRACKED_SESSIONS = 500;

export default {
  id: "telemetry-hal",
  name: "OpenClaw Telemetry for HAL",
  description: "Captures tool calls, LLM usage, and message events to JSONL",
  register(api: OpenClawPluginApi) {
    const svc = createTelemetryService();
    api.registerService(svc);
    const ctxOf = (evt: any, legacyCtx?: any) => legacyCtx ?? evt?.context ?? evt?.ctx ?? {};

    // Envelope shared by every event: identity fields come from the typed hook
    // context first (PluginHookAgentContext / PluginHookMessageContext), then
    // from the event itself. Undefined fields are dropped by JSON.stringify.
    const envelope = (evt: any, ctx: any) => ({
      sessionKey: ctx.sessionKey ?? evt?.sessionKey,
      agentId: ctx.agentId ?? evt?.agentId,
      sessionId: ctx.sessionId ?? evt?.sessionId,
      runId: evt?.runId ?? ctx.runId,
    });

    // svc.write() never throws: when the service has not started it writes a
    // stamped + redacted fallback line itself (see service.ts). The old
    // unconditional appendFileSync here produced a second, unredacted,
    // unstamped copy of every event whenever the service WAS enabled.
    const emit = (payload: Record<string, unknown>) => svc.write(payload as any);

    // Insertion-ordered bounded map: the oldest key is evicted past `max`.
    const remember = <V>(map: Map<string, V>, key: string, value: V, max: number) => {
      map.set(key, value);
      if (map.size > max) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
    };

    // ---- context delta tracking -------------------------------------------
    // before_agent_start / agent_end hand us the session's full message array
    // every turn. Logging it wholesale is O(n^2) over a run (the fable run
    // wrote 552 MB of agent.start for 3.9 MB of actual new messages). We keep a
    // per-session cursor and log only what was appended since the previous
    // event for that session, plus counts.
    const cursors = new Map<string, number>();
    const contextDelta = (sessionKey: string | undefined, messages: unknown) => {
      if (!Array.isArray(messages)) return {};
      const key = sessionKey ?? "?";
      const prev = cursors.get(key) ?? 0;
      const reset = messages.length < prev; // compaction / reset / history reload
      const start = reset ? 0 : prev;
      const delta = messages.slice(start);
      cursors.set(key, messages.length);
      const truncated = delta.length > MAX_DELTA_MESSAGES;
      return {
        messageCount: messages.length,
        newMessageCount: delta.length,
        ...(reset ? { contextReset: true, previousMessageCount: prev } : {}),
        newMessages: truncated ? delta.slice(-MAX_DELTA_MESSAGES) : delta,
        ...(truncated ? { newMessagesTruncated: delta.length - MAX_DELTA_MESSAGES } : {}),
      };
    };

    // ---- agent.start dedupe -------------------------------------------------
    // On OpenClaw 2026.7.x the deprecated before_agent_start hook fires TWICE
    // per run: once in the model-resolve phase ({prompt} only) and once in the
    // prompt-build phase ({prompt, messages}); the fable run logged 716
    // agent.start for 358 runs. before_prompt_build fires exactly once with
    // {prompt, messages} and is not deprecated, so it is the primary source;
    // before_agent_start is kept for older gateways and only honoured when it
    // carries messages and the run has not been logged yet.
    const loggedRuns = new Map<string, true>();
    const onAgentStart = (hook: "before_prompt_build" | "before_agent_start") =>
      (evt: any, legacyCtx?: any) => {
        const ctx = ctxOf(evt, legacyCtx);
        const env = envelope(evt, ctx);
        if (hook === "before_agent_start" && !Array.isArray(evt?.messages)) return;
        const runKey =
          env.runId ??
          `${env.sessionKey ?? "?"}|${evt?.prompt?.length ?? 0}|${evt?.messages?.length ?? 0}`;
        if (loggedRuns.has(runKey)) return;
        remember(loggedRuns, runKey, true, MAX_TRACKED_RUNS);
        emit({
          type: "agent.start",
          ...env,
          hook,
          trigger: ctx.trigger,
          channel: ctx.channelId ?? ctx.channel,
          prompt: evt.prompt,
          promptLength: evt.prompt?.length,
          ...contextDelta(env.sessionKey, evt.messages),
        });
      };

    api.on("before_tool_call", (evt: any, legacyCtx?: any) => {
      const ctx = ctxOf(evt, legacyCtx);
      emit({
        type: "tool.start",
        ...envelope(evt, ctx),
        toolName: evt.toolName,
        toolCallId: evt.toolCallId,
        params: evt.params,
      });
    });

    api.on("after_tool_call", (evt: any, legacyCtx?: any) => {
      const ctx = ctxOf(evt, legacyCtx);
      emit({
        type: "tool.end",
        ...envelope(evt, ctx),
        toolName: evt.toolName,
        toolCallId: evt.toolCallId,
        durationMs: evt.durationMs,
        success: !evt.error,
        error: evt.error,
      });
    });

    // message_* hooks run at the channel layer; their ctx is a
    // PluginHookMessageContext (channelId/accountId/conversationId/messageId and,
    // once routed, sessionKey/runId). The old handlers dropped all of it.
    const messageEnvelope = (evt: any, ctx: any) => ({
      ...envelope(evt, ctx),
      channel: ctx.channelId ?? evt.channelId ?? evt.channel ?? "unknown",
      accountId: ctx.accountId,
      conversationId: ctx.conversationId ?? evt.conversationId,
      messageId: ctx.messageId ?? evt.messageId,
    });

    api.on("message_received", (evt: any, legacyCtx?: any) => {
      const ctx = ctxOf(evt, legacyCtx);
      emit({
        type: "message.in",
        ...messageEnvelope(evt, ctx),
        from: evt.from ?? evt.senderId ?? ctx.senderId ?? "unknown",
        content: evt.content ?? evt.text,
        contentLength: (evt.content ?? evt.text)?.length,
        timestamp: evt.timestamp,
        metadata: evt.metadata,
      });
    });

    api.on("message_sending", (evt: any, legacyCtx?: any) => {
      const ctx = ctxOf(evt, legacyCtx);
      emit({
        type: "message.sending",
        ...messageEnvelope(evt, ctx),
        to: evt.to ?? evt.target ?? "unknown",
        content: evt.content ?? evt.text,
      });
    });

    api.on("message_sent", (evt: any, legacyCtx?: any) => {
      const ctx = ctxOf(evt, legacyCtx);
      emit({
        type: "message.out",
        ...messageEnvelope(evt, ctx),
        to: evt.to ?? evt.target ?? "unknown",
        content: evt.content ?? evt.text,
        success: evt.success ?? !evt.error,
        error: evt.error,
      });
    });

    api.on("before_prompt_build", onAgentStart("before_prompt_build"));
    api.on("before_agent_start", onAgentStart("before_agent_start"));

    // ---- system prompt ----------------------------------------------------
    // before_prompt_build / before_agent_start carry {prompt, messages} only;
    // the assembled system prompt is exposed by llm_input, which fires once per
    // model submission with the history that was actually sent. llm_input is a
    // "conversation" hook: like agent_end it is refused for non-bundled
    // plugins unless plugins.entries.telemetry-hal.hooks.allowConversationAccess
    // is true. We log sha256 + length on every submission and the full text
    // once per session whenever the hash changes, so the record shows exactly
    // what the model saw without repeating a multi-KB prompt on every turn.
    const systemPromptHashes = new Map<string, string>();
    api.on("llm_input", (evt: any, legacyCtx?: any) => {
      const ctx = ctxOf(evt, legacyCtx);
      const env = envelope(evt, ctx);
      const systemPrompt = typeof evt?.systemPrompt === "string" ? evt.systemPrompt : undefined;
      const sha256 =
        systemPrompt === undefined
          ? undefined
          : createHash("sha256").update(systemPrompt).digest("hex");
      const sessionKey = env.sessionKey ?? env.sessionId ?? "?";
      if (sha256 !== undefined && systemPromptHashes.get(sessionKey) !== sha256) {
        remember(systemPromptHashes, sessionKey, sha256, MAX_TRACKED_SESSIONS);
        emit({
          type: "system.prompt",
          ...env,
          provider: evt.provider,
          model: evt.model,
          sha256,
          length: systemPrompt?.length,
          text: systemPrompt,
        });
      }
      emit({
        type: "llm.input",
        ...env,
        provider: evt.provider,
        model: evt.model,
        systemPromptSha256: sha256,
        systemPromptLength: systemPrompt?.length,
        promptLength: evt.prompt?.length,
        historyMessageCount: Array.isArray(evt.historyMessages) ? evt.historyMessages.length : undefined,
        imagesCount: evt.imagesCount,
        toolCount: Array.isArray(evt.tools) ? evt.tools.length : undefined,
      });
    });

    // ---- llm.usage fallback -----------------------------------------------
    // The service subscribes to the gateway's internal diagnostic bus for
    // model.usage (per run, with the gateway's cost estimate). If that
    // subscription could not be established (an SDK without the
    // diagnostic-runtime subpath, or one that moves it) and nothing has
    // arrived through the public listener either, llm_output -- a typed hook
    // carrying the same per-run token usage, minus cost -- takes over, so
    // every run still yields one llm.usage line. (Also active while the
    // service has not started: the line then goes to the fallback file.)
    api.on("llm_output", (evt: any, legacyCtx?: any) => {
      if (svc.busDeliversUsage()) return;
      const ctx = ctxOf(evt, legacyCtx);
      emit({
        type: "llm.usage",
        ...envelope(evt, ctx),
        source: "llm_output",
        provider: evt.provider,
        model: evt.model,
        resolvedRef: evt.resolvedRef,
        inputTokens: evt.usage?.input,
        outputTokens: evt.usage?.output,
        cacheTokens: evt.usage?.cacheRead,
        cacheWriteTokens: evt.usage?.cacheWrite,
        totalTokens: evt.usage?.total,
        contextLimit: evt.contextTokenBudget,
      });
    });

    // agent_end is a "conversation" hook: for non-bundled plugins the gateway
    // refuses to register it unless
    // plugins.entries.telemetry-hal.hooks.allowConversationAccess === true
    // (the fable run's gateway log: 'typed hook "agent_end" blocked ...').
    api.on("agent_end", (evt: any, legacyCtx?: any) => {
      const ctx = ctxOf(evt, legacyCtx);
      const env = envelope(evt, ctx);
      emit({
        type: "agent.end",
        ...env,
        success: evt.success,
        durationMs: evt.durationMs,
        error: evt.error,
        ...contextDelta(env.sessionKey, evt.messages),
      });
    });
  },
};
