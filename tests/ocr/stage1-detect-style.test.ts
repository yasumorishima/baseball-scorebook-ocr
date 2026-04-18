/**
 * stage1-detect-style.ts の単体テスト（mock SDK）。
 */

import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import {
  detectStyle,
  STYLE_CONFIDENCE_FLOOR,
  STYLE_DETECT_LONG_EDGE,
} from "../../src/ocr/stage1-detect-style.js";

async function makeCanvas(width = 2576, height = 2000): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 240, g: 240, b: 240 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

function fakeMessage(input: object, usage = { input_tokens: 100, output_tokens: 50 }) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-7",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [{ type: "tool_use", id: "tu_1", name: "detect_style", input }],
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

const VALID_EVIDENCE = {
  diamond_guide_lines: "present",
  ball_count_box: "left_vertical",
  first_base_position: "bottom_right",
  groundout_position: "bottom_right_small",
  error_symbol: "E_prefix",
  batting_order_style: "circled_digits",
};

describe("detectStyle", () => {
  it("downscales the image to STYLE_DETECT_LONG_EDGE before calling the SDK", async () => {
    const img = await makeCanvas(3300, 2550);
    const create = vi.fn().mockResolvedValue(
      fakeMessage({ style: "waseda", evidence: VALID_EVIDENCE, confidence: 0.95 }),
    );
    const result = await detectStyle(img, {
      client: { messages: { create } } as never,
      onLog: () => {},
    });
    if ("dryRun" in result) throw new Error("unexpected dryRun");

    // 送信されたペイロードの image base64 を復号して寸法を確認
    const call = create.mock.calls[0][0];
    const imageBlock = call.messages[0].content.find(
      (c: { type: string }) => c.type === "image",
    );
    const decoded = Buffer.from(imageBlock.source.data, "base64");
    const meta = await sharp(decoded).metadata();
    expect(
      Math.max(meta.width ?? 0, meta.height ?? 0),
    ).toBeLessThanOrEqual(STYLE_DETECT_LONG_EDGE);
  });

  it("returns parsed style detection when Claude returns waseda", async () => {
    const img = await makeCanvas();
    const create = vi.fn().mockResolvedValue(
      fakeMessage({ style: "waseda", evidence: VALID_EVIDENCE, confidence: 0.92 }),
    );
    const result = await detectStyle(img, {
      client: { messages: { create } } as never,
      onLog: () => {},
    });
    if ("dryRun" in result) throw new Error("unexpected dryRun");
    expect(result.style).toBe("waseda");
    expect(result.confidence).toBe(0.92);
    expect(result.fallbackApplied).toBe(false);
    expect(result.raw.evidence.diamond_guide_lines).toBe("present");
  });

  it("falls back to waseda when Claude returns unknown", async () => {
    const img = await makeCanvas();
    const create = vi.fn().mockResolvedValue(
      fakeMessage({ style: "unknown", evidence: VALID_EVIDENCE, confidence: 0.3 }),
    );
    const result = await detectStyle(img, {
      client: { messages: { create } } as never,
      onLog: () => {},
    });
    if ("dryRun" in result) throw new Error("unexpected dryRun");
    expect(result.style).toBe("waseda");
    expect(result.raw.style).toBe("unknown");
    expect(result.fallbackApplied).toBe(true);
  });

  it("falls back when confidence is below STYLE_CONFIDENCE_FLOOR", async () => {
    const img = await makeCanvas();
    const create = vi.fn().mockResolvedValue(
      fakeMessage({
        style: "keio",
        evidence: VALID_EVIDENCE,
        confidence: STYLE_CONFIDENCE_FLOOR - 0.01,
      }),
    );
    const result = await detectStyle(img, {
      client: { messages: { create } } as never,
      onLog: () => {},
    });
    if ("dryRun" in result) throw new Error("unexpected dryRun");
    expect(result.fallbackApplied).toBe(true);
    expect(result.style).toBe("waseda");
    expect(result.raw.style).toBe("keio");
  });

  it("keeps high-confidence keio without fallback", async () => {
    const img = await makeCanvas();
    const create = vi.fn().mockResolvedValue(
      fakeMessage({ style: "keio", evidence: VALID_EVIDENCE, confidence: 0.9 }),
    );
    const result = await detectStyle(img, {
      client: { messages: { create } } as never,
      onLog: () => {},
    });
    if ("dryRun" in result) throw new Error("unexpected dryRun");
    expect(result.style).toBe("keio");
    expect(result.fallbackApplied).toBe(false);
  });

  it("honors disableFallback option (Day 2 UI takes over)", async () => {
    const img = await makeCanvas();
    const create = vi.fn().mockResolvedValue(
      fakeMessage({ style: "unknown", evidence: VALID_EVIDENCE, confidence: 0.2 }),
    );
    const result = await detectStyle(img, {
      client: { messages: { create } } as never,
      disableFallback: true,
      onLog: () => {},
    });
    if ("dryRun" in result) throw new Error("unexpected dryRun");
    expect(result.style).toBe("unknown");
    expect(result.fallbackApplied).toBe(false);
  });

  it("dryRun propagates upward without applying fallback", async () => {
    const img = await makeCanvas();
    const create = vi.fn();
    const result = await detectStyle(img, {
      dryRun: true,
      client: { messages: { create } } as never,
      onLog: () => {},
    });
    expect("dryRun" in result).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects invalid tool_input (missing evidence fields) via Zod", async () => {
    const img = await makeCanvas();
    const create = vi.fn().mockResolvedValue(
      fakeMessage({ style: "waseda", evidence: {}, confidence: 0.9 }),
    );
    await expect(() =>
      detectStyle(img, {
        client: { messages: { create } } as never,
        onLog: () => {},
      }),
    ).rejects.toThrow();
  });
});
