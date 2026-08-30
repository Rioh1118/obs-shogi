# レビュー kifu-encoding ラウンド1

- 日付: 2026-08-30
- 範囲: `fix/210-kifu-encoding`（`main` = `9aa963b` からの差分）。#210
- 走らせた reviewer: `rust-reviewer` / `robustness-reviewer`
- 対象コミット: `7e2ee8f`

**2体が独立に、同じ2つの穴を実測して出した。** どちらも
「`had_errors` が false ＝ 正しく復号できた」という前提が成り立たないケースで、
**#210 の被害（0手の棋譜 → 元ファイルを上書き）がそのまま残っていた**。

## 所見

### [HIGH] E1-1 ISO-2022-JP は候補に並べても到達しない（2体）

- 場所: `src-tauri/src/file_system/operations.rs`
- 根拠: ISO-2022-JP は全バイトが 7bit なので `std::str::from_utf8` が**必ず成功する**。
  rust-reviewer が実測:

  ```
  iso-2022-jp kif: Ok[utf8] -> "\u{1b}$B@h<j!';3EDB@O:\u{1b}(B\n\u{1b}$B<j?t\u{1b}(B----..."
  ```

  `ISO_2022_JP` の枝は**一度も評価されない死んだ候補**。

- なぜ問題か: エスケープ列混じりのテキストが `Ok` で返る。robustness が tsshogi で実測して
  `importKIF("\x1b$B…")` → `moves.length === 1` を確認している。
  盤に初期局面が出て、1手指すと元ファイルが上書きされる。**#210 が閉じたはずの経路が開いたまま。**
- 直し方: `bytes.contains(&0x1B)` なら UTF-8 の枝を飛ばし、`ISO_2022_JP` を先に試す。
- 導入コミットの sha: `7e2ee8f`（**このブランチで私が入れた**）
- 主張を固定するテスト名: `reads_iso_2022_jp_instead_of_taking_it_as_utf8`

### [HIGH] E1-2 BOM 無し UTF-16 の CSA / JKF が UTF-8 として通る（2体）

- 場所: 同上
- 根拠: 本文が ASCII だけの CSA / JKF は高位バイトが全て `0x00`。**NUL は正当な UTF-8** なので
  `from_utf8` が成功する。rust-reviewer の実測:

  ```
  utf16le-nobom csa: Ok[utf8] -> "V\02\0.\02\0\n\0N\0+\0s\0e\0n\0t\0e\0…"
  utf16le-nobom jkf: Ok[utf8] -> "{\0\"\0h\0e\0a\0d\0e\0r\0\"\0:\0{\0}\0…"
  ```

  同じバイト列は `SHIFT_JIS` でも `had_errors == false` で通る（実測済み）。

- なぜ問題か: `is_kifu_file` が通す4拡張子のうち **`.csa` と `.jkf` は本文が ASCII だけになりうる**。
  日本語 KIF では起きないので、**私が書いた6件のテストがちょうどこの穴を外していた**。
  落ちる先は E1-1 と同じ。
- 直し方: 復号結果そのものを見る門番（C0 制御文字を含まない）を**全ての枝**に掛ける。
  UTF-8 の枝だけ素通しにしていたので、CSA の経路がそこから抜けていた。
- 導入コミットの sha: `7e2ee8f`（**このブランチで私が入れた**）
- 主張を固定するテスト名: `rejects_utf16_without_bom`（KIF と CSA の2つ）

### [MEDIUM] E1-3 UTF-16 のループは2周目が1周目と同一（rust）

- 場所: 同上
- 根拠: rust-reviewer の実測。`Encoding::decode` の BOM sniffing は **`self` が何であっても**働く。
  したがって2周目の `UTF_16BE` は1周目と1バイトも違わない結果を返し、
  このブロックを丸ごと消しても後段の `SHIFT_JIS` の初回が同じ文字列を返す。
  `has_bom` はループ不変なのにループ内で計算していた。
