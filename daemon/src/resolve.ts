/**
 * Which provider a process uses. A provider configured in the environment
 * always wins, unchanged from providerFromEnv; Nova Cloud is used only when
 * none is, so a developer's .env is never overridden by a signed-in session.
 */
import { cloudConfigFromEnv, NovaCloudProvider } from "./cloud";
import { deviceKey } from "./keychain";
import {
  MissingKeyProvider, OPENAI_COMPAT_VARS, providerFromEnv, UnconfiguredProvider,
  type CallSink, type InferenceProvider,
} from "./provider";
import { keychainSecret, SessionStore, supabaseRefresh } from "./session";

export type ProviderMode = "env" | "cloud" | "none";

export interface Resolved {
  provider: InferenceProvider;
  mode: ProviderMode;
  /** Present only in cloud mode. */
  session: SessionStore | null;
}

/** Never throws for a configuration problem: `nova mcp` must start regardless. */
export async function resolveProvider(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  sink: CallSink | undefined,
  deps: { lockPath: string; session?: SessionStore; deviceKey?: () => Promise<string> },
): Promise<Resolved> {
  const configured = OPENAI_COMPAT_VARS.some((v) => (env[v] ?? "").trim() !== "") || !!env.GEMINI_API_KEY;
  if (configured) return { provider: providerFromEnv(env as NodeJS.ProcessEnv, sink), mode: "env", session: null };

  let cloud;
  try {
    cloud = cloudConfigFromEnv(env);
  } catch (e) {
    return { provider: new UnconfiguredProvider(e instanceof Error ? e.message : String(e)), mode: "none", session: null };
  }
  if (!cloud) return { provider: new MissingKeyProvider(), mode: "none", session: null };

  const session = deps.session ?? new SessionStore({
    secrets: keychainSecret("session"),
    lockPath: deps.lockPath,
    refresh: supabaseRefresh(cloud.authUrl, cloud.authKey),
  });
  const key = await (deps.deviceKey ?? deviceKey)();
  return { provider: new NovaCloudProvider(cloud, session, key, sink), mode: "cloud", session };
}
