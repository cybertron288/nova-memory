// Checks whether a model's raw text output is valid JSON matching the
// buildEpisodePrompt contract, tolerating common real-world formatting:
// unfenced, ```json fenced, bare ``` fenced, leading whitespace before the
// fence, and trailing prose after the closing fence.
export function validJson(s: string): boolean {
  try {
    const cleaned = s
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```[\s\S]*$/, "")
      .trim();
    const j = JSON.parse(cleaned);
    return typeof j.summary === "string" && Array.isArray(j.entities) && Array.isArray(j.loop_candidates);
  } catch {
    return false;
  }
}
