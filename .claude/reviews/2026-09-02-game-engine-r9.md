# 対局エンジン レビュー ラウンド9

対象: `worktree-wt-game-engine`（`3c965cd..HEAD` の r8 の4コミットを焦点に）
観点: rust / robustness / comment の3本を並列
日付: 2026-09-02

## 総括

**所見20件（重複を畳んだ後）。** BLOCK 3 / HIGH 6 / MEDIUM 11。

### r8 の集約は、その集約自身の doc で偽になった

r8 は「保証の範囲を実装より広く書く」を止めるために、**断言を機械が引ける形へ移した**。
`dispatch_for` を3引数に畳み、写像の表24行をテストにした。

**その表と doc に3つの穴があった。**

| 何                                               | 現物                                                              | 所見  |
| ------------------------------------------------ | ----------------------------------------------------------------- | ----- |
| 「判断はここ1本」                                | 同じコミットで足した `run_writer` の `stalled` が2つ目の断る口    | R9-B1 |
| 「写像の全域を表で固定する」                     | `requires_ready` の3つ目 `UsiNewGame` が0行。36通りのうち24行だけ | R9-B2 |
| 「`Err(Timeout)` はその1件が本当に書けなかった」 | `timeout` は `spawn_blocking` を**中断しない**                    | R9-B3 |

**5ラウンド連続で、私が新しく書いた断言が次のラウンドで偽になっている。**

### 数を書くたびにずれている

- `validate` の「弾くのは2つだけ」→ 3つ
- `MAX_TIME_MS` の理由（panic / 0への巻き戻り）→ 同じコミットの `saturating_add` で起きない
- `game-session.md` の「どちらを超えてもプロセスが残る」→ 3行上の説明が否定
- `registry.rs` の「`quit` の上限は `send_command` の中」→ r8 で `run_writer` へ移した
- F-26 の「`restart` は呼び出し元が0」→ 1つある
- `Dispatch::Queue` の「`readyok` まで積む」→ flush 中も積む

---

## 実害

### R9-B3 `timeout` は `spawn_blocking` を中断しない（robustness HIGH）

```rust
let write = tokio::task::spawn_blocking(move || { ... h.send_command(&command) ... });
let written = match tokio::time::timeout(WRITE_TIMEOUT, write).await {
    Err(_) => { stalled = true; Err(EngineError::Timeout(...)) }
};
```

`JoinHandle` を drop するのは detach するだけ。詰まっていた `write_all` は、
エンジンが stdin を吸った瞬間に完走して**コマンドをワイヤへ出す**。

筋道: 解析で `go infinite` が2秒で切られる → 画面は「解析していない」に戻る →
その後で detach されたタスクが `go infinite` を書き終える → **エンジンが全コアを回す** →
`Closed` が立っているので `stop` はもう書けない。

**r8 のコミットメッセージの「`Err(Timeout)` が『その1件が本当に書けなかった』を
意味するようになり、`fail_writes` の根拠が初めて成立する」は偽。**

### R9-B4 起動途中のエンジンが終了フックから見えない（robustness HIGH）

`registry.rs` の `UsiEngineHandler::spawn`（子プロセスが生まれる）から
`processes.insert`（台帳に載る）まで、`get_engine_info` の `USI_OK_TIMEOUT` = **最長30秒**の窓がある。

その窓で Cmd+Q すると `close_all` も `shutdown_all` も空を見て0ミリ秒で返り、
**エンジンは孤児として残る**。対局開始は「数十秒かかる」と自分の doc に書いてある操作なので、
待ち切れずに閉じるのは普通の操作。

台帳の F-25 は「落とし切れなかった」しか書いておらず、**落としに行きもしないこの経路が抜けている**。

### R9-B5 `STALLED` が要る経路に届いていない（rust HIGH）

`fail_writes` が立てるのは `ReadyState::Closed` なので、詰まった後に `send_command` に
入る呼び出しは `dispatch_for` の `Refuse` で全部 `CLOSED`（"engine output has ended"）を返す。

`STALLED` が返るのは、詰まった瞬間に既に mpsc に並んでいたぶんだけ。対局中の列の深さは通常0〜1。

