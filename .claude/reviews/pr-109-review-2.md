# PR Review #2: #109 — feat(engine): Phase 0-1 — preset → AnalysisConfig.mode wiring (#107)

**Reviewed**: 2026-06-03
**Author**: Rioh1118
**Branch**: feat/p0-1-preset-analysis-wiring → feature/phase-0-engine-ux
**Decision**: REQUEST CHANGES
**Focus**: コメントスタイル / 変更しやすさ / アーキテクチャ / 依存関係（意味論の指摘は [pr-109-review.md](./pr-109-review.md) 参照）

---

## Summary

意味論側を一旦置いても、**構造側に来期(=Phase 0-2)のコストを増やす芽がいくつか入っている**。具体的には:

- 「無効状態を型で禁止できる」のに `AnalysisConfig` がフラットなまま（mode と limit field が独立）
- `entities/analysis → entities/engine-presets` の **entity 同士の依存** が新規に発生（FSD 違反の方向）
- 解析開始経路が `start_infinite_analysis` / `start_with_config` / `analyze_with_time` / `analyze_with_depth` の **4 系統並走**（うち 2 は dead）
- `mateSearch` を「派生値」と言いつつ 4 箇所で個別に同期している
- コメントは「WHAT を言い直すコメント」と「USI 内部語が UI 層に漏れるコメント」の 2 系統が増えた

Rust の `process_analysis_stream` 統合は綺麗で、`build_go_command` / `build_stream_and_go` の純関数化は良い。ここから 1 歩進めて **データモデルを `enum AnalysisLimit` 化** すれば、UI/Rust/JSON すべての整合が型で取れる。

---

## Findings

### CRITICAL

None.

### HIGH

#### H-A1. `entities/analysis` が `entities/engine-presets` を直接 import している（FSD 違反）

- 場所: `src/entities/analysis/model/provider.tsx:13`
  ```ts
  import type { AnalysisDefaults } from "@/entities/engine-presets/model/types";
  ```
  および `provider.tsx:21,54,303,225` で `AnalysisDefaults` を直に使う。
- 問題:
  - FSD の方向則は `app > pages > widgets > features > entities > shared`。**entity 同士（sibling）の依存はしない**のが前提。
  - 本 PR より前は `AnalysisBridge` が橋渡しする構造で、`entities/analysis` は preset を知らなかった。今回これが壊れた。
  - 影響: `analysis` を単独でテスト/再利用しようとすると `engine-presets` がついてくる。`engine-presets` の型変更が `analysis` を引きずる。
- 推奨（破壊変更ほぼ無し）:
  - `AnalysisProvider` の prop を「AnalysisDefaults を受け取る」ではなく「**`buildConfig: () => AnalysisConfig` を受け取る**」（Strategy 注入）に変える
  - bridge 側（`AnalysisBridge.tsx`）で `useEnginePresets()` から `AnalysisDefaults` を読み、`buildAnalysisConfig()` を生成して渡す
  - 結果: `entities/analysis` は `engine-presets` を一切知らない。bridge 層がその責務。

  ```tsx
  // AnalysisBridge.tsx
  const { analysisDefaults } = useEnginePresets();
  const buildConfig = useCallback(
    () => buildAnalysisConfigFromDefaults(analysisDefaults),
    [analysisDefaults],
  );
  return (
    <AnalysisProvider {...positionSync} buildConfig={buildConfig}>
      {children}
    </AnalysisProvider>
  );
  ```

  - `buildAnalysisConfigFromDefaults` は `entities/engine-presets/lib/` に置く（presets が config に変換するのは正方向の依存）

#### H-A2. `AnalysisConfig` が「無効状態を表現できる」フラット構造のまま

- 場所: `src-tauri/src/engine/types.rs:137-145`, `src/entities/engine/api/rust-types.ts:33-40`
- 問題:
  - 現在の shape:
    ```rust
    pub struct AnalysisConfig {
        pub mode: AnalysisMode,
        pub time_limit: Option<Duration>,
        pub depth_limit: Option<u32>,
        pub node_limit: Option<u64>,
        pub mate_search: bool,  // legacy
    }
    ```
  - `mode = Depth` + `depth_limit = None` + `time_limit = Some(10s)` のような「説明できない組合せ」が型で許される。
  - Rust 側の `build_stream_and_go` / `build_go_command` は `match mode` 分岐の中で他フィールドを `unwrap_or` してハードコードのデフォルトに化ける（`analyzer.rs:731,735`、前回レビュー M2）。
