# レビュー game-engine ラウンド11

- 日付: 2026-09-02
- 範囲: `git diff e0d08a4..HEAD`（r10 の修正12コミット）＋ その周辺
- 走らせた reviewer: rust / robustness / architecture / comment
- 対象コミット: `46387c0`

**生の所見43件。重複を統合して28件**（BLOCK 3 / HIGH 9 / MEDIUM 16）。

## この回の性格

r10 は「一覧を消し切る」ラウンドだった。数と行番号を落とし、機械を2本足した。
r11 が出したのは**その2本の機械の穴**と、**r10 が新しく書いた doc の偽**、そして
**r10 が畳んだ `collect_until_bestmove` に入り込んだ実害**の3種類。

4人のうち3人が独立に同じ2件（`StopEffect` の潰し / `STOP_GRACE` の二重定義）を挙げた。

---

## 実害

### R11-B1 `analysis.md` ※11 が席の空き方を取り違えている（comment BLOCK / robustness HIGH）

r10 で `ensure_no_active_session` → `take_session` の改名に追従して**新しく書いた行**。

「席は `release_session` でしか空かず、それを呼ぶのは解析の開始に失敗した口と `stop_session` だけ」
が3重に偽。`release_session` の呼び出しは3箇所（成功経路も通る）、`stop_session` は
`sessions.remove` を直に叩いて `release_session` を呼ばない、`stop_all_sessions` の
`clear` と `forward_results_to_ui` の `is_active = false` でも空く。

`take_session` の判定は `any(|s| s.is_active)` なので、**`is_active` を落とすだけで席は空く**。

#120 の BLOCK を追う読み手が、最初から違う場所を探す。

### R11-B2 `ReadyState::Waiting` の doc が同じファイルの556行下と矛盾（comment BLOCK）

r10 で新しく書いた「`isready` は `dispatch_for` を素通りする」が偽。
`send_command:694` は「`IsReady` もここを通す。手前で分岐すると `Refuse` を誰も聞かない」と書き、
`dispatch_for` の最初の腕は `IsReady` にも当たる。素通りするのは `draining` の腕だけ。

この doc を信じると「もともと素通りなのだから」で `IsReady` の早期 return を手前へ
引き上げる変更が正当化され、写像のテストの守備範囲から外れる。

### R11-B3 `ALL_READY_STATES` の「2本のテストが回す」が偽（comment BLOCK）

回しているのは `the_dispatch_map_is_total` の1本だけ。`closed_absorbs_every_later_transition`
は同じ3要素を**2箇所に書き写している**（`:1362` と `:1372`）。

「足したらここにも足す」を守った人が、1行足しただけで2本が広がったと信じる。
実際には吸収状態のテストは古い3つを回したままで、**新しいバリアントが `Closed` から
戻れるかは誰も見ない**。型注釈が `[ReadyState; 3]` なので、`kind_of` のような
コンパイルの番人もこちらには無い。

### R11-H1 収集ループが `stop_analysis` を呼ぶので、無限解析を畳む（rust HIGH / architecture HIGH）

`request_stop_for_collection` → `stop_analysis` は、`protocol.stop()` のほかに
**無限解析専用の2つの状態**（`infinite_stop_requested` の旗、`infinite_listener` の名前）
にも手を出す。収集ループに要るのは `protocol.stop()` 1本だけ。

席が空く窓（R11-H3）で始まった無限解析のリスナーを、古い収集器が締切に当たった瞬間に外す。
`process_analysis_stream` が抜け、`forward_results_to_ui` が終わる。
フロントには `analysis-update` が止まるだけで、エラーも `analysis-complete` も飛ばない。
**「解析中」の表示のまま無音で止まる。**

### R11-H2 `StopEffect` を潰すので、`go` が1行も書かれていない失敗に「エンジンが応じない」と説明が付く（3人が独立に指摘）

