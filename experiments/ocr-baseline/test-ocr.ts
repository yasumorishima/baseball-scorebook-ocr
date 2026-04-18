import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { SCOREBOOK_SYSTEM_PROMPT } from "./prompts/system.ts";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-4-7";

type CellRead = {
  batting_order: number;
  inning: number;
  raw_notation: string | null;
  outcome: string | null;
  fielders_involved: number[] | null;
  reached_base: number | null;
  confidence: number;
  notes: string | null;
};

type OcrResponse = {
  cells: CellRead[];
  image_quality: {
    overall_legibility: number;
    issues: string[];
  };
};

function mimeFromPath(path: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

async function runOcr(imagePath: string) {
  if (!existsSync(imagePath)) {
    throw new Error(`Image not found: ${imagePath}`);
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY env var is required");
  }

  const buf = readFileSync(imagePath);
  const base64 = buf.toString("base64");
  const media_type = mimeFromPath(imagePath);

  const client = new Anthropic({ apiKey });
  const start = Date.now();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SCOREBOOK_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type, data: base64 },
          },
          {
            type: "text",
            text: "Read this scorebook page and return the JSON specified in the system prompt. Include all cells, marking blanks as null.",
          },
        ],
      },
    ],
  });
  const elapsedMs = Date.now() - start;

  const text = res.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();

  let parsed: OcrResponse | null = null;
  try {
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    }
  } catch (e) {
    console.error("Failed to parse JSON from model response:", (e as Error).message);
  }

  const outDir = resolve(dirname(import.meta.url.replace(/^file:\/\//, "")), "output");
  mkdirSync(outDir, { recursive: true });
  const stem = basename(imagePath, extname(imagePath));

  writeFileSync(
    resolve(outDir, `${stem}.raw.txt`),
    text + `\n\n---\nmodel=${MODEL} elapsed_ms=${elapsedMs} input_tokens=${res.usage.input_tokens} output_tokens=${res.usage.output_tokens}\n`,
  );

  if (parsed) {
    writeFileSync(resolve(outDir, `${stem}.json`), JSON.stringify(parsed, null, 2));
    writeFileSync(resolve(outDir, `${stem}.md`), renderMarkdown(stem, parsed, elapsedMs, res.usage));
    summarize(parsed);
  } else {
    console.error("No parseable JSON — see .raw.txt for model output.");
    process.exitCode = 1;
  }
}

function renderMarkdown(stem: string, r: OcrResponse, ms: number, usage: { input_tokens: number; output_tokens: number }) {
  const nonNull = r.cells.filter((c) => c.raw_notation != null);
  const byConf = {
    high: nonNull.filter((c) => c.confidence >= 0.8).length,
    mid: nonNull.filter((c) => c.confidence >= 0.5 && c.confidence < 0.8).length,
    low: nonNull.filter((c) => c.confidence < 0.5).length,
  };
  const rows = r.cells
    .slice()
    .sort((a, b) => a.inning - b.inning || a.batting_order - b.batting_order)
    .map((c) => {
      const conf = c.confidence.toFixed(2);
      const cell = c.raw_notation ?? "—";
      const outcome = c.outcome ?? "—";
      const notes = c.notes ?? "";
      return `| ${c.batting_order} | ${c.inning} | \`${cell}\` | ${outcome} | ${conf} | ${notes} |`;
    })
    .join("\n");
  return `# OCR result: ${stem}

**Model**: \`${MODEL}\`
**Elapsed**: ${ms} ms
**Tokens**: in=${usage.input_tokens}, out=${usage.output_tokens}

## Image quality
- Overall legibility: **${r.image_quality.overall_legibility}**
- Issues: ${r.image_quality.issues.length ? r.image_quality.issues.join("; ") : "none"}

## Cell confidence distribution (non-blank cells)
- High (≥0.8): **${byConf.high}**
- Mid (0.5–0.8): **${byConf.mid}**
- Low (<0.5): **${byConf.low}**

## Cells

| Order | Inning | Notation | Outcome | Conf | Notes |
|------:|-------:|:---------|:--------|-----:|:------|
${rows}
`;
}

function summarize(r: OcrResponse) {
  const nonNull = r.cells.filter((c) => c.raw_notation != null);
  const avgConf = nonNull.length ? nonNull.reduce((s, c) => s + c.confidence, 0) / nonNull.length : 0;
  console.log(`cells=${r.cells.length} non_blank=${nonNull.length} avg_conf=${avgConf.toFixed(3)} legibility=${r.image_quality.overall_legibility}`);
}

const imagePath = process.argv[2];
if (!imagePath) {
  console.error("Usage: bun run ocr:test -- <path-to-image>");
  process.exit(2);
}
runOcr(resolve(imagePath)).catch((e) => {
  console.error(e);
  process.exit(1);
});
