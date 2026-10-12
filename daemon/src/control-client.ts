/**
 * One-shot client for the control socket: connect, send one request, wait for
 * the matching reply, disconnect.
 *
 * Deliberately one request per connection. The CLI issues one command and
 * exits; a persistent connection with id multiplexing is the shell's concern,
 * and the shell writes its own client in Swift. Keeping this one trivial
 * means it cannot mask a framing bug in the server — every test through it
 * exercises a fresh connection.
 */
import { existsSync } from "node:fs";

/** The daemon is not running, or its socket is not where it should be. */
export class ControlUnavailable extends Error {
  constructor(path: string, cause: string) {
    super(`nova daemon is not reachable at ${path} (${cause}) — is \`nova start\` running?`);
    this.name = "ControlUnavailable";
  }
}

export async function controlRequest(
  path: string, op: string, args: Record<string, unknown> = {}, timeoutMs = 2_000,
): Promise<unknown> {
  if (!existsSync(path)) throw new ControlUnavailable(path, "no socket file");
  const id = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve, reject) => {
    // One decoder for the whole connection, decoding with { stream: true }, as
    // ingestStream does. chunk.toString() decodes each chunk standalone, so a
    // multi-byte character whose bytes land either side of a chunk boundary
    // becomes U+FFFD on both sides — and the mangled JSON still parses, so the
    // CLI printed corrupted text and exited 0. A 100-loop list is around 31 KB,
    // well past one chunk, and any em-dash or accented name can straddle one.
    const decoder = new TextDecoder();
    let buf = "";
    let settled = false;
    const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(
      () => finish(() => reject(new ControlUnavailable(path, `no reply within ${timeoutMs} ms`))),
      timeoutMs,
    );

    Bun.connect({
      unix: path,
      socket: {
        open(sock) { sock.write(JSON.stringify({ id, op, ...args }) + "\n"); },
        data(sock, chunk) {
          buf += decoder.decode(chunk, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
            let msg: any;
            try { msg = JSON.parse(line); } catch { continue; }
            if (msg.id !== id) continue;           // not ours; a shared socket could interleave
            finish(() => {
              sock.end();
              if (msg.ok) resolve(msg.result);
              else reject(new Error(typeof msg.error === "string" ? msg.error : "request failed"));
            });
            return;
          }
        },
        error(_sock, err) { finish(() => reject(new ControlUnavailable(path, err.message))); },
        connectError(_sock, err) { finish(() => reject(new ControlUnavailable(path, err.message))); },
        close() { finish(() => reject(new ControlUnavailable(path, "connection closed before reply"))); },
      },
    }).catch((err: Error) => finish(() => reject(new ControlUnavailable(path, err.message))));
  });
}
