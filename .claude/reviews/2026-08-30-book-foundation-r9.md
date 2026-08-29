# レビュー book-foundation ラウンド9

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/` 全7ファイル、`src-tauri/src/lib.rs` の book 登録部分、`.claude/hooks/verify-gate.sh` / `verify-gate.test.sh`
- 走らせた reviewer: rust / robustness / comment
- 前ラウンド: `-r1.md`〜`-r8.md`（計105件）

## 所見

### N-01 [HIGH] `.scss` だけの変更が、deny も検証もされずに素通しする

rust。`verify-gate.sh:173-187`。case 表に `.scss` が無い。
`npm run test` は `src/__tests__/scssScaleRatchet.test.ts` で `src/` 配下の全 `.scss` を走査し、
バケツごとの直値件数を**厳密一致**で見ている（ADR-0003）。**`.scss` 単独のコミットはそこが唯一の検査**なのに、
`needs_ts=0 / needs_rust=0 / needs_gate=0` で `exit 0`。

M-03 が「何を検証するか決めるファイルは自分も検証されるべき」として `.claude/hooks/*.sh` を足したが、
**表そのものに欠けている拡張子は塞がれていなかった。**

### N-02 [HIGH] `git pull` が語彙に無く、完全に素通しする（M-02 の直し方が不完全）

rust。`verify-gate.sh:49-51`。`pull` は fetch + merge で、非 fast-forward ならマージコミットを作る。
`--rebase` が付いても救われない（`-` で始まるので語として認識されない）。**`main` を取り込む最も普通の操作。**

### N-03 [MEDIUM] 引用の剥がしが語中のアポストロフィを飲み、間の `cd` ごと消す（M-01 が持ち込んだ退行）

rust。`verify-gate.sh:31-35`。実測:

```
CMD:      git commit -m "don't" && cd /tmp && git commit -m "won't"
STRIPPED: git commit -m "don''t"
COUNT:    1（剥がす前は 2）
dir:      <wt-90>
```

ゲートは wt-90 を検証して許可を出すが、コミットは `/tmp` に入る。
**剥がしを入れる前は deny 側に落ちていた。**

### N-04 [MEDIUM] `git status --porcelain` が引用符付きで出すパスで、case 表が全て外れる

rust。空白・非 ASCII を含むパスは C クオートされるので `"src/my file.ts"` のまま case に当たらない。
現時点でこの repo に該当パスは0件だが、ファイル名を1つ足すだけで表が黙って外れる。

### N-05 [HIGH] `to_book_key` の doc が、ファイル側のキーをどちらの関数に通すのか自分で矛盾している

3体全員。`sfen.rs:70-76`。前段は「ファイル側は `to_book_key_in_file`」、
後段は「メモリに展開する reader はファイル側のキーも**この関数**を通す」。
M-04 が新しい文を差し込んだだけで、古い文の指す関数名を直していなかった。

後段に従った #91 の実装者は M-04 が塞いだ失敗をそのまま再現する。
`to_book_key_in_file` は呼び手0（`#[allow(dead_code)]`）なので、検証では表面化しない。

### N-06 [MEDIUM] `to_book_key_in_file` の message が、復帰導線を書かず行を丸ごと埋める

robustness。`sfen.rs:155-158`。M-04 で変わったのは機械が読む `code` だけで、
人が読む message は `"手番が無い: 壊れた行"` のまま。**ファイルが壊れているとも取得し直せとも書かれていない。**

加えて `.db` の1行は、途中で切れたファイルや別形式のファイルでは数 MB になりうる。
それが message に入り `logged` でログに書かれると、**1回の lookup でログ（200KB / KeepOne）が
埋まり、それ以前の記録が消える。**

### N-07 [MEDIUM] `a_huge_hand_count_is_rejected_before_counting` が名前の主張を固定していない

robustness。`sfen.rs:536-550`。検査を数え上げの**後ろへ移す**変更では3ケースとも同じ文言が返るので、
テストは通る。そのとき `"4294967295P"` は 42.9 億回まわしてから通り、
`sfen.rs:307-310` のコメントが名指しで防いでいる失敗がそのまま起きる。

### N-08 [HIGH] `GATE_COMMIT_VERB` のコメントが約束する「検証」は、実装では一度も走らない

comment。`verify-gate.sh:49-51`。実測: `git cherry-pick` / `git rebase` / `git revert` は
作業ツリーを汚さないので `needs_*=0` になり `exit 0`。**捕まえても検証は掛からない。**

M-02 で直っているのは deny 判定に載せることだけで、コメントが主張する性質は実装に無い。
**PreToolUse は実行前に走るので、まだ存在しないツリーは検証できない。**

### N-09 [MEDIUM] 剥がさない理由（`$(` を含むから）と、実装している条件（`$` 1文字）が違う

comment。`verify-gate.sh:26-35`。しかも単一引用符にも同じ条件を掛けているが、
単一引用符の中ではコマンドも変数展開も走らない。結果、`git commit -m 'fix: 値段は $5 だが git commit の話'`
が「呼び出しが2つ」と数えられて deny になる。

### N-10 [MEDIUM] `gate_flatten` のコメントだけが「素通しする」と書いている

comment。`verify-gate.sh:18-24`。M-06 で同じ食い違いを別の箇所で直したが、この1つが残っていた。

### N-11 [MEDIUM] `reports_a_broken_position_for_a_live_handle` が、隣のテストの真部分集合

comment。`api.rs:352-375`。同じ入力・同じ判定で、差は `assert_eq!(state.get_calls(), 0)` の1行だけ。
順序を変えると2本落ちるので、どちらが順序の固定なのか読み取れない。

## 重複・矛盾した所見

- N-05 は3体全員が指摘した。**M-04 の修正が古い文を残したことが原因**で、
  「新しい指示を足したが、古い指示を消していない」形
- N-01 / N-02 / N-03 / N-04 はいずれもゲートの素通し。**N-03 は M-01 の修正が持ち込んだ退行**で、
  M-01（誤 deny を直す）と N-03（その修正が開けた穴）は同じ関数の表裏
- N-07 と N-11 は R8 の M-10 / M-05 の直し方に対する指摘。**「テストを足したが、
  その性質を実際には固定できていない」** が2件

## 見ていない範囲

- フロント側（`src/`）。呼び出しは R1 から0件のまま
- 実際の定跡ファイルでの動作。`open_reader` は今も必ず `Err`
- やねうら王 `source/book/book.h` / `Position::sfen()` の一次資料
- Windows / Linux の実行時挙動。実測は macOS のみ
- hook の payload の `.cwd` が Bash ツールの持続する作業ディレクトリを追随するか
- 意図して見送っている4件は再提出されていない
- comment は `TODO(#91)` 4箇所（`reader.rs` / `sfen.rs` × 3）が全て #91 で消せる形だと確認し、
  変更の経緯の混入は0件（R7 で指摘された「4ラウンド続けて」は消えている）と明示している

## lint / hook で強制できるもの

- **分類（`gate_kinds_for_path`）のケース表** — 判定3種のうちここだけテストが無かった。
  **今回切り出して表を置いた**（`.scss` / 引用符付きパス / `.claude/hooks/*.sh` / docs）
- **`HandCount` newtype** — N-07。検査を通らずに数え上げへ渡す実装がコンパイルを通らなくなる。
  文言に依存したテストより強い
- **message の長さを見るテスト** — N-06 の打ち切りを固定した
- **`expect_match CATCH 'git pull'`** / **アポストロフィ入りの綴りの `expect_dir ""`** — N-02 / N-03
- N-05 / N-08 / N-09 / N-10 / N-11 は機械では拾えない

## 修正結果

| 所見 | 結果 | コミット |
| ---- | ---- | -------- |
| N-05 | 直した | `7f96b85` |
| N-06 | 直した | `7f96b85` |
| N-07 | 直した | `df1dc06` |
| N-11 | 直した | `df1dc06` |
| N-01 | 直した | `72524a1` |
| N-02 | 直した | `72524a1` |
| N-03 | 直した | `72524a1` |
| N-04 | 直した | `72524a1` |
| N-08 | 直した | `72524a1` |
| N-09 | 直した | `72524a1` |
| N-10 | 直した | `72524a1` |

提案どおりに直さなかったもの:

- **N-06 の行番号** — robustness は `line_no: u64` を今のうちに足すことも勧めたが、
  **足さなかった。** 呼び手が居ない引数を先に決める根拠が無い。`TODO(#91)` に「行番号を
  添えられるようにするかはそこで決める」と書いた
- **N-08 の直し方** — comment は「`git merge --abort` を『コミットを作る』列から外せ」とした。
  外さずに、**誤発火の側として別の行に移した**。語彙から外すと `--abort` を判別する必要が生まれ、
  それは綴りを言い当てる方向に戻る

## 検証

`npm run verify:rust` を通した。book のテストは 55件。
`bash .claude/hooks/verify-gate.test.sh` も通した（判定 36 / 綴り 5 / 宛先 32 / 分類 11）。
hook を payload から end-to-end で1回走らせ、`exit 0` になることも確認した。
