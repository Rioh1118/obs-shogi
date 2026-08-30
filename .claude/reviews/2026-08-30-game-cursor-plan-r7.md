# レビュー game-cursor-plan ラウンド7

- 日付: 2026-08-30
- 範囲: `9e82875..HEAD`（ラウンド6の修正）
- 対象コミット: `6617775`
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 前ラウンド: [r1](2026-08-30-game-cursor-plan-r1.md) / [r2](2026-08-30-game-cursor-plan-r2.md) / [r3](2026-08-30-game-cursor-plan-r3.md) / [r4](2026-08-30-game-cursor-plan-r4.md) / [r5](2026-08-30-game-cursor-plan-r5.md) / [r6](2026-08-30-game-cursor-plan-r6.md)

**BLOCK 0・HIGH 1・MEDIUM 6。HIGH はラウンド6の修正が持ち込んだ退行で、react と
robustness が独立に同じものを出した。**

**S5 の直し（`state.jkf` を dep に足す）は誤りだった。** `state.jkf` は「別の棋譜になった」
信号ではなく「棋譜の中身が差し替わった」信号で、コメントの自動保存でも変わる。

## 所見

| #   | 深刻度 | 所見                                                                            | reviewer                    | 結果                              |
| --- | ------ | ------------------------------------------------------------------------------- | --------------------------- | --------------------------------- |
| T1  | HIGH   | `state.jkf` を dep にしたので、コメントの自動保存のたびに一覧がカーソル行へ飛ぶ | react / robustness — 2本    | 対応済み（`4ff1346`）             |
| T2  | MEDIUM | リンク検査の走査本体だけ `.test.ts` に残り、規則5つが何にも固定されていない     | architecture                | 対応済み（`f549e4b`）             |
| T3  | MEDIUM | 閉じの字下げの窓（開き+1〜+3）を留めるテストが無く、窓を狭める変異が全部生存    | robustness                  | 対応済み（`a1f390c`）             |
| T4  | MEDIUM | 新設モジュールの冒頭コメントに変更の経緯が入っている                            | comment / oss-hygiene — 2本 | 対応済み（`0c7d39c`）             |
| T5  | MEDIUM | コメントの「36箇所」という数え上げが既にずれていて、数え方も再現できない        | comment                     | 対応済み（T2 の書き直しで消えた） |
| T6  | MEDIUM | 書き直した #245 が、`game.md` に存在しない節名（「見ていない範囲」）を指す      | oss-hygiene                 | 対応済み（#245 を再訂正）         |
| T7  | MEDIUM | `docs/state-transitions/` へ辿り着く導線が人向けの文書に1本も無い（範囲外）     | oss-hygiene                 | issue へ（#260）                  |

### T1 — 「棋譜が変わった」と「棋譜の中身が変わった」を取り違えた

`state.jkf` が変わるのは `game_loaded` と `jkf_replaced` の2つ。`jkf_replaced` の payload は
`cloneJkf` = `structuredClone` なので毎回別の identity になる。そして
`setCommentsByCursor` は `edit(..., { forceCommit: true })` を渡すので、
**`tesuuPointer` が変わらなくても `jkf_replaced` を撃つ**（`provider.tsx:214` の早期 return を抜ける）。

`onOpenComment` はカーソルを動かさないので、「カーソルは5手目、コメントを書いているのは
80手目の行」は普通に作れる状態:

1. 一覧を80手目まで流し、その行のコメントを開く
2. 打鍵が 900ms 止まると自動保存（`KifuCommentNote.tsx:78`）
3. `jkf_replaced` → `tesuu` も `tesuuPointer` も同じまま `state.jkf` だけ identity が変わる
4. この effect が発火し `revealRow(5, false)`。`yieldToRecent=false` なので必ず撃ち、
   `dt > 120ms` なので smooth。**一覧が勝手に5手目へ戻る**
5. `FloatingNote` は capture の `scroll` でアンカーを追う（`FloatingNote.tsx:93`）ので、
   **入力中のノート自体が画面上を移動する**。打鍵を止めるたびに繰り返す

r6 以前はこの経路で deps が3つとも等しく、effect は発火しなかった。**この差分が入れた退行。**

robustness が reducer を直接叩いて、`jkf_replaced`（forceCommit 相当）の前後で
`cursor.tesuu` と `cursor.tesuuPointer` が一致したまま `Object.is(next.jkf, prev.jkf) === false`
になることを実測している。

react は併せて、r6 の依頼で確かめてほしいと書いた
「`jkf_replaced` → 120ms 以内の `closeForkMenu(te, true)`」の連鎖は**存在しない**ことを
確認した（分岐の入れ替え・削除は `onClose()` で子ポップオーバーだけを閉じ、`closeForkMenu` を
呼ばない）。心配した側は空振りで、実際の害は別経路から出た。

**直し方の判断。** 両者とも「`game_loaded` でだけ増える `loadSeq` を `GameContextState` に足す」を
提案している。採らない。`entities/game/model` は別ウィンドウが `fix/227-silent-data-loss` で
触っている最中で、型と reducer を増やすとそこと衝突する。既に state にある
`loadedAbsPath`（`game_loaded` でだけ書かれる）で足りる。`loadGame` の呼び出しは
`GameFileTreeBridge.tsx:12` の1箇所だけで、そこは `activeKifuPath` が非 null のときしか呼ばない
（読んで確認）。

取りこぼすのは**同じパスを読み直したとき**だけ。そのときカーソルは0に戻るので、
前のカーソルも0だった場合に限りスクロール位置が残る。中身が同じファイルなので害は小さい。
この限定はコメントに書く。

