/**
 * innings.ts の単体テスト（境界値 + 表記統合性）。
 */

import { describe, expect, it } from "vitest";

import {
  addIp,
  formatIpDecimalNotation,
  formatIpEn,
  formatIpJa,
  ipFromOuts,
  ipToDecimal,
  parseIpDecimalNotation,
  subIp,
} from "../../src/stats/innings.js";

describe("ipFromOuts / ipToDecimal", () => {
  it("0 outs → IP 0.0", () => {
    expect(ipToDecimal(ipFromOuts(0))).toBe(0);
  });

  it("3 outs → IP 1.0", () => {
    expect(ipToDecimal(ipFromOuts(3))).toBe(1);
  });

  it("17 outs → IP 17/3 (5 2/3 equivalent decimal)", () => {
    expect(ipToDecimal(ipFromOuts(17))).toBeCloseTo(17 / 3, 6);
  });

  it("rejects negatives and non-integers", () => {
    expect(() => ipFromOuts(-1)).toThrow();
    expect(() => ipFromOuts(1.5)).toThrow();
  });
});

describe("addIp / subIp", () => {
  it("addIp is associative and lossless", () => {
    const a = ipFromOuts(5);
    const b = ipFromOuts(11);
    const c = ipFromOuts(2);
    const left = addIp(addIp(a, b), c).outs;
    const right = addIp(a, addIp(b, c)).outs;
    expect(left).toBe(right);
    expect(left).toBe(18);
  });

  it("subIp throws on negative", () => {
    expect(() => subIp(ipFromOuts(2), ipFromOuts(5))).toThrow(/negative IP/);
  });
});

describe("formatIp", () => {
  it("JA exact inning: '5 回'", () => {
    expect(formatIpJa(ipFromOuts(15))).toBe("5 回");
  });

  it("JA 1/3 frac: '5 回 1/3'", () => {
    expect(formatIpJa(ipFromOuts(16))).toBe("5 回 1/3");
  });

  it("JA 2/3 frac: '5 回 2/3'", () => {
    expect(formatIpJa(ipFromOuts(17))).toBe("5 回 2/3");
  });

  it("JA zero: '0 回'", () => {
    expect(formatIpJa(ipFromOuts(0))).toBe("0 回");
  });

  it("EN forms", () => {
    expect(formatIpEn(ipFromOuts(17))).toBe("5 2/3");
    expect(formatIpEn(ipFromOuts(15))).toBe("5");
    expect(formatIpEn(ipFromOuts(0))).toBe("0");
  });

  it("decimal notation (5.2 = 5 and 2/3)", () => {
    expect(formatIpDecimalNotation(ipFromOuts(17))).toBe("5.2");
    expect(formatIpDecimalNotation(ipFromOuts(18))).toBe("6.0");
  });
});

describe("parseIpDecimalNotation", () => {
  it("parses '5.2' → 17 outs", () => {
    expect(parseIpDecimalNotation("5.2").outs).toBe(17);
  });

  it("parses '5' (no fractional) → 15 outs", () => {
    expect(parseIpDecimalNotation("5").outs).toBe(15);
  });

  it("parses '0.1' → 1 out", () => {
    expect(parseIpDecimalNotation("0.1").outs).toBe(1);
  });

  it("rejects non-baseball decimals like 5.5 or 5.9", () => {
    expect(() => parseIpDecimalNotation("5.3")).toThrow();
    expect(() => parseIpDecimalNotation("5.9")).toThrow();
  });

  it("rejects malformed input", () => {
    expect(() => parseIpDecimalNotation("abc")).toThrow();
    expect(() => parseIpDecimalNotation("")).toThrow();
  });
});