`protocol.rs` は `StopEffect` を `Written` / `CancelledQueued` に割り、その doc に
「潰すと待ち手が『この後 `bestmove` が来る』と読んで永久に待つ」と自分で書いている。
`search.rs::outcome_of_stop` は4通りに割っている。**r10 で新設した解析側だけが潰した。**

筋道: `apply_engine_settings` は `isready` を**書いた時点で** `Ok` を返す
（`readyok` を待たない）。その直後の `analyze_with_time` では `ReadyState` がまだ `Waiting`
なので `go` は `Queue` に落ちて `send_command` は `Ok` を返す。締切 → `stop` →
`cancel_queued_go` が積み置きの `go` を落として `CancelledQueued` → **それが捨てられる** →
来るはずのない `bestmove` を `STOP_GRACE` の3秒待つ → `Timeout("engine did not answer after stop")`。

**エンジンは `go` を1バイトも受け取っていない。**

### R11-H3 席を返す側が `take_session` の不変条件を破る（rust HIGH / robustness MEDIUM）

`take_session` の doc は「探索中のエンジンへ2本目の `go` が出る」を守ると書いた。
だが破るのは取る側ではなく**返す側**。`stop_all_sessions` は `sessions.clear()` で
席を外から抜くが、走っている `collect_until_bestmove` は止まらない。
`stop` に応じないエンジンでは席が空いたまま最大 `600 + 3` 秒その状態が続く。

`analyze_with_time(600)` → 停止ボタン → 再度「解析開始」で、同じエンジンへ2本目の `go`。
`broadcast_to_listeners` は全リスナーに同じ行を配るので、2つの収集器が
**同じ `bestmove` をそれぞれ自分の答えとして採る**。

### R11-H4 stale `bestmove` の番人が無く、前の探索の `bestmove` で次の解析が「成功」する（robustness HIGH）

`process_analysis_stream` は `stop_flag` を見て stale な `bestmove` を捨てる番人を持つ。
`collect_until_bestmove` は `Ok(Some(BestMove(_))) => return Ok(result)` と無条件で採る。

`Timeout` で返った後もエンジンは探索中かもしれない（`STOP_GRACE` の doc が自分でそう書いている）。
席は返っているので次の解析が始まり、そこへ前の探索の遅れた `bestmove` が届く。
`bestmove` が先なら **候補手0件の空の結果が `Ok` で返る**。`info` が数行挟まれば
**別の局面の読み筋が現在の局面の解析結果として画面に出る**。

r10 で2つの収集ループを1本に畳んだとき、この番人だけが落ちた。

### R11-H5 `analyze_with_depth` は深度を1度も要求しない（robustness HIGH / comment HIGH）

`usi 0.6.2` の `ThinkParams` のビルダは `ponder` / `btime` / `wtime` / `byoyomi` /
`binc` / `winc` / `infinite` / `mate` で、**`depth` を組む手段が無い**（現物で確認）。
`go depth N` はどのエンジンにも送っていない。

2つ問題がある。

1. r10 で書いた「`go depth` を持たないエンジンにも `byoyomi` は効く」は、
   持つエンジンには送っていると読める。送っていない
2. `depth_limit = 40` を渡して深度22で60秒に当たっても、`Ok(result)` が返る。
   `AnalysisResult` に「要求した深度」も「届いたか」も無いので、呼び出し側に
   見分ける手段が無い。`reached_depth` のテスト3本は境界だけを見ていてこの経路に当たらない

### R11-H6 Rust 専用コミットで Rust のコメント規約が1本も走らない（architecture HIGH）

`verify-gate.sh` は `needs_ts` / `needs_rust` を拡張子で二分し、`.rs` だけのコミットには
`npm run verify:rust` しか掛けない。r10 で `comment_history.rs` を落とした結果、
**Rust のコメント規約を見る唯一の検査が vitest 側だけになった**。

同じ穴が `docsIdentifiers` / `docsSourcePaths` にも掛かる。どちらも `RUST_SRC` を歩く TS 検査。