**エンジンは生きていて出力も続いているのに「出力が終わった」と表示される。**
r8 が「文言が事実と違う」を直すために新設した定数が、その文言が要る経路にほぼ届いていない。

### R9-B6 解析の3つの入口のうち2つが「探索中か」を見ていない（rust HIGH）

`ensure_no_active_session` を通るのは `start_infinite_analysis` だけ。
`analyze_with_time` / `analyze_with_depth` は無限解析中でも2本目の `go` を出す。

さらに `analyze_with_depth` は `depth >= target` を満たした後**打ち切りのフラグが無い**ので、
`bestmove` まで届く `info` の**すべて**で `stop_analysis()` を呼ぶ。
そして r8 で `stop_analysis` は必ず `infinite_listener` を外すようにしたので、
**無限解析が黙って畳まれる**。

フロントに呼び出し元は無いが、`lib.rs` に登録済みの Tauri コマンドなので1行で踏める。

---

## 写像の穴（r8 の集約に対して）

### R9-B1 「判断はここ1本」が同じコミットで否定されている（comment BLOCK）

断る口は3つある。`dispatch_for` の `Refuse`、`run_writer` の `stalled`、
列そのものが閉じたときの `NotInitialized`。

`fail_writes` の doc は正しく「後続を断るのは `run_writer` の `stalled` の側」と書いていて、
`dispatch_for` の doc と正面から矛盾する。

同じ形が `write` にもある。doc「**上限はここだけ。**」の8行下に
本文「**ここでは待つだけ。** 上限は `run_writer` の中で」。

### R9-B2 表が「全域」を主張しているのに `UsiNewGame` が0行（comment BLOCK / rust MEDIUM）

`requires_ready` は `UsiNewGame | Go | Position` の3つ。表に `usinewgame` は無い。
**`requires_ready` から `UsiNewGame` を落としても表は緑のまま通る。**

手書きの24行は、`ReadyState`（3）× `draining`（2）× コマンド（6）＝36通りのうち12通りを覆っていない。

### R9-M1 到達しない `match` アームが残っている（rust / comment）

早期 return の後に同じ条件の `match` アームがある。
**r8 が R8-M4（`fail_writes` の常に真の `if`）として落としたのと同じ形が、同じコミットで新設された。**

### R9-M2 `IsReady` と `Quit` が積まれるが、flush は固有の後処理を飛ばす（rust / comment）

`draining` 中は `Stop` 以外を全部積むので、`IsReady` と `Quit` も積まれる。

- `IsReady`: flush は `write()` を直に呼ぶので `start_ready_watch_and_send` を通らない。
  世代も上がらず `readyok` を待つリスナーも登録されない。**`readyok` の返事を待たずに
  `position` / `go` が流れる**
- `Quit`: `terminate` が積んだ `quit` を、直後の `kill_engine` → `discard_pending` が捨てる。
  300ms 待って何も書かずに強制終了する

### R9-M3 `Stop` を通す判断が、書かれていない不変条件に載っている（rust MEDIUM）

flush が `pop_front` した後で `stop()` が走ると `cancel_queued_go` は 0 を返し、
`stop` が `go` を追い越しうる。守っているのは
**`pop_front` から `writer.send` までに await 点が1つも無い**ことだけ。

---

## doc の食い違い

### R9-M4 `WRITE_TIMEOUT` の在り処を3箇所の doc が r7 のまま指している（rust / comment）

r8 で `run_writer` へ移したので、**`send_command` から見た保証は無くなった**
（実時間は `(前に並んでいるジョブ数 + 1) × WRITE_TIMEOUT`）。
`SETTLE_TIMEOUT` の 10秒も `CLOSE_IDLE_TIMEOUT` の 6秒も、消えた保証から算出している。

### R9-M5 `MAX_TIME_MS` の理由が同じコミットで起きなくなった（comment HIGH）

doc は「上限が無いと `u64` の加算が溢れる。debug では panic、release では 0 に巻き戻る」。
同じコミットで `saturating_add` を入れたので、上限を外しても起きない。
テスト名 `validate_rejects_times_that_would_overflow` も同じ嘘を持っている。

