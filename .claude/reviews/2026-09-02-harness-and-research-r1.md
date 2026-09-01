# レビュー harness-and-research ラウンド1

- 日付: 2026-09-02
- 範囲: `.claude/`（skills 9本 / agents 8本 / hooks / settings）、`CLAUDE.md`、`AGENTS.md`、
  `research/`（作り直したもの）、`docs/proposals/` 2本、`docs/OPERATING-MODEL.md`
- 走らせた reviewer: `architecture-reviewer`（ハーネスの構造）、`oss-hygiene-reviewer`（docs の整合）
- 対象コミット: `a435ba4` ＋ このブランチの未コミット分
- 走らせなかった reviewer と理由: `react` / `ui` / `rust` / `perf` / `robustness` —
  この範囲に `.tsx` / `.scss` / `src-tauri/` / 実行されるロジックが1つも無い

## 所見

### BLOCK-1 削除したファイルへの参照が残り、Q-001 の反証が消えた（oss-hygiene）

- 場所: `docs/IDEAS.md:42` → `research/lanes/L0-annotation-implementations.md`
- `research/lanes/` を丸ごと消したが、`L0` は**調査の進め方ではなく判定結果**だった。
  `docs/OPEN-QUESTIONS.md` Q-001 は**いまも**「競合する2実装が存在する」と書いており、
  `docs/OPERATING-MODEL.md` はそれを「最大のブロッカー」としている。
  **その主張を反証していた唯一の文書を消した。**
- **直した。** `git show HEAD:research/lanes/L0-...` から `research/findings/L0-...` へ復元し、
  `docs/IDEAS.md:42` の参照先を書き換えた。
- **残: Q-001 の本文が L0 の判定と食い違ったまま** → issue

### HIGH-1 数えたと書いた数が3つとも違う（oss-hygiene）

| 場所                                                | 書いた値           | 実測    |
| --------------------------------------------------- | ------------------ | ------- |
| 提案（命名）`generate_handler!`                     | 43 本              | **41**  |
| 同 `search/`                                        | 16 ファイル        | **18**  |
| `research/shogihome/07-project-ops.md` CONTRIBUTING | 424 行             | **430** |
| `research/shogihome/01-app-state.md` `AppState`     | 29 値              | **28**  |
| 同「対になっているもの」                            | 4組と書いて5つ列挙 | **5組** |

- 提案の説得力は「数えた」ことに乗っている。**表（41行）と本文（43本）が同じ文書の中で
  食い違っていた。**
- **全部直した。** 提案には数え方のコマンドを併記し、再現できるようにした。

### HIGH-2 「Rust の `#[test]` は0個」が4箇所にあり、全部嘘（architecture）

- 場所: `.claude/skills/review-protocol/SKILL.md:20`、`.claude/agents/rust-reviewer.md:52`、
  `.claude/skills/implement/SKILL.md:105`、`CLAUDE.md:40-44`
- 実測: `src-tauri/src` に `#[test]` **21**、`src-tauri/tests` に **9**。TS 側はテスト50本・407件。
- `agents/*.md` は全員 `skills: review-protocol` なので、**8本の reviewer 全部の一次前提**になる。
  「0個」を前提に読むと reviewer は既存テストを数えずに「テストが無い」と書き、
  `implement:62` の「触った箇所にテストが1本も無い → 重」が常に真に倒れる。
- **`CLAUDE.md:40` は「件数をここに書かない。書くと必ず腐る」と決めているのに、
  その2行下が件数を書いていて、しかも腐っている。**
- **このブランチでは直さない** → issue（範囲外。`CLAUDE.md` と agents を触るのは別の PR）

### HIGH-3 ワークツリーへコミットする綴りが1つも通らない（architecture）

- 場所: `.claude/hooks/verify-gate.sh` の `gate_target_dir`、`CONTRIBUTING.md:312-322`
- reviewer が `GATE_LIB_ONLY=1` で判定関数を直接叩いた実測:

```
git commit -m x                                  -> [/Users/riohatta/obs-shogi]
cd <worktree> && git commit -m x                 -> []   deny
git -C <worktree> commit -m x                    -> []   deny
```