r10 の報告書は「1つの規約は1本の検査に持たせる」と書いたが、この帰結を記録していない。

### R11-H7 エンジンへ触る口が8つあるうち席を取るのは3つ（architecture HIGH）

`take_session` の doc は「USI は探索中の `position` / `go` を認めない」と書いたが、
**`position` のほうを誰も守っていない**。`set_position_impl` / `apply_engine_settings_impl` /
`initialize_engine_impl` / `shutdown_engine_impl` は席を通らない。

フロントの経路は決定的にこの順で走る。カーソルが動くと `useEnginePositionSync` の effect が
**即座に** `setPositionFromSfen` を呼び、`entities/analysis` の再起動は `RESTART_DEBOUNCE_MS`
待ってから `stop` → `go`。つまり無限解析中に盤を1手進めるたびに
`position(新) → stop → bestmove → go` の順になり、`position` は探索中のエンジンが受け取る。

**「解析中に盤を動かす」はこのアプリの主経路**なので、例外的な競合ではない。

### R11-H8 `MAX_THINK_TIME` の「対局も始められない」が偽（comment HIGH）

`active_sessions` と `take_session` は `bridge.rs` にしかない。対局の開始は
`GameManager::start` → `GameSession::start` で、解析の席を一度も見ない。
600秒という数字の根拠として偽の帰結を挙げている。

### R11-H9 `engine::types::Duration` の doc が shadow の向きを逆に説明（comment HIGH）

r10 で「グロブが `std::time::Duration` を隠すので、使用箇所で明示すること」と書いた。
Rust では**明示 import がグロブより優先される**。`types::*` をグロブで取り込む4ファイルは
全部が `use std::time::Duration` も書いていて、`Duration` は全部 `std` のもの。
`analyzer.rs` の `const BESTMOVE_GRACE: Duration = Duration::from_secs(3)` が通るのがその裏取り。

指示された対処（使用箇所で `std::` を明示）を採っているファイルは1つも無い。

---

## r10 が足した機械の穴

### R11-M1 行番号の検査が `#L42` と `:L42` を素通しする（architecture MEDIUM）

同じファイルの5行上で `sourcePathsIn` が `/[#:]L?\d+$/` として3通りを知っている
（doc に「末尾の `#L12` や `:42` は落とす」と明記）のに、r10 で足した
`lineNumberRefsIn` は `:\d+` しか見ない。`node` で当てて確認済み。

状態遷移表に `` `protocol.rs#L24` `` と書けば、パスの実在検査も行番号の検査も通り、
行はいつも通りずれる。

### R11-M2 `commands_covers_every_gui_command` は網羅を守っていない（comment MEDIUM）

突き合わせの相手は `kind_of` の腕ではなく、**書き写した10要素のリテラル**。
バリアントが増えたとき `kind_of` に腕を足しただけで `commands()` と `all` の両方を忘れると、
10 と 10 が一致して緑で通る。

r10 は「手書きの数を型へ移した」と結論したが、消えたのは `covered.len() == 3` だけで、
**10要素の写しが数の代わりに残っている**。

同じ doc の `COMMANDS` はソースに存在しない綴り（現物は `commands()`）。
下線を含まないので `comment_identifiers` も拾わない。

### R11-M3 doc の行番号を禁止した同じラウンドで、Rust のコメントは外部 crate を行番号で指したまま（comment MEDIUM）

`protocol.rs` の `` `process/engine.rs:73-77, 176-180` ``。`usi 0.6.2` では正しいが
**バージョンが書かれていない**。`docsSourcePaths` は `docs/state-transitions/**` しか見ず、
`comment_identifiers` は下線付きの綴りしか見ないので、誰の検査にも掛からない。

「2度目の `kill` は必ずパニックする」という強い主張の唯一の裏取りがこの行番号で、
r10 は同じ危険を理由に doc の行番号32件を落としている。

### R11-M4 ADR-0004 が `ensure_no_active_session` と行番号を指したまま（robustness MEDIUM）

