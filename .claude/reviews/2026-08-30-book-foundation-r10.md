# レビュー book-foundation ラウンド10

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/` 全7ファイル、`src-tauri/src/lib.rs` の book 登録部分、`.claude/hooks/verify-gate.sh` / `verify-gate.test.sh`
- 走らせた reviewer: rust / robustness / comment
- 前ラウンド: `-r1.md`〜`-r9.md`（計127件）

## 所見

### O-01 [HIGH] `HandCount` newtype が、doc の約束を1つも強制していない（N-07 の直し方が誤り）

robustness と comment の2体。`sfen.rs:183-207`。
**タプル構造体のフィールドは同じモジュールからは見える。** `HandCount` も `normalize_hands` も
`PieceCounts::add_many` も `sfen` の直下にあるので、「検査を通らずに作れない」が成り立つのは
`sfen.rs` の外だけ。**守るべき唯一の場所に保護が掛かっていなかった。**

証拠は同じファイルの中にあった。テストが `HandCount(1)` と直接構築していて、それが通っている。

R9 はこれを「文言に依存したテストより強い」として文言依存のテストを取り下げたので、
「検査は数え上げより先」を固定するものが**コード本文以外に何も無い**状態になっていた。

robustness の言い方: 「型が止める」という誤った保証は、止まらなかったときに誰も疑わないぶん、
保証が無い状態より悪い。

### O-02 [HIGH] git の alias（`git ci`）が、deny も検証もされずに素通しする

rust。`verify-gate.sh:64`。**この環境の global config に `alias.ci commit` が実在する。**
hook を payload から end-to-end で走らせて `exit 0`（deny も検証も無し）を確認済み。

`.rs` を書き換えて `git ci -m "fix: ..."` と打てば、clippy も cargo test も通さずにコミットが入る。
M-02 / N-02 は「サブコマンドの綴りを語彙に足す」形で塞いだが、**alias は利用者の設定で無限に増える
名前空間なので、語彙を数えて足す方向では原理的に閉じない。**

### O-03 [MEDIUM] `tauri.conf.json` / `capabilities/*.json` / `rust-toolchain.toml` が分類表に無い

rust。`build.rs` と `lib.rs` の `generate_context!` がコンパイル時に読むので、
壊すと `cargo clippy` が確実に落ちる。N-01（`.scss`）は「その拡張子単独には他に検査が無い」場合 だったが、
ここは**検査は存在するのに表に載っていない**。capabilities はこのアプリで唯一の権限境界。

### O-04 [MEDIUM] 引用の打ち切りが `to_book_key_in_file` にしか無く、コマンド経路が覆われていない

rust。`sfen.rs:78-83`。`lookup_book_moves` → `resolve_lookup` → `to_book_key(&input.sfen)` は
`to_book_key_in_file` を通らない。`input.sfen` は IPC から来る任意長の `String` なので、
局面欄に長い文字列を渡された失敗1回で `message` がそのままログへ流れ、
**200KB / KeepOne のログが埋まって以前の記録が消える。** N-06 が塞いだのと同じ失敗が入力側に残っていた。

打ち切る位置も遅く、`to_book_key` が組み立て終わった文字列を受け取ってから縮めている。

### O-05 [MEDIUM] `GATE_COMMIT_VERB` の doc が `commit` について逆のことを言っている

comment。`verify-gate.sh:59-64`。N-08 の直しが主語を分けずに全体を否定側へ振っていた。
`commit` が作るツリーは手元の index と作業ツリーとして**存在する**ので、検証は掛かる。
語彙は「deny 判定の入口」と「検証の起動条件」を兼ねているので、
doc を信じて `commit` を別扱いに切り出すと検証そのものが起動しなくなる。

### O-06 [MEDIUM] 冒頭の対応表が実装から遅れている（`.scss` / `package-lock.json` が無い）

comment。`verify-gate.sh:4-8`。`.scss` を素通しさせないことは N-01 で HIGH として直した性質なのに、
冒頭だけを読んだ人は「`.scss` は docs と同じ素通し」と理解する。
テスト側の「表は2つ」も、表を足した人が更新しなかった同じ形の取り残し（実際は4つ）。

### O-07 [MEDIUM] `MESSAGE_EXCERPT_CHARS` の doc が定数に付いていて、120 の根拠が無い

comment。`sfen.rs:172-181`。テストは無関係な `< 300` を見ているので、
120 を 5 に縮めても 2000 に広げても緑のまま。後者はログを埋める失敗が戻る。

## 重複・矛盾した所見

- O-01 は robustness（HIGH）と comment（MEDIUM）が独立に同じ場所を指した。**最も重い側を採る**
- O-01 / O-04 / O-05 / O-06 / O-07 は全て**前ラウンドの修正そのものに対する指摘**。
  R9 で足した5つのうち4つに問題があった
- rust は `gate_strip_quotes` を十数種類の綴りで実測し、**素通し側へ落ちるものは見つからなかった**
  （見つかったのは全て過剰 deny 側で、これは対象外）と明示。
  `git status --porcelain -z` のリネーム/コピー2レコードの読み取りも所見なしと明示している

## 見ていない範囲

- フロント側（`src/`）。呼び出しは R1 から0件のまま
- 実際の定跡ファイルでの動作。`open_reader` は今も必ず `Err`
- やねうら王 `source/book/book.h` / `Position::sfen()` の一次資料
- Windows / Linux の実行時挙動。実測は macOS のみ
- hook の payload の `.cwd` が Bash ツールの持続する作業ディレクトリを追随するか
- comment は `dashmap` が `Cargo.toml` で 6.1.0、`Cargo.lock` で 6.2.1 であることに気づいたうえで、
  `DashMap::remove` の契約は変わっていないと判断して所見にしなかった
- 意図して見送っている5件は再提出されていない

## lint / hook で強制できるもの

- **`HandCount` を内側モジュールへ隔離する** — O-01。**これだけが機械で強制できる。**
  テストが `HandCount(1)` と書けなくなること自体が、塞がった証拠になる
- **alias を git 自身に引かせる** — O-02。人が語彙を書き足す形では次の alias に必ず置いていかれる。
  ただしテストは fixture で固定する（実際の設定に依存させると、alias を持たない CI で常に緑になる）
- **分類表に `tauri.conf.json` / `capabilities/*.json` / `rust-toolchain.toml`** — O-03
- **`to_book_key` を直接呼ぶ長さのテスト** — O-04。`to_book_key_in_file` 経由だけでは片側しか見ていない

## 修正結果

| 所見 | 結果 | コミット |
| ---- | ---- | -------- |
| O-01 | 直した | `8a1b5f7` |
| O-04 | 直した | `8a1b5f7` |
| O-07 | 直した | `8a1b5f7` |
| O-02 | 直した | `2286d6f` |
| O-03 | 直した | `2286d6f` |
| O-05 | 直した | `2286d6f` |
| O-06 | 直した | `2286d6f` |

提案どおりに直さなかったもの:

- **O-01 の (b) 案（doc の主張を下げる）** — 採らなかった。`HandCount` を置いた理由が
  「型で強制する」だったので、強制しないなら型を置く意味が無い
- **O-06 の直し方** — comment は「冒頭の表に `.scss` と `package-lock.json` を足す」も挙げたが、
  **列挙そのものを消して `gate_kinds_for_path` を唯一の出典にした。** 2箇所に書けば必ず片方が腐る、
  というのが comment 自身の指摘でもある

`GATE_EXTRA_VERBS` は「設定されているか」で見る（空を設定したら alias 無しの意味）。
最初に「空でないか」で書いたところ、alias 無しのケースが実設定の `ci` を拾ってテストが落ちた。

## 検証

`npm run verify:rust` を通した。book のテストは 55件。
`bash .claude/hooks/verify-gate.test.sh` も通した（判定 36 / alias 4 / 綴り 5 / 宛先 32 / 分類 14）。
hook を payload から end-to-end で走らせ、`exit 0` になることも確認した。
