# Review: Position Search — Comms Layer & Index Algorithm

**Reviewed**: 2026-05-31
**Scope**: `src-tauri/src/search/*`, `src/entities/search/*`, `src/features/position-search/*`
**Decision (informational)**: REQUEST CHANGES (HIGH issues in streaming + state mgmt; algorithm has 2 quick wins worth ~10×)

---

## Summary

検索機能は「フロント=Reactイベント駆動」「バック=128bit Zobrist→256バケットの配列キャッシュ」という綺麗な分離になっている。が、現状は**「streaming のフリをした batch」**になっていて Rust 側が `invoke` をブロックしている。アルゴリズム側は基本設計は妥当だが、`HashMap<FileId, FileEntry>` がホットパス、セグメント断片化が watch 連発で線形劣化、というプロファイルになる。

通信層の HIGH を 1 件直すだけで体感が変わり、algo の MEDIUM #A1/#A2 を直すと高頻出局面（初形・常識的な序盤）で 5〜10× の高速化が期待できる。

---

## 1. Communication Layer Findings

### CRITICAL

なし。

### HIGH

#### C-H1. `search_position` コマンドが終了までブロックする → ストリーミングが事実上 batch 化

`src-tauri/src/search/api.rs:62-68`、`query_service.rs:44-149`

```rust
#[tauri::command]
pub async fn search_position(...) -> Result<SearchPositionOutput, String> {
    Ok(state.query.search_position_impl(input).await)  // 全 emit を待つ
}
```

`search_position_impl` は begin → chunks → end まで**インラインで全部 emit してから** `request_id` を返す。フロントの

```ts
// features/position-search/ui/PositionSearchModal.tsx:115-132
setIsLaunching(true);
doSearch.then((out) => setRequestId(out.request_id)).finally(() => setIsLaunching(false));
```

は invoke 解決まで `requestId === null` のままなので、reducer 側で hits は溜まっているのに UI は「検索中…」のスピナーが回り続け、終わった瞬間に全件ドカッと出る。chunk_size の意味がなくなっている。

**Fix**:

- A) Rust 側を `tauri::async_runtime::spawn` で非同期化し、コマンドは rid を即 return する（推奨）。
- B) フロントは `state.currentRequestId` を見て先に subscribe する（reducer は `EVT_SEARCH_BEGIN` で `currentRequestId` をセット済み）。簡易だが「自分が投げた検索」と区別できなくなる。

A の最小差分案：

```rust
pub async fn search_position_impl(self: Arc<Self>, input: SearchPositionInput) -> SearchPositionOutput {
    let request_id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
    let me = self.clone();
    tauri::async_runtime::spawn(async move { me.run_search(request_id, input).await });
    SearchPositionOutput { request_id }
}
```

#### C-H2. 検索キャンセル機構が無い

ユーザが盤面操作中に SFEN が次々変わると、`useEffect` が毎回 `searchPosition` を叩く。前の rid の chunks は止まらず emit され続け、reducer に積まれる。`PositionSearchModal` 側で「最新 rid 以外は無視」しているので画面上は正しく見えるが、Rust 側は重いキー（初形）を最後まで返し続ける。バックエンドが多重に走り、IPC も詰まる。

**Fix**: `request_id -> CancellationToken (tokio_util)` か `AtomicBool` を `QueryService` に持たせ、`cancel_search(request_id)` コマンドを追加。フロントは `useEffect` cleanup でキャンセル発火。

#### C-H3. Listener セットアップが React 19 StrictMode で二重登録になり得る

`src/entities/search/model/provider.tsx:41-75`

```ts
useEffect(() => {
  const setup = async () => {
    if (unlistenRef.current) { unlistenRef.current(); unlistenRef.current = null; }
    const unlisten = await listenSearchEvents({ ... });  // 非同期
    unlistenRef.current = unlisten;
  };
  setup().catch(...);
  return () => { if (unlistenRef.current) { unlistenRef.current(); ... } };
}, []);
```

StrictMode の dev double-invoke では、最初の `await listen()` が返る前に cleanup が走り `unlistenRef.current === null` のため no-op、2 回目の setup が新しい listener を貼る → 同一イベントが 2 回 dispatch される。本番ビルドでは起きないが、ローカル開発で `hits.length` が 2 倍になる/`indexedFiles` の reducer がチカチカする原因。

