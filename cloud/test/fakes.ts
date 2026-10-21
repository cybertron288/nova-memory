import type { Deps } from "../src/app";
import { loadConfig } from "../src/config";
import { LedgerUnavailable, type Ledger } from "../src/ledger";

export const fullEnv: Record<string, string> = {
  UPSTREAM_CHAT_BASE_URL: "https://chat.example.com/v1",
  UPSTREAM_CHAT_API_KEY: "chat-key",
  UPSTREAM_CHAT_MODEL: "deepseek-chat",
  UPSTREAM_EMBED_BASE_URL: "https://embed.example.com/v1",
  UPSTREAM_EMBED_API_KEY: "embed-key",
  UPSTREAM_EMBED_MODEL: "gemini-embedding-001",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  NOVA_MONTHLY_CEILING_USD: "20",
  NOVA_PRICE_CHAT_IN: "0.27",
  NOVA_PRICE_CHAT_OUT: "1.10",
  NOVA_PRICE_EMBED: "0.15",
};

export class FakeLedger implements Ledger {
  down = false;
  pings = 0;

  async ping(): Promise<void> {
    if (this.down) throw new LedgerUnavailable("fake ledger is down");
    this.pings++;
  }
}

export function fakeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    config: loadConfig(fullEnv),
    now: () => Date.UTC(2026, 9, 21, 12, 0, 0),
    ledger: new FakeLedger(),
    log: () => {},
    ...overrides,
  };
}
