# レビュー cursor-vocabulary ラウンド1

- 日付: 2026-08-30
- 範囲: `git diff main...HEAD`（25ファイル / +652 -364）
- 対象コミット: `a4996e6`
- 走らせた reviewer: architecture / comment / robustness / react / perf
  （ui と rust は範囲に `.scss` も `src-tauri/` も無いので走らせていない）

## 所見

### BLOCK

**B1 [robustness] `GameState.error` はどこからも描画されていない**

`state.error` を書く側は `provider.tsx` に10箇所、読む側は `src/` 全体で0件。
保存失敗もコメント書き込み失敗も「保存済み」と表示される。

**この差分の外**（main と同じ）。既に open な #227「コメントの保存が失敗しても
『保存済み』と出て、書いた本文が消える」がまさにこれで、`/implement` の指示で
この PR に混ぜないと決めてある。→ **直さない。#279 のコメントへ送る。**

ただしこの PR の失敗経路（`advanceWithPlan` の throw、`applyCursor` の catch）は
すべてここへ流れ込むので、記録として残す。

### HIGH

**H1 [comment, robustness の2名] `advanceWithPlan` の doc「例外を投げない」が偽**

`advanceWithPlan.ts:47`。`player.forward()` は `doMove` → `shogi.js` を通るので、
盤上で再生できない手に当たると投げる。robustness reviewer が実際に再現した
（`THREW from advanceWithPlan: no piece found at 5, 5`）。

**これは ADR-0003 のレビュー r1〜r4 で4ラウンド続いた故障そのもの**
（「コメントに書いた理由が、実装している条件と違う」）。しかも doc が
「レンダ中の走査から呼べる」と名指ししている `buildStreamRows` の呼び出し側
（`KifuStreamList.tsx:64`）に try が無い。

`forward()` が投げること自体は main と同じ。**新しいのは偽の契約を書いたこと**と、
旧 `buildStreamRows` にあった「ここはレンダ中なので拾わないと棋譜ペインごと落ちる」
という注記を消したこと。→ **doc を直す。**

利用者への復帰導線（壊れた棋譜でも読める手まで出す）は別の変更 → issue。

**H2 [comment] `docs/state-transitions/game.md` の R3 / R4 と不変条件4 がこの変更で偽になった**

`:209` `:215-216` `:220` `:248` `:262` と `※1`（`:128-134`）。
「`nextMove` / `goToEnd` は壊れた `forkIndex` を捨てない」「負・非整数は `TypeError`」
「線の末尾+1 に計画が残ると throw」は、`advanceWithPlan` に寄せた結果すべて偽。
`:3` `:270` が指す `src/entities/game/lib/cursor.ts` は削除済み。

**自分が作った腐り。** → 直す。

**H3 [comment] `docs/state-transitions/branch-index.md:81-86` が「5箇所に散っている」と言い続けている**

挙げられている5箇所は全て `advanceWithPlan` に寄った。`→ #213` も残っている。
**自分が作った腐り。** → 直す。

### MEDIUM

| #   | reviewer     | 所見                                                                                                                             | 扱い     |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| M1  | architecture | `cursorFromLite` が組む `tesuuPointer` に読み手が0件。しかも自分で書いたコメントが「コメント欄の開閉判定が読む」と嘘を言っている | 直す     |
| M2  | robustness   | `resolveLine` の doc の `uptoTe` の渡し方が誤り。そのとおり書くと変化の中で本譜の手を返す（再現済み）                            | 直す     |
| M3  | comment      | `advanceToLeafWithPlan` が 10001 回回る。`goto` の上限は 10000。doc の「葉に着かないとき」も偽（自分で再現確認）                 | 直す     |
| M4  | comment      | `player` 統一の取りこぼし: `sim`（leafTesuu / PositionNavigationModal / buildNextOptions）・`viewer`・`jkfPlayer`                | 直す     |
| M5  | comment      | `PlanIndex` / `indexPlan` の `Index` が `BranchIndex`（添字）と衝突。`PlanStep` は計画の要素に読める                             | 直す     |
| M6  | comment      | `comment.ts` の公開2関数に TSDoc が無い（破壊的書き換え・`ok`/`changed` の別・改行の分解が doc に無い）                          | 直す     |
| M7  | comment      | `lastMovePlayer` は player を返さない。`player` を JKFPlayer 専用にした直後にこの名前は読み違える                                | 直す     |
| M8  | comment      | `gotoPreview` は渡した player を動かさない。`goto` は repo 内で「その player を動かす」意味                                      | 直す     |
| M9  | comment      | `NavigationState.PreviewCursor` だけ PascalCase                                                                                  | 直す     |
| M10 | comment      | `cursorSelection.test.ts:157-158` のコメントが、実在しなくなった検査の置き場を名指し                                             | 直す     |
| M11 | react        | `handleConfirm` が `unreachable` と同じ判定を独立に作り直している（判定の真実の源が2つ）                                         | 直す     |
| M12 | architecture | `PositionSearchContinuation` の `indexPlan(cursor.forkPointers)` は必ず空振りする（索引のカーソルは `te <= tesuu`）              | 直す     |
| M13 | architecture | `cursorRuntime.ts` が名前どおりの中身でない。計画の代数が3ファイルに割れた。`branchEdit` / `branchPlanEdit` は1語違い            | 直す     |
| M14 | architecture | `buildTesuuPointer` が `model/branch.ts` にある。規約を書いた `cursor.ts` に無い                                                 | 直す     |
| M15 | architecture | コメント経路（`types.ts` の `getCommentsByCursor` / `setCommentsByCursor`）だけ `KifuCursor` のまま                              | 一部直す |
| M16 | architecture | 「te の選択を書き換えて先を捨てる」が `branchPlanEdit` / `cursorSelection` / `branchEdit.setBranchIndex` の3実装                 | 直す     |

