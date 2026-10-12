// Daemon log plumbing: a timestamp on every line the daemon writes, and the
// colored reader behind `nova logs`. The file itself stays plain text so
// grep keeps working; color is added only when a person is reading it.

// Local wall-clock time, second precision: "2026-09-24 11:23:45".
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// The daemon's diagnostics all go through console.error, so stamping there
// covers every module without touching each call site. Only `nova start`
// calls this; `search`/`status` terminal output stays unstamped.
export function stampStderr(): void {
  const write = console.error.bind(console);
  console.error = (...args: unknown[]) => write(stamp(), ...args);
}

// nova-capture writes its own stderr; relaying it line by line through
// console.error gives its lines the same timestamp as the daemon's.
export async function relayLines(stream: ReadableStream<Uint8Array>): Promise<void> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line) console.error(line);
    }
  }
  if (buf) console.error(buf);
}

const ESC = "\x1b[";
const paint = (code: string, s: string) => `${ESC}${code}m${s}${ESC}0m`;
const DIM = "2", RED = "31", YELLOW = "33", GREEN = "32";

// One color and one marker per subsystem, so a glance down the left edge
// tells you who is talking. Unknown tags fall back to plain.
const TAGS: Record<string, { color: string; mark: string }> = {
  capture:  { color: "36", mark: "●" },  // cyan
  ingest:   { color: "34", mark: "▸" },  // blue
  pipeline: { color: "35", mark: "◆" },  // magenta
  loops:    { color: "32", mark: "↻" },  // green
  nova:     { color: "37;1", mark: "■" }, // bright white
  control:  { color: "90", mark: "⇄" },  // grey
  search:   { color: "34", mark: "?" },
  provider: { color: "35", mark: "◇" },
};

const ERROR = /\b(error|failed|denied|giving up|refusing)\b|AXError/i;
const WARN = /\bquota\b|\b429\b|backing off|\bdropped\b|\bdiscard/i;
const RECOVERED = /quota is back|resume/i;
// High-volume, low-information lines: shown, but dimmed.
const NOISE = /^suppressed \d+|^dropped line: duplicate-fingerprint/;

// "2026-09-24 11:23:45 [capture] msg", "[capture] msg" (lines written before
// timestamps existed), and "provider: msg" (provider.ts's older style).
const LINE = /^(?<ts>\d{4}-\d\d-\d\d \d\d:\d\d:\d\d )?(?:\[(?<tag>[\w-]+)\]|(?<bare>provider):) ?(?<msg>.*)$/;

export interface ParsedLine { ts?: string; tag?: string; msg: string }

export function parseLine(line: string): ParsedLine {
  const m = LINE.exec(line);
  if (!m?.groups) return { msg: line };
  const g = m.groups;
  return { ts: g.ts?.trim(), tag: g.tag ?? g.bare, msg: g.msg ?? "" };
}

export function formatLine(line: string, opts: { color: boolean; dim: boolean }): string {
  const { ts, tag, msg } = parseLine(line);
  const style = tag ? TAGS[tag] : undefined;
  // Noise first so a dropped duplicate never reads as a warning, and warn
  // before error: a quota pause quotes the provider's `"error"` JSON but is
  // a recoverable back-off, not a failure.
  const noise = NOISE.test(msg);
  const level = noise ? "info" : RECOVERED.test(msg) ? "ok" : WARN.test(msg) ? "warn" : ERROR.test(msg) ? "error" : "info";
  const levelMark = level === "error" ? "✗" : level === "warn" ? "⚠" : level === "ok" ? "✓" : " ";
  const tagText = tag ? `${style?.mark ?? "·"} ${tag.padEnd(8)}` : "";

  if (!opts.color) return [ts, levelMark, tagText, msg].filter(Boolean).join(" ");

  const body = level === "error" ? paint(RED, msg)
    : level === "warn" ? paint(YELLOW, msg)
    : opts.dim && noise ? paint(DIM, msg)
    : msg;
  return [
    ts && paint(DIM, ts),
    level === "error" ? paint(RED, levelMark) : level === "warn" ? paint(YELLOW, levelMark)
      : level === "ok" ? paint(GREEN, levelMark) : levelMark,
    tagText && (style ? paint(style.color, tagText) : tagText),
    body,
  ].filter(Boolean).join(" ");
}
