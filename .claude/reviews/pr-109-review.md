# PR Review: #109 — feat(engine): Phase 0-1 — preset → AnalysisConfig.mode wiring (#107)

**Reviewed**: 2026-06-07
**Author**: Rioh1118
**Branch**: `feat/p0-1-preset-analysis-wiring` → `feature/phase-0-engine-ux`
**Decision**: REQUEST CHANGES (HIGH bug + CI red on `cargo fmt`)

## Summary

preset の `AnalysisDefaults` を Rust `start_analysis(AnalysisConfig)` まで通す配線として全体構造は妥当。
discriminated union 化 (`mode` tag + payload) と Strategy 注入 (`buildConfig: () => AnalysisConfig` で FSD 違反を解消) は方向性が良い。
ただし **finite モード (time/depth/nodes/mate) の完了時に UI が "解析中" 表示で固まる** クリティカルな UX バグが残っており、これが PR の目的そのものを潰しているのでマージ前に必ず修正が要る。
あわせて CI が `cargo fmt --check` で落ちている (3 ファイル) — 本レビュー作業中に手元で修正済み。

## Findings

### CRITICAL

None.

### HIGH

#### H1. finite モードで `analysis-complete` が emit されず UI が解析中で固着 (Codex bot 指摘と同件)

- **場所**: `src-tauri/src/engine/bridge.rs:156-226` (`forward_results_to_ui`)
- **症状**: `Time / Depth / Nodes / Mate` で engine が自然終了すると、analyzer の channel が閉じる → `forward_results_to_ui` がループ脱出 → `session.is_active = false` をセットするだけで、Tauri event を一切 emit しない。フロント側は `entities/analysis/model/provider.tsx:137-142` (`onComplete`) でしか `state.isAnalyzing` をクリアしないので、ヘッダーは "解析中" のまま、再開ボタンが Stop のまま固まる。Stop を押すと、すでに非 active な session に対する no-op が走って復帰するだけ。
- **重大度**: HIGH — 本 PR が追加した 4 モードがすべて事実上動かない。PR の Test plan の `mode=time(10s) で開始 → engine が byoyomi 10s で終了 → bestmove で streaming 完了` を実機で踏めば即露出する未テスト項目。
- **修正方針**: receiver loop 脱出直後に `app_handle.emit("analysis-complete", { sessionId, result })` を発行する。`AnalysisCompleteEvent` 型はフロント `rust-types.ts:81-85` に既にあり、`listenToAnalysisComplete` も `events.ts:17-26` に配線済み。Infinite で `IgnoreUnlessStopped` 経路を通った場合も同じ event を出して問題ない (フロント `stop_analysis` reducer action は idempotent)。

```rust
// receiver loop 終了後、sessions write の前後で:
let final_result = sessions_guard.get(&session_id).and_then(|s| s.last_result.clone());
if let (Some(handle), Some(result)) = (app_handle.read().await.clone(), final_result) {
    let _ = handle.emit(
        "analysis-complete",
        serde_json::json!({ "sessionId": session_id, "result": result }),
    );
}
```

#### H2. CI red: `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`

- **場所**: `analyzer.rs:291` (let stopped の分割), `bridge.rs:46` (余分空行), `types.rs:310` (assert_eq! 1 行整形)
- **重大度**: HIGH (マージブロッカー、ただし機械的) — 手元では fix 適用済み。本レビュー作業ブランチに `style: cargo fmt` の追加コミットを乗せれば解消。

### MEDIUM

#### M1. `infinite_stop_requested` が前回セッションの値を引きずる

- **場所**: `analyzer.rs:158-164`, `217-233`
- **症状**: `Infinite` 以外の `start_analysis` では flag を上書きしない。`Infinite → Stop → Time` の順で動かすと `Some(true)` が居座る。今日は `handle_bestmove != IgnoreUnlessStopped` なので無害だが、将来 `Pondering` 系を追加すると Heisenbug 化する。
- **修正**: 開始時に常に `*self.infinite_stop_requested.lock().await = if matches!(config, AnalysisConfig::Infinite) { Some(flag.clone()) } else { None };` のように明示クリアする。

#### M2. `time/depth/nodes` を `byoyomi` で近似している件の中長期方針

