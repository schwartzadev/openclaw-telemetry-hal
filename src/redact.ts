import type { RedactConfig } from "./types.js";

const DEFAULT_PATTERNS = [
  "(?i)(api[_-]?key|apikey)[\"']?\\s*[:=]\\s*[\"']?[a-z0-9_-]{16,}",
  "(?i)(password|passwd|pwd)[\"']?\\s*[:=]\\s*[\"'][^\"']+[\"']",
  "(?i)(secret|token|auth)[\"']?\\s*[:=]\\s*[\"']?[a-z0-9_-]{16,}",
  "(?i)bearer\\s+[a-z0-9_-]{20,}",
  "(?i)(aws_secret|aws_access)[a-z_]*[\"']?\\s*[:=]\\s*[\"']?[a-z0-9/+=]{20,}",
  "sk-[a-zA-Z0-9]{32,}",
  // Anthropic (sk-ant-api03-...), OpenAI project keys (sk-proj-...): the
  // generic sk- pattern above stops at the first hyphen and misses both.
  "sk-(?:ant|proj|svcacct)-[a-zA-Z0-9_-]{20,}",
  // OpenRouter: sk-or-v1-<64 hex>.
  "sk-or-v1-[0-9a-f]{64}",
  "ghp_[a-zA-Z0-9]{36}",
  "github_pat_[a-zA-Z0-9_]{60,}",
  "rpa_[a-zA-Z0-9]{20,}",
  "\\b[0-9]{8,10}:AA[a-zA-Z0-9_-]{30,}",
  "AKIA[0-9A-Z]{16}",
  "hf_[a-zA-Z0-9]{30,}",
  "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----",
  // Labelled 40-64 hex secrets (gateway auth token, portal/session tokens):
  // `--token <hex>`, `Authorization: <hex>`, `TOKEN=<hex>`, `"token":"<hex>"`.
  // A bare hex run stays untouched (it is also the shape of a git sha or a
  // hash); the label is what marks it as a credential.
  "(?i)(token|secret|passw(?:or)?d|api[_-]?key|auth)[a-z0-9_-]*[\"']?[\\s:=]+[\"']?[0-9a-f]{40,64}\\b",
  "gho_[a-zA-Z0-9]{36}",
  "glpat-[a-zA-Z0-9_-]{20,}",
  "xox[baprs]-[a-zA-Z0-9-]{10,}",
];

const DEFAULT_REPLACEMENT = "[REDACTED]";

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map((p) => {
    const flags = p.startsWith("(?i)") ? "gi" : "g";
    const pattern = p.replace(/^\(\?i\)/, "");
    return new RegExp(pattern, flags);
  });
}

export function createRedactor(config: RedactConfig = {}) {
  if (!config.enabled) {
    return { redact: <T>(v: T): T => v };
  }

  const patterns = compilePatterns(config.patterns ?? DEFAULT_PATTERNS);
  const replacement = config.replacement ?? DEFAULT_REPLACEMENT;

  function redactValue(v: unknown): unknown {
    if (typeof v === "string") {
      return patterns.reduce((s, p) => s.replace(p, replacement), v);
    }
    if (Array.isArray(v)) {
      return v.map(redactValue);
    }
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, redactValue(val)]));
    }
    return v;
  }

  return {
    redact: <T>(v: T): T => redactValue(v) as T,
  };
}
