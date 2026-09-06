# レビュー search-contracts ラウンド1

- 日付: 2026-09-05
- 範囲: `1e2608fa..HEAD` の22ファイル（+1,099 / −580）。`search/position` と `search/index` の契約整理、Zobrist 表の分離、桶の集約、テスト追加
- 対象コミット: `17079d4a`
- 走らせた reviewer: architecture / rust / comment / robustness / perf

## 所見

### BLOCK

#### B1 SFEN の持駒枚数に上限が無く、`search_position` が永久に返らない

robustness。`sfen_position.rs:203,211,233-238` / `query_service.rs:85,89`。

`parse_hands_into` の桁読み `num = num * 10 + ..` に上限が無く、`add_n` が `0..n` を回す。
`Hand::added` は持駒7種（`index < 7`）で `wrapping_add(1)` して**必ず `Some`**（`shogi_core-0.1.5/src/hand.rs:55-62`）なので、`ok_or(InvalidHand)` は発火しない。

`... b 99999999999999999999P 1` で tokio のワーカーが1本焼ける。`position_key_from_sfen` は
**`spawn_blocking` の外**（`query_service.rs:89`）で、`EVT_SEARCH_BEGIN` は `:85` で既に出ている。
END も ERROR も来ないので画面は「検索中…」のまま。`cancelSearch` も効かない
（`cancel.is_cancelled()` の検査は `:114` 以降）。

到達経路は実在する。研究局面ファイルの `sfen` が TS 側の型注釈だけで検証されずに来る
（`StudyPositionsManagerModal.tsx:217` → `PositionSearchModal.tsx:89`）。

**この変更が作ったものではない**（`add_n` は元からこの形）。範囲内なので直す。

### HIGH

#### H1 検索の失敗が英語の内部の理由のまま画面に出る。この変更は doc に書いただけ

robustness。`types.rs:243-248` / `query_service.rs:174-182` / `PositionSearchStatusBar.tsx:22-23`。

壊れた綴りで検索すると `unsupported format` / `invalid sfen: board ranks must be 9: ...` が
素の英語でステータスバーに出る。次にすることも復帰導線も無い
（`PositionSearchModal.tsx:112` の `lastQueryKeyRef` により、同じ局面での再検索ができない）。

同じ変更が `EVT_INDEX_WARN` 側では「利用者の言葉にする／次にすることを書く」を徹底したのに、
`EVT_SEARCH_ERROR` 側は doc に defect を書いて据え置いた。しかも他の未決（#236 / #395）には
issue 番号が付いているのに、ここだけ番号が無い。

#### H2 `SearchEndPayload` の doc「取り消したときは届かない」が嘘

comment。`types.rs:230-233` / `query_service.rs:124-126,172`。

届かないのは chunk を1つも出す前に取り消したときだけ（`:113` の `return`）。
**streaming 中の取り消しは `break` の後そのまま `EVT_SEARCH_END` を emit する**。
受け側（`entities/search/model/reducer.ts:192-208`）は END で `isDone: true` を立てるので、
「300件で打ち切られた検索」と「全件出し終えた検索」が区別できない。
doc が「届かない」と保証しているので、区別する側を書く動機が生まれない。

**この変更で書いた doc。**

#### H3 `initial_position.rs` の「呼び口で違う・#333」が `read_to_jkf` の doc と正面から食い違う

comment。`initial_position.rs:40-41` / `kifu_reader.rs:41-44`。

`kifu_reader.rs` 側が正しい。`build.rs:155` は `ok` を見ずに `batch.push`、
`project_manager.rs:262-275` は `None` のとき空の項目を積む。**どちらの経路でも登録される。**
さらに #333 は CLOSED（COMPLETED）なので、読み手は閉じた issue を追う。

## 重複・矛盾した所見

#### M1 `index_cache.rs:1273` の「bucket は z0 の下位8ビット」が実装と逆 【4人が指摘】

architecture / rust / robustness / comment。実装は `position_key.rs:47` の `(self.z0 >> 56)`。

`z0 = 0x1111` の実際の桶は `0x00` だが題材は `buckets[0x11]` に手で置いている。
**`bucketize_entries` が絶対に作らない状態**を round-trip テストが固定している。
この変更が `bucket.rs:5-6` に正しい記述を新設したので、リポジトリ内に正反対の2文が同居する。
桶の切り方を触る人がこれを信じて `(self.z0 & 0xff)` に直すと、ディスクの索引が全部読めなくなる。

