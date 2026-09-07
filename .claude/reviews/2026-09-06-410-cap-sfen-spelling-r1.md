# レビュー 410-cap-sfen-spelling ラウンド1

- 日付: 2026-09-06
- 範囲: `fix/410-cap-sfen-parse-error`（`origin/main` 2273b3a0 との差分、2コミット）
  - `src-tauri/src/search/message.rs`（新規）
  - `src-tauri/src/search/mod.rs`
  - `src-tauri/src/search/position/sfen_position.rs`
  - `src-tauri/src/search/read/{diagnosis,encoding,kifu_reader}.rs`
- 走らせた reviewer: rust / robustness / architecture / comment
- 対象コミット: `畳み込み済み`

## 所見

### [BLOCK] R1-01 private な項目への intra-doc link が2本増え、rustdoc ラチェットが落ちる（comment）

`sfen_position.rs:23` の `[`invalid`]` / `[`invalid_ply`]` は private fn を指すので
`private_intra_doc_links` が立つ。`scripts/rustdoc-ratchet.sh` の `BASELINE=4` に対して
実測6。`npm run verify:rust` の最終段が exit 1 する。

**実測で確認した。** `npm run ratchet:rustdoc` が
`rustdoc の警告が増えた: 6（基準 4）` で落ちる。

### [MEDIUM] R1-02 テストが下限を見ておらず、詳細を空にする変異が生き残る（rust / robustness）

`a_huge_token_does_not_end_up_in_the_message` が見るのは長さと `\0` だけ。
`invalid` が `String::new()` を返す変異を当てると `"invalid sfen: "`（14文字）になり、
2つの assert は両方通る。**この issue の主題である「刈っても何が悪いかは残る」を
1文字も固定していない。**

### [MEDIUM] R1-03 `InvalidPiece` / `InvalidHandPiece` が刈る口を通らず、制御文字が素通りする（architecture / rust / robustness）

`sfen_position.rs:298,320,322,335,348`。長さは1文字なので #410 の症状は出ないが、
`Capped` のもう1つの規約（制御文字を空白に落とす）が掛かっていない。
`"\u{0}nsgkgsnl/... b - 1"` は `InvalidPiece("\0")` になり、画面には
`invalid piece: ` と**何も名指ししていない文言**が出る。
型の doc は「残りが載せるのは1文字か駒種名」と**長さだけ**を根拠にしていて、
制御文字の規約が外れていることが読めない。

### [MEDIUM] R1-04 移した `Capped` / `MESSAGE_LIMIT` の唯一のテストが `read/` に残っている（architecture / rust）

`the_message_sink_stops_exactly_at_the_limit` は `read/kifu_reader.rs:1119`。
型と定数は `search/message.rs` へ下ろしたのに、境界を固定するテストは棋譜リーダの
1000行超のテストモジュールに置き去り。`message.rs` には `#[test]` が1本も無い。

### [MEDIUM] R1-05 「作る口は `invalid` / `invalid_ply` だけ」を見ている機械が無い（architecture / rust / comment）

`Invalid(String)` は素の `String` を受けるので、次に
`SfenParseError::Invalid(format!("hand token: {hand}"))` と書いても fmt も clippy も
テストも何も言わない。同じ enum の `InvalidPiece` が実際に素で3箇所から作られていて、
「素で作る」書き方がファイル内に手本として並んでいる。

### [MEDIUM] R1-06 「刈る規約は1つ」が crate 全体では成り立たない（architecture）

`src/engine/utils.rs:139` の `shown` が別に在る。改行の扱い（`shown` は U+FFFD に潰す、
`capped` は通す）と上限の決め方（引数 / 固定300）が違う。
`tests/layering.rs` の規則3（`engine/` は crate の他の枝を `use` しない）があるので
**統合は今の段構成ではできない** — つまり2つあるのは当面の既定状態で、doc がそれを
否定している。

### [MEDIUM] R1-07 `MESSAGE_LIMIT` の見出しが、実際に上限が掛かる対象と違う（comment）

