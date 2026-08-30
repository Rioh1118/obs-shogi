# レビュー cursor-vocabulary ラウンド7

- 日付: 2026-08-30
- 範囲: `git diff main...HEAD`
- 対象コミット: `f89fcb4`
- 走らせた reviewer: comment / architecture / robustness

## robustness の等価性確認

r6 で振る舞いを変えた3点。**すべて等価。退行なし。**

| 何を                                          | どう確かめたか                              | 結果             |
| --------------------------------------------- | ------------------------------------------- | ---------------- |
| `goToIndex` の `gotoPath` 化                  | 展開すると旧の式と**文字どおり同一**        | 差が出る余地なし |
| `getTesuuPointer()` → `cursorFromPlayer(...)` | 実物の `json-kifu-format` で **2445ケース** | 不一致 0         |
| `descendTo(base ?? …)` → `descendTo(base, …)` | 乱択 **（うち `base === null` が 40%）**    | 差分 0           |

**依頼文の誤りを1つ訂正された。** `state.cursor === null` の分岐に「テストが無い」と
書いたが、`reducer.ts` を全部読むと `state.jkf !== null ⟺ state.cursor !== null` が
成り立ち、`navigate` / `edit` は冒頭で `if (!state.jkf) return` するので
**`??` の右辺は到達不能**。「テストが無い経路」ではなく「テストの書きようが無い経路」。

## 所見

### HIGH

| #   | 所見                                                                                                | 結果   |
| --- | --------------------------------------------------------------------------------------------------- | ------ |
| C1  | `playerCursor.ts` の「`getTesuuPointer` を外で直に呼ばないこと」が現物2箇所と他の doc 2箇所に反する | 直した |
| C2  | 削除した `buildCursorWithForkSelection` を doc が3箇所で指す                                        | 直した |
| C3  | `game.md` が「`cursorFromLite` は正規化しない」と書くが、この差分で正規化する                       | 直した |

**C2 は置換漏れの3回目**（r3 C4 / r4 C2 に続く）。しかも `game.md:218` は
「`normalizeForkPointers(picked, te)` で落とす」を根拠にしていたが `descendTo` は
それを呼ばない。**結論は正しく機構だけ嘘**という一番直しにくい形だった。

### MEDIUM

| #   | reviewer     | 所見                                                                       | 結果                 |
| --- | ------------ | -------------------------------------------------------------------------- | -------------------- |
| R1  | robustness   | **`cursorExportsTested` の正規表現が、書き方の違う export を黙って見逃す** | 直した（作り直し）   |
| A1  | architecture | `JKFPlayer` の直呼びが3箇所残っていた（r6 の「残り2箇所」は誤り）          | 直した               |
| A2  | architecture | 検査が1ファイル専用で、隣の `branch.ts` に未テストの export がある         | 直した（対象を拡張） |
| C4  | comment      | `descendTo` の `null` に doc もテストも無い（レンダ中に通る）              | 直した               |
| C5  | comment      | `PlannedCursor` の「brand が止めるのは `KifuCursor` だけ」が偽             | 直した               |
| C6  | comment      | 検査の「定数を外す理由」が `ROOT_CURSOR` に当たらない                      | 直した（+テスト）    |

**R1 が最も重い。自分が入れた番人に穴があった。**
`^export const (\w+)\s*=\s*[^=]*=>` は既定値つきの引数を拾わない。reviewer が
実際に `export const nudgeTesuu = (path, delta = 1) =>` を足して**緑のまま通る**ことを
示した。下限は総数しか見ないので1つの漏れは止まらない。
この検査は「テストが付かず不変条件を外しても緑」が3回起きた答えとして入れたものなので、
**番人自身が黙って消える形は無いより悪い。** モジュールを読み込んで `typeof` で
数える形に作り直し、同じ入力で落ちることを確認した。

