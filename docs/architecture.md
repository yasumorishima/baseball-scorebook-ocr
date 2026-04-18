# baseball-scorebook-ocr アーキテクチャ

> 本書は 2026-04-18 までに実施した Deep Research 3 弾および事前検証の**全知見**を、実装ファイル単位に落とし込んだ設計書です。
> 実装時に「簡単だから省略」を禁止する唯一のソースであり、Day 1（事前実装）〜 Day 2（ハッカソン本番 PWA 化）の指針となります。

---

## 0. 設計原則（ABSOLUTE、違反したら即停止）

1. **検証済みパイプラインを省略しない**。「1画像丸ごと投入は読めない / イニング列クロップなら読める」はメモリに記録済みであり、この結論を前提にする。
2. **調査結果をすべて反映する**。流派判別・Few-shot・Prompt Caching・Tool Use による JSON 強制・ルール検証・NPB 9.00 スタッツ算式・信頼度 self-report・OBP 逆説 UI・撮影 UX・RLS 性能最適化・招待コード nanoid8 など、Deep Research 項目を 1 つも欠落させない。
3. **1 枚あたりの精度が本質**。「スループット」「一括処理」「20 枚評価」は評価軸にしない。
4. **完全な実装後に初めて実 API**。前処理・プロンプト・クライアント・オーケストレーション・検証・集計がすべて書き終わるまで、課金リクエストは送らない。block hook と `.scorebook-test-approved` ゲートで強制。
5. **fail-closed**。validation が通らないセルは自動確定しない。低信頼セルは UI で人間レビュー。
6. **Opus 4.7 仕様準拠**。`temperature` は廃止・`prefilling` は Opus 4.6 以降で廃止・画像は長辺 2576px ネイティブ・`cache_control: ephemeral` を system/few-shot に必ず付与。
7. **合成 synthesis をユーザーに丸投げしない**。本書で全設計を明示する。

---

## 1. システム全体像

```
raw JPEG (撮影 or スキャン)
  │
  ▼  src/preprocess/normalize.ts
[EXIF 補正 → 2576px 長辺リサイズ → mozjpeg q90]
  │
  ▼  src/preprocess/quality.ts
[Laplacian variance ブレ判定 / mean luma ダーク判定]
  │
  ▼  src/preprocess/dewarp.ts  (Day 2 本番で有効化)
[jscanify 4隅検出 → 台形補正]
  │
  ▼  src/preprocess/crop-innings.ts
[ヘッダー行 / 選手列 / イニング列 × N / スタッツ列 に分割]
  │
  ▼  src/ocr/stage1-detect-style.ts
[低解像 (768px) 全体像 → 流派分類 waseda/keio/chiba/unknown + 構造 evidence]
  │
  ▼  src/ocr/stage2-extract-cells.ts × N 列
[流派条件付き Few-shot → 各イニング列の 9 セルを JSON 化]
  │
  ▼  src/ocr/merge.ts
[列ごとの結果を Grid[batting_order][inning] に統合]
  │
  ▼  src/ocr/validate.ts
[1イニング=3アウト / 打順連続性 / 空セル整合 などルール検査]
  │
  ▼  src/ocr/retry-low-conf.ts
[confidence < 0.5 のセルを単独セルサイズでクロップ → 再 OCR]
  │
  ▼  src/stats/compute.ts + innings.ts + anomalies.ts
[NPB 公認野球規則 9.00 準拠で AVG/OBP/SLG/ERA/WHIP/K9/BB9 算出, IP は「5回2/3」表記]
  │
  ▼  UI 表示 / DB 保存 (Dexie → Supabase Realtime Broadcast)
```

---

## 2. スコアブック記法と流派体系

アマチュア野球で並立する 5 流派:

| 流派 | 来歴 | シェア | 本アプリ対応 |
|---|---|---|---|
| **早稲田式**（飛田穂洲・1925） | アマ全般のデファクト | 大学/高校/草野球 | **Day 1 完全対応** |
| **成美堂式**（早稲田式の市販亜種） | 2001〜 | 市販 95%+（9102/9103/9104/9106/9139） | **Day 1 完全対応（既存サンプルが成美堂 9104 推定）** |
| **慶応式（NPB式）**（山内以九士・1936） | プロ公式記録員 | NPB プロ | Day 2 スタブ |
| **BFJ 推奨式**（全日本野球協会・2020） | アマ統一化 | 新規普及中 | Day 2 スタブ |
| **千葉式**（広川善任・1970s） | 千葉県高校野球 | ローカル | スタブのみ |

実装上は **waseda / keio / chiba / unknown** の 4 クラス分類。BFJ と成美堂は waseda 互換で吸収。

### 2.1 流派判別の決定的視覚特徴（印刷段階で確定、手書き崩れ無関係）

| 特徴 | waseda 系 | keio 系 |
|---|---|---|
| 菱形補助線 | **あり**（セル内 4 辺） | なし |
| ボールカウント枠 | セル**左**縦長 | セル**上**横長 |
| 1 塁位置 | セル**右下** | セル右上 |
| 凡打記法 | 右下 1/4 小さく `6-3` | **セル中央分数形式** |
| 打順表記 | 丸数字 ①②③ | 小文字 a〜i |
| 失策記号 | `E5` | **守備番号右肩に `'`** |

