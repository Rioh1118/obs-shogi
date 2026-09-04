# 対局エンジン レビュー ラウンド7

対象: `worktree-wt-game-engine`（`daef430..754c7db` の r6 の集約7コミットを焦点に）
観点: rust / robustness / comment の3本を並列
日付: 2026-09-02

## 総括

**所見16件。集約そのものは効いていたが、2つの実害を持ち込んだ。**

| 観点       | BLOCK | HIGH | MEDIUM |
| ---------- | ----- | ---- | ------ |
| rust       | 0     | 2    | 4      |
| robustness | 0     | 2    | 5      |
| comment    | 2     | 5    | 4      |

### r6 の集約は効いていた

3人が「見たが問題が無かった」として具体的に挙げた範囲が、r6 の主張と一致した。

- `stalled_turn` は人間の手番で誤爆しない（`has_expired` が必ず先に当たる）
- `on_tick` からの終局は不変条件3 を守る（`Searching` が `idle_sides` に入らない）
- `run_writer` のタスクは輪にならず、リークしない
- 書き込みの列の**順序保証は成立している**（`write()` は `send` を先に済ませてから待つ）
- `stop_analysis` の `CancelledQueued` 経路でストリームは畳まれる（「永久に待つ」は解消）
- `run_loop` の各コマンドの待ちが `WRITE_TIMEOUT` で有界になった

### 持ち込んだ実害は2つ

どちらも「列に入れた」ことの副作用で、**r6 の報告書が見落としていた**。

1. **`Err(Timeout)` が「書かれなかった」を意味しない**（R7-H1、rust と robustness が独立に指摘）
2. **flush の窓は閉じていない**（R7-B1、comment）。r6 の報告書は「列が1本になったので消えた」と
   書いたが、消えたのは `spawn_blocking` 起因の非決定性だけ

---

## 3人が挙げたもの

### R7-M1 削除した `search_deadline` を指すコメントが2箇所残っている（rust MEDIUM / robustness MEDIUM / comment BLOCK）

```rust
// session.rs:115-117（SETTLE_TIMEOUT の doc）
/// **見るのは `TurnClock::Settling` だけ。** `go` を出した後
/// （`Running`）の番人は `search_deadline` のほうで、こちらは畳み待ち専用。

// clock.rs:157-158（budget_ms の doc）
/// 時間切れの判定ではなく、**エンジンが黙ったことを見つける**ために使う
/// （`session.rs` の `search_deadline`）。
```

`search_deadline` は `f4be4e7` で削除した。**内容も嘘**で、`Running` の番人は
いま同じ `stalled_turn` の中にある（30行上の doc がそう書いている）。

**集約は「番人が2つに分かれている」という読み方を消すためのものなのに、
その集約を最も知りたい読み手が読む doc が、まだ2つに分かれていると書いている。**
`docsIdentifiers` は `docs/**` しか見ないので、Rust のコメントは機械に掛からない。

---

## 2人が挙げたもの

### R7-H1 `Err(Timeout)` は「書かれなかった」ではないのに、`run_search` はそう読む（rust HIGH / robustness HIGH）

```rust
// protocol.rs:136-137 — 列の設計そのものがこう書いている
/// 超えても**列から降りるのは待っている側だけ**で、書き込み自体は続く。

// search.rs:122-130 — 上限超過も「送る口が無い」も同じ Failed に潰す
outcome: SearchOutcome::Failed(format!("failed to send go: {e}")),

// session.rs:736-740 — その Failed を「エンジンは止まっている」と読む
SearchOutcome::Move { .. } | ... | SearchOutcome::Failed(_) => Activity::Idle,
```

筋道: `position` が通った直後に `go` の返事が2秒で切れる →
`Failed` → `Activity::Idle` → `finish(EngineFailure)` → `idle_sides` に入る →
**`gameover` が列の `go` の後ろに積まれる** → 書き込みが解けた瞬間、
エンジンは `go` を受け取って探索を始め、その直後に `gameover` を受け取る。

**不変条件3 の違反。`f4be4e7` が構造的に消したはずの R6-B1 が、
書き込み側から同じ形で戻っている。**