r10 の報告書は「行番号を機械で止めた」と書いたが、機械の範囲は `docs/state-transitions/`
だけで、同じ改名で腐った ADR は範囲外。ADR-0004 は「どの F がどの段か」の唯一の持ち主で、
`failure-surfacing.md` がそこへ委譲している。

`0004-notification-taxonomy.md` は他リポジトリを引いていないので、除外する理由が無い。

---

## その他（MEDIUM）

- **`STOP_GRACE` が値の違う2つある**（解析3秒 / 対局5秒）。説明文まで同じ。
  `game-session.md` の「`STOP_GRACE`（5秒）」は解析側の3秒に当たっても `docsIdentifiers` が緑。
  `the_watchdogs_are_ordered` は `search::STOP_GRACE` だけを固定しているので、解析側は誰とも
  突き合わされていない（3人が独立に指摘）
- **`STOP_GRACE` の起点が `stop` を書く前**。`WRITE_TIMEOUT` 2秒が食われると
  エンジンに残るのは1秒。`search.rs` は `stop().await` が返ってから測り始める
- **`EngineError` の Display を10箇所すべてが `{:?}` で捨てている**。
  `Timed analysis failed: Timeout("engine did not answer after stop")` がフロントへ出る。
  `thiserror` の `#[error(...)]` は1度も使われない。`protocol.rs` が文言を3つに割った成果が
  境界を越える瞬間に Debug 整形の中へ埋まる
- **`await_write` の doc「待つだけ」が `fail_writes` の副作用を隠している**。
  上限に当たるとそのプロセスを丸ごと使用不能にする片道切符
- **`send_command` の「エラーは3種」が偽**。`AlreadyListening` で4種
- **`cannot_reach_text` の「だから」に対応する経路が無い**。`kill_engine` の後の書き込みは
  `NotInitialized(GONE)` になり `Timeout` にならないので、「落とすと詰まる」は起きない。
  実際の根拠（詰まった後に利用者が終了させる）はテストのほうに正しく書いてある
- **`analyze_with_time` の丸めが黙る**。戻り値に「実際に何秒考えたか」も「丸めたか」も無い
- **`analyzeWithTime` / `analyzeWithDepth` にフロントの呼び出し側が0**。
  r10 が足した `MAX_THINK_TIME` / `BESTMOVE_GRACE` / `STOP_GRACE` は誰も踏めない経路の上にある
- **`stop_session` が `session_id` を照合せずにエンジンを止める**。知らない ID でも成功する。
  前の解析の ID を握った画面が「停止」を撃つと、いま走っている別の解析が止まって `Ok` が返る
- **自分で終わった解析の席が消えない**。`AnalysisSession.last_result` は候補手と PV を丸ごと持つ。
  エンジンが落ちるたびに1件ずつ溜まり、上限が無い
- **`take_session` / `release_session` にテストが1本も無い**。`bridge.rs` 全596行に `#[cfg(test)]` が0。
  プロセスを起動せずに書けるのに書いていない。**上の HIGH が入り込めたのはこの継ぎ目の欠如**
- **`collect_until_bestmove` は構造上テストできない**。`request_stop_for_collection` が
  `self.protocol()` → 実在する `UsiProtocol` を要求する
- **R10-M2 は半分しか直していない**。報告書に「`shutdown_all` の後に `spawn` が始まる経路も、
  落とす者が居ない」と自分で書いておきながら、直したのは登録順だけで、
  **直さなかったことを記録していない**
- **解析側の Tauri コマンド13本に `///` が1つも無い**（対局側は全部にある）。
  フロントから見える面だけが裸で、`analyze_with_time` が黙って丸めることが読めない
- **`new_session_id` の doc が挙げる理由が関数の形を説明していない**。
  種類の見分けは接頭辞だけで付くので、条件を出す理由になっていない
- **`Runner.app` の「`GameManager` が必ず `Some`」の保証がそこに無い**。
  保証しているのは `start_game` 1箇所
