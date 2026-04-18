import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { SCOREBOOK_SYSTEM_PROMPT } from "./prompts/system.ts";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-4-7";
const MAX_LONG_EDGE = 2576;

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

async function prepareImage(imagePath: string) {
  const input = readFileSync(imagePath);
  const origMeta = await sharp(input).metadata();
  const buf = await sharp(input)
    .rotate()
    .resize({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  const outMeta = await sharp(buf).metadata();
  return {
    base64: buf.toString("base64"),
    media_type: "image/jpeg" as const,
    origSize: { width: origMeta.width ?? 0, height: origMeta.height ?? 0 },
    sentSize: { width: outMeta.width ?? 0, height: outMeta.height ?? 0 },
    sentBytes: buf.byteLength,
  };
}

async function runOcr(imagePath: string) {
  if (!existsSync(imagePath)) {
    throw new Error(`Image not found: ${imagePath}`);
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY env var is required");
  }

  const prepStart = Date.now();
  const img = await prepareImage(imagePath);
  const prepMs = Date.now() - prepStart;
  console.log(
    `prep: ${img.origSize.width}x${img.origSize.height} -> ${img.sentSize.width}x${img.sentSize.height} (${(img.sentBytes / 1024).toFixed(0)} KB) in ${prepMs}ms`,
  );

  const client = new Anthropic({ apiKey });
  const apiStart = Date.now();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    temperature: 0,
    system: [
      {
        type: "text",
        text: SCOREBOOK_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: img.media_type, data: img.base64 },
          },
          {
            type: "text",
            text: "Read this scorebook page and return the JSON specified in the system prompt. Include all cells, marking blanks as null. Output strict JSON only, no prose.",
          },
        ],
      },
    ],
  });
  const apiMs = Date.now() - apiStart;

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

  const usage = res.usage as Anthropic.Usage & {
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  const tokenLine = `model=${MODEL} prep_ms=${prepMs} api_ms=${apiMs} input=${usage.input_tokens} output=${usage.output_tokens} cache_create=${usage.cache_creation_input_tokens ?? 0} cache_read=${usage.cache_read_input_tokens ?? 0}`;
  console.log(tokenLine);

  writeFileSync(
    resolve(outDir, `${stem}.raw.txt`),
    text + `\n\n---\n${tokenLine}\nsent_size=${img.sentSize.width}x${img.sentSize.height} sent_bytes=${img.sentBytes}\n`,
  );

  if (parsed) {
    writeFileSync(resolve(outDir, `${stem}.json`), JSON.stringify(parsed, null, 2));
    writeFileSync(resolve(outDir, `${stem}.md`), renderMarkdown(stem, parsed, apiMs, usage, img));
    summarize(parsed);
  } else {
    console.error("No parseable JSON — see .raw.txt for model output.");
    process.exitCode = 1;
  }
}

function renderMarkdown(
  stem: string,
  r: OcrResponse,
  ms: number,
  usage: Anthropic.Usage & { cache_creation_input_tokens?: number; cache_read_input_tokens?: number },
  img: { origSize: { width: number; height: number }; sentSize: { width: number; height: number }; sentBytes: number },
) {
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
**API elapsed**: ${ms} ms
**Original**: ${img.origSize.width}×${img.origSize.height}
**Sent**: ${img.sentSize.width}×${img.sentSize.height} (${(img.sentBytes / 1024).toFixed(0)} KB)
**Tokens**: in=${usage.input_tokens}, out=${usage.output_tokens}, cache_create=${usage.cache_creation_input_tokens ?? 0}, cache_read=${usage.cache_read_input_tokens ?? 0}

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
  console.log(
    `cells=${r.cells.length} non_blank=${nonNull.length} avg_conf=${avgConf.toFixed(3)} legibility=${r.image_quality.overall_legibility}`,
  );
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
