# 対局エンジン レビュー ラウンド34

- 日付: 2026-09-03
- 範囲: ラウンド33と同じ
- 範囲外: `analyzer.rs` / `bridge.rs` の中身（#371）、#381、#382、#383、#384
- 観点: rust / comment / robustness の3本。**変異試験を許した rust は単独で回した**

**所見17件。数は … → 14 → 11 → 15 → 14 → 17。**

**回し方を直した効果は出た。** 変異試験の1本を単独で回したので、他の2本の観測は
汚れていない（ラウンド33では `MAX_ID_BYTES` が書き換わる最中のテストを踏ませた）。

**17件のうち7件がラウンド33の私の変更の帰結。** うち3件は
「直したつもりが別の場所を壊した」形（`abort_within_budget` の握り潰し、
`with_cause` が増やした偽の目印、書式を1本化したはずの掃き出し）。

---

## ラウンド33で私が壊したもの

### R34-H1 状態遷移表が、いま存在しない断り文句を名指ししている（3人とも）

`docs/state-transitions/game-session.md:107`。

```
| **E1** 人間の着手 | … | `Err` "not waiting for a move" | `Err` | △※10 |
```

`grep -rn "not waiting for a move" src-tauri/ src/` は**この doc の1件だけ**。
`c4fb1f3d`（私）が `PENDING_RULING` に置き換えた。

**分けた目的が消える。** `PENDING_RULING` の doc 自身が「呼び出し側は文言でしか
分けられない」と書いている。表を根拠に `if (msg === "not waiting for a move")` を
書くと**どの入力でも一致せず**、裁定待ちの着手（人対人なら毎手ある窓）が
「未知のエラー」に落ちて `ALREADY_OVER` と同じ扱いになる。

同じ行の G2 列も素の `Err` のままで、`ALREADY_OVER` の doc が宣言した
「4つの口で同じにする」が表から読み取れない（綴りを書いているのは E3 / E5 だけ）。

`state_transition_cells` は**散文と文言を見ていない**と自分で書いている。

### R34-M4 `abort_within_budget` の握り潰しで、状態機械が死んでもログに1行も残らない

`session.rs:516-539` / `:556-579`。`93077b45`（私）が `Ok(Err(_)) => {}` にした。

robustness が経路を追った:

1. `close_game` → `Arc::try_unwrap` が通る（busy ではない）→ `session.close()`
2. `abort_within_budget` が `Ok(Err(ENDED))` → **無言**
3. `searches_idle()` も `ENDED` → `idle = true` → `could not confirm searches idle` も出ない
4. `close_game` は `Ok` で返る → `log_rejection` は `Err` のときしか書かない → **無言**

`abort()` が `ENDED` を返すのは **`run_loop` のタスクが消えているとき**だけで、
正常終了なら1行残すので、消えかたは巻き戻り（panic）。
`lib.rs` は panic hook を張っていないので stderr にしか出ず、配布ビルドでは誰も読まない。

**`Over` が一度も出ないまま盤が静止するのに、ログファイルには1行も残らない。**

コミットメッセージに書いた根拠「伝えたいことは `log_rejection` の1行が既に持っている」は、
**busy の枝でしか成立しない**。上の主経路では `close` が `Ok` を返す。

### R34-M5 `Command::Abort` のコメントが、私が消した `debug` をまだ根拠にしている

`session.rs:886-887`「閉じる経路は `Err` を `debug` で受け流すので、ここを断っても
後始末は壊れない」。現物は `Ok(Err(_)) => {}` で、そちらの doc は「**1行も書かない**」。
**同じ関数の2つの説明が正反対。**

### R34-M7 掃き出しの書式は3つある。`DropReason` を通らない2つが、いちばん長い理由を持っている

`protocol.rs:1227-1233`（`begin_generation`）と `:1241-1254`（`discard_pending`）。

`dropped_line` の doc（私が `06a0dd29` で書いた）は
「**理由ごとに書式を分けない。** … 書式が2つあると、テストは片方しか測らないまま
『式で縛った』と読める」と宣言しているのに、**同じ書式を素で書く場所が2つ残っている**。

