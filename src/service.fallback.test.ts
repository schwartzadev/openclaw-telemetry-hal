import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("openclaw/plugin-sdk", () => ({
  onDiagnosticEvent: vi.fn(() => vi.fn()),
}));

const TEST_DIR = join(import.meta.dirname, ".test-output-fallback");
const FALLBACK_FILE = join(TEST_DIR, "fallback.jsonl");

// FALLBACK_FILE_PATH is resolved from OPENCLAW_TELEMETRY_FILE at module load,
// so the env must be set before service.ts is imported. Each test imports the
// module fresh (resetModules) after stubbing the env.
describe("TelemetryService not-started fallback", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    vi.resetModules();
    vi.stubEnv("OPENCLAW_TELEMETRY_FILE", FALLBACK_FILE);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("writes stamped, redacted, fallback:true lines when never started", async () => {
    const { createTelemetryService } = await import("./service.js");
    const svc = createTelemetryService();

    // no start() call at all — hooks fire before/without a config block
    svc.write({
      type: "tool.start",
      toolName: "bash",
      params: { key: "ghp_" + "a".repeat(36) },
    });

    const content = await readFile(FALLBACK_FILE, "utf-8");
    const line = JSON.parse(content.trim());
    expect(line.type).toBe("tool.start");
    expect(line.fallback).toBe(true);
    expect(typeof line.seq).toBe("number");
    expect(typeof line.ts).toBe("number");
    // the fallback path redacts with the default patterns
    expect(content).not.toContain("ghp_");
    expect(content).toContain("[REDACTED]");
  });

  test("writes nothing when explicitly disabled", async () => {
    const { createTelemetryService } = await import("./service.js");
    const svc = createTelemetryService();

    await svc.start({
      config: { plugins: { entries: { "telemetry-hal": { config: { enabled: false } } } } },
      stateDir: TEST_DIR,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    svc.write({ type: "tool.start", toolName: "bash", params: {} });
    await svc.stop?.({} as never);

    await expect(readFile(FALLBACK_FILE, "utf-8")).rejects.toThrow();
  });
});
