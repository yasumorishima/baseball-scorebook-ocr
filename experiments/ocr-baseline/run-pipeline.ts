#!/usr/bin/env tsx
/**
 * スコアブック OCR パイプラインの CLI エントリ。
 *
 * docs/architecture.md §13 Phase E / §15 準拠。
 *
 * 使い方:
 *   bun run pipeline path/to/image.jpg \
 *       [--batter-count=10] [--force-rotate=90] [--style=waseda] [--dry-run]
 *
 * 実 API を叩く条件（§15）:
 *   1. DRY_RUN=1 環境変数が未設定
 *   2. --dry-run フラグが未指定
 *   3. リポジトリ直下に `.scorebook-test-approved` ファイルが存在
 *   4. ANTHROPIC_API_KEY が設定済み
 *
 * block-scorebook-api-call hook が実行自体を止める場合もあるため、
 * ここでの二重チェックは UX（分かりやすいエラー）目的。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Style } from "../../src/types/style.js";
import {
  runPipeline,
  type PipelineDryRun,
  type PipelineResult,
} from "../../src/pipeline.js";
import { formatIpJa } from "../../src/stats/innings.js";

type CliArgs = {
  imagePath: string;
  batterCount: number;
  forceRotate?: 0 | 90 | 180 | 270;
  forcedStyle?: Style;
  dryRun: boolean;
  outDir: string;
};

function parseArgs(argv: string[]): CliArgs {
  let imagePath = "";
  let batterCount = 10;
  let forceRotate: CliArgs["forceRotate"];
  let forcedStyle: CliArgs["forcedStyle"];
  let dryRun = process.env.DRY_RUN === "1";
  let outDir = "";

  for (const raw of argv) {
    if (raw.startsWith("--batter-count=")) {
      batterCount = parseInt(raw.split("=", 2)[1], 10);
    } else if (raw.startsWith("--force-rotate=")) {
      const v = parseInt(raw.split("=", 2)[1], 10);
      if (v !== 0 && v !== 90 && v !== 180 && v !== 270) {
        throw new Error(`--force-rotate must be 0/90/180/270, got ${v}`);
      }
      forceRotate = v;
    } else if (raw.startsWith("--style=")) {
      const v = raw.split("=", 2)[1];
      if (!["waseda", "keio", "chiba", "unknown"].includes(v)) {
        throw new Error(`--style must be waseda/keio/chiba/unknown, got ${v}`);
      }
      forcedStyle = v as Style;
    } else if (raw === "--dry-run") {
      dryRun = true;
    } else if (raw.startsWith("--out=")) {
      outDir = raw.split("=", 2)[1];
    } else if (!raw.startsWith("--")) {
      // 位置引数は image_path のみ。複数渡された場合は silent 上書きせず fail-closed。
      if (imagePath) {
        throw new Error(
          `multiple positional arguments are not allowed: already got "${imagePath}", received "${raw}"`,
        );
      }
      imagePath = raw;
    }
  }

  if (!imagePath) {
    throw new Error(
      "Usage: tsx run-pipeline.ts <image_path> [--batter-count=N] [--force-rotate=90] [--style=waseda|keio|chiba] [--dry-run] [--out=DIR]",
    );
  }
  if (!Number.isInteger(batterCount) || batterCount < 1 || batterCount > 15) {
    throw new Error(`--batter-count must be 1-15, got ${batterCount}`);
  }

  return {
    imagePath: resolve(imagePath),
    batterCount,
    forceRotate,
    forcedStyle,
    dryRun,
    outDir,
  };
}

/**
 * `.scorebook-test-approved` ファイルの想定フォーマット（docs/architecture.md §15）:
 *
 *   UNLOCK_UNTIL=2026-04-21T23:59:59+09:00
 *   REASON=First real API verification after Phase A-E completion
 *
 * - UNLOCK_UNTIL は ISO 8601 datetime（タイムゾーン任意）で、現在時刻がこの値を
 *   過ぎている場合は再作成が必要（古い承認を転用した実行を防ぐ）。
 * - REASON は非空文字列。空や欠落はゲートをパスさせない。
 * - block-scorebook-api-call hook と CLI の二重チェックで、どちらか片方が
 *   bypass されても課金を止める設計。
 */
export type ApprovalFields = {
  UNLOCK_UNTIL: string;
  REASON: string;
};

export function parseApprovalFile(content: string): ApprovalFields {
  const fields: Partial<ApprovalFields> = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key === "UNLOCK_UNTIL" || key === "REASON") {
      fields[key] = value;
    }
  }
  if (!fields.UNLOCK_UNTIL) {
    throw new Error(
      ".scorebook-test-approved is missing required field: UNLOCK_UNTIL=<ISO datetime>",
    );
  }
  if (!fields.REASON) {
    throw new Error(
      ".scorebook-test-approved is missing required field: REASON=<non-empty string>",
    );
  }
  return fields as ApprovalFields;
}