### 2.2 流派差の罠（要注意）

- 「◇菱形囲み」: waseda=**犠打** / keio=**内野安打**（正反対）
- `SO`: keio=**即アウト三振** / `K`: keio=**振り逃げ三振**
- 兵庫高野連: `K=空振り` / `SO=見逃し`（keio と逆）
- 盗塁: keio=`O` / waseda=`S`
- 四球: keio=`BB` / waseda=`B` 単独

### 2.3 基本記法（waseda 系、本アプリ第一対応）

**守備番号**: 1=投 2=捕 3=一 4=二 5=三 6=遊 7=左 8=中 9=右

**アウトカウント**: `I` = 1 アウト目 / `II` = 2 アウト目 / `III` = 3 アウト目（セル左上の小さなローマ数字）

**打撃結果**:
- 単打 `1B` / 二塁打 `2B` / 三塁打 `3B` / 本塁打 `HR`
- 四球 `BB` または `B` / 死球 `HBP` / 三振（空振り）`K` / 三振（見逃し）`Kc` または `逆K`
- 犠打 `SAC` 菱形囲み / 犠飛 `SF`
- 野手選択 `FC` / 失策 `E{n}`
- ゴロアウト連鎖: `6-3` `4-3` `5-4-3`（位置番号をハイフン連結）
- 飛球アウト: `F7/F8/F9` / ライナー `L7/L8/L9` / 小飛 `P2`

**菱形進塁マーク**（各セル右下の菱形）:
- 右上塗り = 1 塁到達
- 右下塗り = 2 塁到達
- 左下塗り = 3 塁到達
- 左上塗り or 中央ドット = 得点

**パスボール/暴投**: `PB` / `WP`
**盗塁**: `S` + 盗塁先（waseda） / `O` + 盗塁先（keio）

---

## 3. Claude Vision 呼び出し方針

### 3.1 採用モデル

- **`claude-opus-4-7`** 一択
- 長辺 2576px / 4784 tokens/枚（他モデルは 1568px / 1568 tokens で頭打ち）
- 日本語手書き OCR NLS 0.897 (nyosegawa benchmark)

### 3.2 API パラメータ

- `max_tokens: 16000`（81 セル × ~200 tokens 相当の余裕）
- `stop_sequences: ["</cells>"]`
- `temperature`: **指定しない**（Opus 4.7 で廃止、指定すると invalid_request_error）
- `system` ブロックと few-shot ブロックに `cache_control: { type: "ephemeral" }`

### 3.3 JSON 出力強制

**Tool Use + `tool_choice`** で JSON を強制（prefilling は Opus 4.6 以降で廃止）。

```ts
tools: [{ name: "emit_cells", input_schema: CellsSchema }]
tool_choice: { type: "tool", name: "emit_cells" }
```

Structured Outputs (`output_config.format` + JSON Schema) は 2025-11-13 GA だが citations 非互換。本アプリは citations を使わないので Structured Outputs を第一候補、SDK バージョン差異があれば Tool Use にフォールバック。

### 3.4 プロンプト設計 3 原則

1. **CoT XML タグ**: `<thinking>` → `<answer>` の順で推論を明示（Cookbook 実証）。Tool Use の場合は thinking block → tool_use block の順で model が自律推論。
2. **Few-shot 3〜5 例**: `<example>` タグで囲む。relevant / diverse / structured を担保。流派ごとに差し替え。
3. **Self-check 指示**: "verify outs sum to 3 per inning", "batting order must increase within an inning", "alternatives[] must be filled when confidence < 0.7" 等、出力後の自己検証を強制。

### 3.5 メッセージ順序

**画像 → テキスト**（公式）。テキスト先行は精度劣化報告あり。

### 3.6 Prompt Caching の使い分け

- **system** ブロック: 記法リファレンス + 判定ガイド + 出力スキーマ → 全呼び出しで cache
- **few-shot** ブロック: 流派ごとの例 → 流派判明後は cache
- 初回呼び出し: 1.25× (cache write) / 2 回目以降: 0.1× (cache read) → **90% 削減**

### 3.7 信頼度 self-report

logprobs は非公開なので self-report に依存。安定化策:

1. `evidence`（短い根拠文）を **先に**出させてから `confidence` を数値化
2. 数値アンカー: `0.95=鮮明`, `0.7=やや崩れ`, `0.4=複数候補`, `<0.3=推測`
3. `alternatives[]`（≥ 2 候補）を必須化 — confidence < 0.7 で 2 候補以上強制
4. （Phase 2）Cleanlab TLM 等の外部 trust score で AUROC 25% 改善を検討

---

## 4. 前処理パイプライン詳細（`src/preprocess/`）

### 4.1 `normalize.ts`

```ts
export async function normalize(input: Buffer): Promise<NormalizedImage> {
  const meta0 = await sharp(input).metadata();
  const buf = await sharp(input)
    .rotate()                               // EXIF 自動補正（v0.33.5 は .rotate() / v1+ は .autoOrient()）
    .resize({ width: 2576, height: 2576, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  const meta1 = await sharp(buf).metadata();
  return {
    base64: buf.toString("base64"),
    mediaType: "image/jpeg",
    origSize: { width: meta0.width, height: meta0.height },
    sentSize: { width: meta1.width, height: meta1.height },
    bytes: buf.byteLength,
  };
}
```

