# レビュー: #169 ファイル操作の失敗を出す — ラウンド5

- 日付: 2026-08-30
- ブランチ: `fix/169-file-tree-error`
- 範囲: ラウンド4 の対応（`8bad80e..10930c1`）以降に動いた全て
- 観点: architecture / react / ui / robustness / rust / comment / oss-hygiene（7観点、並列）
- 前のラウンド: [r4](./2026-08-29-file-tree-error-r4.md)

## このラウンドの狙い

ラウンド4 では、私（実装側）が入れた修正が新しい退行を**6件**生んでいた。
7つの reviewer それぞれに「**今回もそれを疑って見てほしい**」と明示し、
ui には「主張と実物の突き合わせ」（コミット本文が主張した変更が差分に入っているか）を
追加で頼んだ。

結果、**BLOCK 2 / HIGH 19 / MEDIUM 29**。
うち **5件は r4 の修正が直接の原因**。

---

## BLOCK

### B-1: ルートフォルダの改名が、このブランチが足した関門で必ず失敗する

- 検出: robustness
- 場所: `src-tauri/src/file_system/mv.rs` の `rename_directory`
- 内容: `rename_directory` に root 配下の関門を足したとき、行き先にも掛けた。
  ワークスペース自身を改名すると行き先は root の**兄弟**なので、定義上どうやっても通らない。
  ルート行 → Rename → Enter で `invalid_path` が返り、入力欄ごと畳まれて打った名前が消え、
  「その場所は扱えません」という**理由の違う**文言が出る。`main` では通っていた操作。
  `provider.tsx` の `isRootRename` の分岐も到達不能になっていた。
- **対応**: `is_project_root` で分岐して関門を外す（`7575b81`）。
  行き先は `parent.join(validate_basename(name))` なので root の親の直下から出ない。

### B-2: 編集行を畳む理由が、同じブランチの修正で成立しなくなっている

- 検出: comment
- 場所: `src/entities/file-tree/model/reducer.ts` の `case "error"`
- 内容: 「開いたままだと blur で同じ名前が送り直される」と書いてあったが、その経路は
  `InlineNameEditor` の `inFlightRef` / `rejectedRef` が既に塞いでいる。
  さらに「名前以外の失敗が入力欄に出ないのは、ここで畳むため」も誤りで、
  絞っているのは `commitName`。`commitName` 側は逆に「reducer が畳むので二重に出る」と
  書いており、**2つのコメントが互いを根拠にして、どちらの根拠も現物に無い**。
- **対応**: reducer の理由をいま生きているものだけに書き直し（`195e647`）、
  `commitName` の理由も直した（`56b2b8a`）。

---

## HIGH

| #    | 検出                                | 内容                                                                                                        | 対応      |
| ---- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------- |
| H-1  | react / robustness                  | **r4 の修正が原因。** 衝突の対話が開いている間の読み直しの失敗を reducer が捨てる                           | `195e647` |
| H-2  | react / robustness / architecture   | **r4 の修正が原因。** `FloatingNote` が毎レンダで重なりへ積み直し、上のモーダルから Escape と閉じ込めを奪う | `dc1f199` |
| H-3  | robustness / comment                | **r4 の修正が原因。** `asyncResultUse` の名前収集が改行をまたげず、provider の主要6関数が対象外             | `789a560` |
| H-4  | robustness / rust                   | `get_file_tree` の関門を先に置いたことで、ルート消失が `not_found` でなくなり再読み込みが消えた             | `dc920f4` |
| H-5  | robustness / ui                     | 失敗の箱が `pointer-events: none` なので、`title` に逃がした全文が**絶対に出ない**                          | `5a20185` |
| H-6  | rust / comment / oss / architecture | `root_guard` の doc が範囲を過大に主張。実際は `src/file_system/` 直下だけ                                  | `d44f5a0` |
| H-7  | comment                             | `commentHistory` が `src-tauri/tests/` を見ていない（r4 の違反の引っ越し先）                                | `0e5d86b` |
| H-8  | comment                             | `pushOverlay` の TSDoc が存在しない戻り値と関数名を指す                                                     | `dc1f199` |
| H-9  | comment                             | `deleteNode` の読み直しコメントが、この関数が触っていない ref を挙げる                                      | `9229ab0` |
| H-10 | comment                             | `contrast.ts` の TSDoc が隣の関数に付いている（r4 M-7 と同じ形の再発）                                      | `99129a7` |
| H-11 | comment                             | `mv.rs` 冒頭の「唯一のコマンド群」がどちらも事実でない                                                      | `dc920f4` |
| H-12 | comment                             | `file-tree.md` の表が `invalid_extension` を落としたまま                                                    | `e4f749d` |
| H-13 | rust                                | `get_file_tree` の走査が symlink を辿って root の外へ出る                                                   | `946af76` |
| H-14 | rust / comment                      | `mv.rs` の `src` 側に存在オラクル。同じファイルの中に相反する2つの規則                                      | `dc920f4` |
| H-15 | oss                                 | `F-12a` / `F-12b` が採番元に存在しない（r4 の書き戻しが事実でなかった）                                     | `e4f749d` |
| H-16 | oss                                 | append-only の境界が3文書で食い違う。この PR 自身の編集を許していない                                       | `e4f749d` |
| H-17 | ui                                  | ツリーの失敗の逃げ道がサイドバー幅であふれ、開始側へ欠けて到達できない                                      | `65795c5` |
| H-18 | ui                                  | コンテキストメニューが viewport に収まらず、下端の3行で Delete が押せない                                   | `65795c5` |
| H-19 | architecture                        | `PositionNavigationModal` の `window` keydown が Tab の既定動作まで消す                                     | `e6306bc` |