**A2 で対象に `model/branch.ts` を足したら5つ落ちた。** 3つは `describe` の名前が
散文だったので関数名に揃え、`neighborBranchIndex` と `branchIndexAfterRemoval` は
**テストが1本も無かった**（どちらも本番で使われている）ので足した。

## 採らなかった提案

**「状態遷移表が指す識別子の実在検査」（comment / architecture が提案、
「置換漏れ3回目なので two-strikes を満たす」）は実装して撤回した。**

作って走らせた結果、**43件の誤検出**が出た。内訳は

- 予約語・リテラル: `catch` / `finally` / `delete` / `false` / `true` / `null` / `undefined`
- 状態遷移表の状態名や概念: `game` / `engine` / `analyzer` / `search` / `warning` / `fatal` / `danger`
- フィールド名・引数名（関数ではないので `src` に宣言が無い）:
  `forkPointers` / `branchPlan` / `prevPlan` / `overridePlan` / `forceCommit` / `kifuFormat` ほか
- 外部ライブラリのメソッド: `goto` / `forward` / `forkAndForward` / `splice` / `useRef`
- コミットハッシュ: `bb29884`

パスの検査が成り立つのは、パスが**曖昧でない**ため（`src/` から始まり拡張子で終わる）。
識別子は「実装の名前か、フィールド名か、説明のための語か」を機械が判定できず、
絞り込むには結局その判断を人が書き下すことになる。**誤検出43件を許可リストに
積む検査は、緑を維持する作業が本体より重くなる。**

置換漏れ自体は3回起きているので、機械で止めたいのは正しい。ただし
**この形では止まらない**、というのが実装して測った結論。3箇所の置換漏れは今回直した。

## 見ていない範囲

- `src-tauri/`（差分に1行も無い）。`index_builder.rs` は C3 の裏取りに読んだ
- SCSS / レイアウト / キーボード操作 / フォーカス管理
- 実アプリを起動しての動作確認
- perf（r1 実測、r6 で `hitKey` を再測）
- react（r2 で1件、#227 へ送った）

## comment reviewer が「所見なし」と明示した点

**`PLAN_WALK_LIMIT` の doc は、6ラウンド目にして実装と一致した。**
reviewer が `json-kifu-format` の実装を読み、4点（`c = 1e4` の等値判定、
ぴったり 10000 手だけが投げること、`forkPointers` 付き `goto` の区間分解、
読むのは `advanceToLeafWithPlan` だけで呼び出し側は2つ）すべてが実装と一致し、
`advanceWithPlan.test.ts` が実測で固定していることを確認した。

## エピック #279 の完了について（architecture の判定）

未決で番号の無いものは無い（#306 / #226 / #196 / #302 / #304 に全部番号がある）。

ただし architecture が1点を指摘している。**#278 が前提として名指ししている
「`branchPlan` の扱い」は、#279 を閉じても満たされない。**
行の `branchForkPointers` が計画由来のままで、それは #196 へ送った（r6 A1）。
`advanceWithPlan` が「実際に降りた `forkIndex`」を返すようになったので材料は
揃っているが、寄せる作業自体は #196 の範囲。**PR 本文にこれを書く。**

## lint / hook で強制できるもの

- **`new JKFPlayer(` / `player.goto(` / `.getTesuuPointer(` / `.getForkPointers(` を
  `entities/kifu/lib` の外で禁じるラチェット。** A1 の直しで違反は2箇所
  （どちらも #302 の `nodeId` 用）まで減ったので、いま入れれば基準線にできる
- （撤回）状態遷移表が指す識別子の実在検査 — 上記のとおり測って断念
- （再掲・未実装）`src/` 直下にレイヤ名以外のディレクトリを作らせない検査
- 束縛なしの空 `catch {}` を UI 層で禁止（r6 R2、#308）

## 次ラウンドの対象

`exportsTested` の作り直し、`branch.test.ts` の再構成、`JKFPlayer` 直呼びの
3箇所の置き換えを見る。所見が0件になるかを確かめる。
