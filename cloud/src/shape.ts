// Accept only requests shaped like the ones Nova's daemon sends
// (OpenAICompatProvider in daemon/src/provider.ts), so a session token does
// not buy a general-purpose model API. The shape is checked, never the prompt:
// knowing Nova's prompts would mean the server sees more than a BYOK provider.
// The forwarded body is rebuilt from the checked fields, so nothing unchecked
// reaches the upstream.

export type Shaped<T> = { ok: true; body: T } | { ok: false; status: 400; error: string };

export interface ChatBody {
  model: string;
  messages: [{ role: "user"; content: string }];
  temperature: 0;
  response_format: { type: "json_object" };
  max_tokens: number;
}

export interface EmbedBody { model: string; input: string[]; dimensions?: 1536 }

/** The daemon's embedding width (`DIM` in daemon/src/db.ts). */
const DIM = 1536;

const refuse = (error: string) => ({ ok: false as const, status: 400 as const, error });

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateChat(raw: unknown, cfg: { model: string; maxTokens: number }): Shaped<ChatBody> {
  if (!isObject(raw)) return refuse("body must be a JSON object");
  if (raw.stream !== undefined && raw.stream !== false) return refuse("stream is not supported");
  const messages = raw.messages;
  if (!Array.isArray(messages) || messages.length !== 1) return refuse("messages must be exactly one user message");
  const [message] = messages;
  if (!isObject(message) || message.role !== "user") return refuse("messages must be exactly one user message");
  if (typeof message.content !== "string") return refuse("message content must be a string");
  if (raw.temperature !== 0) return refuse("temperature must be 0");
  if (!isObject(raw.response_format) || raw.response_format.type !== "json_object") {
    return refuse("response_format must be json_object");
  }
  return {
    ok: true,
    body: {
      model: cfg.model,
      messages: [{ role: "user", content: message.content }],
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: cfg.maxTokens,
    },
  };
}

export function validateEmbed(
  raw: unknown, cfg: { model: string; maxInputs: number; maxChars: number },
): Shaped<EmbedBody> {
  if (!isObject(raw)) return refuse("body must be a JSON object");
  const input = raw.input;
  if (!Array.isArray(input) || input.length === 0) return refuse("input must be a non-empty array of strings");
  if (input.length > cfg.maxInputs) return refuse(`input holds at most ${cfg.maxInputs} strings`);
  if (!input.every((s) => typeof s === "string")) return refuse("input must be a non-empty array of strings");
  const chars = (input as string[]).reduce((n, s) => n + s.length, 0);
  if (chars > cfg.maxChars) return refuse(`input holds at most ${cfg.maxChars} characters`);
  if (raw.dimensions !== undefined && raw.dimensions !== DIM) return refuse(`dimensions must be ${DIM}`);
  const body: EmbedBody = { model: cfg.model, input: input as string[] };
  if (raw.dimensions === DIM) body.dimensions = DIM;
  return { ok: true, body };
}
