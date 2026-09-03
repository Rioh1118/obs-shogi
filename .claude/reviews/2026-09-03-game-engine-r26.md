# 対局エンジン レビュー ラウンド26

- 日付: 2026-09-03
- 範囲: ラウンド25と同じ
- 範囲外: `analyzer.rs` / `bridge.rs` の中身（#371）、`SPAWN_TIMEOUT` 超過の孤児（#381）
- 観点: rust / comment / robustness の3本。**変異試験を許したのは rust の1本だけ**

**所見12件。数は 39 → 27 → 21 → 24 → 31 → 11 → 13 → 16 → 12 → 12。**

### 支配的な故障は1つに絞れている

12件のうち**6件が「機構を変えたのに、その機構を説明している別の場所が前の姿のまま残る」**。
ラウンド25も12件中7件が同じ形で、**その申し送りを書いた回のコミット自身**が
また同じ形を作っている（R26-M7）。

**残る2件（H1 / H2）は、ラウンド25の修正が現物として不完全だったもの。**
3人のレビュアーが独立に同じ2つへ着いた。

**H1 は two-strikes を満たした**（R25-M6 が5通りの綴りを1つに寄せ、その回に1件取りこぼした）。
`CLAUDE.md` の「同じ失敗を2回するまでルールを足さない。1回目はルールではなくテスト」に従い、
**この回でラチェットにする。**

---

## ラウンド25の修正が不完全

### R26-H1 `TIMED_OUT` の目印が、起動段で**いちばん当たりやすい時間切れ**に入っていない

`src-tauri/src/engine/protocol.rs:1036-1040`（`get_engine_info`）。

```rust
.unwrap_or(Err(EngineError::Timeout(
    "engine did not return usiok in time".to_string(),
))),
```

真隣の `readyok` は書き換えたのに、この1行だけ残っている。届くのは
`failed to start <名前>: Operation timeout: engine did not return usiok in time` で、
**`timed out` が1文字も入っていない。**

`tauri.ts` の契約は「入っていなければ設定側の問題で、再試行しても同じ結果になる」。
評価関数を起動時に読むエンジン、スリープ復帰直後の外付け——**プロセスは正常に起き、
パスも設定も正しい**のに「設定を直せ」と案内される。利用者は正しいパスを疑い、
もう一度押せば通ったはずの起動を捨てる。

主張している側は4箇所（`types.rs` の `TIMED_OUT` の doc、`START_TIMEOUT` の doc、
F-27、`startGame` の TSDoc）。**`grep` で目印を持たない `EngineError::Timeout` は
`engine/` にこの1件だけ。**

同じラウンドで入った `a_startup_timeout_always_carries_the_marker` は
名前で「起動段の時間切れが**必ず**目印を持つ」と主張しながら、呼ぶのは `remaining()` 1本だけ。
doc に限界は書いてあるが、**`cargo test` の出力に出るのは名前だけ**——R24-M4 が挙げた
筋道がそのまま残っていて、今回そのせいで穴が見えなかった。

### R26-H2 絞りの枠を解放する口が無いので、`submit_game_move` を120回撃つだけで「対局ごとの絞り」がプロセスの寿命ぶん死ぬ

`src-tauri/src/engine/commands/game.rs:159-177`。`per_game` から要素を消すコードが
ファイルに1行も無い（`remove` / `retain` / `clear` を grep して0件）。

rust が**変異ではなく現物のまま**確認:

```
for n in 0..MAX_TRACKED_GAMES { throttles.allow("submit_move", &id(&format!("junk{n}"))); }
assert!(throttles.allow("submit_move", &id("real-a")));  // ok
assert!(throttles.allow("submit_move", &id("real-b")));  // panicked: B局の1件目が消えた
```

筋道: webview が `submitGameMove` を**存在しない `gameId` 120通り**で撃つ。
1回あたり `Rejection::Unknown` が返るだけなので、対局を1つも開かずに数十ミリ秒で終わる。
以後 `per_game` は永久に満杯で、**実際に走っている対局の断りは全部6枠に落ちる**。
R24-M6 で直した症状が**恒久化して**戻る。

doc は「拾えないもの: `MAX_TRACKED_GAMES` を超えた後の、新しい対局の1件目」としか
書いておらず、**枠が二度と空かないこと**も**満杯にするのに実対局が要らないこと**も
書いていない。F-28 の「溢れたぶんは操作ごとの枠へ落ちる」も同じ読み違えを誘う。

`a_noisy_game_does_not_eat_another_games_first_line` は名前で一般の性質を主張しているが、
**空の写像からしか始めない**ので満杯の状態を1度も踏まない。

付随: `allow()` は照合のためだけに毎回 `game_id.clone()` し、`fits_in_text()` は
`chars().count()` で全長を走る。**溢れ経路は攻撃者が長さを選べる。**

---

## 機構を変えた先が、doc と連動していない

### R26-M1 `forbids` の検査は本文全体を見るのに、そのテスト自身の要約行だけ「`use` していないこと」のまま

`src-tauri/tests/engine_layering.rs:569`。

ラウンド25はモジュール doc と欄 doc を直したが、**この関数自身の要約行が数え漏れ**。
要約行は `cargo doc` でも grep でも最初に返る。赤を踏んだ人が
「`use` は1行も書いていないのに落ちる＝走査の誤検出」と判断し、`mentions_crate` を
`use_statements` を回す形へ戻す。

### R26-M2 `manager.rs` に新設したコメントが、`closeGame` の**古い**案内を前提にしている

`src-tauri/src/engine/game/manager.rs:158-159`「案内どおりに呼び直すと、この枝は
ミリ秒で回る」。