`discard_pending` の実引数は `"the engine stopped reading stdin"`（32バイト）と
`"the ready wait was aborted"`（26バイト）。測る側が回す `DropReason::ALL` の最長は
`"the flush could not continue"` の **28バイト**——**実在する最長が測られていない**。

どちらも `std::mem::take(&mut pending.queue)` で最大32件をまとめて出す、
測る側とまったく同じ形の突発。いまの値では予算を超えないが、
理由を長くする変更を入れてもテストは1つも動かない。

### R34-M8 `TIMED_OUT` を部分一致で見るので、外来の文字列が「再試行してよい」を名乗れる

`types.rs:73-85` / `tauri.ts:28-36` / `session.rs:1827` / `registry.rs:136-177`。

契約は「**入っていれば『遅かっただけ』**。そのまま再試行してよい（設定は誤っていない）」。
判定は全文への部分一致で、**目印の産地が固定されていない**。

- **確実に踏める形**: `startGame({ black: { kind: "engine", name: "timed out", enginePath: "/nope" } })` は
  `"failed to start timed out: … engine_path must point to an existing file"` を返す。
  フロントは「遅かっただけ」と表示し、**パスを直す導線（F-27 の唯一の導線）を出さない**
- **現実に踏みやすい形**: macOS の `ETIMEDOUT` の `strerror` は `Operation timed out`
  （robustness が実機で確認）。消えた SMB/NFS マウント上の `engine_path` に対する
  `canonicalize` / `Command::spawn` がその errno を返すと、目印は OS の文言から入る

**`c0a87295`（私）がこの口を1つ増やしている。** `with_cause` を入れる前は
`EngineIo` の `Display` が OS のメッセージを捨てていた。

`timeout_marker` と `a_startup_timeout_always_carries_the_marker` が見ているのは
**順方向だけ**（こちらの時間切れが必ず目印を持つ）。逆方向の表明は1つも無い。

### R34-H2 テストの doc が、同じコミットで書いた `finish` の doc と正反対（rust + comment）

`session.rs:3838-3840`「切る行が `over_line` より後ろにあっても … **順序を留めるのは
この表明だけ**」に対し、`finish`（`:1576`）と `over_line`（`:2118`）はどちらも
「**ログは順序に頼らない**」。

rust の変異 M7 で実測: 切る行をログの後ろへ移して**13スイート緑**。
しかもこの表明は `runner.phase`（既に切られた値）から線を組み直すので、
**原理的に順序の変異を落とせない**。

読んだ人は (a) テストが壊れたと判断して表明を消すか、
(b) `over_line` の `shown` を「二重で無駄」と読んで外す
（→ `endGameByRule(id, null, "x".repeat(300_000))` 1回で予算を一周）。

### R34-M3 テストが改名前の `op` の綴りを8箇所で使い続けている（rust + comment）

`commands/game.rs:426` / `:514` / `:539` / `:566` / … の `"submit_move"` / `"close"`。
`93077b45`（私）が本番側だけ揃え、F-28 に「`op` の綴りはコマンド名と同じ」と書いた。
**この2語はどこにも実在しない。**

併せて（comment）: その契約が **Rust のどこにも書かれていない**。
`log_rejection` の doc は `op` について何も言わず、近くの実例は違う綴り。

---

## 縛ったつもりの式が、まだ縛れていない

### R34-M1 `over_line` と `finish` が別々に切るので、ログと `Over` イベントが黙って食い違える

rust の変異 M8: `over_line` 側だけ `shown(d, MAX_DETAIL_LEN / 2)` にして**13スイート緑**。

`every_way_into_finish_trims_the_detail` の表明3は `emitted == detail`
（どちらも `phase` 由来）を見ているだけで、**ログの1行を文字列として比べていない**。
故障終局を後から追う人は、ログの `detail` と棋譜の `detail` が一致する前提で突き合わせる。

### R34-M2 `with_cause` が対局中の経路で1つも固定されていない（rust）

変異 M5: `protocol.rs` の4呼び出しを `e.to_string()` に戻して**13スイート緑**。