- 残る唯一の経路は「別の呼び出しで `cd` してから単独で打つ」だが、
  **このハーネスでは Bash の作業ディレクトリが呼び出しを跨いで持続しない**
  （このセッションで実測。`cd` だけの呼び出しの直後に `pwd` するとプロジェクトルートへ戻る）。
  ゲートのコメント `:159-160`「呼び出しを跨いで持続するので」が成り立っていない。
- 一方 `CONTRIBUTING.md:312` はワークツリー運用を定めており、現に8本ある。
- **このブランチの成果物をコミットできない直接の原因。** → issue

### HIGH-4 `/tidy-commits` の `$BASE` が呼び出しを跨がず、安全網が無効化される（architecture）

- 場所: `.claude/skills/tidy-commits/SKILL.md` 手順1・4・6
- `BASE=$(git merge-base ...)` はシェル変数だが、Bash ツールの状態は持続しない。
  さらにゲートが commit を単独の呼び出しに強制するので、**手順4 は必ず別呼び出しに割れて
  `$BASE` が空になる。**
- `git reset --soft`（引数なし）は **HEAD へのリセット＝成功する no-op**。
  積み直しが1つも起きていないのに、**手順6 の差分比較は必ず一致する。**
  唯一の安全網が、失敗を検出できない形で通る。
- **直した。** `$W/tidy-base.txt` へ落として `$(cat ...)` で引く形に変更し、
  soft reset の直後に「HEAD が base と一致」「`--cached` が非空」の2つの確認を必須にした。

### HIGH-5 `/tidy-commits` に、この環境で打てないコマンドが2種類（architecture）

- `git commit`（`-m` なし）→ `$EDITOR` が開き非対話シェルで戻らない。**`-m` 必須に直した。**
- 方法B の `GIT_SEQUENCE_EDITOR=... git rebase` → **環境変数の前置はゲートの
  prefix 許可リストに当たらず deny**（reviewer が実測）。**方法B を削除し、
  使えない理由を書き残した。**

### HIGH-6 `/review-fix` の sha を `/tidy-commits` が全部殺す（architecture）

- `review-fix:53-56` は「rebase で到達できなくなる」ことを理由に**短ハッシュと説明の併記**を
  求めている。その直後に `implement` 手順9 が履歴の書き換えを既定の工程として挟む。
- `tidy-commits` は報告書の**存在**だけを守っていて、報告書と履歴を結ぶ**唯一の鍵**について
  何も決めていなかった。
- **直した。** 手順7「報告書の sha を書き戻す」を新設（1対1なら旧→新、そうでなければ
  `畳み込み済み` に一括置換）。禁止事項に「到達できない sha を残す」を追加。

### HIGH-7 `/write-issue` が存在しないラベルを必須にし、未採用の案を規約として引く（両方）

- `--label area:kifu` は**実在しない**（実在するのは `area:engine` / `book` / `analysis` / `ui` の4つ）。
  `gh` は issue を作らずに落ちる。しかも「ラベルを付けずに立てる」が禁止事項なので**どちらへも進めない**。
- 根拠にしていた ADR-0008 は**未採用**だった。
- **直した。** 実在するラベルから選ぶ形にし、`gh label list` を先に見るよう変更。
  該当が無ければ領域を付けずに立てる（立てられない方が損）。

### HIGH-8 未採用の案に ADR 番号を付けたのが `OPERATING-MODEL` と衝突（oss-hygiene）

- `docs/decisions/` は append-only で、既存の状態は `採用` / `撤回` の2種のみ。
  「提案（未採用）」を新設し、「合意できたら採用に変える」と書いたのは、
  `main` マージ後に許された3つの書き換え（実測値の更新 / 誤記の訂正 / supersede の印）の
  どれでもない。
- **`ADR-0006` はまさに「4文書が食い違った」ことを問題にした ADR で、その規律を新設2本が最初に破っていた。**
- **直した。** `docs/proposals/`（番号なし）へ移し、`OPERATING-MODEL.md` の表に行を足して
  「ADR 番号を先取りしない。案を参照する側は未採用であることを必ず書く」を明文化した。