300 が掛かるのは `capped` / `Capped` が組む1本だけ。画面に出る文言は必ずそれより長い
（`parse_failed` が上限の外で1文を足し、`#[error("invalid sfen: {0}")]` が前置し、
`finish` が `…` を足す）。「文言 = 300 文字以内」と読んだ人は、上限の外の追記を
漏れと読んで消しにいく。

### [MEDIUM] R1-08 `\n` を残す分岐に理由が無く、行末コメントと条件式が食い違う（comment）

`message.rs:64-66`。`\n` は `char::is_control()` が true を返すので、
「制御文字は画面に出しても意味が無い」というコメントと条件式の第1項が正面から食い違う。
**このリポジトリで4ラウンド続けて出た故障（コメントの理由と条件式のズレ）と同じ形。**

### [MEDIUM] R1-09 `Capped::finish` に doc が無い（comment）

`…` を足す唯一の出力仕様が型の外にしか無い。`Capped` はモジュールを跨いで直に使われる
（`diagnosis.rs:103`）ので、`finish` を通さない取り出し方を後から足すと、刈られたことが
利用者に伝わらない文言が黙って出る。

### [MEDIUM] R1-10 画面の挙動の前提が Rust 側3箇所に複製され、しかも現物と違う（comment / robustness）

新しい2ファイルは「`flex-wrap: wrap` なので長い文言はそのまま行数になって一覧を潰す」と
書くが、`flex-wrap` が折り返すのはフレックスアイテムであって語の中ではない。sfen は
空白を含まない1トークンなので折り返し位置が無く、実際には `.pos-search__left` の
`overflow: hidden` に**切られる**。`Capped::finish` が付けた `…` も切られる側に入るので、
**刈った事実が利用者に伝わらない。**

さらに既存の `types.rs:255-257`（`SearchErrorPayload::message` の doc）は
「画面に素で出す前に言葉を用意すること」と書いており、新しい2つの doc（現状追認）と
指示が逆を向いている。

### [MEDIUM] R1-11 `query_service.rs:107` の join error が刈る口を通らない（rust）

同じ `EVT_SEARCH_ERROR` に載るのに `capped` を通らない。

### [MEDIUM][差分外] R1-12 文言が英語のままで復帰導線が無い（rust）

`invalid sfen: board ranks must be 9: ...` は利用者の言葉ではない。

### [HIGH][差分外] R1-13 綴りが読めない研究局面は、管理モーダルで失敗を一切出さず「局面を読み込み中...」のまま止まる（robustness）

`buildPreviewDataFromSfen` が `null` を返し、`PositionPreviewPane` がそれを
「読み込み中」と描く。**失敗を進行中として見せている。** しかも
`StudyPositionSaveModal` は `sfen` を編集させないので、壊れた綴りは**削除する以外に
手が無い**。`docs/state-transitions/failure-surfacing.md:110` の F-15 はこれを
「空表示 / `null`」「消えてよい」と記録しているが、現物は空表示ではない。

### [MEDIUM][差分外] R1-14 同じ綴りを読む口が3つあり、受理集合が食い違う（robustness）

`useTurnInfoCache.ts` の `parseTesuu` が `parseInt(...) || 0` で、`position sfen ...`
形式（Rust が設計上受理する）の研究局面を**「0手」と表示する**。同じ1件について
一覧は「壊れている」、検索は「問題なし」と答える。

## 重複・矛盾した所見

- **R1-11 について rust と robustness が逆の判断。** rust は「`JoinError` が panic の本文を
  埋めるので刈るべき」。robustness は tokio 1.50 の `Display` を読んだうえで
  「`{:?}` なので制御文字は escape され、`search_occurrences_by_key` の経路には
  `expect`/`unwrap`/`panic!` が1つも無いので**入力由来の値は埋まらない**。長さの穴は無い」と
  数えている。→ **後者が精確。** ただし刈る規約を1つにする価値は残るので直す。
