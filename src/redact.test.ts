import { describe, expect, test } from "vitest";
import { createRedactor } from "./redact.js";

describe("createRedactor", () => {
  test("returns identity when disabled", () => {
    const r = createRedactor({ enabled: false });
    const input = { apiKey: "sk-1234567890abcdef1234567890abcdef" };
    expect(r.redact(input)).toEqual(input);
  });

  test("redacts OpenAI API keys", () => {
    const r = createRedactor({ enabled: true });
    const input = { key: "sk-1234567890abcdef1234567890abcdef" };
    expect(r.redact(input)).toEqual({ key: "[REDACTED]" });
  });

  test("redacts GitHub tokens", () => {
    const r = createRedactor({ enabled: true });
    const input = { token: "ghp_abcdefghijklmnopqrstuvwxyz1234567890" };
    expect(r.redact(input)).toEqual({ token: "[REDACTED]" });
  });

  test("redacts bearer tokens", () => {
    const r = createRedactor({ enabled: true });
    const input = { auth: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" };
    expect(r.redact(input)).toEqual({ auth: "[REDACTED]" });
  });

  test("redacts api_key patterns in strings", () => {
    const r = createRedactor({ enabled: true });
    const input = { cmd: 'curl -H "api_key: abcdef1234567890abcdef"' };
    expect(r.redact(input).cmd).toContain("[REDACTED]");
  });

  test("redacts password patterns", () => {
    const r = createRedactor({ enabled: true });
    const input = { config: 'password="secretpassword123"' };
    expect(r.redact(input).config).toContain("[REDACTED]");
  });

  test("redacts nested objects", () => {
    const r = createRedactor({ enabled: true });
    const input = {
      outer: {
        inner: { key: "sk-1234567890abcdef1234567890abcdef" },
      },
    };
    expect(r.redact(input)).toEqual({
      outer: { inner: { key: "[REDACTED]" } },
    });
  });

  test("redacts arrays", () => {
    const r = createRedactor({ enabled: true });
    const input = { tokens: ["sk-abc123def456ghi789jkl012mno345pq", "normal"] };
    const result = r.redact(input);
    expect(result.tokens[0]).toBe("[REDACTED]");
    expect(result.tokens[1]).toBe("normal");
  });

  test("uses custom patterns", () => {
    const r = createRedactor({
      enabled: true,
      patterns: ["secret-[0-9]+"],
    });
    const input = { id: "secret-12345" };
    expect(r.redact(input)).toEqual({ id: "[REDACTED]" });
  });

  test("uses custom replacement", () => {
    const r = createRedactor({
      enabled: true,
      replacement: "***",
    });
    const input = { key: "sk-1234567890abcdef1234567890abcdef" };
    expect(r.redact(input)).toEqual({ key: "***" });
  });

  test("preserves non-string values", () => {
    const r = createRedactor({ enabled: true });
    const input = { count: 42, active: true, empty: null };
    expect(r.redact(input)).toEqual({ count: 42, active: true, empty: null });
  });

  describe("default patterns learned from the harness key shapes", () => {
    const r = createRedactor({ enabled: true });
    const cases: Array<[string, string]> = [
      ["Anthropic key", "sk-ant-api03-" + "a".repeat(40)],
      ["OpenAI project key", "sk-proj-" + "b".repeat(40)],
      ["OpenRouter key", "sk-or-v1-" + "0".repeat(64)],
      ["classic GitHub PAT", "github_pat_" + "c".repeat(60)],
      ["RunPod key", "rpa_" + "D".repeat(24)],
      ["Telegram bot token", "123456789:AA" + "e".repeat(33)],
      ["AWS access key id", "AKIA" + "0123456789ABCDEF"],
      ["HuggingFace token", "hf_" + "f".repeat(34)],
    ];
    test.each(cases)("redacts %s", (_label, secret) => {
      expect(r.redact({ v: secret })).toEqual({ v: "[REDACTED]" });
    });

    test("redacts a PEM private key block", () => {
      const pem =
        "-----BEGIN RSA PRIVATE KEY-----\nMIIabc123\n-----END RSA PRIVATE KEY-----";
      expect(r.redact({ key: pem }).key).toBe("[REDACTED]");
    });

    test("redacts a labelled 40-64 hex credential but leaves a bare hex run", () => {
      const hex = "a".repeat(48);
      expect(r.redact({ v: `--token ${hex}` }).v).toContain("[REDACTED]");
      // a bare hex run (git sha shape) carries no credential label, so it stays
      expect(r.redact({ v: hex }).v).toBe(hex);
    });
  });
});
