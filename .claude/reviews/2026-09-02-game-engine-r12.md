# レビュー game-engine ラウンド12

- 日付: 2026-09-02
- 範囲: `git diff 88ee677..HEAD`（r11 の7コミット）＋ その周辺
- 走らせた reviewer: rust / robustness / comment
- 対象コミット: `b56c44b`

**生の所見33件。** 3人が独立に同じ BLOCK を挙げた。

## この回で分かったこと

件数は **20 / 17 / 16 / 15 / 16 / 20 / 20 / 20 / 28 / 33**。**増えている。**

`/implement` の「ラウンドが5を超えたら、直す対象が正しいかを疑う」に当たる。
疑った結果を先に書く。

### 直している対象が2つに割れている

|                                              | このブランチの目的                                                     | フロントの呼び出し                               |
| -------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| `game/**`・`protocol.rs`・`registry.rs`      | **対局の Rust API**。これが PR の中身                                  | 未実装（PR の範囲外と決めてある）                |
| `analyzer.rs` の `collect_until_bestmove` 系 | 既存の解析機能。ラウンド10で「触った範囲の既存の問題」として直し始めた | **`analyzeWithTime` / `analyzeWithDepth` は0件** |
| `analyzer.rs` の無限解析                     | 既存                                                                   | **あり。唯一フロントが使う解析の口**             |

ラウンド10〜12の所見の半分は**2行目**に出ている。そこは呼び出し側が0件で、
このブランチが要求してもいない。#339 の形——「推測を安全にする機構を足し、
毎ラウンド新しい穴が開く」——にそのまま乗っている。

### 3行目に本物があった

robustness が挙げた BLOCK は**無限解析**の話で、フロントが毎日通る経路。
ラウンド11で `drain_stale` を足したとき、掛けたのは呼び出し側0件の2本だけで、
**唯一使われている口には掛けなかった。**

---

## 実害（3人が独立に挙げた）

### R12-B1 `analysis.md` ※11 を、同じラウンドの中で自分で嘘にした（3人が BLOCK / HIGH）

`6c50c03` で「`forward_results_to_ui` は終端で `is_active` を落とす」と直し、
2コミット後の `d0d2b04` でコードを `remove` に変えた。

**ラウンド11の報告書に「R11-B1 直した」と書いた時点で、既に偽。**

`docsIdentifiers` は綴りの実在しか見ないので緑のまま通る。同じ場所・同じ壊れ方で2回目。

`analysis.md:27` の P0 の定義「`active_sessions` が空、または全て `is_active === false`」も
後半が到達不能になっている（→ R12-B2）。

### R12-B2 `is_active` は偽になれない（rust MEDIUM / robustness MEDIUM / comment BLOCK）

`false` を書く口は `stop_all_sessions` の1つだけで、**同じロック区間の直後に
`clear()` が同じ項目を消す**。ラウンド11で `forward_results_to_ui` を `remove` に
変えたとき、偽を書く最後の実質的な口が消えた。

- `take_session` の `any(|s| s.is_active)` は `!sessions.is_empty()` と同値
- `get_analysis_status` の `is_analyzing` は**常に真**
- `forward_results_to_ui` の `emit = session.is_active` も常に真
- `stop_all_sessions` のループは**証明可能な死にコード**

欄の名前が「いま解析中か」を約束しているのに、値は「項目が存在するか」しか表さない。

### R12-B3 無限解析の再開で、前の局面の読み筋が新しいセッションの結果として画面に出る（robustness BLOCK）

**フロントが毎日通る経路。**

`stop_analysis` は `stop` を**書けた時点で**返る。`bestmove` を待たない
（対局側の `search.rs` は `SEARCH_STOP_GRACE` の上限つきで待つ）。
フロントの再開は `await stopAnalysisCore(sid)` → `startInfiniteAnalysisCore()` の直列なので、
**前の探索がまだ走っている間に次の `go` が出る。**

新しいリスナーは `go` の前に登録されるので、探索Aが `stop` を処理し終えるまでに吐く
`info` が**セッションBのリスナーへ配られる**。`process_analysis_stream` の番人は
`BestMove` にしか掛かっていないので `info` は素通りし、`analysis-update` として emit される。
フロントは `sessionId` を**読み捨てている**ので照合もされない。

筋道: 局面Aを無限解析中 → 盤を1手進める → `stop` → 即 `go`（B） →
Aの `info depth 30 score cp 250 pv ...` がBのリスナーに届く →
**Aの評価値とAの読み筋が、盤面Bの解析結果として解析ペインに出る。**

`apply_info_params` は欄ごとの上書きなので、Bの最初の数行が `pv` を伴わなければ
**Aの `pv_line` と `evaluation` は残り続ける**。MultiPV でAの rank 2/3 が入っていれば
Bがその rank を出すまで消えない。**一瞬ではない。**