- なぜ問題か: 読み手は「LE で駄目なら BE を試している」と読むが、そうはなっていない。
- 直し方: `has_bom` をループの外へ出した（2要素の列は残したが、BOM があるときだけ入る形にした）。
- 導入コミットの sha: `7e2ee8f`

### [MEDIUM] E1-4 「置換文字が出ない」は正しさの根拠にならない（rust）

- 場所: 同上（doc コメント）
- 根拠: rust-reviewer の実測。1バイトずれた Shift_JIS は無エラーで**別の文**になる。

  ```
  sjis + 1byte(0xE9): Ok[sjis] -> "先手：骼R田太郎…"
  sjis - 1byte:       Ok[sjis] -> "先手：R田太郎…"
  ```

  EUC-JP の2文字が SHIFT_JIS を無エラー通過する率は 5481/8836。
  ただし長さに対して指数的に落ちるので、実ファイル（51 / 154 バイト）はどちらも
  正しく EUC-JP に落ちた。**候補の順序自体は実用上問題ない。**

- なぜ問題か: doc が「これで文字化けは返らない」と読める断定をしていた。
- 直し方: 「候補の並びは索引側から取ったが、**採否の基準は違う**」に書き換えた。
- 導入コミットの sha: `7e2ee8f`

### [MEDIUM] E1-5 テストがこの実装の漏れる方向を1つも押さえていない（rust）

- 場所: 同上（テストモジュール）
- 根拠: 6件の内訳（UTF-8 / UTF-8 BOM / Shift_JIS / UTF-16 BOM 付き2種 / 完全な壊れバイト列 /
  BOM 無し UTF-16 の**日本語** KIF）は、E1-1 と E1-2 のどれにも当たらない。
  `does_not_take_utf16_without_bom` は `Ok(text) => assert_ne!(text, KIF)` で
  **文字化けを `Ok` で返すことを許して**おり、門番を外したときだけ落ちる。
- なぜ問題か: **私が書いたテストが主張を固定していなかったのはこのセッションで4回目。**
- 直し方: ISO-2022-JP / BOM 無し UTF-16 の CSA / 1バイト壊れた Shift_JIS を足し、
  `Err` を要求する形にした。一時ディレクトリの後始末（`Drop` を持つ guard 型）も入れた。
- 導入コミットの sha: `7e2ee8f`

### [MEDIUM] E1-6 1バイト壊れた Shift_JIS が全面拒否になり、逃げ道が無い（2体）

- 場所: `operations.rs` / `KifuReadErrorDialog.tsx`
- 根拠: 採用条件が `!had_errors` の全か無かなので、1バイトでも壊れていれば全候補が落ちる。
  `main` では置換文字1個で開けて全手数が読めていた。
- なぜ問題か: 案内は「UTF-8 か Shift_JIS で保存し直してください」だが、
  **その行動に移るための導線が画面に無い**（ダイアログは「エラーをコピー」と「閉じる」だけ）。
  `revealInFileManager` は既にあり permission も許可済みなのに使っていない。
  索引側は今も lossy まで試すので「検索には出るのに開けない」という食い違いも**悪化した**。
- **直していない。** lossy で開くか拒否したまま導線を作るかは設計の選択
  （`/implement` 手順7）→ **#293 を立てた**。
- 導入コミットの sha: `7e2ee8f`

### [MEDIUM] E1-7 検索の「続き」が読み込みの失敗を握り潰す（robustness）

- 場所: `PositionSearchContinuation.tsx`
- 根拠: `loadJkfData` は理由を持って throw するのに、唯一の呼び出し元が `catch {}` で捨てている。
- なぜ問題か: 索引に載っているが読めないファイルが増えるので、
  **検索結果を選ぶと「（続きなし）」とだけ出る**。分岐が無い正常な棋譜と同じ見た目。
- **範囲外。** → **#294 を立てた**。

## 重複・矛盾した所見

E1-1 / E1-2 / E1-6 は2体が別々に実測して同じ結論に達した。矛盾は無し。

## 確認して問題が無かったもの