**同じファイルの `outcome_of_stop` は `EngineError::Timeout` を他の `Err` と
分けている。** 分けているのは `stop` の口だけで、`position` / `go` の口は
分けていない。この非対称が原因。

### R7-H2 表が削除済みの `STOP_WRITE_TIMEOUT` を指し、`docsIdentifiers` は自分のテスト固定値で緑を返す（robustness MEDIUM / comment HIGH）

`game-session.md:84` が `STOP_WRITE_TIMEOUT`（`add2d4e` で削除）を指している。
それを止めるはずの `docsIdentifiers` が見逃す理由:

```ts
// docsIdentifiers.test.ts:99 — 文字列リテラルなので codeOf は落とさない
expect(missingIn(["WRITE_TIMEOUT"], "const STOP_WRITE_TIMEOUT: Duration")).toEqual([...]);
```

`sourceCorpus()` は `sourceFiles(SRC)` を既定で呼ぶので、この固定値が corpus に入る。
**`docsIdentifiers.ts` の doc は「この検査自身の doc も走査の対象」と警告しているが、
警告はコメントについてだけで、文字列リテラルの穴を塞いでいない。**

### R7-H3 `closeGame` の TSDoc が2枚重なっている（robustness MEDIUM / comment HIGH）

`43c75c1` が既存ブロックを**置き換えず、直後に2枚目を挿入**した。
TS が関数に結び付けるのは直前の1枚だけなので、**1枚目にしか無い情報
（なぜ終局で落とさないか）がホバーに出ない。**

読み手は「呼び直せ」は読めるが「なぜ終局で落ちないのか」を読めず、
終局イベントで `closeGame` を呼ばない設計にして不変条件5 の呼び忘れを再生産する。

### R7-H4 F-24 を足したのに、まとめが「F-19〜F-23」「5本」のまま（robustness MEDIUM / comment HIGH）

```
**対局（F-19〜F-23）は出口が1つも無い**
… Rust の経路だけが5本先に増えた。UI を作るときは、この5行を先に読むこと。
```

この段落は「UI を作るときに先に読む行」の索引。信じて5行だけ読んだ人は、
`close_game` が `Err` を返しうることを読まない。

**R6-H2（「4つに分かれる」と書いて5つ並べた）と同一の故障が、
その修正コミットと同じラウンドで再発した。3周目。**

### R7-M2 `close_all` は `Vec<GameId>` を返すが呼び出し元が0（rust MEDIUM / robustness HIGH。H-5、7ラウンド目）

`43c75c1` は「閉じられなかった対局を利用者と呼び出し側に届ける」という題で
戻り値を `()` から `Vec<GameId>` に変えたが、**受け取る者がまだ0**なので
利用者に届く距離は1ミリも縮んでいない。

robustness の指摘が正しい: **戻り値の消費者を作らないなら、
`Vec` を返す変更は撤回して `()` に戻すほうが正直。**

### R7-M3 `the_four_ways_...` の doc が「3つ」と書き、存在しない二重 `Result` を根拠にしている（rust / comment）

```rust
/// 書き込み側も3つに分かれること。上の関数の対。
/// **`timeout` の戻りは二重の `Result`。** …
fn the_four_ways_a_stop_can_end_are_not_collapsed() {
```

本体は4分岐、関数名は `four`、`outcome_of_stop` の doc は「4つ」。
引数は `add2d4e` で `Result<StopEffect, EngineError>` になり、
**この関数はもう `timeout` の戻りを受け取らない。**

---

## 1人だけが挙げたもの

### R7-B1 flush の窓は閉じていない。しかもコメントがそれを否定している（comment BLOCK）

```rust
// protocol.rs:498-501
// **ロックを取った後に状態を読み直す。** 取るまでの間に
// `readyok` が着地すると、flush は既にキューを空にして去っている。
```

現物は `Ready` を立ててから1件ずつ抜き、**1件ごとに `write().await` を挟む**。
その窓で `dispatch_for(Ready, _) = Send` になった直書きが列へ入る。

ワイヤ上の順: `position(旧) → position(新) → go(旧)`。
**エンジンは新しい局面に対して古い `go` を受け取る。**

