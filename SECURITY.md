# Security policy

Nova stores what appears on your screen. A security bug in Nova can expose
private messages, credentials and personal data. Please report them privately.

## Report a vulnerability

Use GitHub's private reporting:
**[Report a vulnerability](https://github.com/cybertron288/nova-memory/security/advisories/new)**
(the repository's **Security** tab → **Report a vulnerability**).

Do not open a public issue, pull request or discussion for a security problem.

Please include:

- what an attacker can do, and what they need first (local user, another app,
  network access);
- steps to reproduce, with fictional data only;
- the commit you tested.

You will get a reply within 7 days. We will agree a disclosure date with you,
and credit you in the advisory unless you ask us not to.

## Supported versions

Nova has no stable release yet. Only the latest commit on `main` is supported.

## Scope

In scope:

- reading the store or its keys without the user's Keychain access;
- the control socket (`~/Library/Application Support/Nova/control.sock`) and
  the MCP server accepting requests they should refuse;
- captured content reaching the provider when it should be refused or
  redacted (banking sites, private browsing, screen sharing, the deny-list,
  card and ID numbers, emails and phone numbers outbound);
- data that survives a delete (`deleteScope`) or a retention sweep;
- secrets or captured text written to logs or to stdout.

Out of scope:

- what your configured AI provider does with the data you send it;
- attacks that already need root, or the user's unlocked Keychain;
- a malicious LLM client you connected over MCP reading what Nova's tools
  return. That is the tools working as designed.

How Nova protects data is described in [docs/privacy.md](docs/privacy.md) and
[docs/architecture.md](docs/architecture.md).