`analysis.md` の不変条件4「表示している候補手は、盤面の局面に対するもの」を、
それを守るために作った `waitUntil` / `syncWaitRef` の**外側**で破っている。
エラーも警告も出ない。

**ラウンド11で `drain_stale` を足したのはまさにこの種類だが、掛けたのは
呼び出し側0件の2本だけで、唯一使われている無限解析には掛けなかった。**

### R12-H1 `stop_session` の照合が、エンジンの死という真因を「知らない ID」で置き換える（rust HIGH / robustness HIGH）

**ラウンド11で入れた2つの修正が、単独では正しく、組み合わせで壊れている。**

エンジンが落ちる → `listeners.clear()` → `raw_rx` が閉じる →
`forward_results_to_ui` が終端で**席を消す**（r11 の変更）。
フロントへは何も飛ばない（`analysis-complete` を emit する箇所は Rust に0）。

ここで盤を1手動かすと `await stopAnalysisCore(sid)` が
**`Err("unknown analysis session: ...")`**（r11 の変更）で reject し、
`catch` に落ちて **`startInfiniteAnalysisCore()` に到達しない。**

ラウンド11以前は同じ経路が `analyzer.stop_analysis()` まで進み、
`cannot_reach()` の **`engine output has ended; the process cannot be reached`**
——「エンジンが死んだ、起動し直せ」という真因が画面に出ていた。
照合を足したことで、真因の手前で内部の帳簿の話に差し替わった。

`analyzer::stop_analysis` の doc は「**エンジンが既に居なくても成功にする**。
要求は『止まっていること』で、落ちているならその要求は満たせている」と
書いてあり、1つ上の層がそれを破っている。

---

## 呼び出し側0件の経路の所見（issue へ送る）

以下は `analyze_with_time` / `analyze_with_depth` にしか掛からない。
**このブランチが要求していない。**

- `drain_stale` の前提「`go` を書き終えてから」が満たされない。`dispatch_for(Waiting, _, Go)`
  は `Queue` を返し `send_command` は `Ok` で戻るので、`go` は1バイトも書かれていない。
  `send_command` の doc 自身が「`Ok` は受理であって書けたではない」と書いている
- 深度側の「`go` が積み置きのままなら…**ここへは来ない**」が偽。`broadcast_to_listeners` は
  誰の `go` に対する行かを見ずに全リスナーへ配る。別の探索の読み筋が
  `reached: true` として返りうる
- 遅れて届く `bestmove` の番人が無い。`drain_stale` は `try_recv` を吸い切るだけで、
  **これから届く**行は掃けない。無限解析側にある `stop_flag` の番人が収集ループには無い
- `timed` / `depth` の席は ID で止められない。`session_id` を外へ出す口が無いのに、
  r11 で `stop_session` が ID を照合するようになった
- `get_analysis_result` は「席が消えた」と「知らない ID」を同じ `Err` にする

---

## 機械が機械を守れていない

### R12-M1 `verify-gate.test.sh` を走らせる者が居ない（rust / robustness / comment が独立に指摘）

`package.json` にも CI にも無い。しかも `verify-gate.sh` は `.claude/` の変更を
**素通しする**ので、この hook 自身を編集するコミットでは gate も test も走らない。

`CONTRIBUTING.md` は「何を選ぶかは `verify-gate.test.sh` が固定しています」と
**「機械で止めているもの」の節に**書いている。支えの無いものを支えとして並べている。

### R12-M2 `LINE_SUFFIX` が、落としたばかりの綴りを通す

`(,\s*\d+)*` は範囲の並びを知らない。実測:

```
"process/engine.rs:73-77, 176-180"  → 素通り
"book.h:246-248"                    → 拾う
```

素通りする綴りは、R11-M3 で `protocol.rs` から落とした**その形そのもの**。
`sourcePathsIn` 側も空白とカンマで弾かれるので、**両方を通り抜ける**。

### R12-M3 `Kind::ALL` の「どこか1つを忘れても緑にならない」に抜け道

鎖の第1環（`kind_of` に `_` を足さない）と第2環（新バリアントを**新しい** `Kind` へ写す）は
どちらも人の約束で、型は支えていない。`GuiCommand::NewThing => Kind::Go` と
既存へ写すだけでコンパイルは通り、3つとも10のまま緑になる。

`ReadyState::ALL` のほうは宣言から生えるので抜け道が無く、doc の主張はそちらでは成立している。

### R12-M4 ラウンド11で書いた3箇所に変更の経緯が入っている

`verify-gate.test.sh`「実際、`.rs` だけのコミットと `docs/` だけのコミットで2回そうなった」、
`docsSourcePaths.test.ts`「32件を落とした同じ変更で」「`#L` の形は両方を通り抜けた」。

`HISTORY_WORDS` に「そうなった」「通り抜けた」が無いので機械も止めない。
`verify-gate.test.sh` は `.sh` かつ `.claude/` 配下なので**どの検査にも当たらない**。

---

## その他（MEDIUM）

