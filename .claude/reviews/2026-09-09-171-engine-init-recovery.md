# レビュー 171-engine-init-recovery

- 日付: 2026-09-09
- 範囲: `git diff origin/main...HEAD`（`fix/171-engine-init-recovery`、基点 `76902437`）
- 走らせた reviewer: architecture / comment / react / robustness / oss-hygiene（1巡目、並列）
- 所見: 34件

## 入れた機械

**2つ。どちらも変異を当てて落ちることを確かめた。**

### 1. URL の `tab` に書ける綴りを型にする（`85332f60`）

`URLParams["tab"]` が `string` だったので、実在しない綴りを渡しても
tsc も lint も何も言わず、受け側（`SettingsPanel`）が既定のタブへ落としていた。
**実際に2箇所が壊れていた**（`tab: "general"`。`9b3e57dd` で先に直した）。

綴りを `shared/lib/router/useURLParams.ts` の `TabType` に集め、
`features/settings/model/tabs.ts` は `satisfies` で合わせる。

変異:

| 当てたもの                           | 結果                                                 |
| ------------------------------------ | ---------------------------------------------------- |
| 呼び出し側に `tab: "general"` を戻す | `TS2322`（`FileTree.tsx:78`）                        |
| `TABS` に `book` を足す（片側だけ）  | `TS2322`（`tabs.ts` と `SettingsPanel.tsx` の2箇所） |

### 2. 帯に動作が要ることを型にする（`67e5edcd`）

`NotificationLayer.scss` が「**帯を出す失敗には、必ず動作を持たせること**——
ヘッダの操作を奪うので、閉じる以外にやることが無い帯は出さない」と書いていたが、
守っているのは人の注意だけだった（`actions?` は任意）。
`banner` の枝に `actions: [NotifyAction, ...NotifyAction[]]` を要求させる。

変異: `EngineFailureBridge` から `actions` を落とす → `TS2345`。

## 直した所見

1所見1コミット。

| コミット   | 所見                                                                                       | 出どころ                       |
| ---------- | ------------------------------------------------------------------------------------------ | ------------------------------ |
| `9b3e57dd` | `tab: "general"` が実在しない綴り。押した先はワークスペースタブだった                      | architecture / robustness      |
| `36d074d9` | 帯の本文が「設定を直せば起動し直す」と言い切る。実行権限や spawn の失敗では嘘になる        | robustness                     |
| `0aa74583` | コメント4件が実装より広い／狭い（件数・StrictMode・ログの在り処・引っ込める条件）          | comment / react / architecture |
| `f197e145` | `openSettings` の ref が守っている性質を、テストが1本も固定していなかった                  | react                          |
| `31ed596b` | テストの名乗り（同値設定の引き金・セルの綴り・「どれも外しても落ちない」）が実物と違う     | comment / architecture         |
| `e33c598c` | 台帳の数え上げ（`clearError` 6→5、動いた行の列挙、段の所在の重複）と画面仕様の #171 の残り | oss-hygiene                    |
| `bb1771cf` | ADR-0004 の実測表が誤りのままで、`settings.md` がそこへ読み手を送っていた                  | oss-hygiene                    |

**この直し方で壊しうるもの**（手順4の1行）を、効いた順に書く。

- `TabType` を足したことで、`create-file` の `"create"` / `"import"` も同じ union に入った。
  **モーダルごとの語彙は分かれていない**ので、`openModal("settings", { tab: "import" })` は
  いまも型で止まらない。止めるには `modal` と `tab` を対で受ける形が要る
- `banner` に `actions` を必須にしたので、**既存の帯のテスト2箇所が書き換わった**
  （`NotificationLayer.test.tsx` の `shownAs`、`provider.test.tsx` の「鍵で引っ込められる」）。
  型を緩めれば両方とも黙って通る状態へ戻る
- 帯の本文を伸ばした。帯は自分から消えないので長さの制約は無いが、
  `max-height: 50%`（`NotificationLayer.scss`）に近づくと巻き取られる

## 送ったもの

| 行き先                     | 内容                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| **#533**                   | 設定を外すと、エンジンが止まったまま帯だけ消える（`phase` が `idle` へ落ちる回）                    |
| **#534**                   | 帯が設定モーダルの上端に重なる（実機では未確認）                                                    |
| **#535**                   | 同じ設定で起こし直す口（`restart` / `clearError`）が2つ在って、どちらも呼ばれていない               |
| **#523**（既存）           | 帯を閉じたあと、エンジンが起動していない理由がどこにも残らない。この PR は #523 の案 (b) を実装した |
| `mechanization-backlog.md` | `knip` の計測がテストからの import も数える（本番から到達しない export をテスト1本で隠せる）        |

`EngineFailureBridge` の cleanup に `TODO(#533)` を置いてある。

## 機械にできなかったもの

`mechanization-backlog.md` の「機械では止まらないもの」の1（コメントの理由と条件式のずれ）と
4（一意性の断言）に当たる。今回いちばん多かったのもこの2つで、
**5人中3人が同じ4行のコメントを別々に指した**。

バックログへは1件書き足した（`knip` の計測範囲、1回目）。
既存の項目で今回また出たものは無い。

## 直さなかった所見

- **`dedupeKey` を「引っ込める取っ手」に使ったせいで、帯に意味のない「1件」が出る**
  （react / robustness / architecture の3人が指摘）。畳みと取っ手を型で分けるか、
  件数を出す条件を `count > 1` にするかのどちらかだが、後者は
  `Notification.count` の doc が「1件目から出す」と決めた理由と正面から当たる。
  **通知基盤の設計判断なので、#171 の範囲では決めない。** → 報告でユーザーに出す
- **`EngineTab.tsx` の `console.log(selectedId)`**（react）。差分の外。
  `docs/spec/screens/settings.md` の「いま満たしていないこと」に既に載っている

## 見ていない範囲

- **実機で帯を出していない。** 帯の描画そのものは `NotificationLayer.test.tsx` が
  押さえているが、この橋が出した帯を目で見た者は居ない
- Rust 側は読んだだけ（`bridge.rs` がログへ書いていることの確認まで）
- 2巡目は「入れた機械が効いているか」だけを見た（手順5）。所見の再収集はしていない
