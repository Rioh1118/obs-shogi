# レビュー game-cursor-plan ラウンド3

- 日付: 2026-08-30
- 範囲: `704b51d..HEAD`（ラウンド2の修正6コミット）
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 前ラウンド: [r1](2026-08-30-game-cursor-plan-r1.md) / [r2](2026-08-30-game-cursor-plan-r2.md)

**所見ゼロではない。** BLOCK 2・HIGH 2・MEDIUM 14。
**うち3件はラウンド2の修正が持ち込んだ退行**（M3 / M4 / M5）、
**1件はラウンド2で私が書いた反論が誤りだった**（M2）。

## 所見

| #   | 深刻度 | 所見                                                                                             | reviewer                            | 結果                  |
| --- | ------ | ------------------------------------------------------------------------------------------------ | ----------------------------------- | --------------------- |
| H1  | BLOCK  | `PlannedCursor` の TSDoc が、同じコミットで改名した旧名 `plannedCursorOf` を指している           | comment / architecture / robustness | 対応済み（`ce14537`） |
| H2  | BLOCK  | `CursorPath` と `buildPlayer` の TSDoc が `tesuuPointer` について正反対を書いている              | comment                             | 対応済み（`ce14537`） |
| H3  | HIGH   | `game.md` の E16 が実装と違う。パース失敗は file-tree が持ち、モーダルに出る（読み手は0でなく1） | comment / oss-hygiene               | 対応済み（`dee9bcd`） |
| H4  | HIGH   | E15 の帰結を断定したが、ツリー取得が失敗すると旧ワークスペースを指したまま残る                   | comment / oss-hygiene               | 対応済み（`dee9bcd`） |
| M1  | MEDIUM | `computeLeafTesuu` の広げ方が逆向き。計画側専用なのに辿ったカーソルも受けるようになった          | architecture                        | 対応済み（`ce14537`） |
| M2  | MEDIUM | **ラウンド2の反論が誤り。** `branchPlan` を brand すれば型で閉じる                               | architecture                        | 対応済み（`ce14537`） |
| M3  | MEDIUM | 行要素の取り方が ref / id / クラスの3通りになり、クラス名の改名で静かに壊れる                    | architecture / react                | 対応済み（`1fb126e`） |
| M4  | MEDIUM | `closeForkMenu` の `"auto"` が、局面が変わる経路で effect の smooth を打ち消す                   | react / comment                     | 対応済み（`1fb126e`） |
| M5  | MEDIUM | `closest` が切り離された行を返し、`offsetTop` 0 でリストが先頭まで飛ぶ                           | react                               | 対応済み（`1fb126e`） |
| M6  | MEDIUM | テストコメントの根拠が、同じコミットで足した値（`7`）に対して偽                                  | robustness                          | 対応済み（`ce14537`） |
| M7  | MEDIUM | `withoutFences` が入れ子・未閉じ・インデントで壊れる                                             | robustness / comment                | 対応済み（`c04d4af`） |
| M8  | MEDIUM | 「未作成」検査が共起だけを見るので、1行に両方書くと誤検知する                                    | robustness / comment                | 対応済み（`c04d4af`） |
| M9  | MEDIUM | docs だけのコミットでは verify-gate が素通しで、docs 検査が一度も走っていない                    | robustness                          | 見送り → #251 ※       |
| M10 | MEDIUM | `docs/` 全体への拡大がカバーを増やしていない。中間状態が一番損                                   | robustness / oss-hygiene            | **反論**（下記）      |
| M11 | MEDIUM | `headingSlug` が重複見出しの連番を作らないのに「github-slugger と同じ」と断定                    | comment                             | 対応済み（`c04d4af`） |
| M12 | MEDIUM | リンク検査の `#!` に理由が無く、該当も0件                                                        | comment                             | 対応済み（`c04d4af`） |
| M13 | MEDIUM | `DIR` と2つのヘルパが返す相対パスの基準が名前から読めない                                        | comment                             | 対応済み（`c04d4af`） |
| M14 | MEDIUM | `branch-index.md` の「3箇所」が誤り。数える責任を寄せた先が間違っていた                          | oss-hygiene                         | 対応済み（`dee9bcd`） |
| M15 | MEDIUM | `game.md` 冒頭の「イベントが15個」が、E16 / E17 を足して17になっている                           | oss-hygiene                         | 対応済み（`dee9bcd`） |
| M16 | MEDIUM | イベント表の記号が太字でない。`### 注` の形も既存4本と違う                                       | oss-hygiene                         | 対応済み（`dee9bcd`） |

### M2 — ラウンド2で書いた反論は誤りだった

r2 では「1引数にしても `{cursor, branchPlan: cursor.forkPointers}` が通るので型では閉じない」
と書いた。閉じない理由は**引数の数ではなく第2引数が素の `ForkPointer[]` だったこと**で、
`BranchPlan` を brand し、印を付けるのを `gameReducer` だけにすれば tsc が落ちる。
`plannedCursorFrom(state.cursor, state.cursor.forkPointers)` に変異させると