#### M2 桶の持ち主を `bucket.rs` にしたのに、入口が3つ残っている 【2人】

architecture / rust。

- `index_store.rs:13` の `pub use` が並行する輸入経路を作っている。`index_store` 経由で
  `BucketEntries` を引く呼び手は0件。`project_manager.rs:16-19` は1ファイルの中で両方を使っている
- `empty_buckets()` が `file_build.rs:41` と `index_cache.rs:579` で使われず手組みのまま
- `BucketSegments` を公開したのに使い手が0（`index_store.rs:71,192,203,227` と bench が直値のまま）
- `search_bench.rs:49,70,489` に `256` の直値が残る

#### M3 rustdoc のリンクが2本、この変更で新しく切れた 【2人】

rust / comment。`cargo doc --no-deps` で実測。

- `build_report.rs:93` — `[`BuildPolicy::Loose`]`。`BuildPolicy` は `index_builder` に残したのに参照だけ移した
- `position_key.rs:7` — `[`super::zobrist`]`。`mod zobrist;` は非公開

`clippy` も `fmt` も見ない。

#### M4 実在しない `api.rs` を指す doc 【2人】

architecture / comment。`index_builder.rs:249` / `file_build.rs:3` / `kifu_reader.rs:41` /
`docs/state-transitions/search.md:46,83,106,182` / `obs-shogi-spec.md:25`。

`api.rs` は `5f4d5289` で `build.rs` と `commands.rs` に分かれている。
`obs-shogi-spec.md:25` は削除済みの `traverse` も指している。
`tests/comment_identifiers.rs` は下線を含む識別子しか見ないので `api`（下線なし）は素通り。

#### M6 `BuildError::Apply` の `Display` が `fork_pointers` を読まない 【2人】

architecture / robustness。`build_report.rs:109-119`。

同じファイルの `BuildWarn`（`:75-78`）は `fork_pointers.last()` から「20手目から分かれた変化2の」を
前置するのに、`Apply` は `tesuu` しか出さない。`walk_sequence:125-129` は変化の中で失敗しても
`fork_path` を詰めた `CursorLite` を渡すので、値は入っているのに読まれない。
モジュール doc（`:3-5`）は「どちらも `Display` が画面に出る文言」と宣言している。

併せて `Apply` 経路だけログが1行も出ない（`file_build.rs:70` の `map_err` は画面へ出すだけ）。

#### M12 `IndexedFile` と `FileBuild` の名前が中身と逆 【2人】

architecture / comment。`index_builder.rs:34-44` / `file_build.rs:21-35`。

`IndexedFile` を返す `build_index_for_jkf` は**ファイルを開かない**（受けるのは `&JsonKifuFormat`）。
ディスクを触るのは `FileBuild` を返す `build_file_index`。名前が入れ替わっている。
欄が2つ共通（`node_table` / `warns`）で、`warns` の型が違う（`Vec<BuildWarn>` と `Vec<String>`）のに
`file_build.rs:69-84` で同じ関数の中に並ぶ。

### MEDIUM（単独）

#### M5 `zobrist::color_index` が `Color::array_index()` の写し

architecture。`zobrist.rs:54-61`。`shogi_core-0.1.5/src/color.rs:41-48` が同じ写像を持つ
（`Black = 1` / `White = 2` から `-1`）。同じファイルの `piece_on_square:144` が
`pk.array_index()` / `sq.array_index()` で上流に任せているのと矛盾する。
`zobrist.rs:7-8` が禁じている「規約を2箇所に書く」の形そのもの。

#### M7 頭打ちを1箇所にしたことで、壊しても5本のテストが全部緑になった

rust。`zobrist.rs:158` / `position_key.rs:250-385`。

分離前は頭打ちが `key_for_hand` と `hand_step` の2箇所にあり、片方をずらすと
`walk_and_compare` が食い違いとして拾えた。1箇所にしたことで壊れ方が
「両者が仲良く同じだけ間違う」に変わり、照合では原理的に検出できない。

実測: `n.min(HAND_COUNT_SLOTS - 1)` を `n % HAND_COUNT_SLOTS` に変えても**5本とも緑**。
残るのは歩19枚が歩0枚と同じ鍵になる静かな衝突。**構造を良くした代償を、テストで埋めていない。**

#### M8 `zobrist` の可視性が、そのファイル自身の doc が主張する不変条件を守っていない

rust。`zobrist.rs:7-8` vs `:19-22,132,140,155,163` / `position/mod.rs:7`。