**r6 の報告書は「列が1本になったので消えた」と書いた。誤り。**
消えたのは `spawn_blocking` 起因の非決定性だけで、この窓は今も開いている。

### R7-H5 積み置きの `go` を落とす口は `stop` だけではない（rust HIGH）

`de22e30` は「`go` が落とされたのに `bestmove` を待ち続ける」を `stop` の口だけで
塞いだが、落とす口は他に2つある（`begin_generation` / `discard_pending`）。

筋道: `Waiting` の間に「解析開始」→ `go infinite` が積まれる →
もう一度「適用」→ `begin_generation` がその `go` を捨てる →
`process_analysis_stream` は `bestmove` でしか抜けないので永久に待ち、
リスナーは登録されたまま。ここで「停止」を押しても `cancel_queued_go` は
空のキューを見て 0 を返し `StopEffect::Written` になるので、**リスナーは外れない。**

以後、別の解析の `info` が毎行この死んだストリームにも配られる。

### R7-H6 `WRITE_TIMEOUT` の doc に経緯と、既に腐った件数がある（comment HIGH）

```rust
/// 呼び出し側に `tokio::time::timeout` を書かせると、18箇所のうち1箇所しか
/// 包まれていない、という状態になる（実際そうなっていた）。
```

「（実際そうなっていた）」は `CONTRIBUTING.md` の「元は〜だった」に真正面から当たる。
`18箇所` も r6 の census で、いま数えると17箇所。
定数の doc に置くべきは「なぜ2秒か」であって、修正前の分布ではない。

### R7-H7 r6 の反論の数え方が間違っていた（comment HIGH）

`commentHistory.test.ts` に「`"ていなかった"` は該当4件のうち3件が誤検出」と
書いたが、**誤検出は2件で、1件は真陽性**。

| 場所                                                          | 判定                                   |
| ------------------------------------------------------------- | -------------------------------------- |
| `search.rs` / `protocol.rs` の「まだ書かれていなかった `go`」 | 誤検出                                 |
| `KifuCommentNote.test.tsx` の「こちらには付いていなかった」   | **真陽性**（「元は〜だった」そのもの） |
| `commentHistory.test.ts` のこの記述自身                       | **自己参照**                           |

4件目は**この記述が生んだもの**で、同じファイルの「文章で例示すると自分で落ちる」を
破っている。**「足さない」という判断の根拠を、判断の記録自体が作っていた。**

### R7-M4 `let _ = timeout(...)` が2箇所。自前の検査がその形を見ていない（rust MEDIUM）

```rust
// manager.rs:77 / session.rs:275
let _ = tokio::time::timeout(CLOSE_IDLE_TIMEOUT, self.abort()).await;
```

`timeout_result.rs` の doc は「`let _ = ...` ではなく理由を書いて `matches!` を使う」と
書いているのに、走査は `.is_ok()` / `.is_err()` しか見ない。**規律を書いた本人の2箇所を通した。**

`abort()` の `Err`（`run_loop` が既に無い）と上限超過（詰まっている）は意味が正反対。

### R7-M5 初手ぶんの加算が境界の型にも表にも書かれていない（robustness MEDIUM）

`3分＋2秒` と入れると `ClockView.mainMs` も `RunningClock.mainZeroAt` も **3:02** を指す。
`go` の `btime` も 182000。他の将棋 GUI は初手に 3:00 を出す。

理由は `clock.rs` にしか無く、そこは USI 側の内部。
**境界の型だけを読む人には、設定値と画面の値が食い違う理由が辿れない。**

### R7-M6 `close_game` の doc の中で「台帳」が2つの別物を指す（comment MEDIUM）

```rust
/// **対局は中断済みだが、エンジンは生きたまま台帳に残る。**
/// そのまま呼び直せる。呼び直さないとプロセスが残る（→ 台帳の F-24）。
```

1つ目は `GameManager::sessions`、2つ目は `failure-surfacing.md`。
連続する2文で同じ語が別物を指している。

### R7-M7 `settle` を分けた集約が、変数名とログに届いていない（comment MEDIUM）

