/**
 * Claude Opus 4.7 Vision クライアント薄ラッパー。
 *
 * docs/architecture.md §3 / §5.5 準拠。
 *
 * 役割:
 *   - system prompt / few-shot / user turn（image + text）/ tools を組み立てて送信
 *   - `cache_control: ephemeral` を system / few-shot に必ず付与（Prompt Caching）
 *   - `tool_choice: { type: "tool", name }` で JSON 強制
 *   - 5xx / 429 に exponential backoff + jitter で 3 回まで retry
 *   - 使用トークン（input / output / cache_create / cache_read）を構造化ログで出力
 *   - `DRY_RUN=1` または `opts.dryRun === true` で API を呼ばずダンプ返却
 *
 * **やらない**:
 *   - temperature 指定（Opus 4.7 で廃止）
 *   - prefilling（Opus 4.6 以降廃止、Tool Use で代替）
 */

import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type {
  Message,
  MessageParam,
  TextBlockParam,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages.js";

export const DEFAULT_MODEL = "claude-opus-4-7";

export type CallImage = {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
};

export type FewshotBlock = {
  /** TEXT block as few-shot; future: image blocks with cache_control. */
  text: string;
  cacheControl?: boolean;
};

export type ClaudeCallParams = {
  /** system prompt（必ず cache_control: ephemeral が付与される） */
  system: string;
  /** Few-shot テキストブロック（cacheControl=true で cache_control 付与） */
  fewshot?: FewshotBlock[];
  /** user turn の image block */
  userImage: CallImage;
  /** user turn の text block */
  userText: string;
  /** 渡す Anthropic Tool 配列（1 個以上） */
  tools: Tool[];
  /** `tool_choice: { type: "tool", name }` で強制する tool 名 */
  toolName: string;
  /** 既定 4096（Stage 2 column では 16_000 推奨） */
  maxTokens?: number;
  /** stop_sequences（通常不要） */
  stopSequences?: string[];
  /** モデル override（既定 "claude-opus-4-7"） */
  model?: string;
};

export type ClaudeCallOptions = {
  /** true なら API を呼ばず、送信予定 payload を返却 */
  dryRun?: boolean;
  /** カスタム Anthropic client 注入（テスト用） */
  client?: Pick<Anthropic, "messages">;
  /** retry 上限（既定 3） */
  maxRetries?: number;
  /** 初期バックオフ ms（既定 1000） */
  backoffBaseMs?: number;
  /** jitter 最大 ms（既定 250） */
  backoffJitterMs?: number;
  /** setTimeout 注入（テスト用 fake timer 対応） */
  sleep?: (ms: number) => Promise<void>;
  /** structured log フック（既定 console.log JSON） */
  onLog?: (line: LogLine) => void;
};

export type UsageStats = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

export type LogLine = {
  event: "dispatch" | "retry" | "success" | "failure" | "dryrun";
  model: string;
  toolName: string;
  attempt: number;
  latencyMs?: number;
  usage?: UsageStats;
  errorStatus?: number;
  errorMessage?: string;
};

export type ClaudeCallResult<T = unknown> = {
  /** 選択された tool_use block の input（JSON オブジェクト） */
  toolInput: T;
  /** そのレスポンスの full Message object（usage 含む） */
  message: Message;
  usage: UsageStats;
  latencyMs: number;
  attempts: number;
};

export type ClaudeDryRunResult = {
  dryRun: true;
  payload: {
    model: string;
    max_tokens: number;
    system: TextBlockParam[];
    messages: MessageParam[];
    tools: Tool[];
    tool_choice: { type: "tool"; name: string };
    stop_sequences?: string[];
  };
};

/**
 * Claude を 1 回呼び出す。dryRun 時は payload をそのまま返し、課金 0。
 * それ以外は tool_use input を抽出して返す。toolName と一致する tool_use block が
 * 見つからない場合は投げる。
 */
export async function callClaude<T = unknown>(
  params: ClaudeCallParams,
  options: ClaudeCallOptions = {},
): Promise<ClaudeCallResult<T> | ClaudeDryRunResult> {
  const payload = buildPayload(params);
  const dryRun =
    options.dryRun === true ||
    (options.dryRun == null && process.env.DRY_RUN === "1");

  const log = options.onLog ?? defaultLog;
  if (dryRun) {
    log({
      event: "dryrun",
      model: payload.model,
      toolName: params.toolName,
      attempt: 0,
    });
    return { dryRun: true, payload };
  }

  const client =
    options.client ??
    new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  const maxRetries = options.maxRetries ?? 3;
  const backoffBase = options.backoffBaseMs ?? 1000;
  const jitterMax = options.backoffJitterMs ?? 250;
  const sleep = options.sleep ?? defaultSleep;

  let attempt = 0;
  let lastErr: unknown;
  const start = Date.now();

  while (attempt < maxRetries + 1) {
    attempt += 1;
    log({
      event: "dispatch",
      model: payload.model,
      toolName: params.toolName,
      attempt,
    });
    try {
      const message = await client.messages.create(payload);
      const toolInput = extractToolInput<T>(message, params.toolName);
      const usage = normalizeUsage(message);
      const latencyMs = Date.now() - start;
      log({
        event: "success",
        model: payload.model,
        toolName: params.toolName,
        attempt,
        latencyMs,
        usage,
      });
      return { toolInput, message, usage, latencyMs, attempts: attempt };
    } catch (err) {
      lastErr = err;
      const status = getErrorStatus(err);
      if (!isRetryable(status) || attempt > maxRetries) {
        log({
          event: "failure",
          model: payload.model,
          toolName: params.toolName,
          attempt,
          errorStatus: status,
          errorMessage: (err as Error)?.message,
        });
        throw err;
      }
      // Exponential backoff with jitter. 1000ms → 2000ms → 4000ms + [0, 250ms] のランダム加算。
      // TODO(Day 2): Anthropic SDK の APIError.headers に Retry-After が含まれる
      // 場合（429 rate limit）は優先値として採用する。現状は単純 exponential のみ。
      const delay =
        backoffBase * 2 ** (attempt - 1) + Math.random() * jitterMax;
      log({
        event: "retry",
        model: payload.model,
        toolName: params.toolName,
        attempt,
        errorStatus: status,
        errorMessage: (err as Error)?.message,
      });
      await sleep(delay);
    }
  }
  // 到達不可のはずだが型のため
  throw lastErr ?? new Error("callClaude: exhausted retries");
}

// ── 内部ヘルパ ────────────────────────────────────────────

export function buildPayload(
  params: ClaudeCallParams,
): ClaudeDryRunResult["payload"] {
  const systemBlocks: TextBlockParam[] = [
    {
      type: "text",
      text: params.system,
      cache_control: { type: "ephemeral" },
    },
  ];
  // few-shot は通常 system の直後に置く（共にキャッシュ対象）
  if (params.fewshot) {
    for (const f of params.fewshot) {
      systemBlocks.push({
        type: "text",
        text: f.text,
        ...(f.cacheControl ? { cache_control: { type: "ephemeral" } } : {}),
      });
    }
  }

  const userMessage: MessageParam = {
    role: "user",
    content: [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: params.userImage.mediaType,
          data: params.userImage.base64,
        },
      },
      { type: "text", text: params.userText },
    ],
  };

  return {
    model: params.model ?? DEFAULT_MODEL,
    max_tokens: params.maxTokens ?? 4096,
    system: systemBlocks,
    messages: [userMessage],
    tools: params.tools,
    tool_choice: { type: "tool", name: params.toolName },
    ...(params.stopSequences ? { stop_sequences: params.stopSequences } : {}),
  };
}

export function extractToolInput<T>(message: Message, toolName: string): T {
  for (const block of message.content) {
    if (block.type === "tool_use" && (block as ToolUseBlock).name === toolName) {
      return (block as ToolUseBlock).input as T;
    }
  }
  throw new Error(
    `callClaude: no tool_use block named "${toolName}" found in response (got: ${message.content
      .map((c) => c.type)
      .join(",")})`,
  );
}

function normalizeUsage(message: Message): UsageStats {
  const u = message.usage as Message["usage"] & {
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
  return {
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
  };
}

function getErrorStatus(err: unknown): number | undefined {
  if (err instanceof APIError) return err.status;
  if (
    typeof err === "object" &&
    err != null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  ) {
    return (err as { status: number }).status;
  }
  return undefined;
}

function isRetryable(status: number | undefined): boolean {
  if (status === undefined) return false;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function defaultLog(line: LogLine): void {
  // JSON Lines 構造化ログ（grep / jq し易い）
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}
