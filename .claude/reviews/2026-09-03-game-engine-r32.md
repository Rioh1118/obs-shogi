# 対局エンジン レビュー ラウンド32

- 日付: 2026-09-03
- 範囲: ラウンド31と同じ
- 範囲外: `analyzer.rs` / `bridge.rs` の中身（#371）、#381、#382、#383
- 観点: rust / comment / robustness の3本。**変異試験を許したのは rust の1本だけ**

**所見15件。数は … → 11 → 13 → 14 → 11 → 15。**

**増えた。** ただし出どころが変わっている——ラウンド25〜27で膨らませ続けた
「診断の分類」ではなく、**まだ一度も見ていなかった面**が4つ出た
（`engine_path`・`info` の流量・`PlayerSpec::name`・`get_game_state`）。

---

## ラウンド31の報告に、また誤りがあった

R31-M2 に「robustness が `log::` の全箇所を数え、**残っていたのはこれ1つ**」と書いた。
**数え直すと在庫は3つで、2つ残っている**（rust と robustness が独立に同じ2箇所へ着いた）。

`registry.rs:171` と `:283` の `engine_path`。**塞いだのと同じファイルの、上と下。**
「全箇所を数えた」を私が確かめずに報告書へ写した。

---

## 縛ったつもりの式が、縛れていない

### R32-H1 「最悪の入力」が最悪であることを、`worst_game_id` だけ表明していない。R31-H1 の退行が丸ごと戻せる

`types.rs:101-104`（作る側）と `:526-551` / `commands/game.rs:471-486`（使う側）。

兄弟3つはどれも「最悪の文字が生き残っている」を表明している
（`session.rs:3732` / `registry.rs:394` / `protocol.rs:1670`）。ID だけ無い。

rust の**複合変異**:

| 当てたもの                                      | 結果                     |
| ----------------------------------------------- | ------------------------ |
| `Display` の退行だけ（`used += ch.len_utf8()`） | 2件 FAILED               |
| `worst_game_id` を `"x".repeat(48)` へ          | 全件 green               |
| **両方同時**                                    | **13スイート全部 green** |

つまり**落とせているのは `worst_game_id` の中の `"\n"` だけ**で、それを守るものが無い。
戻ると `rejection_line` は 146 → 332 バイト、`MIN_HISTORY = 30s` の約束が約20秒に縮む。

**直し方**: 不等式ではなく等式を1本。`worst_game_id().to_string().len()` は
いまちょうど `MAX_ID_BYTES + '…'.len_utf8()`（51、実測）。

### R32-H2 `engine_path` が2箇所で無検査のままログに出る。改行を含む実在ファイルでログ行を偽造できる

`registry.rs:171` / `:283`。rust と robustness が独立に着いた。

```rust
log::info!(target: LOGT, "spawn: start path='{}'", engine_path);
log::warn!(target: LOGT, "spawn: disposing a late engine path='{path}'");
```

`canonicalize` + `is_file` は**改行を含むファイル名を通す**（robustness が macOS で実測、
149バイトの改行入りパスが返る）。配布物に `eng\n2026-09-03 ERROR ...` という名前の
実行ファイルを入れて選ばせれば、ログに**偽の1行**が生える。

`GameId::Display` と `validate_usi_move` が名指しで塞いでいる当の形。
**長さは PATH_MAX で頭打ちなので、危ないのは改行のほう。**

### R32-H3 掃き出しの1行は2箇所にあり、**測っていないほうが10バイト長い**

`protocol.rs:260-268`（`report_dropped`、flush が折れた側）と `:146-151`（`dropped_line`）。
測っているのは後者だけ。

`dropped_line` の doc は「書式を別に写して測ると、測っている量と実際に書く量がずれる」と
書いているのに、**もう片方が書式を別に写している。**

rust の実測:

| `MAX_SUMMARY_LEN` | `dropped_line` × 32 × 10 | `report_dropped` × 32 × 10 | 予算    |
| ----------------- | ------------------------ | -------------------------- | ------- |
| 64（現状）        | 101,760                  | 104,960                    | 200,000 |
| 140               | **199,040（green）**     | **202,240（超過）**        | 200,000 |

**理由を潰して1文言にはできない**——`report_dropped` の doc が「届いたか分からない」を
明示的に分けている。文言を引数にして関数を1本にし、**長いほうで測る**。

### R32-M1 `LOG_FILE_BUDGET` の doc が「`MAX_ID_BYTES` は予算と関係が無い」と書いているが、一次で乗っている

`utils.rs:165-168`（ラウンド31で書き直した段落）。矛盾する相手は `types.rs:51-55`
（「縛りたいのは**ログ1行の大きさ**」）。

rust の実測: `MAX_ID_BYTES` は **86 で green、87 で FAILED**。
`(24 + ops) × (50 + 2N) × 30 ≤ 200_000` に一次で乗っている。

