# Third-party software

Nova is licensed under the [GNU AGPL v3](LICENSE). It depends on the
following projects, which keep their own licenses. Nova does not bundle or
redistribute them: they are installed by `bun install` or Homebrew on your
machine.

| Project | Used for | License |
|---|---|---|
| [SQLCipher](https://www.zetetic.net/sqlcipher/) (Community Edition) | Whole-file encryption of the store, loaded from Homebrew | BSD-style (Zetetic) |
| [sqlite-vec](https://github.com/asg017/sqlite-vec) | Vector search inside SQLite | MIT or Apache-2.0 |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | The MCP server (`nova mcp`) | MIT |
| [Bun](https://bun.sh) | Runtime for the daemon | MIT |
| [TypeScript](https://www.typescriptlang.org) | Type checking (development only) | Apache-2.0 |

Transitive npm dependencies are listed in `daemon/bun.lock`. At the time of
writing they are MIT, ISC, BSD-2-Clause, BSD-3-Clause or Apache-2.0.

The Swift packages (`capture/`, `shell/`) use only Apple system frameworks.

The Code of Conduct is adapted from the
[Contributor Covenant](https://www.contributor-covenant.org) 2.1, licensed
under CC BY 4.0.