- **やる**: EXIF 自動補正 / 2576px 長辺リサイズ / mozjpeg q90
- **やらない**: 二値化 / グレースケール化 / 強コントラスト（VLM では精度低下報告）

### 4.2 `quality.ts`

```ts
export async function assessQuality(input: Buffer) {
  const { data, info } = await sharp(input).grayscale().raw().toBuffer({ resolveWithObject: true });
  // Laplacian variance（3×3 カーネル）
  const lapVar = laplacianVariance(data, info.width, info.height);
  // mean luma
  const meanLuma = arrayMean(data);
  return {
    ok: lapVar >= 100 && meanLuma >= 80,
    issues: [
      ...(lapVar < 100 ? [`blur (variance=${lapVar.toFixed(1)}, need ≥100)`] : []),
      ...(meanLuma < 80 ? [`dark (luma=${meanLuma.toFixed(1)}, need ≥80)`] : []),
    ],
  };
}
```

閾値は Dynamsoft Document Scanner JS Edition 実装定数採用。

### 4.3 `dewarp.ts`（Day 2 本番）

- jscanify v1.4.2（MIT, OpenCV.js 依存）で 4 隅検出 + 透視変換
- sharp の `.affine()` は 2×2 行列のみ（3×3 ホモグラフィ非対応）
- サーバー側 Node 実行時は `@techstark/opencv-js` (Apache-2.0, TS 型付属)、ブラウザ側は `jscanify` を直接使用
- Day 1 はスキャナ前提で bypass 可

### 4.4 `crop-innings.ts`

```ts
export type ScorebookLayout = {
  /** header row が画像上何 % を占めるか */
  headerRatio: number;
  /** 選手列が左何 % を占めるか */
  playerColRatio: number;
  /** 右側スタッツ列が何 % を占めるか */
  statsColRatio: number;
  /** イニング数（通常 9、延長 10-） */
  inningCount: number;
};

const SEIBIDO_9104_WASEDA: ScorebookLayout = {
  headerRatio: 0.08,
  playerColRatio: 0.17,
  statsColRatio: 0.10,
  inningCount: 9,
};

export async function cropInnings(image: Buffer, layout = SEIBIDO_9104_WASEDA) {
  const meta = await sharp(image).metadata();
  const W = meta.width!, H = meta.height!;
  const headerH = Math.round(H * layout.headerRatio);
  const bodyY = headerH, bodyH = H - headerH;
  const playerW = Math.round(W * layout.playerColRatio);
  const statsW = Math.round(W * layout.statsColRatio);
  const inningTotalW = W - playerW - statsW;
  const inningW = Math.floor(inningTotalW / layout.inningCount);

  return {
    header: await crop(image, 0, 0, W, headerH),
    player: await crop(image, 0, bodyY, playerW, bodyH),
    innings: await Promise.all(
      Array.from({ length: layout.inningCount }, (_, i) =>
        crop(image, playerW + i * inningW, bodyY, inningW, bodyH)
      ),
    ),
    stats: await crop(image, playerW + inningTotalW, bodyY, statsW, bodyH),
    meta: { W, H, inningW, playerW, statsW, headerH },
  };
}
```

- **Day 1**: 比率ベース固定分割。既存サンプル（成美堂 9104）の比率で校正。
- **Day 2**: `opencv-js` で水平・垂直ラインを Hough 検出 → 自動校正モード追加

### 4.5 向き判定の 4 戦略（優先順）

1. **sharp.rotate() / autoOrient()** — 無料、EXIF あれば確実（第一選択）
2. **Tesseract.js OSD** — 無料ローカル、日本語精度低、v5.03 rotateRadians 不具合
3. **Claude 低解像サムネで問合せ** — 最賢、1 往復 ~$0.0017、日本語 OK（stage1 に組み込み）
4. **自前 Hough 線検出** — スコアブック構造適合、実装コスト高

---

## 5. 2 段階 OCR パイプライン詳細（`src/ocr/`）

### 5.1 Stage 1: `stage1-detect-style.ts`

- 入力: 全体像を 768px 長辺にダウンスケール（~1 Mpix、$0.002 程度）
- プロンプト（`prompts/style-detect.ts`）:
  - 判別要素: 菱形補助線 / BC 枠位置 / 1 塁位置 / 凡打記法 / 打順表記 / 失策記号
  - 出力: `{ style, evidence, confidence }`
- Tool schema:
  ```json
  {
    "style": "waseda | keio | chiba | unknown",
    "evidence": {
      "diamond_guide_lines": "present | absent",
      "ball_count_box": "left_vertical | top_horizontal",
      "first_base_position": "bottom_right | top_right",
      "groundout_position": "bottom_right_small | center_fraction",
      "error_symbol": "E_prefix | prime_superscript",
      "batting_order_style": "circled_digits | lowercase_latin"
    },
    "confidence": "0.0-1.0"
  }
  ```

### 5.2 Stage 2: `stage2-extract-cells.ts`

