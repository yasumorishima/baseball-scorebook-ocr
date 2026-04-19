/**
 * experiments/ocr-baseline/run-pipeline.ts の承認ゲート parse ロジック単体テスト。
 *
 * docs/architecture.md §15 で規定する `.scorebook-test-approved` ファイル形式
 *   UNLOCK_UNTIL=<ISO datetime>
 *   REASON=<non-empty string>
 * のパース検証と、欠落・不正時の fail-closed 動作を確認する。
 *
 * CLI 本体（checkApprovalGate）は process.exit を呼ぶため unit test しづらく、
 * ここでは純関数 parseApprovalFile をテスト対象とする。期限比較ロジックは
 * `Date.parse` の標準動作を信頼する前提。
 */

import { describe, expect, it } from "vitest";

import { parseApprovalFile } from "../../experiments/ocr-baseline/run-pipeline.js";

describe("parseApprovalFile", () => {
  it("parses a valid file with both UNLOCK_UNTIL and REASON", () => {
    const content = `UNLOCK_UNTIL=2026-04-21T23:59:59+09:00
REASON=First real API verification after Phase A-E completion
`;
    const fields = parseApprovalFile(content);
    expect(fields.UNLOCK_UNTIL).toBe("2026-04-21T23:59:59+09:00");
    expect(fields.REASON).toBe(
      "First real API verification after Phase A-E completion",
    );
  });

  it("ignores comments and blank lines", () => {
    const content = `# this is a comment
UNLOCK_UNTIL=2026-04-21T12:00:00Z

# another comment
REASON=hackathon test
`;
    const fields = parseApprovalFile(content);
    expect(fields.UNLOCK_UNTIL).toBe("2026-04-21T12:00:00Z");
    expect(fields.REASON).toBe("hackathon test");
  });

  it("handles Windows CRLF line endings", () => {
    const content = "UNLOCK_UNTIL=2026-04-21T12:00:00Z\r\nREASON=ok\r\n";
    const fields = parseApprovalFile(content);
    expect(fields.UNLOCK_UNTIL).toBe("2026-04-21T12:00:00Z");
    expect(fields.REASON).toBe("ok");
  });

  it("trims whitespace around key and value", () => {
    const content = `  UNLOCK_UNTIL  =  2026-04-21T12:00:00Z
  REASON = spaced out
`;
    const fields = parseApprovalFile(content);
    expect(fields.UNLOCK_UNTIL).toBe("2026-04-21T12:00:00Z");
    expect(fields.REASON).toBe("spaced out");
  });

  it("throws when UNLOCK_UNTIL is missing", () => {
    const content = `REASON=only reason provided
`;
    expect(() => parseApprovalFile(content)).toThrow(/UNLOCK_UNTIL/);
  });

  it("throws when REASON is missing", () => {
    const content = `UNLOCK_UNTIL=2026-04-21T12:00:00Z
`;
    expect(() => parseApprovalFile(content)).toThrow(/REASON/);
  });

  it("throws when REASON is empty string", () => {
    const content = `UNLOCK_UNTIL=2026-04-21T12:00:00Z
REASON=
`;
    expect(() => parseApprovalFile(content)).toThrow(/REASON/);
  });

  it("throws on completely empty file", () => {
    expect(() => parseApprovalFile("")).toThrow();
  });

  it("ignores unknown keys silently (forward compatibility)", () => {
    const content = `UNLOCK_UNTIL=2026-04-21T12:00:00Z
REASON=valid
FUTURE_KEY=foobar
`;
    const fields = parseApprovalFile(content);
    expect(fields.UNLOCK_UNTIL).toBe("2026-04-21T12:00:00Z");
    expect(fields.REASON).toBe("valid");
  });

  it("keeps value containing '=' intact (only splits on first '=')", () => {
    const content = `UNLOCK_UNTIL=2026-04-21T12:00:00Z
REASON=a=b=c test
`;
    const fields = parseApprovalFile(content);
    expect(fields.REASON).toBe("a=b=c test");
  });
});

describe("UNLOCK_UNTIL expiry semantics (Date-level)", () => {
  it("correctly detects an expired datetime", () => {
    const past = new Date("2020-01-01T00:00:00Z");
    const now = new Date();
    expect(now.getTime() > past.getTime()).toBe(true);
  });

  it("correctly accepts a future datetime", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const now = new Date();
    expect(now.getTime() > future.getTime()).toBe(false);
  });

  it("treats invalid datetime string as NaN (Date.parse contract)", () => {
    const invalid = new Date("not-a-date");
    expect(Number.isNaN(invalid.getTime())).toBe(true);
  });
});