## 重複・矛盾した所見

**H1 は comment と robustness の2名が独立に挙げた。** 深刻度も一致（HIGH）。
robustness 側だけが実際に再現まで持っていったので、そちらの再現手順を採る。

**M1 と robustness の「`applyCursor` から `tesuuPointer` を落としたことで
『同じ手数で別の線に着いた』の検出手段が消えた」は互いに逆を向いている。**

- architecture: `cursorFromLite` の `tesuuPointer` は誰も読まないので落とせ
- robustness: 落とすな。索引が古いと利用者は別の局面を見せられる。検出に使え

**判断**: architecture を採る。robustness が言う検出は**現物に存在しない**
（`applyCursor` は main の時点でも `tesuuPointer` を読んでいなかった）ので、
「落とすと壊れる」のではなく「新しく作れ」という提案。それはこの PR の範囲外の
UX の追加であり、`/implement` 手順7の「範囲の外にある → issue を立てる」に当たる。
`cursorFromLite` は `CursorPath` を返す形に狭め、検出は issue にする。

## 見ていない範囲

- `src-tauri/`（差分に1行も無い）。ただし `search/index_builder.rs:112-115` は
  M12 の根拠として `fork_pointers` の生成規則だけ読んだ（`te > tesuu` を積まない）
- SCSS / レイアウト / キーボード操作 / フォーカス管理
- 実アプリを起動しての動作確認
- `docs/state-transitions/` のうち `game.md` / `branch-index.md` 以外
- コメント文字列の描画（`LiveMarkdownNote`）。`dangerouslySetInnerHTML` が
  `src/` に0件であることだけ確認

## lint / hook で強制できるもの

- **doc 中のファイルパスの存在検査**。`docs/**/*.md` のバッククォート内で `src/` から
  始まる文字列を拾い、実在しなければ落とす。H2 の `game.md:3` `:270` はこれで止まる
- **`interface` の property が camelCase**。M9 はこれで止まる
- **レンダ中の `useMemo` から `@throws` を持つ `entities/kifu/lib` の関数を裸で呼ぶこと**を
  `no-restricted-imports` で止める案（H1）。ただし対象の切り分けが粗く、
  two-strikes rule に照らすと**まだルールを足す段階ではない**
- 「コメントが名指ししている関数の役割が変わった」（M10）は機械では止まらない

## 次ラウンドの対象

直す順（1所見1コミット）:

1. H1 → H2 → H3（嘘の doc。コードより先に）
2. M3（off-by-one）→ M2（`resolveLine` の doc + テスト）
3. M5（命名）→ M4（`player` 統一）→ M7 → M8 → M9（改名）
4. M14 → M13（置き場）→ M16 → M1 → M15
5. M12 → M11 → M6 → M10

**直さないもの**:

- **B1** → #227 が open。`/implement` の指示で混ぜないと決めてある
- H1 の「壊れた棋譜でも読める手まで出す」復帰導線 → 新しい UX。issue
- M1 の裏（索引が古いときの食い違い検出）→ 新しい UX。issue
- M15 のうち `KifuCommentNote.cursorToStableKey` の除去 → #227 が触っている
  ファイルなので、型を狭めるところまでに留める
