# Manual test checklist

What to check by hand for the features added since PR #2. Each item says how
to run it and what you should see. Automated tests cover the logic; these cover
the parts that only show on a real Mac, a real network, or a real deploy.

Run daemon commands from `daemon/`. "The app" means a build from
`scripts/build-app.sh --run`.

## 1. Offline handling (F1.6)

- [ ] **Offline shows in the panel.** With the app running and a capture or
  two queued, turn Wi-Fi off and open the panel (⌃⌥). The status line reads
  "capturing offline · N queued".
- [ ] **Capture keeps going offline.** Switch between a few windows while
  offline. `bun src/cli.ts status` shows `versions` going up.
- [ ] **The queue drains when the network returns.** Turn Wi-Fi back on. Within
  a few seconds `bun src/cli.ts logs --tag pipeline` shows the drain, and the
  queued count falls without waiting a minute.
- [ ] **No attempt is spent offline.** After the drain, `bun src/cli.ts retry`
  reports nothing parked.
- [ ] **Provider down, network up.** Point `NOVA_CHAT_BASE_URL` at an unused
  host, restart the daemon, capture something. The status line reads "can't
  reach the provider · N queued".

## 2. Digest card (F4.3)

- [ ] **Shows once a day with loops.** With at least one open loop, after 9:00,
  the card appears under the menu bar icon once.
- [ ] **Silent with no loops.** With no open loops, no card appears that day.
- [ ] **Waits while locked, full screen, or sharing.** It appears only after
  the Mac is unlocked and no full-screen app or screen share is in front.

## 3. Nova Cloud proxy (`cloud/`, Vercel preview)

Use `bunx vercel curl <path> --deployment <preview URL> --yes` from `cloud/`;
the preview is behind Vercel's login.

- [ ] **Health.** `/health` → `200 {"ok":true}`.
- [ ] **No sign-in.** `POST /v1/chat/completions` with no `Authorization` →
  `401`.
- [ ] **Bad token.** `GET /v1/usage` with `Authorization: Bearer x` → `401`.
- [ ] **Schema.** In Supabase → Table Editor, `plans` holds `new` 100000 and
  `free` 1000000.
- [ ] **Locked down.** In Supabase → Database → Functions, `allowance`,
  `reserve_tokens`, `release_tokens` and `consume_tokens` exist; calling the
  REST RPC without a key returns `401`.

After Phase C (needs a signed-in user; a real request costs money):

- [ ] **A capture goes through Gemini.** One capture is extracted through Nova
  Cloud; Supabase `usage_daily` gains two rows (`d:` and `u:`) for today.
- [ ] **Embeddings are 1536 wide.** The capture's memories are searchable
  (`bun src/cli.ts search <word>`); a width error in the log means Gemini
  ignored `dimensions`.
- [ ] **Daily cap.** Set the `free` cap to 1000 tokens in `plans`, capture
  more. The proxy answers 429; the daemon log says the quota pauses until
  midnight UTC; captures stay queued. Restore the cap.
- [ ] **Monthly ceiling.** Set `NOVA_MONTHLY_CEILING_USD` to `0.0001` on the
  preview and redeploy. Every request gets 429 with `Retry-After: 3600`.
- [ ] **Logs hold no text.** Vercel → Logs for the preview: lines show user,
  device prefix, status, token counts, never capture text.

## 4. Daemon in Nova Cloud mode

Set only `NOVA_CLOUD_URL`, `NOVA_AUTH_URL` and `NOVA_AUTH_KEY` (remove the six
`NOVA_*` and `GEMINI_API_KEY` from `.env` for this test, and put them back
after).

- [ ] **Signed out, it still runs.** `bun src/cli.ts start` logs "not signed in
  to Nova Cloud; captures are kept and wait for sign-in" and keeps capturing.
- [ ] **Signed out, nothing is lost.** Capture for a minute. `status` shows the
  queue growing; `retry` shows nothing parked.
- [ ] **`.env` still wins.** Put the six `NOVA_*` back and restart: the log
  shows no Nova Cloud line, and extraction uses your own provider.
- [ ] **A damaged store stops cleanly.** Copy `memory.db` aside, overwrite a few
  bytes near its start (`printf 'xxxxxxxx' | dd of=memory.db bs=1 seek=100
  conv=notrunc`), start the daemon. It exits with code 3 and the log says the
  store cannot be decrypted. Restore the copy.

After Phase C (sign-in in the app):

- [ ] **Sign in.** The app's Account pane signs in with GitHub or Google; the
  queue drains right after.
- [ ] **Same account again.** Sign out, sign back in as the same account: all
  memories and loops are still there.
- [ ] **Different account.** Sign in as another account: the warning names the
  previous account masked (`a•••@gmail.com`) with memory and loop counts.
  Cancel keeps everything.
- [ ] **Different account, confirmed.** Confirm: memories, loops, the Profile
  name and blocked apps are gone; the new account is signed in.
- [ ] **Claude Desktop with the app closed.** Quit Nova, wait over an hour, ask
  Claude Desktop to search your memory. It still answers (the MCP process
  renews the token itself).
- [ ] **A blocked device.** Set `devices.blocked = true` for your device's hash
  in Supabase. The Account pane shows the refusal; captures stay queued.

## 5. Earlier features still working

- [ ] **Profile pane.** Your Space → Profile saves a name and aliases; loops
  read "you owe" the right way round.
- [ ] **Permissions pane.** Turning Accessibility off in System Settings shows
  in Your Space → Permissions within a second or two.
- [ ] **`get_timeline`.** In Claude Desktop, ask "what did I work on yesterday";
  the answer lists memories from yesterday only.
- [ ] **Panel keyboard.** ↑/↓ moves focus and scrolls; hovering does not drag
  the list.