- **`game.md` の「残る `set_error` は全て E に対応」が偽**。`persistIfPossible` の2件は
  どの E にも対応しない。r10 は偽の数を落としたが、置き換えた「全て」も成立していない
- **`#[allow(unused_variables)] state` が嘘**。`state` は同じ関数の `:475` で使われている
- **`StreamMode::Finite` の `#[allow(dead_code)]` に理由が無い**。
  隣の `bridge.rs` は「付けないこと」を理由つきで禁じている
- **`CLOSE_IDLE_TIMEOUT` が別々の2つの待ちを兼ねている**。doc は片方の理由しか書いていない
- **`initialize_engine` が席を取らず `engine_id` を無検査で上書きする**。
  二重起動を防いでいるのは TS 側の `inFlight` シングルトン1つで、テストが無い
- **`EngineRegistry::ids` の呼び出しが0**。迷子のエンジンを列挙する口が実質無い
- **`entities/engine` の barrel が公開境界として働いていない**。新設の `game-session` は逆の流儀

---

## 重複・矛盾した所見

3人以上が独立に挙げたもの（確度が高い）:

| 所見                                | rust   | robustness | architecture | comment |
| ----------------------------------- | ------ | ---------- | ------------ | ------- |
| `StopEffect` の潰し                 | MEDIUM | HIGH       | HIGH         | —       |
| `STOP_GRACE` ×2                     | —      | MEDIUM     | MEDIUM       | MEDIUM  |
| 収集ループが `stop_analysis` を呼ぶ | HIGH   | —          | HIGH         | —       |
| `analysis.md` ※11                   | —      | HIGH       | —            | BLOCK   |
| `go depth` を送らない               | —      | HIGH       | —            | HIGH    |
| `{:?}` の整形                       | MEDIUM | MEDIUM     | —            | —       |

矛盾は無し。深刻度の差は「利用者に届くか」を見るか「型と構造」を見るかの違いで、
robustness の側（HIGH）を採る。

---

## 見ていない範囲（4人の申告を統合）

- **4人とも実機のエンジンを1本も起動していない。** ワイヤ上の順序も、`stop` に応じない
  エンジンの実挙動も観測していない。所見はすべてコードの読みから導いたもの
- macOS の Cmd+Q を実際に踏んでいない。R10-M2 の残りの筋道は
  「`block_on` の間もランタイムのワーカーは動く」という前提に依存する（**推測を含む**）
- `game/session.rs` の `run_loop` / `on_search_outcome` / `on_tick` の本体（1000行超）。
  **r7 から5ラウンド持ち越し**
- `game-session.md` の `E1`〜`E18` × `G0`〜`G2` の全セル、`failure-surfacing.md` の
  F-1〜F-18 と G-1〜G-9 の中身。**r7 から持ち越し**
- `docs/state-transitions/` のうち r10 の差分に現れなかった表
- `src/entities/analysis` / `widgets/analysis-pane` の内部
- `invoke_handler` の逆向き（フロントが呼んでいない登録済みコマンド）の数え上げ
- `#353` / `#157` / `#120` / `#301` の issue が実在するかは確認していない

---

## lint / hook で強制できるもの

**すぐ書けるもの**

- **Rust 専用コミットで `npm test` を走らせる**（R11-H6）。`verify-gate.sh` に1行。
  `.rs` を見る TS 検査3本がゲートに戻る
- **`#L42` 形式**（R11-M1）。`lineNumberRefsIn` の正規表現をパス側と同じ定数から作る
- **同名の定数が別モジュールに2つある**（`STOP_GRACE`）。`src-tauri/src/engine/**` の
  `const NAME:` の綴りが一意であることを見る検査。20行で書ける
- **`docs/decisions/` を識別子・行番号の検査に含める**（R11-M4）。除外を
  「ディレクトリ単位」から「ファイル単位＋理由」に変える