- **`KifuEncodingUnknown` は潰れずに画面まで届く。** `serde` → `asFsError`（`FS_ERROR_CODES` に
  載っているので `unknown` に落ちない）→ `kifu_error` → `AppModalLayer` → `FsErrorView` が
  `describeFsError` の一文を描く。`FsErrorView.scss` に省略も行数制限も無いので文も切れない
- **段は `danger` で正しい**（読み直しても直らない）。噛み合っていないのは段ではなく導線（E1-6）
- **issue の案2（0手なら `KifuParseError`）を採らなかった判断は正しい。** robustness が実際に確かめた。
  `createInitialJKFData` は `moves: [{}]` を作り、`.kif` / `.csa` / `.jkf` のどれで書き出しても
  読み直すと `moves.length === 1`。**新規作成した棋譜が作った直後から1つも開けなくなる**
- **`.jkf`（JSON）が黙って壊れる経路は無い。** BOM 無し UTF-16 の `.jkf` は
  `importJKFString` が `failed to parse JSON` を返す（`\0` が JSON の制御文字として弾かれる）
  → `kifu_parse_failed` で対話に出る。危ないのは KIF / KI2 / CSA だけ
- `validate_under_root` は両側を canonicalize しており `..` と symlink の脱出は塞がっている

## 見ていない範囲

- `to_kif_owned` / `to_ki2_owned` / `to_csa_owned` の実際の出力バイト列
- `search/kifu_reader.rs` の `parse_kif_file` に壊れた Shift_JIS を実際に食わせていない
- `read_file` は非 async の `#[command]` なので Tauri の main thread で走る。
  候補が増えたぶん最悪5回の全バイト復号になる（既存の設計上の性質だが、この差分で確実に重くなった）
- KIF 以外の入口（`importKifu` 経由のインポート、ドラッグ&ドロップ）の符号化の扱い
- `KifuReadErrorDialog` のヘッダのアイコン色が `$color-warning` なのに tier が `danger` である点

## lint / hook で強制できるもの

- **Rust 側の `FsErrorCode` と TS の union のずれは何も強制していない。**
  `src/__tests__/fsErrorCodes.test.ts` が突き合わせているが、
  `ts-rs` などで enum を出力して diff を CI で見る形にすれば構造的に防げる
- `catch {}` で受けた値をどこにも渡さないブロックは oxlint の `no-empty` を通ってしまう。
  `no-restricted-syntax` で `CatchClause:not([param])` を warn にすれば、
  意図的な握り潰しには理由コメント付きの抑制を書かせられる（`async-result-ignored` の前例がある）
- 符号化の候補列が `operations.rs` と `kifu_reader.rs` に**二重にある**（`use encoding_rs::{...}` も両方）。
  共通関数へ寄せれば構造的に防げる（lint では防げない）→ #293

## 結果（書き戻し）

| 所見 | 直したコミット | 何をしたか                                                    |
| ---- | -------------- | ------------------------------------------------------------- |
| E1-1 | `3d698ba`      | ESC を含むなら UTF-8 の枝を飛ばす                             |
| E1-2 | `3d698ba`      | C0 制御文字の門番を**全ての枝**に。UTF-8 の枝が抜けていた     |
| E1-3 | `3d698ba`      | `has_bom` をループの外へ                                      |
| E1-4 | `3d698ba`      | 「採否の基準は違う」に書き換え                                |
| E1-5 | `3d698ba`      | ISO-2022-JP / CSA / 1バイト壊れを追加。`Err` を要求。後始末も |
| E1-6 | —              | **設計の選択。#293 を立てた**                                 |
| E1-7 | —              | **範囲外。#294 を立てた**                                     |

## このラウンドで分かったこと

**「置換文字が出なかった」を正しさの根拠にしたのが間違いだった。**
NUL も ESC も正当な文字なので、符号化を取り違えても `had_errors` は立たない。
復号結果そのものを見る門番が要る、というのが2体の共通の結論。

**私が書いたテストが主張を固定していなかったのは、このセッションで4回目。**
`assert_ne!` は「望まない値でない」しか言わないので、
**望む値（`Err`）を要求する形**でしか固定できない。