- 入力: 1 イニング列の crop（例: ~260 × 2200 px）
- プロンプト: 流派ごとに差し替え
  - `prompts/waseda-system.ts`（Day 1 本命）
  - `prompts/keio-system.ts`（Day 2 スタブ）
- Few-shot: `prompts/waseda-fewshot.ts` に 3〜5 例（既存サンプルの cell 画像 + expected JSON）
  - 既存 `data/samples/` を原本として公開せず API 送信のみ、かつリポ内は gitignore 済
  - 公開 README/スクリーンショット用途は後で名前マスキング版を `data/samples-public/` に作成
- Tool schema (per cell):
  ```json
  {
    "batting_order": "int 1-11",
    "inning": "int 1-15",
    "raw_notation": "string or null (blank)",
    "outcome": "enum (single|double|triple|home_run|walk|hbp|strikeout_swinging|strikeout_looking|sac_bunt|sac_fly|fielders_choice|error|ground_out|fly_out|line_out|pop_out|interference|unknown) or null",
    "fielders_involved": "int[] or null",
    "reached_base": "0|1|2|3|4 or null",
    "out_count_after": "1|2|3 or null",
    "pitch_count": "{ balls, strikes } or null",
    "extras": {
      "SH": "bool (犠打)",
      "SF": "bool (犠飛)",
      "HBP": "bool",
      "FC": "bool (野手選択)",
      "error_fielder": "int or null",
      "stolen_bases": "int[] (到達塁)",
      "passed_ball": "bool",
      "wild_pitch": "bool",
      "interference": "batter | runner | null",
      "strikeout_reached": "bool (振り逃げ出塁)"
    },
    "evidence": "short string (何を見てそう判断したか)",
    "confidence": "0.0-1.0",
    "alternatives": "string[] (≥2 if confidence < 0.7)"
  }
  ```

### 5.3 `merge.ts`

- N 個のイニング列結果を `Grid<CellRead>[batting_order][inning]` に統合
- 列境界の crop オーバーラップ（隣接列が同じセルを含む）をカバーする場合、confidence が高い方を採用

### 5.4 `retry-low-conf.ts`

- 第 1 パスで confidence < 0.5 のセルを抽出
- 該当セルの単独 crop（列幅 × 1/打順数 の領域）を再生成
- 単独セル用プロンプト `prompts/single-cell-retry.ts` で OCR
- 結果を merge back。retry 後も低信頼なら UI で人間確認フラグを立てる

### 5.5 `client.ts`（`src/ocr/`）

```ts
export interface ClaudeCallParams {
  system: string;
  fewshot?: FewshotBlock[];    // cache_control 対象
  userImage: { base64: string; mediaType: "image/jpeg" };
  userText: string;
  tools: Tool[];
  toolName: string;
  maxTokens?: number;
  stopSequences?: string[];
}
```

- `@anthropic-ai/sdk` 薄ラッパー
- 5xx / 429 は exponential backoff で 3 回まで retry（ジッタ付き）
- 使用トークン（image / system / cache_create / cache_read / output）を構造化ログ出力
- dry-run モード（`env: DRY_RUN=1`）で API を呼ばず、送信予定プロンプトをダンプ

---

## 6. 検証（`src/ocr/validate.ts`）

### 6.1 必須検査

1. **イニングあたりアウト数 = 3**（または試合終了時の未了イニング）
2. **打順連続性**: 同一イニング内で打順は +1 ずつ増加（先頭は前イニング終了打順の次）
3. **reached_base と outcome の整合**: `out` 系 outcome は `reached_base == 0`、`single` は `reached_base ≥ 1`、など
4. **菱形マークと出塁の整合**: 菱形どこまで塗ってあるかと reached_base の最大値が一致
5. **得点記録の整合**: 得点 (reached_base == 4) のセル総数とイニング合計点が一致
6. **投手イニング累計**: SO/BB/H/ER の縦横合算と選手別合計が一致
7. **打数の整合**: BB/HBP/SH（犠打）/Int/Ob は AB に含まない、SF は AB に含まない
8. **空白セル**: 前打順が未了のイニングで空白なら warning

### 6.2 違反の扱い

```ts
type ValidationReport = {
  valid: boolean;
  errors: Violation[];    // 確定的な不整合（人間修正必須）
  warnings: Violation[];  // 注意（自動確定しない）
  perInningOuts: number[];
  battingOrderSequence: number[][];
};
```

fail-closed: 違反があるセルは自動保存せず「確認待ち」状態で UI に表示。

---

## 7. スタッツ集計（NPB 公認野球規則 9.00 準拠、`src/stats/`）

日米完全同一。MLB OBR の日本語訳＋【注】が NPB 規則 9.00。pybaseball / sabr 系のロジックそのまま流用可能（ただしライブラリ直接依存せず、数十行で自前実装）。

### 7.1 `compute.ts` 算式

```ts
AVG = H / AB
OBP = (H + BB + HBP) / (AB + BB + HBP + SF)
SLG = (1B + 2*2B + 3*3B + 4*HR) / AB
OPS = OBP + SLG
BABIP = (H - HR) / (AB - SO - HR + SF)

ERA = 9 * ER / IP
WHIP = (BB + H) / IP
K/9 = 9 * SO / IP
BB/9 = 9 * BB / IP
K/BB = SO / BB
```

