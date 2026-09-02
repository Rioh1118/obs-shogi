# レビュー game-engine ラウンド15

- 日付: 2026-09-02
- 範囲: 対局側とエンジンの層構造。**範囲外**: 解析側
- 走らせた reviewer: rust / architecture
- 対象コミット: `b5c208b`

**生の所見13件**（BLOCK 1 / HIGH 4 / MEDIUM 8）。

## この回で分かったこと

**ラウンド14で入れた構造の変更と、その守り手が、両方とも穴を持っていた。**

- 番人（`stalled_turn`）が人間を巻き込む —— **同じ場所で3回目**
- レイヤ検査が波括弧付きの `use` を1本も見ていない —— **自分で作った機械**

---

## 実害

### R15-B1 1手に10分かけた人間が「エンジンが応答しない」で負ける（rust BLOCK / 自分が作った退行）

ラウンド14で足した `HARD_TURN_LIMIT` の腕が、対局者の種別も持ち時間も見ていない。
**30分切れ負けで11分考えた人間が、残り19分あるのに負ける。**
相手に勝ちが付き、棋譜と画面に「the engine did not answer in time」が残る。

エンジンも無傷ではない。60分の持ち時間で15分の長考をすると、
`enforce_engine_timeout` が偽でも10分で故障扱いになる。

**しかも足したテストは `budget = 24h` を渡していて、この壊れた振る舞いを
assert していた。**

同じ場所で3回目。沈黙条件を足して上限を消し（r14 で発覚）、
上限を戻して人間を巻き込んだ（今回）。片方を塞ぐたびに反対側が開いている。

### R15-H1 レイヤ検査が波括弧付きの `use` を1本も見ていない（architecture HIGH / 自分が作った機械）

`use crate::engine::{types::*, utils::cmd_summary};` は先頭が `{` なので
辺として1本も記録されない。**`protocol` は「依存ゼロ」で通っていた。**

ADR-0008 が「これが強制する」と書いた規則が、書き方ひとつで素通りする。
`use crate::engine::state::X` は落ちるのに `use crate::engine::{state::X}` は通る。

走査の空振りも見ていなかった（辺が0本でもモジュール名は並ぶ）。

### R15-H2 全順序が許可を生んでいた（architecture HIGH）

`game` と `analyzer` は互いを知らないのに上下を付けていたので、
**解析のファサードが対局の台帳を持つ形——r1 の H-7 で環になっていたその辺——が
「上から下」として通る。**

環にならないのは `AppState` を分けた副作用にすぎず、`game` が `state` の
何かを必要とした瞬間に環が戻る。

### R15-H3 `engine/` の外への `use` を1本も見ていなかった（architecture HIGH）

`use crate::engine::` で始まらないので段の走査に現れない。
実際、**自分が置いた `the_close_budget_is_deliberately_short` が
`crate::CLOSE_TIMEOUT` を引いていた**（段の一番上より、さらに上）。

### R15-H4 `spawn_blocking` に逃がしただけで上限が無い（rust HIGH）

`protocol.rs` の型は「`spawn_blocking` **＋** `KILL_TIMEOUT`」で、逃がすのは
上限を効かせるための前提。前提だけを写して上限を写していなかった。

応答しないネットワークボリューム上の `engine_path` に対する `canonicalize` は
割り込み不能でブロックする。すると `start_game` の future が返らず、
**フロントの `invoke` は永久に解決しない**（押しても何も起きず、ログにも出ない）。
`initialize_engine`（解析）も同じ `spawn` を通る。

### R15-H5 TS 側の doc が2箇所とも現物と逆（architecture HIGH）

**フロントを書く人が読むのは Rust の doc ではなくこの2ファイル。**

- `ClocksView.running`「3 は毎手通る」→ 既定では**一度も起きない**。
  「毎手 null」と決め打つと、期限を捨てて次の `clockUpdated`（最短500ms）まで
  持たないコードになる——doc が避けようとした症状を、doc のとおりに作ると起こす
- `startGame`「返ったときには手番側が既に考えている」→ 最初の `go` は待たない。
  `Ok` の後に盤を出してから購読すると、起動直後に終局した対局を取りこぼす

`game-session.md` は r14 で直したので、**表と境界の型が正反対**になっていた。

---

## その他（MEDIUM）

- **同じ判断が2箇所にあった。** `contains_usi_breaking_char` が `analyzer` と
  `game/session` にバイト単位で同一のまま。改行注入の禁止集合はセキュリティの
  判断なので、片方を厚くしたときにもう片方が薄いまま残る。
  **ADR-0008 §3 が潰したはずの形**
- **`setoption` の順序も片方だけ直っていた。** r13 が対局側を `Vec` にした理由
  （反復順がプロセスごとに変わる）は解析側にも同じ強さで当たる
- ADR-0008 の「`stop` の後に `bestmove` を待つかは `verdict_of_stop` 1本」が偽。
  対局側に `outcome_of_stop` があり、`analyzer.rs` 自身のコメントがそれを認めている
