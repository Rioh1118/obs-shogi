# 対局エンジン レビュー ラウンド35

- 日付: 2026-09-03
- 対象: `worktree-wt-game-engine`（`origin/main...HEAD`）。PR #385
- 範囲外: `analyzer.rs` / `bridge.rs` の中身（#371）、#381、#382、#383、#384
- 観点: rust / comment / robustness の3本。**変異試験を許した rust は単独で回した**

**所見10件。数は … → 11 → 15 → 14 → 17 → 10。**

**これが最終ラウンド。** `/implement` は所見0件のラウンドが出るまで回すことを求めるが、
**この PR はそこまで行っていない。** 打ち切りはユーザーの判断（「あと1ラウンドで PR 出します」）。

**10件のうち2件は、このラウンドの中で私が作った退行。**
R35-H1 を直した結果が R35-H2 と R35-M2 を生んでいる（下記）。

**回し方の事故は無い。** ラウンド34と同じく、変異を当てる1本を単独で先に回し、
読むだけの2本をその後で並列にした。ただし**1本目の後に `origin/main` を取り込み、
R35-H1 / R35-M1 を直してから**残り2本を回したので、**3人が同じツリーを見ていない**。
rust の所見2件は取り込み前のツリーに対するもの。

---

## 所見

### R35-H1 `usiok` が来ない設定ミスが、再試行の目印を名乗る（rust）

`src-tauri/src/engine/protocol.rs`。`get_engine_info` の打ち切りが
`EngineError::Timeout(format!("{TIMED_OUT} waiting for usiok"))` だった。

`/bin/cat` を `engine_path` に渡して実測——`canonicalize` も `is_file` も
`Command::spawn` も通り、`usi` を送っても `usiok` は来ない。フロントに届くのは
`"timed out waiting for usiok (while starting 先手)"` で、ラウンド34で締めた契約
（`TIMED_OUT` で**始まる**なら「遅かっただけ。設定は誤っていない」）に従うと
**パスを直す導線が一度も出ない**。再試行しても30秒かけて同じ結果になる。

**直した。** 打ち切りを `EngineError::StartupFailed` にし、`NO_USIOK` の綴りを
定数で持たせた。`registry.rs` に `/bin/cat` で踏む逆向きの表明を1本足した
（`#[cfg(unix)]`。変異——`Timeout` に戻す——で落ちることを確認）。

### R35-H2 締切で削った取り分の `usiok` 待ちが、エンジンのせいになる（robustness）

**R35-H1 の退行。** `prepare_engine` が渡す `for_usiok` は定数ではない。

```rust
let for_usiok = USI_OK_TIMEOUT.min(left.saturating_sub(for_spawn));
if for_usiok.is_zero() { return Err(format!("{TIMED_OUT} before the engine said usiok")); }
```

`START_TIMEOUT` は2体ぶんの合計で、1体目の `readyok` は評価関数の重いエンジンで
合法に数十秒を使う。その後ろに立つ2体目の取り分は **0 と満額の間の任意の値**になる。
**0 だけが断られ、1ミリ秒は通る。** そこで答えが来なければ、R35-H1 以後は
「そのファイルは USI エンジンではない」として届く——これは締切の食い潰しであって
設定の誤りではない。受け手は正常なエンジンのパスを疑い、押し直せば通ったはずの
起動をそこで捨てる。

`a_thin_budget_never_starts_an_engine_it_cannot_wait_for` はこの害を doc で名指し
しているが、守っているのは**厳密に 0 のときだけ**だった。

**直した。** `usiok_refusal` を足し、**満額を渡したときだけ**エンジンのせいにする。
純関数なので実プロセスは要らず、4通り（満額 × 綴りの有無）を直に当てた。
変異3件——満額かどうかを見ない／変種だけ見て綴りを見ない／部分一致で見る——で
落ちることを確認。

### R35-M1 走査の免除が、包まれた分解の腕に効かない（rust）

`src-tauri/tests/timeout_marker.rs`。ラウンド34で足した `is_arm` は閉じ括弧の
直後1文字しか見ないので、`Err(EngineError::Timeout(why)) => …` が免除されない。

変異で確認——`search.rs` の `Err(EngineError::Timeout(_))` を `(why)` にして
理由をログに載せると `every_timeout_carries_the_marker` が落ちる。
**満たしようがない**（分解した名前に目印の綴りは入れられない）。

**直した。** 閉じ括弧を読み飛ばしてから `=>` を見る。純関数として1本足した
（現物に該当する腕が1つも無いので、現物だけを食わせても差が出ない）。

### R35-M2 断り文句が `in 0s` になる（robustness）

**R35-H1 の退行。** `timeout.as_secs()` は切り捨てるので、R35-H2 の経路で出る
文言は literally `… did not answer \`usi\` with \`usiok\` in 0s` になる。
**この文言は利用者にそのまま見せる契約**（F-27）なので、
「0秒しか待っていないのにファイルのせいにしている」行が画面に出る。

R35-H1 が同時に足した表明も `Duration::from_millis(400)` を渡していて、
`contains("usiok")` しか見ていないため**この壊れた表示を緑で通していた**。

**直した。** `{timeout:?}` にし、表明に「渡した上限が文言に読める形で載ること」を
足した（変異——`as_secs()` に戻す——で落ちることを確認）。

### R35-M3 出口の無い失敗の索引が、後から足した行を取り落とす（robustness）

`docs/state-transitions/failure-surfacing.md` §4。列挙が F-28 で止まっているのに、
直後の地の文は「F-19 以降は出口が1つも無い」と書いている。F-29 / F-30 は
このブランチで新設され、両方とも抽出条件を満たす。**同じ節の中で列挙と要約が食い違う。**

