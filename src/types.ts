export type TelemetryEventBase = {
  ts: number;
  seq: number;
  sessionKey?: string;
  agentId?: string;
};

export type TelemetryToolStartEvent = TelemetryEventBase & {
  type: "tool.start";
  toolName: string;
  params: Record<string, unknown>;
};

export type TelemetryToolEndEvent = TelemetryEventBase & {
  type: "tool.end";
  toolName: string;
  params?: Record<string, unknown>;
  result?: unknown;
  durationMs?: number;
  success: boolean;
  error?: string;
};

export type TelemetryMessageInEvent = TelemetryEventBase & {
  type: "message.in";
  channel: string;
  from: string;
  content?: string;
  contentLength: number;
  timestamp?: number;
  metadata?: Record<string, unknown>;
};

export type TelemetryMessageSendingEvent = TelemetryEventBase & {
  type: "message.sending";
  channel: string;
  to: string;
  content?: string;
};

export type TelemetryMessageOutEvent = TelemetryEventBase & {
  type: "message.out";
  channel: string;
  to: string;
  content?: string;
  success: boolean;
  error?: string;
};

export type TelemetryLlmUsageEvent = TelemetryEventBase & {
  type: "llm.usage";
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  durationMs?: number;
  costUsd?: number;
};

export type TelemetryAgentStartEvent = TelemetryEventBase & {
  type: "agent.start";
  prompt?: string;
  promptLength: number;
  messageCount?: number;
};

export type TelemetryAgentEndEvent = TelemetryEventBase & {
  type: "agent.end";
  success: boolean;
  durationMs?: number;
  messageCount?: number;
  error?: string;
};

export type TelemetrySessionStartEvent = TelemetryEventBase & {
  type: "session.start";
  sessionId: string;
  resumedFrom?: string;
};

export type TelemetrySessionEndEvent = TelemetryEventBase & {
  type: "session.end";
  sessionId: string;
  messageCount?: number;
  durationMs?: number;
};

export type TelemetryEvent =
  | TelemetryToolStartEvent
  | TelemetryToolEndEvent
  | TelemetryMessageInEvent
  | TelemetryMessageSendingEvent
  | TelemetryMessageOutEvent
  | TelemetryLlmUsageEvent
  | TelemetryAgentStartEvent
  | TelemetryAgentEndEvent
  | TelemetrySessionStartEvent
  | TelemetrySessionEndEvent;

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
