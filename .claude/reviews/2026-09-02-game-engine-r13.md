# レビュー game-engine ラウンド13

- 日付: 2026-09-02
- 範囲: **対局側だけ**（`src-tauri/src/engine/game/**` と `protocol.rs` / `registry.rs` / `lib.rs`、
  `docs/state-transitions/game-session.md` / `game.md` / `failure-surfacing.md`）
- **範囲から外した**: `analyzer.rs` / `bridge.rs` / `analysis.md` / `entities/analysis` / `entities/engine`
- 走らせた reviewer: rust / robustness
- 対象コミット: `df874df`

**生の所見12件**（HIGH 5 / MEDIUM 7）。前回33件から減った。

## 範囲を絞った結果

件数は **20 / 17 / 16 / 15 / 16 / 20 / 20 / 20 / 28 / 33 / 12**。

減っただけでなく、**中身が変わった**。ラウンド12までの所見の半分は
呼び出し側0件の解析経路と、自分が前ラウンドで書いた doc だった。
今回は12件すべてが対局の実装そのもので、**4件は利用者に届く実害**。

`game/session.rs` の本体は r7 から6ラウンド持ち越していた。読ませたら出た。

---

## 実害

### R13-H1 「エンジンの時間切れを成立させない」を選ぶと、30秒後に必ず負ける（rust HIGH）

`enforce_engine_timeout: false`（**既定**）＋切れ負けの設定で:

1. エンジンが持ち時間を使い切る → `consume` が `remaining_ms = 0` にして `Expired`
2. `timeout_enforced` が偽なので終局しない（**利用者が選んだとおり**）
3. 以降 `budget_ms` は `0 + 0 = 0` に張り付く
4. `stalled_turn` の締切が `0 + SEARCH_GRACE` = **30秒ちょうど**になる
5. `finish(EngineFailure, "the engine did not answer in time")`

利用者は「時間切れで負けにしない」と指定したのに、時計が尽きた30秒後に必ず負ける。
しかも理由が `Timeout` ではなく **`EngineFailure`**（「エンジンが応答しない」）で
棋譜と画面に残る。エンジンは応答していて、単に持ち時間を超えて考えているだけ。

番人の doc は「黙ったエンジンを見つけるため」と書いてあり、**その目的とも食い違う**。

### R13-H2 `ponderhit` で本番へ昇格した探索は、読み筋を1行も出さない（2人が独立に指摘）

`run_search` は起動時の `ponder: bool` を握ったまま走り、それを外から落とす口が無い。
`ponderhit` の昇格が書き換えるのは `Runner` 側の `kind` だけ。

**先読みが当たった手番だけ `searchInfo` が完全に欠落する。**
当たる率はエンジンが強いほど高い。評価値グラフと読み筋が1手おきに、
しかも不規則に途切れる。原因を示すログもイベントも出ない。

しかもこの間引きは**冗長**でもある。先読み中の側は手番ではないので、
`on_search_info` の `is_to_move` が既に落とす。`if !ponder` は先読み中には
何も追加で守っておらず、`ponderhit` の後だけ害をなしている。

`stalled_turn` の doc は「探索タスクの中に締切を置くと `ponderhit` の昇格を
観測できない」と書いているのに、**同じ理由で壊れている `info` の枝が残っていた**。

### R13-H3 `close` の畳み待ちが、畳みの最悪値より短い（robustness HIGH）

1回の畳みの最悪値は `stop` の書き込み（`WRITE_TIMEOUT` 2秒）＋
`SEARCH_STOP_GRACE`（5秒）＝ **7秒**。同じ畳みを見張る `SETTLE_TIMEOUT`（10秒）は
この7秒を根拠に取ってあるのに、**待つ側の `CLOSE_IDLE_TIMEOUT` は6秒**で、
しかもそれを `abort` と分け合っていた（`abort` は `gameover` を最大2回通す）。

`stop` の直後に1.5秒ほど stdin を吸わなかっただけの正常な対局を閉じると、
待ち切れずに警告を出し、`stop` の返事を待っている探索の足元でプロセスを落とす。
**`CLOSE_IDLE_TIMEOUT` の doc が避けようとした事象そのもの。**

テストは `> SEARCH_STOP_GRACE` という弱い式しか見ていないので緑で通る。
**同じ関係を固定する式が2つ並んでいて、片方だけ弱かった。**

### R13-H4 `failure-surfacing.md` に「対局を始められなかった」の行が無い（robustness HIGH）

対局の8行はすべて**始まった後**の失敗。エンジンのパスが違う／評価関数が無くて
即死／`usiok` が来ない／`setoption` が拒まれる——**対局まわりで最も起きやすい失敗**が
1行も無い。

表は「UI を作るときは、この8行を先に読むこと」と締めているので、
読んだ人は**起動失敗の設計を丸ごと落とす**。エンジンのパスを選び直す導線も、
設定タブへ飛ばす復帰経路も検討されない。

9本の対局コマンドのうち F 番号が付いているのは `close_game` だけだった。

---

## その他（MEDIUM）

- **終局時に画面の残り時間が巻き戻る。** `consume` を呼ぶのは `decide_move` だけで、
  `finish` を通る終わり方（時間切れ・投了・中断・裁定・故障）はその手の消費を
  一度も時計に反映しない。エンジンが30秒考えて落ちた対局では、終局と同時に
  残り時間が30秒増える。**時間切れ負けなのに残り時間が正の値で並ぶ**
- **`setoption` の順序が実行ごとに変わる。** `HashMap` の反復順はプロセスごとに
  ランダム。値の解釈が前の `setoption` に依存するエンジンでは、
  同じ設定なのに片方の実行だけ棋力が変わる
