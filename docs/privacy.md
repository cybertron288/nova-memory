# Privacy

This page describes what Nova reads, what it refuses, what it stores, and what
it sends. It describes the code in this repository. If the code and this page
disagree, the code is right and this page has a bug.

Nova has no server. Nothing goes to the Nova authors: no telemetry, no crash
reports, no analytics, no account. The only network destinations for your
content are the AI provider endpoints that you configure.

## What Nova reads

Every 3 seconds, Nova reads the **frontmost window** through the macOS
accessibility API:

- the app name and bundle identifier
- the window title
- the page URL, for browsers
- the visible text of the window

Nova separates the content of the window from app chrome such as sidebars and
toolbars, and keeps the content. It skips text it has already seen. In chat
apps it keeps the author on each message ("Lee: …"), because open loops depend
on who said what.

Nova never reads password fields (`AXSecureTextField`).

If a window exposes no readable text and you granted Screen Recording, Nova
takes a screenshot of that one window and reads it with Apple's on-device
Vision text recognition. This runs at most once every 15 seconds per window.
The screenshot stays in memory and is never written to disk or sent anywhere.
Only the recognized text continues through the steps below.

Nova does not record audio, the microphone, the camera, keystrokes or the
clipboard.

## What Nova refuses before it stores anything

These checks run on every capture before it reaches the store and before any
provider call. A refused capture is dropped whole. These categories are
built in and you cannot turn them off.

| Category | What is refused |
|---|---|
| Password managers | 1Password, Bitwarden, KeePassXC, Keychain Access, Passwords, Dashlane, LastPass, Enpass, Proton Pass. Browser password pages (`chrome://password-manager`, `about:logins`, passwords.google.com, and the web vaults of 1Password, Bitwarden, LastPass, Dashlane and Proton Pass). |
| Banking and payments | Sites matched by host, such as chase.com, bankofamerica.com, hsbc.com, barclays.co.uk, revolut.com, paypal.com, stripe.com, and hosts that start with `netbanking.`, `online.`, `secure.` or `retail.`. Apps with "banking" in the name. |
| Private browsing | Windows whose title ends with Incognito, Private Browsing, Private Window or InPrivate. |
| Screen sharing and meetings | Zoom, Microsoft Teams, Webex, Google Meet, Slack Huddle, Around, Whereby, GoToMeeting, join.me, AnyDesk, TeamViewer, Chrome Remote Desktop, Screens. Meeting sites (meet.google.com, zoom.us, teams.microsoft.com, whereby.com, webex.com). Windows whose title says the screen is being shared. |

The full lists are in `daemon/src/sensitive.ts`.

Banking is matched on the site's host, never on words in a title. A
conversation about a bank is still captured.

### Your own deny-list

You can refuse more apps and sites. Open the menu → **Your Space** →
**Blocked apps**, or use the CLI from `daemon/`:

```sh
bun src/cli.ts exclude --app "Signal"
bun src/cli.ts exclude --domain example-clinic.com
bun src/cli.ts exclusions        # list, with ids
bun src/cli.ts unexclude <id>
```

A domain rule covers its subdomains. Adding a rule also deletes what Nova
already captured from that source. Your list can only add refusals. It cannot
remove the built-in ones.

## What Nova redacts before it stores anything

In captures that are not refused, Nova replaces these spans with `[redacted]`
before the text is stored or sent:

- **Private keys and API tokens:** PEM private keys, and tokens with a known
  vendor prefix (Anthropic, OpenAI, AWS access key ids, GitHub, GitLab, Slack,
  Google API keys, npm), and JSON Web Tokens.
- **Labelled secrets:** the value after a label such as `password:`,
  `api_key=`, `secret is`, `access token:` or `client secret:`, when that value
  contains a digit or a symbol. The label stays.
- **Bearer tokens:** the value after `Bearer`.
- **Account and password pairs:** "alex@example.com / s3cret!" keeps the
  account and drops the password.
- **One-time codes:** a 4 to 8 digit code named as an OTP, 2FA, MFA,
  verification, security or authentication code, and a bare code sent within
  3 lines of a request for one.
- **Payment cards:** numbers with a real card issuer prefix and length that
  pass the Luhn check.
- **CVV and CVC codes**, when labelled.
- **Bank accounts:** account, IBAN, routing, sort code and IFSC values when
  labelled, and long numbers on the same line as an IFSC code.
- **National identifiers:** US Social Security numbers (hyphenated), Indian
  Aadhaar numbers (grouped 4-4-4) and Indian PAN numbers.

These patterns are deliberately narrow. A pattern that matched ordinary prose
would erase what Nova exists to remember. Some secrets will not match. Use the
deny-list for sources that you never want read.

Every time the daemon starts, it applies the current rules to what is already
stored. It deletes threads from password managers, and it redacts older
captures, memories and loops again.

## What goes to your provider

