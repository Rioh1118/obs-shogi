# 対局エンジン レビュー ラウンド33

- 日付: 2026-09-03
- 範囲: ラウンド32と同じ
- 範囲外: `analyzer.rs` / `bridge.rs` の中身（#371）、#381、#382、#383、**#384**
- 観点: rust / comment / robustness の3本。**変異試験を許したのは rust の1本だけ**

**所見14件。数は … → 13 → 14 → 11 → 15 → 14。**

---

## 回し方を1つ間違えた

**変異試験を許した1本と、他の2本を同じワークツリーで同時に走らせた。**

robustness が実測している最中に `types.rs` の `MAX_ID_BYTES` が 48 → 51 → 64 と
4秒おきに書き換わり、`cargo test` が変異由来で赤くなった。robustness は気付いて
所見を全部ソースの読みへ退避し、`git diff --quiet HEAD -- <file>` で HEAD と
一致するファイルだけを根拠にした——**気付かなければ、変異を現物として報告していた。**

次から、変異試験を許す1本は**単独で回す**。

---

## ラウンド32で私が入れた退行

### R33-H1 `finish` の「切ってから書く」順序を、どのテストも見ていない

`session.rs:1555`（切る）と `:1563`（書く）。rust の変異:

**この2行を入れ替えると、13スイート全部が緑のまま通る。**

その状態で `endGameByRule(id, null, "x".repeat(300_000))` を1回呼ぶと
`over game_id=… detail=<300,000バイト>` が出て、**1行で診断の履歴が全部消える**。

`46a68955` は「切る場所を `finish` の1箇所へ移した」が、
**その1箇所が `over_line` より前にあること**を何も表明していない。

同じ穴がもう1つ。`Over` イベントに載る `detail` を見ているテストが1本も無い
（`ending_the_game_emits_over_with_the_clock_stopped` は `reason` / `winner` / `clocks` だけ）。
`finish` の doc が名指しする「3つの吸い口」のうち、固定されているのは `snapshot` 1つ。

### R33-H3 `d0133b20` の等式は `MAX_ID_BYTES % 3 == 0` のときしか成立しない

`types.rs:549-553`。`Display` は制御文字を3バイトへ広げて打ち切るので、
埋まるのは `MAX_ID_BYTES / 3 * 3` バイトまで。

rust の実測:

| `MAX_ID_BYTES` | 結果               |
| -------------- | ------------------ |
| 48（現状）     | ok                 |
| 49 / 50        | **FAILED**（等式） |
| 51             | ok                 |
| 64             | **FAILED**（等式） |

同じコミットで `utils.rs` に書いた「**広げると予算のほうが先に落ちる**ので、
落ちたテストを『関係の無いラチェット』と読まないこと」は、**3値のうち2値で嘘**。

しかも失敗のメッセージは「制御文字が置換文字へ広がる形を選び直すこと」——
つまり `worst_game_id` を書き換えろと言う。書き換えは要らない（`Display` は正しい）ので、
指示に従った人は最悪ケースを弱めるか、**無意味だと判断して `assert_eq!` を消す**。
消えると R32-H1 の退行がそのまま戻る。

### R33-H4 レビューで直した欠陥の記録が、コメントに4箇所残っている

`session.rs:1551` / `:3779` / `:4232`、`protocol.rs:1701`。

```rust
// 「通してから渡すこと」を呼び出し側の心得にすると、終わり方を1つ足すたびに
// 数え直しが要る——実際に `SearchOutcome::Failed` の1経路が抜けていた。
```

どれも**理由を言い切った後ろに「私たちはこれを踏んだ」を足しただけ**で、
いま何がどうあるべきかを1つも増やしていない。`CONTRIBUTING.md` の
「変更の経緯を書かない」に真正面から反する。

**`commentHistory` は止めなかった。** `HISTORY_WORDS` は `"ていなかった"` を持つが
`"そうなっていた"` `"抜けていた"` `"無かった"` を持たない。

### R33-H5 `finish` が「切るのはここ1箇所」と宣言した後も、`SearchOutcome::Failed` だけが入口で切っている

`session.rs:1159-1166`。3つの doc（`accept_rule_end` / `finish` / `over_line`）を読んだ人が
現物を見ると、契約に反した書き方がその経路にだけ残っているように見える。

**素直な整理は `let message = shown(...)` を落とすこと**で、そうすると
`log::error!` が上限を1つも持たなくなる——`detail` は `finish` が切るので
`Over` イベントも棋譜も無事なのに、**ログ1行だけが無制限になる**。

### R33-M1 新しい2つの定数は下側を誰も押さえていない。縮めて全13スイート緑

`registry.rs:277`（`MAX_PATH_IN_LOG`）と `session.rs:2131`（`MAX_NAME_BYTES`）。