この行は R25-H3 の修正で新設され、**同じラウンドの R25-M4 が
`commands/game.rs` の同じ引用を直したときに一緒に直っていない**。
現物の案内は「間隔を空けること。数秒に1回で足りる」。

### R26-M3 `(G0, E8)` のテストの要約行が、ふたたび ※6 を名乗っている

`src-tauri/src/engine/game/session.rs:3337`。

ラウンド25は「※6 の順序」→「※6 の `A0` 側」に置き換えたが、
**※6 のどの枝であれ観測していないことに変わりがない**（エンジンへ送ったコマンドを
見る継ぎ目が無い。doc 自身がそう書いている）。

筋道: ※6 の `idle_sides` の送信を消してよいか調べる人が要約行に当たり、
「`A0` 側は固定済み」と判断して落とす。落としても緑のまま通り、
**人対人の対局でエンジンに `gameover` が永久に届かなくなる**（※6 が名指しで警告している形）。

### R26-M4 `CONTRIBUTING.md` の `engine_layering` の行が、4つの検査のうち2つしか説明していない

`CONTRIBUTING.md:310`。`forbids` と「`engine/` の外への `use`」が無く、
逃げ道欄の「共有できる段まで下げる」は外部クレートに対して意味を成さない。

`ratchetIndex` は「見るのは**名前の対応だけ**」と明記しているので機械は止めない。
赤くなった人が最初に開く索引に、**自分の赤に該当する行が無い**。

### R26-M5 `CONTRIBUTING.md` の PR 手順が、状態遷移表を触ったときに `verify:rust` が要ることを書いていない

`CONTRIBUTING.md:383-388` は「`verify` … docs / CONTRIBUTING.md を触った場合」
「`verify:rust` … Rust を触った場合」のまま。ラウンド25で `CLAUDE.md` は直したが、
**`CONTRIBUTING.md` 側だけ残った。**

`verify-gate.sh:6` の見出しも `cargo が見るもの（*.rs / Cargo.*）` のままで、
すぐ下の `case` の直前に書いてある正しい説明と食い違う。

筋道: `CONTRIBUTING.md` を唯一の手順書として読む外部の人（門番は `.claude/` 配下なので
Claude セッション以外では走らない）が、表のテスト列を書き換えて `verify` だけを通し、
「検証済み」として PR を出す。突き合わせの4本は1本も走らない。

### R26-M7 状態遷移表が「`engine/commands/game.rs` にはテストが無い」と書いているが、ラウンド25の同じ回がそこに3本足した

`docs/state-transitions/game-session.md:466-467`。理由として書いてある
「`AppHandle` を要求するので、実機を起こさずに呼ぶ口が無い」も、`RejectionThrottles` には
当てはまらない。

**ラウンド25の申し送りが「機構を変えたら、その機構を説明している場所を全部数える」
だったのに、その申し送りを書いた回のコミット自身が同じ形を作っている。**

### R26-M6 `fits_in_text` は「文章に出せる長さか」の名前で、実際には「静的な写像の鍵として保持してよいか」を決めている

`src-tauri/src/engine/game/types.rs:41-54`。唯一の呼び出しは絞りの鍵の判定。
定数名（`MAX_ID_IN_TEXT`、doc は「**文章に出すときの**長さの上限」）も表示の話をしている。

筋道: ログ1行に出す ID を増やしたくなった人が 48 → 256 に上げる。表示の話だと判断するが、
同時に**無検証の文字列を静的な写像へ保持してよい長さ**が5倍になる。

---

## 失敗経路

### R26-M8 `turnChanged` と `moveDecided` が同じ5秒の枠を共有するので、対局が止まった理由の1行が手番変更の1行に食われる

`src-tauri/src/engine/commands/game.rs:45-48` / `:75-83`、`game/types.rs` の `is_frequent`。

`rare_warn` の doc は「1枠を共有すると、読み筋の失敗で枠を使い切った直後の
`moveDecided` の失敗が黙って捨てられる。**その1行が、なぜ対局が止まったかを説明する
唯一の記録**」と書いているが、守っているのは**読み筋に食われないこと**だけ。

筋道: 早指しでウィンドウを閉じる → `TurnChanged` の失敗が枠を消費 →
1.2秒後の `MoveDecided` の失敗が黙って捨てられる → `RULING_TIMEOUT` で
`over { aborted }` → 残るのは `warn kind=turnChanged` と `error kind=over` の2行だけで、
**F-19 の診断の根拠になる行が無い。**

### R26-M9 `startGame` の失敗の二分に当てはまらない失敗が残っている

`registry.rs` の `failed to run the spawn task`（ブロッキングタスクが落ちた）と
`protocol.rs` の `ready channel closed` は、時間切れでも設定の誤りでもないのに、
いまの文言では「設定側」に分類される。

### R26-M10 溢れ経路の判定が、攻撃者の選んだ長さを全部走る

`fits_in_text` は `chars().count()`。`nth(MAX_ID_IN_TEXT).is_none()` で足りる。
`allow()` の `game_id.clone()` も、照合の前に長さで弾けば避けられる。

---

## 修正計画

### 順

1. **R26-H1**——綴りを直し、**ラチェットを置く**（two-strikes を満たした）
2. **R26-H2 / M10**——枠に解放の口を付け、満杯から始めるテストを足す
3. **doc の非連動**（M1 / M2 / M3 / M4 / M5 / M7）
4. **M6 / M8 / M9**

### この回の申し送り

R25 と同じことを書いても効かなかった（**その回のコミット自身が同じ形を作った**）ので、
書き方を変える。**「機構を変えたコミットの中で、その機構の名前を `grep` して
出た全箇所を開く」**——数えるのではなく、機械的に開く。

## 結果

（`/review-fix` で書き戻す）
