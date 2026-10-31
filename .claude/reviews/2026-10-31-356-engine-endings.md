# レビュー 356-engine-endings

- 日付: 2026-10-31 / 範囲: `origin/main...HEAD`（#356）/ 割り方: `src-tauri` と `src` の2本 / 対象コミット: 243b273b

## 修正計画

| 順 | ファイル | ルール ID | 確信度 | 行き先 | 修正案 |
| -- | -------- | --------- | ------ | ------ | ------ |
| 1 | `useEngineSeat.ts` | R-TSR-3 | 100 | 直す | 完了済みの席は `isSuperseded` より先に見て撃たない |
| 2 | `provider.tsx` `reducer.ts` | R-TSR-3 | 100 | 直す | `finish_analysis` に結果を載せ、門を reducer の1か所にする。`flushNow` は呼び手0で消す。**実アプリで再現した** |
| 3 | `EngineStatusLabel.tsx` | R-TSR-2 | 100 | 直す | 時計を出さない状態に入ったら値を捨てる |
| 4 | `engineStatus.ts` | R-新規 | 80 | 送る | 起動失敗の語は V8 で入る（#85 #502） |
| 5 | `EngineFailureBridge.tsx` `provider.tsx` の doc | R-新規 | 90 | 直す | 現物に合わせる |
| 6 | `analyzer.rs` の古い `bestmove` | R-新規 | 100 | 送る | #252。上限切れの後に `go` を出さなければ起きない。**stop_flag を消した回帰なので #356 の PR に明記する** |
| 7 | `analyzer.rs` の `drain_stale` | R-新規 | 80 | 送る | #252。無限解析から外す |

## 入れた機械

- `engineEventNames`: 購読と emit の綴りの突き合わせ
- `layering.rs`: `bridge` は `tauri` を使わない

## 直した指摘

1 2 3 5 はコミットへ畳んだ。

## 送ったもの

4 → #85 #502、6 7 → #252

## 見ていない範囲

`docs/` は reviewer に渡していない。`engine/game/` の本体は `quit` の呼び手を追った範囲だけ。
