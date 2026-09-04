# レビュー book-to-main ラウンド21

- 日付: 2026-09-04
- 範囲: r20 の所見3件を直した分（`git diff 3ac79afe HEAD`）＋**未確認範囲の掘り起こし**
- 走らせた reviewer: comment / rust / oss-hygiene
- 対象コミット: `833021ee`
- 前ラウンド: `.claude/reviews/2026-09-04-book-to-main-r20.md`

所見 **6件**（BLOCK 0 / **HIGH 1** / MEDIUM 5）。
推移は 22 → 18 → 23 → 10 → 12 → 7 → 5 → 4 → 6 → 8 → 9 → 9 → 6 → 7 → 7 → 3 → 3 → 2 → 2 → 3 → **6**。

**r20 で「差分の外」が当たったので、このラウンドは範囲を広げた** ——
`src-tauri/src/book/` の**振る舞い**（doc の主張ではなく実装そのもの）と、
同じ形の doc が他に無いかの掃討。

**HIGH は実装の欠陥。** 20ラウンド doc を突き合わせてきたが、
**振る舞いを見たのはこのラウンドが初めてで、1本目で当たった。**

issue へ送るものは無かった。

---

## 所見

### AM-01 (HIGH, 1人が再現): リンク先と実体のパスが、制御文字の関門を通らずに message へ入る

`path` は必ず `with_path` → `truncate_path` を通るが、**`message` 側には関門が無く、
ファイルシステム由来のパスがそのまま入っていた。** 3箇所 —— リンク先の注記、実体の注記、
形式の食い違いの文面。

reviewer がスクラッチの独立プログラムで再現:

```
[cmd] open_book failed: NotFound: 定跡ファイルが見つからない（…（リンク先 /var/…/gone
[cmd] open_book path=/etc/passwd.db） (/var/…/link.db)
--- 行数 = 2 ---
```

`error.rs` は関門の理由を「`\n` を含む値がそのまま通ると1回の `log!` が2行になり、
後ろの行が本物のコマンドログと見分けが付かなくなる」と明記していて、
`control_characters_cannot_forge_a_log_line` が**呼び出し側が渡した綴りについてだけ**
それを固定していた。**リンク先と実体は利用者が打っていないので、同じ関門が要る。**
`canonicalize` は macOS で `/var` → `/private/var` を返すので、実体の枝は symlink が
無くても日常的に踏む。長さの打ち切りも掛かっていなかった。

- 結果: 対応済み `a8b39e6a`（`annotate` の第2引数を `&Path` に限り、関門を関数の中に閉じた。
  `&str` を取ると呼び手が組み立てた文字列を渡せてしまい、次に注記が増えたときに取り残す。
  リンク先の枝を見るテストを足し、**変異を当てて落ちることを確認した**）

### AM-04 (MEDIUM, 1人): 後片付けを `expect` にしない決まりを、`open.rs` が6箇所で破っている

`reader.rs`（6箇所）と `yaneuraou_db.rs`（1箇所）は `let _ =` で決まりどおり。
**`open.rs` だけが6箇所とも `expect`、しかも全て `assert` より前。**
`remove_dir_all` が失敗したとき、落ちるのは「消せない」で**`open_at` が何を返したかは
画面に一切出ない。** `test_paths.rs` はまさに worktree を並べる進め方を前提に書かれている。

- 結果: 対応済み `b30c89ab`

### AM-02 (MEDIUM, 1人): `format_size` の doc が、意図的に渡していない値を端点に挙げている

「行長（4 KiB）から**展開の上限（7 GiB）**まで」の後者が偽。`MAX_EXPANDED_BYTES` を
渡す呼び先は1つも無く、**渡さないことは同じ合流の中で明示的に決めてある。**
検算する人は呼び先を探して見つけられず、復元しようとすると決まりを破る。

- 結果: 対応済み `7de8b82f`（実際に通る最大へ。写している側の assert も定数へ寄せた）

### AM-03 (MEDIUM, 1人): `max_file_bytes: None` を doc は許し、テストは panic で禁じている

`.bin` を on-the-fly で読む reader を足す人は doc に従って `None` と書く。
それは正しく動くのにテストが落ち、**メッセージが「書き忘れた」と読めるので、
doc が許した設計を自分のミスだと判断する。**
守りたかった「書き忘れ」はそもそも起きない（構造体リテラルなので省くと止まる）。

- 結果: 対応済み `06ecd52a`（実質見ている「値が現実的な範囲か」に名前と doc を揃えた）

### AM-05 (MEDIUM, 1人): `main にあるか: **ある。**` が、いまの main の現物と違う

**`f07f2f3f`（r20 の HIGH の直し）が行き過ぎていた。** `main` にも `origin/main` にも
`src-tauri/src/book/` は無い。**いま book.md を開いた人は `git switch main` で探して
見つからない。** r20 の AK-01 の裏返し（無いものを「ある」）。