Nova does not run a language model by default. It sends these to the endpoints
you configure:

| Sent | To | Why |
|---|---|---|
| The new text of a changed capture, with its app name, window title, URL, time, and the tail of the previous version for context | chat endpoint | To extract up to six facts ("memories") |
| The text of a changed capture, the descriptions of your open loops, and your configured name and aliases | chat endpoint | To find new open loops and close finished ones. Skipped for AI assistants, terminals and editors. |
| Extracted facts, and short descriptions of open loops | embedding endpoint | To make memories searchable, and to detect a loop that was already found |
| Your search query | embedding endpoint | When you search, or an AI app calls `search_memory` |
| Your open loops and yesterday's memories | chat endpoint | Once a day, for the morning briefing |
| A short fixed string ("quota check") | embedding endpoint | To check whether a rate limit has ended |

Before anything leaves your Mac, Nova replaces email addresses with `[email]`
and phone numbers with `[phone]` in the capture text, title, URL and embedding
input. These stay in your local store, so a memory still names the person. The
provider does not see the address.

One exception to know about: `NOVA_USER_NAME` and `NOVA_USER_ALIASES` go into
the loop prompt as written. If an alias is an email address, the provider sees
it.

API keys are never written to the store or the log. Nova removes them from
provider error messages.

Your provider's own terms decide what it does with what it receives. Read them.

## What never leaves your Mac

- The store itself: raw captures, memories, loops, vectors.
- Screenshots used for OCR.
- Your deny-list, settings and the log.
- Anything from a refused source.
- Anything captured while capture is paused (it is not stored either).

## Encryption at rest

The store is encrypted twice:

1. The whole database file is encrypted with SQLCipher.
2. Every field that quotes your screen is also encrypted with AES-256-GCM:
   window titles, URLs, capture text, memories, loop descriptions, and your
   deny-list values.

Some fields are stored without field encryption, inside the encrypted file:
app names, timestamps, content hashes, and a loop's direction, counterparty
and due phrase (for example "by Friday").

The two keys are 32 random bytes each, generated on first use and stored in
your login keychain under the service `dev.nova.keys`, accounts `db` and
`field`. They are never derived from facts about your machine. If you delete
these keychain items, the store can no longer be read.

The SQLCipher store cannot be opened with `sqlite3`.

## Where your data lives

| Path | What |
|---|---|
| `~/Library/Application Support/Nova/memory.db` | The encrypted store (plus `memory.db-wal`) |
| `~/Library/Application Support/Nova/control.sock` | The local socket the app and CLI use to talk to the daemon. Owner-only. |
| Login keychain, service `dev.nova.keys` | The two encryption keys |
| `~/Library/Logs/Nova/daemon.log` | The daemon's log, mode `0600` (owner-only) |

The log is **not encrypted**. It names your open loops in plain text, so that
you can tell from the log why a loop appeared. Once the log is a week old, it
moves to `daemon.log.1`, replacing the one before. At most two weeks of log
exist at a time.

## See what Nova did

Open the menu → **Your Space** → **Activity**. It has two lists:

- **Read from your screen:** what Nova captured.
- **Sent to your provider:** every call that left your Mac, with the
  provider, model, size in characters, time and outcome. It records sizes, not
  content.

From the CLI: `bun src/cli.ts calls` in `daemon/`.

## Pause

Open the menu → **Pause capturing**. While paused, the capture process still
runs, but nothing it reads is stored or sent. Choose **Resume capturing** to
continue. A pause is saved, so it holds across restarts until you resume. To
stop all reading, quit Nova.

## Delete and retention

Open the menu → **Your Space** → **Your data**. There you can:

- see what Nova holds, by app
- delete everything from one app, from a time range, or everything
- choose how long Nova keeps captured text: 7, 30, 90 (default) or 365 days,
  or forever
- choose how long Nova keeps memories: forever (default) or 365 days

When captured text passes its retention period, Nova blanks the text and keeps
the memories made from it. Retention runs once a day.

A delete is immediate and cannot be undone. It removes captures, the memories
and vectors made from them, and the loops they alone support. "Delete
everything" also empties the log, and can optionally clear the Sent list.

From the CLI, in `daemon/`, with the daemon running:

```sh
bun src/cli.ts forget --app "Slack"
bun src/cli.ts forget --since 2026-10-01 --until 2026-10-02
bun src/cli.ts forget --all --clear-call-log
```

It shows the counts and asks before it deletes. `--yes` skips the question.

Nova cannot recall what it already gave to an AI app over MCP, or what your
provider already received.

## Keep content off the network

Point both the chat and embedding endpoints at an OpenAI-compatible server on
your own Mac, such as Ollama or LM Studio. Then no captured content leaves the
machine. See [providers.md](providers.md) for the requirements, especially the
1536-dimension embedding rule.

If you connect Nova to a hosted AI app over MCP, that app receives the search
results and loops it asks for.