R33-H2 で「いちばん効く」と書いたのは実は**対局中の経路**で、`run_writer` の
`CommunicationFailed` は `SearchOutcome::Failed` を経て `finish` の `detail` になり、
**`Over` イベントと棋譜に残る**。戻すと「エンジンが EPIPE で落ちた」が
再び定型文の1文になる。

`matches!(e, usi::Error::IllegalOperation)` も変異 M3 で緑（未検証）。

---

## 断り方の抜け

### R34-M6 `continue_game` だけが終局済みを `ALREADY_OVER` で断らず、TSDoc に断りが1行も無い

`session.rs:950-959` は `Err("not awaiting a ruling")` を `Phase::Over` にも返す。
`continueGame` の TSDoc は **reject しうることに一言も触れていない**
（他の4つはどれも `game is already over` を明記）。

筋道: `bestmove` → `MoveDecided` → フロントが合法性を判定している数十msの間に
中断が押される → `Phase::Over` → `continueGame` → `Err("not awaiting a ruling")`。

F-28 の復帰導線は「操作をやり直す。**ただし終局済みだけは違う**」で、
その例外は `game is already over` の綴りで見分ける前提。
`continue_game` はその綴りを返さないので、**案内どおりに読むと「やり直す」側に落ちる**。
同じ文言が「まだ `Thinking`（二重呼び出し）」でも返るので、2つの状態を分けられない。

**R33-M6 が着手について直したのと同じ形が、裁定の側に残っている。**

---

## doc が現物と食い違う

### R34-H3 `SearchOutcome::Failed` の意味が、`session.rs` と `search.rs` で逆に説明されている

`session.rs:1147`「`Failed` は出力が終わった側」に対し、産地は5つ
（listen 失敗 / 送信失敗 / 出力の終わり / `stop` の送信失敗 / チャンネル閉塞）で、
当てはまるのは2つだけ。`search.rs:245` は「送る口が無い。**探索中とは限らない**」。

この行は `Activity::Idle` を選ぶ根拠で、`Idle` は `finish` に
「`gameover` を送ってよい側」と読まれる（不変条件3）。
読んだ人は「`Failed` ならプロセスは死んでいる」と信じるので、
`go` の書き込みが `WRITE_TIMEOUT` で切れた（**後から届きうる**）ケースを疑う機会が消える。

`SearchOutcome::Failed(String)` には doc が無い（兄弟4つには全部ある）。

### R34-H4 表が「踏めていない」と書くセルを、足したテストが既に踏んでいる（rust + comment）

`game-session.md:288` / `:483` の `(G2, E1)`。
`a_finished_game_refuses_every_move_and_verdict_the_same_way` が
`"submit_move"` を回して踏んでいる（rust の変異 M6 で落ちることも確認済み）。

「埋まっていないセル」は次に着手する人の作業リストなので、
**既にあるテストを二重に書く**か、逆に「誰も見ていない」を根拠に
`is_over` の早期 return を消す判断が通る。

### R34-M9 `LOG_FILE_BUDGET` の doc が数え落としている

`utils.rs:204`「**予算にも乗っている値が1つ**」だが、`MAX_PATH_IN_LOG_LEN` の doc は
「上は予算の式が止める」と書き、そのテストは実際に `LOG_FILE_BUDGET` と比べている。
**2つ。** 索引に無い式が赤くなった人は、doc 自身が禁じている読み方
（「関係の無いラチェット」）へ倒れる。

### R34-M10 `the_registry_lines_…` の doc が「見るのは2つ」のまま3つ目を見ている

`registry.rs:412`。下側（`…` で終わらないこと）を足したのに doc が古い。
「見るのは2つ」を根拠に新しい1行を足す人は、**下側を押さえないまま**
`MAX_PATH_IN_LOG_LEN` を縮められる状態に戻す。

併せて `:442-447` に重なった2ブロックがあり、前半は「`current_exe` が取れないときの
代替」と読めるが、コードは常に固定のパスを見る。

### R34-M11 `clock.rs` が `TICK` の値を散文へ2回写している

`clock.rs:32-33` と `:335` の「100ms」。R33-M7 で「10分」「32倍」を落とした形の3件目。
`TICK` を 250ms にしても何も落ちず、`SideClock::new` の説明だけが嘘になる。

