# レビュー: #169 ファイル操作の失敗を出す — ラウンド7

- 日付: 2026-08-30
- ブランチ: `fix/169-file-tree-error`
- 範囲: ラウンド6 の対応（`4c090e4..58ae56f`）以降に動いた全て
- 観点: architecture / react / ui / robustness / rust / comment / oss-hygiene（7観点、並列）
- 前のラウンド: [r6](./2026-08-29-file-tree-error-r6.md)

## このラウンドの狙い

ラウンド4・5・6 と3回続けて、私の修正が新しい退行を生んでいた。7つの reviewer 全部に
「**今回もそれを疑って見てほしい**」と明示し、そのラウンドで入れたばかりの装置
（`escapeReceivers` / `useOverlayLayer` / `reload_failed` / `onUnshowable` / `root_guard`）を
名指しで疑わせた。

結果、**BLOCK 4 / HIGH 12 / MEDIUM 27**。

**4件の BLOCK は全部、ラウンド6 で私が入れた修正が原因。**

---

## BLOCK

### B-1: 自分を指す symlink1本でプロセスごと落ちる

- 検出: robustness
- 場所: `src-tauri/src/file_system/tree.rs`
- 内容: ラウンド6 で「root の中で閉じた symlink は残す」に変えたとき、止める仕掛けを
  1つも入れなかった。ワークスペース直下で `ln -s . current` を1回打つだけで走査が
  無限に降り、**スタックオーバーフローで abort する**。Rust のそれは `catch_unwind`
  できないので `get_file_tree` は `Err` すら返せず、起動のたびに無言で落ちる。
  ダイアログもログも出ないので、利用者は自力で原因に辿り着けない。
- **対応**（`a765bbd`）: 深さの上限と、辿った symlink の解決先の集合を持つ。
  上限だけだと、そこまでの段が全部複製されたツリーが返る
  （root 自身を指す symlink1本でワークスペース全体の33コピー）。
  `ws/self -> .` を作って有限時間で返ることを見るテストを足した。

### B-2: 起動直後のワークスペース改名が、設定を更新しない

- 検出: react / oss-hygiene / robustness（独立に3件）
- 場所: `src/entities/file-tree/model/provider.tsx` の `renameNode`
- 内容: ラウンド6 で root 判定の入力を `rootDir` から `state.fileTree` へ替えたのに、
  **依存配列を替えなかった**。この `useCallback` は起動直後に固定され、そのとき
  `state.fileTree` はまだ `null`。ツリーが出たあと、どのノードも選ばずに
  ワークスペースを改名すると `setRootDir` を通らず、ディスク上だけ改名されて
  設定は古いパスを指したまま残る。再起動しても開けない。
  **ラウンド6 で直したはずの症状に、依存配列を通って戻っていた。**
- **対応**（`a765bbd`）: 依存を直し、`react-hooks/exhaustive-deps` を warn から
  **error** へ上げた。この2件はリポジトリ唯一の警告で、warn のままだと
  `npm run verify` が通ってしまう。実際この直後、`setRootDir` の対応で
  入れた依存漏れをその場で拾った。

### B-3: Rust 側2箇所のコメントが、UI の現物と真逆のことを根拠にしている

- 検出: comment
- 場所: `src-tauri/src/file_system/operations.rs`、`src-tauri/tests/root_guard.rs`
- 内容: 「UI 側の判定は設定の文字列と canonicalize したパスを比べているので
  symlink で一致しない」を Rust の重ね掛けの理由として書いたが、**UI はもう
  ツリーの根と比べている**（同じラウンドで直した）。しかも同じ塊が2ファイルに
  写っているので、片方だけ直しても残る。
- **対応**（`b526df4`）: 理由を現在のもの（取り消せない操作を UI の判定だけに預けない）へ
  書き直し、片方は参照に縮めた。

### B-4: 状態遷移表が、実装が持っていない保証を書いている

- 検出: comment / oss-hygiene / robustness
- 場所: `docs/state-transitions/inline-name-editor.md`
- 内容: 「unmount する経路では `onUnshowable` が呼ばれるので通知には出る」と書いたが、
  そのフラグを立てるのは `onBlur` だけで、**DOM から外れても blur は発火しない**。
  実際に通知へ出しているのは provider の `pushError`。「埋まっていないセル」を
  明示する場所に誤った安心を書くと、そこを塞ぐ人がいなくなる。
- **対応**（`b526df4`）: 呼ばれないことと、なぜ出るのかを書き直した。

---

## HIGH

