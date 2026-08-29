# レビュー issue-120 依存の方向と構造 ラウンド1

- 日付: 2026-08-29
- 範囲: `src/` のレイヤ依存（FSD）、`position-sync` の設計、`widgets/file-tree` の循環、`shared/` と `entities/` の境界
- 走らせた reviewer: architecture-reviewer, react-reviewer
- 対象コミット: `a186f65`
- 注記: サブエージェントのロースターはセッション起動時に確定するため、この回は `general-purpose` に
  `.claude/agents/*.md` と `.claude/skills/review-protocol/SKILL.md` を読ませて実行した。次回以降は再起動後に直接指定できる

---

## 所見

### [HIGH-1] 計測から漏れた9件目の層違反。相対パスで `entities` が `widgets` を読んでいる（architecture）

- 場所: `src/entities/position/ui/BoardPreview.tsx:5`
- 根拠:

```tsx
import PieceFactory from "../../../widgets/game-board/ui/PieceFactory";
```

- なぜ問題か: oxlint で計測した「違反8件」は `@/` エイリアスのパターンだけで数えている。
  この行はエイリアスを使わないので `no-restricted-imports` に `@/widgets/**` を書いても**素通りする**。
  「0件になった」と見えて実際は残る。さらに `PieceFactory` 側は `@/entities/position/model/shogi` を
  読んでおり、entities ⇄ widgets の相互参照になっている。
  2階層以上遡る相対 import は全20件あり、層を跨ぐのは `AppLayoutHeader.tsx:2,5` /
  `TreeNodeActions.tsx:2` / `GameControls.tsx:1` / `PositionNavigationModal.tsx:1,5` /
  `PositionSearchModal.tsx:4,16` / `BoardPreview.tsx:5`。上向きはこの1本のみ。
- 直し方:
  1. `PieceFactory` と `widgets/game-board/ui/pieces/` を `entities/position/ui/` へ移す。
     `PieceFactory` の依存は `@/entities/position/model/shogi` の `PIECE_TYPES` / `convertJkfPiece` だけ。
  2. lint に「`../../` 以上遡る相対 import の全面禁止」を1本入れ、全経路を `@/` に矯正する。
     これを入れないとレイヤ規則が漏れる。

### [HIGH-2] `position-sync` は1つのものではない。派生値と副作用の状態機械が同居している（architecture + react、独立に同一結論）

- 場所: `src/app/providers/bridges/position-sync/provider.tsx:36-47`（`getCurrentSfen`）、
  `:49-115`（送信キュー）、`types.ts:1-10`
- 根拠: 消費者6箇所が Context から実際に読んでいる値。

| 消費者                                                          | 読んでいる値                                  |
| --------------------------------------------------------------- | --------------------------------------------- |
| `entities/search/model/provider.tsx:46`                         | `currentSfen` のみ                            |
| `features/study-position-save/ui/StudyPositionSaveModal.tsx:29` | `currentSfen` のみ                            |
| `features/position-search/ui/PositionSearchModal.tsx:29`        | `currentSfen` のみ                            |
| `widgets/analysis-pane/ui/AnalysisPaneHeader.tsx:11`            | `currentSfen` のみ                            |
| `widgets/analysis-pane/ui/AnalysisPane.tsx:26`                  | `currentSfen` のみ                            |
| `app/providers/bridges/AnalysisBridge.tsx:6`                    | `currentSfen` + `syncedSfen` + `syncPosition` |

`isPositionSynced` と `syncError` は `src` 全体で読み手が **0**。

- なぜ問題か: レイヤ違反5件は「エンジン同期 provider に依存している」のではなく、
  **盤の現在局面という `entities/game` の派生値**を取りに行っているだけ。
  その値が app 層にしか無いので `entities/search` まで app を import する羽目になっている。
  `entities/search` はエンジン未初期化でも成立すべきスライスなのに、現状はエンジン同期 provider 配下でしか動かない。
