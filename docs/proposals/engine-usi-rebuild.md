# 提案: USI のやりとりを、状態機械と手順の関数へ作り直す

読みやすさの整理の範囲 5c（`docs/readability-progress.md`）の入力。

**状態: 決定済み。** 決めたものは ADR-0016（`docs/decisions/0016-usi-machine-shell-procedures.md`）が持つ。
このファイルは設計の段の入力の記録として残し、決まった所に「→ ADR-0016」の印を付けた。**食い違ったら ADR が正しい。**

- 関連: ADR-0008（`engine/` の段と逆転）/ ADR-0015（エンジン周りの目標の構造）/ `docs/proposals/engine-dependency-inversion.md`
- 棚卸し: `docs/audits/2026-11-engine.md`（C-3、D-1、R-8、R-9、B-10）
- 事実を確かめた基準: `origin/main` の 61811942

## 5c を整理でなく設計にする理由

利用者の決定。`engine/protocol.rs` を、いまの形のまま整理しない。いまの形を磨くと、作り直しで書き直す行を磨くことになる。

## 目指す形

コードジャンプで**呼び手 → 手順 → 判定**と降りていけて、手順の順序を呼び手が破れない形。

利用者の言葉では、タスクの間の通信を型で表し、低い段にも処理の単位を作って分かりやすくする。
**一から作り直すのではなく、いまの形を活かす。** 既に純関数の判定（下の「いまの形の事実」）と、
`game/session.rs` の殻の形はそのまま土台にする。狙いは次の4つを同時に満たすこと。

- **可読性**: 処理の単位ごとに、何を受けて何を返すかが型で読める
- **責務**: 状態を持つのは殻1本、判定は状態機械、順序は手順の関数、と持ち主が1つに決まる
- **定義**: 状態、受ける入力、出す出力を列挙で定義し、`docs/state-transitions/` の表と1対1にする
- **性能**: 状態の持ち主をタスク1本にすると、いま8つある `Arc<Mutex>` と `Arc<RwLock>` の取り合いが要らなくなる見込み。
  **測っていない。** 設計の段で、何を測れば良くなったと言えるか（`info` の流れの遅れ、停止から `bestmove` までの時間）を決める
  → M1〜M3 と合否の線（ADR-0016 決定9）

- **中心は IO を持たない状態機械。** 入力は受けた行と頼まれたこと、出力は送る行と知らせること。tokio もロックも持たない
- **その外側を、タスク1本の薄い殻にする。** `engine/game/session.rs` が既にこの形で、1本のタスクが状態を持ち、要求をチャネルで受ける
- **手順は少数の関数として出す。** 例: `handshake`、`configure`、`search(局面, 条件) -> Search`
- **呼び方の強制は型で行う。** 使える状態でなければ `go` を送れない。`Search` を持たなければ `stop` できない。`stop` は `bestmove` を待つところまでを含む
- **`analyzer` と `game` は手順を呼ぶだけになる。** 生の行の受け手を登録して手順を組む場所が、呼び手から消える

## いまの形の事実

- `protocol.rs` は手順を持たない。`go` → `info` → `bestmove` の手順は、呼び手が `register_listener` で生の行の受け手を登録して組む。
  `analyzer.rs` に3か所（`start_infinite_analysis`、`analyze_with_time`、`analyze_with_depth`）、`game/search.rs` に1か所ある。
  ほかに、手順ではなく出力の見張りとして `analyzer.rs` の定跡の読み込みの確認と `setup.rs` が登録する
- `stop` の後に `bestmove` を待つかの判断が2か所に写っている。`game/search.rs` の `outcome_of_stop` と、`analyzer.rs` の `verdict_of_stop` と `should_wait_for_bestmove`（棚卸しの D-1）
- 判定の一部は既に純関数: `next_ready_state`、`dispatch_for`、`push_pending`
- 一方で `UsiProtocol` は `Arc<Mutex>` か `Arc<RwLock>` の欄を8つ持ち（`Link` の2つを含む）、メソッドの中で `tokio::spawn` する
- `analyzer` と `bridge` は、起動・席・停止の順序をロックの取り方で守っている（棚卸しの R-8、R-9）
- `start_failure::classify` は `protocol` の文言を文字列で切り出し直す（棚卸しの B-10）。文言を変えても型の検査は落ちない

## 変えないもの

- **trait は差し替えが実在する所だけに置く**（`docs/rules/rust.md` の R-RST-1）。`UsiProtocol` の表面を写した trait は、ADR-0008 と
  `docs/proposals/engine-dependency-inversion.md` で却下済み。本物と挙動の違う実装を、テストが選べてしまうため。
  状態機械を IO から外すのは差し替えのためではなく、判定を純関数のテストで固定するため
- 線の名前（Tauri コマンド、serde の欄、イベント名、保存形式）。USI の語はフロントへ出さない

## 危うさ

作り直しでは並行性の振る舞いが変わりうる。**実プロセスを要する経路は、テストで1つも固定されていない**（`CLAUDE.md` の「テストの現状」）。
状態機械の外へ出した判定は純関数で固定できる。一方で、殻と手順の関数の並び（取り消し、kill の割り込み、`bestmove` の待ちの上限）は、
載せ替えの前に何で固定するかを決めておく必要がある。

## 設計の段でやること

1. `docs/state-transitions/engine.md` と `analysis.md` を、目標の形で引き直す。埋まっていないセルが、載せ替えの前に要るテストになる
   → 済。両方の表の「目標の形」の節。載せ替えの前に要るテストは engine.md の T1〜T10
2. 段階の順を決める。いまの案は次の3段で、各段の後で止められる
   → **この3段の順は採らなかった。** 呼び手を先に手順へ移し、その後で中身を作り直す U0〜U4（ADR-0016 決定8）
   1. 状態機械の切り出し: `UsiProtocol` の中の判定を、IO を持たない型へ移す。外から見た振る舞いは変えない
   2. 手順の関数: `handshake`、`configure`、`search` と、型で強制する `Search`。`stop` の後に `bestmove` を待つ判断（D-1）をここへ1つにする
   3. `analyzer` と `game` の載せ替え: 生の行の受け手の登録を呼び手から消す
3. 棚卸しの所見のうち 5c に持っていくもの（C-3、D-1、B-10 の `protocol` の側、W-1）と、`docs/readability-progress.md` の所見の表の
   `Arc<UsiProtocol>` の共有と `EngineRegistry` の `Debug` の行を、作り直しのどの段で閉じるかを決める
   → ADR-0016 決定10
4. 範囲 7（`engine/game`）と 8（`analyzer` から `commands` まで）を、作り直しの後の形で切り直す
   → ADR-0016 決定10。範囲 6 も U1 の後へ動いた

## 設計の段で答える問い

- 殻のタスクと、`registry` の台帳と、`child` の子プロセスの持ち主を、それぞれ誰にするか
  → 殻は誰も持たず、取っ手が全部落ちたら抜ける。子プロセスは殻が持つ。台帳は落とす面だけを持つ（ADR-0016 決定1・決定6）
- `info` の流れを手順の外へ出す形（`Search` が受け手を持つか、チャネルを返すか）
  → `Search` が受け手を包み、生の USI の形で返す（決定1）
- `game/session.rs` の殻と、新しい殻を1つの形に揃えるか
  → 形は揃え、コードは共有しない（決定5）
- kill と取り消しを、状態機械の入力として扱うか、殻の側で扱うか
  → kill は状態機械の入力、取り消しは呼び手の側（決定4）
