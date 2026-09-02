# レビュー game-engine ラウンド16

- 日付: 2026-09-02
- 範囲: `src-tauri/src/engine/` 全体、`src-tauri/tests/`、`lib.rs`、
  `docs/state-transitions/failure-surfacing.md`
- 走らせた reviewer: rust / robustness
- 対象コミット: `4f92a6f`

**生の所見20件**（BLOCK 1 / HIGH 5 / MEDIUM 14）。2人が独立に同じ BLOCK を挙げた。

## この回で分かったこと

**ラウンド15で入れた修正が、2件とも別の穴を開けていた。**

さらに、**失敗の台帳（F-19〜F-28）を10行とも突き合わせた**結果、
「いま起きない行」は無かったが、**場所と中身が4行腐っていた**。

---

## 実害

### R16-B1 `SPAWN_TIMEOUT` の脱出経路が、`UsiProtocol` が塞いだ `Drop` の穴を開け直した（2人が BLOCK / HIGH）

`JoinHandle` をその場で捨てるので、遅れて起き上がった `UsiEngineHandler` を
ランタイムが drop する。`usi` crate の `Drop` は `kill().unwrap()` を呼び、
**既に死んだプロセスへの書き込みは EPIPE で失敗するのでパニックする**——
`protocol.rs` が `Option` + `mem::forget` を持っているのは、まさにこれを避けるため。

**このコードベースが唯一避けてきた形を、その防壁の外に作った。**

2つの筋道がある。

1. 起動して即死したエンジン（評価関数が無い、アーキテクチャ違い）
   → `Drop` の中でパニック。tokio のブロッキングワーカの中で、どの `catch` にも掛からない
2. stdin を読まないエンジン → `Drop` が返らず `process.kill()` に到達しない。
   その子プロセスは `processes` にも `starting` にも居ないので `shutdown_all` から見えない。
   **利用者がアプリを終了しても、CPU を食うエンジンが1本残る**

しかも doc は「ワーカが1本減る」としか書かず、**子プロセスがどうなるかを一言も書いていない**。

### R16-H1 黙って固まったエンジンの検出が、持ち時間ぶん遅れる（robustness HIGH / ラウンド15で入れた）

沈黙の腕にも `budget +` を付けた。黙っているかどうかは持ち時間と無関係の信号なのに。

60分切れ負け・`enforce_engine_timeout` は既定の偽・初手のエンジンが `go` の後に
デッドロックして `info` を1行も出さない、を置くと——**60分30秒のあいだ何も起きない**。
フロントには `ClockUpdated` が500msごとに流れ続けるので、正常な長考と区別が付かない。
ラウンド15の前は10分で落ちていた。

**テストが落ちなかったのは、4本とも `(エンジン, 大きい budget, 沈黙)` の
組み合わせを1つも通っていなかったため。**

### R16-H2 `startGame` の新しい doc が、そこに書いてある取りこぼしを**起こす**順序を指示している（robustness HIGH / ラウンド15で入れた）

最初の `TurnChanged` は `start` が `Ok` を返す**前に**流れる。`start_search` も同じ。
「`Ok` を受け取ったら、盤を出す前に `listenToGameEvents` を張ること」に従うと、
**必ず**それを落とす。`bestmove resign` を即返すエンジンでは `MoveDecided` と `Over` も
IPC の往復中に飛ぶ。

**doc が「これを避けろ」と書いた症状を、doc のとおりに作ると起こす。**

### R16-H3 `Over` の emit が失敗すると、台帳が書いた「30秒後に `aborted`」は起きない（robustness HIGH）

30秒の `RULING_TIMEOUT` が掛かるのは `Phase::AwaitingRuling` **だけ**。
失敗したのが `Over` だったときは既に `Phase::Over` なので `on_tick` は即 `return`。

