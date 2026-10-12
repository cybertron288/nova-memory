# Running Nova

Operational notes for a development checkout: starting the stack, inspecting
it, and the things that go wrong. For provider keys and MCP client setup see
`daemon/README.md`; for what the app *is*, `docs/features.md`.

---

## The stack

Three processes. Starting the shell starts the rest.

```
Nova.app (build/Nova.app)       the panel; supervises the daemon
  └─ bun src/cli.ts start       the daemon, run from daemon/ in this checkout
       └─ nova-capture --emit   the app's own copy; reads the screen; exits with it
```

They find each other through one file:

```
~/Library/Application Support/Nova/control.sock
```

The shell restarts a daemon that dies — after 1 s, doubling to 60 s, and the
streak resets after 5 min of uptime. After 10 failures in a row it stops and the
menu shows *Stopped restarting*, the daemon's last line (usually the
reason), and *Restart Nova*.

A daemon started by hand is adopted, not replaced: the shell watches it and
only spawns its own once it is gone. That is how to run the daemon in a
terminal to read its log live — with two differences from the app's own
daemon, below under [Live logs](#live-logs).

---

## Start

**Everything:**

```sh
scripts/build-app.sh --run
```

That builds the shell and capture, bundles them as `build/Nova.app`, signs it
with the self-signed "Nova Dev" identity (created in your login keychain the
first time), quits any running Nova and opens the new one. The first launch
asks for Accessibility for **Nova**; the grant survives every rebuild because
the identity does not change. The first window AX cannot read (a terminal like
Metalterm, or Zed) asks for Screen Recording for **Nova**, which the OCR
fallback needs. After granting it, relaunch Nova so capture restarts; until
then capture stays AX-only.

The daemon is not in the app. The shell runs it from `daemon/` with Bun, so
Bun loads the provider keys from `daemon/.env`. It finds Bun at `~/.bun/bin`,
`/opt/homebrew/bin` or `/usr/local/bin`. Override with `NOVA_BUN`,
`NOVA_DAEMON_DIR`, and `NOVA_CAPTURE_BIN` (which capture the daemon launches).

**After a change:**

| Changed | Do |
|---|---|
| Shell or capture | `scripts/build-app.sh --run` |
| Daemon | `pkill -f "cli.ts start"` — the app restarts it within a second; a clean stop is not counted as a failure |

**Always launch the app with `open` or `--run`.** Running
`build/Nova.app/Contents/MacOS/NovaShell` from a terminal works, but macOS then
charges the Accessibility grant to the terminal, not Nova. The bare
`./shell/.build/release/NovaShell` is the same, and uses the checkout's debug
capture — keep it for debugging.

The daemon logs to a file, not a terminal — see [Live logs](#live-logs).

**Daemon on its own** — headless, without the shell:

```sh
cd daemon && bun src/cli.ts start
```

It runs in the foreground. `start` refuses if a daemon is already running,
because two daemons on one store double every capture and make `pause` reach
only one of them. `--force` stops the running one and takes over.

The shell has no Dock icon. Look for the aperture glyph in the menu bar — an
unlabelled monochrome iris, easy to miss among other menu-bar apps.

**Opening the panel:** click the glyph, or press ⌃⌥ from any app. The chord
needs Nova's Accessibility grant, so it only works in every app when Nova was
launched as the app.

---

## Stop

Quit from the glyph's menu, or:

```sh
pkill -x NovaShell          # the shell stops the daemon, which stops capture
```

`-x` matches the process name; `-f` would also match an editor with a
`NovaShell/` source file open.

The shell sends the daemon SIGTERM, waits up to 3 s, then SIGKILL. A daemon it
adopted rather than started is left running. Stopping only the daemon
(`pkill -f "cli.ts start"`) does not stick while the shell is up — it restarts.

A clean shutdown unlinks the socket. If `control.sock` is still there
afterwards the daemon was killed hard; `start` removes a stale one.

---

## Live logs

The shell writes the daemon's output — capture's included, since it runs
under the daemon — to one file, `~/Library/Logs/Nova/daemon.log`, appended across restarts. Read
it with `logs`, which colors it with one color and marker per subsystem
(`●` capture, `▸` ingest, `◆` pipeline, `■` nova), with `✗` on failures, `⚠` on
quota/back-off and dropped lines, `✓` on recovery, and the repetitive
`suppressed N` lines dimmed:

```sh
cd daemon && bun src/cli.ts logs                # last 50 lines, then follow
bun src/cli.ts logs --tag pipeline -n 200       # one subsystem
bun src/cli.ts logs --no-dim                    # don't dim the noise
```

Ctrl-C stops watching, not Nova. Every line starts with a local timestamp.

Only the problems:

```sh
bun src/cli.ts logs | grep -E "error|failed|dropped"
```

**Checking the OCR fallback.** Watch capture alone, then bring a window AX
cannot read (Metalterm, Zed) to the front for ~20 s:

```sh
cd daemon && bun src/cli.ts logs --tag capture -n 200
```

| Line | Means |
|---|---|
| `OCR needs Screen Recording for Nova ...` | not granted yet; capture stays AX-only. Grant it, then relaunch Nova |
| `suppressed N (... ocr-throttled=… ocr-unchanged=…)` | OCR is running; these are ticks inside the 15 s per-window budget or with unchanged pixels |
| `suppressed N (... ocr-no-permission=…)` | still no Screen Recording grant for this process |
| `OCR failed: ...` | ScreenCaptureKit or Vision error, logged once per distinct message |
| only `empty=` climbing while the window is in front | OCR is not running; check the daemon was relaunched after the rebuild |

**Or run the daemon in a terminal**, with its output in front of you:

```sh
cd daemon && bun src/cli.ts start --force
```

`--force` stops the shell's daemon and takes over. The shell adopts the
terminal's daemon instead of starting another; close that terminal and the
shell starts its own again within a few seconds. Output from a terminal daemon
goes to the terminal, not the log file.

A daemon started in a terminal is not the app's, in two ways:

- **It runs the checkout's capture**, `capture/.build/debug/nova-capture`, not
  the app's copy — build it first with `swift build --package-path capture`.
- **It reads the screen under the terminal's Accessibility grant**, not Nova's.
  Without one, capture logs `AXError -25211` and records nothing; grant your
  terminal, or read the app's log with `bun src/cli.ts logs` instead.

While a terminal daemon is adopted, `scripts/build-app.sh --run` does not
replace it, so a capture change does not take effect until that terminal is
closed.

---

## The CLI

Every subcommand except `start` and `mcp` talks over the control socket, so the
daemon must be running. None of them opens the store — that is the point.

```sh
bun src/cli.ts status                      # capturing? paused? queue depth?
bun src/cli.ts loops                       # open loops, newest first
bun src/cli.ts loops --direction i_owe     # i_owe | owed_to_me | unanswered | stalled | any
bun src/cli.ts search "what did I promise" # semantic search over memory
bun src/cli.ts done <loop-id>
bun src/cli.ts snooze <loop-id>            # default: next 09:00 local
bun src/cli.ts snooze <loop-id> --until 1790000000000
bun src/cli.ts dismiss <loop-id>           # permanent by design; never resurfaces
bun src/cli.ts pause                       # ingest drops lines; capture keeps running
bun src/cli.ts resume
bun src/cli.ts mcp                         # stdio MCP server, for Claude Desktop
```

`loops` prints ids, which the action subcommands take.

---

## Capture on its own

`nova-capture` can run without the daemon, which is how to tell a capture
problem from a pipeline problem.

```sh
cd capture && swift build

# What does Nova see in a given app right now?
./.build/debug/nova-capture --dump --app "Google Chrome"

# The wire format the daemon consumes, one JSON line per capture.
./.build/debug/nova-capture --emit

# Other flags: --no-ocr, --regions (region debug), --delay <seconds>
```

`--app` reads a named app instead of the frontmost one — running `--dump` from
a terminal otherwise measures the terminal.

---

## Looking in the store

The store is SQLCipher-encrypted with per-field AES on top, so `sqlite3` will
not open it. Go through the daemon's own code:

```sh
cd daemon && bun -e '
import { openDb, fieldKey, decryptField } from "./src/db";
import { listOpenLoops } from "./src/loops";
import { join } from "node:path"; import { homedir } from "node:os";
const db = await openDb(join(homedir(),"Library","Application Support","Nova","memory.db"));
const key = await fieldKey();
for (const l of listOpenLoops(db, key, { direction: "any", limit: 20 }))
  console.log(`[${l.direction}] ${l.description}  (${l.sourceApp})`);
'
```

Useful counts:

```sh
cd daemon && bun -e '
import { openDb } from "./src/db";
import { join } from "node:path"; import { homedir } from "node:os";
const db = await openDb(join(homedir(),"Library","Application Support","Nova","memory.db"));
for (const t of ["memory_threads","memory_versions","memory_derivatives","open_loops"])
  console.log(t, db.query(`select count(*) c from ${t}`).get().c);
console.log(db.query("select state, count(*) c from open_loops group by state").all());
console.log(db.query("select source_app, count(*) c from memory_threads group by source_app order by c desc").all());
'
```

**Do not run `sqlite3` against it**, and do not write to it while the daemon is
running: the daemon is meant to be the only process that opens the store.
Reading it while stopped is fine.

---

## Talking to the socket directly

Useful when the question is "does the daemon answer, or is the shell wrong?"

```sh
cd daemon && bun -e '
let buf = "";
Bun.connect({ unix: process.env.HOME + "/Library/Application Support/Nova/control.sock",
  socket: {
    // Accumulate until a newline. A large reply arrives in several chunks, and
    // parsing the first one sees truncated JSON and never resolves — this cost
    // an hour once.
    data(s, d) {
      buf += d.toString();
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      console.log(buf.slice(0, nl));
      process.exit(0);
    },
    open(s) { s.write(JSON.stringify({ id: 1, op: "status" }) + "\n"); },
  }});
setTimeout(() => { console.log("no reply in 5s"); process.exit(1); }, 5000);
'
```

Ops: `status`, `list_loops`, `act_on_loop`, `pause`, `resume`, `list_memories`.

---

## Tests

```sh
cd daemon && bun test              # ~330 tests
cd daemon && bun run typecheck
cd capture && swift test           # ~44 tests
swift build --package-path shell -c release
```

The daemon suite is slow enough (~35s) that timing-sensitive tests can flake
under load. A failure that does not reproduce in isolation is a flake, not a
regression — but confirm by running it alone before dismissing it.

---

## When something is wrong

**The panel shows "Nova isn't running".**
It is telling the truth: no daemon on the socket. The shell is restarting it;
if it keeps failing, click the glyph for the reason, and read
`~/Library/Logs/Nova/daemon.log`. The panel never caches — a stale "capturing"
would be the worst failure this product could have, so it shows attention
instead.

**A capture is dropped.**
`[ingest] write failed … / dropped line: write-failed` in the daemon log means
a capture was lost and not retried. Read the error after `write failed` — it
names the cause.

**`no AXManualAccessibility opt-in` for Chrome, Ghostty, Metalterm.**
Not an error. Those apps do not implement the opt-in and capture fine without
it; their trees build in response to being walked.

**An app captures nothing.**
`nova-capture --dump --app "<name>"` shows what Nova can see. `axContentChars:
0` with `sawContentRole: false` means the app exposes no content subtree — a
per-app parser gap, not a permission problem.

**The panel looks wrong after a rebuild.**
A plain `swift build` never touches `build/Nova.app`. Run
`scripts/build-app.sh --run`, which rebuilds the bundle and relaunches it. For
anything in `daemon/src`, restart the daemon instead (`pkill -f "cli.ts start"`).

**A loop looks wrong.**
Extraction is a prompt against a live model, so behaviour changes with the
prompt. To test a change without waiting for a capture, call the provider
directly with the text in question — `providerFromEnv().extractLoops(text, ctx)`.

Then check the change against the eval set before keeping it. One example
proves little: a single capture gave its loop in 1 run of 4 at the old
temperature.

```sh
cd daemon
bun eval/export.ts <version-id-prefix>...   # copy captures out of the store
bun eval/run.ts <name> --reps 3              # run the prompts, save raw answers
bun eval/score.ts <name> [<other>] -v        # precision, recall, closures, memory noise
```

Fixtures, labels (`eval/labels.local.json`) and runs hold captured content.
They are gitignored and stay on this machine. `--fixtures <file>` runs another
fixture set, such as the sender-attributed Slack set.

---

## Costs

Extraction and embeddings are billed API calls, made by the daemon on a ~15s
tick while capture is running. Stopping the daemon stops all of it; the panel
alone costs nothing. Worth knowing before leaving it running overnight.