`pub(super)` は「`search::position` の中なら誰でも」。`sfen_position.rs` からも
`piece_on_square` が引け、`ZobristValue` のフィールドも素で読める。
doc が禁じている手順を、言語が止めていない。

#### M9 `search/mod.rs` が「段は `layering.rs` の `LAYERS` が持つ」と言うが、`layering.rs` は `search/` を見ていない

architecture。`search/mod.rs:3-5` / `tests/layering.rs:1,129-131`。

`layering.rs` は `src/engine` だけを走査する（`rg 'search'` は0件）。
手で辿ると1本だけ逆向きがある — `read/kifu_reader.rs:1072` が `index::index_builder` を呼ぶ
（`read` は `index` より下）。`#[cfg(test)]` の中なので実害は無いが、
**doc が「機械が見ている」と言っている以上、誰も気付かない。**

#### M10 `IndexState` が2つあり、変換が無いので呼び手が毎回両方を手で書く

architecture。`types.rs:75-82` / `index_store.rs:19-26`。バリアントは完全に同一。
`project_manager.rs:185-189,293-297` と `commands.rs:108,126,153,158` が2行ずつ書いている。
段が増えたとき片方を足し忘れると、画面の段だけが古いまま止まる。

#### M11 `NodeAction` を `position_apply.rs` に置いたのに、生産者だけ `index_builder.rs` に残っている

architecture。型 `position_apply.rs:16-26` / 生産者 `index_builder.rs:215-224` /
3本目の書き手 `position_key.rs:214-219,289-293`。

`node_action` は `MoveFormat` の2つの欄を見るだけで `index/` の知識を使わない。
結果、下の段の doc が上の段の private 関数を名指し（`position_apply.rs:20`）、
テストは同じ分解を手で3本目として書いている。
この変更は `bucketize_entries` を利用者の隣へ動かし Zobrist の添字を1ファイルに閉じたのに、
ここだけ逆の判断になっている。

#### M13 `zobrist.rs`「約7万項」が実際は 2,536項

comment。`zobrist.rs:75` / `:67-73`。`2 + 2*14*81 + 2*7*19 = 2,536`（約40 KB）。桁が違う。
「持ち回らない」判断の根拠がその数なので、根拠ごと嘘になる。
本当の理由は `ZOBRIST` の doc（`:77-79`）が書いている「どこから引いても同じ表でなければ鍵が変わる」。

**この変更で書いた doc。**

#### M14 `bucket.rs` の桶に分ける理由が誤り

comment。`bucket.rs:3-4`。「鍵が 2^128 通りあるので一列だと二分探索が長くなる」。
**二分探索の段数は格納件数の log であって鍵空間と無関係。**
実装が桶で得ているのは「舐めるセグメントの本数が 1/256」と
「`COMPACT_THRESHOLD` を桶ごとに数えられる」の2つ（`index_store.rs:79-91`）。
理由が違うので「128ビットを64ビットに縮めれば桶が要らない」という誤った推論を許す。

**この変更で書いた doc。**

#### M15 閉じた issue #330 を「これから決めること」として指している

comment。`initial_position.rs:28-29`。#330 は CLOSED（COMPLETED）だが、
`entities/kifu/api/parse.ts` は今も tsshogi を通しており挙動は変わっていない。
記述の前半（食い違いがある）は正しく、行き先だけが閉じている。

#### M16 `Display` に35行の doc、説明の対象の `walk_sequence` に0行

comment。`build_report.rs:38-87`（doc 35行 / 本体13行）vs `index_builder.rs:89-96`（doc なし）。
「`tesuu` に足さない。`walk_sequence` は `start_tesuu = 1` で歩くので」という不変条件が、
守られるべき場所ではない別ファイルに書いてある。`start_tesuu` を触る人は
`build_report.rs` を開かない。

#### M17 公開面の doc の欠落

comment。`index_builder.rs:34-35`（`IndexedFile` に型 doc なし）、
`:148-152`（`build_index_for_jkf` に `# Errors` なし。`file_build.rs:53` は書いている）、
`types.rs:123,129,250,256,262,270`（6つの struct が無言）、`:75-82`（`IndexState` の
5値の違いがコードから読めない）。

`IndexWarnPayload` は `build_report.rs` の doc 群が終点として名指している型。

#### M18 「節」と「ノード」の訳語が割れている

comment。`position_apply.rs:1,16` は同じ `MoveFormat` を両方の語で呼ぶ。
節11箇所 / ノード11箇所でほぼ拮抗。`types.rs:42` の `NodeId` が「節を指す番号」なので
「節」が正。

