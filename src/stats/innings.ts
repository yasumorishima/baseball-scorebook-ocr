/**
 * 投球回（Innings Pitched, IP）算出モジュール。
 *
 * docs/architecture.md §7.2 / NPB 公認野球規則 9.02(c)(1) 原注準拠。
 *
 * - 内部表現: **アウト数の整数**（outs_recorded）
 * - 表示: 「5 回 2/3」形式（日本語）または "5 2/3" 形式（英語）
 * - 算式: IP = outs_recorded / 3（小数）
 *
 * IP を小数で持つと丸め誤差で「5.7 回」のような誤表記になるため、
 * 全ての加減算・表示は outs を介して行う。
 */

import type { InningsPitched } from "../types/stats.js";

/** outs 整数から InningsPitched を作る。負数は禁止。 */
export function ipFromOuts(outs: number): InningsPitched {
  if (!Number.isInteger(outs) || outs < 0) {
    throw new Error(`ipFromOuts: outs must be a non-negative integer, got ${outs}`);
  }
  return { outs };
}

/** 2 つの IP を加算（outs 領域で安全に合計）。 */
export function addIp(a: InningsPitched, b: InningsPitched): InningsPitched {
  return { outs: a.outs + b.outs };
}

/** IP を減算（a - b）。結果が負になるなら throw。 */
export function subIp(a: InningsPitched, b: InningsPitched): InningsPitched {
  const outs = a.outs - b.outs;
  if (outs < 0) throw new Error(`subIp: negative IP (${a.outs} - ${b.outs})`);
  return { outs };
}

/** IP を小数に変換（ERA/WHIP 等の算式用）。 */
export function ipToDecimal(ip: InningsPitched): number {
  return ip.outs / 3;
}

/** NPB 表示形式（日本語）: "5 回 2/3" / "完全無失点 0 回 0/3" → "0 回" */
export function formatIpJa(ip: InningsPitched): string {
  const whole = Math.floor(ip.outs / 3);
  const frac = ip.outs % 3;
  if (frac === 0) return `${whole} 回`;
  return `${whole} 回 ${frac}/3`;
}

/** 英語表示形式: "5 2/3" / "0" */
export function formatIpEn(ip: InningsPitched): string {
  const whole = Math.floor(ip.outs / 3);
  const frac = ip.outs % 3;
  if (frac === 0) return `${whole}`;
  return `${whole} ${frac}/3`;
}

/** 小数表記（pybaseball / sabr 互換）: outs=17 → "5.2"（= 5 回 2/3） */
export function formatIpDecimalNotation(ip: InningsPitched): string {
  const whole = Math.floor(ip.outs / 3);
  const frac = ip.outs % 3;
  return `${whole}.${frac}`;
}

/** 別記法 "5.2" のようなアメリカ野球表記から outs に戻す（小数点以下 0/1/2）。 */
export function parseIpDecimalNotation(text: string): InningsPitched {
  const m = /^(\d+)(?:\.(\d))?$/.exec(text.trim());
  if (!m) throw new Error(`parseIpDecimalNotation: invalid "${text}"`);
  const whole = parseInt(m[1], 10);
  const fracDigit = m[2] == null ? 0 : parseInt(m[2], 10);
  if (fracDigit > 2) {
    throw new Error(
      `parseIpDecimalNotation: fractional digit must be 0/1/2, got ${fracDigit}`,
    );
  }
  return { outs: whole * 3 + fracDigit };
}