### R9-M6〜M11

- `validate` の doc「弾くのは2つだけ」→ 3つ（comment BLOCK）
- `game-session.md`「どちらを超えてもプロセスが残る」→ `CLOSE_BUDGET` は掃除が拾う（comment HIGH）
- `registry.rs`「どちらを超えてもプロセスが残る」→ `quit` 側は `kill` へ進む（comment HIGH）
- `Dispatch::Queue` / `Pending` の「`readyok` まで」→ flush 中も積む。
  `push_pending` の**呼び出し側へ返る英文**が `the engine has not returned readyok` で、
  `readyok` が既に返っている状況でその文言を返す（comment HIGH）
- F-26 の「`restart` は呼び出し元が0」→ `provider.tsx` に1つある（robustness MEDIUM）
- F-25 の「`error` ログにしか出ない」→ 3経路のうち2つは `warn`（comment MEDIUM）

### R9-M12〜M16

- `analyzer.rs` の「`fail_writes` が `Closed` を立てるようになったので」は**変更の経緯**（comment MEDIUM）
- `_BUDGET` が時間の定数の3つ目の接尾辞。時計の `budget_ms` と衝突（comment MEDIUM）
- `send_command` / `quit` が `pub` なのに、**`Ok` が「書けた」を意味しない**ことが公開面に無い（comment MEDIUM）
- TS の `TimeLimit` に、Rust が弾く3条件が1つも書かれていない（comment MEDIUM）
- スクルーティニ位置のロックガードが5箇所。うち1つは `.await` をまたぐ（rust MEDIUM）
- `Exit` の経路で最大8秒使うのに、doc は「OS が待つ時間が短い」を懸念として挙げている（comment MEDIUM）

---

## 収束していない。原因は1つに絞れた

件数: 20 / 17 / 16 / 15 / 16 / 20 / 20。**7ラウンド減っていない。**

だが r9 で原因がはっきりした。**私が散文で書く「数」と「一意性」が、書いた次のラウンドで必ずずれる。**

r8 の対策（写像の表）は方向として正しかったが、**表を手書きにしたので同じ穴が開いた**。
24行は私が選んだ24行で、36通りのうち12通りを覆っていない。

**r9 の方針: 数を散文から消し、データから導く。**

1. 表を `ReadyState` × `draining` × コマンド列の**二重ループ**にする。手で行を選ばない
2. `requires_ready` を `const` の配列にして、表がその全要素を回す
3. doc から「N つ」「ここ1本」を落とす。数えたいなら `const` の `len()` をテストが見る
4. Rust 版の `commentHistory` を足す（現物の該当は1件）

## 見ていない範囲

3人とも共通:

- **実機のエンジンを1つも起動していない。macOS の Cmd+Q も試していない**
- 対局のフロント UI は存在しない

個別:

- `game-session.md` の `E1`〜`E18` × `G0`〜`G2` の全セル（r7 から3ラウンド持ち越し）
- `failure-surfacing.md` の F-1〜F-24
- 持ち越し（H-6 / R2-H5 / M-3 / M-6 / M-7）

**`tauri.conf.json` の capabilities は r9 で確認した**（4ラウンド持ち越しが解消）。
`opener` は `$HOME` 配下の棋譜拡張子にスコープされ、`process` は `allow-restart` のみ、
CSP も `default-src 'self'`。過剰な権限は見つからなかった。

## 3人が「見たが問題が無かった」と明記した範囲

- `stalled` はプロセス単位で正しい（`run_writer` はハンドラ1つにつき1回だけ spawn）
- `write()` の `rx.await` は必ず返る
- 終了フックの `Once` + `block_on` は panic せず、`app.emit` も fire-and-forget なので塞がない
- `TimeLimit::validate` の上限、`saturating_add`、`checked_sub`、`stop_analysis` の `?` の位置、
  flush の失敗側の世代確認、`position` / `go` のラベル分けは意図どおり直っている

---

## 修正計画

### 第0群: 数をデータから導く