### R34-M12 `with_cause` の「潰す必要は無い」が、いまの引数にしか当てはまらない

`utils.rs:151-174`。引数は `&dyn std::error::Error`（何でも入る）で `pub`。
`utils` は `shown` を置いている当の場所なので、次に外来の文字列を運ぶエラー型を
通す人が、doc を根拠に無検査で `log::error!` へ流す。

### R34-M13 `MAX_DETAIL_LEN` の理由が2箇所に丸写しされている

`session.rs:2183-2188`（定数）と `:3802-3807`（テスト）。
このコードベースは同じ危険を `GameClocks::view` で「本文を2箇所に置くと
片方だけ直る経路ができる」と明示して避けている。
**現に前ラウンドで、`finish` とテストの doc が片方だけ直って正反対になった。**

---

## 修正計画

### 順

1. **目印の産地を1つにする**（M8）。いちばん実害が大きい
2. **握り潰した失敗を戻す**（M4 / M5）
3. **裁定の口を4つ組に入れる**（M6）
4. **掃き出しの書式を本当に1本にする**（M7）
5. **表明を足す**（M1 / M2 / M3）
6. **doc**（H1 / H2 / H3 / H4 / M9 〜 M13）

### 表の文言を機械で留めるか

3人とも「表の `` `Err` "…" `` が実在することを見る走査」を薦めている。
**これは2度目ではない**（表の文言が腐ったのは今回が初）。
`/implement` の two-strikes に従い、**今回は直すだけ**にする。
ただし、**表側が綴りではなく定数名で指す**形に変えれば、`docsIdentifiers` の
既存の網（識別子の実在を見る）に載る——機構を足さずに機械化できるので、そちらを採る。

## 結果

**17件すべて着手。**

| 所見                     | 直し方                                                                                  | コミット   |
| ------------------------ | --------------------------------------------------------------------------------------- | ---------- |
| R34-M8                   | 目印を**先頭**に固定。`engine_error_text` を新設し、`timeout_marker` を先頭判定へ締める | `18d517bc` |
| R34-M4 / M5              | `ENDED` を握り潰さない。`Command::Abort` のコメントを現物へ                             | `438b72e8` |
| R34-M6                   | 裁定「続く」も `ALREADY_OVER` で断る（5つ組）                                           | `d31503d3` |
| R34-M7                   | 捨てる口を全部 `DropReason` に通す（`begin_generation` / `discard_pending`）            | `4c22e3c9` |
| R34-M1 / M2 / M3         | ログと写しの一致・`listen_error` の分類・`with_cause` の単体・`op` の綴り               | `60adf5ae` |
| R34-H1 〜 H4 / M9 〜 M13 | 表の引用を定数名へ。要約・索引・数字の写し                                              | `32f2e41f` |

### 表の文言を「定数名で指す」形にした

3人とも走査ラチェットを薦めていたが、**表側が綴りをやめて定数名で指せば、
`docsIdentifiers` の既存の網に載る**。機構を1つも足さずに機械化できるので、
two-strikes を待つ必要が無い。

### 目印は「含む」から「先頭」へ

所見は「接頭辞に固定する」を薦めていて、そのとおりにした。ついでに
`timeout_marker` も締めた——**構築の腕だけを見る**必要があったので、
分解（`Timeout(why) => …`）を数から外す規則を1つ足している。

### テストを足していない直しが1件ある

R34-M4（`ENDED` の握り潰し）は差分がログの出し分けだけで、この repo に
ログを捕まえる仕掛けが無い。**仕掛けを1つ入れるほうがこの1件より高くつく**ので、
入れずに報告した。ラウンド25〜27で「診断の機構を膨らませ続けた」のと
同じ轍を踏まない判断。

### 落ちない変異（据え置き）

- `the_log_keeps_a_minimum_of_history_under_rejections` で一番長い `op` を選ぶのをやめる
- `MAX_TRACKED_GAMES` を 32 にする
- `finish` の切り詰めを `over_line` より後ろへ移す（**これは正しい**——
  `over_line` が自分でも切るので順序は結果を変えない）

前2つは上限の不等式の構造上の限界で、ラウンド31から同じことを doc に残している。

### 残した所見

無し。
