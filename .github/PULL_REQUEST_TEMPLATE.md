## What and why

<!-- What changed, and the problem it solves. Link the issue. -->

## How I verified it

<!-- Tests added or run, manual steps, screenshots for UI changes. Eval scores for prompt changes. -->

## Checklist

- [ ] `cd daemon && bun test` and `bun run typecheck` pass
- [ ] `swift test` passes for any Swift package I changed
- [ ] New capture-derived tables or columns are in `deleteScope` (`daemon/src/forget.ts`)
- [ ] Content-bearing columns use `encryptField`; nothing new is written to stdout from `nova mcp` or `nova-capture --emit`
- [ ] Tests and examples use fictional names and data only
