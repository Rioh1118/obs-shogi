# レビュー book-foundation ラウンド12

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/` 全7ファイル、`src-tauri/src/lib.rs` の book 登録部分、`.claude/hooks/verify-gate.sh` / `verify-gate.test.sh`
- 走らせた reviewer: rust / robustness / comment
- 前ラウンド: `-r1.md`〜`-r11.md`（計154件）

## 所見

### Q-01 [HIGH] `MAX_PATH_CHARS` の const が `validate_book_path` の doc を吸っている

**3体全員。** `api.rs:149-156`。P-02 で const を doc ブロックと `fn` の間に差し込んだため、
4行の doc が全て `const` に付き、**`validate_book_path` は doc を1行も持たなくなった。**
定数の説明として読むと「フロントから来たパスの形を検査する」は成立しない。

### Q-02 [HIGH] `a_long_input_is_truncated_in_the_message` が、doc の名指した枝を1つも通っていない

rust / comment。`sfen.rs:462-504`。5つの入力は全て 100,000 字なので、
**入口の長さ検査（`> 256`）で全件が同じ枝から返る。**
「余分なトークン」「手数が数値でない」「持駒の桁」「枚数に駒が続かない」のどの理由文も生成されない。

**P-01 で足した `truncate_for_message(reason)` にテストが1件も当たっておらず、消しても緑のまま。**

### Q-03 [MEDIUM] `MAX_INPUT_CHARS` の根拠が、実際に効いている律速と違う

rust / comment。`sfen.rs:187-191`。「平手の SFEN は 60 字程度、持駒が 120 字を超えない」と書いたが、
長さを決めているのは**盤面の綴り**。成駒を `+X` で書き空きマスを畳まないと 123 字になる。
doc を信じて 128 に詰めると正当な局面が落ちるが、**既存テストは1本も落ちない**（最長の入力は平手の 57 字）。

### Q-04 [MEDIUM] `MAX_PATH_CHARS` が、出荷対象の Linux で正当なパスを弾く

robustness。`api.rs:153`。`PATH_MAX` が 1024 なのは macOS / BSD だけで、Linux は 4096。
`release.yml` は `ubuntu-22.04` を出荷している。**実在して読めるパスが `InvalidPath` で開けず、
message に復帰導線も無い。** コメントが挙げている理由（ログの予算）は**打ち切りで足りる**もので、
入力の拒否まで要求しない。

### Q-05 [MEDIUM] alias の値に生の改行があると、その alias が素通しする

rust。`verify-gate.sh:83-91`。`git config --get-regexp` は値の改行をそのまま出すので、
2行目以降が `alias.` で始まらず `sed` が名前を切り出せない。実測で `acp` が語彙に入らず、
`git acp -m x` が **deny も検証もされずに通る**。

### Q-06 [MEDIUM] `GATE_COMMIT_VERB_CACHE` は一度も効かない

rust。`verify-gate.sh:109-116`。呼び出しは3箇所とも**コマンド置換の中**なので、代入はサブシェルで消える。
実測で常に `UNSET`。読み手には「alias 解決は1回だけ」と読めるコードが残っている。
テスト側の `GATE_COMMIT_VERB_CACHE=` も no-op。

### Q-07 [MEDIUM] `MESSAGE_EXCERPT_CHARS` の doc が、存在しない理由文を例に出している

comment。`sfen.rs:193-197`。`to_book_key` は手数の欠落を意図して受け付ける
（`accepts_a_missing_move_number` が固定）ので、「手数が無い」という理由文は作れない。
`LookupBookMovesInput.sfen` の「手数は付いていてもよい」と正面から食い違う。

### Q-08 [MEDIUM] `verify-gate.test.sh` 冒頭の「表は4つ」が実際は6つ

comment。O-06 は `verify-gate.sh` 側で列挙を消したが、テスト側は数を 2→4 に書き直しただけだった。
**載っていない2つは、直近で実際に素通しが見つかった alias 経路を守る唯一の表。**

### Q-09 [MEDIUM] `rejects_a_path_that_is_not_an_absolute_spelling` が、名前にない性質を固定している

comment。`api.rs:527-551`。`too_long` は `/` 始まりの絶対パスで、落ちる理由は「絶対でない」ではない。
さらに P-02 の核心（`path` の打ち切り）まで一緒に固定している。

## 重複・矛盾した所見

- Q-01 は3体全員、Q-02 は2体。**どちらも P-01 / P-02 の修正そのものが持ち込んだ**
- Q-02 / Q-03 / Q-09 は「テストが名前どおりの性質を固定していない」形で、
  **R9 N-07 / R10 O-04 / R11 P-01 と数えて4ラウンド連続**

## 状態遷移表を作った

ユーザーの提案で `/state-transition-table` を使った。**1件ずつ潰す形では見えていなかったものが、
表を作った時点で見えた。**

- `docs/state-transitions/book-key-failures.md` — 検査12個 × 入力の形7種
- `docs/state-transitions/verify-gate-decision.md` — 段5つ × コマンドの形9種

`to_book_key` の表で、Q-02 の5つの入力が**全て同じセル（右列の G0）に重なっている**ことが
一目で分かった。埋まっていなかったのは (1トークンが長い, 全体 256 字以下) の1セルで、
そこにだけ `truncate_for_message(reason)` が効いている。

さらに表を作る過程で、**所見に挙がっていなかった空白セルが2つ**見つかった。

- 不変条件「合法な局面は必ず通る」に**テストが無かった**（`MAX_INPUT_CHARS` を詰めても何も落ちない）
- ゲートの (alias の値に生の改行) — これは Q-05 として rust も挙げていた

## 見ていない範囲

- フロント側（`src/`）。呼び出しは R1 から0件のまま
- 実際の定跡ファイルでの動作。`open_reader` は今も必ず `Err`
- やねうら王 `source/book/book.h` / `Position::sfen()` の一次資料
- Windows / Linux の実行時挙動。実測は macOS のみ
- hook の payload の `.cwd` が Bash ツールの持続する作業ディレクトリを追随するか
- **(D, S4)**: `git rebase main` は作業ツリーが clean なら素通しする。
  PreToolUse は実行前に走るので構造上どうにもならない。**表に残した**
- **S4 の end-to-end**: `git status -z` の出力（リネーム2レコード / 引用符付きパス）を
  食わせるケースが無い。`gate_kinds_for_path` 単体の表はある。**表に残した**

## lint / hook で強制できるもの

- **状態遷移表そのもの。** 4ラウンド連続で出た「テストが枝を通っていない」は、
  表の空白セルとしてなら1回で見える
- **`…` の数で打ち切りを見る** — 長さだけを見ると、理由文と引用のどちらか一方を
  打ち切っただけでも通る
- **最長の綴りを実データで置く** — `MAX_INPUT_CHARS` から期待値を導くと、定数を詰めたときに
  テストも一緒に緩む

## 修正結果

| 所見 | 結果 | コミット |
| ---- | ---- | -------- |
| Q-01〜Q-09 | 全て直した | `e48b17d` |

1コミットにまとめた。表を作って空白セルを埋める作業と、そこで判明した定数の見直しが
互いに依存していて（`MAX_INPUT_CHARS` の根拠 → 最長の盤面のテスト → 上限の値）、
分けると中間のコミットが「表と実装が食い違う」状態になる。

提案どおりに直さなかったもの:

- **Q-04 の閾値** — robustness は「拒否を残すなら 4096 に上げる」と「拒否をやめる」の両論。
  **拒否をやめた。** 長さは弾く理由にならない（OS が判断すればよい）。
  `MAX_PATH_CHARS` は打ち切りの値としてだけ残し、doc にもそう書いた
- **Q-06** — rust は (a) キャッシュを消す / (b) 効かせる の両論。**(a) を採った。**
  効かせるには hook 本体のトップレベルで確定させる形が要るが、`git config` 1回ぶんの差でしかない

## 変異による確認

| 壊した箇所 | 結果 |
| ---------- | ---- |
| `MAX_INPUT_CHARS` を 128 に詰める | `a_maximally_spelled_board_is_accepted` と `a_long_token_is_truncated_in_the_reason` が落ちた |
| 理由文側の打ち切りを外す | `a_long_token_is_truncated_in_the_reason` が落ちた（`…` の数で見る形にした後。長さだけを見る形では落ちなかった） |
| alias を `-z` で読むのをやめる | `expect_alias_resolution` の改行 fixture が落ちた |

## 検証

`npm run verify:rust` を通した。book のテストは 58件。
`bash .claude/hooks/verify-gate.test.sh` も通した。