- **`src-tauri/src` のコメントの行番号参照**（R11-M3）。`lineNumberRefsIn` を
  `RUST_SRC` に掛ける。外部 crate を指すぶんは `EXEMPT` に理由つきで
- **`#[tauri::command]` の直前行に `///`**。`engine/bridge.rs` の13本が一度に落ちる
- **`format!("...{:?}", e)` が `Result<_, String>` へ流れる箇所**
- **`comment_identifiers` の下線要件をゆるめる**。「連続する大文字2文字以上」で
  `COMMANDS` のような綴りが拾える

**機械にできないもの**

`StopEffect` を潰していないか、stale な `bestmove` を採っていないか、
「〜だから」の因果が現物の経路と一致しているか。**今回の所見の半分がこれ。**
前2つは継ぎ目を作ってテストを書くしかない（`collect_until_bestmove` を
自由関数にして `stop` を引数で受ける）。

---

## 修正計画と結果

7コミット＋ issue 6件。`npm run verify` / `npm run verify:rust` とも green。

### 直した（22件）

| 所見       | 直した内容                                                                                                                                                | コミット  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **R11-H6** | 門番が「何を見ているか」で verify を選ぶ。テストも足す                                                                                                    | `687b226` |
| **R11-M1** | 行番号の綴りを `LINE_SUFFIX` の1つに寄せる                                                                                                                | `99c48a7` |
| **R11-M3** | `protocol.rs` の外部 crate 参照を識別子＋版に                                                                                                             | `99c48a7` |
| **R11-M4** | 行番号の検査を `docs/` 全体へ。ADR-0004 の死んだ識別子も直す                                                                                              | `99c48a7` |
| **R11-H1** | 収集ループが `protocol.stop()` を直に呼ぶ                                                                                                                 | `480d17b` |
| **R11-H2** | `StopVerdict` で `StopEffect` を潰さない                                                                                                                  | `480d17b` |
| **R11-H4** | `drain_stale` で古い `bestmove` を捨てる                                                                                                                  | `480d17b` |
| **R11-H5** | `DepthOutcome` で届いたかを返す                                                                                                                           | `8de43e7` |
| **R11-B1** | ※11 を `is_active` を指す形に                                                                                                                             | `6c50c03` |
| **R11-B2** | `ReadyState::Waiting` の doc を現物に                                                                                                                     | `6c50c03` |
| **R11-B3** | `ReadyState::ALL` を宣言から生やす                                                                                                                        | `6c50c03` |
| **R11-H8** | `MAX_THINK_TIME` の帰結から対局を外す                                                                                                                     | `6c50c03` |
| **R11-H9** | `Duration` の shadow の向きを直す                                                                                                                         | `6c50c03` |
| **R11-M2** | `Kind::ALL` を宣言から生やす                                                                                                                              | `6c50c03` |
| その他     | `send_command` のエラー種、`cannot_reach_text` の因果                                                                                                     | `6c50c03` |
| MEDIUM     | `stop_session` の照合、席の残留、`STOP_GRACE` の改名、`{:?}` 9箇所、`bridge.rs` のテスト4本                                                               | `d0d2b04` |
| MEDIUM     | `await_write` の副作用、`#[allow]` の嘘、`Finite` の理由、`new_session_id` の理由、`CLOSE_IDLE_TIMEOUT` の兼務、`Runner.app` の保証、`game.md` の「全て」 | `1a773dc` |

### issue へ送った（6件）

**直し方に設計の選択が絡むもの。** その場で決めずに出す。

| 所見                                                           | issue |
| -------------------------------------------------------------- | ----- |
| R11-H3 席を返す側が「席は1つ」を破る                           | #365  |
| R11-H7 `set_position` / `apply_engine_settings` が席を通らない | #366  |
| `initialize_engine` の二重起動                                 | #367  |
| 掃除の後に始まった `spawn`                                     | #368  |
| 解析側 Tauri コマンドの doc と、丸めるか断るか                 | #369  |
| barrel の流儀の割れ                                            | #370  |

### 直し方を変えたもの