### MEDIUM 群（直したもの）

| #    | 所見                                                                                                                                                  | 対応                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| M-1  | `research/README.md` が存在しない `archive/` を「置き場」に書いていた。参照を「3か所」と書いたが2か所                                                 | 直した                                                                                               |
| M-2  | 再取得のコマンドが `main` 固定で、記録した版（`de27f0c1c352`）を取り直せない                                                                          | `?ref=$REF` に直した                                                                                 |
| M-3  | `research/README.md` の書き換えで `PREMISES.md` P-004（「#236 のコメント主に直接あたる」）の取り消し文が消えた                                        | 規律5 に戻した。**P-004 側の `次回確認` はまだ直っていない** → issue                                 |
| M-4  | ShogiHome のコードを逐語引用しているのに MIT の帰属表示が無い                                                                                         | `research/shogihome/README.md` に引用の節を追加                                                      |
| M-5  | `.claude/plans/` は `.gitignore` 済み。追跡外のパスを3箇所が出典にしていた                                                                            | 「追跡外」と明示。比較表は内容を転記                                                                 |
| M-6  | `04-position-editing.md` が obs-shogi の駒箱について表と所感で逆のことを言っていた                                                                    | 時点で列を分けた（2026-06 の計画 / 2026-09 の検討）                                                  |
| M-7  | `03-board-layout.md` の STANDARD でフレーム高 959 < 盤高 960                                                                                          | **写し間違いではなく ShogiHome の実装がそう**と確認し、注記を追加                                    |
| M-8  | `07-project-ops.md` が「2種類ある」と断定して13本中11本しか分類していない                                                                             | 残る2本を明示                                                                                        |
| M-9  | 提案（issue）が「リリースノートも規約が無い」と書いたが `docs/RELEASE.md` に手順が実在                                                                | 「決まっていないのは語彙だけ」に訂正。置き場も `RELEASE.md` に指定                                   |
| M-10 | 同じく、外向け issue の必須項目が Issue Forms と `CONTRIBUTING.md:47-59` の2箇所にある問題を見ていなかった                                            | 「Issue Forms を唯一の場所に」を決定に追加                                                           |
| M-11 | `question` ラベルの入口が無い（`config.yml` が Discussions へ誘導）                                                                                   | 種類から外した。`blank_issues_enabled` を未決に追加                                                  |
| M-12 | `/implement` 手順7 と `/write-issue` が同じ分類表を二重に持ち、書き方では逆のことを言っていた。手順7 に6週間の門が無かった                            | 手順7 は分類表だけ残し、書き方は `/write-issue` へ委譲。6週間の門を表に追加                          |
| M-13 | `/tidy-commits` の検証コスト表が、このブランチの hook と3行とも食い違う（`.scss` / `docs/state-transitions/` / `verify-gate.test.sh` はこの版に無い） | 表を削除し `gate_kinds_for_path` へのポインタに。soft reset 中は群の中身で種類が変わらないことを明記 |

### MEDIUM 群（直さないもの → issue）

| #    | 所見                                                                                                                                                        | 理由                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| M-14 | ゲートが読み取り専用コマンドを誤 deny（`git log --oneline && npm ci` など）。`gate_mentions_commit` が `gate_strip_quotes` を通していない                   | ゲート本体の変更。**このレビュー中に実際に踏んだ**（`git commit` の語を含む Python スクリプトが deny された） |
| M-15 | `AGENTS.md` が `vp check` / `vp test` という第2の検証規約を持ち、`CLAUDE.md` にもゲートにも繋がっていない。自動生成ブロックなので次の更新で黙って書き換わる | 範囲外                                                                                                        |
| M-16 | ブランチ名 ADR-0001（`issue-<番号>/<slug>`）が現物 **0/8** で守られていない。supersede の印も無い                                                           | 決定が要る                                                                                                    |
| M-17 | 同じルールの重複: 「未検証と明示」5箇所 / 「1所見1コミット」3箇所 / 「テストを弱めない」2箇所。出典が示されていない                                         | 範囲外                                                                                                        |
| M-18 | `CONTRIBUTING.md` の「並行作業の worktree」節が `## SCSS の書き方` 配下の `###` として埋まっている                                                          | 範囲外                                                                                                        |