#### M19 「失敗しても `pos` は動いていない」の根拠が外部クレートの保証なのに書かれていない

comment。`position_apply.rs:82-83` / `index_builder.rs:176`。

書いてある理由は `apply_node_action` の構造しか説明していない。
`make_move` が `None` のとき `pos` が無傷なのは `shogi_core` 側の保証
（`position.rs:707` "If it returns None, it is guaranteed that self is not modified"）。
`index_builder.rs:176` は `ApplyFailed`（`make_move` の失敗）まで「盤に触る前」と言い切っていて、
実態より強い。

#### M20 表の形を決める `14` / `81` / `7` が裸で、`19` だけ名前を持つ

comment / architecture。`zobrist.rs:52,68-72,143-144`。
`14` は `PieceKind::NUM`、`81` は `Square::NUM`、`2` は `Color::NUM` で書ける。
`:143` の「`array_index()` が 0..13 を返す想定」は、上流の doc が保証しているので「想定」ではない。

#### M21 `file_build.rs` のモジュール doc が「昔はこうだった」を語っている

comment。`file_build.rs:7-9`。既存の箇所で、**この変更が足した行に経緯の混入は無い**
（追加行を走査して該当なし）。

#### M22 画面へ流す `emit` の失敗を21箇所すべて捨てている

robustness。`build.rs:139,162,170,192,201` / `project_manager.rs:161,186,204,279,294,335,345,357` /
`query_service.rs:85,102,156,172,175` / `commands.rs:59,123,186`。

`build_report.rs` が作った文言はこの `emit` が唯一の出口。失敗すると文言は捨てられ、
ログにも残らない（`file_build.rs:74-83` が残すのは内部の英語だけ）。
`EVT_SEARCH_END` が落ちると画面は「検索中…」のまま。

#### M23 bench が1回計測で、この変更が生む幅を見分けられない

perf。`search_bench.rs:99-111,724-733`。同じ題材で `bench_09` を各7回:
`1e2608fa` 2.731〜3.544ms / `HEAD` 2.377〜3.130ms。**揺れが ±15%。**
この変更の効果は `position_key` で +4〜7%、`pos.clone()` 削減で −6%。**どちらも揺れに沈む。**
`index_builder.rs:187` の doc が「動かすときは bench を測ること」と指している道具がこれ。

#### M24 bench が compaction を通らないので、本番と違う数を出す

perf。`search_bench.rs:67-150,388-396` vs `index_store.rs:278-286`。
bench は `IndexStore` を通らず桶へ直積みする。実測で1ファイルが触る桶は平均91.5個、
桶あたり 0.357本/ファイルで増えるので **192ファイル目で `COMPACT_THRESHOLD = 64` を超える**。
608ファイルの題材で bench_04 が 46.329μs/query、畳んだ後の bench_06 が 2.068μs/query — **22倍**。

#### M25 鍵の並び順の規約が5箇所に独立して書かれている。`PositionKey` に `Ord` が無い

ユーザーの問い（「鍵空間の管理は `position_key` に閉じているか」）を受けて追加。

`position_key.rs:31` の derive は `Debug, Clone, Copy, PartialEq, Eq, Hash` で
**`Ord` / `PartialOrd` が無い**。そのため「鍵は `(z0, z1)` の辞書順」という規約を
呼び手が各自で書いている。

| 場所                          | 何を書いているか                                                         |
| ----------------------------- | ------------------------------------------------------------------------ |
| `store/bucket.rs:48`          | `sort_by_key(\|(k, _)\| (k.z0, k.z1))` — **この変更で新しく1箇所増えた** |
| `store/segment.rs:80`         | `(self.z0[idx], self.z1[idx]).cmp(&(key.z0, key.z1))` — 二分探索の比較   |
| `store/index_store.rs:328`    | k-way マージのヒープの順序                                               |
| `cache/index_cache.rs:286`    | 直列化前の整列                                                           |
| `benches/search_bench.rs:504` | bench の整列                                                             |

**並べる側と探す側が食い違うと、二分探索が黙って外す。** 検索が0件になるか
別の局面を返すかで、エラーも警告も出ない（`position_key.rs:26-30` が
「衝突しても誰も気付かない」と書いている状態と同じ症状）。

`z0` / `z1` が `pub` なので、`store` / `cache` / bench の4モジュールが鍵の内部表現を
素で読んでいる。`segment.rs` が列に割るのは SoA の設計上必要（`position_key.rs:20-23`）だが、
**順序の規約まで各自が持つ必要は無い。**

