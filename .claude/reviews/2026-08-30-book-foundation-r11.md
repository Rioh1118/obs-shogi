# レビュー book-foundation ラウンド11

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/` 全7ファイル、`src-tauri/src/lib.rs` の book 登録部分、`.claude/hooks/verify-gate.sh` / `verify-gate.test.sh`
- 走らせた reviewer: rust / robustness / comment
- 前ラウンド: `-r1.md`〜`-r10.md`（計142件）

**3体とも同じ根を指した。** R10 の O-04（打ち切りを `invalid` へ移す）が片側にしか効いていなかった。

## 所見

### P-01 [HIGH] 打ち切りが `input` にしか効かず、理由文に埋まる断片は無制限（O-04 の直し方が誤り）

3体全員。`sfen.rs:80-85`。打ち切られるのは `input` の引用だけで、`reason` は素通し。
その `reason` に入力から切り出した任意長のトークンが入る枝が4つある。

3体が独立に実測（`sfen.rs` を切り出して実行）:

```
余分なトークン: message 100,141 文字
手数が数値でない: 100,133
持駒の桁: 100,134
持駒の枚数に駒が続かない: 100,134
参考: 空白を含まない1トークン（既存テストが通す形）: 128
```

`lookup_book_moves` を1回叩くだけで `logged` が 100KB の警告行を書き、
**ログ（200KB / KeepOne）の過去分が消える。**

さらに O-04 は `to_book_key_in_file` から `truncate_for_message` を**外した**ので、
この4経路はファイル側で**退行**していた（R10 以前は 120 字で頭打ちだった）。

既存テストが空白を含まない1トークンしか回していないため、性質が壊れたまま緑になっていた。

### P-02 [MEDIUM] `open_book` が、検査前の生のパスをそのままログに書く

robustness。`api.rs:31`。`validate_book_path` に長さの上限が無く、
**弾かれる入力であっても**その前に 200KB がログへ書かれる。
続く `logged` が `Display`（path を含む）でもう1本書くので、以前の記録は確実に消える。

### P-03 [MEDIUM] alias の展開先が別の alias だと素通しする

rust。`verify-gate.sh:72-85`。fixture を置いて実測:

```
[alias] ci = commit ; acp = !f() { git ci -m "$1"; }; f
verbs=[ci]
git acp x     match=no mention=no   ← exit 0（素通し）
```

O-02 は1周の grep で終わっているので、合成 alias を足した瞬間にこの状態になる。
**この repo の利用者は現に `alias.ci commit` を持っている。**

### P-04 [MEDIUM] 分類表に足した理由が経緯で書かれ、3種のうち1種は理由が無い

comment。`verify-gate.sh:170-172`。「〜状態だった」は CONTRIBUTING が名指しで禁じている形。
`rust-toolchain.toml` だけ理由が無く、`.scss` と `tauri.conf.json` には付いているので粒度が揃っていない。

### P-05 [MEDIUM] `TODO(#91)` を伴わない #91 参照が、公開コマンドの doc にある

comment。`api.rs:23-25`。`TODO(#91)` は4箇所あって全て #91 で消せる形だが、
**同じく #91 で偽になる記述がここだけ `TODO` を伴わずに `pub` な doc に書かれている。**
`grep -rn "TODO(#91)"` で片付ける人はここを拾えない。

### P-06 [MEDIUM] `truncate_for_message` の引数名が、このファイルでの `reason` と逆の意味

comment。`sfen.rs:181`。このファイルで `reason` は「エラーの理由文」の意味で使われている
（`invalid(reason)` / `map_err(|reason| ...)`）のに、この関数だけ「打ち切る対象の引用」に使っている。
**P-01 の食い違いは、この名前のずれと同じ場所から来ている。**

## 重複・矛盾した所見

- P-01 は3体全員。robustness が HIGH。**直し方は robustness の「入口で長さを切る」を採った。**
  rust と comment は「`invalid` で `reason` も打ち切る」を提案したが、それだけだと
  `hand_count::parse` のように `invalid` を経由しない経路が増えたときに取り残す。
  **両方入れた**（入口で切り、理由文にも掛ける）
- P-03 の直し方について rust は「不動点まで回す」「テストは `GATE_EXTRA_VERBS` では固定できない」と
  指摘した。そのとおりで、`GATE_EXTRA_VERBS` は解決ロジックごと差し替える seam なので、
  `GIT_CONFIG_GLOBAL` の fixture を使う表を別に置いた

## 見ていない範囲

- フロント側（`src/`）。呼び出しは R1 から0件のまま
- 実際の定跡ファイルでの動作。`open_reader` は今も必ず `Err`
- やねうら王 `source/book/book.h` / `Position::sfen()` の一次資料
- Windows / Linux の実行時挙動。実測は macOS のみ
- hook の payload の `.cwd` が Bash ツールの持続する作業ディレクトリを追随するか
- 意図して見送っている5件は再提出されていない

## lint / hook で強制できるもの

- **入口での長さ検査** — P-01 / P-02。断片ごとに打ち切りを足して回る形は、R10 の修正で実際に
  4箇所とも取り残した。入口で切れば、枝が増えても覆われる
- **絶対値で見る長さのテスト** — `MESSAGE_EXCERPT_CHARS` から導くと、その定数を緩めたときに
  テストも一緒に緩む。今回 `LOG_BUDGET_CHARS = 512` の絶対値にした
- **alias 解決の fixture 表** — P-03。`GIT_CONFIG_GLOBAL` を差し替えて `gate_alias_verbs` を直接呼ぶ

## 修正結果

| 所見 | 結果 | コミット |
| ---- | ---- | -------- |
| P-01 | 直した | `d4b0574` |
| P-02 | 直した | `d4b0574` |
| P-03 | 直した | `d4b0574` |
| P-04 | 直した | `d4b0574` |
| P-05 | 直した | `d4b0574` |
| P-06 | 直した | `d4b0574` |

6件を1コミットにまとめた。P-01 / P-02 / P-06 は「外から来た文字列を打ち切る」1つの変更で、
P-03 / P-04 はゲート側、P-05 は doc。**本来なら分けるところだが、P-01 の修正を挟んで
分割すると、中間のコミットが「片側だけ打ち切る」状態になる**（それが今回の所見そのもの）。

## 変異による確認

- **alias の連鎖**: 展開先を辿るループを1周で止めると `expect_alias_resolution "ci|acp"` が落ちることを確認した
- **入口の長さ検査**: 外しても、理由文側の打ち切りが残っているのでテストは通る。
  **2つの防御は互いに冗長で、どちらか一方ずつではテストが区別しない。**
  テストが固定しているのは「message の長さ」という性質であって、機構ではない。これは明示しておく

## 検証

`npm run verify:rust` を通した。book のテストは 55件。
`bash .claude/hooks/verify-gate.test.sh` も通した（判定 36 / alias 解決 3 / alias 4 / 綴り 5 / 宛先 32 / 分類 14）。