### T3 — 窓の内側を留めるテストが無い

`m[1].length <= fence.indent + 3` の窓を留めているのは、上限側（開き0/閉じ4）と
等号・下側（開き4/閉じ4、開き3/閉じ0）だけ。**窓を狭める変異が4つとも生存した**
（`<= indent`、`<= indent + 1`、`<= indent + 2`、`< indent + 3`。いずれも 24/24 緑）。

狭めた結果は「有効な閉じを閉じと認めない → フェンスが開きっぱなし → そのファイルの残り全部が
空行に潰れる」で、r5 の Q5・r6 の S1 と同じ「検査が黙って盲になる」。踏む markdown は
「列0で開いたフェンスの閉じが1〜3スペース字下げされている」だけで、GitHub でも prettier でも
正しく閉じて見える。

robustness は併せて、r6 で足した変異が全部殺せること、`staleUncreatedInBody` の分割で
行番号も収集も変わっていないことを `9e82875` 版と突き合わせて確認している。

### T2 — 分割が2つの走査のうち片方にしか当たっていない

「未作成」側は `staleUncreatedInBody` が本体を持つが、リンク側は判断が test の中に残っている。
そこには「フェンスの中は数えない」「スキームを飛ばす」「`#` で割る」「空パスは自分自身」
「`.md` 以外はアンカーを見ない」の5つの規則が入っていて、固定するテストが1本も無い。
**4つの変異がすべて 24/24 緑で生存**した。

`docs/` にはアンカー付きリンクも `.md` 以外を指す相対リンクも0件なので、後ろ3つの分岐は
**現時点で到達不能**。最初にアンカー付きリンクを書く人が現れた瞬間、一度も走ったことのない
コードが本番入力を受ける。

## 重複・矛盾した所見

- **T1 は react と robustness が独立に検出。** 再現手順も直し方の提案もほぼ一致した
  （`loadSeq` を足す）。私はその提案を採らず `loadedAbsPath` にする。理由は上に書いた
- **T4 は comment と oss-hygiene が独立に検出。** どちらも同じ2文を指している
- comment の「`state.jkf` の dep の理由が実際の発火条件とずれている」は T1 の直しに含める。
  dep 自体を替えるので、コメントも書き直しになる
- **矛盾なし。** T1 の直し方だけ、reviewer の提案と私の判断が分かれた

## 見ていない範囲

7ラウンド続けて誰も読んでいないもの:

- **`src-tauri/`**（差分に無い）
- **`KifuForkMenu.tsx` / `KifuForkActions.tsx` / `KifuMoveActions.tsx`**
- **`entities/kifu/lib/branchEdit.ts` の `resolveLine`**
- **実行時検証** — 7ラウンドすべて静的な読みと vitest のみ。T1 の再現手順（自動保存で一覧が飛ぶ、
  ノートが引きずられる）もコードから導いたもので、アプリでは踏んでいない
- `LiveMarkdownNote` の `onMarkdownChange` の発火頻度（自動保存が900msより詰まるか）

今回初めて読まれたもの: `FloatingNote.tsx`、`KifuCommentNote.tsx`、`provider.tsx` の
`edit` / `setCommentsByCursor`。

## lint / hook で強制できるもの

1. **T1 は機械で防げない。** `exhaustive-deps` はむしろ `state.jkf` を足す方を勧める。
   この effect の deps を守るテストは1本も無く、7ラウンドで**4回**書き換えられて毎回
   目視だけが検出手段になっている。`KifuStreamList` のレンダリングテストが組めない限り変わらない
2. **T3 はテスト1本で足りる。** CommonMark 参照実装の導入は r6 で「入れない」と判断済みで、
   この1本があれば依存を増やす理由は無い
3. **T2 は構造でしか防げない**（変異が生存することを実測済み）
4. **`.test.ts` が top-level `export` を持たないことの検査** → r6 で挙げたまま未実装。
   `stateTransitionIndex.test.ts` から `export` は消えたが、次に同じことをする人を止める仕掛けは無い
5. `docs/**/*.md` を verify-gate に（#251）/ `vp lint --deny-warnings`（r5 から）→ どちらも持ち越し

## 直した結果

T1〜T6 に対応し、T7 は #260 として送った。

- **T1** は reviewer 2本の提案（`loadSeq` を足す）を採らず、既にある `loadedAbsPath` にした。
  理由は上に書いた
- **T5** は T2 でその段落ごと書き直したので消えた。単独のコミットは無い
- **T6** は #245 の1行を「`game.md` の『埋まっていないセル』の E15 の行」に直した。コミットは無い
- **T3 / T2 の変異確認**: 窓を狭める4変異（`<= indent`、`+1`、`+2`、`< +3`）が
  足したテスト1本ですべて落ちることを実測した。T2 の5規則は変異を当てる途中で
  ツールが落ちて確認を中断し、**そのとき `.md` 判定の行が消えたまま残っていたのを戻した**。
  リンク側5規則の変異確認は**やっていない**（ユーザーの指示でここに時間を掛けるのをやめた）

`npm run verify` 通過（23ファイル / 249テスト）。

## ラウンド8の対象

- 上の状態で回す。**まだ所見ゼロのラウンドは出ていない**
- ただし7ラウンドのうち直近3ラウンドは、所見の多くが `docs` 検査の道具立て
  （`stateTransitionIndex.*`）に集中している。ラウンド8は**実ロジック側**
  （`KifuStreamList` / `entities/game` / `entities/kifu`）に寄せる