直し方: `PositionKey` に `PartialOrd, Ord` を derive する。フィールドの宣言順が
`z0` → `z1` なので、**derive がそのまま現在の規約になる**。呼び手を `sort()` / `cmp()` へ寄せる。
`segment.rs:80` は列を持っているので `key_at(idx).cmp(key)` に。

## 実測で問題なしと判断したもの

- **鍵の値は変わっていない。** rust reviewer が `1e2608fa` の `ZobristTable` を写した独立クレートで
  実測し、平手が `(0x32cc4ccb2c51c541, 0x2049872a80d5a95c)` で `position_key.rs:257` と一致
- **クレートへの委譲で受理集合は変わっていない。** `promote: mmf.promote.unwrap_or_default()` が
  旧 `matches!(m.promote, Some(true))` と一致。成駒の打ちは `piece.unpromote().is_some()` で
  旧 `is_promoted_kind` と同じ6種を弾く。旧 `UnsupportedKind` は構築不能だったので失うものは無い
- **`step` の `Err` 時に `pos` は動かない。** `shogi_core` の保証（ただし M19）
- **`pos.clone()` の移動で渡す盤は変わっていない。** forks に降りる時点で `pos` は未変更
- **`get_or_init` の呼び出し増は効かない。** 実測 +16.52ns/局面（+7.3%）だが、
  索引構築全体で **+0.10ms = 0.03%**。95回/局面は「全ノード」ではなく「全ファイル1回」
  （`piece_at` が extern 呼び出しで LLVM が CSE できず、ループ外に上がらないことを逆アセンブルで確認）
- **`ZobristValue` の値返しは損ではない。** `movups` + `xorps` の1本に畳まれている
- **`empty_buckets()` は作り方を変えていない。** シンボルが消えるまでインライン展開されている
- **`BuildWarn` の `Display` / `message` の使い分けは守られている。** 内部の英語が漏れる新経路は無い
- **`zobrist::hand_count` の `None` は `hand_step:191-192` に到達しない。** 先頭の `count(kind)?` が
  同じ条件で返る。到達する `None` は255上限の枝だけ

## 見ていない範囲

- `npm run verify` / `npm run verify:rust` を走らせた reviewer は無い（こちらでは通してある）
- `store/segment.rs` / `node_table.rs` / `file_table.rs` の中身。型名の確認だけ
- `cache/index_cache.rs` の encode/decode 本体
- TS 側の網羅。`contract.ts` と `types.rs` の欄名の突き合わせは未実施
- `book` 側のもう1本の SFEN 受理集合（#236）
- 並列での性能実測（`build.rs` は Semaphore で 2〜8 並列）。測ったのは全部シングルスレッド
- ARM（Apple Silicon）での実測。`+7.3%` は x86_64 の数字で、ARM64 の Acquire ロードは別
- `walk_sequence` の再帰深さとスタック枯渇の可否

## lint / hook で強制できるもの

- **rustdoc の壊れたリンク**（M3）: `RUSTDOCFLAGS="-D rustdoc::broken_intra_doc_links -D rustdoc::private_intra_doc_links" cargo doc --no-deps` を `verify:rust` に足す。**既存の警告が13件ある**ので先に片付けるか段階的に絞る必要がある
- **実在しないファイルパスを指す doc**（M4）: `tests/comment_identifiers.rs` の候補抽出に「バッククォート内が `*.rs` で終わる語」を足し、`src-tauri/src` 以下の実在を見る
- **`std::array::from_fn(|_| Vec::new())` の直書き**（M2）: `verify-gate.sh` に grep を足す。`index_cache.rs:264` の添字を使う形は除外が要る
- **`let _ = app.emit(...)`**（M22）: clippy の `let_underscore_must_use` を `warn` に
- **`IndexState` の二重定義**（M10）: 一本化すれば型が強制する
- **段の向き**（M9）: `layering.rs` の `engine_dir()` を一般化して `search/` の `LAYERS` を足す
- **閉じた issue 番号**（M15）: `gh issue view` で CLOSED を弾く検査。オフラインと API 制限があるので別ジョブ向き
- **機械では防げない**: M1（腐ったコメント）、M5、M7、M13、M14、M16、M23、M24

## 修正計画（r1 → r2）

### 束（同じ根から出ている所見）