「関係が無い」を信じて広げた人は、赤くなったテストを
「関係の無いラチェットが騒いでいる」と読む。

**同時に、余裕が広すぎることも露見している。** 48 の根拠は「UUID の36バイトが収まる」で、
86 まで誰にも気付かれずに広げられる。

---

## 潰しの網から漏れている外来の文字列

### R32-M2 `SearchOutcome::Failed` の文言だけが `shown` を通らずに `detail` へ入る

`session.rs:1155-1162`。robustness と comment が独立に着いた。

`detail:` を代入する10箇所のうち、`shown` も静的文字列も通らないのは**ここ1つだけ**。
そして受け手2つが逆を宣言している——`over_line` の doc（「`detail` は `shown` を通っていて
制御文字が残っていないので `{}` で足りる」）と `finish` の doc（「通った値だけを渡すこと」）。

**いまは実害が無い**（`Failed` の構成箇所6つはどれも英語の定数＋`EngineError` で、
`EngineError` の payload も `usi 0.6.2` の固定文と自前の定数だけ——robustness が
`Cargo.lock` の版で確認）。壊れるのは**次に触った人**で、`search.rs` が `Failed` に
エンジンの出力を足した瞬間に、ログ・`Over` イベント・棋譜の3つが同時に無防備になる。

### R32-M3 `PlayerSpec::name` は `GameSettings` で唯一上限が無く、対局の寿命ぶん保持される

`session.rs:1895-1968`（`validate_settings` に `name` を見る `if` が1つも無い）。

`startGame({ black: { kind: "human", name: "x".repeat(50_000_000) } })` は通り、
`Runner.settings` に保持され、`get_game_state` のたびに 50MB の `String` が2本
作られて JSON へ直列化される。

`GameId::is_safe_to_retain` は同じ懸念を明文化して上限を掛けている。`name` にだけ無い。

`every_way_to_stretch_the_wire_is_checked_at_the_door` は「線に出る1行を伸ばせる経路を
入口で全部見ている」と名乗るが、見ているのは**エンジンへ出る線**だけ。
`name` は**webview へ出る線**（`GameSnapshot`）に載る。

### R32-M4（範囲を跨ぐ） エンジンの `info` は件数も長さも見ずに webview へ流している

`utils.rs:52-78` / `search.rs:154-167` / `session.rs:1070-1096`。

- `InfoParams::MultiPv` は `i32` を `as u32` で受けるので `info multipv -1` は
  `4294967295`。`get_or_create_candidate` に上限が無く、知らない rank は必ず新しい候補を生やす。
  `apply_info_params` は毎回 `sort_by_key` するので N 行で O(N² log N)
- `pv` は行の残り全部を `Vec<String>` に。長さの上限が無い

対局の経路は `on_search_info` → `emit` で、**間引きも上限も1つも無い**。
`run_loop` は `Command::Tick` を同じキューで処理するので、詰まると
**`on_tick` が遅れ、時間切れの検出と `abort_game` の応答も遅れる**。ログには何も出ない。

`CLOCK_EMIT_INTERVAL` は「tick ごとに送ると1秒に10回 IPC を叩く」を理由に 500ms へ
絞ってある。**10Hz を絞って、それより速くなりうる `info` を絞っていない。**

**`utils.rs` の2つ（件数と長さ）は解析経路とも共有。** 間引き（(c)）は
`ponderhit` の昇格の観測に関わるので判断が要る。

### R32-M5 `get_game_state` だけが `log_rejection` を通らない。しかもそれが唯一の立て直しの口

`commands/game.rs:352-358` と `tauri.ts:154-163`。

他の6つは全部 `log_rejection` を通る。`snapshot` は `unknown game:` と
`the game is being closed:` を返しうる。

`get_game_state` は立て直しの唯一の口として3箇所から名指しされている
（`is_terminal` の doc / `commands/game.rs:347` / `emit failed` の
「the app must resync with get_game_state」）。

筋道: `Over` の emit が落ちる → ログに「`get_game_state` で突き合わせろ」 →
フロントが叩く → `close` の窓に入っていて `being closed` で断られる →
**TSDoc にこの文言が1つも無いので、呼び直すのか諦めるのか分からない** →
ログにも1行も残らないので、立て直しが失敗したことすら追えない。

`closeGame` の TSDoc は同じ3分類を全部並べている。要る側に無い。

### R32-M6（判断の明示だけ） `shown` は U+2028 / U+2029 / 双方向制御文字を通す

robustness の実測（`is_control()` は `General_Category=Cc` だけ）:

```
U+2028 LINE SEPARATOR   is_control=false  通る
U+202E RLO              is_control=false  通る
U+FEFF BOM              is_control=false  通る
U+0085 NEL              is_control=true   潰される
```

