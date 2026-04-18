/**
 * src/ocr/client.ts の単体テスト（mock SDK）。
 *
 * 検証項目:
 *   - buildPayload: system に cache_control: ephemeral 付与
 *   - buildPayload: tool_choice: { type: "tool", name }
 *   - buildPayload: user turn が image + text の複合ブロック
 *   - callClaude: tool_use block から input を抽出
 *   - callClaude: 5xx / 429 に retry、exponential backoff
 *   - callClaude: 401 / 400 に即 fail
 *   - callClaude: dryRun で API を叩かず payload 返却
 *   - callClaude: retry 上限で throw
 */

import { describe, expect, it, vi } from "vitest";
import { APIError } from "@anthropic-ai/sdk";

import {
  buildPayload,
  callClaude,
  DEFAULT_MODEL,
  extractToolInput,
  type ClaudeCallParams,
  type ClaudeDryRunResult,
  type UsageStats,
} from "../../src/ocr/client.js";

const BASE_PARAMS: ClaudeCallParams = {
  system: "You are an OCR expert.",
  userImage: { base64: "iVBORw0K...", mediaType: "image/jpeg" },
  userText: "Read this cell.",
  tools: [
    {
      name: "dummy_tool",
      description: "test",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
  ],
  toolName: "dummy_tool",
};

function fakeMessage(input: object, usageOverride: Partial<UsageStats> = {}) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: DEFAULT_MODEL,
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [
      { type: "tool_use", id: "tu_1", name: "dummy_tool", input },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      ...usageOverride,
    },
  } as unknown as Parameters<typeof extractToolInput>[0];
}

function makeApiError(status: number, message = "boom") {
  return new APIError(status, { error: { message } }, message, undefined);
}

describe("buildPayload", () => {
  it("attaches cache_control: ephemeral to system block", () => {
    const payload = buildPayload(BASE_PARAMS);
    expect(payload.system.length).toBe(1);
    expect(payload.system[0]).toMatchObject({
      type: "text",
      cache_control: { type: "ephemeral" },
    });
  });

  it("forces tool_choice={ type: 'tool', name }", () => {
    const payload = buildPayload(BASE_PARAMS);
    expect(payload.tool_choice).toEqual({
      type: "tool",
      name: "dummy_tool",
    });
  });

  it("user turn contains image then text blocks", () => {
    const payload = buildPayload(BASE_PARAMS);
    const content = payload.messages[0].content as Array<{ type: string }>;
    expect(content[0].type).toBe("image");
    expect(content[1].type).toBe("text");
  });

  it("appends few-shot blocks after system with cache_control when requested", () => {
    const payload = buildPayload({
      ...BASE_PARAMS,
      fewshot: [
        { text: "<example>...</example>", cacheControl: true },
        { text: "extra hint", cacheControl: false },
      ],
    });
    expect(payload.system.length).toBe(3);
    expect(payload.system[1]).toMatchObject({
      text: "<example>...</example>",
      cache_control: { type: "ephemeral" },
    });
    expect(payload.system[2]).not.toHaveProperty("cache_control");
  });

  it("uses provided model override", () => {
    const payload = buildPayload({ ...BASE_PARAMS, model: "claude-haiku-4-5" });
    expect(payload.model).toBe("claude-haiku-4-5");
  });

  it("uses default max_tokens 4096 when unspecified", () => {
    expect(buildPayload(BASE_PARAMS).max_tokens).toBe(4096);
  });

  it("honors explicit max_tokens and stop_sequences", () => {
    const payload = buildPayload({
      ...BASE_PARAMS,
      maxTokens: 16_000,
      stopSequences: ["\n\n##"],
    });
    expect(payload.max_tokens).toBe(16_000);
    expect(payload.stop_sequences).toEqual(["\n\n##"]);
  });

  it("omits stop_sequences key entirely when not provided", () => {
    const payload = buildPayload(BASE_PARAMS);
    expect("stop_sequences" in payload).toBe(false);
  });
});

describe("extractToolInput", () => {
  it("returns the tool_use input when the named tool block exists", () => {
    const msg = fakeMessage({ hello: "world" });
    expect(extractToolInput(msg as never, "dummy_tool")).toEqual({
      hello: "world",
    });
  });

  it("throws if no tool_use block with that name is found", () => {
    const msg = {
      content: [{ type: "text", text: "no tool call" }],
    } as unknown as Parameters<typeof extractToolInput>[0];
    expect(() => extractToolInput(msg, "dummy_tool")).toThrow(/no tool_use block/);
  });
});

