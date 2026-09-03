# レビュー game-cursor-plan ラウンド4

- 日付: 2026-08-30
- 範囲: `60ddde4~7..HEAD`（ラウンド3の修正）
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 前ラウンド: [r1](2026-08-30-game-cursor-plan-r1.md) / [r2](2026-08-30-game-cursor-plan-r2.md) / [r3](2026-08-30-game-cursor-plan-r3.md)

**react は「無し」。** 5本のうち初めて所見ゼロの reviewer が出た。
残り4本で BLOCK 1・HIGH 4・MEDIUM 9。**ほぼ全部が「ラウンド3の実装修正に docs が追いつかなかった」**か、
**「ラウンド3で入れた検査自身の欠陥」**。

## 所見

| #   | 深刻度 | 所見                                                                                   | reviewer                           | 結果                     |
| --- | ------ | -------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------ |
| P1  | BLOCK  | `game.md` 冒頭と「2つの値」表が brand 導入前のままで、閉じた #247 を指している         | comment / oss-hygiene / robustness | 対応済み（`202d025`）    |
| P2  | HIGH   | `※1` の再現手順（`deleteBranch` で枝を消す）が、同じ表の E13 / W6 と正面から矛盾する   | oss-hygiene                        | 対応済み（`202d025`）    |
| P3  | HIGH   | E16 の帰結から、いちばん重い喪失（前の棋譜が新しいファイルへ書かれる）が抜けている     | robustness                         | 対応済み（`202d025`）    |
| P4  | HIGH   | `asBranchPlan` の「呼んでよいのは `gameReducer` だけ」が、書いた時点で既に偽           | comment                            | 対応済み（`8c6958d`）    |
| P5  | MEDIUM | `game.md` の行番号参照 約20件が `ce14537` / `8c6958d` で一括ずれ。4件は空行を指す      | robustness / comment / oss-hygiene | 対応済み（`202d025`）    |
| P6  | MEDIUM | 「未作成」検査がリンク形を見逃す。test1 と噛み合って穴を作っている                     | oss-hygiene                        | 対応済み（`aada381`）    |
| P7  | MEDIUM | `stripFences` がリスト内の字下げフェンスを見ない                                       | robustness                         | 対応済み（`aada381`）    |
| P8  | MEDIUM | `BranchPlan` の印付けが reducer 側にあり、state に計画が入る入口は素通り               | architecture                       | 対応済み（`8c6958d`）    |
| P9  | MEDIUM | 行 id `kifu-row-${te}` が2ファイルに手書きで、片方を変えると自動スクロールが黙って死ぬ | architecture / comment             | 対応済み（`8c6958d`）    |
| P10 | MEDIUM | `scrollRowIntoSafeZone` と `scrollToRowSafeZone` が語順違いの別物で、1行に両方出る     | comment                            | 対応済み（`8c6958d`）    |
| P11 | MEDIUM | `dt < 120` が2つの判断に使われているのに、TSDoc は片方しか説明していない               | comment                            | 対応済み（`8c6958d`）    |
| P12 | MEDIUM | E16 を限定した結果、`file-tree.md:5` の案内が読み手を往復させる                        | oss-hygiene                        | 対応済み（`202d025`）    |
| P13 | MEDIUM | `failure-surfacing.md` の運用規則が、唯一の適用例をカバーしていない                    | oss-hygiene                        | 対応済み（`202d025`）    |
| P14 | MEDIUM | 太字化の掛け残し（`E9` だけ太字）と、E15 が注の形を取っていない                        | oss-hygiene                        | 対応済み（`202d025`）    |
| —   | —      | docs だけのコミットで verify-gate が素通し                                             | robustness（r3 から継続）          | #251（別ウィンドウ待ち） |

### P8 — 印を「受け取る所」から「作る所」へ

r3 で入れた `BranchPlan` は `plannedCursorFrom` の第2引数だけを守っていた。
`reducer` が届いた配列を無条件に `asBranchPlan` していたので、**state に計画が入る入口は素通り**。
`dispatch({ type: "navigated", payload: { cursor, branchPlan: cursor.forkPointers } })` が
型を通り、#225 と同じ壊れ方に戻せた。

