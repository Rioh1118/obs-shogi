# レビュー harness-and-research ラウンド2

- 日付: 2026-09-02
- 範囲: `git diff main...HEAD` の26ファイル（PR #347）
- 走らせた reviewer: `architecture-reviewer`、`comment-reviewer`（**r1 で走らせ損ねていた観点**）
- 対象コミット: `f7dba2c`
- 前ラウンド: `2026-09-02-harness-and-research-r1.md`

## このラウンドで分かった一番重いこと

**r1 の報告書に嘘があった。** HIGH-1（数値の誤り）に「全部直した」と書いたが、
`docs/proposals/naming-and-module-layout.md:47` の `43 本` と `:173` の `16ファイル` が
残っていた。**2人の reviewer が独立に同じ2箇所を指摘した。**

r1 の該当箇所には訂正を書き足した。**修正したと報告する前に、修正後の現物を grep していなかった**
のが原因。r1 で「数え方のコマンドを併記する」対策を入れたが、
**併記したコマンドを自分で走らせて突き合わせていなかった**ので効いていない。

## 所見

### HIGH-1 r1 で「直した」と報告した数値が2箇所残っていた（architecture / comment 両方）

- 場所: `docs/proposals/naming-and-module-layout.md:47`（`43 本`）、`:173`（`16ファイル`）
- 実測: コマンドは **41本**、`search/` は **18ファイル**。同じ文書の `:27` `:159` は 41、
  `:24` `:62` `:232` は 18 と書いてあり、**同じ文書の中で数が割れていた**
- **直した。**

### HIGH-2 `/tidy-commits` が手順1 で自ら禁じたシェル変数に、全手順が依存していた（architecture）

- 場所: `.claude/skills/tidy-commits/SKILL.md` の `W=<scratchpad>`
- r1 の HIGH-4 で「シェル変数は呼び出しを跨がない」を理由に基点をファイルへ逃がしたのに、
  **そのファイルの在り処を再びシェル変数に入れた。** 9行後に `W=` を置いている
- `$W` が空だと `git reset --soft $(cat /tidy-base.txt)` は引数が空になり、
  **`git reset --soft` は HEAD への no-op で成功する**。手順6 の比較は空ファイル同士で必ず一致する
- **同じ故障がループ内で2回目**（r1: `$BASE` → r2: `$W`）。
  `CLAUDE.md` の「同じ失敗を2回するまでルールを足さない。1回目はルールではなくテストを書く」の
  閾値に達している
- **直した。** 変数を使わず scratchpad の絶対パスを毎回書く形にし、
  `test -s` で空ファイルの一致を「OK」と読まないようにした

### HIGH-3 `/tidy-commits` が「唯一の出典」と指した関数が、このブランチのゲートに存在しない（architecture）

- 場所: `.claude/skills/tidy-commits/SKILL.md`（`gate_kinds_for_path` / `gate_target_dir`）
- このワークツリーの `.claude/hooks/verify-gate.sh` は**71行**で、両関数とも**定義されていない**。
  実在するのは `/Users/riohatta/obs-shogi` の**未コミットの作業コピー**（384行）だけ
- r1 の M-13 は「腐る表」を消してポインタに置き換えたが、**ポインタの先が空になった**
- さらに悪いのは、`.claude/settings.json` が指すのは `${CLAUDE_PROJECT_DIR}` 側なので、
  **走るゲートはチェックアウトしているワークツリーの版とは限らない**
- **直した。** 関数名を書かず「唯一の出典はファイルそのもの。関数名も判定も版で変わる」とし、
  走る版と手元の版が違いうることを明記した

### HIGH-4 提案の「領域名 = `mod` 名」が、提案自身の対応表で13本破れている（architecture）

- 場所: `docs/proposals/naming-and-module-layout.md` の決定2
- 実測: `analysis_*` 8本は `engine/bridge.rs`、`kifu_*` 8本のうち5本は
  `file_system/operations.rs` と `file_system/mv.rs`。**41本中13本が食い違う**