describe("callClaude", () => {
  it("dryRun=true returns payload without calling the client", async () => {
    const create = vi.fn();
    const result = (await callClaude(BASE_PARAMS, {
      dryRun: true,
      client: { messages: { create } } as never,
      onLog: () => {},
    })) as ClaudeDryRunResult;
    expect(result.dryRun).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(result.payload.tool_choice).toEqual({
      type: "tool",
      name: "dummy_tool",
    });
  });

  it("DRY_RUN env=1 also triggers dryRun", async () => {
    const prev = process.env.DRY_RUN;
    process.env.DRY_RUN = "1";
    try {
      const create = vi.fn();
      const result = (await callClaude(BASE_PARAMS, {
        client: { messages: { create } } as never,
        onLog: () => {},
      })) as ClaudeDryRunResult;
      expect(result.dryRun).toBe(true);
      expect(create).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.DRY_RUN;
      else process.env.DRY_RUN = prev;
    }
  });

  it("returns parsed tool_input + usage + attempts on success", async () => {
    const create = vi
      .fn()
      .mockResolvedValue(fakeMessage({ answer: 42 }, { cache_read_input_tokens: 20 }));
    const res = await callClaude<{ answer: number }>(BASE_PARAMS, {
      client: { messages: { create } } as never,
      onLog: () => {},
    });
    if ("dryRun" in res) throw new Error("unexpected dryRun branch");
    expect(res.toolInput).toEqual({ answer: 42 });
    expect(res.attempts).toBe(1);
    expect(res.usage.cache_read_input_tokens).toBe(20);
  });

  it("retries on 429 and succeeds on the second attempt", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(makeApiError(429, "rate limit"))
      .mockResolvedValueOnce(fakeMessage({ ok: true }));
    const sleep = vi.fn(async () => {});
    const res = await callClaude(BASE_PARAMS, {
      client: { messages: { create } } as never,
      sleep,
      onLog: () => {},
    });
    if ("dryRun" in res) throw new Error("unexpected dryRun branch");
    expect(res.attempts).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("retries on 500/503 but throws after exceeding maxRetries", async () => {
    const create = vi.fn().mockRejectedValue(makeApiError(503, "service unavail"));
    const sleep = vi.fn(async () => {});
    const logs: string[] = [];
    await expect(() =>
      callClaude(BASE_PARAMS, {
        client: { messages: { create } } as never,
        maxRetries: 2,
        sleep,
        onLog: (l) => logs.push(l.event),
      }),
    ).rejects.toThrow();
    // maxRetries=2 → 最初 + 2 回リトライ = 計 3 attempts
    expect(create).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(logs).toContain("retry");
    expect(logs).toContain("failure");
  });

  it("does NOT retry on 400 or 401", async () => {
    for (const status of [400, 401, 403, 404]) {
      const create = vi.fn().mockRejectedValue(makeApiError(status, "bad"));
      const sleep = vi.fn(async () => {});
      await expect(() =>
        callClaude(BASE_PARAMS, {
          client: { messages: { create } } as never,
          sleep,
          onLog: () => {},
        }),
      ).rejects.toThrow();
      expect(create).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledTimes(0);
    }
  });

  it("backoff grows exponentially (≈1s, 2s, 4s) ignoring jitter", async () => {
    const create = vi.fn().mockRejectedValue(makeApiError(503, "slow"));
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms);
    });
    await expect(() =>
      callClaude(BASE_PARAMS, {
        client: { messages: { create } } as never,
        maxRetries: 3,
        backoffBaseMs: 1000,
        backoffJitterMs: 0,
        sleep,
        onLog: () => {},
      }),
    ).rejects.toThrow();
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it("emits structured log lines for each phase", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(makeApiError(500, "x"))
      .mockResolvedValueOnce(fakeMessage({}));
    const logs: string[] = [];
    await callClaude(BASE_PARAMS, {
      client: { messages: { create } } as never,
      sleep: async () => {},
      onLog: (l) => logs.push(l.event),
    });
    expect(logs).toEqual(["dispatch", "retry", "dispatch", "success"]);
  });
});
