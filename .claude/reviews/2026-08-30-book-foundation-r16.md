# レビュー book-foundation ラウンド16

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/`、`src-tauri/src/lib.rs` の book 登録部分、`.claude/hooks/verify-gate.*`、`docs/state-transitions/`
- 走らせた reviewer: rust / robustness / comment / architecture
- 前ラウンド: `-r1.md`〜`-r15.md`（計216件）

**このラウンドの前に、main の force-push へ追随して87コミットを載せ替えた。**
`origin/main` の履歴がマージコミット列から PR ごとの squash 列に差し替わっていたため、
素の `git rebase origin/main` は main 側のコミットまで replay 対象に入れて大量に競合する。
書き換わる前の先端 `f992cc2` を `--onto` の起点にして、自分の87コミットだけを載せ替えた。
中身（tree）は載せ替え前後で完全に一致。

重複を除いて **10件**。うち3体が独立に同じ穴を実測で突き止めたものが1件ある。

## 所見

### R-01 [BLOCK] 積んだ操作を畳む呼び出しを、ゲートが全て塞いでいる

robustness / comment。`.claude/hooks/verify-gate.sh:65,314-316`、`verify-gate.test.sh:73`、
`docs/state-transitions/verify-gate-decision.md:68`。

`--abort` / `--quit` / `--skip` / `--edit-todo` はコミットを1つも作らないのに、動詞が
語彙に当たるというだけで検証へ載っていた。これらを使うのは競合を抱えた状態に限られ、
そこでは `package.json` に競合マーカが入って `npm run verify` が必ず落ちる。
**競合を畳む唯一の手段が deny され、行き止まりになる。** 案内文は「再度コミットすること」で、
利用者はコミットしようとしていない。指示に従える操作が1つも無い。

robustness の実測では6形すべて同じ deny。
**私自身がこのラウンドの直前に踏んで、`git rebase --abort` が打てなくなった。**

不変条件3「誤発火は許容する。余分な検証が走るだけ」がこの反例を説明できていなかった。

→ 直した。1つの git 呼び出しだけに限るので免除は広がらない（`--abort && commit` は
宛先の判定で呼び出しが2つと数えられて deny のまま）。`--continue` は対象外。

### R-02 [HIGH] 別リポジトリへのコミットが、無関係な npm エラーで一律に不可能になる

robustness。`.claude/hooks/verify-gate.sh:251-260,314-316`。

`gate_target_dir` は「宛先が自明か」しか見ておらず、**その宛先がこのプロジェクトの
ツリーかを一度も確かめていなかった。** 別プロジェクトで `.ts` / `.rs` を触ると、
ゲートはそこへ移動して `npm run verify` を走らせる。`package.json` が無いので必ず失敗し、
利用者は「自分が触ってもいない `package.json` が無い」と言われる。直す対象が存在しない。

reviewer 自身、使い捨ての repo を作るためにコミットの綴りを難読化する必要があったと報告している。

→ 直した。`--git-common-dir` で比べるので、同じプロジェクトの別ワークツリーは
今までどおりゲートに掛かる（いまワークツリーで作業している状況を壊さない）。

### R-03 [HIGH] 長さの検査とコンパイル時 assert が、別の量を測っている

**rust / comment / robustness の3体が独立に実測して同じ穴を指した。** `sfen.rs`。

入口の検査はトークンごとに字数と区切り1字を数えるのに、境界を固定する assert と
テストは生の文字数で測っていた。最長の局面で raw=193 / トークン合計=194 と1字ずれる。

```
MAX_INPUT_CHARS=194 → 27 passed
MAX_INPUT_CHARS=193 → コンパイル成功 / a_maximally_spelled_board_is_accepted FAILED
MAX_INPUT_CHARS=192 → error[E0080] でコンパイルが止まる
```

**193 という1点だけが素通しする。** R14 と R15 が2ラウンドかけて建てた
「上限を詰めたらコンパイルで止まる」という歯止めが、境界そのものでは効いていなかった。

→ 直した。物差しを `measured_len` 1本に寄せ、検査・assert・テストの3箇所が同じ式を呼ぶ。
単位が2つに割れること自体が起きなくなる。

### R-04 [MEDIUM] G7b が表のどのセルにも無く、テストも無い

robustness / comment。`docs/state-transitions/book-key-failures.md`、`sfen.rs`。

理由文に入力の断片を埋める枝は5つあるのに、表もテストも4つしか数えていなかった。
落ちていたのは G7b（綴りの検査は通るが u32 に収まらない）。R15 で G7 を G7a/G7b へ
割ったとき、G7b の行き先をどのセルにも書かなかった。**空のセルが「消えて完成に見える」形。**

この枝は 150 字の断片を埋められる。**打ち切りだけを外す変異を当てても、64件が1つも落ちなかった。**

同じファイル内で矛盾もあった。F 行は「駒が続かない」は断片を持てないと書き、
`(F, ≤256)` の節は4枝の1つに数えていた（R15 以前の記述が残っていた）。

→ 直した。テストを足し（変異で落ちることを確認）、枝の一覧を5つに揃えた。

### R-05 [MEDIUM] `InvalidSfen` / `InvalidPath` だけ復帰操作が文面に無い

robustness。`sfen.rs`、`api.rs`。

この branch は他の全種別に復帰操作を入れ、それを文面で見るテストまで置いている
（io / UnsupportedFormat / InvalidContent / InvalidHandle）。この2種別だけが漏れていた。

漏れていた文面はどちらも呼び出し側に向けた言葉だった。「定跡のパスは絶対パスで渡すこと」
「手番が b でも w でもない」は、画面の前に居る人には次の操作にならない。しかもこの2つの
入力を組み立てるのはフロントなので、届いた時点でこちら側の不具合である可能性が高い。

→ 直した。理由と復帰操作を分け、`book_key` は理由だけを返す。同じ綴りの誤りでも、
利用者が操作した局面なら「盤面を操作し直せ」、定跡ファイルの中身なら「取得し直せ」で違う。

**このとき自分で1つ穴を掘った。** 最初 `contains(SFEN_RECOVERY)` と書いたが、案内を空にする
変異を当てると `contains("")` が常に真になり、**案内が消えてもテストが落ちなかった。**
リテラルで見る形に直した。

### A-01 [MEDIUM] `api` ↔ `session` が相互依存し、ハンドル管理がコマンド層の型に縛られている

architecture。`session.rs:1`、`api.rs:3-4,59-64`。

book のモジュール依存でここだけが双方向。`OpenedBook` は `BookState::register` の
引数の型なのに、定義は Tauri コマンドの入っている `api.rs` にあった。`session.rs` は
Tauri に一切依存していないのに、公開契約がコマンド層の型で表現されていた。

→ 直した。`OpenedBook` を `reader.rs` へ移し、`open_reader` の返り値をそれにする。
あわせて `BookReader::position_count` を trait から落とし（呼び手は開いた直後の1箇所だけ）、
`open_reader` から拡張子の判別を外して解決済みの `BookFormat` を受け取る形にした。

### A-02 [MEDIUM] 開く手続きがコマンド層に同居し、`reader.rs` の検査が `open_book` から到達できない

architecture。`api.rs:93-129`、`reader.rs:51-58`、`types.rs:38`。

同じ判定（`BookFormat::from_path`）が2モジュールに書かれ、両方が自分の doc で検査の
順序を宣言していた。`resolve_book_path` が先に形式を確かめるので、**`reader.rs:52` の
`?` は `open_book` 経由では絶対に発火しない。** それを固定していたテストは production から
観測できない振る舞いを見ていた。`NotFound` も同様で、実際に届くのは `api.rs` 側。

→ A-01 で判定の二重化と到達不能な枝は消えた。残る置き場の分として `open.rs` を作り、
`open_at` / `resolve_book_path` / `validate_book_path` / `requested_error` / `annotate` を
移した（`api.rs` 575行 → 258行）。検査の順序を語る doc が1箇所になり、#91 で形式の検査を
足すときの置き場も決まる。

### A-03 [MEDIUM] SFEN の正規形という同じ知識が二重に手書きされている

architecture。`sfen.rs:44-54,338-470`、`search/sfen_position.rs:32-189`。

`HAND_PIECES` の doc は「一次資料とは突き合わせていない」と書き、確定を #91 へ送っていた。
**その答えは既に vendor 済みの依存の中にあった。** `shogi_core 0.1.5` の
`impl ToUsi for [Hand; 2]` は `PLNSGBR` を降順に、2枚以上のときだけ枚数を前置し、
空なら `-` で書く。`normalize_hands` と完全に同じ。search 側は既にこの crate を使っている。

→ 前半を直した。`PartialPosition::to_sfen_owned()` と突き合わせるテストを足し、
並びをリテラルでなく外部実装に紐づけた（変異3種で落ちることを確認）。
TODO(#91) は残すが範囲を狭めた。#91 で確かめるのは「やねうら王が USI 標準どおりに
書いているか」であって、並びが何かではない。

**後半（`book` と `search` で受理集合が2つある）は範囲外なので issue #236 を立てた。**
どちらへ寄せるかはフロントの呼び出しに影響する設計の判断で、この PR で決めるものではない。

### A-04 [LOW] `BookError` が「作れるが読めない」型になっている

architecture。`mod.rs:24`、`error.rs:54,62-72,79,88`。

`new` / `with_path` / `from_io` が `pub` で、`code()` / `message()` / `path()` が
`pub(crate)`。`mod.rs` は公開面を絞ったことを設計の柱として宣言しているのに、
エラーだけその線が引かれていなかった。book 以外からの参照は0件。

→ 直した。組み立ての3つを `pub(crate)` へ下げ、`BookErrorCode` も facade から外した。

### C-04 [MEDIUM] 同じ理由付けが3箇所に写されている

comment。`sfen.rs:525-526,577-578`、`book-key-failures.md:90-92`。

`assert_eq!(count, 2)` を変えるとき直すべき文が3つある。このブランチで4ラウンド続けて
出た故障は全て「片方だけ直して残りが腐る」形で、写しはその材料そのもの。

→ 直した。理由はテストの doc に1つだけ残し、本文コメントを消して、表の照合欄は
テスト名を指すだけにした。

## 変異による確認

| 当てた変異                     | 落ちたテスト                                                      |
| ------------------------------ | ----------------------------------------------------------------- |
| 上限を 194（＝最長ちょうど）に | 落ちない（正しく通る）                                            |
| 上限を 193（見つかった穴）に   | `error[E0080]` でコンパイルが止まる                               |
| テスト側だけ生の文字数へ戻す   | `a_maximally_spelled_board_is_accepted`                           |
| G7b の枝だけ打ち切りを外す     | `a_long_token_is_truncated_in_the_reason`                         |
| SFEN の案内を空に              | `an_unreadable_position_tells_the_user_what_to_do_next`           |
| パスの案内を空に               | `a_rejected_path_tells_the_user_what_to_do_next`                  |
| ファイル側に盤面の案内を混ぜる | `a_broken_line_in_a_book_does_not_ask_the_user_to_move_the_board` |
| 持駒の並びを逆順に             | `the_key_matches_what_a_usi_implementation_writes` ほか           |
| 1枚のときも枚数を書く          | 同上                                                              |
| 先後の大文字小文字を入替え     | 同上                                                              |
| ゲートの畳む操作の免除を外す   | `expect_teardown` 9件                                             |
| 免除を `--continue` まで広げる | `expect_teardown` 2件                                             |
| プロジェクトの判定を常に真に   | `expect_project`（別リポジトリ）                                  |
| 同じく常に偽に                 | `expect_project`（ワークツリーと本チェックアウト）                |

## 自分が作った退行

R-05 の最初の版で、案内文を定数と突き合わせるテストを書いた。定数を空にする変異では
`contains("")` が常に真になり、**案内が消えてもテストが落ちなかった。** 別の理由で通っていた。
変異を当てたので気づけたが、当てていなければ「案内をテストで固定した」と報告していた。

## 検証

- `npm run verify` — 22 files / 210 tests 通過
- `npm run verify:rust` — fmt / clippy / test（book 67件）通過
- `bash .claude/hooks/verify-gate.test.sh` — 全て期待どおり

## 送り先

- issue #236 — `book` と `search` で SFEN の受理集合が2つある（A-03 後半）
- issue #197 — 巨大ファイルの上限・進捗・中断（R13 F-13）