- **上流に任せられるものを自前で持っている**: M5 → M20（`color_index` を
  `Color::array_index()` に寄せると、寸法の `2` も `Color::NUM` で書けるようになり
  M20 の指摘箇所の一部が消える）
- **規約が複数箇所に書かれている**: M25 → M2（`Ord` を derive すると
  `bucket.rs:48` の `sort_by_key(|(k,_)| (k.z0, k.z1))` が `sort()` になり、
  M2 が数えた「桶の入口」の1つが別物になる）
- **この変更で書いた doc が実測と違う**: M13 / M14 / H2 / H3 / M15 は
  互いに独立だが**同じ書き方から出ている**（下の「対象そのものを疑ったか」）

### このラウンドで直すもの

| 順  | 所見                                        | なぜこの順か                                                                                       | この直し方で壊しうるもの                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **B1** SFEN 持駒の上限                      | 唯一の BLOCK。実害があり、他と独立に直せる                                                         | 上限を超える綴りが `Ok` から `Err` に変わる。`query_service.rs:174` の `EVT_SEARCH_ERROR` を通るようになるので、いま無言でハングしていた入力が**英語のエラー文字列を画面に出す**（H1 の症状に合流する）。`book` 側は `18` を超える持駒を別の理由で弾いており、受理集合の差が1つ減る方向（#236）     |
| 2   | **M25** `PositionKey` に `Ord`              | 型で規約を1つにする（手順3-1）。M2 の指摘箇所を1つ消す（束の先頭）                                 | `derive` の順序はフィールド宣言順 `z0` → `z1` で現行と一致するので、**索引の並びは変わらない**。ただし `segment.rs:80` の `cmp_at` を `key_at(idx).cmp(key)` に寄せると `key_at` が `Occurrence` を読まない形かの確認が要る。寄せ損ねると二分探索と整列が食い違い、**検索が黙って0件になる**        |
| 3   | **M3** rustdoc リンク2本                    | 機械で強制できる（手順3-1）。ただし既存警告13件があるので、`-D` 化は今回やらず**リンクを直すだけ** | リンクを外すと導線が消えるので、素のコードスパンに落とす。`-D` 化を見送ることは r2 の焦点に残す                                                                                                                                                                                                     |
| 4   | **M1** `index_cache.rs:1273` の逆コメント   | 4人が指摘。腐ったコメントは無いより悪い                                                            | 題材の `z0` を `bucket()` と一致する値に直すと、**round-trip テストが通る値域が変わる**。`decode_all` が桶の位置を検査していないので、題材を直しても検査が増えるわけではない（増やすなら別所見）                                                                                                    |
| 5   | **M7** 頭打ちのテスト                       | 私の変更が作った検出力の低下。他の修正が積み上がる前に埋める（手順3-3）                            | `zobrist.rs` に `#[cfg(test)]` を足す。**このファイルは今 `#[test]` が0個**なので、テストの中から `pub(super)` を呼ぶ形が成立するかを確かめる必要がある                                                                                                                                             |
| 6   | **M5 + M20** `zobrist` を上流に寄せる       | 束の先頭。`color_index` を消すと寸法も型で書ける                                                   | `Color::array_index()` は `Black → 0` / `White → 1` で現行と**同じ写像**（実測済み）。ずれていれば鍵が全部変わるので、**golden テスト（`the_same_position_always_yields_the_same_key`）が落ちることで検出できる**。`PieceKind::NUM` / `Square::NUM` の値が `14` / `81` でなければコンパイルが落ちる |
| 7   | **M13 + M14** 私が書いた doc の数値と理由   | doc のみ。束（同じ根）                                                                             | 無し（コメントだけ）                                                                                                                                                                                                                                                                                |
| 8   | **H2 + H3 + M15** 私が書いた doc の事実誤り | doc のみ。#333 / #330 の参照を落とす                                                               | H3 は `initial_position.rs` の記述を `kifu_reader.rs` に合わせる。**合わせる先が正しいことは実装で確認済み**（`build.rs:155` / `project_manager.rs:262-275`）。M15 は番号を消すだけで、食い違いの記述自体は残す                                                                                     |
| 9   | **M2** 桶の入口を1つにする                  | M25 の後（束）                                                                                     | `index_store.rs:13` の `pub use` を `use` に落とすと、`index_store` 経由で引いていた呼び手が壊れる。**現在0件**なので影響は無いはずだが、bench を含めて確認する                                                                                                                                     |
| 10  | **M4** 実在しない `api.rs`                  | doc のみ。7箇所                                                                                    | `docs/state-transitions/search.md` を触るので **`verify:rust` まで走る**（ラチェットが Rust 側）                                                                                                                                                                                                    |