- **R1-05 の直し方が3案。** (a) `CappedMessage` newtype、(b) `tests/` に走査ラチェット、
  (c) doc の断定を指示形に落とす。→ CLAUDE.md「同じ失敗を2回するまでルールを足さない。
  1回目はルールではなくテスト」に従い (c)。振る舞いのテストは R1-02 / R1-03 で足りる。
- **R1-10 の直し方が2案。** (a) SCSS に `overflow-wrap: anywhere` を入れて doc を正にする、
  (b) doc を現物に合わせる。→ (b)。SCSS は別スライスで、UI の判断が要る（issue へ）。

## 見ていない範囲

- アプリを起動した実測は無い。R1-10 の「切られて `…` が見えない」は SCSS と CSS の
  フレックス規則からの導出で、画面で測っていない
- `npm run verify`（TS 側）は未実行。差分は Rust のみ
- `cargo audit` / `npm audit` は未実行
- `benches/search_bench.rs` の中身
- `search/index` / `search/cache` / `build` 段の中身（`MESSAGE_LIMIT` の利用箇所を
  grep で数えただけ）

## lint / hook で強制できるもの

- **R1-01 は既にある機械が捕まえていた**（`scripts/rustdoc-ratchet.sh`）。ただし worktree からの
  `git commit` では `.claude/hooks/verify-gate.sh` が主ワークツリーを見て素通りする（#394）ため、
  コミットは止まらなかった
- `EVT_SEARCH_ERROR` / `EVT_INDEX_WARN` に載る `message:` が `capped` を通っているかは、
  既存の走査ラチェット（`index_writes_are_guarded.rs` / `production_unwrap.rs` と同型）で見られる
- `search/` の段の向きは `tests/layering.rs` に段を足せば機械化できる（#399）。今日足すと
  `read/kifu_reader.rs:1077` のテストコードが `index` を引いているので1本落ちる
- Rust のコメントが TS 側の綴り（`PositionSearchStatusBar`）を指す形は、どの検査も見ていない

## 修正計画（r1 → r2）

### 束（同じ根から出ている所見）

- **刈る口の数**: R1-03 → R1-05（R1-03 で `InvalidPiece` / `InvalidHandPiece` も口に寄せると、
  R1-05 の「口は2つだけ」という断定は**別物になる**。R1-05 は R1-03 の後で書き直してから取る）
- **テストが何を固定しているか**: R1-02 → R1-03（R1-02 で下限を足した `for` の表に、
  R1-03 が制御文字のケースを足す。逆順だと表を2度触る）
- **`message.rs` の doc 群**: R1-06 / R1-07 / R1-08 / R1-09 は同じファイルの別の箇所。
  束ではないが、まとめて最後に置く（どれも振る舞いを変えない）

### このラウンドで直すもの