- 推奨: **`AnalysisConfig` を直和に**

  ```rust
  #[derive(Serialize, Deserialize)]
  #[serde(tag = "mode", rename_all = "lowercase")]
  pub enum AnalysisLimit {
      Infinite,
      Time { seconds: u64 },
      Depth { plies: u32 },
      Nodes { count: u64 },
      Mate { timeout_seconds: Option<u64> },
  }

  pub struct AnalysisConfig {
      pub limit: AnalysisLimit,
      // 将来: pub multi_pv: Option<u32>, など独立した解析オプションのみ
  }
  ```

  - 利点:
    - 「Time モードなのに time_limit 無し」のような状態を **コンパイル時に禁止**
    - `match mode` で他フィールドを `unwrap_or(...)` する必要が消える → マジックナンバー（前回 M2）が同時に消える
    - `mate_timeout` を Time と分離できる（前回 H2 の物理的解決）
    - serde `tag = "mode"` でフロントの discriminated union と素直に対応する:
    ```ts
    type AnalysisLimit =
      | { mode: "infinite" }
      | { mode: "time"; seconds: number }
      | { mode: "depth"; plies: number }
      | { mode: "nodes"; count: number }
      | { mode: "mate"; timeoutSeconds?: number };
    ```
  - 移行: 旧 JSON は `entities/engine-presets/lib/normalize.ts` の `inferAnalysisMode` と同じ要領で `AnalysisLimit` に畳む。preset の disk 形式は今のフラット形を維持しても、Rust に渡す前に変換しても良い。

#### H-A3. 解析開始経路が 4 系統並走している

- 場所:
  - `analyzer.rs::start_infinite_analysis` (lines 142-242, ~100 行)
  - `analyzer.rs::start_with_config` (lines 251-348, ~100 行)
  - `analyzer.rs::analyze_with_time` (lines 351-392)
  - `analyzer.rs::analyze_with_depth` (lines 395-440)
  - bridge 側にも `start_infinite_analysis_impl` / `start_analysis_impl` / `analyze_with_time_impl` / `analyze_with_depth_impl` が並ぶ
  - `lib.rs:78-79` でも `start_infinite_analysis` と `start_analysis` の両方を `tauri::generate_handler!` に登録
- 問題:
  - `start_infinite_analysis` と `start_with_config` は **ほぼ同じ手順のコピペ**: ① init チェック ② listener 登録 ③ go 送出 ④ task spawn ⑤ stream 処理。差は `StreamMode` と `GuiCommand` の組み立てだけ。
  - 1 つ mode を追加すると、追加箇所を間違えやすい。
  - `SessionType::Timed/Depth` も `#[allow(dead_code)]` で死蔵中（前回 M4）。
- 推奨:
  - `start_infinite_analysis` を **`start_with_config(AnalysisConfig::infinite())` の薄い wrapper** にする。`process_analysis_stream` は既に 4 mode 共通化されているので、入口だけ統合できる。
  - `analyze_with_time` / `analyze_with_depth` は呼び出し元（PR 説明によると現フロントから呼ばれていない）。削除する/`#[deprecated]` を付ける/`Cfg(test)` に隔離する のどれかを今 PR の範囲で決める。「残してあるけど誰も呼ばない」が一番モイト。
  - Tauri command の `start_infinite_analysis` も同上。残す合理的理由（外部スクリプトが叩いている等）が無ければ削除候補。

#### H-A4. `mateSearch` 派生不変条件が 4 箇所に散在

- 場所:
  1. `AnalysisDefaultsSection.tsx:22` `mergeAnalysis` 内: `next.mateSearch = next.mode === "mate"`
  2. `EnginePresetEditDialogPanel.tsx:451` `handleSave` 内: `mateSearch: a.mode === "mate"`
  3. `normalize.ts:100` `normalizeOnePreset` 内: `mateSearch: mode === "mate"`
  4. `entities/engine-presets/model/provider.tsx:91` `analysisDefaults` selector 内: `mateSearch: mode === "mate"`
  5. `entities/analysis/model/provider.tsx:42` `buildAnalysisConfig` 内: `mate_search: defaults.mode === "mate"`
- 問題:
  - 「`mateSearch === (mode === "mate")`」は **AnalysisDefaults 型の不変条件**。今は呼び出し側で守る規律。
  - 5 箇所のうち 1 つでも忘れると不整合状態が生まれ、しかも `mateSearch: boolean` は `required` なので TS が忘れを検知してくれない。
  - 「派生値」だと文書化されているが、型は `mateSearch: boolean`（required）。**ドキュメントと型が矛盾**している。