筋道: エンジンが投了 → `finish` → `emit(Over)` が失敗 → Rust は終局済み →
フロントは最後に受けた期限で 00:00 まで描いてから静止 →
**「時間切れなのに何も起きない盤」が残り、30秒後の中断も来ない**。
復帰は `getGameState` しか無く、それを叩く UI は無い。

### R16-H4 `LogThrottle` が5種類のイベントで1本の枠を共有し、F-19 の証拠を落とす（robustness HIGH / ラウンド15で入れた）

`SearchInfo` の失敗で枠を使い切ると、1.8秒後の `MoveDecided` の失敗が黙って捨てられる。
30秒後に `Aborted { detail: "no ruling came back from the app" }` になったとき、
ログに残るのは32秒前の1行だけで、**どのイベントが届かなかったかは書かれていない**。

絞りを入れた理由が「黙って捨てると原因が追えない」だったのに、
**絞った結果その追跡に必要な情報が落ちた。**

---

## 台帳（F-19〜F-28）の突き合わせ

**10行すべてを1行ずつ照合した。「いま起きない行」は無い。** 腐っていたのは場所と中身。

| 行   | 判定                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| F-19 | **場所が古い**（`warn` は r15 で `commands/game.rs` へ移った）。「いま起きること」もイベント種別によって偽 |
| F-20 | 合っている。ただし**絞りが無いことが書かれていない**                                                       |
| F-21 | 合っている                                                                                                 |
| F-22 | **場所が不正確**（`finish` を開いても `warn` は無い。`send_gameover` にある）                              |
| F-23 | 合っている（`EngineFailure` はちょうど5箇所）                                                              |
| F-24 | **「対局は中断済み」が2つの腕で偽**                                                                        |
| F-25 | 合っている                                                                                                 |
| F-26 | 合っている（台帳と実装が相互参照している唯一の行）                                                         |
| F-27 | **`SPAWN_TIMEOUT` の原因と「次の操作」が無い**。再試行に意味がある唯一の原因が漏れている                   |
| F-28 | 断る理由の列挙が不足                                                                                       |

台帳に行が無い出口: **`SPAWN_TIMEOUT`**（F-27 に属するが書かれていない）、
**`not_searching`**（F-2 に潰されている）、
**`DepthOutcome { reached: false }`**（`Ok` で返るのでどの行にも掛からない）。

---

## その他（MEDIUM）

- `broadcast_to_listeners` がエンジンの出力**1行ごと**にリスナー表を丸ごと clone する。
  理由として書いてある「長時間ロックしない」が偽——ループの中は同期の `send` だけで
  await 点が無いので、ロックを保持したまま回してよい
- **環の検査が長さ2の環しか見ていない。** 全順序をやめた今、`may_use` に
  3つ以上を跨いだ環を書けても両方の検査が緑になる
- **免除の綴りが `timeout(` の現場にあることを確かめていない。** `src/` 全体への
  `contains` なので、doc コメントの中でも成立する
- `contains_usi_breaking_char` は `protocol` に降りたが、**強制は呼び出し側4箇所に
  散ったまま**。5箇所目が素通りするのを止めるものが無い
- `clocks_view` の warn が絞られていない。**`emit` の失敗と違って、条件が満たされている間
  毎秒2行出続ける**（絞りを入れた理由がいちばん強く当たるのはこちら）
- `continue_game` が拒否した後の中断が「アプリが答えなかった」と説明される。
  拒否は `Err` を返すだけでログに1行も残らない
- ラウンド15のコミットが `session.rs` のテストの doc を2箇所壊した
  （`long_ago` に `test_runner` の説明が付いている／同じ4行が2回）
- `not_searching` と `DepthOutcome { reached: false }` に台帳の行が無い

---

## 見ていない範囲

- **2人ともエンジンを1本も起動していない。** `Drop` のパニックがどのスレッドで
  捕まるかは追い切れていない（**推測**と明示）
