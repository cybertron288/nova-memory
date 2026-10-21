// How many tokens a forwarded request used, and what it cost.
import type { PriceTable } from "./config";
import type { ChatBody, EmbedBody } from "./shape";
import type { UpstreamKind } from "./upstream";

export interface Tokens { in: number; out: number }

const estimate = (chars: number) => Math.ceil(chars / 4);

/** Zero is treated as absent: every accepted request has input, and some
 *  OpenAI-compatible endpoints report zeros, which would make them free. */
function count(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * The reply's own `usage` when it has one. Without it, an estimate of about
 * four characters a token: counting zero would make an upstream that omits
 * usage free and unlimited.
 */
export function tokensFrom(kind: UpstreamKind, sent: ChatBody | EmbedBody, reply: unknown): Tokens {
  const usage = (reply as { usage?: Record<string, unknown> } | null)?.usage;
  if (kind === "embed") {
    const input = count(usage?.prompt_tokens) ?? count(usage?.total_tokens);
    return { in: input ?? estimate((sent as EmbedBody).input.reduce((n, s) => n + s.length, 0)), out: 0 };
  }
  const input = count(usage?.prompt_tokens);
  const output = count(usage?.completion_tokens);
  if (input !== null && output !== null) return { in: input, out: output };
  const content = (reply as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  return {
    in: estimate((sent as ChatBody).messages[0].content.length),
    out: estimate(typeof content === "string" ? content.length : 0),
  };
}

/** Prices are USD per million tokens, which is exactly micro-dollars per token. */
export function costMicros(kind: UpstreamKind, t: Tokens, prices: PriceTable): number {
  return Math.ceil(kind === "embed"
    ? t.in * prices.embedPerMTok
    : t.in * prices.chatInPerMTok + t.out * prices.chatOutPerMTok);
}
