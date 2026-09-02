# レビュー harness-and-research ラウンド3

- 日付: 2026-09-02
- 範囲: `git diff main...HEAD` ＋ r2 の未コミット修正（PR #347）
- 走らせた reviewer: `architecture-reviewer`、**ShogiHome 実リポジトリとの照合**（`general-purpose`）
- 対象コミット: `f7dba2c` ＋ 未コミット分
- 前ラウンド: `r1` / `r2`

## このラウンドで初めて埋めた範囲

**`research/shogihome/` の ShogiHome 側の記述を、実リポジトリと突き合わせた。**
r1・r2 はどちらも外部取得をしておらず、**内部整合しか見ていなかった**（2ラウンド続けて
「見ていない範囲」に挙がっていた）。版を `de27f0c1c352` に固定して照合した結果、
**約153件の主張のうち15件が外れていた。**

| 文書                | 照合 | 外れ  |
| ------------------- | ---- | ----- |
| 01-app-state        | 10   | **4** |
| 02-game             | 約25 | **1** |
| 03-board-layout     | 約30 | **5** |
| 04-position-editing | 約18 | **1** |
| 05-usi-engine       | 約20 | **0** |
| 06-tabs-and-layout  | 約20 | **3** |
| 07-project-ops      | 約20 | **1** |

**最優先で確かめた項目（`AppState` 28値・対5組・`params.ts` の実数値・`Player` 8メソッド・
`jishogiRule` 4値・`maxMoves` 1000・`USIEngineOptionType` 6種・タグ9色・`Tab` 7値・
`UIComponent` 11種・局面編集仕様の全項目・`specs/` 13本・workflows 5本・i18n 4言語）は
すべて一致した。** 外れたのは周辺の記述と帰属。

## 所見

### BLOCK-1 `/tidy-commits` が未コミットの変更を巻き込み、巻き戻しで消す（architecture）

- 場所: `.claude/skills/tidy-commits/SKILL.md` 手順1・2・4・6
- 手順1 が確かめるのは push 済みかだけ。手順2 が記録する安全網は `git diff base..HEAD` で
  **未コミットの変更を含まない**。手順4 の `git add -A` はそれを群へ巻き込む
- 結果、手順6 の比較は**必ず**不一致になり、指示どおり `git reset --hard` を打つと
  **群のコミットごと捨てられ、未コミットの変更は reflog の宙に浮いたコミットにしか残らない**
- `/implement` 手順9 が `/tidy-commits` を既定の工程にしたので、**この経路は毎 PR で通る**。
  しかも**このワークツリーは modified 13 + untracked 1 の状態で PR 直前にいた**
- **直した。** 手順1 に `git status --porcelain -uall` を足して非空なら止め、
  判定表にも「作業ツリーが汚れている → 触らない」の行を足した

### HIGH-1 決定3-2 が丸ごと2回書かれていた（architecture）

- 場所: `docs/proposals/naming-and-module-layout.md`
- r2 で新しく入れた節が23行そのまま二重化していた（`diff` で完全一致）
- **片方だけを直す修正が入った瞬間に、同じ文書の中で決定が2つに割れる。**
  r1 HIGH-1 / r2 HIGH-1（同じ文書の中で数が割れていた）と同じ故障の再発
- **直した**（2つ目を削除）

### HIGH-2 決定2 の食い違いの表が `tree_*` 7本を ✓ に数えていた（architecture）

- 表は「残り28本 = 一致 ✓」と断言していたが、**その28本の中に決定3 が改名を要求している
  `tree_*` 7本が入っていた**。決定2 が ✓ と数えたものを決定3 が ✗ 扱いしている
- 実測: 領域名と `mod` 名が完全一致するのは `engine` 5本と `search` 3本の**計8本**
- **直した。** 基準を明示して表を作り直し、13 → **20本**（`analysis` 8 + `kifu` 5 + `tree` 7）に。
  直置きファイル名が対応するだけの13本は △ として分けた

### HIGH-3 決定3-2 の「5つの述語を共有」が実測と合わない（architecture）

- 実際に両側から使われているのは **3つ**（`ENGINES_DIR` / `is_listed_profile` / `PROFILE_SUBS`）。
  `has_any_content` は作成側だけ、`validate_dir` は走査側が呼んでいない
- **「5つ共有しているから動詞で割るな」という結論の根拠が、数えていない数だった。**
  しかも「現物のコメントが不変条件として書いている」と実地確認を主張している箇所