**R11-M2** は「`all` のリテラルを消す」だけでは足りない。`Kind` を宣言する小さな
マクロを置き、`Kind::ALL` が宣言から生えるようにした。同じ形で `ReadyState::ALL` も。
**手書きの写しは、写しであるかぎり必ずずれる**——ラウンド5から10まで毎回それで落ちている。

**R11-H2** の直し方は所見どおりだが、写す先の型は `game::search` と共有しなかった。
あちらは対局の結果（`SearchOutcome`）へ写し、こちらは待ち方へ写す。写す先が違うので
1本にすると、どちらかの分岐が相手の都合で動く。

### 変異で確かめたもの

| テスト                                                       | 当てた変異                            | 落ちた   |
| ------------------------------------------------------------ | ------------------------------------- | -------- |
| `verify-gate.test.sh`                                        | 拡張子の二分に戻す                    | ✓（5件） |
| `lineNumberRefsIn`                                           | `LINE_SUFFIX` を `:\d+` に狭める      | ✓        |
| `the_ways_a_stop_can_end_are_not_collapsed_into_waiting`     | `CancelledQueued` を `Wait` に潰す    | ✓        |
| `stale_output_is_dropped_before_collecting`                  | `while` を `if` に                    | ✓        |
| `commands_covers_every_gui_command`                          | `Kind` に足して `commands()` を忘れる | ✓        |
| `a_second_analysis_is_refused_while_one_holds_the_seat`      | 席の検査を落とす                      | ✓        |
| `stopping_an_unknown_session_does_not_touch_the_running_one` | 知らない ID を通す                    | ✓        |
| `the_seat_name_carries_what_kind_of_analysis_it_is`          | 席の名前から条件を落とす              | ✓        |

`ReadyState::ALL` は変異を書けない——一覧が宣言から生えるので、
「一覧だけを縮める」編集が存在しない。それがこの直し方の狙い。

### 自分が作った退行

- **`comment_history.rs` を落として TS へ寄せた結果、Rust 専用コミットで
  Rust のコメント規約が1本も走らなくなっていた**（R11-H6）。ラウンド10の報告書は
  「1つの規約は1本の検査に持たせる」とだけ書き、この帰結を記録していない。
  同じ穴が `docsIdentifiers` / `docsSourcePaths` にも掛かっていた
- **ラウンド10で足した行番号の検査が `#L42` と `:L42` を素通しした**（R11-M1）。
  同じファイルの5行上でパス側が3通りを知っているのに、新しく書いた側は1通りしか見ない
- **ラウンド10の報告書が「行番号を機械で止めた」と書いたが、範囲は
  `docs/state-transitions/` だけ**。同じ改名で腐った ADR-0004 は範囲外だった
- **R10-M2 を半分しか直していない**。「`shutdown_all` の後に `spawn` が始まる経路も、
  落とす者が居ない」と自分で書きながら、直さなかったことを記録していない（→ #368）
- ラウンド10で畳んだ `collect_until_bestmove` に、無限解析側にはある
  stale `bestmove` の番人が落ちていた（R11-H4）

門番を直した直後から、`.rs` だけのコミットで `commentHistory` が2回、
`comment_identifiers` が1回、自分のコメントを止めた。

### 範囲について

`/implement` の「5ラウンドを超えたら直す対象を疑う」に当たったので、範囲を見直した。

このブランチの目的は**対局の Rust API**。`analyzer.rs` と `bridge.rs` の解析側は
ラウンド10で「触った範囲の中にある既存の問題」として直し始めたもので、
そこがラウンド11の所見の半分を占めた。しかも `analyzeWithTime` /
`analyzeWithDepth` には**フロントの呼び出し側が0件**で、踏める経路が無い。

**踏めない経路の設計をこの PR で決めない。** 実害として説明できるもの（潰した
`StopEffect`、stale な `bestmove`、届かない深度、知らない ID での停止）は直し、
形を変える判断が要るものは issue に出した。