`mergeBranchPlan`（`te > tesuu` を持ち越す唯一の関数 = 生産者）の戻り値を `BranchPlan` にし、
`GameAction` の payload も `BranchPlan` にした。捨てる3経路は `asBranchPlan(...)` を
呼び出し側に明示的に書く形にしたので、**捨てた場所がコードから数えられる**。
変異（dispatch に `nextCursor.forkPointers` を渡す）で `TS2322` が出ることを実測した。

### P5 — 行番号を書くのをやめた

`ce14537` が `provider.tsx` の import を1行足し `cursorView` の6行を1行に畳んだ結果、
`game.md` の `provider.tsx:NNN` が全部 −4 ずれた。`clear_error` の6箇所のうち3件は空行を指していた。

**4を引いて直すのは採らない。** 次の refactor で必ず再発し、その腐りは何のテストも落とさない。
行番号を落として関数名（`loadGame` の `catch`、`navigate` → `navigated`、
`cursorView` → `computeLeafTesuu`）で指す形にした。表が言いたいのは
「どの関数が何をしているか」で、行番号はその代用でしかなかった。

### P3 — E16 の帰結

`kifu_opened` は `activeKifuPath` を**先に**更新し、`GamePersistenceGate` はそれを見て
`persistence` を組み直す。`loadGame` が落ちても `state.jkf` は前の棋譜のまま。
つまり「盤には A、保存先は B」の状態になり、この後に1手指すと **A の内容が B のファイルへ書かれる**。
r2 の G4 でわざわざ足した E2 の喪失セルより重い。

## 重複・矛盾した所見

- **P1 は3本が独立に検出。** r1 の F1（表が修正前の挙動を書いている）と同じ形の3回目。
  今回は「実装コミットの後に docs コミットを書いたのに、冒頭を見直さなかった」
- **P5 も3本。** 行番号の腐りは書いた本人には見えない
- **矛盾**: oss-hygiene は「未作成」検査を「表のセル（`|`）と文（`。`）で区切れ」と提案したが、
  **`|` で区切ると在庫表が壊れる**。`| [game.md](game.md) | ❌ 未作成 |` は名前と状態が
  別のセルにあり、区切ると共起しなくなって見逃す。`。` だけで区切る形にし、5つの書き方を
  テストで固定した
- **矛盾**: robustness は「github-slugger と突き合わせて重複見出しは docs に0件」と r3 で
  報告していたが、r4 では言及なし。r3 で確認したとおり `表` / `不変条件` は重複しているので、
  連番の実装は維持する

## 見ていない範囲

4ラウンド続けて誰も読んでいないもの:

- **`src-tauri/`**（差分に無い）
- **`KifuForkMenu.tsx` / `KifuForkActions.tsx` / `KifuMoveActions.tsx` / `KifuCommentNote`**
- **`entities/kifu/lib/branchEdit.ts` の `resolveLine`**
- **実行時検証** — 全ラウンド静的な読みのみ

範囲外だが目に入ったもの（所見に立てず）:

- `features/position-search/ui/PositionSearchContinuation.tsx` に「計画に沿って1手進める」の
  3本目が手書きされており、他2本にある `Number.isInteger` / `>= 0` の防御だけが無い（#213 の材料）

## lint / hook で強制できるもの

1. **`BranchPlan` を生産者側で brand**（P8）→ 入れた
2. **行 id の定数化**（P9）→ 入れた。tsc が対応を保証する
3. **「未作成」検査と字下げフェンス**（P6 / P7）→ 入れた。それぞれテストで固定
4. **`docs/**/\*.md` を verify-gate に\*\* → #251。別ウィンドウの作業と衝突するので入れられない
5. **`path:NNN` 参照の検査** → 入れない。**行番号を書かない**方が安いので、そちらを採った
6. **閉じた issue 番号への参照検査** → ネットワークが要るので `verify` 向きでない。入れない

## 次ラウンドの対象

- 上の14件を入れた状態でラウンド5を回す