- 直し方: 2分割する。
  - **(A)** `currentSfen` を `entities/game` の `GameView` に下ろす。`GameView` は既に `currentTurn` /
    `totalMoves` / `currentMove` / `legalMoves` を持つ派生値の入れ物で、`getCurrentSfen` は
    `player.shogi` と `player.tesuu` しか読まない＝同じ useMemo で計算できる同種の射影。`|| 1` の挙動は変えない。
  - **(B)** 残り（`syncedSfen` / `syncPosition` / 送信キュー / `NotInitialized` 復帰）を
    `features/engine-position-sync/` へ上げる。`entities/game` + `entities/engine` + `entities/engine-presets`
    の3スライス合成なので、FSD で束ねる最下層は features。
  - 消費者が `AnalysisBridge` 1つだけになるので、**Context 自体を廃止**して
    `useEnginePositionSync()` フックにし、既存の `PositionSyncAdapter`（`entities/analysis/model/types.ts:20-24`）
    に props 注入する形へ畳める。他3つの bridge と同じ「Context を持たない bridge」に揃う。

**参照側5箇所の書き換え後（全て下向きになる）**

| ファイル                                                          | 変更                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `widgets/analysis-pane/ui/AnalysisPane.tsx:13,26`                 | import 削除。`useGame()` の分解に `view` を足し `view.currentSfen`                                                                                                                                                         |
| `widgets/analysis-pane/ui/AnalysisPaneHeader.tsx:5,11`            | import を `@/entities/game` に差し替え                                                                                                                                                                                     |
| `features/study-position-save/ui/StudyPositionSaveModal.tsx:7,29` | 既に `useGame()` を呼んでいるので `view` を足すだけ                                                                                                                                                                        |
| `features/position-search/ui/PositionSearchModal.tsx:21,29`       | 既に `useGame()` を呼んでいるので `gameView.currentSfen`                                                                                                                                                                   |
| `entities/search/model/provider.tsx:5,46`                         | **`useGame` に置き換えない。** `searchCurrentPositionBestEffort`（`:140-155`）を削り、唯一の呼び出し元 `PositionSearchModal.tsx:136` を `searchPosition({ sfen, ... })` にする。同 modal は `:97` で sfen を既に持っている |

5箇所中3箇所が**同じコンポーネント内で既に `useGame()` を呼んでいる**ことが、(A) の配置が正しいことの実証。

### [HIGH-3] 送信ループが古いクロージャで state を書き戻し、エンジン切替時のリセットを打ち消す（react）

- 場所: `src/app/providers/bridges/position-sync/provider.tsx:76-78`, `:81-109`, `:114-122`
- 根拠:

```ts
if (inFlightRef.current) {
  return inFlightRef.current;
} // :76-78
await setPositionFromSfen(target);
setSyncedSfen(target);
setSyncedEngineKey(engineKey); // ← 最初のクロージャがキャプチャした古い engineKey
```

- なぜ問題か: 世代カウンタも AbortController も無く、非同期完了後の書き込みが「その間に条件が変わったか」を検査していない。
  1. `engineKey="A@1"` で局面 X を送信中
  2. プリセットを B に切替 → `engineKey="B@1"`
  3. `:114-122` が `setSyncedSfen(null)` / `setSyncedEngineKey("B@1")` でリセット
  4. `:125-134` が再同期を呼ぶが `inFlightRef` があるので既存 promise を返すだけ
  5. 古いループが `setSyncedEngineKey("A@1")` を書き、3 のリセットを打ち消す

  この状態で `entities/analysis/model/provider.tsx:250` の `if (syncedSfen !== want) return;` は成立してしまい、
  **B へ送信できた保証がないまま解析が再起動される。**

- 直し方: `syncPosition` に世代カウンタを持たせ、`await` 直後に `if (gen !== genRef.current) return;` を入れてから setState する。
  `:114-122` のエンジン変更 effect で `genRef.current++` して in-flight を無効化。
  `:90` は `latestEngineKeyRef.current` を読む。

