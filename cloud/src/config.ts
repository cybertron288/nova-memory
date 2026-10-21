// Everything the proxy needs from its environment, checked once at start.
// A missing or malformed variable is refused, never defaulted: a proxy that
// quietly ran with no ceiling or a zero price would spend without limit.

export interface UpstreamConfig { baseUrl: string; apiKey: string; model: string }

/** USD per million tokens. */
export interface PriceTable { chatInPerMTok: number; chatOutPerMTok: number; embedPerMTok: number }

export interface Config {
  chat: UpstreamConfig;
  embed: UpstreamConfig;
  supabaseUrl: string;
  supabaseServiceKey: string;
  jwksUrl: string;
  monthlyCeilingUsd: number;
  prices: PriceTable;
  maxBodyBytes: number;
  chatMaxTokens: number;
  embedMaxChars: number;
  ipDailyLimit: number;
  ipSignupLimit: number;
  ipHashSecret: string;
}

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`nova cloud config: ${problems.join("; ")}`);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const problems: string[] = [];

  const text = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) { problems.push(`${name} is not set`); return ""; }
    return value;
  };
  const url = (name: string): string => {
    const value = text(name);
    if (value && !URL.canParse(value)) problems.push(`${name} is not a URL`);
    return value.replace(/\/+$/, "");
  };
  const amount = (name: string): number => {
    const value = text(name);
    if (!value) return 0;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) problems.push(`${name} must be a number of at least 0, got ${JSON.stringify(value)}`);
    return n;
  };

  // A zero price would let that kind of call never count toward the ceiling.
  const price = (name: string): number => {
    const n = amount(name);
    if (n === 0 && env[name]?.trim()) problems.push(`${name} must be greater than 0`);
    return n;
  };

  const secret = (name: string): string => {
    const value = text(name);
    if (value && value.length < 32) problems.push(`${name} must be at least 32 characters`);
    return value;
  };

  const optionalCount = (name: string, fallback: number): number => {
    const value = env[name]?.trim();
    if (!value) return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) problems.push(`${name} must be a whole number of at least 1, got ${JSON.stringify(value)}`);
    return n;
  };

  const supabaseUrl = url("SUPABASE_URL");
  const config: Config = {
    chat: { baseUrl: url("UPSTREAM_CHAT_BASE_URL"), apiKey: text("UPSTREAM_CHAT_API_KEY"), model: text("UPSTREAM_CHAT_MODEL") },
    embed: { baseUrl: url("UPSTREAM_EMBED_BASE_URL"), apiKey: text("UPSTREAM_EMBED_API_KEY"), model: text("UPSTREAM_EMBED_MODEL") },
    supabaseUrl,
    supabaseServiceKey: text("SUPABASE_SERVICE_ROLE_KEY"),
    jwksUrl: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
    monthlyCeilingUsd: amount("NOVA_MONTHLY_CEILING_USD"),
    prices: {
      chatInPerMTok: price("NOVA_PRICE_CHAT_IN"),
      chatOutPerMTok: price("NOVA_PRICE_CHAT_OUT"),
      embedPerMTok: price("NOVA_PRICE_EMBED"),
    },
    maxBodyBytes: 262_144,
    chatMaxTokens: 4096,
    embedMaxChars: 200_000,
    ipDailyLimit: optionalCount("NOVA_IP_DAILY_LIMIT", 5000),
    ipSignupLimit: optionalCount("NOVA_IP_SIGNUP_LIMIT", 3),
    ipHashSecret: secret("NOVA_IP_HASH_SECRET"),
  };
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
