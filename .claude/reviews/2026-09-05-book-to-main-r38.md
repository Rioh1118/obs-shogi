# レビュー book-to-main ラウンド38

- 日付: 2026-09-05
- 範囲: **PR の本体**（`git diff origin/main...HEAD -- src-tauri/src/book/ src-tauri/src/lib.rs docs/ CLAUDE.md CONTRIBUTING.md`）
- 走らせた reviewer: rust / oss-hygiene
- 対象コミット: `7ab7953a`
- 前ラウンド: `.claude/reviews/2026-09-05-book-to-main-r37.md`

所見 **1件**（BLOCK 0 / HIGH 0 / MEDIUM 1）。
推移は 22 → … → 11 → 8 → 8 → **1**。

**14ラウンド続けて HIGH 0。**

**このラウンドで向きを変えた。** r26〜r37 の所見は
`.claude/reviews/` の報告書と `commentHistory.test.ts` にほぼ集中していて、
**PR の本体（`src-tauri/src/book/` 10ファイル・5,557行）は長く「見ていない範囲」のまま**だった。
本体に当て直した結果、**Rust 実装は所見0、doc は1件。**

---

## 所見

### BJ-01 (MEDIUM, 1人が実測): 「`src-tauri/tests/` は全部ソース走査」が、同じ PR の `CLAUDE.md` と正反対

`search.md` は

> `src-tauri/tests/` にあるのは規約の検査（**crate をリンクせず**、ソースを文字列として読むもの）
> だけで、状態機械そのものを回すテストは無い。

と書くが、**`engine_timeouts.rs` は先頭で crate を4回リンクしている**（12本のうちこの1本だけ）。

**同じ PR の `CLAUDE.md` は「大半はソースを走査するラチェット」「例外は `engine_timeouts.rs`」**と
正しく書いていて、2つの doc が正反対。旧文（`root_guard.rs` だけ）を一般化するときに
例外を1つ取りこぼしている。

**`search.md` を先に読んだ人は「`tests/` から crate は触れない」という前提を持つ**ので、
上限どうしの関係を固定したくなったとき、既にある `engine_timeouts.rs` を探さずに2本目を作る。

- 結果: 対応済み `87db3cfc`

---

## 重複・矛盾した所見

- **1件のみ。** rust は所見0
- **向きを変えたことが、このラウンドの結論。** r26〜r37 は
  「報告書の記述を直す → その直しが次ラウンドの所見面になる」の自己増殖に入っていて、
  **12ラウンドで本体に掛かる所見は1件も出ていない。**
  本体に当てると Rust 0件 / doc 1件で、**合流を止める理由は無い**
- **私の報告書自身に、範囲の取り違えが1つあった** ——
  `docs/spec/screens/` の13面を35ラウンド「見ていない範囲」に挙げ続けていたが、
  **この PR は1ファイルも持ち込んでいない**（`origin/main` の #376 由来）。
  この PR は UI を1行も足していないので、**PR による陳腐化は構造上起きない**
- 所見の水増しは無かった。2人とも「確認して所見が無かったもの」を明記していて、とくに:

### Rust 実装（所見0）

- **非テスト経路の `unwrap` / `expect` / `panic!` は3箇所だけ**で、
  どれも型か制御フローで失敗しえない。`let _ =` は `write!(&mut String)` の2件のみ
- **`BookError` は `with_path` を唯一の関門にしてあり**、`annotate` も `annotate_line` も
  `truncate_path` / `excerpt` を通る。予算ごとの書き分けによる取り残しが構造的に起きない
- **`Arc<BookSession>` を持ち出す口は `get` だけ。** 取った `Arc` は必ず
  `spawn_blocking` へ move するので、**最後の参照になっても Drop は blocking プールで走る**
- **保持されるロックは `DashMap` のシャードだけ。**
  `.await` を跨いで持つガードは1つも無く、2つ以上を同時に取る箇所も無い。
  `close_all` は「iter を握ったまま remove」を避けている
- **`ValidatedBookPath` のフィールドが内側モジュールに閉じている**ので `open_at` を迂回できない。
  symlink の張り替えは、形式を利用者の綴りから決めて `open_reader` に決め直させない形で閉じる