- `protocol.rs` の `start_listening` / `ensure_ready` の世代管理 / flush の順序 /
  `discard_pending`（**4ラウンド続けて未読**）
- `search.rs` の `run_search` 本体
- `game-session.md` の57セル（r14 が済ませたものとして踏襲）
- `src/entities/game-session/**` の単体テスト（**1本も無い**）

---

## 修正計画

1. **R16-B1 / R16-H1** を先に（どちらもラウンド15で入れた退行）
2. **R16-H2 / R16-H3 / R16-H4** — フロントに届く失敗
3. 台帳の4行（F-19 / F-22 / F-24 / F-27）と、行の無い3つの出口
4. 機械の穴（環の検査、免除の綴り、`contains_usi_breaking_char` の強制）
5. その他の doc

## 結果

| 所見   | 直したか | どう直したか                                                                                                                                         |
| ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| R16-B1 | ✅       | `SPAWN_TIMEOUT` の超過で `JoinHandle` を落とさず、`dispose_late_spawn` へ渡す（`kill` + `mem::forget` を `spawn_blocking` の中でやる）               |
| R16-H1 | ✅       | 沈黙の腕から `budget +` を外し、`SEARCH_GRACE` の両条件で見る                                                                                        |
| R16-H2 | ✅       | Rust 3箇所と TS の doc を「**`startGame` を呼ぶ前に購読を張る**」に直す                                                                              |
| R16-H3 | ⚠️ 半分  | `GameEvent::is_terminal` を足し、`over` の emit 失敗は絞らず `error` で出し、立て直しに要る `get_game_state` を文面に入れた。**画面側の導線は #374** |
| R16-H4 | ✅       | 枠を高頻度／1手1回で分け、warn に `kind=` を載せた。終局はどちらの枠も通らない                                                                       |

### 台帳

F-19 / F-20 / F-22 / F-24 / F-27 / F-28 を現物と突き合わせて直した。
行の無かった出口2つ（`not_searching` / `DepthOutcome { reached: false }`）は
**F-29 / F-30 として置いた**——「出方が無い」を行にしないと、無い出口は表からも消える。

### その他（MEDIUM）

| 所見                                | 直したか | どう直したか                                                                              |
| ----------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `broadcast_to_listeners` の clone   | ✅       | 読み取りロックを握ったまま配る。ループの中に await 点は無い                               |
| 環の検査が長さ2まで                 | ✅       | 深さ優先で任意長を拾う。**表そのものの環**も見る（`the_declared_layers_are_not_a_cycle`） |
| 免除の綴りが現場を指していない      | ✅       | 走査が実際に使った免除だけを生きているとみなす（`every_exemption_is_actually_used`）      |
| `contains_usi_breaking_char` の強制 | ✅       | `check_writable` を `enqueue_write` に置き、組み立てた1行を見る                           |
| `clocks_view` の warn が絞られない  | ✅       | `CLOCK_WARN_INTERVAL` で絞る                                                              |
| `continue_game` の拒否が残らない    | ✅       | `log_rejection` に集約し、6コマンドで断った事実を残す                                     |
| `session.rs` テストの doc 壊れ      | ✅       | `long_ago` の doc を `test_runner` へ戻し、重複した4行を落とした                          |

### 変異で確かめたもの

- `GameEvent` に `Probe` を足す → `every_event_is_classified` が落ちる
- `MoveDecided` を終局に含める → 同上
- `may_use` に長さ3の環を書く → `the_declared_layers_are_not_a_cycle` が落ちる
- `protocol.rs` に `use crate::engine::state::AppState` → 長さ4の環として落ちる
- doc コメントにしか無い綴りを `EXEMPT` に足す → `every_exemption_is_actually_used` が落ちる
- `check_writable` の条件を `false` に潰す → `the_queue_refuses_what_would_break_the_line` が落ちる

### 検証

`npm run verify`（660 tests）/ `npm run verify:rust` ともに green。