- **`start_sfen` を2点しか見ていない。** 同じファイルの `validate_usi_move` は
  指し手を長さ・ASCII・制御文字・空白まで見て弾くのに、より影響の大きい
  `start_sfen` は素通しに近い。壊れた SFEN がそのままエンジンへ出る
- `GameSession::start` の「最初の `go` までを済ませて返る」が偽。`position` と `go` は
  別タスクで、失敗は `game-event` で届く
- 空アームのコメントが実在しない `SearchOutcome::Aborted` を指す。綴りが
  `GameOverReason::Aborted` と衝突し、しかも意味が正反対
- `(G0, E13)` が名指しした `RESULT_FLUSH_MS` は Rust ではなく React の provider にある
- 「※2 の6分岐のうち `A2` の2つは実機でしか踏めていない」が偽。踏めているのは1つ

---

## 見ていない範囲（2人の申告を統合）

- **2人ともエンジンを1本も起動していない。** 所見はすべてコードの読みから
- `game-session.md` の `E1`〜`E18` × `G0`〜`G2` の**全セルの突き合わせ**は今回もしていない。
  robustness は表を開いたが、`ponderhit` / `close` / `(G0, E13)` の周辺だけ
- `protocol.rs` の `start_listening` / `ensure_ready` の世代管理 / flush の順序 / `discard_pending`
- `registry.rs` の `spawn` の中身と `starting` の出し入れ
- `game.md` / `branch-index.md` / `engine.md` / `app.md`、ADR-0004 / ADR-0007
- `src/entities/game-session/**` に単体テストが1本も無いこと以外の突き合わせ

### 再掲を避けたもの（未解決のまま）

r1 の M-6（`accept_continue` の検算が末尾と偶奇だけで、先頭側が食い違った列を通す）、
M-9（`game-event` が `start_game` の戻り前に流れ始める）、
M-5（対局 API のエラーが全部 `String`）。いずれも現物に残っている。

---

## lint / hook で強制できるもの

- **同じ関係を固定する式が2つ並んでいるなら、弱いほうに揃えない**（R13-H3）。
  今回は `the_watchdogs_are_ordered` の中で片方だけ弱かった。直せば再発は防げる
- **2つ以上の enum に同じ綴りのバリアントがある語**（`Aborted` / `Resign` / `Timeout`）を、
  コメントで型修飾なしに書いたら落とす検査。既存の識別子検査は「実在するか」しか
  見ないので、`Aborted` が別の型に実在すると通してしまう。要るのは「一意に解決するか」
- **対局コマンドの `Err` が `failure-surfacing.md` に行を持つこと**（R13-H4）
- **`Handover` の各バリアントがテスト名か assert に1回以上現れること**（`Kind::ALL` と同じ形）

---

## 修正計画と結果

4コミット。`npm run verify` / `npm run verify:rust` とも green。

| 所見       | 直した内容                                                                  | コミット  |
| ---------- | --------------------------------------------------------------------------- | --------- |
| **R13-H1** | 番人に「黙っていること」を条件として足す。`begin_turn` で対にして動かす     | `6175b04` |
| **R13-H2** | 間引きを `on_search_info` の1本に寄せ、`SearchRequest.ponder` を落とす      | `6175b04` |
| **R13-H3** | `CLOSE_ABORT_TIMEOUT` を分け、畳み待ちを10秒に。式を強いほうへ揃える        | `6175b04` |
| MEDIUM     | `SideClock::charge` で終局時に締める。`Over` の emit を `gameover` より前へ | `983e438` |
| MEDIUM     | `options` を `Vec<EngineOption>` に。往復で順序が保たれることを固定         | `1e45ce8` |
| MEDIUM     | `validate_start_sfen` を切り出し、通す形と弾く形を表で並べる                | `1e45ce8` |
| **R13-H4** | F-27（始められなかった）／ F-28（操作が断られた）を足す                     | `1e45ce8` |
| MEDIUM     | `start` の断言、`Aborted` の綴り、`RESULT_FLUSH_MS`、※2 の分岐数            | `1e45ce8` |

### 直し方を変えたもの

**R13-H1** は所見が「`last_info_at` を持って `SEARCH_GRACE` を `info` の途絶にだけ
掛ける」だったが、それだけにすると `info` を出さずに短く考えるエンジンを落とす。
**両方を条件にした**——持ち時間を過ぎ、かつ黙っている。前者だけでは今回の穴、
後者だけでは別の穴が開く。

`turn_clock` と `last_progress` は `begin_turn` の1つの口で対にして動かす。
代入が4箇所あったので、別々に持つと片方だけ更新する経路ができる。

**R13-H2** で `SearchRequest.ponder` を落としたのは、`params` が既に `ponder` を
持っているため。`bool` を別に持つと、また片方が古くなる形が戻る。

### 変異で確かめたもの

| テスト                                                         | 当てた変異                                       | 落ちた |
| -------------------------------------------------------------- | ------------------------------------------------ | ------ |
| `an_engine_that_keeps_talking_is_not_called_unresponsive`      | 持ち時間だけで落とす形に戻す                     | ✓      |
| `the_watchdogs_are_ordered`                                    | `CLOSE_IDLE_TIMEOUT` を6秒へ戻す                 | ✓      |
| `running_out_of_time_ends_the_game`                            | `finish` で締めない                              | ✓      |
| `charging_a_move_that_never_landed_does_not_pay_the_increment` | `charge` が加算を足す                            | ✓      |
| `engine_options_keep_the_order_the_app_put_them_in`            | （型で担保。連想配列に戻すとコンパイルが落ちる） | —      |

### 次のラウンド

**範囲は対局側のまま。** 今回2人とも `game-session.md` の全セルを
突き合わせていないので、そこを名指しで見せる。
