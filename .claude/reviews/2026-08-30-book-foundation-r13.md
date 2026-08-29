# レビュー book-foundation ラウンド13

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/`、`src-tauri/src/lib.rs` の book 登録部分、`.claude/hooks/verify-gate.*`、`docs/state-transitions/` の2ファイル
- 走らせた reviewer: rust / robustness / comment
- 前ラウンド: `-r1.md`〜`-r12.md`（計172件）

**状態遷移表を初めてレビュー対象に入れた回。表そのものが3件の嘘をついていた**（R-03 / R-06 / R-07）。
表を作ったことで、その嘘が「✓ が付いているのに通っていないセル」として検査可能になった。

## 所見

### R-01 [HIGH] 長いパスの打ち切りが `validate_book_path` の失敗枝にしかなく、通り抜けたパスは生で流れる

rust / robustness の2体。`api.rs:38,96,119,137`。
R12 Q-04 で「長さで弾く」のをやめたとき、上限が検査側から消えた一方で
`truncate_path` は `invalid()` にしか入っていなかった。**6経路のうち1つにしか掛かっていない。**

筋道: 1MB の絶対パスを `open_book` に渡す → 検査を全て通る → `log::info!` が 1MB 書く →
`canonicalize` が `ENAMETOOLONG` → `from_io` が `err.path` に 1MB を入れる →
`logged` の `Display` がもう 1MB 書く → **ログ（200KB / KeepOne）が2周し、以前の記録が全て消える。**

R11 P-02 で塞いだ経路が、R12 Q-04 の直し方で開き直っていた。

### R-02 [BLOCK] `a_long_token_is_truncated_in_the_reason` の4件目が3件目と同じ枝を踏む

rust / comment。`sfen.rs:502-504`。`"9"×150` は `parse::<u32>()` が桁あふれで失敗し
`u32::MAX > 18` で「範囲外」に落ちる。**「持駒の枚数 {digits} に駒が続いていない」は
一度も生成されない。** 先頭ゼロなら `parse` を通せるので「到達不能だから空」でもない。

**R9→R12 で4回続けて出た「doc が名指した枝を通っていない」が、その修正で足したテストの中で再発。**

### R-03 [HIGH] 表が G3 に ✓ を付けているが、「手番が無い」を通すテストが無い

comment。`book-key-failures.md:49`。`rejects_input_that_is_not_a_position` の5件は
G2 が3件、G4 が1件、G5 が1件で、**side だけが欠ける入力が無い。**
`sfen.rs` の該当行を `unwrap_or("b")` に書き換えても緑のまま通る。

**表を作った目的は「✓ が付いているのに通っていないセル」を消すことなのに、表自身が同じ嘘をついていた。**

### R-04 [MEDIUM] 最長を固定するテストが持駒を1枚も置いていない

robustness。`sfen.rs:545-568`。盤面の綴りは `89 + 盤上の成駒数` で、
**盤上の駒を持駒へ移しても縮まない**（駒が減るぶん空きマスの `1` が増える）。
金は成れないので、金を持駒に移すと盤面 123 字を保ったまま持駒の字数だけ増える。

実測: テストが通すのは 146 字だが、正当な入力は 159 字まである。
**`MAX_INPUT_CHARS` を 148 に詰めても、テストは1本も落ちない。**

### R-05 [MEDIUM] R12 で消したキャッシュ変数が、テストに残っている

rust / comment。`verify-gate.test.sh:87`。`verify-gate.sh` に定義も参照も無い。
R12 の報告書自身が「テスト側も no-op」と書いていたのに、消えたのは本体側だけ。

### R-06 [MEDIUM] 表の F 行の「結果: deny」が実装と逆

comment。`verify-gate-decision.md:47`。実測で4形のうち3形は S1 を通り S4（検証）へ進む。
deny になるのは `$(which git)` だけ。この表を信じると、`gate_target_dir` が
パス修飾付きの prefix を許可リストで通していることが検証対象から外れる。

### R-07 [MEDIUM] 不変条件1の照合が、それを担っていない表を指している

rust / comment。`verify-gate-decision.md:72`。S2（`gate_mentions_commit`）を固定しているのは
`expect_mentions` なのに、照合欄は `expect_alias_resolution`（S1 側の語彙）を指していた。
**`expect_mentions` を消しても、この doc を見る限り不変条件1は守られているように読める。**

### R-08 / R-12 [MEDIUM] 表の数値が、隣に並べた列挙や実装と合わない

rust / comment。「9ラウンド続けて」の列挙は R2〜R11 の10ラウンド、
「3ラウンド続けて」の列挙は R9〜R12 の4件、「段が4つ」は実際 S1〜S5 の5段。

### R-09 [MEDIUM] 表に件数（`expect_dir` 32件）を書いた

comment。R12 Q-08 で「数を書くと更新し忘れる」として消した形を、別ファイルへ持ち込んでいた。

### R-10 [MEDIUM] `MAX_PATH_CHARS` の「出荷対象のうち最も緩い Linux」が誤り

comment。`release.yml` に `windows-latest` がある。Windows は長パス有効時 32,767 UTF-16 単位。
値そのものは打ち切り上限なので影響を受けないが、**この文を根拠に「弾く側」へ戻すと
Windows の長パス利用者が Q-04 と同じ行き止まりに落ちる。**

### R-11 [MEDIUM] `MAX_INPUT_CHARS` の「160 の 1.5 倍」が 256 にならない

comment。テストが通す最長は 146 字、160 × 1.5 = 240。値を導けていない。

## 重複・矛盾した所見

- R-01 は2体が HIGH。**R12 Q-04 の修正が持ち込んだ**
- R-02 / R-03 は「テストが名前どおりの枝を通っていない」形で、**R9 から5ラウンド連続**
- R-03 / R-06 / R-07 は**表そのものの誤り**。表を対象に入れて初めて出た

## 見ていない範囲

- フロント側（`src/`）。呼び出しは R1 から0件のまま
- 実際の定跡ファイルでの動作。`open_reader` は今も必ず `Err`
- やねうら王 `source/book/book.h` / `Position::sfen()` の一次資料
- Windows / Linux の実行時挙動。実測は macOS のみ
- hook の end-to-end。今回見たのは `GATE_LIB_ONLY=1` の判定関数と、payload 1件の smoke だけ
- 表に「埋まっていないセル」として残してある2件（`git rebase` が作るツリー / `git status -z` の end-to-end）

## lint / hook で強制できるもの

- **`with_path` の中で打ち切る** — R-01。呼び出し側で掛ける形は、経路が増えるたびに取り残す。
  実際6経路のうち1つにしか掛かっていなかった
- **理由文まで見るテスト** — R-02 / R-03。種別だけを見ると、どの枝も同じ `InvalidSfen`
- **shellcheck を `.claude/hooks/*.sh` に掛ける** — R-05 のような死んだ変数を拾える。
  **今回は入れない**（book の範囲を越える）
- 表の数値・照合先の誤り（R-06〜R-09）は機械では拾えない。**数を書かず範囲で書く**運用に寄せた

## 修正結果

| 所見 | 結果 | コミット |
| ---- | ---- | -------- |
| R-01〜R-12 | 全て直した | `959182f` |

提案どおりに直さなかったもの:

- **R-01 の `truncate_path` の置き場** — robustness は「`error.rs` へ移して `api.rs` の呼び出しは消す」。
  そのとおりにした（二重に切っても壊れないが、唯一の防御が2箇所にあると次の人がまた片側だけ直す）
- **R-06 の `expect_dir` 追加** — comment は F1 の宛先を固定する行を求めた。
  `/usr/bin/git` と `'git'` の2行を足した

## 変異による確認

| 壊した箇所 | 結果 |
| ---------- | ---- |
| `MAX_INPUT_CHARS` を 160 に詰める | `a_long_token_is_truncated_in_the_reason` が落ちた（R-04 の修正前は 148 でも落ちなかった） |
| `with_path` の打ち切りを外す | `an_over_long_path_is_truncated_in_the_error_but_not_rejected` と `an_over_long_path_that_passes_validation_is_truncated_downstream` の2本が落ちた |

## 検証

`npm run verify:rust` を通した。book のテストは 59件。
`bash .claude/hooks/verify-gate.test.sh` も通した。