**Fix**: cancellation flag を outer scope に持ち、await 中にキャンセルされたら登録された listener をその場で解除する。

```ts
useEffect(() => {
  let cancelled = false;
  let unlisten: UnlistenFn | null = null;
  (async () => {
    const u = await listenSearchEvents({...});
    if (cancelled) { u(); return; }
    unlisten = u;
  })();
  return () => { cancelled = true; unlisten?.(); };
}, []);
```

### MEDIUM

#### C-M1. Reducer の hits 結合が O(n²)

`src/entities/search/model/reducer.ts:158-174`

`hits: [...s.hits, ...p.chunk]` を chunk ごとに再構築する。chunk=5000, 総ヒット=100k だと累積 1.25e10 要素コピー相当。React の再レンダリングも入る。

**Fix**: `useReducer` の代わりに `useSyncExternalStore` + 可変 Map バッファ、あるいは hits を `chunks: PositionHit[][]` で保持して virtualizer 側で flat 仮想化。簡易には Reducer 内で `s.hits.push(...p.chunk)` を許容（reducer の純粋性は崩れるが性能優先）して `setRef` でバージョン番号だけ上げる選択肢もある。

#### C-M2. `EVT_INDEX_PROGRESS` の最終 emit が落ちる

`src-tauri/src/search/api.rs:347-366` で `EMIT_INTERVAL` 内に到達した最後の進捗は emit されない。reducer 側 `index_progress` が `doneFiles` を更新する唯一のパスのため、UI 上「9/10 完了」のまま `Ready` に飛ぶケースが残る。

**Fix**: ループ脱出後に `done_files == total_files` の最終 progress を 1 回 emit、もしくは `index_state` reducer 内で `state === "Ready"` 時に `doneFiles = totalFiles` と同期。

#### C-M3. Restore→Ready 直後の watcher 差分反映で `EVT_INDEX_STATE: Updating` が遅延

`api.rs:139-158`：restore 後にまず Ready を emit し、その後 spawn した `run_rescan_diff_apply` が Updating に flip する。間に検索を投げると `stale=false` で返るが、実際には watcher 反映前の古い snapshot に基づく結果。実害は小さいが意味的に嘘になっている。

**Fix**: restore 直後は `Restoring`/`Updating` のままにし、差分反映完了で Ready に上げる。

#### C-M4. `clearSearch()` が「全 session 削除」を許す

`reducer.ts:235-257`：引数なし呼び出しで `sessions: {}` リセット。複数モーダル共存（manager + search）でクロス汚染の元。現状の UI コードは個別 rid で呼んでいる（PositionSearchModal が unmount 時に何も呼んでいない）ので実害なしだが、API として危険。

**Fix**: 引数必須化、もしくは「自モーダルが立てた rid 以外は触らない」契約に。

#### C-M5. ホスト未設定での無音失敗

`query_service.rs:53-57`：`app_handle` 未注入時は rid だけ返して何も emit しない。フロントは永久に「検索中」。

**Fix**: `Err("app handle not ready")` を返すか、`EVT_SEARCH_ERROR` を emit。

### LOW

#### C-L1. `filterByRequestId` がデッドコード

`src/entities/search/api/tauri.ts:140-147` 未使用。意図された使い方（rid フィルタつき listener）を provider 側で採用するか削除。

#### C-L2. `console.error` がコーディング規約に反する

`provider.tsx:63,67,127` の `console.error` は規約上 NG。`@/shared/lib/logger` 等に置き換え。

#### C-L3. payload 命名の不一致（snake_case ↔ camelCase）

Rust 側 `request_id`/`chunk_size`、フロント `requestId`/`chunkSize` が型ごとに混在し、reducer 内で詰め替え。`serde(rename_all = "camelCase")` を導入して契約を統一すると DX が良い。

---

## 2. Index Algorithm Findings

### CURRENT SHAPE

```
SFEN  ─▶ Zobrist 128bit (z0,z1)
       │
       ▼
   bucket = z0 >> 56     (8bit prefix = 256 buckets)
       │
       ▼
   buckets[256] : Vec<SegmentArc>
       │            ├─ Segment.entries: sorted Vec<(PositionKey, Occurrence)>
       │            └─ range_by_key(): partition_point 2回 (lo, hi)
       ▼
   各 Occurrence ごとに FileTable(HashMap).is_occ_alive()  ← ホットパス
       │
       ▼
   Vec<Occurrence>.sort_by_key((file_id, node_id))
```