### 直さないもの

| 所見                                                     | 行き先    | 理由                                                                                                                                                                                                                          |
| -------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1** 検索の失敗が英語のまま出る                        | **issue** | 直すには `SfenParseError` の文言化に加えて TS 側の復帰導線（`lastQueryKeyRef` の扱い、再試行）まで要る。範囲を広げると PR が読めなくなる（`/implement` 手順7）。B1 を直すとこの経路を通る入力が増えるので、**優先度は上がる** |
| **M6** `BuildError::Apply` が `fork_pointers` を読まない | **r2**    | 失敗経路だが `BuildPolicy::Strict` に本番の呼び手が無く、いま踏めない。`Strict` の生死（既知の宿題）と一緒に決める                                                                                                            |
| **M8** `zobrist` の可視性                                | **r2**    | ファイルを `position/position_key/zobrist.rs` へ移す必要があり、1件で検証1回を使う割に大きい                                                                                                                                  |
| **M9** `layering.rs` が `search/` を見ていない           | **issue** | `layering.rs` の `engine_dir()` を一般化する作業で、この PR の範囲外。**doc の嘘だけは今回直す**（M9 のうち「機械が見ている」と書いた行）                                                                                     |
| **M10** `IndexState` が2つ                               | **issue** | `types.rs` と `index_store.rs` をまたぎ、`commands.rs` / `project_manager.rs` の呼び手も動く                                                                                                                                  |
| **M11** `node_action` の置き場                           | **r2**    | 妥当な指摘だが、`position_key.rs` のテスト2箇所も一緒に動かす形になる                                                                                                                                                         |
| **M12** `IndexedFile` / `FileBuild` の名前               | **r2**    | 2回目の改名になるので、M18（訳語）と一緒に1回で決める                                                                                                                                                                         |
| **M16 / M17 / M18 / M19 / M21** doc の配置・欠落・訳語   | **r2**    | どれも doc のみ。まとめて1ラウンドに寄せる方が検証の回数が減る                                                                                                                                                                |
| **M22** `emit` の失敗21箇所                              | **issue** | `search/` 全体に共通のヘルパを入れる作業。clippy の `let_underscore_must_use` を足す判断も伴う                                                                                                                                |
| **M23 / M24** bench が本番と違う経路を1回だけ測る        | **issue** | bench の作り直し。`index_builder.rs:187` の doc が「bench を測れ」と指しているので、**その doc の信頼性に直結する**が、この PR では直せない                                                                                   |

### 対象そのものを疑ったか

**所見が1つの機構ではなく、1つの書き方に集まっている。**

29件のうち **8件（H2 / H3 / M13 / M14 / M15 / M16 / M17 / M19）が「私がこの変更で書いた doc の誤り」**。
内訳は、数を測らずに書いた（M13「約7万項」が実際2,536）、理由を確かめずに書いた
（M14「2^128 通りあるので二分探索が長くなる」）、実装を読まずに保証を書いた
（H2「取り消したときは届かない」）、参照先を確かめずに書いた（H3 / M15 は CLOSED の issue）。

**機構ではないので落とせない。規律として計画に載せる**:

> doc に**数値・保証・参照先**を書くときは、書く前にそれぞれ**測る / 実装を読む / 存在を確かめる**。
> 「〜なので」と書いたら、その根拠がコードのどの行かを指せること（`/implement` 手順5 が
> 4ラウンド続けて出したのと同じ故障）。

これは r2 以降の自分への焦点でもある。**doc を厚く書いたこと自体は所見ではない**
（M16 は配置の問題であって量の問題ではない）が、厚く書くほど誤りの母数が増える。

規約の重複（M1 / M2 / M5 / M20 / M25）が5件出ているのは別の根で、こちらは
**この変更がまさに直そうとしていた病**。1つ潰すたびに次が見えている状態なので、
機構を疑うより順に潰す方が早い。

### 次ラウンドの焦点

次の `/review-round` は、これを reviewer へ渡す。

1. **B1 の修正で `Ok` → `Err` に変わった入力が、どこへ出るか。** `EVT_SEARCH_ERROR` に
   英語が出る経路（H1）へ合流していないか。上限の値（18枚）が `book` 側と揃っているか
