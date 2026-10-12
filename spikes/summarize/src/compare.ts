import { buildEpisodePrompt, type Capture } from "./prompts";
import { validJson } from "./valid-json";

const captures: Capture[] = await Bun.file("fixtures/episode-captures.json").json();
const prompt = buildEpisodePrompt(captures);

type Run = { name: string; ms: number; output: string; costUsd: number | null };

async function runGemini(): Promise<Run> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { name: "gemini-3.6-flash (relay)", ms: 0, output: "SKIPPED — no GEMINI_API_KEY", costUsd: null };
  const t0 = performance.now();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    },
  );
  const j: any = await res.json();
  const ms = performance.now() - t0;
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text ?? JSON.stringify(j);
  const inTok = j.usageMetadata?.promptTokenCount ?? 0;
  const outTok = j.usageMetadata?.candidatesTokenCount ?? 0;
  // Pricing: gemini-3.6-flash Standard tier, verified 2026-08-13 against
  // https://ai.google.dev/gemini-api/docs/pricing — $1.50/M in, $7.50/M out
  // (output includes thinking tokens). Batch/Flex tiers are half this.
  const costUsd = (inTok * 1.5 + outTok * 7.5) / 1_000_000;
  return { name: "gemini-3.6-flash (relay)", ms, output: text, costUsd };
}

async function runOllama(): Promise<Run> {
  const t0 = performance.now();
  try {
    const res = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      body: JSON.stringify({ model: "llama3.2:3b", prompt, stream: false, format: "json" }),
    });
    const j: any = await res.json();
    return { name: "llama3.2:3b (on-device)", ms: performance.now() - t0, output: j.response ?? "", costUsd: 0 };
  } catch {
    return { name: "llama3.2:3b (on-device)", ms: 0, output: "SKIPPED — ollama not running (`ollama serve`, `ollama pull llama3.2:3b`)", costUsd: 0 };
  }
}

const runs = [await runGemini(), await runOllama()];
let md = `# Spike report: episode summarization — relay vs on-device (D4)\n\n`;
md += `| Model | Latency | Valid JSON | Cost/episode | Cost/user/day (40 episodes) |\n|---|---|---|---|---|\n`;
for (const r of runs) {
  const cost = r.costUsd === null ? "n/a" : `$${r.costUsd.toFixed(5)}`;
  const day = r.costUsd === null ? "n/a" : `$${(r.costUsd * 40).toFixed(3)}`;
  md += `| ${r.name} | ${r.ms.toFixed(0)} ms | ${validJson(r.output)} | ${cost} | ${day} |\n`;
}
md += `\n## Outputs (manual rubric: score each 1–5 on coverage / accuracy / loop precision)\n`;
for (const r of runs) md += `\n### ${r.name}\n\n- coverage: _/5 · accuracy: _/5 · loop precision: _/5\n\n\`\`\`json\n${r.output.slice(0, 3000)}\n\`\`\`\n`;
md += `\n## D4 verdict\n\n<fill after scoring: which model, and why — quality/cost/latency>\n`;
await Bun.write("../reports/summarize.md", md);
console.log(md);