- **場所**: `analyzer.rs:379-393` (`build_go_command`), PR Notes でも明記
- **状況**: `usi crate 0.6.2` が `go movetime/depth/nodes` を表現できないので
  - `Time { seconds }` → `byoyomi <ms>`
  - `Depth / Nodes` → `byoyomi 10min` ceiling + threshold で `Stop`
    に妥協している。MEMORY.md には「`RawEngineHandler` 経由 `send_raw_go()` を持っている」とあるので、本来は raw 送信で `go movetime N` / `go depth N` / `go nodes N` を直接送るのが正解。
- **提案**: 別 issue を切って `raw send 経路への差し替え` を Phase 0 内 / Phase 1 直前で消化する。現状は test plan の `mode=depth(20) で 20 到達後に Stop` が **byoyomi ceiling 10 分内に rank1 depth=20 に届かないエンジン設定ではタイムアウト終了する**仕様。

#### M3. `buildAnalysisConfig` のサイレントデフォルト

- **場所**: `entities/engine-presets/lib/buildAnalysisConfig.ts:5-40`
- **症状**: ユーザが `time` を選んだのに `timeSeconds` が `undefined / 0` だと、無言で 10 秒で打ち切る。ダイアログ側 `EnginePresetEditDialogPanel.onSave` は値が 0 だと `undefined` に落とすので、UI 上 0 を入れて保存 → 解析開始すると挙動が説明不能になる。
- **修正案**: ①Dialog `onSave` で active mode の値が 0/欠損なら validation error にする、②または `AnalysisDefaultsSection` の数値 input に `placeholder="default: 10"` 等を出して "0/空でデフォルト" を明示する。最低片方は欲しい。

#### M4. `AnalysisDefaultsSection` Depth/Nodes の入力域と save 時 clamp の食い違い

- **場所**: `AnalysisDefaultsSection.tsx:76-103` (`min={0}` のみ、`max` 無し) と `EnginePresetEditDialogPanel.tsx:441-443` (`depth ≤ 999`, `nodes ≤ 999_999_999`)
- **症状**: UI で 9999 を入れて保存しても黙って 999 に丸まる。
- **修正**: input にも `max={999}` / `max={999_999_999}` を入れるか、save 時に explicit validation error を出す。

#### M5. PR description が最新 commit と矛盾

- **場所**: PR body
- **症状**: "`start_infinite_analysis` は互換のため残置" "`startInfiniteAnalysis` は alias に" と書かれているが、`9d2ae73` で **両方とも削除済み**。新規読者が古い API を探してしまう。
- **修正**: PR description を refactor 後に追従させる (Notes の冒頭にもうワンライン)。

### LOW

#### L1. `analysisDefaults` provider のフォールバックが dead code

- **場所**: `entities/engine-presets/model/provider.tsx:86`
- `mode: a?.mode ?? "infinite"` だが `normalizeOnePreset` 通過後は必ず `mode` あり (`normalize.ts:86-101`)。残しても害はないが、不変条件を一言コメントするか落とす。

#### L2. `now_nanos()` ベースの `listener_id` / `session_id`

- **場所**: `analyzer.rs:171`, `bridge.rs:336-354`
- 同一ナノ秒で 2 回 start が走ると ID 衝突。`bridge.ensure_no_active_session` で防がれているので現状無害だが `uuid::Uuid::new_v4()` のほうが将来安心。pre-existing。

#### L3. `rust-types.ts` に未使用型が残存 (pre-existing)

- `BatchAnalysisConfig/Position/Result`, `EngineStatus` などは今回も使われていない。別 PR で棚卸し推奨。

#### L4. `mate` モードに上限が無い

- `Mate → MateParam::Infinite`。不詰局面では永遠に思考する。研究用途では妥当だが、安全装置として「秒数付き mate」を許す設計に踏み込むか、ドキュメントしておく。

## Validation Results

| Check                                       | Result                         | Notes                                               |
| ------------------------------------------- | ------------------------------ | --------------------------------------------------- |
| ESLint (`npm run lint`)                     | Pass                           | 0 warnings / 0 errors / 308 files                   |
| TypeScript (`tsc --noEmit`)                 | Pass                           | no output                                           |
| Vitest (`npx vitest run`)                   | Pass                           | 4 files / 51 tests passed                           |
| `cargo fmt --check`                         | **Fail → Fix applied locally** | 3 hunks across `analyzer.rs / bridge.rs / types.rs` |
| `cargo check`                               | Pass                           | clean                                               |
| `cargo clippy --all-targets -- -D warnings` | Pass                           | clean                                               |
| `cargo test engine::`                       | Pass                           | 13 / 13                                             |
| Manual finite-mode happy path               | **Not run** (要実機)           | Test plan が全部空 — H1 が暴露する想定              |