**ログ行の偽造には効かない**（`tail` も `grep` も U+2028 で分割しない）ので
`shown` の doc が挙げている穴ではない。残るのは
`endGameByRule(id, null, "\u{202E}先手の勝ち")` がログの以降の表示を反転させること。

**今日の産地は自分のフロントだけ**で、TSDoc の「化けるのはこの2つだけ」は現物と合っている。
つまり「doc が嘘」ではなく「契約としてそう決めた」状態。**判断を明示するだけでよい。**

---

## doc が現物と食い違う

### R32-H4 状態遷移表が「数はここに書いてある」と指す先に、その数が無い

`docs/state-transitions/game-session.md:380` は
「**Rust の中で何箇所にあるかは `SideClock::budget_ms` の doc**」と書くが、
一覧を持っているのは `clock.rs:145-151`（`GameClocks::view`）で、
そちらは「**数を書くのはここだけ**（表からはこの doc を指す）」と書いている。

`SideClock::budget_ms`（`clock.rs:56-62`）の doc は「持ち時間の残り＋秒読み」だけで、
**箇所の数も一覧も持っていない。**

「持ち時間を使い切ってから秒読みが減る」を変える人は、表の指示どおり `budget_ms` を開き、
一覧が無いので**そこ1箇所だけ直して終わる**。表自身が警告している
「画面に秒読みが残っているのに時間切れになる」が起きる。
`docsIdentifiers` は綴りの実在しか見ないので緑で通る。

### R32-H5 失敗の台帳の8行が、この作業を含まないブランチを測定元として名乗っている

`docs/state-transitions/failure-surfacing.md` の F-19 / F-20 / F-22 / F-24 / F-26 /
F-27 / F-28 / F-29 / F-30 が `（2026-09-03 / fix/210-kifu-encoding）` を名乗る。

- このワークツリーの branch は `worktree-wt-game-engine`
- `fix/210-kifu-encoding` は棋譜の文字コード判別のブランチで、`engine/game/` を持たない
- 同じ作業を `:173` は `（2026-09-02 / worktree-wt-game-engine）` と書いている

台帳自身の規約（`:13-14`）が求めているのは、**その現物を後から引き当てるため**の
スタンプ。F-27 を疑った人が `fix/210-kifu-encoding` を checkout すると
`engine/game/` が丸ごと無く、**行が古いのか測定が嘘なのかを切り分ける手段が消える。**

**私が測定元を確かめずに書いた。** ブランチ名は worktree を移ると変わるので、
コミットハッシュへ寄せる。

### R32-M7 `MAX_SUMMARY_LEN` の doc が、2本目の式と2人目の呼び出し側を知らない

`utils.rs:144-156`。いまこの定数は `setoption` の名前と**エンジンの名乗り**の2つを切っていて、
式も2本（`SHARE=10` と `SHARE=50`）ある。doc は前者しか挙げていない。

末尾の「実在する option 名はこの1/4も使わない」は**縮める根拠として引用される**。
16 にすると両方の式は上限の不等式なので緑のまま通り、
`spawn: ok id=… name='YaneuraOu NNUE 7…'` とエンジンの名乗りだけが黙って潰れる。

### R32-M8 定数の値を離れた場所へ写した箇所が6つある

`LOG_FILE_BUDGET` の doc が「**数字を離れた場所へ写さない**」と決めている当の規約に対して:

- `utils.rs:151` / `:237`（「32行」＝ `PENDING_LIMIT`）
- `session.rs:253` / `:3125`（「31秒目」＝ `SEARCH_GRACE` ＋1）
- `tests/engine_timeouts.rs:24-25`（「4秒」「3秒」）
- `failure-surfacing.md:97`（「最大8秒」＝ `CLOSE_TIMEOUT` + `SWEEP_TIMEOUT`）

いちばん腐りやすいのは「32行」。`PENDING_LIMIT` を動かした人は
`flushing_the_queue_cannot_rotate_the_log` が落ちて気付くが、
**落ちた後に読む doc が「32行」と書いてある。**

同じことを `game-session.md:301` は `SEARCH_GRACE` と名前で書き、
`CLOSE_POLL` の doc は「**数を書かない**」を明言している。

### R32-M9 `MAX_USI_MOVE_LEN` は `_LEN` だが単位はバイトで、文字数を取る `shown` に渡っている

`session.rs:2084-2088`（doc は「最大の**バイト数**」）、`:2044`（バイトで比較）、
`:2059`（`shown` の第2引数＝文字数）。

ラウンド31は `MAX_ID_LEN_FOR_TEST` を「`_LEN` と『文字数』はどちらも落とした語彙」として
削り、バイトの上限を `MAX_ID_BYTES` に改名した。**その語彙がここにだけ適用されていない。**