イメージとしては「open addressing なし、固定 256 bucket の連鎖法」+「per-file insert で生まれた immutable segment が bucket の chain を伸ばす」構造。

### HIGH

#### A-H1. `FileTable::is_occ_alive` が `HashMap<FileId, FileEntry>` ルックアップ

`src-tauri/src/search/file_table.rs:26-31`

検索ホットパスで全ヒットに対し HashMap 探索。`file_id` は密な `1..N` の `u32`（`build_full_index_task` で `(i as u32) + 1`）なのに HashMap を使うのは無駄。`NodeTables` と同じ `Vec<Option<...>>` か、もっと薄く `Vec<u32 (gen)>` + `Vec<bool (deleted)>` の SoA で十分。

初形のような全ファイル共通局面でヒット数 = ファイル数。10k ファイルで 10k 回 HashMap 探索 vs 10k 回配列アクセス：実測で 5〜10× の差。**最も費用対効果の高い修正**。

```rust
pub struct FileTable {
    gen: Vec<u32>,
    deleted: Vec<bool>,
    paths: Vec<String>,
}
impl FileTable {
    #[inline]
    pub fn is_occ_alive(&self, file_id: FileId, occ_gen: Gen) -> bool {
        let i = file_id as usize;
        i < self.gen.len() && !self.deleted[i] && self.gen[i] == occ_gen
    }
}
```

#### A-H2. Segment 断片化（compaction が save 時にしか走らない）

`index_store.rs:226-252` の `insert_many_file_segments`：1 ファイル = 1 Segment。watcher で N 回更新すると `buckets[b].len()` が線形に増え、その全てに `partition_point` × 2。256 bucket 均等仮定で「10k ファイル → bucket あたり ~40 segment」、ホット bucket では更に偏る。

`compact_all_buckets` は k-way merge で実装済みなので、`segments.len() > THRESHOLD`（例: 64）で自動 compaction を行うのが安価。compaction は read-lock を取らずに新 snapshot を作って差し替えるだけ。

### MEDIUM

#### A-M1. `insert_file_segments` (singular) で snapshot を毎ファイル full clone

`index_store.rs:193-224`：watcher 1 ファイル更新につき

- `FileTable.clone()`: `HashMap<FileId, FileEntry>` 全コピー
- `NodeTables.clone()`: `Vec<Option<NodeTableArc>>` 全コピー
- `buckets.clone()`: `[Vec<SegmentArc>; 256]` の 256 Vec コピー

`Arc` の clone は cheap だが、Vec のヘッダ＋要素ポインタ列のメモリ移動は無視できない。10k ファイル登録環境で 1 ファイル変更ごとに ~80KB 程度の clone。watcher が短時間に 50 ファイル飛ばすと 4MB / 50 ロック取得。

**Fix**: `ProjectManager` 側でバッファして `insert_many_file_segments` に集約。あるいは `Arc::make_mut` で COW にし、独占時はクローン回避。

#### A-M2. `bucketize_entries` の per-file sort tie-break が無駄

`index_builder.rs:200-216`：同一ファイル内では `file_id` 固定、`node_id` は push 順 = 既にソート済み。tie-break に `(file_id, node_id)` を入れる意味がない。`(z0, z1)` でのみ stable sort すれば十分（`sort_by(|(k1,_),(k2,_)| (k1.z0,k1.z1).cmp(&(k2.z0,k2.z1)))`）。

#### A-M3. 検索結果の最終 sort

`index_store.rs:94`：`out.sort_by_key(|a| (a.file_id, a.node_id))` を K セグメントの concatenation に対して走らせる。各 segment 内の同一 key のスライスは `(file_id, node_id)` 順なので、k-way merge にすれば `O(N log K)`。K=40, N=10k で実時間差は小さいが、ホット bucket では効く。

#### A-M4. メモリレイアウト：AoS の `(PositionKey, Occurrence)` タプル

`PositionKey {z0:u64, z1:u64}` + `Occurrence {file_id:u32, gen:u32, node_id:u32}` = 28 byte + padding → ~32 byte / entry。SoA（`z0: Vec<u64>`, `z1: Vec<u64>`, `file_id: Vec<u32>`, ...）にすると binary search は z0/z1 列のみ touch、occ 列は hit 後に拾うだけ。L1 効率が大きく上がる。**ただし API 変更が広範**なので、A-H1/A-H2 を先にやってから検討。