- **直した。** 3つに直し、`validate_dir` の置き場（`ai/mod.rs`）も明記。
  **結論（動詞で割らない）は2つだけで立つので変えていない**

### HIGH-4 `architecture-reviewer` が「既知の重複」と書いた対象が0件（architecture）

- 場所: `.claude/agents/architecture-reviewer.md`
- 「`tesuuPointer` のパース（`indexOf(",")` で分割し後半を `JSON.parse`）は重複が既知」
- 実測: `grep -rn 'indexOf(",")' src/` は **0件**。`CLAUDE.md` は
  「**解く経路はリポジトリに1つも無い**」と明記している
- `architecture-reviewer` は**常に走る**ので、reviewer は存在しない重複を探す。
  r1 HIGH-2（`#[test]` 0個）と同じ、**reviewer の前提が現物と食い違う**類
- **直した。** `CLAUDE.md` を出典として参照し、agent 側に事実を写さない形にした

### HIGH-5〜9 ShogiHome との照合で外れていた記述

| #   | 場所                | 書いていたこと                                                              | 実際                                                                                                                                                                                   |
| --- | ------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | `01:32` `:49` `:52` | `show*Dialog()` が**例外なく** NORMAL ガード。例外は `showPasteDialog` だけ | **ガードを持たないものが2つある**（`showAppSettingsDialog` / `showPVPreviewDialog`）。別形は `showPositionEditingDialog` もある。**「NORMAL 以外は全部禁止」は全数としては成立しない** |
| 6   | `01:42` `:43`       | `showUSIEnginesDialog` / `showExportPositionImageDialog`                    | **どちらも実在しない。**正しくは `showUsiEngineManagementDialog` / `showExportBoardImageDialog`（値名から推測で書いていた）                                                            |
| 7   | `02:29`             | `HumanPlayer` は**全メソッドが空**                                          | 8つのうち**3つは空でない**。同じ行の「`startSearch` は handler を保持するだけ」と自己矛盾していた                                                                                      |
| 8   | `03:145`            | COMPACT / PORTRAIT は `hideClock` を**見ていない**                          | **見ている。しかも使い方が逆**（時計を消したときだけ手番表示を出す）。局面編集ダイアログの挙動はこれ                                                                                   |
| 9   | `03:142`            | 繰り上げは時計の **55px** ぶん                                              | **+65px**（55 ＋ 間隔 10）。同じ節の `:139-140` が挙げている値がそのまま反例だった                                                                                                     |

さらに: `get ratio()` の帰属（`params.ts` には関数が1つも無く、**3ファイルに複製**されている）、
`standardViewParams.hand` の帰属（寸法を持つのは `handParams`）、
`Config` に無いフィールド2つ、「行番号を反転」→ **180° 回転**、「上下対称」→ **厳密な鏡像ではない**、
`headerHeight` の置き場（`app.ts` でなく `TabPane.vue`）、
`calculateLayoutScale` のコードブロックが**改変版**（README の引用規約「改変して載せない」に違反）、
`specs/position-editing-mode.md` は **30行でなく44行**（3箇所）、
CONTRIBUTING の見出しは「歓迎しないもの」でなく**「控えて欲しいもの」**。

**全部直した。**

### MEDIUM 群（直したもの）

