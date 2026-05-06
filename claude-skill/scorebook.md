---
description: スコアブック画像 inning 13 列を私 (Claude Opus 4.7) が Read tool で直接見て構造化、ユーザー対話で訂正、SQLite + CSV に保存。API 呼び出し $0。
---

# Scorebook OCR (Interactive Review Mode)

引数: `$ARGUMENTS` = 画像 ID (例: `241201_1`, `241201_2`, `250419_1` 等)。RPi5 `~/scorebook-private/samples/${ID}.jpg` に格納の 20 枚から選択。

## 前提知識 (memory + ABSOLUTE rule 遵守)

- **絶対**: 実 API (`anthropic.messages.create`) を本 skill から呼ばない。私が Read tool で画像を直接見る。コスト $0 が原則
- **流派**: Seibido 9104 waseda、layout 校正値 `playerColRatio: 0.196` / `rightStatsRatio: 0.812` (2 試合で一般化確認済 2026-05-06)
- **記法リファレンス** (出力時の解釈に使用):
  - ローマ数字 I/II/III: その inning の何アウト目か (1/2/3)
  - K = 三振、逆K (左右反転) = 空振り三振、正K = 見逃し三振
  - F + 数字 = 飛球 (F8=中飛、F4=二飛、F2=捕邪飛)
  - 数字-数字 = ground out 経路 (6-3 = 遊→一、4-3 = 二→一)
  - 単数字 = ground out で捕球位置 (2=捕手、1=投手 等)
  - 犠 / 犠打 = sac bunt、犠飛 = sac fly
  - ○数字 / (数字) = 出塁経路や守備位置の表記
  - 8E / 4E = エラー (中堅・二塁)
  - DB / db = double play
  - ν / ℓ / 行 / 正 = 装飾的記号 (流派・書き手依存、意味は cell 文脈で判断)
  - ダイヤ内塗り潰し = 得点、部分塗り = 進塁先 (1塁=右下、2塁=右上、3塁=左上、本塁=中央)

## 実行フロー

### Step 1: 画像確認 + RPi5 から fetch

引数 `${ARG}` を確認。指定なしならユーザーに問い返す。

```bash
# 1. RPi5 で hough-snap-prior を該当画像で再実行 (out/hough-snap-prior は最後の画像のものなので毎回上書き想定)
timeout 60 ssh -o StrictHostKeyChecking=no yasu@100.77.198.48 "timeout 30 bash -lc 'cd ~/baseball-scorebook-ocr
node scripts/hough-snap-prior.cjs ~/scorebook-private/samples/${ARG}.jpg'"

# 2. 13 枚を tar で固めて download
timeout 30 ssh -o StrictHostKeyChecking=no yasu@100.77.198.48 "timeout 15 tar -czf /tmp/scorebook-${ARG}.tgz -C ~/baseball-scorebook-ocr/out/hough-snap-prior ."
timeout 30 scp -o StrictHostKeyChecking=no yasu@100.77.198.48:/tmp/scorebook-${ARG}.tgz "C:/Users/fw_ya/AppData/Local/Temp/scorebook-${ARG}.tgz"

# 3. 展開 (PowerShell で mkdir、Bash で tar)
```

PowerShell で `New-Item -ItemType Directory -Force -Path "C:\Users\fw_ya\AppData\Local\Temp\scorebook-${ARG}"`、Bash で `tar -xzf .../scorebook-${ARG}.tgz -C C:/Users/fw_ya/AppData/Local/Temp/scorebook-${ARG}/`。

### Step 2: 1 inning ずつ私が Read → 構造化出力 → ユーザー確認

inning 1 から順番に:
1. `Read C:/Users/fw_ya/AppData/Local/Temp/scorebook-${ARG}/inning_NN.png`
2. 見えた内容を **markdown 表** で出力:
   ```
   ## inning N (game ${ARG})
   | batter | raw | outcome | conf | note |
   |---|---|---|---|---|
   | 1 | IK | strikeout_swinging (逆K=空振り) | 0.9 | 1アウト目 |
   | 2 | IIF4 | fly_out F4 (二飛) | 0.8 | 2アウト目 |
   | 3 | III2 | ⚠️ ground_out P2 OR fly_out F2 (foul fly catcher) | 0.6 | 3アウト目、F の有無不明 |
   | 4-10 | (空ダイヤ) | blank | 1.0 | 打席なし |
   ```
3. 自信がない cell は **⚠️ プレフィックス + 候補 2 つ** 並列。 conf < 0.7 で flag
4. **「OK?」と尋ねてユーザー応答待ち**。「OK」なら次 inning、「batter 3 は III F2」のような訂正受付 → 訂正反映して再表示 → 再 OK 待ち
5. 13 inning 全部終わるまで繰り返す

### Step 3: 全 inning 確定後 → SQLite + CSV

```bash
# python3 stdin pipe で RPi5 SQLite に書込
timeout 60 ssh -o StrictHostKeyChecking=no yasu@100.77.198.48 'python3 -' <<'PYEOF'
# 1. game レコード新規 (date / our_team / opponent はユーザーから収集 or デフォルト)
# 2. ocr_runs (model='claude-opus-4-7+manual', cost_usd=0, status='succeeded')
# 3. cells × 130 件 (確定値)
# 4. export-csv.sh を subprocess で呼ぶ
PYEOF
```

最終的に wide CSV を `cat` で表示してユーザーに見せる。

### Step 4: cleanup

```bash
# local Windows Temp の個人情報を削除
```

PowerShell で `Remove-Item -Recurse -Force "C:\Users\fw_ya\AppData\Local\Temp\scorebook-${ARG}*"`。

## 重要な振る舞い

- **捏造しない**: 自信なければ raw_notation = `null`、 conf < 0.5、 ユーザー判断を待つ
- **拡大要求対応**: 「もう一度見て」「ここ拡大」と言われたら、画像 region 指定で再 Read
- **1 inning ずつ確定**: 並行して複数 inning 出力しない、 ユーザーが OK 出すまで次に進まない
- **handwriting variance を正直に**: 高密度プレー (盗塁・併殺・連続置換) で confident に読めない場合は `⚠️` で flag、 ユーザーに「目で確認してください」と言う
- **既知 inning 13 right-edge issue**: crop 端で文字切れる場合、 「右端で notation が途切れて見える」と明示
- **API 呼び出し禁止**: 「Anthropic API 経由でやり直そうか」のような提案を出さない、 本 skill の核心は API 不要の対話式 OCR

## 完了条件

- 全 13 inning の cells がユーザー確定
- SQLite に新 game_id で記録、 ocr_runs id 記録 (cost_usd=0)
- wide CSV 表示
- local Temp 削除
- 「セッション完了、game_id=N、コスト $0、所要 X 分」と報告

## 参照 memory file

- `project_scorebook-ocr.md` (プロジェクト全体史、 layout 校正経緯、 過去 OCR 結果)
- `project_scorebook-layout.md` (Seibido 9104 waseda 流派の実測比率と打順可変ルール)
- `feedback_ocr-single-image-focus.md` (1 枚精度評価、 スループット言及禁止)
- `feedback_respect-prior-verification.md` (検証済み方針を捨てて振り出しに戻さない、 hough-snap-prior + イニング列クロップ前処理は必ず通す)
