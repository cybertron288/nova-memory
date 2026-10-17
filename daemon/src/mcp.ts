// MCP server (spec 4.4). Three tools over stdio, which is what Claude Desktop
// spawns: search_memory (§2.1), get_open_loops (§2.3, PRD F4) and
// get_timeline (F3.3).
//
// stdout is the protocol wire once StdioServerTransport is connected — every
// other module in this daemon logs to stderr already (see ingest.ts,
// pipeline.ts, provider.ts), so nothing here may add a stray console.log.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Database } from "bun:sqlite";
import { searchMemory, type SearchHit } from "./search";
import { listOpenLoops, type OpenLoop, type LoopDirection } from "./loops";
import { listMemoriesBetween, type TimelineEntry } from "./memories";
import type { InferenceProvider } from "./provider";

const LOOP_FILTERS = new Set(["i_owe", "owed_to_me", "unanswered", "stalled", "any"]);

/** Render hits so the model can quote them and cite where they came from. */
export function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) {
    return "No matching memories. Either nothing matching was captured, or capture was not running at the time.";
  }
  return hits.map((h) => {
    const when = new Date(h.at).toISOString().replace("T", " ").slice(0, 16);
    const where = h.url ? `${h.app} — ${h.url}` : `${h.app} — ${h.windowTitle}`;
    return `- ${h.text}\n  (${when} · ${where})`;
  }).join("\n");
}

/** Render a period's memories, saying so when the limit cut it short. */
export function formatTimeline(items: TimelineEntry[], total: number): string {
  if (items.length === 0) {
    return "No memories in this period. Either nothing was captured, or capture was not running at the time.";
  }
  const lines = items.map((m) => {
    const when = new Date(m.capturedAt).toISOString().replace("T", " ").slice(0, 16);
    const app = m.sourceApp ?? "unknown app";
    const where = m.url ? `${app} — ${m.url}` : m.windowTitle ? `${app} — ${m.windowTitle}` : app;
    return `- ${m.text}\n  (${when} · ${where})`;
  }).join("\n");
  return total > items.length
    ? `The first ${items.length} of ${total} memories in this period, oldest first. `
      + `Ask for a shorter period to see the rest.\n${lines}`
    : lines;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * An ISO 8601 date or date-time as epoch ms, or null if it is neither. A bare
 * date is a local day: its start, or with `end` the next day's start, so
 * `to: "2026-10-14"` includes the whole of the 14th.
 */
export function parseInstant(value: string, end: boolean): number | null {
  const d = DATE.exec(value);
  if (d) {
    const [y, m, day] = [Number(d[1]), Number(d[2]) - 1, Number(d[3])];
    const t = new Date(y, m, day + (end ? 1 : 0));
    // Rejects 2026-02-30, which Date would roll into March.
    const check = new Date(y, m, day);
    if (check.getFullYear() !== y || check.getMonth() !== m || check.getDate() !== day) return null;
    return t.getTime();
  }
  if (!DATETIME.test(value)) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * Render loops so the model can act on them and cite the commitment.
 *
 * Direction is spelled out rather than passed through as an enum value: "you
 * said you would" is what makes the row actionable, and `i_owe` is not. The
 * source app lets the model cite where it was seen, and the id is what
 * `nova done|snooze|dismiss` takes.
 */
export function formatLoops(loops: OpenLoop[]): string {
  if (loops.length === 0) {
    return "No open loops. Either nothing unfinished was captured, or capture was not running.";
  }
  const lead: Record<string, string> = {
    i_owe: "You said you would",
    owed_to_me: "Someone owes you",
    unanswered: "Unanswered",
    stalled: "Stalled",
  };
  return loops.map((l) => {
    const who = l.counterparty ? ` · with ${l.counterparty}` : "";
    const due = l.dueSignal ? ` · said "${l.dueSignal}"` : "";
    const age = l.ageDays === 0 ? "today" : `${l.ageDays}d ago`;
    const where = l.sourceApp ? ` in ${l.sourceApp}` : "";
    return `- [${lead[l.direction] ?? l.direction}] ${l.description}\n`
      + `  (noticed ${age}${where}${who}${due} · id ${l.id})`;
  }).join("\n");
}

export async function serveMcp(
  db: Database, key: Buffer, provider: InferenceProvider,
): Promise<void> {
  const server = new Server(
    { name: "nova", version: "0.1.0" },
    { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: "search_memory",
      description:
        "Search the user's own captured screen and browser history on this Mac — "
        + "pages they read, documents they wrote or viewed, and windows they had "
        + "open. This is NOT a web search; it only returns things the user has "
        + "actually looked at on this device. Use it whenever the user references "
        + "something they saw, read, or did earlier (e.g. 'that article about X', "
        + "'the page I had open yesterday'). Results include a timestamp, the "
        + "source app, and a URL or window title so you can cite where each "
        + "memory came from.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to look for, in natural language" },
          limit: { type: "number", description: "Maximum results (default 10)" },
        },
        required: ["query"],
      },
    }, {
      name: "get_open_loops",
      description:
        "List the user's unfinished commitments, unanswered questions and stalled "
        + "next steps, found in what they had on screen. Use it when the user asks "
        + "what they owe someone, what is outstanding, what they have forgotten, "
        + "what needs following up, or for a to-do read of their day. These are "
        + "observed from real conversations and documents on this Mac, not a task "
        + "list the user maintains — so each one cites when it was noticed and who "
        + "it involves. Not a web search.",
      inputSchema: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["i_owe", "owed_to_me", "unanswered", "stalled", "any"],
            description:
              "i_owe = the user promised something; owed_to_me = someone promised "
              + "the user; unanswered = a question to the user with no reply; "
              + "stalled = an agreed step that has not happened. Default any.",
          },
          limit: { type: "number", description: "Maximum results (default 20)" },
        },
      },
    }, {
      name: "get_timeline",
      description:
        "List what Nova captured from the user's screen on this Mac during a "
        + "period, oldest first. Use it when the user asks what they did, read or "
        + "worked on at a time rather than about a topic (e.g. 'what did I do "
        + "yesterday', 'what was I reading on Monday morning'). Each memory cites "
        + "its time, source app, and URL or window title. Not a web search.",
      inputSchema: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description: "Start of the period, ISO 8601: a date (2026-10-14) or a date-time "
              + "(2026-10-14T09:00 or with an offset). A bare date or time is the user's local time.",
          },
          to: {
            type: "string",
            description: "End of the period, same formats, exclusive for a date-time. A bare date "
              + "includes that whole day. Default now.",
          },
          limit: { type: "number", description: "Maximum results (default 50, at most 200)" },
        },
        required: ["from"],
      },
    }],
  }));

  server.setRequestHandler(CallToolRequestSchema, (req) =>
    handleToolCall(db, key, provider, req.params));

  await server.connect(new StdioServerTransport());
}