| #   | 所見                                                                                                                                                                                                                                  | 対応                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| M-1 | 決定3 のディレクトリ図に `analysis/` が無く、`kifu/` に移してくる5本の置き場も無い                                                                                                                                                    | 図に `analysis/` と `kifu/{create,mv}.rs` を追加                                                                                 |
| M-2 | 決定3 が「境界はここ」と決めた `analysis/` の線引きを、同じ文書の未決が「読んで確かめていない」と書いていた。しかも「実体」と名指したファイルが違う（セッションを持つのは `EngineBridge` と `AppState`。どちらも `engine/bridge.rs`） | 帰属を直し、確認が済んだ未決の行を削除                                                                                           |
| M-3 | `/tidy-commits` の安全網の説明が、その文書が禁じた識別子 `$BASE` を参照していた（r2 HIGH-3 と同じ、存在しない識別子への参照）                                                                                                         | `<W>` の展開忘れ／ファイル欠落と書き直した                                                                                       |
| M-4 | 手順5 が「判定は版で変わるから写さない」と言った直後に、版依存の判定を見積りの根拠にしていた。この版のゲートは `${CLAUDE_PROJECT_DIR}` 側の `git status` を読むので、**ワークツリーで回すと別ディレクトリの汚れで見積りが決まる**     | 断言を落とし「1群目を積んで測る」に変更                                                                                          |
| M-5 | `review-round` の表で `.claude/**` と `research/**` を守備範囲とする reviewer がいない。r1/r2 の HIGH の大半は `architecture-reviewer` から出たが、agent の定義に `.md` を見よという記述が1行も無かった                               | `oss-hygiene` の条件に `research/` を追加。`architecture-reviewer` に「ハーネスを範囲に含むとき」の節を新設                      |
| M-6 | 同じ所見が2人から出る構造が2組（perf↔react の再レンダ、ui↔react の部品重複）                                                                                                                                                          | 3本の1行目に相互の棲み分けを明記。再レンダは perf、実装の重複は react に一本化                                                   |
| M-7 | `OPERATING-MODEL` §3 と `weekly-review` が r2 の修正後も揃っていない（揃ったのは消す側だけで、孤児検出は片側にしか無い）                                                                                                              | §3 の入力に `ls docs/proposals/` を足し、手順2 に「Q が無ければ先に立てる」を追加                                                |
| M-8 | **孤児2本。** この PR が追加した案に対応する Q が `OPEN-QUESTIONS.md` に無く、定義上どのラウンドでも取られない                                                                                                                        | **Q-006（命名）と Q-007（issue 規約）を起こした。**`Q-005` は決着済みで使用中だったので番号を送った。両提案の状態行から Q を参照 |

## 重複・矛盾した所見

- 無し。2人の担当範囲が重なっていない（片方はハーネスと提案、片方は外部照合）

## 見ていない範囲

- `research/findings/L0〜L4` の本文（3ラウンド続けて未読）
- `.claude/reviews/` の既存80本超
- `src-tauri/src/search/` 18ファイルと `engine/` の内部（`bridge.rs` 以外）
- ShogiHome 側: `players/usi.ts` `basic.ts` の中身、`game/parallel.ts` `sprt.ts`、
  `board/hand.ts` の `HandLayoutBuilder`、`StandardLayout.vue` / `CustomLayout.vue` /
  `DragEditor.vue`、`PositionEditingDialog.vue` の script 部、`store/` の分割ファイル
- **`npm run verify` / `npm run verify:rust`。** 差分は `.md` のみで、ゲートの判定でも走らない
- `/tidy-commits` を実際に走らせての確認（BLOCK-1 の危険があるため走らせていない）

## lint / hook で強制できるもの

r1 の6件・r2 の7件は繰り返さない。**新たに:**

1. **同一ファイル内の見出しの重複検出。** HIGH-1（決定3-2 の二重化）が止まる。`awk` 1行
2. **提案文書の「N本中M本」の自己整合。** 対応表の行を領域ごとに数えて本文と突き合わせる。HIGH-2 が止まる
3. **agent 本文が引く現物の識別子の死活チェック。** `.claude/agents/*.md` からコード片を抜いて `rg -q`。HIGH-4 が止まる。r2 の3番（hooks の関数名）と同型なので同じジョブに足せる
4. **`docs/proposals/*.md` に対応する Q の存在検査。** M-8 が止まる。**実際に孤児2本が入った状態でマージされかけた**ので優先度が高い

**r2 で「次の PR で入れる価値がある」と書いた2件（シェル変数代入の検出、数え方コマンドの再実行）は
このラウンドでも実害が出た**（HIGH-2 は数え方の問題、BLOCK-1 は手順の穴）。

## 次ラウンドの対象

このラウンドの所見は**全て直した**。grep で確認済み。

```
grep -rn "43 本|16ファイル|D-04|gate_kinds_for_path|gate_target_dir|indexOf(\",\")|全メソッドが空|30 行ほど" \
  docs/proposals/ research/shogihome/ .claude/skills/tidy-commits/SKILL.md .claude/agents/
→ 0件
```

**ラウンド4 を回す。** 3ラウンド連続で「新しい所見が出て、そのうち何件かは前ラウンドの修正で入ったもの」
という状態が続いている。**所見ゼロのラウンドはまだ出ていない。**

見るべきもの:

- このラウンドの修正で入った矛盾（とくに決定2 の表を作り直したことで、決定3 の移動の表と数が合っているか）
- 3ラウンド続けて未読の `research/findings/L0〜L4`
- `research/shogihome/` の**残りの未検証範囲**（ShogiHome 側の実装ファイル）