function checkApprovalGate(args: CliArgs): void {
  if (args.dryRun) return;
  const approvalFile = resolve(process.cwd(), ".scorebook-test-approved");
  if (!existsSync(approvalFile)) {
    console.error(
      "[run-pipeline] real API call is blocked.\n" +
        "  - Use --dry-run or DRY_RUN=1 for a no-cost smoke test.\n" +
        "  - To authorize a real call, create `.scorebook-test-approved`\n" +
        "    at the repo root with UNLOCK_UNTIL=<ISO datetime> and REASON=<string> lines.\n" +
        "  - See docs/architecture.md §15.",
    );
    process.exit(2);
  }

  // 承認ファイルの内容を fail-closed にパース・検証する。
  // hook が配置されていない Codespace 等の環境でも CLI レイヤで確実に止める。
  let fields: ApprovalFields;
  try {
    const content = readFileSync(approvalFile, "utf8");
    fields = parseApprovalFile(content);
  } catch (e) {
    console.error(
      `[run-pipeline] .scorebook-test-approved parse failed: ${(e as Error).message}`,
    );
    process.exit(2);
  }

  const unlockUntil = new Date(fields.UNLOCK_UNTIL);
  if (Number.isNaN(unlockUntil.getTime())) {
    console.error(
      `[run-pipeline] .scorebook-test-approved has invalid UNLOCK_UNTIL="${fields.UNLOCK_UNTIL}" ` +
        "(must be ISO 8601 datetime, e.g., 2026-04-21T23:59:59+09:00)",
    );
    process.exit(2);
  }
  const now = new Date();
  if (now.getTime() > unlockUntil.getTime()) {
    console.error(
      `[run-pipeline] .scorebook-test-approved has expired: UNLOCK_UNTIL=${fields.UNLOCK_UNTIL} (now=${now.toISOString()}).\n` +
        "  - Delete and re-create the file with a future UNLOCK_UNTIL to re-authorize.",
    );
    process.exit(2);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[run-pipeline] ANTHROPIC_API_KEY env var is required for real calls.");
    process.exit(2);
  }

  console.log(
    `[run-pipeline] approval gate passed. UNLOCK_UNTIL=${fields.UNLOCK_UNTIL}, REASON="${fields.REASON}"`,
  );
}

function renderDryRunMarkdown(result: PipelineDryRun): string {
  const totalTokens = result.payloads.reduce((s, p) => {
    const sysLen = p.system.reduce((sum, b) => sum + b.text.length, 0);
    return s + sysLen;
  }, 0);
  const lines: string[] = [];
  lines.push(`# Pipeline Dry Run`);
  lines.push("");
  lines.push(`- Normalized size: ${result.normalizedSize.width}×${result.normalizedSize.height}`);
  lines.push(`- Quality: blur var=${result.quality.blurVariance.toFixed(1)} / luma=${result.quality.meanLuma.toFixed(1)} / ok=${result.quality.ok}`);
  lines.push(`- Planned Claude calls: ${result.payloads.length}`);
  lines.push(`- System prompt chars total: ${totalTokens}`);
  lines.push("");
  lines.push(`## Call list`);
  for (const p of result.payloads) {
    lines.push(`- model=${p.model} max_tokens=${p.max_tokens} tool=${p.tool_choice.name} systemBlocks=${p.system.length}`);
  }
  return lines.join("\n");
}

