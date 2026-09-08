# レビュー book-foundation ラウンド1

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/`（mod / error / types / sfen / reader / session / api）と `src-tauri/src/lib.rs` の登録部分
- 走らせた reviewer: rust / robustness / architecture / comment
- 対象コミット: `116cff1`
- 変更の意図: issue #90「定跡ファイルを開いて局面から候補手を引く基盤」。形式ごとの reader を足す前に、開く・引く・閉じるの境界を決める。具体的な reader は #91。

## 所見

### F-01 [BLOCK] `normalize_sfen` が `moves` 付き文字列を黙って「指す前の局面」のキーにする

4体全員が指摘。`sfen.rs:17-19,32-40`。`startpos` を見た時点で残りを読まずに return し、`sfen` 側も board/side/hands の3トークンで打ち切るので、`position startpos moves 7g7f 3c3d` が初期局面のキーになる。エラーは出ない。doc が「USI 文字列をそのまま渡せる」と宣言しているため、フロントがエンジンへ送るのと同じ文字列を渡す筋道が現実にある。**テスト `ignores_the_moves_suffix_of_startpos` が誤挙動を仕様として固定していた。**

→ 直す。`moves` を含む入力は `InvalidSfen`。テストは拒否を固定する側に書き換える。

### F-02 [HIGH] `is_file()` が権限エラーとディレクトリを `NotFound` に潰す

rust / robustness / architecture が指摘。`reader.rs:26-31`。`Path::is_file()` は metadata が取れない全ての場合に false を返すので、macOS の TCC で読めないファイルが「見つからない」になる。利用者は Finder でファイルを見ながら探し直すことになり、復帰導線に辿り着けない。`BookErrorCode` に `PermissionDenied` が無く、`From<io::Error>` も `Io` に丸める。写し元の `FsErrorCode` は両方持っている。

→ 直す。`fs::metadata` に替え、`PermissionDenied` / `InvalidType` を足す。

### F-03 [HIGH] 開いているハンドルを列挙・一括解放する手段が無い

rust / robustness が指摘。ハンドルは JS 側の変数にしか無く、webview の reload や HMR で失われると `close_book` を呼べなくなり、定跡ぶんのメモリがプロセス終了まで残る。`closing_every_book_drops_every_reader` が保証しているのは「close を呼べば leak しない」だけ。

→ 直す。`list_books` と `close_all_books` を足す。ページ破棄フックまでは今回入れない（下記 F-13 参照）。

### F-04 [HIGH] `normalize_sfen` が盤面と持駒を検証しないので、壊れた入力が「未収録」に化ける

robustness / architecture が指摘。検査は「トークンが3つある」「手番が b か w」だけ。`"zzz b -"` も 6 段しかない盤面も `Ok` になる。`lookup` の契約が「未収録は空の Vec」なので、**壊れた入力と本当に未収録の局面が呼び出し側から区別できない**。さらに持駒の綴りを素通しするので `b P2p` と `b 2pP` が別キーになる。

→ 直す。段数・各段の駒数・駒文字・持駒の書式を検査し、持駒の並びを正規化する。reader 側も同じ関数でキーを作ることを契約に書く。

### F-05 [MEDIUM] `BookReader::lookup` の「正規化済み」が doc にしか無い

architecture / comment が指摘。`lookup(&self, key: &str)` は `&input.sfen` を渡してもコンパイルが通る。症状は「なぜか引けない（空が返る）」という最も追いにくい形になる。#96 で複数 reader を束ねる層が正規化を忘れても型は何も言わない。

→ 直す。`BookKey` newtype を作り、`normalize_sfen` 以外から構築できなくする。あわせて `search::PositionKey`（Zobrist）と語がぶつかっているので `to_book_key` に改名する。

### F-06 [MEDIUM] `close_book` が同期コマンドなので、数百 MB の Drop が IPC スレッドで走る

rust が指摘。`async` の無い `#[tauri::command]` は `ExecutionContext::Blocking` として IPC ハンドラのスレッドで実行される。`Arc<OpenBook>` の最後の参照がそこで落ちるので、閉じた瞬間に UI が固まる。open 側だけ blocking プールへ逃がしていて close 側が素通しなのは筋が通らない。

→ 直す。`close` は取り出した本体を返し、Drop を `spawn_blocking` に投げる。

### F-07 [MEDIUM] `path` が生文字列のまま。相対パスと NUL の扱いが未定