- 推奨（短期）:
  - `withDerivedFlags(a: Pick<AnalysisDefaults, 'mode' | ...>): AnalysisDefaults` を `entities/engine-presets/lib/` に切り出し、全員これを通す。
  - もしくは `mateSearch?: boolean` にして「読むのは normalize 時だけ」を型でも表現。
- 推奨（中期）: H-A2 を取れば `mate_search` 自体が消える。

#### H-A5. `process_analysis_stream` の StopStrategy 部分が match in match で展開している

- 場所: `analyzer.rs:509-536` (info の中で `match &mode`), `545-567` (bestmove の中で `match &mode`)
- 問題:
  - 「いつ stop を送るか」「bestmove をどう扱うか」を `StreamMode` の variant に対して各所で分岐。
  - 5 variants × 2 場所 × `Info`/`BestMove` の処理が広がっており、新 mode 追加時に「両方の場所を直す」必要がある（バグの温床）。
- 推奨: `trait` or `enum` の振る舞いメソッドに集約。

  ```rust
  enum StreamMode { Infinite(Arc<AtomicBool>), Finite, FiniteDepth(u32), FiniteNodes(u64) }

  impl StreamMode {
      fn should_stop_on_info(&self, r: &AnalysisResult) -> bool { /* depth/nodes 閾値 */ }
      fn handle_bestmove(&self) -> BestmoveAction { /* Finish / IgnoreStale / FinishIfStopped */ }
  }
  ```

  - `process_analysis_stream` は受け取った `mode` のメソッドだけ呼ぶ。新 mode 追加時の修正箇所が 1 つに収束。

### MEDIUM

#### M-A1. ドキュメントコメントが「WHAT を言い直し」になっている箇所

- 例:
  - `analyzer.rs:114 /// 局面を設定`（関数名 `set_position` の言い直し）
  - `analyzer.rs:142 /// 無限解析開始`（関数名 `start_infinite_analysis` の言い直し）
  - `analyzer.rs:350 /// 固定時間解析` / `:394 /// 深度制限解析` / `:442 /// 解析停止` / `:461 /// 最後の分析結果取得` / `:466 /// 分析統計取得` / `:471 /// 現在の局面取得` / `:580 /// 単一結果収集` / `:616 /// 深度制限付き結果収集`
  - `bridge.rs:192 /// UI向け結果転送処理`
- 方針（CLAUDE.md: 「WHY が non-obvious なときだけコメント」）:
  - これらは関数名と同じ情報しか伝えていない。削除して問題ない。
  - 残すなら「**この関数は ◯◯と違って × しない**」「× の場合は ◯ する」のような「**読者がコードからは読み取れない情報**」を載せる。例: `/// 同期実行。完了するまで待つ — streaming が要るなら start_with_config を使え`。
- ぜひ残してほしいコメント（良い例）:
  - `analyzer.rs:48-55` `StreamMode` の variant doc — 「Stop が送られる」「bestmove で end」など振る舞いを書いてあり、コードを読まずに意図が分かる。👍
  - `analyzer.rs:716-718` `build_stream_and_go` の "Infinite モードのみ stop flag を ..." — 副作用を明示。👍

#### M-A2. USI 内部語が UI 層の説明文/コメントに漏れている

- 場所:
  - `AnalysisDefaultsSection.tsx:9-13` の `description` 列: 「byoyomi (ms) を engine に渡す」「rank1 が指定 depth に到達したら Stop」「go mate / mate infinite を engine に渡す」
  - `:43` `description="このプリセットで解析開始した時の go コマンドを決めます"`
  - `:47` `description="go コマンドの形を決める。値は各モードのフィールドが保持します"`
  - `engine-presets/model/types.ts:8` `/** 解析モード。go コマンドの形を決める唯一のソース。 */`
- 問題:
  - "byoyomi / rank1 / go コマンド" は **USI/Rust 層の用語**。features/entities の TS 型 doc にあると、リファクタ時に「この型は USI のシリアライザですか」と読まれる。境界を曖昧にする。
  - 前回 H3/L1 と同根（UI 文言）。**今回はコード側にも残っている**ことを追加で指摘。
- 推奨:
  - UI に表示する文言は features 層側で「ユーザー言葉」に統一（前回 H3）
  - エンティティの doc は「**この型が何を表現するか**」だけに絞る:
    ```ts
    /**
     * このプリセットで解析を開始したときの停止条件。
     */
    mode: AnalysisMode;
    ```
  - 「go コマンド」「byoyomi」「rank1」のような USI 内部語は Rust 側の analyzer/bridge にだけ存在させる。