## MEDIUM

| #    | 検出                   | 内容                                                                         | 対応                              |
| ---- | ---------------------- | ---------------------------------------------------------------------------- | --------------------------------- |
| M-1  | react / robustness     | 送信中の blur が `rejectedRef` の手前をすり抜け、行き止まりが残る            | `5a20185`                         |
| M-2  | react                  | 送信中の `FileConflictDialog` に押せる要素が0。失敗しても欄へ戻らない        | `65795c5`                         |
| M-3  | react                  | `Modal` の復帰先が `<body>` になる経路が2つ                                  | `65795c5`                         |
| M-4  | react                  | Escape の受け口が3つ。`Modal` がキャプチャ段なので内側が先に使えない         | `e6306bc`                         |
| M-5  | robustness             | `mv.rs` の順序の理由が、同じ crate の5コマンドで成立していない               | `dc920f4`                         |
| M-6  | rust                   | `save_config` が `root_dir` を無検証で受けるので、関門の脅威モデルが閉じない | doc を訂正（`dc920f4`）＋ #215 へ |
| M-7  | rust                   | `root_guard` の切り出しが、後ろの別関数の呼び出しを本体と数える              | `d44f5a0`                         |
| M-8  | rust                   | `root_guard` がブロックコメントを落とさない                                  | `d44f5a0`                         |
| M-9  | rust                   | `root_guard` の下限が現在値ちょうど。名前が `pub fn ` 決め打ち               | `d44f5a0`                         |
| M-10 | rust                   | `kifu.rs` の `TODO(#215)` が話題の関数から辿れない位置                       | `2600bbf`                         |
| M-11 | comment / architecture | `walk.ts` の「1箇所で決める」が、置いた同じラウンドで成立していない          | `0e5d86b`                         |
| M-12 | comment / oss          | `CONTRIBUTING` の検査の表が実数と逃げ道に合っていない                        | `e4f749d`                         |
| M-13 | comment                | `MEASURED_FLOOR` / `UNMEASURED_CEILING` の名前が判定（完全一致）と違う       | `99129a7`                         |
| M-14 | comment                | `modalTypes` が `=== "x"` の綴りを強制していることが書かれていない           | `99129a7`                         |
| M-15 | comment                | `HISTORY_WORDS` の `旧 ` が日本語の綴りに当たらない（一致0件）               | `0e5d86b`                         |
| M-16 | comment                | 同じハンドラが `handleCommitRename` と `handleCommit` の2つの名前            | `56b2b8a`                         |
| M-17 | comment                | `renameNode` のルート改名だけ読み直しをしない理由が無い                      | `9229ab0`                         |
| M-18 | oss                    | `failure-surfacing` §1 が、同じ脚注の中で件数を書きながら禁じている          | `e4f749d`                         |
| M-19 | oss                    | `OPERATING-MODEL` §5 が1か月前の Now を「今の状態」として出す                | `e4f749d`                         |
| M-20 | oss                    | 未追跡の `.probe-tmp/` を vitest が本物のテストとして収集していた            | `b122a8a`                         |
| M-21 | oss                    | r4 の書き戻しが #216 を無言で落としている                                    | `e4f749d`                         |
| M-22 | oss                    | `file-tree.md` が存在しない `ConflictDialog` を使い続けている                | `e4f749d`                         |
| M-23 | oss                    | `CONTRIBUTING` の意味色の表が、内容の合わない issue を指している             | `e4f749d`                         |
| M-24 | ui                     | `Modal` の `padding` 軸が全ての組み合わせで何もしていない                    | `6f47a21`                         |
| M-25 | ui                     | `UNMEASURED_COUNT` の中に、実際に基準を割っている組が3件                     | `e5d3bca`                         |
| M-26 | ui                     | `.fsError__raw` が「外は見える／内は見えない」の入れ子                       | `6f47a21`                         |
| M-27 | architecture           | `entities/file-tree` の barrel が `export *` で公開面が黙って広がる          | `99129a7`                         |
| M-28 | architecture           | `commitName` を `entities` へ下げたのに、不変条件だけ widgets に5部コピー    | `56b2b8a`                         |
| M-29 | architecture           | Rust の `tests/` と `#[cfg(test)]` の使い分けが言語化されていない            | `e4f749d`                         |

