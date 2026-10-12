export type Capture = { ts: string; app: string; text: string };

// The episode-builder prompt (spec architecture §2.3 steps 4–5): one call
// produces the summary, entities, and open-loop candidates.
export function buildEpisodePrompt(captures: Capture[]): string {
  const lines = captures
    .map((c) => `[${c.ts} · ${c.app}] ${c.text}`)
    .join("\n");
  return `You are the memory engine of a personal activity tracker. Below are
time-ordered text captures from one ~15 minute episode of a user's screen
activity. Each line is [timestamp · app] content.

CAPTURES:
${lines}

Produce ONLY JSON (no prose, no markdown fences) with exactly this shape:
{
  "summary": "2-4 sentence summary of what the user did and decided",
  "entities": [{"kind": "person|project|artifact|org", "name": "..."}],
  "loop_candidates": [{
    "description": "...",
    "direction": "i_owe|owed_to_me|unanswered",
    "counterparty": "... or null",
    "due_signal": "... or null",
    "evidence_quote": "verbatim capture line that proves it"
  }]
}
Rules: only include loops with clear evidence; prefer precision over recall.`;
}