#### M-A3. 「mode が必須化された」型変更が破壊的だが互換性の合図が無い

- 場所: `types.ts:7-15` の `AnalysisDefaults`
- 内容:
  - `mode: AnalysisMode` を **required** に追加。
  - normalize で「旧 JSON は推定」を吸収するが、型としては「`AnalysisDefaults` を生でハンドコードしている既存テスト/モック」がコンパイル切れる。
  - `EnginePresetEditDialogPanel.tsx:438` で `{ mode: "infinite", mateSearch: false }` を fallback として書いているが、ここを忘れた場合に静かにオブジェクトを `as any` で書きそうな箇所が多い。
- 推奨:
  - 短期: `mode` を必須にしたという事実を CHANGELOG/PR 説明に明示。
  - 中期: `AnalysisDefaults` のコンストラクタ関数（`createDefaultAnalysis()` 等）を 1 本だけ置き、**全員これを通す**。`mergeAnalysis` をそれの partial-update 版にする。
  - そうすれば「`{ mateSearch: false }` だけ書いて mode が落ちる」事故を型から消せる。

#### M-A4. `mode_tag` と `SessionType::Config` 内の match が同じテーブルを 2 個持つ

- 場所:
  - `analyzer.rs:773-781` `mode_tag(mode: &AnalysisMode)`
  - `bridge.rs:401-407` `create_session` 内の inner match
- 問題: 同じマッピング (`AnalysisMode → &'static str`) を 2 箇所で持つ。リネーム時に片方を忘れる。
- 推奨: `impl AnalysisMode { fn as_str(&self) -> &'static str { ... } }` を types.rs に置き、両者がそれを呼ぶ。`Display` 実装でも良い。

#### M-A5. `start_with_config` Rust 層に入力 validation が無い

- 場所: `analyzer.rs:251-348` (`start_with_config`)
- 問題:
  - `mode = Time` で `time_limit = None` → `build_go_command` が黙って 10s フォールバック
  - `mode = Depth` で `depth_limit = None` → 黙って 20 フォールバック
  - これは bridge 層の Tauri command 境界で **早期に弾く**べき（ユーザー入力 → Rust の boundary）。
- 推奨: `bridge.rs::start_analysis_impl` で `validate(&config)` を 1 本走らせて `Err` を返す。`InvalidState` を Tauri layer から返せばフロントが mode 切替を強制できる。
  - H-A2 を取ればこのレイヤの validation 不要（型で禁止される）。

#### M-A6. `AnalysisProvider` が 377 行・責務過多

- 場所: `src/entities/analysis/model/provider.tsx`
- 内容（責務）:
  1. event listener setup
  2. flush timer
  3. restart-on-position-change debounce
  4. session lifecycle dispatch
  5. AnalysisConfig 組み立て (PR で追加)
  - 既に大きかったが PR で「config 組み立て」「ref 同期」「buildAnalysisConfig」が追加され重くなった。
- 推奨（破壊変更最小）: H-A1 の `buildConfig` 注入と組み合わせて、config 組み立てを外に出す。残り 4 責務もいずれ hooks に切り出す（`useAnalysisRestartScheduler`, `useAnalysisFlushBuffer` など）。今 PR の範囲なら `buildAnalysisConfig` を `entities/engine-presets/lib/` に移すだけで効果がある。

### LOW

#### L-A1. `// 後方互換 alias` だけのコメントが伝達不足

- 場所: `provider.tsx:314,315`、`types.ts:33`
  ```ts
  /** 後方互換 alias。内部で `startAnalysis()` に転送する。 */
  startInfiniteAnalysis: () => Promise<void>;
  ```
- 提案:「**いつ消すか / なぜまだ消せないか**」が無いと「permanent legacy」になる。
  - `/** @deprecated Phase 0-2 で削除予定。新規呼び出しは startAnalysis() を使う。 */` のように廃止予定をコメント＋型で示し、現在の呼び出し元を grep 可能にする。
  - TS なら `@deprecated` JSDoc で IDE に取り消し線が出る。安価。

#### L-A2. `mate_search: boolean` の doc コメントが「派生値」と書きつつ型は required

- 場所: `entities/engine/api/rust-types.ts:39`

  ```ts
  /** legacy field — kept so旧 JSON のシリアライズが落ちないように。新規コードは mode を使う */
  mate_search?: boolean;
  ```

  - TS 側は `?` で optional だが、`engine-presets/model/types.ts:14` 側は required。**同じ概念を別エンティティで違う optionality** で表現している。