### 7.2 `innings.ts`（投球回）

- 内部表現: **アウト数の整数**（outs_recorded）
- 表示: `Math.floor(outs/3)`回 + `outs % 3 == 1 ? "1/3" : outs % 3 == 2 ? "2/3" : ""`
- 算式側: `IP = outs_recorded / 3`（小数）
- NPB 規則 9.02(c)(1) 原注 準拠

### 7.3 OCR 抽出必須項目

スタッツ集計のために各打席から取る必要のある項目:

`AB, H, 2B, 3B, HR, BB, HBP, SH(犠打), SF(犠飛), SO, Int(打撃妨害), Ob(走塁妨害), FC, E, 振り逃げ出塁`

### 7.4 `anomalies.ts` — OBP 逆説（UI ツールチップ必須）

出塁したのに OBP が下がるケース（規則 9.05(b) / 9.02(a)(1)）:

| ケース | AB | H | AVG 方向 | OBP 方向 |
|---|:-:|:-:|:-:|:-:|
| 振り逃げ出塁 | +1 | なし | ↓ | **↓（直感と逆）** |
| フィルダースチョイス (FC) | +1 | なし | ↓ | ↓ |
| エラー出塁 | +1 | なし | ↓ | ↓ |
| 犠打+野手選択で全員生存 | 0 | なし | 変動なし | 変動なし |
| 打撃妨害で一塁 | 0 | なし | 変動なし | 変動なし |
| 走塁妨害で一塁 | 0 | なし | 変動なし | 変動なし |

`anomalies.ts` は該当ケースを検出し、UI は `?` アイコン + 規則条項リンク（https://npb.jp/scoring/calculation.html 等）を表示。

---

## 8. データモデル

### 8.1 イベントソーシング（append-only）

1 打席 = 1 イベント。訂正は `correction_of: <元 event id>` を持つ新レコードで append（in-place 更新なし）。現在スコアは View / クライアント reduce で導出（CQRS 風）。

```ts
type GameEvent = {
  id: string;                  // UUID v7
  game_id: string;
  seq: number;                 // per game sequence
  ts: string;                  // ISO8601
  type: "plate_appearance" | "substitution" | "correction" | "inning_end" | "game_end";
  correction_of?: string;      // 訂正時のみ
  payload: PlateAppearancePayload | SubstitutionPayload | ...;
  author_user_id: string;
  source: "manual" | "ocr";
  ocr_metadata?: {
    confidence: number;
    evidence: string;
    alternatives: string[];
    raw_notation: string | null;
    image_path: string;
  };
};
```

UNIQUE 制約: `(game_id, seq)`。再送は `on conflict (id) do nothing` で冪等。衝突 (23505) は seq を採り直し。

### 8.2 Dexie スキーマ（クライアント）

```ts
db.version(1).stores({
  games: "&id, team_id, date, status",
  game_events: "&id, game_id, seq, [game_id+seq], ts",
  pending_events: "&id, game_id, retry_count",
  teams: "&id, owner_user_id",
  players: "&id, team_id, name",
});
```

- 複合インデックス `[game_id+seq]` で高速取得
- `pending_events` は二層同期キューの app 層

### 8.3 Supabase PostgreSQL スキーマ

```sql
create table game_events (
  id uuid primary key,
  game_id uuid not null references games(id),
  seq integer not null,
  ts timestamptz not null default now(),
  type text not null,
  correction_of uuid references game_events(id),
  payload jsonb not null,
  author_user_id uuid not null references auth.users(id),
  source text not null check (source in ('manual','ocr')),
  ocr_metadata jsonb,
  unique (game_id, seq)
);

create index idx_game_events_game on game_events(game_id);
create index idx_game_events_author on game_events(author_user_id);
```

---

## 9. 同期（`src/sync/`）

### 9.1 Supabase Realtime **Broadcast**（Postgres Changes ではなく）

公式は大規模案件で Broadcast 推奨。

```sql
create or replace function broadcast_game_event() returns trigger as $$
begin
  perform realtime.broadcast_changes(
    'game:' || new.game_id,
    tg_op,
    new.id::text,
    row_to_json(new)
  );
  return new;
end $$ language plpgsql;

create trigger trg_broadcast_game_event
  after insert on game_events
  for each row execute function broadcast_game_event();
```

クライアント:
```ts
supabase.channel('game:' + gameId).on('broadcast', { event: '*' }, ({ payload }) => {
  dexie.game_events.put(payload);
});
```

### 9.2 二層同期キュー（iOS Safari 対応含む）

- **SW 層**: Workbox BackgroundSyncQueue（Chrome 系で指数バックオフ、24h 保持）
- **アプリ層**: Dexie `pending_events` + `online` イベント + 起動時 flush（Safari フォールバック、UI に pending/synced バッジ表示）

---

## 10. 認証・認可（Supabase + RLS）

### 10.1 ロール階層

| ロール | 権限 | 役割 |
|---|---|---|
| owner | チーム削除・オーナー移譲 | チーム代表 |
| admin | メンバー管理・招待発行 | マネージャー |
| scorer | 試合作成・スコア入力 | 記録係 |
| viewer | 閲覧のみ | 家族・応援団 |