定数だけ `CLOSE_IDLE_TIMEOUT` / `searches_idle` に寄せたが、同じ待ちの
ローカル変数は `settled` のまま、ログは `could not confirm searches settled`。

`grep -i settl` は今も2つの概念を混ぜて返すので、
**「別物である」という doc の主張を grep で確かめられない。**

### R7-M8 `infinite_listener` の doc が「走っている」と書くが正常終了で消えない（comment MEDIUM）

`bestmove` で畳まれた解析のリスナー名がフィールドに残り続ける。
`Some` であることが「走っている」を意味しないので、
`if infinite_listener.is_some()` で「解析中か」を判定する人が誤る。

---

## 重複と矛盾

**矛盾が1件あった。**

- comment は「flush の窓は開いている」（R7-B1、BLOCK）
- robustness は「書き込みの列の順序保証は成立している」（問題無しとして明記）

**現物を読んで comment が正しいと判断した。** robustness が確かめたのは
「`WRITE_TIMEOUT` で降りた呼び出しの後に投入されたジョブが追い越さないか」で、
別の問いに答えている。flush が1件ごとに `await` を挟むことは見ていない。

## 見ていない範囲

3人とも共通:

- **実機のエンジンを1つも起動していない。** `WRITE_TIMEOUT` の発火条件
  （パイプの空きが `position` 分しか無い状態）が実際にどの程度起きるかは測っていない
- 対局のフロント UI は存在しない。「利用者に何が出るか」は UI を書いたときの予測

個別:

- `game-session.md` の `E1`〜`E18` × `G0`〜`G2` の全セル
- `failure-surfacing.md` の F-1〜F-18
- `src-tauri/tauri.conf.json` の capabilities / permissions（r5 から3ラウンド持ち越し）
- 持ち越し（H-6 / R2-H5 / M-3 / M-6 / M-7）。M-2（`u64` オーバーフロー）は
  `SideClock::new` の加算単体では到達しないことを確認済み

## lint / hook 案

| 何を                                           | どう                                                                                                                                                                                  | 止まる所見            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `docsIdentifiers` がテスト固定値で緑を返すこと | `sourceFiles(SRC, { includeTests: false })` にする                                                                                                                                    | R7-H2                 |
| Rust コメントが指す死んだ識別子                | `docsIdentifiers` の Rust 版を `src-tauri/tests/` に                                                                                                                                  | R7-M1                 |
| 台帳の `F-N〜F-M` と §2 の行数のずれ           | `failure-surfacing.md` の範囲表記と `**F-N**` の行を突き合わせる                                                                                                                      | R7-H4                 |
| 同じ宣言の直前に `/** */` が2枚                | `\*/\s*\n\s*/\*\*` を拾う。現物の該当は1件                                                                                                                                            | R7-H3                 |
| `let _ = ` と `timeout(` が同じ行              | `timeout_result.rs` に1行足す。該当2件、誤検出なし                                                                                                                                    | R7-M4                 |
| `pub` なのに呼び出し元が0の口                  | `close_all` / `shutdown_all` は `pub` なので clippy に掛からない                                                                                                                      | R7-M2                 |
| **機械で防げないもの**                         | `Err(Timeout)` が「書かれなかった」を意味しないこと（型が同じなので呼び出し側の読み違いは止まらない）／コメントが動的な順序について嘘をつくこと／戻り値を増やしたが消費者が居ないこと | R7-H1 / R7-B1 / R7-M2 |

---

## 修正計画

### 第0群: 集約が持ち込んだ実害

1. **R7-H1** `Err(Timeout)` の意味を型で確定させる。列の上限を超えたら
   **接続の故障**として扱い、`Closed` を立てて残りの列を捨てる。
   「書いていないと言ったものは本当に書かれない」を保証する
2. **R7-B1** flush 中は直書きを積ませる（`Pending` に `draining` を持たせる）
3. **R7-H5** 積み置きから `go` を落とす口を1本にし、落としたら必ず後始末が走るようにする

### 第1群: 消費者の無い戻り値

4. **R7-M2** `lib.rs` に終了フックを置いて `close_all` の戻りを使う。
   置けないなら `()` に戻す（**H-5 は7ラウンド持ち越し。ここで決める**）

