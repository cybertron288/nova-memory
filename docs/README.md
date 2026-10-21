# Nova documentation

New here? Start with the [project README](../README.md), then
[glossary.md](glossary.md) for the terms these docs use.

## Using Nova

| Doc | What it covers |
|---|---|
| [install.md](install.md) | Build from source, permissions, connecting MCP clients |
| [privacy.md](privacy.md) | What is captured, refused, redacted, stored and sent |
| [providers.md](providers.md) | Gemini, OpenAI-compatible endpoints and local models |
| [faq.md](faq.md) | Short answers to common questions |
| [troubleshooting.md](troubleshooting.md) | When something does not work |
| [uninstall.md](uninstall.md) | Remove Nova and all its data |

## How it works

| Doc | What it covers |
|---|---|
| [architecture.md](architecture.md) | The three processes, the pipeline, encryption, search, open loops |
| [data-model.md](data-model.md) | Every table and column, the control-socket ops, the MCP tools |
| [glossary.md](glossary.md) | Plain-English definitions: embeddings, KNN, SQLCipher, AX capture, MCP |

## Decisions and plans

| Doc | What it covers |
|---|---|
| [decisions.md](decisions.md) | Design decisions R1–R11 and why they were made |
| [features.md](features.md) | Features F1–F7 and what is built |
| [roadmap.md](roadmap.md) | Milestones and what comes next |
| [deferred-tasks.md](deferred-tasks.md) | Work deliberately postponed (D-items), each with its reason |
| [testing-checklist.md](testing-checklist.md) | Manual checks for the features since PR #2: offline handling, the digest card, Nova Cloud |
| [nova-cloud-design.md](nova-cloud-design.md) | Design: accounts, Nova Cloud, device keys and caps. The proxy is in [../cloud/](../cloud/README.md); the app side is not built |
| [entity-graph-design.md](entity-graph-design.md) | Proposal: a graph of people, projects and facts. Not built |
| [local-embeddings-experiment.md](local-embeddings-experiment.md) | Proposal: on-device embeddings. Not built |

## Design

| Doc | What it covers |
|---|---|
| [design/design-system.md](design/design-system.md) | Colours, type, components and screen flows of the macOS app |
| [design/motion-spec.md](design/motion-spec.md) | Every animation timing, as tokens the Swift code uses |

## Spikes

`../spikes/` holds the feasibility experiments that came before the app.
`../spikes/reports/` has their results, and `../spikes/OPERATOR-GUIDE.md`
explains how to rerun them.