- 決定3 は「`file_system` → `tree` の改名は**コマンドの領域名と一致させる**ため。
  一致していないと『どのファイルを開けばいいか』を毎回考えることになる」と書いていたが、
  **改名しても一致は得られない**（`kifu_*` の5本も `tree/` に残り、`analysis_*` は `engine/` に残る）
- **直した。** 決定2 に食い違いの表を足し、決定3 に**移動**（`analysis/` の新設、
  `*_kifu_file` の `kifu/` への移動）を明記した

### HIGH-5 `file_system/` → `tree/` の改名先が既存の `file_system/tree.rs` と衝突（architecture）

- 場所: 同上／`src-tauri/src/file_system/tree.rs`（`mod.rs:6` の `mod tree;`）
- 改名すると `tree/tree.rs` になり、パスが `crate::tree::tree::get_file_tree`。
  clippy の `module_inception` に当たるうえ、`tree/mod.rs` と `tree/tree.rs` の
  どちらを開くか毎回考えることになる。**改名が消そうとしていた問題そのもの**
- **直した。** 内側の `tree.rs` も同時に改名する（`tree/read.rs`）ことを条件にし、
  満たせないなら改名を落とすと書いた

### HIGH-6 `research/README.md` が「何を消したか」の作業記録になっていた（comment）

- 場所: `research/README.md` の `### findings/ について`
- `CLAUDE.md` は「**変更の経緯を書かない。**『〜に変更した』は全て禁止。経緯は git log と PR に残る」
  と決めている。削除済みの4ファイル（`ROSTER.md` / `STATE.md` / `lanes/` / `_TEMPLATE-lane.md`）の
  処遇を5行かけて説明していた。**マージ後に clone した人には存在しないファイルの話**
- **直した。** 経緯を落とし、`findings/` が何かだけを書いた

### MEDIUM 群（直したもの）

| #    | 所見                                                                                                                                                                           | reviewer     | 対応                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| M-1  | `docs/proposals/` に週次レビューからの入口も、消す手順も無い。案だけがあって Q が無いと永遠に取られない                                                                        | architecture | `weekly-review` の読むものに `ls docs/proposals/` を足し、採用時に proposals も消す手順を明記。`OPERATING-MODEL` の手順2 も揃えた |
| M-2  | `/implement` 手順7 の分類表が `/write-issue` に再複製され、**6週間の門が落ちた形**になっていた（r1 の M-12 が場所を変えて再発）                                                | architecture | `write-issue` の表を削除し、条件2つの箇条書きに                                                                                   |
| M-3  | 提案が「`/implement` 手順7 と同じ」と書いた規則を、r1 の修正が手順7 から削除していた（死んだ参照）                                                                             | architecture | 参照先を `/write-issue` へ                                                                                                        |
| M-4  | `/tidy-commits` の「割れないなら1つの変更」と、禁止事項「独立した修正を本体へ畳むな」が正面衝突。**手順どおりに進むと必ず禁止事項を踏む**                                      | architecture | 「割れないなら並べ直しを中止する」に変更し、判定表に行を足し、手順3 で前倒しに判定するようにした                                  |
| M-5  | `ai_library.rs` を「走査/作成」で割る案が、コードが明示的に守っている不変条件を分断する（`read_profiles` と `create_ai_profile_dirs` は5つの述語を共有し、**意図的に非対称**） | architecture | 割る軸を概念に変更（`profile` / `engines` / `scan`）。決定3-2 として書いた                                                        |
| M-6  | obs-shogi 側の「要求」「論点」「直感」を鉤括弧で引いているが、出典がリポジトリのどこにも無い。しかも同じ発言が2つの文書で**別の文言**で引用符に入っていた                      | comment      | 全て「未文書化・出典なし」と明示。`research/README.md` の規律に7番目として追加                                                    |
| M-7  | `04` の比較表の3列目（2026-09 の案）だけ出典が無く、**主結論がその列に乗っていた**                                                                                             | comment      | 列見出しに「未文書化・出典なし」を入れ、決めるときは `OPEN-QUESTIONS.md` へ起こすと書いた                                         |
| M-8  | 公開文書に定義の無い識別子が3種類（`D-04` / `§10` / `盤クラスタ`）                                                                                                             | comment      | `D-04` と `§10` は実体の記述に置換。`盤クラスタ` は `.game-board__cluster` として初出で定義                                       |
| M-9  | `検討` が ShogiHome の機能名（`ResearchState`）と一般語の両方に使われていた                                                                                                    | comment      | 一般語側を `案` に統一。`research/README.md` の規律に8番目として追加                                                              |
| M-10 | `findings/` の参照元が「2か所」と書いてあるが、直すファイルは3つ。**1行が2ファイルを束ねていた**                                                                               | comment      | 3ファイルに分けた。`docs/decisions/` は append-only なので切ると高い、と添えた                                                    |
| M-11 | 規律4（感想は `所感` の下に隔離）が事実節と比較表で破られていた                                                                                                                | comment      | `03` の比較表セルと `07` の評価語を所感へ移した                                                                                   |