| #    | 検出                         | 内容                                                                                                      | 対応                                                                                       |
| ---- | ---------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| H-1  | react / comment / arch / oss | `escapeReceivers` が JSX のインライン矢印関数しか見ていない。ラウンド6 で直した `TagsInput` は走査対象0件 | `1092a77`（`"Escape"` を含む関数本体を波括弧の対応で切り出す。名前付きハンドラで変異確認） |
| H-2  | rust                         | `is_move_into_itself` が字面の比較で、symlink を挟むと素通りする                                          | `a765bbd`（両側を canonicalize。実 symlink のテストを追加）                                |
| H-3  | rust                         | `EXTRA_GUARDS` のコマンド名だけ実在検査から漏れ、綴り違いで無効になる                                     | `1092a77`                                                                                  |
| H-4  | rust / comment               | 順序検査が「最初の1件」しか見ず、パスを2本受けるコマンドで2本目を後ろへ動かしても緑                       | `a765bbd`（位置の比較をやめ、`validate_under_root(&app, &x)` の `x` ごとに見る）           |
| H-5  | rust / arch                  | 関門が読む設定ファイルの**置き場**が手書きで、`config_dir` 側を変えると全パスで開く                       | `1092a77`                                                                                  |
| H-6  | arch                         | `sliceBarrels` が `export type { … } from` を再エクスポートと認識しない                                   | `1092a77`（認識させると9ファイルが出るので barrel 経由へ寄せた）                           |
| H-7  | robustness / react           | 操作の失敗から再読み込みして失敗すると「操作は完了しましたが」に化ける                                    | `1e0d890`                                                                                  |
| H-8  | react                        | blur が最初の確定になる経路で、失敗の箱がフォーカスの無い欄に残る                                         | `1e0d890`                                                                                  |
| H-9  | robustness                   | ルート改名後に `setRootDir` が失敗すると、押せるものが0の画面で止まる                                     | `1e0d890`（成否を返す形にして通知へ積む）                                                  |
| H-10 | ui                           | 送信中の `:read-only` を `opacity` で薄めており 3.84:1                                                    | `571b6d3`                                                                                  |
| H-11 | ui                           | 行が伸びると行操作のボタンが失敗の箱の横に出る（r6 H-9 が `__main` の中で止まっていた）                   | `571b6d3`                                                                                  |
| H-12 | oss                          | **r6 の書き戻しに事実でない記述が2件**                                                                    | `b526df4`（下記）                                                                          |

## MEDIUM（27件）

主なもの。対応にコミットを併記する。

- **rust**: `AppConfig` に `#[serde(default)]` が無く、フィールドを足すと既存の
  `app.json` が全滅（`6be0625`）／`load_root_dir` の失敗に `app.json` の名が無い（`6be0625`）／
  `tree.rs` の `TODO(#215)` が失敗の形を取り違えている（`6be0625`）／
  `get_file_tree` の `canonical_root` は引数のディレクトリで設定上の root ではない（`a765bbd` でコメント）
- **arch**: `createDir` が barrel に載ったが、使っている `AiLibraryTab` の用途では
  **必ず失敗する**（`83daabd`。ワークスペースを設定済みだと `ai_root` の下に作れない）／
  投げる `readFile` と `AsyncResult` の API が公開面に並んでいた（`6be0625`）
- **ui**: 前置きの文がカードの縁に触れる／ツールチップが自分のアンカーに重なる／
  死んだ placeholder の規則／空状態のボタンの軸（すべて `571b6d3`）
- **comment**: `EXTRA_GUARDS` / `root_guard` のモジュール doc の範囲（`b526df4`）／
  `mv.rs` の順序の理由が参照先と別のことを言っていた（`b526df4`）／
  `validate_under_root` の「存否は隠せない」が親の存否の話だった（`b526df4`）／
  `isProjectRoot` の TSDoc が後半で自分を否定（`b526df4`）／
  `UNMEASURED_COUNT` の例外が「理由を1行書けば上げてよい」と読めた（`571b6d3`）
- **oss**: `CONTRIBUTING` の検査の表に2本欠け（`b526df4`）／
  **ADR-0001 の手順の書き換えが append-only の例外3つのどれにも当たらない**（`b526df4`）／
  「短ハッシュを書かない」規約と成果物が真逆（`b526df4`）／
  4本の検査が走査0件でも緑（`1092a77`）

## r6 の書き戻しの訂正（4ラウンド続いた）

- **H-5 の対応列**に別のコミットのハッシュを書き、送っていない issue を「送った」と書いた
- **MEDIUM を「全件対応済み」**と書いたが、1件は直していなかった

どちらも r6.md に訂正を書き足した。原因は、対応列を書くときにコミットの中身を
見ていないこと。`/review-fix` の「短ハッシュを書かない」も、**ハッシュがあったからこそ
この誤りを次のラウンドで拾えた**ので「ハッシュと1行の説明を併記する」に改めた。

## 範囲の外へ送ったもの

| 内容                                                                                          | 送り先                                                   |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `utils` ⇄ `config_dir` の相互依存 / `app-config` ⇄ `engine-presets` / `tesuuPointer` の手書き | [#231](https://github.com/Rioh1118/obs-shogi/issues/231) |
| ツリーは root 内 symlink を辿るのに、横断検索の走査は辿らない                                 | [#234](https://github.com/Rioh1118/obs-shogi/issues/234) |

## 反論（直さずに残したもの）

### PR の Commits タブが466件になる

`origin/main` が PR #232 をマージコミットで公開したあと squash に置き換えたため、
squash 前の280コミットがこのブランチに残っている。差分（178ファイル）は正しい。

**分けない・作り直さない。** 差分が正しく、レビューは差分に対して行うため。
PR 本文に「#169 のコミットの範囲」を明記する。

## 検証

- `npm run verify` — 緑（41ファイル / 333件）
- `npm run build` — 緑
- `npm run verify:rust` — 緑（ベンチを除く `#[test]` は 23件）

変異を当てて落ちることを確認したもの:

- `escapeReceivers`（**名前付きハンドラ**で `preventDefault` → `stopPropagation`）
- 関門の順序（`read_file` の関門を存在確認の後ろへ）
- blur が最初の確定になる経路（印を落とす）
- 「操作は完了しました」の条件（引き金を見ない形に戻す）
- 自分を指す symlink（上限と祖先の集合を外すと落ちる）
