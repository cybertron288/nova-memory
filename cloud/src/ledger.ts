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

export interface Allowance {
  plan: "new" | "free";
  /** The plan's daily token cap, applied to the device and the account alike. */
  cap: number;
  deviceUsedToday: number;
  accountUsedToday: number;
  monthCostMicros: number;
  /** False when the account already linked 3 other devices in 30 days. */
  deviceLinked: boolean;
  deviceBlocked: boolean;
  /** This request would have created an account over its IP's daily limit. */
  signupRefused: boolean;
  ipRequestsToday: number;
}

export interface LedgerKey { userId: string; deviceHash: string; ipHash: string; day: string; month: string }

export interface Ledger {
  /** One cheap round trip. Keeps a free Supabase project from pausing. */
  ping(): Promise<void>;
  allowance(k: LedgerKey): Promise<Allowance>;
  consume(k: LedgerKey, tokensIn: number, tokensOut: number, costMicros: number): Promise<void>;
}

export class SupabaseLedger implements Ledger {
  private readonly db: SupabaseClient;
  private readonly signupLimit: number;

  constructor(config: Config) {
    this.signupLimit = config.ipSignupLimit;
    this.db = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async ping(): Promise<void> {
    const { error } = await this.db.from("plans").select("name").limit(1);
    if (error) throw new LedgerUnavailable(`ping: ${error.message}`, { cause: error });
  }

  async allowance(k: LedgerKey): Promise<Allowance> {
    const { data, error } = await this.db.rpc("allowance", {
      p_user: k.userId, p_device: k.deviceHash, p_ip: k.ipHash, p_day: k.day, p_month: k.month,
      p_signup_limit: this.signupLimit,
    });
    if (error || !data) throw new LedgerUnavailable(`allowance: ${error?.message ?? "no row"}`, { cause: error });
    const r = data as AllowanceRow;
    return {
      plan: r.plan, cap: Number(r.cap), deviceUsedToday: Number(r.device_used_today),
      accountUsedToday: Number(r.account_used_today), monthCostMicros: Number(r.month_cost_micros),
      deviceLinked: r.device_linked, deviceBlocked: r.device_blocked,
      signupRefused: r.signup_refused, ipRequestsToday: Number(r.ip_requests_today),
    };
  }

  async consume(k: LedgerKey, tokensIn: number, tokensOut: number, costMicros: number): Promise<void> {
    const { error } = await this.db.rpc("consume_tokens", {
      p_user: k.userId, p_device: k.deviceHash, p_ip: k.ipHash, p_day: k.day, p_month: k.month,
      p_in: tokensIn, p_out: tokensOut, p_cost_micros: costMicros,
    });
    if (error) throw new LedgerUnavailable(`consume_tokens: ${error.message}`, { cause: error });
  }
}

type AllowanceRow = {
  plan: "new" | "free"; cap: number; device_used_today: number; account_used_today: number;
  month_cost_micros: number; device_linked: boolean; device_blocked: boolean;
  signup_refused: boolean; ip_requests_today: number;
};