function renderResultMarkdown(
  result: PipelineResult,
  args: CliArgs,
): string {
  const lines: string[] = [];
  lines.push(`# Pipeline result: ${basename(args.imagePath)}`);
  lines.push("");
  lines.push(`- Style: \`${result.style}\`${result.styleFallbackApplied ? " (fallback applied)" : ""}`);
  lines.push(`- Batters: ${args.batterCount}`);
  lines.push(`- API attempts: ${result.apiAttempts}`);
  lines.push(`- Estimated cost: \$${(result.costEstimate.totalUsdCents / 100).toFixed(3)}`);
  lines.push(`- Validation: ${result.validation.valid ? "✅ valid" : `❌ ${result.validation.errors.length} error(s)`}`);
  if (result.warnings.length > 0) {
    lines.push("");
    lines.push(`## Warnings`);
    for (const w of result.warnings) lines.push(`- ${w}`);
  }
  if (result.reviewFlags.length > 0) {
    lines.push("");
    lines.push(`## Review flags (low confidence after retry)`);
    for (const f of result.reviewFlags) {
      lines.push(
        `- batter ${f.batting_order}, inning ${f.inning}: ${(f.confidence * 100).toFixed(0)}% confidence`,
      );
    }
  }

  lines.push("");
  lines.push(`## Per-batter batting stats`);
  lines.push("");
  lines.push(`| # | AB | H | 2B | 3B | HR | BB | SO | AVG | OBP | SLG |`);
  lines.push(`|---|----|----|-----|-----|-----|-----|-----|-------|-------|-------|`);
  for (const p of result.players) {
    lines.push(
      `| ${p.batting_order} | ${p.stats.AB} | ${p.stats.H} | ${p.stats["2B"]} | ${p.stats["3B"]} | ${p.stats.HR} | ${p.stats.BB} | ${p.stats.SO} | ${p.rates.AVG.toFixed(3)} | ${p.rates.OBP.toFixed(3)} | ${p.rates.SLG.toFixed(3)} |`,
    );
  }

  lines.push("");
  lines.push(`## Phase timings (ms)`);
  for (const [phase, ms] of Object.entries(result.phaseTimingsMs)) {
    lines.push(`- ${phase}: ${ms}`);
  }

  lines.push("");
  lines.push(`## Token usage`);
  const u = result.costEstimate.totalUsage;
  lines.push(`- input: ${u.input_tokens}`);
  lines.push(`- output: ${u.output_tokens}`);
  lines.push(`- cache_create: ${u.cache_creation_input_tokens}`);
  lines.push(`- cache_read: ${u.cache_read_input_tokens}`);

  // Used-innings quick look (as IP display demo for reviewers)
  const totalOuts = result.validation.perInningOuts.reduce((s, n) => s + n, 0);
  lines.push("");
  lines.push(`Total outs recorded: ${totalOuts} (≒ ${formatIpJa({ outs: totalOuts })})`);

  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  checkApprovalGate(args);

  const outDir =
    args.outDir ||
    resolve(dirname(fileURLToPath(import.meta.url)), "output");
  mkdirSync(outDir, { recursive: true });
  const stem = basename(args.imagePath, extname(args.imagePath));

  const imageBuf = readFileSync(args.imagePath);

  const started = Date.now();
  const result = await runPipeline({
    image: imageBuf,
    batterCount: args.batterCount,
    forceRotate: args.forceRotate,
    forcedStyle: args.forcedStyle,
    dryRun: args.dryRun,
  });
  const elapsed = Date.now() - started;

  if ("dryRun" in result) {
    const md = renderDryRunMarkdown(result);
    writeFileSync(resolve(outDir, `${stem}.dryrun.md`), md);
    writeFileSync(
      resolve(outDir, `${stem}.dryrun.json`),
      JSON.stringify(
        {
          normalizedSize: result.normalizedSize,
          quality: result.quality,
          cropMeta: result.cropMeta,
          payloadCount: result.payloads.length,
          // 大きいので payload 実体は省略
        },
        null,
        2,
      ),
    );
    console.log(
      `[run-pipeline] DRY_RUN complete in ${elapsed}ms — ${result.payloads.length} planned calls (no API cost).`,
    );
    console.log(`Output: ${outDir}/${stem}.dryrun.md`);
    return;
  }

  const md = renderResultMarkdown(result, args);
  writeFileSync(resolve(outDir, `${stem}.md`), md);
  writeFileSync(
    resolve(outDir, `${stem}.json`),
    JSON.stringify(
      {
        style: result.style,
        styleFallbackApplied: result.styleFallbackApplied,
        grid: result.grid,
        validation: result.validation,
        players: result.players,
        warnings: result.warnings,
        reviewFlags: result.reviewFlags,
        costEstimate: result.costEstimate,
        phaseTimingsMs: result.phaseTimingsMs,
        apiAttempts: result.apiAttempts,
      },
      null,
      2,
    ),
  );

  console.log(
    `[run-pipeline] complete in ${elapsed}ms — \$${(result.costEstimate.totalUsdCents / 100).toFixed(3)}, valid=${result.validation.valid}`,
  );
  console.log(`Output: ${outDir}/${stem}.md / ${stem}.json`);
}

// ファイルを直接実行した時だけ main() を走らせる。
// `import { parseApprovalFile } from "..."` のように test 等から import した際は
// 副作用（process.exit / 標準入力の argv 解析）が発火しないようにガードする。
//
// Windows では `import.meta.url` が `file:///C:/...`（3 スラッシュ）になる一方、
// 手組みの `file://${resolve(...)}` は `file://C:/...`（2 スラッシュ）になり常に
// 不一致。`pathToFileURL` で正規化された URL 同士を比較することで Linux/Windows
// 双方で一貫して判定する。
function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  const entryHref = pathToFileURL(resolve(process.argv[1])).href;
  return import.meta.url === entryHref;
}

if (isDirectExecution()) {
  main().catch((err) => {
    console.error("[run-pipeline] fatal:", err);
    process.exit(1);
  });
}