- 推奨: `engine-presets` 側も optional に揃える（H-A4 の修正の中で）。

#### L-A3. コメントの言語が混在

- `rust-types.ts:39` の `// legacy field — kept so旧 JSON のシリアライズが落ちないように` で英語と日本語が空白なしに連結している
- `bridge.rs:394` `// ===  session === //` — 全角 / 半角空白の typo、`//` で閉じてる
- `analyzer.rs:476` `// === 内部ヘルパーメソッド ===` は良い
- 提案: チーム規約をリポジトリのどこかに固定化。今 PR で対応不要。

#### L-A4. テストが 0 件

- 場所: PR 全体
- 内容: `build_go_command`, `build_stream_and_go`, `inferAnalysisMode`, `mergeAnalysis`, `buildAnalysisConfig`, `withDerivedFlags`(将来) はすべて **純関数 / 副作用なし** で単体テスト可能。
- CLAUDE.md 「最低 80% カバレッジ」「TDD 必須」と整合しない。
- 推奨: 最低限の例として:
  - `inferAnalysisMode` の優先順位確認 (mate > time > depth > nodes > infinite)
  - `mergeAnalysis` で mode 切替時に `mateSearch` が同期される確認
  - `buildAnalysisConfig` で `timeSeconds <= 0` が `time_limit` から落ちる確認
  - Rust 側 `build_go_command(AnalysisMode::Mate, time_limit=Some(60s))` が `MateParam::Timeout(60s)` を出す確認

#### L-A5. 同じ機構の重複 (LogThrottle 利用、now_nanos 等) の場所を `utils` に統合する余地

- `analyzer.rs:16-21` `now_nanos()` と `bridge.rs:409-412` インラインの SystemTime → nanos 計算が同じ実装。
- 既に `crate::engine::utils` があるので、`now_nanos()` を `utils.rs` に上げて両者から呼ぶ。今 PR 範囲外でもよい。

#### L-A6. `process_analysis_stream` の `state` パラメータが `#[allow(unused_variables)]` 付き

- 場所: `analyzer.rs:485`
- 既存事項だが、最後（574 行目）で `state.write().await.last_result = ...` で使われている。`#[allow(unused_variables)]` は不要に見える（cargo clippy が dead 判定する条件下なら別だが）。
- 推奨: 不要なら削除、必要なら理由をコメントで残す。

---

## Validation Results

| Check                                              | Result                                        |
| -------------------------------------------------- | --------------------------------------------- |
| Type check (`npm run build`)                       | Pass (PR description で確認済み)              |
| Lint (`npm run lint`)                              | Pass (PR description で確認済み)              |
| Rust (`cargo clippy --all-targets -- -D warnings`) | Pass (PR description で確認済み)              |
| Tests (新規)                                       | **No new tests** — H-A 系の純関数群が無テスト |

---

## 推奨アクション（優先度順）

1. **H-A1（FSD 違反）** — `AnalysisProvider` の prop を `buildConfig: () => AnalysisConfig` に変えて bridge 経由で注入する。差分小、即効性大。
2. **H-A2（型で無効状態を禁止）** — `AnalysisConfig` を `enum AnalysisLimit` に再設計。前回 M2/H2 と本 PR M-A5 を一気に解決する根本対処。
3. **H-A3（4 系統並走）** — `start_infinite_analysis` を `start_with_config(Infinite)` の wrapper にする。`analyze_with_time/depth` は `#[deprecated]` か削除。
4. **H-A4（mateSearch 不変条件）** — `withDerivedFlags(a)` を 1 本切り出して全員これを通す。H-A2 を取れば自然解消。
5. **H-A5（StreamMode の振る舞いをメソッド化）** — match in match を解消。
6. **M-A1 / M-A2 / L-A2 / L-A3（コメント整理）** — WHAT-restatement を削り、UI 層に USI 用語を残さない。
7. **L-A4（テスト追加）** — 純関数 5 個に 10〜15 ケース。1 時間程度の作業。
8. その他 M/L は Phase 0-2 でまとめて。

---

## ひとことで

「**実装は通ったが、データモデルが invariant を型で守れていない**」状態。Phase 0-2 に進む前に `AnalysisConfig` を enum 化（H-A2）+ entity 間依存の解消（H-A1）の 2 本を入れると、以後の mode 追加・UI 仕様変更に強くなる。コメントは「動詞言い直し」を削って、`StreamMode` variant 上の「振る舞い doc」のような **読まないと分からないこと** に絞ると、PR レビューの口数が次から減る。