rust の実測: **256→16 かつ 128→32 で13スイート全部緑。**

- `MAX_PATH_IN_LOG = 16` は、定数の doc が名指しで避けた状態
  （毎回 `…` で終わってどの実行ファイルか読めない）にそのまま戻る
- `MAX_NAME_BYTES = 32` だと日本語11文字の表示名で `startGame` が断られる。
  `第4期叡王戦本戦 佐々木大地七段`（45バイト）は通らない

通す側の実例が 27 バイトと 21 バイトしかないので、下が空いている。

**しかも `MAX_NAME_BYTES` の doc に「この1/4に収まる」と書いた。** R32-M7 が
「その文型は**縮める根拠として引用される**」と指摘し、`daaa4fc5` が
`MAX_SUMMARY_LEN` の側に「縮める根拠にはならない」を足した、その1コミット前の
`46a68955` が新しい定数に同じ文型を持ち込んでいる。**同じ形が2度目。**

### R33-M2 `failure-surfacing.md` の F-28 が数を手で書いている

`（**7つ全部が通る**）`。直前に並ぶコマンドは6つ（`close` は F-24 側）なので、
読み手は数を合わせられない。口が1つ増えれば静かに嘘になる。

**`daaa4fc5` が「32行」「31秒目」「最大8秒」を名前へ置き換えた同じ束の中で、
新しい数字を1つ書いた。**

併せて（comment）: 台帳が並べる名前（`submit_game_move` / `resign_game` …）では
**ログを引けない**。`rejection_line` が使う `op` は `"submit_move"` / `"resign"` …で、
7つのうち一致するのは `continue_game` だけ。断りが残ったか確かめる人が
「1行も残っていない」と読む。

---

## 外来の失敗の理由が消えている

### R33-H2 `usi::Error` の `Display` は OS のエラーを丸ごと捨てる

`registry.rs:174-175`、`protocol.rs:370` / `:1311`。rust の実測:

```
DISPLAY = IO error occurred when communicating with the engine
DEBUG   = EngineIo(Os { code: 13, kind: PermissionDenied, message: "Permission denied" })
WRAPPED = Engine startup failed: Failed to spawn engine: IO error occurred when communicating with the engine
```

入力は「実在するが実行権限の無いファイル」——**zip から展開したエンジンで最も起きる形**。
`canonicalize` も `is_file` も通るので関門は素通りし、`Command::spawn` が EACCES で落ちる。
利用者に返るのもログに残るのも上の1文だけで、
「権限」「アーキテクチャが違う」の区別が付かない。

F-27 は「対局まわりで最も起きやすい失敗」「利用者がすること＝設定タブでエンジンを直す」と
書くが、**何を直せばいいかがこの文字列から導けない**。

対局中も同じ。stdin が EPIPE になると `SearchOutcome::Failed("... IO error ...")` になり、
`finish` の `detail` として **`Over` イベントと棋譜に残る**。
「エンジンが落ちた」が「IO エラー」になる。

### R33-M3 `AlreadyListening` の判定が、依存クレートの人間向けメッセージの部分一致

`protocol.rs:758-764` の `e.to_string().contains("already started listening")`。

`usi` が文言を1語でも直すと、**二重 listen が `CommunicationFailed` に化けて
`log::error!` が立つ**。`send_command` の doc はこの区別を契約として書いているのに、
根拠が依存の表示文字列にしかない。`usi::Error::IllegalOperation` は公開バリアント。

このコードベースは同じ危険を `closed_set_enum!` や `Rejection` の網羅 `match` で
構造として潰している。**ここだけ心得になっている。**

---

## 断り方と、その伝わり方

### R33-M4 `MAX_NAME_BYTES` の契約が TS の写しにも台帳にも1文字も無い。断り文句の単位も利用者のものでない

comment と robustness が独立に着いた。`rust-types.ts` は `startGame` を reject させうる
上限を**全部**名前で書いている（`MAX_OPTIONS` / `MAX_WIRE_FIELD` / `MAX_PLIES`）。
`PlayerSpec` の `name` にだけ無い。`grep -rn MAX_NAME_BYTES src/ docs/` は0件。

**産地が自分のフロントとは限らない。** `EngineInfo::name` は長さを見ずに保持され
（`spawn_ok_line` の doc が「入口で切ると利用者が見る名前が変わる」と明言）、
それを既定の対局者名に流す実装を書くと、**利用者が1文字も入力していないのに
「名前が長すぎる」で `startGame` が落ちる**。

**単位も利用者のものでない。** 日本語なら1文字3バイトなので上限は42文字。
返るのは `Black name is 198 bytes; the limit is 128` で、
`startGame` の TSDoc は「文言をそのまま見せる」を指示しているから、
利用者は**どこまで削れば通るかが分からない**。

