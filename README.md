# Quickstart


```
curl -fsSL https://get.pnpm.io/install.sh | sh -
source /Users/administrator/.zshrc
pnpm install
pnpm run build
openclaw plugins install --link .
# NB: update the openclaw.json file
openclaw gateway restart
```


Forked from OpenClaw Telemetry Plugin by [Knostic](https://knostic.ai/).

# OpenClaw Telemetry Plugin - TL;DR

Captures tool calls, LLM usage, agent lifecycle, and message events. Outputs to JSONL file and optionally to syslog for SIEM integration.

## Quick Start

### 1. Build

```bash
cd openclaw-telemetry-hal
pnpm install
pnpm run build
```

The plugin is authored in TypeScript, but installed OpenClaw plugins must expose compiled JavaScript. Both `openclaw.extensions` and `openclaw.runtimeExtensions` point at `./dist/index.js`.

### 2. Install

```bash
openclaw plugins install .
```

This installs the compiled plugin under:

```bash
~/.openclaw/extensions/telemetry-hal
```

### 3. Configure

Via Control UI: **Settings → Config → plugins.entries.telemetry-hal**

Or edit `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "telemetry-hal": {
        "enabled": true,
        "config": {
          "enabled": true,
          "filePath": "/Users/administrator/.openclaw/logs/telemetry.jsonl"
        },
        "hooks": {
          "allowConversationAccess": true
        }
      },
    }
  }
}
```

### 4. Restart Gateway

```bash
openclaw gateway restart
```

Logs write to `~/.openclaw/logs/telemetry.jsonl` by default.

### 5. Verify

```bash
openclaw plugins inspect telemetry-hal
openclaw plugins list | grep telemetry-hal
ls -l ~/.openclaw/logs/telemetry.jsonl
tail -f ~/.openclaw/logs/telemetry.jsonl
```

`openclaw plugins inspect telemetry-hal` should report `Status: loaded` and `Source: ~/.openclaw/extensions/telemetry-hal/dist/index.js`.

### Packaged install

```bash
openclaw plugins install @openclaw/telemetry-hal
```

The package is prepared with `prepack`, so `npm pack` and published installs include the compiled `dist/` output.

## Development

Useful commands:

```bash
npm install
npm run build
npm pack --dry-run
node -e "import('./dist/index.js').then(m => console.log(m.default?.id, typeof m.default?.register))"
```

Expected import check:

```text
telemetry-hal function
```

After changing source files, rebuild and reinstall:

```bash
npm run build
openclaw plugins install .
openclaw gateway restart
```

Do not point `openclaw.extensions` or `openclaw.runtimeExtensions` at `./index.ts` for an installed plugin. TypeScript source fallback is only for source checkouts/local development paths; packaged installs need `./dist/index.js`.

## Configuration

### Core Options

| Option     | Type    | Default                            | Description              |
| ---------- | ------- | ---------------------------------- | ------------------------ |
| `enabled`  | boolean | `false`                            | Enable telemetry capture |
| `filePath` | string  | `~/.openclaw/logs/telemetry.jsonl` | JSONL output file path   |

### Syslog Output

| Option            | Type    | Default    | Description                           |
| ----------------- | ------- | ---------- | ------------------------------------- |
| `syslog.enabled`  | boolean | `false`    | Enable syslog output                  |
| `syslog.host`     | string  | required   | Syslog server hostname                |
| `syslog.port`     | number  | `514`      | Syslog server port                    |
| `syslog.protocol` | string  | `udp`      | Transport: `udp`, `tcp`, or `tcp-tls` |
| `syslog.format`   | string  | `cef`      | Message format: `cef` or `json`       |
| `syslog.facility` | number  | `16`       | Syslog facility (16 = local0)         |
| `syslog.appName`  | string  | `openclaw` | App name in syslog messages           |

### Sensitive Data Redaction

Automatically redacts sensitive data (API keys, tokens, passwords) from tool parameters before logging.

| Option               | Type     | Default      | Description                                                      |
| -------------------- | -------- | ------------ | ---------------------------------------------------------------- |
| `redact.enabled`     | boolean  | `false`      | Enable redaction                                                 |
| `redact.patterns`    | string[] | (built-in)   | Regex patterns to match. Prefix with `(?i)` for case-insensitive |
| `redact.replacement` | string   | `[REDACTED]` | Replacement text                                                 |

Default patterns detect:

- OpenAI keys (`sk-...`)
- GitHub tokens (`ghp_...`, `gho_...`)
- GitLab tokens (`glpat-...`)
- Slack tokens (`xox[baprs]-...`)
- AWS credentials
- Bearer tokens
- Common `api_key`, `password`, `secret`, `token` patterns

### Event Integrity (Hash Chain)

Adds cryptographic hash chain to events for tamper detection. Each event includes `prevHash` and `hash` fields, forming a verifiable chain.

| Option                | Type    | Default  | Description       |
| --------------------- | ------- | -------- | ----------------- |
| `integrity.enabled`   | boolean | `false`  | Enable hash chain |
| `integrity.algorithm` | string  | `sha256` | Hash algorithm    |

### Rate Limiting

Prevents runaway agents from flooding outputs. Uses token bucket algorithm.

| Option                         | Type    | Default | Description          |
| ------------------------------ | ------- | ------- | -------------------- |
| `rateLimit.enabled`            | boolean | `false` | Enable rate limiting |
| `rateLimit.maxEventsPerSecond` | number  | `100`   | Sustained event rate |
| `rateLimit.burstSize`          | number  | `200`   | Burst capacity       |

### Log Rotation

Rotates JSONL files to prevent unbounded growth.

| Option                | Type    | Default    | Description           |
| --------------------- | ------- | ---------- | --------------------- |
| `rotate.enabled`      | boolean | `false`    | Enable rotation       |
| `rotate.maxSizeBytes` | number  | `10485760` | Max file size (10MB)  |
| `rotate.maxFiles`     | number  | `5`        | Rotated files to keep |
| `rotate.compress`     | boolean | `true`     | Gzip rotated files    |

## Example Configurations

### Basic

```json
{
  "plugins": {
    "entries": {
      "telemetry-hal": {
        "enabled": true,
        "config": {
          "enabled": true
        }
      }
    }
  }
}
```

### Enterprise (all security features)

```json
{
  "plugins": {
    "entries": {
      "telemetry-hal": {
        "enabled": true,
        "config": {
          "enabled": true,
          "redact": {
            "enabled": true
          },
          "integrity": {
            "enabled": true
          },
          "rateLimit": {
            "enabled": true,
            "maxEventsPerSecond": 50
          },
          "rotate": {
            "enabled": true,
            "maxSizeBytes": 52428800,
            "maxFiles": 10
          },
          "syslog": {
            "enabled": true,
            "host": "siem.company.com",
            "port": 6514,
            "protocol": "tcp-tls",
            "format": "cef"
          }
        }
      }
    }
  }
}
```

### Custom Redaction Patterns

```json
{
  "plugins": {
    "entries": {
      "telemetry-hal": {
        "enabled": true,
        "config": {
          "enabled": true,
          "redact": {
            "enabled": true,
            "patterns": [
              "(?i)internal-secret-[a-z0-9]+",
              "COMPANY-[A-Z]{4}-[0-9]{8}"
            ],
            "replacement": "***"
          }
        }
      }
    }
  }
}
```

## Events

| Event         | Description                                           |
| ------------- | ----------------------------------------------------- |
| `tool.start`  | Tool invocation started                               |
| `tool.end`    | Tool invocation completed (success/failure, duration) |
| `message.in`  | Inbound message received                              |
| `message.sending` | Outbound message about to send                   |
| `message.out` | Outbound message sent                                 |
| `llm.usage`   | LLM API call (tokens, cost, duration)                 |
| `agent.start` | Agent session started                                 |
| `agent.end`   | Agent session completed                               |

### JSONL Format

Basic event:

```json
{
  "type": "tool.start",
  "toolName": "bash",
  "params": { "cmd": "ls" },
  "sessionKey": "telegram:123",
  "seq": 1,
  "ts": 1738517700000
}
```

With integrity enabled:

```json
{
  "type": "tool.start",
  "toolName": "bash",
  "params": { "cmd": "ls" },
  "seq": 1,
  "ts": 1738517700000,
  "prevHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "hash": "a1b2c3d4e5f6..."
}
```

With redaction (before):

```json
{
  "type": "tool.start",
  "toolName": "bash",
  "params": { "cmd": "curl -H 'Authorization: Bearer sk-abc123...'" }
}
```

With redaction (after):

```json
{
  "type": "tool.start",
  "toolName": "bash",
  "params": { "cmd": "curl -H 'Authorization: [REDACTED]'" }
}
```

### CEF Format (syslog)

```
CEF:0|OpenClaw|openclaw|1.0|1001|Tool Invocation Started|3|rt=1738517700000 cs1=telegram:123 cs1Label=sessionKey act=bash cs5=a1b2c3... cs5Label=hash cs6=0000... cs6Label=prevHash
```

## Verifying Hash Chain Integrity

```bash
# Verify chain integrity with jq
jq -s '
  reduce .[] as $evt (
    {valid: true, prev: ("0" * 64)};
    if .valid and $evt.prevHash == .prev
    then {valid: true, prev: $evt.hash}
    else {valid: false, prev: .prev, broken_at: $evt.seq}
    end
  )
' ~/.openclaw/logs/telemetry.jsonl
```

## Querying

```bash
# Follow live events
tail -f ~/.openclaw/logs/telemetry.jsonl | jq .

# Filter by event type
jq 'select(.type=="tool.end")' ~/.openclaw/logs/telemetry.jsonl

# Get LLM costs
jq 'select(.type=="llm.usage") | {model, costUsd}' ~/.openclaw/logs/telemetry.jsonl

# Correlate by session
jq 'select(.sessionKey=="telegram:123456")' ~/.openclaw/logs/telemetry.jsonl

# Find failed tool calls
jq 'select(.type=="tool.end" and .success==false)' ~/.openclaw/logs/telemetry.jsonl
```

## Rotated Files

When rotation is enabled, files are named:

- `telemetry.jsonl` - current file
- `telemetry.jsonl.1.gz` - most recent rotated (compressed)
- `telemetry.jsonl.2.gz` - older
- ...up to `maxFiles`

To read compressed logs:

```bash
zcat ~/.openclaw/logs/telemetry.jsonl.1.gz | jq .
```

## SIEM Integration

The file-based output works with log shippers:

- **Filebeat**: Configure a `filestream` input pointing to the JSONL file
- **Fluentd**: Use `in_tail` with JSON parser
- **Splunk Universal Forwarder**: Monitor the file path

The syslog output connects directly to:

- Splunk (syslog input)
- QRadar (CEF supported natively)
- ArcSight (CEF supported natively)
- Elastic SIEM (via Logstash syslog input)
- Any RFC 5424 compliant collector

## Troubleshooting

### Plugin is enabled but no `telemetry.jsonl` appears

Check the plugin is loaded from compiled JavaScript:

```bash
openclaw plugins inspect telemetry-hal
```

Expected:

```text
Status: loaded
Source: ~/.openclaw/extensions/telemetry-hal/dist/index.js
```

Then check gateway logs:

```bash
grep -i telemetry ~/.openclaw/logs/gateway.log /tmp/openclaw/openclaw-$(date +%F).log
```

If the plugin is loaded but no file is created, verify the plugin service lifecycle and hook names against the installed OpenClaw version. The file writer is initialized by the `telemetry-hal` service `start(...)` method, and events are emitted by the registered OpenClaw hooks.

## License

Apache 2.0 — see LICENSE for details.