- `StopVerdict` の doc「`outcome_of_stop` と同じ4分岐」が偽。**分岐は3つ**で、
  `Timeout` の腕は下の腕と同じ値を返す。コメントを置くためだけに存在している。
  しかもそのコメント（「後から届いて `bestmove` が返る目はまだある」）も偽——
  `stop()` が `Timeout` を返した時点で `await_write` が `fail_writes` を撃ち、
  `Closed` が立って以後のリスナー登録が断られる
- `collect_until_bestmove` の doc「次の `go` は『探索中』で断られ」が偽。
  席は返るので次は始まってしまう。**直したい実害と反対の絵**を読み手に見せている
- `send_command` の「# エラー」の `CommunicationFailed` の説明が偽。
  積み置きが上限に達したときも同じ型で返り、そちらは**やり直せる失敗**。
  一覧に従うと呼び出し側はエンジンを落として起動し直す
- `docsSourcePaths.ts` のモジュール doc が、同じラウンドで広げた適用範囲を反映していない
  （パスの実在は `docs/state-transitions/`、行番号は `docs/` 全体）
- 「パスの実在を状態遷移表だけに絞ってよい」の根拠が偽。他リポジトリを引くのは3件でなく7件、
  しかも実在しない9件のうち**2件は自リポジトリの腐ったパス**（`docs/ROADMAP.md`、
  `src/search/types.rs`）。絞る判断そのものが支えを失っている
- `CONTRIBUTING.md` の `docsSourcePaths` の行が逃げ道を「無し」と書いているが `EXEMPT` がある。
  適用範囲が2つに割れていることも書いていない
- `verify-gate.sh` 冒頭の「`src-tauri/**` を歩く vitest の検査」の列挙が過不足。
  `fsErrorCodes` / `fileTreeWire` も `RUST_SRC` を読み、`stateTransitionIndex` は `docs/` しか歩かない。
  **同じファイルが `analyzer.rs` で「数え上げると必ず1つ漏れる」と書いている、その形**
- `new_session_id` の「なぜ」が因果の逆立ち。payload を持つのは条件を運ぶためで、
  名前に出すのはログで追うため。「payload を読ませるために名前に出す」からは
  次に手を入れる人が何も導けない
- 非同期を要しない新規テスト6本が `#[tokio::test]`
- 秒数を散文で書いた doc（`game-session.md`）と「数を散文で書かない」と宣言した
  テスト（`session.rs`）が併存し、どちらが正かの判断が置かれていない

---

## 見ていない範囲（3人の申告を統合）

- **3人ともエンジンを1本も起動していない。** ワイヤ上の順序は誰も観測していない
- `game/session.rs` の `run_loop` / `on_search_outcome` / `on_tick` の本体（1000行超）。
  **r7 から6ラウンド持ち越し**
- `game-session.md` の `E1`〜`E18` × `G0`〜`G2` の全セル、`failure-surfacing.md` の
  F-1〜F-26 の中身。**r7 から持ち越し**
- `game/clock.rs` / `game/types.rs` / `game/bridge.rs` の中身
- `src/entities/analysis` / `widgets/analysis-pane` の内部

**この持ち越しが6ラウンド続いていることが、範囲を絞るべき最大の理由。**
`game/session.rs` はこのブランチの中心なのに、毎ラウンド `analyzer.rs` に押し出されている。

---

## 修正計画

### 直す（フロントが通る経路と、自分が作った退行）

1. **R12-H1** `stop_session` の照合を「止めない」に留め、`Err` にしない
2. **R12-B2** `is_active` を落とす。席の有無は項目の有無で表す
3. **R12-B1** `analysis.md` ※11 と P0 の定義を現物に合わせる
4. **R12-B3** `stop_analysis` が対局側と同じ形で `bestmove` を待つ。
   `start_infinite_analysis` にも drain を掛け、フロントは `sessionId` を照合する
5. **R12-M1** `verify-gate.test.sh` を `npm run verify` に載せる
6. **R12-M2** `LINE_SUFFIX` に範囲の並びを足す
7. **R12-M3** `Kind` の単射を assert し、doc の主張を条件付きに直す
8. **R12-M4** 経緯の3箇所を現在形に。`HISTORY_WORDS` と `ROOTS` を広げる
9. 偽の doc（`StopVerdict` の4分岐、`collect_until_bestmove` の帰結、
   `send_command` のエラー種、`docsSourcePaths` の範囲と根拠、`CONTRIBUTING.md` の行、
   `verify-gate.sh` の列挙、`new_session_id` の因果）

### issue へ送る

呼び出し側0件の経路（`analyze_with_time` / `analyze_with_depth`）の所見。
**このブランチが要求していない機構を、これ以上足さない。**

### 次のラウンドの範囲

**`analyzer.rs` の解析側を範囲から外す。** 6ラウンド持ち越している
`game/session.rs` の本体と `game-session.md` の全セルに寄せる。

## 結果

（`/review-fix` で書き戻す）
