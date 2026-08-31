export type TelemetryEventBase = {
  ts: number;
  seq: number;
  sessionKey?: string;
  agentId?: string;
  sessionId?: string;
  runId?: string;
  /** Set on lines written by the not-started fallback path. */
  fallback?: boolean;
  /** Events dropped by the rate limiter since the previous admitted event. */
  droppedSinceLast?: number;
};

/** Context delta attached to agent.start / agent.end instead of the full history. */
export type TelemetryContextDelta = {
  messageCount?: number;
  newMessageCount?: number;
  newMessages?: unknown[];
  newMessagesTruncated?: number;
  contextReset?: boolean;
  previousMessageCount?: number;
};

export type TelemetryToolStartEvent = TelemetryEventBase & {
  type: "tool.start";
  toolName: string;
  toolCallId?: string;
  params: Record<string, unknown>;
};

export type TelemetryToolEndEvent = TelemetryEventBase & {
  type: "tool.end";
  toolName: string;
  toolCallId?: string;
  durationMs?: number;
  success: boolean;
  error?: string;
};

export type TelemetryMessageEnvelope = {
  channel: string;
  accountId?: string;
  conversationId?: string;
  messageId?: string;
};

export type TelemetryMessageInEvent = TelemetryEventBase & TelemetryMessageEnvelope & {
  type: "message.in";
  from: string;
  content?: string;
  contentLength?: number;
  timestamp?: number;
  metadata?: Record<string, unknown>;
};

export type TelemetryMessageSendingEvent = TelemetryEventBase & TelemetryMessageEnvelope & {
  type: "message.sending";
  to: string;
  content?: string;
};

export type TelemetryMessageOutEvent = TelemetryEventBase & TelemetryMessageEnvelope & {
  type: "message.out";
  to: string;
  content?: string;
  success: boolean;
  error?: string;
};

export type TelemetryLlmUsageEvent = TelemetryEventBase & {
  type: "llm.usage";
  /**
   * "model.usage": the gateway's per-run diagnostic event (has costUsd).
   * "llm_output": the typed hook, used only when the diagnostic bus could
   * not be subscribed to; same token counts, no cost.
   */
  source?: "model.usage" | "llm_output";
  /** Whether the diagnostic bus flagged the emission as trusted (gateway-originated). */
  trusted?: boolean;
  channel?: string;
  provider?: string;
  model?: string;
  /** Fully resolved provider/model ref, e.g. "anthropic/claude-x" (llm_output only). */
  resolvedRef?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  cacheWriteTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
  lastCallUsage?: Record<string, number | undefined>;
  contextLimit?: number;
  contextUsed?: number;
  durationMs?: number;
  /** Gateway estimate from its model cost table (per run, not per call). */
  costUsd?: number;
};

/** One line per model submission: what was sent, by shape, never the text. */
export type TelemetryLlmInputEvent = TelemetryEventBase & {
  type: "llm.input";
  provider?: string;
  model?: string;
  systemPromptSha256?: string;
  systemPromptLength?: number;
  promptLength?: number;
  historyMessageCount?: number;
  imagesCount?: number;
  toolCount?: number;
};

/** Full system prompt text, written once per session each time its hash changes. */
export type TelemetrySystemPromptEvent = TelemetryEventBase & {
  type: "system.prompt";
  provider?: string;
  model?: string;
  sha256: string;
  length?: number;
  text?: string;
};

export type TelemetryAgentStartEvent = TelemetryEventBase & TelemetryContextDelta & {
  type: "agent.start";
  /** Which hook produced the event (before_prompt_build, or legacy before_agent_start). */
  hook?: string;
  trigger?: string;
  channel?: string;
  prompt?: string;
  promptLength?: number;
};

export type TelemetryAgentEndEvent = TelemetryEventBase & TelemetryContextDelta & {
  type: "agent.end";
  success: boolean;
  durationMs?: number;
  error?: string;
};

export type TelemetryEvent =
  | TelemetryToolStartEvent
  | TelemetryToolEndEvent
  | TelemetryMessageInEvent
  | TelemetryMessageSendingEvent
  | TelemetryMessageOutEvent
  | TelemetryLlmUsageEvent
  | TelemetryLlmInputEvent
  | TelemetrySystemPromptEvent
  | TelemetryAgentStartEvent
  | TelemetryAgentEndEvent;

export type TelemetryEventInput = TelemetryEvent extends infer E
  ? E extends TelemetryEvent
    ? Omit<E, "seq" | "ts">
    : never
  : never;

export type SyslogProtocol = "udp" | "tcp" | "tcp-tls";

export type SyslogConfig = {
  enabled?: boolean;
  host: string;
  port?: number;
  protocol?: SyslogProtocol;
  facility?: number;
  appName?: string;
  format?: "cef" | "json";
};

export type RedactConfig = {
  enabled?: boolean;
  patterns?: string[];
  replacement?: string;
};

export type IntegrityConfig = {
  enabled?: boolean;
  algorithm?: string;
};

export type RateLimitConfig = {
  enabled?: boolean;
  maxEventsPerSecond?: number;
  burstSize?: number;
};

export type RotateConfig = {
  enabled?: boolean;
  maxSizeBytes?: number;
  maxFiles?: number;
  compress?: boolean;
};

export type TelemetryConfig = {
  enabled?: boolean;
  filePath?: string;
  syslog?: SyslogConfig;
  redact?: RedactConfig;
  integrity?: IntegrityConfig;
  rateLimit?: RateLimitConfig;
  rotate?: RotateConfig;
};