### 10.2 招待コード（nanoid 8 字、0/O/1/I/l 除外）

```ts
import { customAlphabet } from 'nanoid';
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const generateInviteCode = customAlphabet(alphabet, 8);   // 57^8 ≈ 1.1e14
```

UNIQUE 制約 + 衝突時 3 回 retry。数字 6 桁は列挙攻撃に脆弱で不採用。

### 10.3 `redeem_invitation()` SECURITY DEFINER 関数

rate limit（10 分で 5 回失敗ブロック）+ team_members 追加 + use_count 増加を **1 トランザクション**で実行。`invitations` テーブルの直接 SELECT を封じて列挙防止。

```sql
create or replace function redeem_invitation(p_code text) returns uuid
security definer stable as $$
declare
  v_team_id uuid;
  v_failure_count int;
begin
  select count(*) into v_failure_count from invitation_attempts
    where user_id = auth.uid() and ts > now() - interval '10 minutes' and success = false;
  if v_failure_count >= 5 then
    raise exception 'too_many_attempts' using errcode = 'P0001';
  end if;

  select team_id into v_team_id from invitations
    where code = p_code and expires_at > now() and use_count < max_uses;
  if v_team_id is null then
    insert into invitation_attempts(user_id, code, success) values (auth.uid(), p_code, false);
    raise exception 'invalid_code' using errcode = 'P0002';
  end if;

  insert into team_members(team_id, user_id, role) values (v_team_id, auth.uid(), 'scorer');
  update invitations set use_count = use_count + 1 where code = p_code;
  insert into invitation_attempts(user_id, code, success) values (auth.uid(), p_code, true);
  return v_team_id;
end $$ language plpgsql;
```

### 10.4 RLS 性能ルール（必須遵守）

公式ベンチ (GaryAustin1/RLS-Performance): `auth.uid()` → `(select auth.uid())` で **179ms → 9ms**、join テーブル経由は SECURITY DEFINER 関数 + ARRAY で **>2 分 → 2ms**。

1. `auth.uid()` は常に `(select auth.uid())` で wrap
2. 全 policy に `to authenticated` を付与（anon で評価スキップ）
3. join テーブル参照は SECURITY DEFINER + stable 関数に外出し
4. `user_id` / `team_id` 列に btree index 必須

### 10.5 RLS 穴塞ぎチェックリスト

- `to authenticated` 明示で auth.uid() null silent failure 防止
- Views に `with (security_invoker = true)` 付与（PG14 以前は RLS bypass）
- `user_metadata` はクライアント改変可能 → `app_metadata` か DB テーブル使用
- UPDATE 時は SELECT policy も必須（既存行読み取り）
- `service_role` キーは RLS 完全 bypass → クライアント絶対禁止

### 10.6 Next.js 15 App Router 認証

- **`middleware.ts` で `getSession()` を信頼しない**（公式明言）
- 代わりに **`getClaims()`**（JWT 署名検証あり）を使用
- 招待発行は Server Action で insert、unique 衝突時 3 回 retry
- Redeem は `supabase.rpc('redeem_invitation', { p_code })`
- 最後の owner が抜けられない trigger 追加

---

## 11. 撮影 UX（Day 2、`src/capture/`）

### 11.1 Adobe Scan 3 状態モデル

1. **searching** — ドキュメント探索中（灰色オーバーレイ、`Looking for document`）
2. **holdSteady** — 4 隅固定 + N フレーム安定で自動撮影（金色オーバーレイ）
3. **manual fallback** — N 秒検出失敗で手動シャッター提示

### 11.2 Scanner 定数（Dynamsoft Document Scanner JS Edition 採用）

```ts
const STABLE_FRAMES = 12;        // 連続安定フレーム数
const CORNER_MOVE_PX = 20;       // 4 隅の移動量閾値
const BLUR_VAR_MIN = 100;        // Laplacian variance 閾値
const DARK_LUMA_MAX = 80;        // 平均輝度 / 255
```

全条件 AND で自動撮影発火。

### 11.3 iOS Safari 対応

- **facingMode Bug 252560**: iOS 16.4 まで `exact: 'environment'` が失敗 → **`{ ideal: 'environment' }` 必須**
- **iPhone 15 Pro enumerateDevices 不具合** (Apple Forum 776460): Wide/Ultra-wide/Tele が WebRTC で正しく列挙されない
- **Standalone PWA** で `video.onended` ハンドリング要

```ts
const constraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 }, height: { ideal: 1080 },
    frameRate: { ideal: 30, max: 30 },
  },
};
```

### 11.4 採用スタック

- **jscanify v1.4.2** (MIT) + **OpenCV.js** (Apache-2.0) 4 隅検出 + 透視変換
- **Laplacian variance** (cv.Laplacian + cv.meanStdDev) ブレ判定
- **cropperjs v2** (MIT) 手動クロップ
- **react-webcam** (MIT) カメラキャプチャ
- **tesseract.js** (Apache-2.0) 補助 OSD（日本語精度低いので補助のみ）

**除外**: Dynamsoft MDS（商用）/ TensorFlow.js（オーバースペック）/ opencv4nodejs（ネイティブバインディング、Vercel 非互換）