### [HIGH-4] 同期失敗が完全に沈黙し、盤面と一致しない候補手が表示される（react）

- 場所: `src/app/providers/bridges/position-sync/provider.tsx:100-105`、
  `src/entities/analysis/model/provider.tsx:266-270`
- 根拠:

```ts
setSyncError(msg); setIsPositionSynced(false); return;   // キューを捨てて終了。再試行なし
...
await waitUntil(() => syncedSfenRef.current === currentSfen, 2000);  // 戻り値を捨てている
const sessionId = await startInfiniteAnalysisCore();
```

- なぜ問題か: `syncError` / `isPositionSynced` は読み手が0。`setPositionFromSfen` が `NotInitialized` 以外で
  失敗すると UI にどこにも出ず、キューされた SFEN も捨てられ再試行もされない。
  直後に解析を開始すると `waitUntil` が2秒待って false を返すが戻り値が捨てられているため、
  **エンジンには1手前の局面が入ったまま解析が始まり、盤面と一致しない候補手が表示される。エラーは一切出ない。**
- 直し方: `waitUntil` の戻り値を検査し false なら throw して `AnalysisPaneHeader.tsx:82` の catch で表示する。
  `syncError` は表示するか、削って `syncPosition` の reject で伝える。読まれない state を Context に残さない。

### [HIGH-5] 自動同期 effect が自分の書いた state に依存しており自己再トリガ構造（react）

- 場所: `src/app/providers/bridges/position-sync/provider.tsx:112`, `:125-134`
- 根拠: `syncPosition` は `syncedSfen` / `syncedEngineKey` に依存し、かつ自分でその2つを setState する。
  送信成功 → identity が変わる → `syncPosition` を依存に持つ effect が再実行 → 1手ごとに effect が2周する。
- なぜ問題か: 無限ループにならないのは `:69` のガード後の `setIsPositionSynced(true)` が同値で React が
  bail out するからだけ。`:48` の `setSyncError(null)` を将来オブジェクトに変えると同値判定が外れ、
  **即座に無限レンダループになる。**
- 直し方: `syncedSfen` / `syncedEngineKey` を `useRef` に退避し `syncPosition` の依存を落とす。
  effect の依存は `[engineKey, gameState.cursor]` だけにし、`syncPositionRef.current()` で呼ぶ。

### [HIGH-6] file-tree の循環は TreeNode ⇄ DirectoryNode の1本（architecture）

- 場所: `src/widgets/file-tree/ui/TreeNode.tsx:2` ⇄ `src/widgets/file-tree/ui/DirectoryNode.tsx:3`
- 根拠: 経路はこれで閉じている。`RootNode` は `TreeNode` を読むが逆が無いので循環に入らない。
  **循環は1つで、2ファイルとして報告されているだけ。**
- なぜ問題か: 木の再帰をモジュールの相互参照で書いている。ESM の循環は初期化順に依存し、
  `DirectoryNode` が先に評価される経路が生まれると `TreeNode` が一時的に `undefined` になり
  `React.createElement(undefined)` で落ちる。今は `RootNode → TreeNode → DirectoryNode` の順で
  必ず評価されるため露見していないが、**どちらかを他所から直接 import した瞬間に順序が変わる。**
- 直し方: 再帰点を `TreeNode` に閉じ、`DirectoryNode` から `TreeNode` の import を消す。
  `renderChild?: (child: FileTreeNode, level: number) => ReactNode` を prop で受け、
  `node.children.map((c) => renderChild(c, level + 1))` に置き換える。
  `externalHoverDir` は `renderChild` のクロージャで渡す（現状 `DirectoryNode` は子に伝播していないので挙動不変）。

### [MEDIUM-7] 駒を選択するだけで6消費者が再レンダする（react）