- **FIFO・キャラクタデバイスは `InvalidType` に落ちる** ——
  `/dev/zero` や名前付きパイプで読みが返らなくなる経路が無い
- **上限3段は `support()` が reader と1つの構造体に束ねている**ので、
  形式を足したときに上限だけ書き忘れるとコンパイルが止まる
- **SFEN の上界194を独立に導き直して一致**（盤面89＋成駒、持駒 2×(38−盤上)、
  前置き・手番・10桁の手数）。先頭ゼロと `+` の拒否がこの上界を支えていることも確認
- **`declared_count` を確保に使っていない**（`# NOE:99999999999` で `with_capacity` を
  呼ぶ経路が無い）
- **変異13件を当てて全部殺された** —— 境界の向き4つ、`resolve_lookup` の順序（両向き）、
  `HAND_PIECES` の逆順、`splitn` → `split_whitespace`、畳みの無効化、
  `flush` の移し替え撤去、`held_positions` から `current` を落とす、ほか

### doc（1件以外）

- **`book.md` の主張は全て現物と一致** —— `support()` が `.db` にだけ `Some` を返し、
  残る3つは `UnsupportedFormat`。**引用してある文面も `format!` と `display_name` の
  合成と一致。** 「未対応が先、大きさが後」も現物どおり
- **コマンド6本は `lib.rs` に登録済み。7本目も登録漏れも無い**
- **`book-key-failures.md` の G0〜G11 が `sfen.rs` の評価順と1つずつ一致**し、
  表が名指すテスト12本は全て実在。名前を出していない `✓` も踏まれている
- **`yaneuraou-db-parse.md` の30セル全てに裏付けがある**
  （この表は Rust 側のセル検査の対象外なので手で当てたもの）。
  `MAX_LINE_BYTES` / H4 が `sfen_lines` と比べること / H7 が `warn` だけ /
  `buffered` の `debug_assert!` まで一致
- **`verify-gate-decision.md` の `✓` は `verify-gate.test.sh` に実在**
  （行を跨ぐ綴り、`/usr/bin/git`、引用の中の `git commit`、alias の再帰解決まで）
- **衛生は問題なし** —— バイナリ差分0、`/Users/` や秘密情報の追加0、
  **帰属3件（GPL-3.0 / MIT / MIT）が `docs/state-transitions/` の
  GitHub リンク全部と過不足なく一致**。逐語のコード転記は無い

## 見ていない範囲

- #386 / #342 / #290 / #351 へ送ったもの（再掲しない前提）
- **`.claude/reviews/` の報告書**（このラウンドは意図的に外した）
- **外部リポジトリの一次資料** —— やねうら王 `v9.40` の行番号、ShogiHome `v1.29.0` のパス。
  ネットワークと実物が要る
- **`user_book1.db`（470.3 MiB）での実行** —— `REAL_BOOK_BYTES` /
  `BYTES_PER_POSITION` などの較正値が実測と合っているか。
  **doc 自身が「機械では守れない」と書いている**
- **Windows 経路** —— `#[cfg(unix)]` の symlink テストは macOS でしか走っていない
- **フロント側に定跡の呼び手が無い**ので、`BookMove.count: Option<u64>` が
  JS の数値精度を超えたときの挙動など、境界を跨いだ振る舞いは未確認
- `docs/spec/screens/` 13面の**記述内容**と現物 UI の突き合わせ
  （**この PR の範囲外**。参照解決だけは回して未解決0件）
- `src-tauri/tests/` の新規3ファイルと `engine/game/` の2行

## lint / hook で強制できるもの

- **BJ-01 は機械で拾えるが、勧めない** —— `^use app_lib` を持つ本数を数えて
  doc に例外が書かれていることを要求する形になるが、
  **「doc の散文を読む」検査**で、`state_transition_cells.rs` が明示的に避けている方向
- **安く塞げるものが1つある**（ただし `origin/main` 側の作業） ——
  `docsSourcePaths.test.ts` の走査を `docs/spec/screens/` へ広げること。
  13面のバッククォートのパスは1件を除いて全部現物を指しており、
  その1件（`src-tauri/file_system`、正しくは `src-tauri/src/file_system`）は
  **`origin/main` が元から持っている誤り**