rust / robustness が指摘。バンドルされた macOS アプリの CWD は `/` なので、相対パスは黙って解決に失敗し、`BookInfo.path` にもその相対文字列が残って UI に出しても意味を成さない。既存のパス受け取りコマンドは `validate_under_root` を通しているが、定跡はプロジェクト root 外に置くのが普通なので同じ検査は当てられない。**当てられないなら、なぜ当てないかがコードに要る。**

→ 直す。絶対パスと NUL を検査し、canonicalize した結果を登録する。root 外を許す理由を doc に書く。

### F-08 [MEDIUM] 失敗経路が1つもログに残らない

robustness が指摘。`api.rs:20` の成功前 `info` だけで、`Err` を返す全経路にログが無い。ファイルログを持っているのに「定跡が開けない」の切り分けができない。

→ 直す。

### F-09 [MEDIUM] `lookup` が IO 失敗を `Ok(vec![])` に丸める実装を許す契約になっている

robustness が指摘。「未収録は空の Vec」とだけ書いてあるので、#91 の on-the-fly reader が read 失敗を空に丸めても契約違反にならない。外付けドライブを抜くと「全局面が定跡に無い」と表示され続ける。panic の扱いも未定で、壊れたバイナリ定跡は `Unknown`「スレッドごと落ちた」になり、`InvalidContent` に辿り着かない。

→ 直す。trait doc に禁止を明記し、パスを添える `BookError::from_io` を足す。

### F-10 [MEDIUM] `mod.rs` が全 `pub mod` と再エクスポートを両方やっていて境界になっていない

architecture / comment が指摘。同じ crate 内に `file_system/mod.rs`（mod を private にして `pub use` だけを入口にする）の前例があるのに、`search/mod.rs`（全部 pub）の形と混ざっている。#91 で形式ごとの reader が増えたとき、`BookState` を通さず reader を直接作る呼び出しが生えても止まらない。`BookState::get` の戻り型 `OpenBook` が facade に出ていない不整合もある。

→ 直す。`file_system/mod.rs` に揃える。

### F-11 [MEDIUM] `OpenBook` が `open_book` / `OpenBookInput` と名前でぶつかる

comment が指摘。`OpenBookInput` は `OpenBook` の入力に見えるが無関係。動詞句なので値としても読みにくい。

→ 直す。`BookSession` に改名する。

### F-12 [MEDIUM] コメントに書いた理由が条件と対応していない / 出典が repo 内の調査と食い違う

comment が指摘。3件。

- `session.rs:64-65` の close の理由「残るとメモリを抱えたままになる」は、`remove` が `None` を返す分岐（＝最初から持っていない）の理由になっていない。実際にメモリを保持する条件は「`get` が配った `Arc` が生きている間」で、そちらには何も書いていない
- `api.rs:13` の「定跡は数百 MB」は `research/findings/L3-book-solved.md:213-215`（公開の無償定跡は圧縮後 0.78〜72.6MB）と食い違う。この数字は #91 で丸読みか on-the-fly かを決める位置にある
- `open_reader` の doc が「reader を作る」だが成功経路が無い。返るエラーの条件も列挙されていない。拡張子判定を実在確認より先にする順序依存はテストの doc にしか書かれていない

→ 全て直す。`TODO(#91)` を置く。

### F-13 [MEDIUM] 巨大ファイルの上限・進捗・中断が無い

rust / robustness が指摘。拡張子さえ合えば 20GB のファイルでも reader に渡り、#91 以降で OOM になる。`search` には `cancel_search` と進捗イベントの前例がある。

→ **今回は見送る。** 理由は F-12 と同じ資料。`research/findings/L3-book-solved.md:213-215` によれば公開定跡は展開後でも数十 MB 台で、いま置ける上限値（2GB / 4GB）はどれも根拠が無い。根拠の無い定数は、後から「なぜこの値か」を誰も答えられないまま残る。**実際に確保を行うのは #91 の reader なので、上限はそこで実測に基づいて決める。**進捗・中断も、読み込みループが存在してから設計する。issue に送る。

### F-14 [MEDIUM] `lookup_book_moves` の検証順序に根拠が無い

comment が指摘。`normalize_sfen` を先に呼ぶので、ハンドルが閉じられていて SFEN も壊れている入力では `InvalidSfen` だけが返り、フロントは再オープンの導線を作れない。`reader.rs` では同種の順序をテストで固定しているのに、ここは偶然に見える。