| 順  | 所見  | なぜこの順か                                                                                           | この直し方で壊しうるもの                                                                                                                                        |
| --- | ----- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | R1-01 | **既にある機械が赤い。** これを直すまで `npm run verify:rust` が通らず、後続の検証が全部無意味になる   | 無い（リンク記法を素のコードスパンにするだけ）。ただし「飛べない」ことは残るので、飛び先を書かない書き方に揃える                                                |
| 2   | R1-03 | 失敗経路の門番の向きを変える。修正が積み上がる前に入れる。R1-05 の指摘箇所を別物にする                 | `InvalidHandPiece(char)` を `String` に変えると、この enum を `match` している呼び手が壊れる。**実測: crate 内に `InvalidHandPiece` を `match` する箇所は0**    |
| 3   | R1-02 | R1-03 の後。同じ `for` の表に手を入れるので、表の形が確定してから                                      | `starts_with` は文言そのものを固定するので、**文言を日本語化する #398 の作業でこのテストが落ちる**。落ちるのは正しい（意図的な変更なら直す）が、#398 の側で踏む |
| 4   | R1-11 | 失敗経路。`EVT_SEARCH_ERROR` に載る文言の口を1つの規約に揃える                                         | `JoinError` の文言が300文字で切れる。robustness が数えた通り**現状は入力由来の値が埋まらない**ので、切れて困る内容は無い                                        |
| 5   | R1-04 | テストの置き場。振る舞いを変えない                                                                     | `kifu_reader.rs` の `use` が1つ減る。`MESSAGE_LIMIT` は同ファイルの別テスト（`:1745`）がまだ使うので、import は残る                                             |
| 6   | R1-05 | R1-03 で口の数が変わった後に、doc の断定を現物へ合わせる                                               | 無い（doc のみ）。断定を弱めるので、**機械が無いことは変わらない**。それは lint の項へ送る                                                                      |
| 7   | R1-07 | doc のみ                                                                                               | 無い                                                                                                                                                            |
| 8   | R1-08 | doc のみ。**このリポジトリで4ラウンド続けて出た故障と同じ形**なので、理由と条件式を1行ずつ突き合わせる | 無い                                                                                                                                                            |
| 9   | R1-09 | doc のみ                                                                                               | 無い                                                                                                                                                            |
| 10  | R1-06 | doc のみ                                                                                               | 無い                                                                                                                                                            |
| 11  | R1-10 | doc のみ。前提を `SearchErrorPayload::message` に寄せ、Rust から SCSS の実装詳細を消す                 | `types.rs` の doc を書き換えるので、**そこを読んで「素で出すな」と受け取っていた読み手の指示が変わる**。指示自体は残す（刈るのは Rust、言葉は #398）            |

### 直さないもの（行き先）

| 所見               | 行き先                      | 理由                                                                                                                                            |
| ------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| R1-12              | **#398**（既存）            | 文言の日本語化と復帰導線はそちらの範囲。今回の刈り込みは #398 の前提を壊していない（robustness が確認済み）                                     |
| R1-13              | **新 issue**                | `src/` の別スライス（研究局面の管理モーダル）。範囲を広げると PR が読めなくなる。`failure-surfacing.md` の F-15 が現物と違うことも同じ issue へ |
| R1-14              | **新 issue**                | 同上。受理集合そのものは #236 の宿題だが、`\|\| 0` で「0手」と嘘をつく部分は独立して直せる                                                      |
| R1-10 の SCSS 側   | **R1-13 の issue に含める** | `overflow-wrap` を入れるかは UI の判断。Rust 側の doc を現物に合わせる（順11）だけでは画面は直らない、と issue に書く                           |
| `layering.rs` の段 | **#399**（既存）            | `search/` の段を機械に見せる話。今日足すと `read/kifu_reader.rs:1077` のテストコードで1本落ちるので、その分の判断が要る                         |
| R1-05 の機械化     | **見送り（報告書に理由）**  | CLAUDE.md「同じ失敗を2回するまでルールを足さない。1回目はルールではなくテスト」。振る舞いのテストは R1-02 / R1-03 で足す                        |

### 検証のコスト

**worktree からの `git commit` では `verify-gate.sh` が主ワークツリーを見て素通りする（#394）。**
つまりこのブランチでは**コミットが検証を走らせない**。手で回す。

- 順2〜5（振る舞いを変える）の後: `cargo test --lib search::`
- 全部積んだ後: `npm run verify:rust`（fmt + clippy + test + rustdoc ラチェット）を1回

### 次ラウンドの焦点

次の `/review-round` に渡すもの。

1. **R1-03 で口を増やしたことで、刈る規約から外れた腕が新しく出ていないか。**
   `SfenParseError` の全バリアントについて、載る値の出どころと上限を1つずつ言えるか
2. **R1-02 の `starts_with` が、文言の順序（診断が先頭・綴りが末尾）を本当に固定しているか。**
   robustness が「効いているのは300ではなく診断を先頭に置いたこと」と書いた点
3. **R1-04 でテストを移したことで、`read/` 側が失ったカバレッジが無いか**
4. **doc 群（順6〜11）で、書いた理由と条件式が1行ずつ対応しているか。**
   4ラウンド続いた故障がここ