### 第2群: 機械化

5. `docsIdentifiers` を `includeTests: false` に（R7-H2）
6. Rust コメントの識別子検査（R7-M1）
7. `let _ = timeout(...)`（R7-M4）
8. doc ブロックの二重（R7-H3）

### 第3群: doc

9. R7-M1 / R7-H2 / R7-H3 / R7-H4 / R7-H6 / R7-H7 / R7-M3 / R7-M5 / R7-M6 / R7-M7 / R7-M8

## 結果

**所見16件をすべて直した。** issue 送りは無い。r6 の反論も撤回した。

| コミット  | 直した所見                                                 |
| --------- | ---------------------------------------------------------- |
| `e584db4` | R7-H1 / R7-B1 / R7-H5（列が持ち込んだ3つの穴）             |
| `6cf746a` | R7-M2 / R7-H4（終了フック。**H-5 が7ラウンド目で閉じた**） |
| `ad291ab` | R7-M1 / R7-H2 / R7-H3 / R7-H6 / R7-H7 / R7-M3〜M8          |

### 集約の後始末

r6 の集約は正しかったが、**列に入れたことの副作用を3つ見落としていた**。

1. **`Err(Timeout)` の意味**（R7-H1）。詰まったジョブは列に残って後から書かれるのに、
   呼び出し側は「書かれなかった」と読んでいた。上限を超えたら
   **接続が壊れたものとして扱う**（`fail_writes` が `Closed` を立てて積み置きも捨てる）。
   これで「書けなかったと言ったものより後は本当に書かれない」が保たれる
2. **flush の窓**（R7-B1）。`Pending` に `draining` を立て、掃いている間は
   `Ready` でも積ませる。印を降ろすのは列が空になったのと同じロック区間
3. **積み置きの `go` を落とす口**（R7-H5）。`stop` 以外に2つあったので、
   `stop_analysis` は `StopEffect` を見ずに必ずリスナーを外す形にした。
   「`bestmove` が来る経路」を数え上げるのをやめた

### 機械が4回、私を止めた

| 何が起きたか                                                     | どの検査                  |
| ---------------------------------------------------------------- | ------------------------- |
| `docsIdentifiers` が**自分のテスト固定値**を根拠に緑を返していた | 塞いだ瞬間に R7-H2 が出た |
| `comment_identifiers`（新規）が R7-M1 をそのまま捕まえた         | 3人が挙げた所見と一致     |
| `timeout_result` が**規律を書いた本人の2箇所**を通していた       | `let _ =` を足して出た    |
| `commentHistory` が**新しい検査の doc に書いた経緯**を捕まえた   | 語を足した直後            |

### r6 の反論を撤回する

**「該当4件のうち3件が誤検出」は数え間違いだった。**

| 場所                                                          | 判定                               |
| ------------------------------------------------------------- | ---------------------------------- |
| `search.rs` / `protocol.rs` の「まだ書かれていなかった `go`」 | 誤検出（2件）                      |
| `KifuCommentNote.test.tsx` の「こちらには付いていなかった」   | **真陽性**                         |
| `commentHistory.test.ts` のこの記述自身                       | **自己参照**（反論の記録が生んだ） |

真陽性を直し、誤検出2件は言い換えで消して、`"ていなかった"` を採用した。
**足した直後に、自分で書いた新しい検査の doc の経緯を捕まえた。**

反論そのものが間違っていたわけではない（当時の現物では2件が誤検出だった）が、
**数え方が雑で、しかも自分の記録が4件目を作っていた**。
「場所を言うなら数えて並べる」を自分に課しておきながら、その数え方を誤った。

### H-5 が7ラウンド目で閉じた

`lib.rs` の `RunEvent::ExitRequested` で `close_all` → `shutdown_all` を呼ぶ。
r6 で `close_all` の戻り値を `Vec<GameId>` にしたが**消費者が0**で、
robustness の「消費者を作らないなら `()` に戻すほうが正直」が正しかった。
消費者を作った。

### 検証

`npm run verify`（645 tests）と `npm run verify:rust`（74 lib + 30）が
どちらも緑。**実機のエンジンは1つも起動していない。**