## Files Reviewed (18)

- Modified: `src-tauri/src/engine/{analyzer.rs, bridge.rs, types.rs, lib.rs}`
- Modified: `src/entities/engine/api/{rust-types.ts, tauri.ts}`
- Modified: `src/entities/engine-presets/{lib/normalize.ts, model/{provider.tsx, types.ts}}`
- Modified: `src/entities/analysis/model/{provider.tsx, types.ts}`
- Modified: `src/app/providers/bridges/AnalysisBridge.tsx`
- Modified: `src/widgets/analysis-pane/ui/AnalysisPaneHeader.tsx`
- Modified: `src/features/settings/ui/engine-preset-dialog/{EnginePresetEditDialogPanel.tsx, sections/AnalysisDefaultsSection.tsx}`
- Added: `src/entities/engine-presets/lib/{buildAnalysisConfig.ts, buildAnalysisConfig.test.ts, normalize.test.ts}`

---

## 親タスク / Phase 0 以降への提言

### P1. ロードマップ (#56) と Phase 0 Epic (#77) の不整合

- **状況**: #56 は Phase 0 を `#82 / #83 / #84 / #85` で列挙しているが、#77 では `#82` を drop し後継として `#107` (本 PR) / `#108` を据えている。`#56` には `#107` / `#108` の参照が無い。
- **アクション**: `docs/ROADMAP.md` と `#56` の Phase 0 セクションを #77 と整合させる。`#82` は close 状態を明示。

### P2. `raw send 経路` のロードマップ化 (M2 と同根)

- **状況**: PR Notes に raw 送信への差し替え予定があるが issue 化されていない。`#107` を close するときに follow-up が無いと忘れる。
- **アクション**: `feat: switch finite analysis go to send_raw_go` の issue を切り、#77 の sub-task に追加 (#107.5 相当)。Phase 0 のうちに消費するか、Phase 1 解析キャッシュ着手前に解決。

### P3. ~~`AnalysisPaneHeader` mode chip (#108)~~ — **撤回**

- 本 PR の "Header から mode label を剥がす" 判断が真。`#108` は drop / close する。Header は実行状態 (解析中/停止中 + elapsed timer) のみで、mode は preset ダイアログでのみ確認する設計に統一。

### P4. `EngineOption.option_type` を discriminated union 化 (#83 の前提整理)

- **状況**: 現在 `rust-types.ts` の `EngineOptionType` は **all-optional** な object (`Check?, Spin?, ...`)。これでは #83 の "Check / Spin / Combo / Button / String / Filename" 型別エディタを書くと nested optional chaining だらけになる。Rust 側 (`types.rs:20-43`) は既に enum なので、TS 側も `{ type: "Spin", default, min, max } | ...` の discriminated union にすれば自然に書ける。
- **アクション**: #83 の最初の commit でこの正規化をやる方針を Issue に書き加える。

### P5. ~~#108 chip ラベル仕様~~ — **撤回** (P3 と同根)

### P6. #85 (preset switch UX) の "解析中切替" 仕様

- **状況**: 現状の `AnalysisProvider` は `buildConfigRef` を最新 builder に追従させる (`provider.tsx:34-37`) ので、解析中に preset を切り替えると次の位置変化での restart から新 mode が効く。即時反映ではない。
- **アクション**: #85 の DoD に「**解析中 preset 切替時に解析を再開すべきかどうか**」を明文化。

### P7. Phase 0 のテスト戦略

- **状況**: 本 PR の手動 Test plan 6 項目が全部未チェック (vitest と cargo test は通過済み)。H1 のような E2E 系バグは unit では捕まらない。
- **アクション**: Phase 0 完了の DoD に「`mode=*` の smoke を Tauri 実機で 1 度通す」をチェックリスト化。`/ecc:e2e-runner` で Tauri Playwright が走るなら自動化候補。

---

## Next steps

1. **本 PR は REQUEST CHANGES**。H1 (analysis-complete emit) と H2 (cargo fmt) を fix。H1 はバックエンド 5 行、H2 は機械的。
2. PR description を最新 commit に追従させる (M5)。
3. M1 / M3 / M4 は本 PR で潰せると望ましい (どれも小さい)。M2 は follow-up issue で OK。
4. 親タスク観点では P1 (ロードマップ整合) と P4 (#83 前提) を `/grill-me` で深掘る価値あり。