---

## 12. PWA 構成（`next.config.ts` + `src/pwa/`）

### 12.1 採用フレームワーク

**`@serwist/next` v9.5+**（next-pwa は 2022 以降リリースなし、Issue #508 で事実上メンテ停止）。

- Next.js 15 App Router + Turbopack + Bun 公式対応
- Service Worker は Serwist BackgroundSyncQueue 使用

### 12.2 オフライン戦略

- Supabase クライアントは**オフラインライトキュー/差分同期を標準装備しない**（公式 Discussion #40664、Feature Request 中）
- Web 向けは自前実装必須
- 本アプリは Dexie pending_events + Serwist BackgroundSyncQueue の二層で実装

---

## 13. 実装順序（Day 1、2026-04-18〜20）

### フェーズ A: 基盤（API 不要）

1. `src/types/` — Cell / Grid / Style / ValidationReport / PlayerStats / GameEvent
2. `src/preprocess/normalize.ts` + 単体テスト
3. `src/preprocess/quality.ts` + 単体テスト（Laplacian/luma フィクスチャ）
4. `src/preprocess/crop-innings.ts` + 単体テスト（既存サンプルで比率校正）

### フェーズ B: プロンプトとスキーマ（API 不要）

5. `src/ocr/schemas.ts` — Zod で Cell/Style スキーマ定義
6. `src/ocr/prompts/style-detect.ts` — Stage 1 プロンプト
7. `src/ocr/prompts/waseda-system.ts` — Stage 2 waseda システムプロンプト
8. `src/ocr/prompts/waseda-fewshot.ts` — Few-shot 3〜5 例（既存サンプルから抜粋）
9. `src/ocr/prompts/single-cell-retry.ts` — 低信頼再読みプロンプト
10. `src/ocr/prompts/keio-system.ts`（スタブ）
11. `src/ocr/prompts/chiba-system.ts`（スタブ）

### フェーズ C: クライアントとオーケストレーション（API 不要）

12. `src/ocr/client.ts` + mock SDK ユニットテスト（cache_control / tool_choice / retry 挙動）
13. `src/ocr/stage1-detect-style.ts` + mock テスト
14. `src/ocr/stage2-extract-cells.ts` + mock テスト
15. `src/ocr/merge.ts` + テスト
16. `src/ocr/retry-low-conf.ts` + テスト
17. `src/ocr/validate.ts` + 合成グリッドで違反検出テスト

### フェーズ D: スタッツ（API 不要）

18. `src/stats/innings.ts` + テスト（5 回 2/3 表記、IP 境界）
19. `src/stats/compute.ts` + テスト（AVG/OBP/SLG/ERA/WHIP/K9/BB9 手計算フィクスチャ）
20. `src/stats/anomalies.ts` + テスト（OBP 逆説 6 ケース）

### フェーズ E: 最終統合（API 不要）

21. `src/pipeline.ts` — 全モジュール連結、dry-run モード
22. `experiments/ocr-baseline/run-pipeline.ts` — CLI エントリ、`DRY_RUN=1` で送信予定プロンプト/トークンをダンプ
23. テスト全通過を確認

### フェーズ F: 初回実 API（ユーザー承認必須）

24. 残クレジット確認、全体コスト見積もりをユーザーに提示
25. `.scorebook-test-approved` ファイル作成（ユーザーが手動、UNLOCK_UNTIL + REASON 必須）
26. 既存サンプル 1 枚でフルパイプライン実行
27. 精度・信頼度分布・バリデーション違反数・コストを報告
28. pivot 判断: 十分な精度なら Day 2 PWA 実装へ、不十分なら retry / few-shot 拡張 / prompt 調整

---

## 14. テスト戦略（実 API を使わない）

### 14.1 ユニットテスト

- `src/preprocess/*.test.ts`: 既存サンプルに対する寸法・crop 位置のピクセル精度 ≤ 5% 誤差
- `src/ocr/client.test.ts`: `@anthropic-ai/sdk` を `vitest.mock` で偽装、送信 payload の cache_control / tool_choice / stop_sequences を検証
- `src/ocr/validate.test.ts`: 合成グリッド（violate / valid）で期待結果
- `src/stats/compute.test.ts`: NPB 公式例題（https://npb.jp/scoring/calculation.html 掲載）を再現

### 14.2 統合テスト（mock SDK）

- 事前に手動アノテーションした「想定 tool_use レスポンス」をフィクスチャ化
- pipeline.ts を実行、最終スタッツが手計算値と一致するか確認

### 14.3 dry-run モード

- `DRY_RUN=1 bun run pipeline data/samples/XXXX.jpg` で API を呼ばず:
  - 各 crop のサイズ / 推定トークン / cache savings
  - 送信予定プロンプト全文
  - 想定コスト（USD）

---

## 15. 受け入れ条件（完全実装 = API 解禁条件）

以下すべて満たした時点で `.scorebook-test-approved` を作成可能:

- [ ] Section 13 フェーズ A〜E のファイルすべて実装
- [ ] 全ユニットテスト合格
- [ ] mock SDK 統合テスト合格
- [ ] `DRY_RUN=1` で既存サンプル 1 枚のパイプライン完走、送信予定プロンプト / トークン見積もり / コスト見積もりが妥当
- [ ] 想定コスト見積 ≤ 残クレジット × 0.5
- [ ] lint / typecheck 全通過
- [ ] ユーザーに「実装済みファイル一覧 / 未実装項目 / 残クレジット / 見積コスト」を提示して承認取得

---

## 16. コスト試算（事前）

### 16.1 前提

- Opus 4.7: 入力 $15/Mtok、出力 $75/Mtok（Anthropic 公式）
- 画像トークン: `width × height / 750`（Opus 4.7 は長辺 2576 で 4784 tokens cap）
- Prompt Caching: write 1.25× / read 0.1×

### 16.2 1 枚あたり（Prompt Caching 無し）

- Stage 1（768px 全体像）: 入力 ~1.3k（image）+ 1.5k（system）= 2.8k / 出力 0.5k → $0.080
- Stage 2（260×2200 イニング列 × 9 + ヘッダー + 選手列 × 1 = 11 呼び出し）:
  - 各入力: image ~760 + system+fewshot ~3k = 3.8k
  - 各出力: ~2k
  - 合計 11 × (3.8k × $15 + 2k × $75)/1M = $1.92
- Retry（低信頼セル想定 5 個）: ~$0.15
- **合計: ~$2.15 / 枚**

### 16.3 1 枚あたり（Prompt Caching 有り、通常運用時）

- system + fewshot をキャッシュ化、1 枚目以降 90% カット
- **合計: ~$0.3〜0.5 / 枚**（2 枚目以降はさらに下がる）

### 16.4 初回 API 検証時

- 残クレジット（想定 $4.09）で 1 枚フルパイプライン実行 → ~$2.15 消費
- retry 1 回込みで ~$2.5 → 残 ~$1.6
- ハッカソン本番で $500 付与、3000〜10000 試合分の実験可能

---

## 17. 競合状況と訴求軸

### 17.1 市場

- 日本の草野球人口 470〜500 万人、31 万チーム以上
- 主要競合はいずれも **OCR 機能なし**
- スコアラー（App Store 4.5★ 774 件、最大手）開発者が 2025-08 に「手書きメンバー表 OCR は技術的に難易度が高く、実現可能性は低い」と公開レビューで**自ら白旗**

### 17.2 本アプリの差別化の穴

1. **OCR による紙スコア/メンバー表読み取り** ← 最大の穴
2. 複数端末同時入力 × オフライン整合性（誰も解けていない）
3. 慶応式（NPB 式）対応（既存は全て早稲田式のみ）
4. MLB 式自責点ルール
5. OB 会連携（現役 × OB 通算成績）
6. 連盟報告書の都道府県独自様式 PDF 出力
7. 打席ごとの動画リンク
8. 片手操作最適化

### 17.3 ハッカソン訴求

> **スコアラー開発者が諦めた手書きスコアブック OCR を Claude Opus 4.7 Vision で初めて実用化する**
> — 市場 470 万人 31 万チーム、最大手が 774 件 4.5★、OCR 要望公開済、競合全員が早稲田式のみ対応

---

## 18. 一次情報 URL

### 18.1 NPB / アマチュア野球規則

- NPB 記録計算方法: https://npb.jp/scoring/calculation.html
- 公認野球規則 9.00 PDF: https://npb.jp/scoring/officialrule_900.pdf
- NPB 2024 年度改正: https://npb.jp/npb/2024rules.html
- BFJ 2026 アマチュア内規: https://baseballjapan.org/jpn/uploaded_data/bfj_news/doc/0964/2026AmateurBaseballInternalRegulations.pdf
- JABA 2026: https://www.jaba.or.jp/news/detail/?id=24629

### 18.2 技術スタック

- Serwist: https://github.com/serwist/serwist / https://serwist.pages.dev/docs/next
- next-pwa メンテ停止: https://github.com/shadowwalker/next-pwa/issues/508
- Supabase Realtime Broadcast: https://supabase.com/docs/guides/realtime/broadcast
- Supabase Offline Discussion: https://github.com/orgs/supabase/discussions/40664
- Dexie.js: https://github.com/dexie/Dexie.js
- Workbox Background Sync: https://developer.chrome.com/docs/workbox/modules/workbox-background-sync
- Event Sourcing 参考: https://github.com/eugene-khyst/postgresql-event-sourcing
- RLS Perf: https://github.com/orgs/supabase/discussions/14576
- RLS ベンチ: https://github.com/GaryAustin1/RLS-Performance
- Supabase SSR: https://supabase.com/docs/guides/auth/server-side/nextjs?router=app
- Invite 公式スタンス: https://github.com/supabase/supabase/discussions/6055
- nanoid: https://github.com/ai/nanoid
- jscanify: https://github.com/puffinsoft/jscanify
- sharp: https://github.com/lovell/sharp
- react-webcam: https://github.com/mozmorris/react-webcam
- tesseract.js: https://github.com/naptha/tesseract.js

---

## 19. 変更履歴

| 日付 | 変更 |
|---|---|
| 2026-04-18 | 初版。Deep Research 3 弾＋事前検証の全項目を 1 本に統合。 |
