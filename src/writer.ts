import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createRotatingWriter } from "./rotate.js";
import type { RotateConfig } from "./types.js";

export type TelemetryWriter = {
  write: (evt: object) => void;
  flush: () => Promise<void>;
};

function safeSerialize(evt: object): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(evt, (_key, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }
    return value;
  });
}

export function createTelemetryWriter(filePath: string, rotateConfig?: RotateConfig): TelemetryWriter {
  let queue: string[] = [];
  let flushing = false;
  const rotator = createRotatingWriter(filePath, rotateConfig ?? {});

  const doFlush = async () => {
    if (flushing || queue.length === 0) return;
    flushing = true;
    const batch = queue;
    queue = [];
    try {
      if (rotator.shouldRotate()) await rotator.rotate();
      await mkdir(dirname(filePath), { recursive: true });
      const data = batch.join("");
      await appendFile(filePath, data);
      rotator.trackWrite(Buffer.byteLength(data, "utf8"));
    } catch {
      // Preserve events if disk write fails so a later retry can recover.
      queue = batch.concat(queue);
      await new Promise((r) => setTimeout(r, 100));
    } finally {
      flushing = false;
    }
    if (queue.length > 0) void doFlush();
  };

  void rotator.init();

  return {
    write(evt: object) {
      const line = safeSerialize(evt) + "\n";
      queue.push(line);
      if (!flushing) {
        void doFlush();
      }
    },
    async flush() {
      while (queue.length > 0 || flushing) {
        await doFlush();
        if (flushing) {
          await new Promise((r) => setTimeout(r, 10));
        }
      }
    },
  };
}