1. 表を二重ループにする（R9-B2 / R9-M1）
2. `requires_ready` を `const` 配列に。表がその全要素を回す
3. doc から「N つ」「ここ1本」を落とす（R9-B1 / R9-M5 / R9-M6〜M11）

### 第1群: 実害

4. **R9-B3** `Timeout` の意味を「書けたか分からない」に落とす
5. **R9-B4** 起動途中のエンジンを台帳に載せる
6. **R9-B5** `STALLED` を `Refuse` の経路にも届かせる
7. **R9-B6** 解析の3つの入口を揃える。`analyze_with_depth` の `stop` を1回に絞る
8. **R9-M2** `IsReady` / `Quit` を `draining` の例外にする
9. **R9-M3** flush の `pop_front` から `writer.send` までを構造で守る
10. **R9-M16** スクルーティニのロックガードを式の外へ

### 第2群: 機械化

11. Rust 版の `commentHistory`（R9-M12）
12. 上限どうしの大小を `const` の `assert!` で（R9-M4）

### 第3群: doc

13. R9-M4 / M9 / M10 / M11 / M14 / M15 と、公開面の契約

## 結果

**所見20件をすべて直した。** issue 送りは無い。

| コミット  | 直した所見                                            |
| --------- | ----------------------------------------------------- |
| `2850764` | R9-B1 / R9-B2 / R9-M1 / R9-M2（写像を全域のループへ） |
| `de301fa` | R9-B3〜B6 / R9-M3 / R9-M5〜M11 / R9-M13〜M16          |
| `1037724` | R9-M12 / R9-M4（機械化2本）                           |

### 集約が効いた証拠

**r8 の表では緑だった変異が、r9 の形では落ちる。**

`requires_ready` から `UsiNewGame` を落とす変異を当てた。r8 の手書き24行では
`usinewgame` が1行も無かったので緑のまま通ったが、
`every_ready_gated_command_is_covered` が落ちる。

`draining` の例外を `requires_ready` に戻す変異も、全域のループが落とす。

### 直したもののうち重いもの

- **`Err(Timeout)` は「書けなかった」を意味しない**（R9-B3）。`timeout` は
  `spawn_blocking` を中断しないので、詰まっていた `write_all` は後から完走する。
  **r8 のコミットメッセージが偽だった。** doc と文言を落とした
- **起動途中のエンジンが掃除から見えなかった**（R9-B4）。30秒の窓がある。
  `starting` に先に載せた
- **`STALLED` が要る経路に届いていなかった**（R9-B5）。詰まった後の呼び出しは
  全部「出力が終わった」と説明していた
- **解析の3つの入口のうち2つが「探索中か」を見ていなかった**（R9-B6）。
  `analyze_with_depth` は目標深度の後も `stop` を撃ち続けて、
  走っている無限解析を畳んでいた

### 足した機械（2本）

| 検査                        | 何を止めるか                          | 効いた証拠         |
| --------------------------- | ------------------------------------- | ------------------ |
| `comment_history`           | Rust のコメントに変更の経緯が入ること | 変異で落ちる       |
| `the_watchdogs_are_ordered` | 上限どうしの大小が散文とずれること    | 関係そのものを見る |

**`comment_history` は `tests/**`も走査する。** 外すと検査の doc に経緯が溜まっても
誰も止められない。実際、コミット時に TS 側の`commentHistory` が
この Rust 版の doc に例として書いた語を捕まえた（累計7回目）。

### 数を散文から消す

r9 で落とした数の断言:

- `validate` の「弾くのは2つだけ」→ 数を書かない
- `MAX_TIME_MS` の理由（panic / 巻き戻り）→ `saturating_add` で起きないので落とす
- `registry.rs` / `game-session.md` の「どちらを超えてもプロセスが残る」→ 片方だけ
- `Dispatch::Queue` の「`readyok` まで」→ 掃きの最中も積む
- `dispatch_for` の「判断はここ1本」→ 断る口は3つ

### 検証

`npm run verify`（645 tests）と `npm run verify:rust`（78 lib + 32）が
どちらも緑。**実機のエンジンは1つも起動していない。macOS の Cmd+Q も試していない。**