/**
 * The tool-call handler, exported so tests can exercise the production
 * request-handling path directly without a real stdio transport. `serveMcp`
 * above is a thin registration wrapper around this function.
 */
export async function handleToolCall(
  db: Database, key: Buffer, provider: InferenceProvider,
  params: { name: string; arguments?: unknown },
): Promise<{ content: { type: "text"; text: string }[] }> {
  if (params.name === "get_open_loops") {
    const args = (params.arguments ?? {}) as { direction?: unknown; limit?: unknown };
    // Refused, never read as the default: an unknown direction used to return
    // every loop as if filtered, which the model would report as an answer.
    if (args.direction !== undefined
        && !(typeof args.direction === "string" && LOOP_FILTERS.has(args.direction))) {
      throw new Error(`get_open_loops: direction must be one of ${[...LOOP_FILTERS].join(", ")}`);
    }
    if (args.limit !== undefined
        && !(typeof args.limit === "number" && Number.isInteger(args.limit) && args.limit > 0)) {
      throw new Error("get_open_loops: limit must be a positive integer");
    }
    const direction = (args.direction ?? "any") as LoopDirection | "any";
    const limit = (args.limit as number | undefined) ?? 20;
    // No provider call: loops are already stored, so this answers offline —
    // unlike search_memory, which must embed the query first.
    const loops = listOpenLoops(db, key, { direction, limit });
    return { content: [{ type: "text", text: formatLoops(loops) }] };
  }
  if (params.name === "get_timeline") {
    const args = (params.arguments ?? {}) as { from?: unknown; to?: unknown; limit?: unknown };
    const from = typeof args.from === "string" ? parseInstant(args.from, false) : null;
    if (from === null) throw new Error("get_timeline: from must be an ISO 8601 date or date-time");
    let to = Date.now();
    if (args.to !== undefined) {
      const t = typeof args.to === "string" ? parseInstant(args.to, true) : null;
      if (t === null) throw new Error("get_timeline: to must be an ISO 8601 date or date-time");
      to = t;
    }
    if (from >= to) throw new Error("get_timeline: from must be before to");
    if (args.limit !== undefined
        && !(typeof args.limit === "number" && Number.isInteger(args.limit) && args.limit > 0)) {
      throw new Error("get_timeline: limit must be a positive integer");
    }
    // Like get_open_loops, no provider call: this answers offline.
    const { items, total } = listMemoriesBetween(db, key, from, to, (args.limit as number | undefined) ?? 50);
    return { content: [{ type: "text", text: formatTimeline(items, total) }] };
  }
  return handleSearchCall(db, key, provider, params);
}

/** search_memory (§2.1). */
export async function handleSearchCall(
  db: Database, key: Buffer, provider: InferenceProvider,
  params: { name: string; arguments?: unknown },
): Promise<{ content: { type: "text"; text: string }[] }> {
  if (params.name !== "search_memory") {
    throw new Error(`unknown tool: ${params.name}`);
  }
  const args = params.arguments as { query?: unknown; limit?: unknown } | null | undefined;
  if (!args || typeof args.query !== "string" || args.query.length === 0) {
    throw new Error("search_memory requires a 'query' string");
  }
  const limit = typeof args.limit === "number" ? args.limit : 10;
  const hits = await searchMemory(db, key, provider, args.query, { limit });
  return { content: [{ type: "text", text: formatHits(hits) }] };
}