- 場所: `position-sync/provider.tsx:36-45`, `entities/game/model/provider.tsx:139`, `:639`
- 根拠: `set_selection` で `state.selectedPosition` が変わる → `view` useMemo 再計算 →
  `buildPlayer` が**新しい JKFPlayer インスタンス**を返す → `getCurrentSfen` → `syncPosition` →
  `value` の identity が連鎖して変わる。加えて `entities/game/model/provider.tsx:639` の
  `contextValue` は `useMemo` が一切無い。
- なぜ問題か: 局面が1ミリも変わっていない「駒をクリックしただけ」で `usePositionSync()` の6箇所が
  再レンダし、同期 effect まで再実行される。
- 直し方: SFEN 導出を `view` の中で `state.cursor` に紐づけて1回だけ計算する（HIGH-2 の (A) と同じ変更）。
  `selectedPosition` を `view` useMemo から切り離す。`contextValue` を `useMemo` で包む。

### [MEDIUM-8] 「現在の局面」が3系統・3粒度に分裂している（react）

- 場所: `entities/game/model/types.ts:26`（`cursor`）/ `position-sync/provider.tsx:40`（`currentSfen`）/
  `entities/analysis/model/types.ts:6`（`currentPosition`）
- 根拠: `AnalysisPane.tsx:53,67` は「2つのコピーが食い違う」前提で毎レンダ突き合わせている。
  さらに `cacheKey`（tesuuPointer ベース）/ `sfenToPositionKey`（ply を捨てる）/ `currentSfen`（ply を含む）で
  **「同じ局面」の定義が3通りある。**
- 直し方: 正方向の導出を `entities/game` の `view.currentSfen` に集約。
  `entities/position` に局面同一性キーの正準関数を1本置き、`sfenToPositionKey` と Rust 側
  `position_key_from_sfen` の粒度定義を1箇所に統一する。
  `analysis.state.currentPosition` は `analyzedSfen` に改名（`currentSfen` と同義に読めるのが混乱の元）。

### [MEDIUM-9] `BranchOption` は型を下げる。関数を上げる選択肢は無い（architecture）

- 場所: `src/entities/position/lib/buildPreviewData.ts:2`、型は `features/position-navigation/model/types.ts:9-15`
- 根拠: `buildPreviewData` の呼び出し元は `features/position-navigation` と `features/position-search` の
  **2つの別 feature**。どちらかに移すと features 同士の横断 import になり、違反を別の違反に置き換えるだけ。
- 直し方: 下ろし先は `entities/position` ではなく **`entities/kifu`**。`BranchOption` は
  「手数 N の分岐候補」で `entities/kifu/model/cursor` の `ForkPointer` と同じ語彙（`tesuu` + `forkIndex` +
  `IMoveMoveFormat`）で書かれた棋譜ツリーの構造であり、描画データ（`PreviewData`）とは別物。
  同ファイルの `NavigationState` / `selectedBranchIndex` は UI 状態なので features に残す。**型全体を移さない。**

### [MEDIUM-10] bridges と gates を分ける基準が無く、gate が何も gate していない（architecture）

- 場所: `app/providers/gates/FileTreeRootGate.tsx`, `gates/GamePersistenceGate.tsx`,
  `bridges/EngineRuntimeBridge.tsx`, `bridges/AnalysisBridge.tsx`, `bridges/GameFileTreeBridge.tsx`
- 根拠: `FileTreeRootGate`（gate）と `EngineRuntimeBridge`（bridge）は構造が同一
  （「entity A の hook を読み entity B の provider に prop 注入」）。
  `gates/` の2つは**条件分岐を1つも持たず children を無条件に描画する**。
  実際に gate しているのは `app/routing/guards/RequireRootDir.tsx:10-16`。
  `bridges/` の中身は3種類混在（注入ラッパ / `return null` の副作用専用 / 自前 context を持つ provider）。
  さらに `GamePersistenceGate.tsx:6` が `../bridges/GameFileTreeBridge` を import しており階層として意味を成さない。