→ 直す。ハンドルを先に見る。順序を純関数に切り出してテストで固定する。

### F-15 [MEDIUM] 公開 API の doc の有無がばらついている

comment が指摘。`BookErrorCode` は8個中2個、`BookMove` は `depth` だけ、`BookInfo` は全フィールド、`BookReader::format`、`BookError` 型と2つのコンストラクタが裸。特に `position_count` は「何を1と数えるか」「on-the-fly で開いた時点で確定するか」が決まらず、#91 で意味が割れる。

→ 直す。

## 重複・矛盾した所見

- F-01 は4体全員が独立に挙げた。robustness は BLOCK、他は HIGH。**最も重い所見として BLOCK を採る**
- F-04 について architecture は「`search/sfen_position.rs` と統合すべきでない。定跡のキーはファイルの綴りと一致する必要があり、`PartialPosition` を経由して再シリアライズすると綴りがズレる」とし、robustness は「検査を足せ」とした。**矛盾しない。** 統合はせず検査だけを足す、で両立する。ただし持駒の並びの正規化については、architecture が「綴りを素通しする点を doc に明記するか正規化する」と両論を残している。**正規化を採る。** reader 側も同じ関数でキーを作る契約にすれば綴りのズレは起きず、フロントが別経路で作った SFEN との取りこぼしを防げる
- F-02 の直し方で robustness は `InvalidType`、rust は「専用の文言」を提案。`FsErrorCode` に `InvalidType` がある前例に揃える
- F-13 は rust と robustness が別の上限値（2GiB / 4GB）を挙げた。**値が割れていること自体が、いま決める根拠が無いことの証拠**と読む

## 見ていない範囲

- 実機での動作確認はしていない。`open_reader` は必ず `Err` を返すので、`register` 以降の経路は本番では一度も動いていない
- フロント側（`src/`）。`invoke("open_book")` の呼び出しは0件で、エラーごとの復帰導線は #91 以降に別途レビューが要る
- 実際の定跡ファイル（.db / .bin / .sbk / .ybb）を用いた確認。#91 の fixture で行う
- やねうら王 `source/book/book.h` の一次資料。`types.rs` の「book.h:51-68」は `research/findings/L3-book-solved.md:126` の記録と一致することまでは確認したが、行番号そのものは未確認
- `cargo audit`。dashmap 6.1.0 の脆弱性は見ていない
- `tauri::async_runtime::spawn_blocking` が panic を `Err` に変換するか `resume_unwind` するかは tauri のソースまで降りていない

## lint / hook で強制できるもの

- **`BookKey` newtype（F-05）** — 型検査そのものが強制になる。今回の所見で唯一「機械化がそのまま修正になる」もの
- **`mod` の private 化（F-10）** — 可視性が Rust 側で依存方向を守る唯一の手段。TS 側の `no-restricted-imports` に相当するものが src-tauri には無い
- `src-tauri/src/book/` 配下での `.is_file()` / `.exists()` 禁止（F-02）— clippy に該当 lint が無いので grep hook でしか止まらない。**ただし two-strikes rule に従い、1回目の今回はルールを足さずテストで固定する**
- `#[tauri::command]` の `mod.rs` re-export と `lib.rs` の `generate_handler!` の突き合わせ — CLAUDE.md の「Tauri コマンドを追加 → lib.rs の登録も必ず更新する」を機械に移せる箇所。今回は守られている
- F-01 / F-04 / F-08 / F-12 は機械では拾えない。テストとレビューで見るしかない

## 次ラウンドの対象

直すもの: F-01〜F-12, F-14, F-15。
見送るもの: F-13（issue へ。理由は所見に記載）。

---

## 修正結果

