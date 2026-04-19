import { describe, expect, it } from "vitest";

import {
  dexieRowToEnvelope,
  envelopeToDexieRow,
  envelopeToSupabaseRow,
  supabaseRowToEnvelope,
  type SupabaseGameEventRow,
} from "@/src/client/sync/envelope-convert";
import type { GameEventRow } from "@/src/client/db/dexie";
import type {
  GameEventEnvelope,
  OcrMetadata,
  PlateAppearancePayload,
} from "@/src/types/event";

const OCR_META: OcrMetadata = {
  confidence: 0.82,
  evidence: "waseda I 6-3",
  alternatives: ["F6", "6-3"],
  raw_notation: "I 6-3",
  image_path: "scorebook/game-123/col-1.jpg",
};

const PAYLOAD: PlateAppearancePayload = {
  batting_order: 3,
  inning: 5,
  batterId: "11111111-1111-7111-8111-111111111111",
  pitcherId: "22222222-2222-7222-8222-222222222222",
  outcome: "ground_out",
  reached_base: 0,
  rbi: 0,
  runs: 0,
  raw_notation: "I 6-3",
  humanReviewed: false,
  sourceCellConfidence: 0.82,
};

const FULL_ENVELOPE: GameEventEnvelope<PlateAppearancePayload> = {
  eventId: "01920000-0000-7000-8000-000000000001",
  gameId: "01920000-0000-7000-8000-aaaaaaaaaaaa",
  seq: 17,
  ts: "2026-04-19T12:00:00.000Z",
  type: "plate_appearance",
  correctionOf: "01920000-0000-7000-8000-000000000000",
  payload: PAYLOAD,
  authorUserId: "01920000-0000-7000-8000-bbbbbbbbbbbb",
  source: "ocr",
  ocrMetadata: OCR_META,
};

const MINIMAL_ENVELOPE: GameEventEnvelope<PlateAppearancePayload> = {
  eventId: "01920000-0000-7000-8000-000000000002",
  gameId: "01920000-0000-7000-8000-aaaaaaaaaaaa",
  seq: 1,
  ts: "2026-04-19T12:05:00.000Z",
  type: "plate_appearance",
  payload: PAYLOAD,
  authorUserId: "01920000-0000-7000-8000-bbbbbbbbbbbb",
  source: "manual",
};

describe("envelopeToDexieRow", () => {
  it("converts all optional fields to null on the persistence boundary", () => {
    const row = envelopeToDexieRow(MINIMAL_ENVELOPE);
    expect(row.correctionOf).toBeNull();
    expect(row.ocrMetadata).toBeNull();
  });

  it("preserves optional fields when present", () => {
    const row = envelopeToDexieRow(FULL_ENVELOPE);
    expect(row.correctionOf).toBe(FULL_ENVELOPE.correctionOf);
    expect(row.ocrMetadata).toEqual(FULL_ENVELOPE.ocrMetadata);
  });

  it("maps eventId → id and keeps camelCase shape", () => {
    const row = envelopeToDexieRow(FULL_ENVELOPE);
    expect(row.id).toBe(FULL_ENVELOPE.eventId);
    expect(row.gameId).toBe(FULL_ENVELOPE.gameId);
    expect(row.authorUserId).toBe(FULL_ENVELOPE.authorUserId);
  });
});

describe("dexieRowToEnvelope", () => {
  it("drops null optional fields back to undefined", () => {
    const row: GameEventRow = envelopeToDexieRow(MINIMAL_ENVELOPE);
    const envelope = dexieRowToEnvelope(row);
    expect(envelope.correctionOf).toBeUndefined();
    expect(envelope.ocrMetadata).toBeUndefined();
  });

  it("roundtrips a full envelope", () => {
    const row = envelopeToDexieRow(FULL_ENVELOPE);
    const back = dexieRowToEnvelope<PlateAppearancePayload>(row);
    expect(back).toEqual(FULL_ENVELOPE);
  });
});

describe("envelopeToSupabaseRow", () => {
  it("renames camelCase → snake_case consistently", () => {
    const row = envelopeToSupabaseRow(FULL_ENVELOPE);
    expect(row.id).toBe(FULL_ENVELOPE.eventId);
    expect(row.game_id).toBe(FULL_ENVELOPE.gameId);
    expect(row.author_user_id).toBe(FULL_ENVELOPE.authorUserId);
    expect(row.correction_of).toBe(FULL_ENVELOPE.correctionOf);
    expect(row.ocr_metadata).toEqual(FULL_ENVELOPE.ocrMetadata);
  });

  it("normalizes undefined → null for the PostgreSQL boundary", () => {
    const row = envelopeToSupabaseRow(MINIMAL_ENVELOPE);
    expect(row.correction_of).toBeNull();
    expect(row.ocr_metadata).toBeNull();
  });
});

describe("supabaseRowToEnvelope", () => {
  it("drops null → undefined and flips snake_case → camelCase", () => {
    const row: SupabaseGameEventRow = {
      id: MINIMAL_ENVELOPE.eventId,
      game_id: MINIMAL_ENVELOPE.gameId,
      seq: MINIMAL_ENVELOPE.seq,
      ts: MINIMAL_ENVELOPE.ts,
      type: MINIMAL_ENVELOPE.type,
      correction_of: null,
      payload: MINIMAL_ENVELOPE.payload,
      author_user_id: MINIMAL_ENVELOPE.authorUserId,
      source: MINIMAL_ENVELOPE.source,
      ocr_metadata: null,
    };
    const envelope = supabaseRowToEnvelope<PlateAppearancePayload>(row);
    expect(envelope.correctionOf).toBeUndefined();
    expect(envelope.ocrMetadata).toBeUndefined();
    expect(envelope.gameId).toBe(MINIMAL_ENVELOPE.gameId);
    expect(envelope.authorUserId).toBe(MINIMAL_ENVELOPE.authorUserId);
  });

  it("roundtrips a full envelope via Supabase", () => {
    const row = envelopeToSupabaseRow(FULL_ENVELOPE);
    const back = supabaseRowToEnvelope<PlateAppearancePayload>(row);
    expect(back).toEqual(FULL_ENVELOPE);
  });
});

describe("cross-boundary roundtrip", () => {
  it("envelope → Supabase → envelope → Dexie → envelope preserves identity", () => {
    const viaSupabase = supabaseRowToEnvelope<PlateAppearancePayload>(
      envelopeToSupabaseRow(FULL_ENVELOPE),
    );
    const viaDexie = dexieRowToEnvelope<PlateAppearancePayload>(
      envelopeToDexieRow(viaSupabase),
    );
    expect(viaDexie).toEqual(FULL_ENVELOPE);
  });
});