- 直し方: 中身に対応する基準に付け替える。
  - `app/providers/adapters/` に注入ラッパ4つを集約（基準＝「entity provider に prop 注入するだけで自前 state を持たない」）
  - `GameFileTreeBridge`（副作用のみ・UI 無し・2エンティティ同期）は `position-sync` と同カテゴリなので features へ
  - `gates` / `guards` は「条件によって children を描画しない」ものだけに残す。現状 `RequireRootDir` 1つで
    既に `app/routing/guards/` にあるため `app/providers/gates/` は削除できる

### [MEDIUM-11] `entities/` の公開境界が10スライス中2つ欠落、残りも `export *` と選別済みが混在（architecture）

- 場所: `entities/engine-presets/`（`index.ts` 無し）、`entities/position/`（`index.ts` 無し）、
  `entities/{file-tree,game,kifu}/index.ts`（`export *`）
- 根拠: 深掘り import が常態化。`@/entities/engine/api/tauri`（2箇所）、`@/entities/engine/api/rust-types`、
  `@/entities/file-tree/model/useFileTree`（4箇所）、`@/entities/engine-presets/model/useEnginePresets`（4箇所）。
- なぜ問題か: 「何が公開か」を宣言する場所が無いので、内部ファイルを改名・移動すると上位層が壊れる。
  影響範囲の見積もりができない。`export *` のままスライス直下以外を禁止しても、非公開のはずのものが
  公開面に格上げされるだけで境界の効果が出ない。
- 直し方: 3段階。粒度そのものは触らない（粒度は破綻していない）。
  1. `entities/engine-presets/index.ts` と `entities/position/index.ts` を新設
  2. `file-tree` / `game` / `kifu` の `export *` を、実際に外から使われている識別子だけの明示 export に置換
  3. その上で `no-restricted-imports` に `@/entities/*/*` 禁止を入れる。**1→2 を先にやらないと3で大量に壊れる**

### [MEDIUM-12] `shared/` で層非依存でないのは `ModalType` 1件のみ（architecture）

- 場所: `src/shared/lib/router/useURLParams.ts:4-12`
- 根拠: import 上 `shared/` は完全にクリーン（上位層への import 0件）。層非依存でないのは
  `ModalType` union が上位層のスライス名簿を保持している点だけ。
- なぜ問題か: CLAUDE.md が「モーダルを追加 → `ModalType` union を更新する」を手動ルールとして
  明文化していること自体が、この結合が運用コストになっている証拠。
- 直し方: この union はどこでも網羅的に消費されていない（`AppModalLayer.tsx` は各モーダルを無条件に描画し、
  各モーダルが自分で `params.modal === "..."` を判定。switch は無い）＝実体はタイポ防止の語彙。
  `useURLParams<M extends string = string>()` と型引数化し、具体 union は `app/routing/modals.ts` に置く。

---

## 重複・矛盾した所見

- **HIGH-2 は2人が独立に到達した。** architecture は「置き場」から、react は「Context の粒度」から出発して、
  どちらも「`currentSfen` は `entities/game` の派生値」「残りは Context 不要」に収束した。
  異なる出発点からの一致なので、この判断の確度は高い。
- **矛盾は無い。** ただし順序の依存が2つある:
  - HIGH-2(A) と MEDIUM-7 は**同一の変更**。別々に直さない
  - MEDIUM-11 の 1→2→3 は順序必須
- **HIGH-1 は他の全所見より先に効く。** lint パターンを `@/` だけで書くと 0 件に見えて実際は残るため、
  相対 import の禁止を入れるまで「違反ゼロ」を信用してはいけない。

---

## 見ていない範囲

- **Rust 側（`src-tauri/`）は一切見ていない。** `lib.rs` の `invoke_handler` 登録とモジュール対応、
  コマンド層とドメインロジックの分離は未確認