#### A-M5. 差分 watcher で gen を `gen+1` 増分しか使わない

`project_manager.rs:228-234`：gen は単調増加だが、同一 file_id の old gen のセグメントは bucket 内に残ったまま。alive 判定で弾いてはいるが、bucket 線形劣化要因。compaction（A-H2）が入れば自動解消。

### LOW

#### A-L1. `position_key::ZobristTable` の初期化

`position_key.rs:54-80`：`seed` は 1 個の `u64` を mutate しつつ全テーブルを引いている。初期化は 1 回だけだから速度問題はないが、決定性のために `splitmix64` の seed 値を const で書き残しておくとテスト時にハッシュ衝突を再現しやすい（既に書いてある。OK）。

#### A-L2. `bucket()` が top 8bit

分布の偏りリスクは Zobrist の質に依存。`splitmix64` の出力は十分均一なので問題なし。ただし将来「bucket 数を 512/1024 に拡張」したい時に top-bit shift を変えるだけで済むよう、`const BUCKETS: usize = 256` を導入しておくと改修しやすい。

#### A-L3. `Segment::range_by_key` で `partition_point` を 2 回

標準的な lower/upper bound 実装で問題なし。同一 key が連続する区間長は大体 1〜数件想定なので二分探索 2 回でよい。

---

## 3. Optimization Roadmap（優先順）

| #     | 修正                                          | 期待効果                              | 工数      |
| ----- | --------------------------------------------- | ------------------------------------- | --------- |
| **1** | A-H1: `FileTable` を `Vec<Option<...>>` 化    | ホット局面で **5〜10×**               | S         |
| **2** | C-H1: `search_position` を spawn 化           | streaming が**実際に**動く            | S         |
| **3** | A-H2: Segment 自動 compaction (threshold=64)  | watch 連発時の劣化解消                | M         |
| **4** | C-H2: `cancel_search` 実装 + フロント cleanup | UX、無駄な計算削減                    | M         |
| **5** | C-H3: StrictMode 二重登録 fix                 | dev UX                                | S         |
| **6** | C-M1: hits の O(n²) 解消                      | 10k+ ヒットの UI 反応性               | M         |
| **7** | A-M1: バッチ insert 統一                      | watcher burst 時の write スループット | M         |
| **8** | C-M2/M3/M5/L1/L2                              | 小バグ・規約                          | S 合計    |
| **9** | A-M4: SoA 化                                  | binary search L1 効率                 | L（広範） |

---

## 4. Validation

| Check                 | Result                     |
| --------------------- | -------------------------- |
| Type check (frontend) | Skipped (read-only review) |
| Rust `cargo check`    | Skipped                    |
| Tests                 | Skipped                    |

実装着手時に各 Phase の前後で `cargo check && npm run build` を回すこと。

---

## 5. Files Reviewed

### Backend (Rust)

- `src-tauri/src/search/api.rs` — Tauri command + full-build orchestration
- `src-tauri/src/search/query_service.rs` — 検索本体（emit 同期）
- `src-tauri/src/search/types.rs` — IPC 契約
- `src-tauri/src/search/index_store.rs` — snapshot 管理（COW）
- `src-tauri/src/search/index_builder.rs` — 局面列挙＋bucketize
- `src-tauri/src/search/index_cache.rs` — 永続化 + compact
- `src-tauri/src/search/segment.rs` — bucket 内ソート済み区間
- `src-tauri/src/search/position_key.rs` — Zobrist 128bit
- `src-tauri/src/search/file_table.rs` — alive 判定（HashMap）
- `src-tauri/src/search/node_table.rs` — node_id→CursorLite 復元
- `src-tauri/src/search/project_manager.rs` — watcher + 差分適用
- `src-tauri/src/search/sfen_position.rs` — クエリ SFEN→key

### Frontend (TypeScript)

- `src/entities/search/api/contract.ts`, `events.ts`, `tauri.ts` — IPC ラッパ
- `src/entities/search/model/provider.tsx`, `reducer.ts`, `types.ts` — Context + reducer
- `src/features/position-search/ui/PositionSearchModal.tsx` — 主要 UI トリガ