| 所見 | 結果 | コミット | 備考 |
| ---- | ---- | -------- | ---- |
| F-01 | 直した | `86f7664` | `moves` と余分なトークンを `InvalidSfen` に。誤挙動を固定していたテストを拒否側へ書き換え |
| F-04 | 直した | `2c64de6` | 段数・列数・駒文字・持駒の書式を検査。持駒の並びを畳む |
| F-05 | 直した | `9a9bfb7` | `BookKey` newtype。`normalize_sfen` → `to_book_key` に改名 |
| F-02 | 直した | `59228df` | `fs::metadata` に置換。`PermissionDenied` / `InvalidType` を追加 |
| F-09 | 直した | `e33680a` | trait doc に禁止事項。`BookError::from_io` を追加 |
| F-11 | 直した | `afc52fb` | `OpenBook` → `BookSession` |
| F-06 | 直した | `f5d29ca` | `close` が本体を返し、Drop を blocking プールへ |
| F-03 | 直した | `0fe383a` | `list_books` / `close_all_books` を追加 |
| F-07 | 直した | `a5e70f7` | 絶対パス・NUL を検査。実体のパスで登録 |
| F-14 | 直した | `aa15de7` | ハンドルを先に見る。順序を純関数に切り出してテストで固定 |
| F-08 | 直した | `6499170` | 失敗経路に `log::warn!` |
| F-10 | 直した | `65d8948` | サブモジュールを private にしてファサードだけ公開 |
| F-12 | 直した | `a12bb99` | 「数百 MB」を撤回。close の理由を `get` 側へ。`TODO(#91)` |
| F-15 | 直した | `e523317` | `position_count` の意味など、公開 API の doc を補完 |
| F-13 | 見送り | — | → issue #197。上限値に根拠が無いため、実際に確保を行う #91 で実測に基づいて決める |

提案どおりに直さなかったもの:

- **F-04 の持駒の並び** — architecture は「素通しを doc に明記する / 正規化する」の両論だった。
  **正規化を採った。** reader 側も同じ関数でキーを作る契約にすれば綴りのズレは起きず、
  フロントが別経路で作った SFEN との取りこぼしを防げる。契約は `to_book_key` の doc に書いた
- **F-03 のページ破棄フック** — rust は `on_page_load` / `WindowEvent::Destroyed` での自動 clear と
  同時オープン数の上限（8本）も提案したが、**列挙と一括解放だけに留めた。** 自動 clear は
  「フロントが意図して開いたままにしている」場合に黙って閉じる副作用があり、上限値は F-13 と
  同じく根拠が無い。回収経路が1本あれば孤児は解消できる
- **F-09 の `join_error` のコード** — robustness は「`Unknown` のままでよいがメッセージを利用者向けに」
  とした。そのとおりにし、「スレッドごと落ちた」を「異常終了した」に変えた

自分が作った退行: 無し（下記の変異で確認）。

## 変異による確認

書いたテストが実装を固定できていることを、実装を壊して確かめた。**12件すべてでテストが落ちた。**

| # | 壊した箇所 | 落ちたテスト |
| - | ---------- | ------------ |
| M1 | SFEN キーから手数を落とさない | `drops_the_move_number` ほか |
| M2 | 知らないハンドルの close を成功させる | `close_rejects_an_already_closed_handle` |
| M3 | 拡張子を小文字化しない | `extension_match_ignores_case` |
| M4 | 閉じたハンドルを配り直す | `handles_are_distinct_even_for_the_same_path` ほか |
| M5 | ファイルの実在を形式判別より先に見る | `reports_the_extension_before_looking_at_the_file_system` |
| M6a | 局面の後ろの余りを黙って捨てる | `rejects_a_position_with_moves` / `rejects_trailing_tokens_after_the_position` |
| M6b | 手数の位置の `moves` を見ない | `rejects_a_position_with_moves` |
| M7 | 盤面の段数を見ない | `rejects_a_broken_board` |
| M8 | 持駒の並びを畳まず素通し | `hand_spelling_does_not_change_the_key` ほか |
| M9 | 相対パスを通す | `rejects_a_path_that_cannot_be_resolved` |
| M10 | SFEN をハンドルより先に見る | `reports_a_closed_handle_before_a_broken_position` |
| M11 | `close_all` が map から外さない | `close_all_drops_every_reader` |
| M12 | ディレクトリを NotFound に潰す | `reports_a_directory_as_a_wrong_kind` |

## 検証

`npm run verify:rust`（fmt --check / clippy --all-targets -D warnings / cargo test --locked）を通した。
book のテストは 39件。TS 側は触っていない。

なお、`verify-gate.sh` が `CLAUDE_PROJECT_DIR` を優先してワークツリーではなく元のチェックアウトを
検証していたため、この作業の途中まで**ゲートは別のツリーを見ていた**。`afc52fb` で
`git rev-parse --show-toplevel` を優先するよう直してある。