- `widgets/` の残り5スライスと `features/` の残り8スライスの**内部構造**。層跨ぎ import の有無のみ機械確認
- **同一層内の横断 import**（`entities/analysis` → `entities/engine` など）は列挙も評価もしていない。
  縦方向の違反解消が目的だったため。横断まで規則化するなら別ラウンドが要る
- `tesuuPointer` の手書きパース重複の実際の箇所数
- `position-sync` の同期ロジックそのものの正しさのうち、StrictMode 二重実行の影響
- `entities/engine` の Rust 側 `setPositionFromSfen` 実装。HIGH-3 は React 側の state 一貫性に限定した話
- SCSS・レイアウト・key の衝突（ui-reviewer 未実行）
- **提案した移動を適用した後の `npm run verify` は実行していない。未検証**

---

## lint / hook で強制できるもの

| 所見                                           | 強制方法                                                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 上向き import 6件                              | `no-restricted-imports` を層ごとの override で。`src/shared/**` → `@/{app,pages,widgets,features,entities}/**` 禁止、以下同様                                                         |
| **相対パスによる層跨ぎ（HIGH-1）**             | 上のパターンでは**検出できない**。「`../../` 以上遡る相対 import の全面禁止」を1本足すのが確実。実測20件が `@/` に矯正され、エイリアス規則1本で全経路を覆える                         |
| 循環依存                                       | `import/no-cycle`。ただし `vite.config.ts` の `lint.plugins` に `"import"` が入っていないので先に追加が要る                                                                           |
| `entities/` の深掘り import                    | MEDIUM-11 の 1→2 完了後に `@/entities/*/*` を禁止                                                                                                                                     |
| correctness カテゴリ                           | 現在 `"warn"` なので相関性の指摘でビルドが落ちない。`"error"` に上げられるか要確認                                                                                                    |
| 読み手のいない Context フィールド              | `knip` / `ts-prune` で未使用エクスポートまでは拾えるが、フィールド単位は無理。lint では防げない                                                                                       |
| memo されていない Context value                | oxlint に該当ルール無し。**two-strikes rule により今回は1回目なのでルールではなくテストを書く。** 「駒を選択しても `usePositionSync()` の戻り値の identity が変わらない」vitest を1本 |
| 非同期完了後の setState の世代ガード（HIGH-3） | lint 不可。「engineKey 切替中に in-flight があると `syncedEngineKey` が巻き戻らない」テストを書く                                                                                     |
| bridges/gates の置き場、真実の源の重複         | 機械では防げない。ディレクトリ名を役割に対応させて判断そのものを不要にするのが唯一の手                                                                                                |

---

## 次ラウンドの対象

**このラウンドで直す（順序が意味を持つ）**

1. HIGH-1 の lint パターン設計（相対 import 禁止を含む）— 他の検証の前提
2. HIGH-6 file-tree の循環（独立していて小さい）
3. HIGH-2 + MEDIUM-7 の (A)：`currentSfen` を `entities/game` の `view` へ
4. HIGH-2 の (B)：残りを `features/engine-position-sync/` へ、Context を廃止
5. HIGH-3 / HIGH-4 / HIGH-5：世代ガード・失敗の伝播・自己再トリガの解消（テスト先行）
6. MEDIUM-9 `BranchOption` を `entities/kifu` へ
7. lint 有効化 + CI

**見送る（別 issue）**

- MEDIUM-10 bridges/gates の再編 — 判断は確定したが、上記を終えてからの方が影響が読める
- MEDIUM-11 `entities/` の公開境界 — 3段階あり分量が大きい。単独 issue に分ける
- MEDIUM-12 `ModalType` の型引数化 — import 違反ではなく、今回の恒久強制の対象外
- MEDIUM-8 の「同一性キーの統一」 — Rust 側 `position_key_from_sfen` に及ぶため rust-reviewer のラウンドと合わせる