```
error TS2345: Argument of type 'ForkPointer[]' is not assignable to parameter of type 'BranchPlan'.
  Property '[branchPlanBrand]' is missing
```

で止まることを実測した。「`provider.tsx` を触らずに済む」という指摘も正しい
（触るのは `types.ts` / `reducer.ts` / `cursor.ts`）。

あわせて architecture が指摘した「`provider.tsx` の3行は wt-227 の保存経路とは別の
`useMemo`」も採り、`cursorView` を `plannedCursorFrom` に寄せた。r1 / r2 で
「競合するので見送る」と2回書いた判断を撤回する。#247 は不要になったので閉じた。

### ※ M9 を見送った理由

`verify-gate.sh` を変更すると、gate 自身が `.claude/hooks/verify-gate.test.sh` の実行を
要求する。そのファイルは**別ウィンドウで未コミットのまま作業中**で、このワークツリーには
存在しない。こちらで書くとその作業と衝突する。修正内容（case に1行）は #251 に書いた。

### M10 に反論する

「`docs/` 全体へ広げてもリンクは全部 `state-transitions/` にあるので、増えたのは
リンク0本のファイルを6つ走査することだけ。誤検知の面だけが増えた」——事実は正しい。
ただし結論は採らない。

- 誤検知の面は M7 / M8 / M11 / M12 で塞いだ。残るのは「リンク記法を使っていない
  参照は見ない」ことで、これは**範囲を戻しても同じ**
- 戻すと、`docs/decisions/` に markdown リンクを書いた瞬間から検査の外に落ちる。
  いま0本なのは検査を狭める理由にならない
- 「コードスパンの参照も見る」（案 b）は、`docs/PREMISES.md` などの参照様式が
  揃っていない段階で入れると誤検知が増える

見ないものを doc コメントに明記した（「`docs/decisions/` などがパスをコードスパンで
書いている36箇所は対象外」）。false confidence の懸念はそこで受ける。

## 重複・矛盾した所見

- **H1 は3本が独立に検出。** 改名（`d573d1d`）と TSDoc 追記が同じコミットに入っていた
- **M3 / M4 / M5 は react と architecture が別の角度から同じ関数を指した。**
  react は「切り離された行の `offsetTop` が 0」、architecture は「行要素の取り方が3通り」。
  前者だけ塞ぐと後者が残るので、位置合わせを `scrollRowIntoSafeZone` に一本化して両方を消した
- **矛盾**: comment は M11 について「連番は実装しない、と書け」、robustness は
  「github-slugger と突き合わせた（170見出し / 境界21件すべて一致、重複見出しは docs に0件）」。
  robustness の実測では docs に重複が無いことになっているが、`game.md` / `app.md` の `表`、
  `branch-index.md` の `不変条件` は実際に重複している（`grep` で確認）。
  **comment 側が正しい。** 連番を実装した

## 見ていない範囲

3ラウンド続けて誰も読んでいないもの:

- **`src-tauri/`** — 差分に無いため。`game.md` の `index_builder.rs` に関する主張は r1 の読みのまま
- **`KifuForkActions.tsx` / `KifuMoveActions.tsx` / `KifuCommentNote` / `FloatingNote`**
- **`entities/kifu/lib/branchEdit.ts` の `resolveLine`**
- **実行時検証** — 全ラウンド静的な読みのみ。`closeForkMenu` のスクロールも WKWebway での実測なし
- **`KifuStreamList` のレンダリングテスト** — `KifuForkMenu` が `createPortal` と
  `useLayoutEffect` で `DOMRect` を読むので happy-dom では組みにくい。
  分岐メニューの検証が `resolveForkSelection` の単体で止まっているのはこのため

## lint / hook で強制できるもの

1. **`BranchPlan` の brand**（M2）→ 入れた。tsc が止める
2. **`computeLeafTesuu` を `PlannedCursor` に狭める**（M1）→ 入れた
3. **フェンスの入れ子・重複見出し・誤検知**（M7 / M8 / M11）→ 入れた。それぞれテストで固定
4. **`docs/**/\*.md` を verify-gate に\*\*（M9）→ #251。別ウィンドウの作業と衝突するので見送り
5. **バッククォート内の識別子が実在するかの検査**（H1 の再発防止）→ comment が提案。
   `src/**/*.ts` のコメントから `` `foo(` `` を拾って宣言の有無を見る。**今回は入れない。**
   誤検知の抑え方（外部ライブラリ名・日本語混じり）を決める作業が本体より大きい
6. **機械では防げないもの**: H2 / H3 / H4（記述と実装の一致）、M4（スクロールの所有者）、
   M6（テストコメントの根拠）

## 次ラウンドの対象

- 上の「対応済み」16件を入れた状態でラウンド4を回す
- M9 は #251、M10 は反論として残す