## 範囲の外へ送ったもの

| 内容                                                                                     | 送り先                                                                                           |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 塗り順の直値10種類。モーダルの上に破壊的操作が残る                                       | [#229](https://github.com/Rioh1118/obs-shogi/issues/229)                                         |
| × ボタン・処理中の見せ方・スクロールバーの規則が無い                                     | [#230](https://github.com/Rioh1118/obs-shogi/issues/230)                                         |
| 棋譜形式の集合が4箇所 / JKF 変換が3実装 / `TesuuPointer` の brand / `ModalType` の置き場 | [#231](https://github.com/Rioh1118/obs-shogi/issues/231)                                         |
| `save_config` が `root_dir` を無検証 / `open_project` の root                            | [#215](https://github.com/Rioh1118/obs-shogi/issues/215) にコメント                              |
| ツリーの再レンダ / パスヘルパ4本 / barrel の適用範囲                                     | [#216](https://github.com/Rioh1118/obs-shogi/issues/216)（コードから `TODO` で辿れるようにした） |

## 自分が作った退行（5件）

r4 で入れた修正が、そのまま新しい失敗になっていた。

1. **`await` に戻したことで、読み直しが `conflict` の窓の中に入った**（H-1）。
   `void` だった頃は読み直しの失敗が対話を閉じた後に着地していたので通知に出ていた。
   r4 の書き戻しは M-12 を「H-1 で待つように戻したので交差しなくなった」としたが、
   **待つように戻したことで、ガードの効いている窓の中に入った**。逆向きの評価をしていた。
2. **重なりの順序を集めたのに、積み降ろしの書き方を集めなかった**（H-2）。
   4つの呼び出し側が同じ effect を手書きし、1つが依存にハンドラを入れた。
   `Modal` が無事だったのは deps が `[]` だったからで、規約ではなく偶然。
3. **`AsyncResult` の検査が、この repo の主流の書き方を見ていなかった**（H-3）。
   r4 で `void f()` の穴を塞いだが、名前を集める側が改行をまたげず、
   `provider.tsx` の主要6関数が最初から対象外だった。**2ラウンド続けて同じ形。**
4. **関門を先に置いたことで、ルート消失の code が変わった**（H-4）。
   同じブランチの `FileTreeErrorNotice` の doc と `FileTree.test.tsx` のスタブは
   `not_found` を前提にしたままで、実物では成立しない状態を固定していた。
5. **失敗の箱の逃げ道が成立していなかった**（H-5）。
   「1行に切って全文は `title` で読める」と書いたが、`pointer-events: none` の要素は
   ヒットテストの対象外なのでツールチップは出ない。

r4 の書き戻しの事実誤りも1件（H-15: `F-12a` / `F-12b` を「採番した」と書いたが差分に無い）。
**書き戻しは3ラウンド続けて外している。**

## 詰まったところの解き方

Modal と入力欄の表示ロジックは、事実（誰がいつ何を聞くか）と解釈（どうあるべきか）が
混ざって進まなくなったので、**状態遷移表を起こしてから直した**。

- `docs/state-transitions/inline-name-editor.md`（新設）

表にして初めて「E2（送信中）の blur」が4ラウンド空欄だったことが見えた。
そこが M-1 の行き止まり（フォーカスの無い欄に失敗の箱だけが残る）の正体だった。
失敗の箱の見せ方も、表の下に「重ねる形は2つとも成立しない」と選択肢を並べて決めた。

## 検証

- `npm run verify` — 緑（33ファイル / 283件）
- `npm run build` — 緑
- `npm run verify:rust` — 緑（ベンチを除く `#[test]` は 10件）

変異を当てて落ちることを確認したもの:

- `root_guard`（`kifu.rs` の関門を消す → 落ちる。**以前の形では通っていた**）
- 重なりの順序（毎レンダ積み直す形に戻す → hook のテストと Modal のテストの両方が落ちる）
- Escape の段（キャプチャに戻す → 内側が Escape を使うテストが落ちる）
- 送信中の blur（印を消す → 閉じるテストが落ちる）