## 重複・矛盾した所見

- **HIGH-1（数値）は2人が独立に同じ2箇所を指摘した。** 統合して1件にした
- 矛盾は無かった

## 見ていない範囲

- **ShogiHome の実リポジトリとの突き合わせ。** どちらの reviewer も外部取得をしていない。
  r1 でこちらが `gh api` で確かめた5つの数値（41 / 18 / 430 / 28 / 959）以外は未検証
- `research/findings/L0〜L4` の本文
- `.claude/agents/*.md` 8本の本文（2ラウンド続けて未読）
- `.claude/reviews/` の既存80本超
- `src-tauri/src/search/`（18ファイル）と `engine/` の内部構造
- **`npm run verify` / `npm run verify:rust`。** 差分は `.md` のみで、ゲートの判定でも走らない

## lint / hook で強制できるもの

r1 の6件は有効なので繰り返さない。**このラウンドで新たに出たもの:**

1. **skill 内のシェル変数代入の検出。** `.claude/skills/**/*.md` の ```bash ブロックから
`^[A-Z_]+=`を拾って落とす。**HIGH-2 はこのループで2回目**なので、`CLAUDE.md` の two-strikes に達している。**これは実際に足すべき**
2. **数え方コマンドの再実行。** `naming-and-module-layout.md` は既にコマンドを併記しているので、
   CI でそれを走らせて本文中の数字と突き合わせられる。**HIGH-1 はこれで落ちた**
3. **`.claude/hooks/*.sh` の関数名参照の死活チェック。** `.md` からバッククォート付きの識別子を抜いて
   `rg -q "^\s*<name>\(\)" .claude/hooks/*.sh`。HIGH-3 が止まる
4. **`docs/proposals/` の孤児検出。** 各案に対応する Q が `OPEN-QUESTIONS.md` に無ければ落とす。
   逆向き（採用済み ADR と同名の proposals が残っている）も同じジョブで見られる
5. **`§N` / `D-NN` / `Q-NNN` / `P-NNN` の解決チェック。** M-8 が止まる
6. **`所感` より前の評価語の検査。** M-11 が止まる
7. **`commentHistory` の走査対象に `research/**`と`docs/proposals/**` を足す。**
   HIGH-6 が止まる（`.claude/reviews/**` と `docs/decisions/**` は除外）

**1 と 2 は次の PR で実際に入れる価値がある。** どちらも今回のループで実害が出た。

## 次ラウンドの対象

このラウンドの所見は**全て直した**（今度は grep で確認した。下記）。

```
grep -n "43 本|16ファイル|D-04|gate_kinds_for_path|gate_target_dir|\$W/" \
  docs/proposals/*.md research/shogihome/*.md .claude/skills/tidy-commits/SKILL.md
→ 残るのは意図した2件（盤クラスタの定義、W= を禁じる文）のみ
```

**ラウンド3 を回す。** 見るべきは:

- 今回の修正で入った新しい矛盾（とくに決定3 に足した「移動」が決定2 と整合しているか）
- 2ラウンド続けて未読の `.claude/agents/*.md` 8本
- `research/shogihome/**` の ShogiHome 側の記述の真偽（外部取得が要る）