在庫表を丸ごと削ったことで、**book.md からブランチ名が1つも無くなっていた** ——
`docs/spec/README.md` が自分で「どのブランチに何があるかを書く」と定めているのに。

- 結果: 対応済み `a863cb35`（「無い。この PR で入る」＋日付とハッシュへ戻した）

### AM-06 (MEDIUM, 1人): 子 issue 表と着手順が、`.db` の reader をまだ「別窓で進行中」に置いている

`f07f2f3f` は在庫表を削ったが、**同じ主張を別の言い回しで書いた2箇所を残した。**
冒頭と3画面下で逆のことを言う形で、**素直に読むと「まず `.db` の reader を書く」になり、
2330行を二重に書き始める。**

- 結果: 対応済み `a863cb35`（AM-05 と同じコミット。同じ文書の同じ事実なので分けなかった）

---

## 重複・矛盾した所見

- **6件とも1人ずつ。** 3人が別々の範囲を見たので重なりが出ていない
- **AM-05 / AM-06 は、r20 の直しが作った。** 片方は行き過ぎ、片方は取り残し ——
  **1つの文書を直すときに、同じ事実を書いた箇所を数えていない**という、
  この PR が8ラウンド追ってきた形そのもの
- **AM-01 / AM-02 / AM-03 / AM-04 は、20ラウンド誰も見ていなかった範囲から出た。**
  r20 の AK-01（`docs/spec/`）と合わせて、**「差分を範囲にする」やり方の穴**が2ラウンド続けて出ている
- 所見の水増しは無かった。3人とも「確認して所見が無かったもの」を明記していて、とくに:
  - **rust が `api.rs` の並行性を通しで見た** —— ブロッキング IO はすべて `spawn_blocking` の中、
    `unwrap()` / `panic!()` はコマンド経路に無い、`DashMap` の `Ref` を跨いだ map 操作も無い
  - **`session.rs` / `types.rs` / `validate_book_path` / `resolve_book_path` の doc も
    すべて実装と一致**（ハンドルの単調性、TOCTOU の扱い、`open_reader` が返す7種別の過不足）
  - **oss-hygiene が `docs/spec/` 全19本と `docs/PREMISES.md` / `OPEN-QUESTIONS.md` /
    `OPERATING-MODEL.md` / `IDEAS.md` / `README.md` / `decisions/` を掃討**し、
    この合流でマージ後に偽になる doc が他に無いことを確認した

## この PR の外で観測したこと

**`origin/main` が1コミット進んでいる**（`a4b9cef9` 対局の Rust API、#385。107ファイル・28k行）。
`git merge-tree` で試すと**12ファイルが競合する** —— `verify-gate.sh` / `CLAUDE.md` /
`CONTRIBUTING.md` / `docsSourcePaths` / `ratchetIndex` / `lib.rs` など、
**この PR が重く触ってきたところと正面から重なる。**

comment はこれを根拠に「`docs/spec/README.md` の対局の行と `game-play.md` が
`origin/main` の現物と違う」を挙げたが、**この合流のツリーには #385 が入っていないので、
いまのブランチに対しては真。** 取り込むかどうかは PR の出し方の判断なので、
**このラウンドの所見にはせず、ユーザーへ確認する。**

## 見ていない範囲

- #386 / #342 / #290 / #351 へ送ったもの（再掲しない前提）
- `user_book1.db` の実測3行とピーク確保の実測（現物がリポジトリに無い）
- `sfen.rs` の検査本体（`normalize_board` / `normalize_hands` / `PieceCounts::validate`）
- `yaneuraou_db.rs` のテストモジュール1300行の個々の主張
- `#283` / `#91` の issue 本文（`state` と `title` しか取っていない）

## lint / hook で強制できるもの

- **AM-04 は機械で止まる。** `src-tauri/src/book/` に対して `remove_dir_all(...)` の後ろに
  `.expect` / `.unwrap` が続く綴りを禁じる走査ラチェット
- **AM-01 は型で止まった。** `annotate` の第2引数を `&Path` に限ったので、
  組み立てた文字列を渡す綴りがコンパイルを通らない
  （`ValidatedBookPath` / `HandCount` / `BookKey` でこのリポジトリが既に3回使っている手）
- **AM-05 / AM-06 の型**（`main にあるか` の欄と現物の食い違い）は r20 で挙げた検査で止まる。
  ただし `docs/spec/*.md` は `gate_kinds_for_path` がどの種類にも分類していないので、
  **検査を足すなら `case` と `verify-gate.test.sh` の期待値を同時に足す必要がある**

いずれも #351 の候補で、このラウンドでは足さない（案A の方針）。