- ADR-0008 の「下の段は Tauri を知らない」が偽。`bridge` は `AppHandle` を持つ。
  「まだ逆転していない境界」からも落ちていた
- `state.rs` の doc が、同じラウンドで消した `engine::game::bridge` を指していた
- `MAX_THINK_TIME` と `HARD_TURN_LIMIT` の「同じ10分」が散文だけ
- `TauriEvents::emit` の warn に絞りが無い。`SearchInfo` は `info` 行ごとに出るので、
  一度失敗し始めると**同じ1行がログを一周させ、原因が書かれた最初の warn ごと消える**
- `GAME_EVENT`（宛先の語彙）だけが `game` に残っていた
- `DiscardEvents` は本番に入り、`RecordedEvents` は `cfg(test)`。扱いが割れていて、
  結合テストから出来事を観測できない
- `LAYERS` の `utils` の1行が中身と合っていない（`LogThrottle` と `cmd_summary` を持つ）
- `SearchInfo` だけ IPC の間引きが無い（**推測**。毎秒の行数は実測していない）

---

## 見ていない範囲

- **2人ともエンジンを1本も起動していない**
- `protocol.rs` の `start_listening` / `ensure_ready` の世代管理 / flush の順序
- `registry.rs` の `starting` の出し入れ
- `session.rs` の `mod tests` の個々の中身
- `game-session.md` の57セルは r14 が済ませたものとして踏襲

---

## 修正計画と結果

4コミット。`npm run verify` / `npm run verify:rust` とも green。

| 所見       | 直した内容                                                                          | コミット  |
| ---------- | ----------------------------------------------------------------------------------- | --------- |
| **R15-B1** | 上限を持ち時間に足す。人間には掛けない                                              | `6b5168b` |
| **R15-H1** | 波括弧を開く。走査の空振りも見る                                                    | `33071c7` |
| **R15-H2** | 全順序をやめ、`may_use` の集合に                                                    | `33071c7` |
| **R15-H3** | `engine/` の外への `use` を見る。上限の関係は `engine_timeouts.rs` へ               | `33071c7` |
| MEDIUM     | `timeout_result` の免除を行番号から綴りへ                                           | `33071c7` |
| MEDIUM     | `MAX_THINK_TIME` と `HARD_TURN_LIMIT` の等値を式に                                  | `33071c7` |
| **R15-H4** | `SPAWN_TIMEOUT` を掛ける                                                            | `c95e6c4` |
| **R15-H5** | TS 側の doc 2件を現物に                                                             | `c95e6c4` |
| MEDIUM     | `contains_usi_breaking_char` を `protocol` へ下ろす                                 | `c95e6c4` |
| MEDIUM     | `TauriEvents` の warn を絞る／`RecordedEvents` の `cfg` を外す／`GAME_EVENT` を移す | `c95e6c4` |
| MEDIUM     | `state.rs` の doc、ADR-0008 の偽2件、`LAYERS` の `utils`                            | `c95e6c4` |

### 直し方を変えたもの

**R15-B1** は所見が「(a) 種別を見る **または** (b) 持ち時間に足す」だったが、
**両方**入れた。(b) だけだと、持ち時間の長い人間は守れるが「人間に故障の
番人を掛ける」という筋の悪さが残る。(a) だけだと、持ち時間の長いエンジンが
10分で落ちる。

最初のテストは判別できない値だったので、締切を跨ぐ値に直した
（種別を見ない変異が落ちなかった）。

**`timeout_result` の免除**は所見に無いが、同じラウンドで2回行番号がずれたので
綴りに変えた。行番号だと無関係な1行を足すだけで赤くなり、直す作業が
「番号を書き換える」だけになる——免除の中身は誰も読み直さない。

### 変異で確かめたもの

| テスト                                                     | 当てた変異                                       | 落ちた                     |
| ---------------------------------------------------------- | ------------------------------------------------ | -------------------------- |
| `a_human_taking_a_long_think_is_never_called_unresponsive` | 種別を見ない                                     | ✓                          |
| `talking_forever_still_hits_the_hard_limit`                | 絶対の値に戻す                                   | ✓                          |
| `dependencies_only_point_downwards`                        | `bridge` が波括弧で `game` を持つ（r1 H-7 の辺） | ✓                          |
| `the_game_and_the_analysis_wait_the_same_for_one_move`     | `MAX_THINK_TIME` だけ動かす                      | ✓                          |
| `the_exempt_list_points_at_real_lines`                     | 免除の綴りを消す                                 | ✓                          |
| （同上）                                                   | 無関係な1行を足して行をずらす                    | **落ちない**（狙いどおり） |

### 自分が作った退行

- **R15-B1**（r14 で入れた）。同じ場所で3回目
- **R15-H1 / H2 / H3**（r14 で入れた機械）。**「これが強制する」と ADR に
  書いたものが、書き方ひとつで素通りしていた**
- ADR-0008 の偽2件、`state.rs` の死んだパス（どちらも r14）

### 次のラウンド

構造の変更が一巡した。**ラウンド16は範囲を狭めず、対局側を通しで見る。**
