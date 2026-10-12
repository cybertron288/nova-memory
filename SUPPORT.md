# Getting help

1. Read [docs/troubleshooting.md](docs/troubleshooting.md) and
   [docs/faq.md](docs/faq.md). Most problems are a missing `.env`, a
   permission that was not granted, or a provider quota.
2. Check the daemon log: `cd daemon && bun src/cli.ts logs -n 200`.
3. Search the [issues](https://github.com/cybertron288/nova-memory/issues).
4. Still stuck? Open an issue with the bug template.

Before you paste anything, remove captured text, names, window titles, URLs
and API keys. The daemon log names your open loops in plain text.

Security problems go through [SECURITY.md](SECURITY.md), never a public issue.

Nova is maintained by one person in their spare time. Replies can take a few
days.
