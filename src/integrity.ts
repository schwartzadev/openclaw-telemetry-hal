import { createHash } from "node:crypto";
import type { IntegrityConfig, TelemetryEvent } from "./types.js";

export type IntegrityChain = {
  sign: (evt: TelemetryEvent) => TelemetryEvent;
};

export function createIntegrityChain(
  config: IntegrityConfig = {},
): IntegrityChain {
  if (!config.enabled) {
    return { sign: (evt: TelemetryEvent): TelemetryEvent => evt };
  }

  const algorithm = config.algorithm ?? "sha256";
  let prevHash = "0".repeat(64);

  function computeHash(evt: TelemetryEvent, prev: string): string {
    const h = createHash(algorithm);
    h.update(prev);
    h.update(JSON.stringify(evt));
    return h.digest("hex");
  }

  return {
    sign: (evt: TelemetryEvent): TelemetryEvent => {
      const hash = computeHash(evt, prevHash);
      const signed = { ...evt, prevHash, hash };
      prevHash = hash;
      return signed;
    },
  };
}