**直した。番号を足すのではなく、後半の写しをやめた。** 「F-19 以降のすべて」と
条件で書く。同じファイルが「数はここに書かない——経路が増えるたびにずれる」と
既に決めているのと同じ理由。

**ラチェットは足していない。** 抽出条件は §2 の散文（「いま起きること」）に対する
意味の判定で、機械化するとラウンド25〜27で落とした形の機構になる。
写しを消したことで、行が増える側での取り落としは起きない。

### R35-H3 ADR-0007 が、名指ししたラチェットの現在値と違う数を書いている（comment）

`docs/decisions/0007-serde-wire-naming.md`。「`26` と `2` だけは
`serde_naming.rs` が持つ」と書いたうえで、同じ文書が `26` を5箇所に写していた。
現物は `BASELINE = 25`、`EXEMPT` は12件（ADR は「境界外の11型」）。

**ADR-0008 決定3（判断を1箇所に置く／写しはずれる）を ADR-0007 自身が破っている。**

**直した。数を直すのではなく、写しをやめた。** 5箇所とも `BASELINE` /
`UNTAGGED_ENUM_BASELINE` / `EXEMPT` の名前で書く。
`engine/types.rs` の11型は数え直して正しかったので残した（rename 無しの型が11）。

### R35-M4 ADR-0007 が、この PR で解消した食い違いを現在形で挙げている（comment）

`AnalysisUpdate` は `session_id` で出ている、と書いてあるが、このブランチで
`rename_all = "camelCase"` が付いている。**同じ PR が直したものを「残っている」と
書いている。**

**直した。** 残っているのは `listenToAnalysisComplete`——Rust が
`analysis-complete` を一度も emit していない（`grep` で0箇所）——という
**読み手だけがある**形で、綴りの問題ではないと書き直した。

### R35-M5 沈黙の腕の理由に、その腕が見ていない値が挙がっている（comment）

`game-session.md` の ※12 と `session.rs` の `stalled_turn` の doc。
「3 の沈黙条件が無いと、時計が尽きた側の `budget_ms` は 0 に張り付くので…」と
書いてあるが、**腕3 は `budget_ms` を参照していない**。沈黙条件を外したときに
起きるのは「一度でも喋ったエンジンが `SEARCH_GRACE` で必ず落ちる」で、
持ち時間が満額残っていても同じ。

**この repo で4ラウンド続いた「理由と条件式が指せない」故障そのもの。**

**直した。** 表からは持ち時間の節を落とし、`stalled_turn` の doc は
2本の腕を段落で分けて、どちらが持ち時間を見るのかを明示した。

### R35-M6 `lib.rs` が、同じファイルの定数 doc が禁じた形で秒を書いている（comment）

`CLOSE_TIMEOUT` の doc は「**式で持つ。** 内訳を散文で数えると、上限を1つ
増やしたときに数え直す口が無い」と書いている。その125行下で
`shut_down_engines` が「合計で最大8秒」と手計算を書いていた。
`failure-surfacing.md` の F-25 は同じことを定数名で書いている。

**直した。** `最大 CLOSE_TIMEOUT ＋ SWEEP_TIMEOUT` に置き換えた。

### R35-M7 `game/` の公開面が裸（comment）

`GameManager` の型と `new` / `start` / `submit_move` / `continue_game` /
`end_by_rule` / `resign` / `abort` / `snapshot`、`run_search`、`SearchRequest`、
`GameResult`、`ClocksView` に `///` が無い。内部の匿名関数には数十行の doc が
付いているのに、`cargo doc` に出る面が空。

`CONTRIBUTING.md` は「公開する関数・型に `///`。**呼び出し順の制約**を明記」と
決めている。`GameManager::start` は「購読を先に張らないと最初の `TurnChanged` を
必ず取りこぼす」という順序の制約を持つのに、それが書いてあるのは1段下の
`GameSession::start` と1段上の TSDoc だけだった。

**直した。** 制約は写さず、`→ GameSession::start` で指す形にした（決定3）。
`GameManager::close` の `Rejection`（非公開型）への参照も、公開の doc から
読める形（「断り方は3つ。呼び直す意味があるのは3つ目だけ」）に書き換えた。

---

## 反論・見送り

無し。10件すべて所見どおりに直した。

**ラチェットを1本も足していない。** R35-M3 と R35-H3 はどちらも
「写しがずれた」形で、レビュアーは走査での機械化を提案した。**写しそのものを
消したので守る対象が無くなった**——機構を足さずに済む側を採っている。

## 見ていない範囲（レビュアーの申告をそのまま残す）

- **実プロセスを要する経路は、起動の失敗2種を除いて1つも踏んでいない。**
  `gameover` が実際にワイヤへ出ること、`ponderhit` の書き込みが落ちたときは未検証
- `clock.rs` の中身（秒読み・フィッシャーの遷移、`ClockOutcome`）
- `session.rs` の 700〜1300 行と `mod tests` の大半
- `analyzer.rs` / `bridge.rs`（#371）
- `game-session.md` の表のセルと現物の突き合わせ（このラウンドでは grep のみ）
- `.claude/hooks/verify-gate.sh` の差分

## 検証

`npm run verify` と `npm run verify:rust` を、**10件それぞれのコミットの前に**通した。
`git commit` は `.claude/hooks/verify-gate.sh` が横取りするので、
落ちたコミットは1件（`commentHistory` が私の書いた「〜ていなかった」を拾った）。

**変異を当てたのは4件**（R35-H1 / R35-H2 は3通り / R35-M1 / R35-M2）。
残り6件は doc の修正で、当てる対象が無い。
