// One call to the model provider the owner configured.
import type { Config } from "./config";
import type { ChatBody, EmbedBody } from "./shape";

export type UpstreamKind = "chat" | "embed";

export type Upstream = (kind: UpstreamKind, body: ChatBody | EmbedBody) => Promise<Response>;

/** Longer than any extraction call takes, and well under Vercel's 300 s. */
const TIMEOUT_MS = 120_000;

export function httpUpstream(config: Config): Upstream {
  return (kind, body) => {
    const target = kind === "chat" ? config.chat : config.embed;
    const path = kind === "chat" ? "chat/completions" : "embeddings";
    return fetch(`${target.baseUrl}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${target.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  };
}