### R33-M5 `abort_within_budget` の2行だけが、どの絞りも通らず `game_id` も持たない

`session.rs:516-527`。**その1行を置くなと書いた注記のすぐ隣で置いている**——
`manager.rs:158-164` は同じ関数を呼ぶまさにその枝で
「**ここでログを書かない。** … 絞りを通らない行を1本でも置くと、
`log_rejection` が守っている予算をその1本だけで一周させられる」と書き、
その直後の `:165` が `session.abort_within_budget().await;`。

- **`busy` の呼び直しが `debug` を1行ずつ書く。** `lib.rs` が `engine` を `Debug` に
  上げているので本番でファイルに出る。終局済みの対局を閉じる経路では
  `Command::Abort` がマイクロ秒で `Err` を返すので、`closeGame` の TSDoc が案内する
  「呼び直すこと」に従った実装がここを回す。**約2,000行で予算を一周する**
- **止まったセッションを特定できない。** `close: abort timed out; the session is stuck` に
  `game_id` が無い。同じ問題が `session.rs` の他8行にもあり、
  `gameover failed` と `ponderhit failed` は**終局しないので `over_line` で
  突き合わせることもできない**

### R33-M6 「終局した」と「まだ裁定待ち」が、着手の口では同じ1文になる

`session.rs:907-910` の `Err("not waiting for a move")` が
`Phase::AwaitingRuling` と `Phase::Over` の両方を吸う。

返る1文が、**次にすべきことが正反対の2状態**を指す。`Over` はもう何をしても変わらず、
`AwaitingRuling` は数ミリ秒の一時的な窓（人対人なら毎手ある）。

`ALREADY_OVER` の doc は「3つの口（投了・裁定・中断）で同じにする。
綴りが割れると、呼び出し側は操作ごとに別の分類を書くことになる」と書くが、
**着手はその3つに入っていない**。`submitGameMove` の TSDoc もどちらも書いていない。

---

## doc が現物と食い違う

### R33-M7 定数の値の写しが2箇所残っている

- `protocol.rs:1682`「1行だけを見ると**32倍**見落とす」（＝ `PENDING_LIMIT`）
- `engine_timeouts.rs:21`「終了が**10分**待たされる」（＝ `HARD_TURN_LIMIT`）。
  **同じファイルの13行上（`:8`）が「散文で『同じ10分』と書かない」と自分に禁じている**

### R33-M8 `MAX_PATH_IN_LOG` だけ単位が名前に無く、doc は「予算とは関係が無い」と読める

兄弟は `MAX_SUMMARY_LEN`（文字）/ `MAX_DETAIL_LEN`（文字）/ `MAX_USI_MOVE_BYTES`（バイト）。
すぐ隣の `MAX_WIRE_FIELD` は**無印でバイト**なので、無印を見た人はバイトと読む。

doc は「これ1行で予算を一周させることはできない」と書くが、
`the_registry_lines_cannot_rotate_the_log_or_forge_a_line` は `SHARE = 50` で測るので、
この定数は約 994 文字で赤くなる（comment の手計算、未実測）。
**R32-M1 で `MAX_ID_BYTES` に対して直したのと同じ形。**

### R33-M9 状態遷移表の ※8 が「`info` を落とすのは1本だけ」と書くが、2本ある

`game-session.md:243`。現物（`session.rs:1082-1091`）は `is_to_move` と
`is_current_search` の2本。同じ文書の ※13 は「世代の照合は `Info` と
`SearchOutcome` の両方に掛かる」と書いていて、自分と食い違っている。

`E13`（`info` の間引き）は埋まっていないセルに残っている作業で、
次に着手する人はこの注を起点に読む。

---

## 修正計画

### 順

1. **自分が入れた経緯を落とし、`commentHistory` の網を広げる**（H4）
2. **等式を実際に埋まる量へ直し、doc の嘘を消す**（H3）
3. **`finish` の3つの吸い口を全部見る**（H1）。順序はここで固定される
4. **切る場所の宣言と現物を合わせる**（H5）、**着手の断りを分ける**（M6）
5. **外来の失敗の理由を保つ**（H2 / M3）
6. **下側を通したい実例で押さえる**（M1）
7. **断り方の伝わり方**（M4 / M5）
8. **doc**（M2 / M7 / M8 / M9）

### `commentHistory` に語を足す判断

**two-strikes を満たしている。** 「コメントに経緯を書く」はこの repo で既に
1度ラチェットを生んでいて（`HISTORY_WORDS` がその産物）、今回はその網を
**すり抜ける言い換え**で同じことをした。網を広げるのは新しい機構ではない。

広げるのは3語だけ（`そうなっていた` / `抜けていた` / `無かった`）。
「ていた」のような広い語は入れない——「なぜ」を書くのに要る。
