# Nova Cloud proxy

An OpenAI-compatible endpoint that lets a signed-in Nova user process captures
without an API key of their own. Design: [../docs/nova-cloud-design.md](../docs/nova-cloud-design.md).

It verifies the Supabase session, accepts only requests shaped like the
daemon's, enforces daily caps per device and per account plus a monthly spend
ceiling, and forwards to the model provider set in its environment. It never
stores or logs a request or response body.

## Run the tests

```sh
cd cloud && bun install && bun test
```

## Set up

Both services have free plans that cover Nova Cloud; see the design's
"Free-plan limits".

### 1. Supabase

1. Create a project.
2. Turn on the GitHub and Google providers under Authentication.
3. Under Authentication → JWT signing keys, switch to an asymmetric key
   (ES256 or RS256). The proxy verifies sessions against the project's
   published JWKS, and a project still on the legacy shared HS256 secret
   publishes no usable key, so every sign-in would be refused.
4. Apply the schema:

   ```sh
   cd cloud
   bunx supabase link --project-ref <project ref>
   bunx supabase db push
   ```

### 2. Model provider accounts

Create API keys for the chat and embedding providers Nova Cloud will call. Use
paid tiers whose terms neither keep inputs nor train on them: the welcome
screen promises text is "never kept". Set a hard monthly spending limit in each
provider's dashboard as a backstop to `NOVA_MONTHLY_CEILING_USD`.

### 3. Vercel

Create a project with `cloud/` as its root directory and set these environment
variables. The proxy refuses to start if a required one is missing or invalid.

| Variable | Required | Meaning |
|---|---|---|
| `UPSTREAM_CHAT_BASE_URL` | yes | OpenAI-compatible base URL for chat |
| `UPSTREAM_CHAT_API_KEY` | yes | Its key |
| `UPSTREAM_CHAT_MODEL` | yes | The chat model every request uses |
| `UPSTREAM_EMBED_BASE_URL` | yes | OpenAI-compatible base URL for embeddings |
| `UPSTREAM_EMBED_API_KEY` | yes | Its key |
| `UPSTREAM_EMBED_MODEL` | yes | The embedding model; it must return 1536 dimensions |
| `SUPABASE_URL` | yes | `https://<project ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | The service-role key. Server only; never in the app. |
| `NOVA_MONTHLY_CEILING_USD` | yes | Spend at which Nova Cloud pauses for everyone until the month ends |
| `NOVA_PRICE_CHAT_IN` | yes | USD per million chat input tokens |
| `NOVA_PRICE_CHAT_OUT` | yes | USD per million chat output tokens |
| `NOVA_PRICE_EMBED` | yes | USD per million embedding tokens |
| `NOVA_IP_HASH_SECRET` | yes | At least 32 random characters. IPs are stored only as an HMAC with this secret, because the IPv4 space is small enough to reverse a plain hash. Generate one with `openssl rand -hex 32`. |
| `NOVA_IP_DAILY_LIMIT` | no | Requests per IP per day, default 5000 |
| `NOVA_IP_SIGNUP_LIMIT` | no | New accounts per IP per day, default 3 |

Vercel's Bun preset finds the server by itself: it needs `bun.lock` and
`src/server.ts` in the project root, both of which `cloud/` has, so
`vercel.json` only sets `bunVersion`.

Then deploy a preview:

```sh
cd cloud && bunx vercel deploy
```

Check it. Neither call reaches the model provider, so neither costs anything:

```sh
curl -s https://<preview>/health                     # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<preview>/v1/chat/completions   # 401
```

## Plans and caps

Daily caps live in the `plans` table: `new` (an account's first 7 days) and
`free`. Change a cap with an `update plans` statement; no deploy is needed.
Each request counts against both the device and the account, and the lower
remaining allowance wins.
