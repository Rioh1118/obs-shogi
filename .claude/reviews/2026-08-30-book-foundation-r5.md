# レビュー book-foundation ラウンド5

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/` 全7ファイル、`src-tauri/src/lib.rs` の book 登録部分、`.claude/hooks/verify-gate.sh` / `verify-gate.test.sh`
- 走らせた reviewer: rust / robustness / comment
- 対象コミット: `2f8a3b4`（R4 の報告書まで）
- 前ラウンド: `-r1.md`（15件）/ `-r2.md`（17件）/ `-r3.md`（12件）/ `-r4.md`（10件）

## 所見

### J-01 [HIGH] ゲートがまだ別のツリーを検証する。`(cd X && …)` / `pushd` / `env -C` / commit 2つ

3体とも指摘。`verify-gate.sh:56-72`。実測:

```
(cd <other> && git commit -m x)        -> <here>   ← 別のツリー
pushd <other> && git commit -m x       -> <here>   ← 別のツリー
env -C <other> git commit -m x         -> <here>   ← 別のツリー
cd <here> && git commit -m a && cd <other> && git commit -m b -> <here>
```

先頭のトリムが空白だけなので `(` が残り `cd\ *` に当たらない。`pushd` は綴りが違う。
`prefix` を `%%`（最初の一致）で取っているのに `gate_commit_call` は `tail -1`（最後の一致）を返す。

**I-01 と同じ「検出側の表に有る綴りが決定側の表に無い」構造がそのまま残っていた。**
検出側は `(` を先行文字として明示的に許している。

→ 直す。robustness の提案どおり、**素通しになる綴りを1つずつ足すのを止め、判別できない綴りは deny に倒す。**

### J-02 [MEDIUM] 引用符付きの `cd` が、従いようのない案内でコミットを止める

rust。`cd '<other>' && git commit` は空を返して deny になり、文言は
「対象のワークツリーへ cd してから実行すること」。利用者は**まさに cd してから実行している。**
空白を含むパスでは引用が必須なので、この綴りを避けられない。I-02 と同型。

→ 直す。引用符を剥がす。展開が要る綴り（`$VAR` / `~`）だけを deny にし、文言もそれに合わせる。

### J-03 [BLOCK] `open_at` の doc「実体は message とログに残る」が、今日通る唯一の経路で成り立っていない

comment（BLOCK）/ rust / robustness。`api.rs:47-49` と `api.rs:90`。
`open_reader` が返す message は実体のパスを含まず、`path` は `with_path` で要求時の綴りに**上書き**される。
`logged` が出すのは `Display`（code + message + path）なので、**ログにも残らない。**

`~/books/latest.db -> /Volumes/ext/apery.db` で実体だけが読めないとき、
許可すべきファイル名がフロントにもログにも一度も現れない。doc が例に挙げている「権限が無い」が、
まさに実体を失う枝。#91 まで100%通る `UnsupportedFormat` でも同じ。

→ 直す。`canonical != path` のときだけ message に実体を添える。

### J-04 [MEDIUM] `join_error` の案内が `open_book` 経路では成立しない

rust / comment。`api.rs:38`。この `spawn_blocking` は `register` の**前**なので、
panic した時点でハンドルは存在しない。「この定跡を閉じてから開き直すこと」と言われても閉じる対象が無く、
`list_books` にも出ない。#91 で panic が最も起きやすいのは `open_reader` の中＝この経路。

→ 直す。案内を呼び出し側から渡す。

### J-05 [MEDIUM] `BookReader::format` / `position_count` が async ワーカから呼ばれるのに、契約が無い

rust。`api.rs:36-42`, `session.rs:50-58`。`open_at` は blocking プールに逃がしてあるのに、
その戻り値を使う `register` は async ワーカ上で走り、そこで `reader.position_count()` を呼ぶ。
trait の「実装が守ること」は3項目とも `lookup` について。

`BookInfo::position_count` の doc は値の意味しか決めていないので、#91 の実装者が
「呼ばれたときにヘッダを読む」形で書いても契約違反にならない。R1 F-06 / R3 H-08 が close 側で潰した
失敗と同じものが、open 側の別メソッドに残っている。

→ 直す。rust が挙げた「型で閉じる」側を採る。

### J-06 [MEDIUM] `InvalidHandle` のメッセージだけ、次に何をすればよいかが無い

robustness。`session.rs:136-141`。`state.get` は `lookup_book_moves` と `get_book_info` の
両方から呼ばれるので、**利用者が最も多く見る定跡のエラー**。ハンドルの数値はフロントの内部値で
利用者には意味が無い。めったに起きない `join_error` の方に復帰操作が書いてあり、案内の水準が逆。

→ 直す。

### J-07 [MEDIUM] symlink のテストが `std::os::unix` を無条件に使っている

robustness。`api.rs:307`。`release.yml` に Windows があるのに、Windows で
`npm run verify:rust` がコンパイルエラーになり、**book と無関係な変更でもコミットできなくなる**
（ゲートが `verify:rust` の失敗で止めるため）。CI の quality job は ubuntu 1本なので検出されない。

→ 直す。`#[cfg(unix)]` で括り、「Windows では未検証」をヘルパの doc に明示する。

### J-08 [MEDIUM] `open_book` の doc「#91 まで常に `UnsupportedFormat`」が実装と違う

comment。`api.rs:23`。実際には `UnknownExtension` / `NotFound` / `PermissionDenied` / `Io` /
`InvalidPath` も返る。信じた実装者は F-02 と H-06 で積み上げた復帰導線を今は不要と判断できてしまう。

→ 直す。

### J-09 [MEDIUM] `open_at` が同じ規則を5回言い直している

comment。`api.rs:45-93`。本文17行に対しコメント20行。CONTRIBUTING の
「関数本文の中に説明コメントが何行も必要になったら、関数を分ける合図」に当たる。

**実害はこのラウンドの J-03 に出ている** — 同じ規則を5回書いたうちの1つだけが実装とずれても、
他の4つが正しいので気づけない。

→ 直す。解決と検査を `resolve_book_path` に切り出す。

## 重複・矛盾した所見

- J-01 は3体が別の綴りで同じ穴に当たった（`(cd …)` / `pushd` / `env -C` / `%%` の取り違え / commit 2つ）。
  **個別に足すのは4ラウンド目なので、方針を「判別できないなら deny」に変えた**
- J-03 は3体全員。comment は BLOCK、他は MEDIUM。**最も重い所見として BLOCK を採る**
- J-05 の直し方について rust は「doc に1項目足す」と「型で閉じる」の両論を出した。**型を採った。**
  4ラウンド続けて「doc に書いた約束が実装とずれる」が出ているので、doc に足す選択はもう根拠が薄い
- robustness は `to_book_key` の入力長を実測（30MB の持駒フィールドで 626ms、線形）し、
  R3 H-10 の歯止めの穴としては**出さなかった**と明示している

## 見ていない範囲

- フロント側（`src/`）。呼び出しは R1 から0件のまま
- 実際の定跡ファイルでの動作。`open_reader` は今も必ず `Err`
- やねうら王 `source/book/book.h` / `Position::sfen()` の一次資料（R1 から変わらず）
- Windows / Linux での実行時挙動。実測は macOS のみ
- `tauri::async_runtime::spawn_blocking` の join が `Err` になる条件
- `cargo audit` / dashmap 6.1.0 の deadlock 実測
- 意図して見送っている3件（issue #197 / ゲートの誤発火側 / 検査と使用の窓）は再提出されていない
- **所見にしなかった観測（rust）**: この wt-90 の `node_modules` が空で `npm run verify` が落ちる。
  ゲートが対象ツリーへ `cd` してから `npm` を走らせる形になったため deny として現れる。
  環境の状態でありこのブランチの変更ではないが、`run_gate` が「検証が落ちた」と
  「検証を走らせられなかった」を区別しない点は記録しておく

## lint / hook で強制できるもの

- **ゲートのケース表** — J-01 / J-02 の全綴りを `expect_dir` に足した（deny 期待を含む）。
  R4 で足した表に「解釈できない綴りは空」の行が無かったのが J-01 の原因
- **`err.message` を見るテスト** — J-03 は既存テストが `path` しか見ていなかったので素通しした。
  `errors_keep_the_resolved_path_in_the_message` を足した
- **`OpenedBook`（J-05）** — doc ではなくコンパイラが「blocking プールの中で確定させる」を強制する
- **`cargo clippy --target x86_64-pc-windows-msvc`** — J-07 を機械で止められる。
  CI の quality job に1本足す価値はあるが、**このブランチでは入れない**（book の範囲を越える）
- J-04 / J-06 / J-08 / J-09 は機械では拾えない

## 修正結果

| 所見 | 結果 | コミット |
| ---- | ---- | -------- |
| J-07 | 直した | `b63af7f` |
| J-06 | 直した | `8f77cb3` |
| J-08 | 直した | `8f77cb3` |
| J-03 | 直した | `f47456a` |
| J-04 | 直した | `f47456a` |
| J-05 | 直した | `f47456a` |
| J-09 | 直した | `f47456a` |
| J-01 | 直した | `1e314ba` |
| J-02 | 直した | `1e314ba` |

コミットの粒度: J-03 / J-04 / J-05 / J-09 は `open_at` の同じ書き換えの中でしか直せないので1コミット
（メッセージに4件とも書いた）。J-06 と J-08 も同様に doc の同じ回で直した。

副次的な変更: J-05 で形式を拡張子から決める形に寄せた結果、`BookReader::format` が
二重の情報源になったので落とした。

提案どおりに直さなかったもの:

- **J-01 の `env -C`** — 「解決する」ではなく **deny** にした。`env -C` は綴りが増えるだけで、
  判別できない綴りを個別に足す方針そのものを止めるのが今回の判断
- **J-07 の Windows CI** — `cargo clippy --target x86_64-pc-windows-msvc` を CI に足す案は採らなかった。
  book の範囲を越える。テスト側の `#[cfg(unix)]` だけで、Windows のコンパイルは通る

自分が作った退行: J-01（`%%` の取り違えと `(`/`pushd` の取りこぼし）、J-03（`with_path` が上書きで
実体を落とす）、J-04（`join_error` の文言を open 経路にも当てた）は**いずれも R4 の修正が持ち込んだもの**。

## 検証

`npm run verify:rust` を通した。book のテストは 48件。
`bash .claude/hooks/verify-gate.test.sh` も通した（判定 16 / 宛先 21）。
