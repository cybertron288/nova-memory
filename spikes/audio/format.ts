// Usage: bun format.ts artifacts/chunk-001.json
type Word = { punctuated_word?: string; word: string; speaker?: number; start: number };
const raw = await Bun.file(Bun.argv[2]!).json();
const words: Word[] = raw.results.channels[0].alternatives[0].words ?? [];
let cur = -1;
let line: string[] = [];
const out: string[] = [];
for (const w of words) {
  const spk = w.speaker ?? 0;
  if (spk !== cur) {
    if (line.length) out.push(`S${cur}: ${line.join(" ")}`);
    cur = spk;
    line = [];
  }
  line.push(w.punctuated_word ?? w.word);
}
if (line.length) out.push(`S${cur}: ${line.join(" ")}`);
console.log(out.join("\n"));