2. **M25 の `Ord` derive で、整列と二分探索が本当に同じ順序になったか。** `bucket.rs` の
   `sort()`、`segment.rs` の `cmp_at`、`index_store.rs` のヒープ、`index_cache.rs` の `cmp`
   の4つが1つの規約を通っているか。**1つでも外れると検索が黙って0件になる**
3. **M5 の `Color::array_index()` への寄せで鍵が変わっていないか。** golden が守るはずだが、
   golden 自身が正しい値を持っているか
4. **M7 で足したテストが、頭打ちの境界を本当に見ているか。** `n.min(..)` を `n % ..` に
   変える変異で落ちるか
5. **M2 で桶の入口を1つにした後、`empty_buckets` を通らない生成が残っていないか**
6. r1 で見なかった範囲（`store/segment.rs` / `node_table.rs` / `file_table.rs` の中身、
   `index_cache.rs` の encode/decode 本体、並列での性能、TS 側の欄名の突き合わせ）

### 検証の見積り

10件 × `verify:rust`（約2分15秒）＋ M4 は `verify` も走る ≈ **23〜25分**。
`/review-plan` 手順7 の目安（10件で20分超）を少し超えるが、B1 が BLOCK で
分割できないため今回は積む。

**r2 へ送ったのは9件**（M6 / M8 / M11 / M12 / M16 / M17 / M18 / M19 / M21）。
そのうち doc のみの5件（M16 / M17 / M18 / M19 / M21）は r2 でまとめて取ると
検証の回数が減る。**issue へ出すのは6件**（H1 / M9 / M10 / M22 / M23 / M24）。

## 結果（r1 の修正）

| 所見                                 | コミット   | 備考                                                                         |
| ------------------------------------ | ---------- | ---------------------------------------------------------------------------- | --- | ---------------------------------------- |
| **B1** SFEN 持駒の上限               | `922e510f` | 上限の検査を落とす変異でテストがタイムアウトすることを確認                   |
| **M25** `PositionKey` に `Ord`       | `68b17bab` | `store/segment.rs` にテストを新設（#[test] が0個だった）。両側の変異で落ちる |
| **M3** rustdoc リンク2本             | `e072b9d3` | `-D` 化は見送り。他に本当に壊れたリンクが3件あり2件は `search/` の外         |
| **M1** 桶の逆コメント                | `d980a886` | 題材の桶を `bucket()` に決めさせた                                           |
| **M7** 頭打ちのテスト                | `fec7ed04` | レビュアーが素通りを実測した変異2つが落ちるようになった                      |
| **M5 + M20** 上流への委譲            | `34cc9205` | golden が写像の一致を守る                                                    |
| **M13 + M14** doc の数と理由         | `2164d9e1` | 2,536項／桶の理由を実装に合わせた                                            |
| **H2 + H3 + M15** doc の保証と参照先 | `6401c445` | END は取り消しでも届く／#333 #330 は CLOSED                                  |
| **M2** 桶の入口                      | `8c778be9` | `from_fn(                                                                    | \_  | Vec::new())`が`bucket.rs` の外から消えた |
| **M4** `api.rs` の参照               | `b4583a85` | 7箇所。`obs-shogi-spec.md` の `traverse` も                                  |

### issue へ出したもの

| 所見                                           | issue |
| ---------------------------------------------- | ----- |
| **H1** 検索の失敗が英語のまま出る              | #398  |
| **M9** `layering.rs` が `search/` を見ていない | #399  |
| **M10** `IndexState` が2つ                     | #400  |
| **M22** `emit` の失敗21箇所                    | #401  |
| **M23 + M24** bench の計測と経路               | #402  |

### r2 へ送ったもの

M6（`BuildError::Apply` が `fork_pointers` を読まない）/ M8（`zobrist` の可視性）/
M11（`node_action` の置き場）/ M12（`IndexedFile` の名前）/
M16・M17・M18・M19・M21（doc の配置・欠落・訳語・根拠・経緯）。

### 修正で新しく分かったこと

**M25 の修正中に、整列と二分探索の一致を見ているテストが1本も無いことが判明した。**
`Ord` へ寄せる前に変異（二分探索の比較を `z0` だけにする）を当てたところ、
`search::` の67本が全部通った。`store/segment.rs` は `#[test]` が0個で、
`store/` 全体でも0本。テストを1本足して両側の変異で落ちることを確かめた。

**M3 は完了していない。** リンクは直したが、`-D rustdoc::broken_intra_doc_links` を
`verify:rust` に足す作業は見送った。理由は本文に記載。`search/read/kifu_reader.rs` の
1件は `read/` を読むラウンドで片付ける。