いま無事なのは `8バイト ⇒ 8文字以下` が偶然成り立つからで、
その根拠は**呼び出し側の行内コメントにしかない**。

### R32-M10 「終局済みなら断る」の契約が、3つ組のうち裁定だけ Rust にも TS にも無い

`session.rs:459-471`（`end_by_rule`）、`tauri.ts:87-108`（`endGameByRule`）と
`:110-113`（`resignGame`）。

ラウンド31で `resign` / `abort` に置いたが、`end_by_rule` に置かなかった。
テスト `resign_rule_end_and_abort_are_refused_the_same_way` が3つを同じ形と固定しているのに。

`endGameByRule` の TSDoc は「**断らないのは意図**」を強調しているので、reject を受けた側は
「一時的な失敗」と読んで呼び直す。実際には `Phase::Over` は吸収状態なので
**何度呼んでも同じ `Err`** で、`log_rejection` の絞りに掛かってログの1行も残らないまま
無限に叩き続ける。

---

## 修正計画

### 順

1. **測る側を等式で留める**（H1）。ついでに `MAX_ID_BYTES` の doc の依存を直す（M1）
2. **書式が2つある掃き出しを1本にする**（H3）
3. **`engine_path` を載せる側で潰す**（H2）
4. **潰しの網から漏れているもの**（M2 / M3 / M5）
5. **doc**（H4 / H5 / M6 / M7 / M8 / M9 / M10）
6. **範囲を跨ぐもの**（M4）は issue

### R32-M4 を issue に出す理由

`utils.rs` の `apply_info_params` は**解析経路と共有**で、間引き（(c)）は
`ponderhit` の昇格を観測できるかに関わる。ラウンド27で「判断を変えたら、
その判断が正当化していた機構がまだ要るかを測り直す」を適用した対象そのもの。
件数と長さの上限（(a)(b)）だけを先に入れると、解析側の振る舞いを測らずに変えることになる。

## 結果

**15件すべて着手。**

| 所見                    | 直し方                                                                               | コミット   |
| ----------------------- | ------------------------------------------------------------------------------------ | ---------- |
| R32-H1 / M1             | 最悪の ID が上限に届くことを**等式**で留める。`MAX_ID_BYTES` の予算依存を doc に戻す | `d0133b20` |
| R32-H3                  | 掃き出しの1行を `DropReason` で1本にし、**長いほう**で測る                           | `06a0dd29` |
| R32-H2                  | `spawn_start_line` / `disposing_line` を出し、改行と予算の両方を見る                 | `d210898a` |
| R32-M2 / M3             | 説明を切る場所を `finish` の1箇所に。表示名を入口で断る                              | `46a68955` |
| R32-M5                  | `get_game_state` も `log_rejection` を通す                                           | `3fed3eb8` |
| R32-H4 / H5 / M6 〜 M10 | 指す先・測定元・単位・契約                                                           | `daaa4fc5` |
| R32-M4                  | issue #384                                                                           | ——         |

### 「切る場所」を心得から構造へ移した

R32-M2 の所見は「`SearchOutcome::Failed` に `shown` を足す」を薦めていた。
**足さずに、切る場所を `finish` の1箇所へ移した。**

入口ごとに切る形は、終わり方を1つ足すたびに数え直しが要る——現に1つ抜けていた。
`finish` を通せば3つの吸い口（ログ・`Over` イベント・`snapshot`）がまとめて収まり、
`over_line` の doc が根拠にしている前提が**本当に真になる**。

### 上側の背押さえは足していない

`MAX_ID_BYTES` は 86 まで広げても緑（rust が実測）。所見は
`MAX_ID_BYTES <= 48` のような表明を薦めていたが、**リテラルを書き直すだけ**で
根拠（UUID が収まる）を何も表さない。上は予算の式が 87 で止める。

### 走査を1つ見送った

R32-M5 の所見は `rejection_ops()` を「数える」から「網羅を要求する」へ
変えることを薦めていた。`list_games` は `Result` を返すが失敗しないので、
素朴に要求すると**免除の一覧**が要る。免除の一覧は腐るので、
抜けが2度目に出てから形を決める（two-strikes）。

### 落ちない変異を1つ残した（据え置き）

`flushing_the_queue_cannot_rotate_the_log` で長いほうを選ぶのをやめても通る。
ラウンド31に書いたのと同じ構造上の限界で、テストの doc にある。

### 数が増えたことについて

11 → 15。**出どころが変わっている。** ラウンド25〜27で膨らませ続けた
「診断の分類」ではなく、まだ一度も見ていなかった面が4つ出た
（`engine_path`・`info` の流量・`PlayerSpec::name`・`get_game_state`）。
同じ場所を回り続けているのではない。

### 残した所見

無し。
