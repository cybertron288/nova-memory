// Usage and spend, kept in Supabase Postgres. Reached over Supabase's HTTP API
// only: short-lived serverless instances would exhaust direct connections.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Config } from "./config";

/** Supabase could not be reached, or an RPC failed. The proxy fails closed. */
export class LedgerUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LedgerUnavailable";
  }
}

export interface Ledger {
  /** One cheap round trip. Keeps a free Supabase project from pausing. */
  ping(): Promise<void>;
}

export class SupabaseLedger implements Ledger {
  private readonly db: SupabaseClient;

  constructor(config: Config) {
    this.db = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async ping(): Promise<void> {
    const { error } = await this.db.from("plans").select("name").limit(1);
    if (error) throw new LedgerUnavailable(`ping: ${error.message}`, { cause: error });
  }
}