## 重複・矛盾した所見

- **`/tidy-commits` の検証コスト表**は両 reviewer が独立に指摘した（architecture は
  「走るゲートはブランチごとに違う」、oss-hygiene は「このブランチの hook と3行とも違う」）。
  **同じ結論なので統合し、表を消してポインタにした。**
- **`/write-issue` のラベル**も両方が指摘。同じ対応で解決。
- 矛盾は無かった。

## 見ていない範囲

- **ShogiHome の実リポジトリとの突き合わせ。** oss-hygiene は外部取得をしていないので、
  `research/shogihome/*` の主張は**内部整合だけ**を見ている。数値の食い違いとして挙がったものは
  こちらで `gh api` を叩いて確かめ直した（41 / 18 / 430 / 28 / 959 は全て確認済み）。
- `.claude/reviews/` の既存80本超。ラウンドの実運用が skill の記述どおりかは未確認。
- `.claude/agents/*.md` の本文（8本の観点定義が互いに重複していないか）。
- `verify-gate.test.sh` の全体とテストの実行。
- `research/findings/L1〜L4` の中身（参照の生死だけ確認）。
- `npm run verify` / `npm run verify:rust`。**このワークツリーに `node_modules` が無い。**
  今回の変更は `.md` のみなので、ゲートの判定でも検証は走らない。

## lint / hook で強制できるもの

**ここが今回いちばん収穫があった。** BLOCK-1 も M-1 も M-5 も、全部同じ検査1本で落ちる。

1. **Markdown 内のリポジトリ相対パスの死活チェック。**
   `docs/` と `research/` と `.claude/skills/` の `.md` からバッククォート付きパスを抜いて
   `test -e` するだけ。BLOCK-1（`docs/IDEAS.md:42`）・M-1（`archive/`）・
   M-5（`.claude/plans/`、`git check-ignore` も併用）が全部これで止まる。
   **ゲートは docs を素通しするので、CI（`ci.yml`）側に docs 用のジョブを1つ足すのが安い。**
2. **skill 間の「手順N」参照の突き合わせ。** 今回は切れていなかったが、
   次に1つ挿入したときに黙って腐る。
3. **存在しないラベルの参照。** `gh label list` の実出力と `.md` 中の `--label X` を突き合わせる。
4. **件数表現の検査。** `CLAUDE.md:40` が「件数をここに書かない」と規約にしているのに
   機械で見ていない。`src/__tests__/` の既存の走査と同型で書ける。
5. **ゲート自身の誤発火**（M-14）。`verify-gate.test.sh` に `expect_mentions SKIP` の行を足すだけ。
6. **`docs/proposals/` に ADR 番号が現れていないかの検査**（HIGH-8 の再発防止）。

**強制できないもの**: 数値そのものの正しさ（HIGH-1）、外部ソースとの一致、文書内の意味的矛盾（M-6）。

## 次ラウンドの対象

**今回直したもの**: BLOCK-1 / HIGH-1 / HIGH-4 / HIGH-5 / HIGH-6 / HIGH-7 / HIGH-8 / M-1〜M-13。

**issue へ送るもの**: HIGH-2（テスト件数の嘘 4箇所）、HIGH-3（ワークツリーへコミットできない）、
M-14（ゲートの誤 deny）、M-15（`AGENTS.md`）、M-16（ブランチ名 0/8）、
Q-001 の本文（BLOCK-1 の残り）、P-004 の `次回確認`（M-3 の残り）、
`~/zermelo` が公開 docs に3箇所。

**次ラウンドで見るべきもの**: 今回の修正で新しい矛盾が入っていないか。とくに
`docs/proposals/` の新設が `weekly-review` skill と噛み合うか（未確認）。
