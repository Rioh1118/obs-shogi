# レビュー kifu-write-path ラウンド1

- 日付: 2026-08-30
- 範囲: `fix/kifu-write-path`（`main` = `9aa963b` からの差分）。#227 / #204 / #245 / #200
- 走らせた reviewer: `robustness` / `react` / `architecture` / `comment`
- 対象コミット: `69d440d`

**3体が独立に同じ2件へ当てた。** どちらも「直したはずの経路が塞がっていない」形で、
`/implement` 手順5 の「出口を足す変更が別の規則とぶつからないか」に該当する。

`ui-reviewer` は走らせていない。SCSS の変更は失敗を出す箱1つで、面と文字色を
既存トークン（`$surface-danger` / `$color-danger-text`）から取り、`contrastRatchet` の
測れる対として数えられている。レイアウトを持つ要素を足していない。

## 所見

### [BLOCK] K1-1 `countMovesToDelete` が入れ子の変化を数えない（robustness / react / architecture の3体）

- 場所: `src/entities/kifu/lib/branchEdit.ts`
- 根拠: `readCandidates` が兄弟へ持ち上げるのは**各候補の先頭の手**の `forks` だけ。
  2手目以降にぶら下がる変化は候補の中に残り、`writeCandidates` の `splice` で候補ごと消える。
  robustness が実際に走らせて測っている: **`counted: 3 / actuallyRemoved: 7`**。
- なぜ問題か: 研究の棋譜は変化の中に変化を持つのが普通で、**深いほど失うものが大きい**。
  「3手が消えます」と出して数十手を消す。取り消しは無い（ADR-0004 決定8）。
  **取り消せない操作の唯一の安全弁が、いちばん必要な場面で桁を偽る。**
  #200 の目的（何がどれだけ消えるかを見せる）が達成されていない。
- 直し方: 候補を再帰で数える。
- 導入コミットの sha: `d3b6e5c`（**このブランチで私が入れた**）
- 主張を固定するテスト名: `branchEdit.test.ts`「消える線の中にぶら下がる変化も数える」。
  **既存のテストは検出できなかった**（照合側も `forks?.flat()` で1段しか数えていなかった）

### [BLOCK] K1-2 `baseText` がメモリの棋譜経由で進み、#227 の核が別経路で成立していた（robustness / react / comment）

- 場所: `src/features/kifu-comment-note/ui/KifuCommentNote.tsx`
- 根拠: `edit` は楽観的更新（ADR-0004 決定7）で**書き込みの前に** `jkf_replaced` を撃つ。
  よって `state.jkf` → `getCommentsByCursor` → `sourceText` が、書けたかどうかが決まる前に
  新しい本文になる。`useEffect([open, sourceText])` がそれを `baseText` に入れて `dirty` を落とす。
- なぜ問題か: 読み取り専用の場所に置いた棋譜でコメントを書くと、赤い箱は出るが `dirty` は既に false。
  そのまま閉じると `handleRequestClose` の条件に入らず即閉じ。開き直すと**メモリ**から本文が出るので、
  **保存できた状態と画面上で区別できない**。棋譜を開き直すと消えている。
  `doSave` の doc が「失敗しても進めると…本文がどこにも残らない」と書いているそのものが、
  別経路で成立していた。
- 直し方: 開いた面が変わったときだけ取り込む（鍵は `editorKey`）。
- 導入コミットの sha: `main` から在る形。`d83b6b9` が `doSave` 側だけ塞いだ
- 主張を固定するテスト名: `KifuCommentNote.test.tsx`「メモリの棋譜が動いても、書けていない下書きを
  『保存済み』の側へ寄せない」。**最初に書いたテストは再レンダを起こしておらず、変異させても緑だった**

### [BLOCK] K1-3 閉じるときに再試行していなかった（robustness）

- 場所: 同上
- 根拠: `if (dirty && cursor && !saveError)`。失敗が出ていると保存を飛ばして閉じる。
- なぜ問題か: 一時的な失敗（別のプロセスが掴んでいた等）でも本文が捨てられる。
  comment-reviewer は変異を当てて「`setBaseText(draft)` を足しても5件すべて緑」と測っており、
  **#227 の核を1件も固定できていなかった**ことも同時に示している。
- 直し方: 必ずもう一度書きにいく。閉じないのは失敗を初めて出したときだけ（2回目は諦めて閉じる。
  止め続けると書き込めない棋譜でノートを閉じる手段が消える）。
- 導入コミットの sha: `d83b6b9`（**このブランチで私が入れた**）
- 主張を固定するテスト名: 「失敗したあと、何も書き足さずに閉じても保存をやり直す」

### [BLOCK] K1-4 autosave のタイマーが 900ms 前の `doSave` を掴む（react）

- 場所: 同上
- 根拠: effect の dep は `[draft]` だけなので、タイマーが呼ぶ `doSave` は最後の打鍵時点で固定される。
  `doSave` → `setCommentsByCursor` → `edit` は `state.jkf` を閉じ込めている。
- なぜ問題か: ノートを開いたまま盤で1手指すと（`FloatingNote` は背面を塞がない）、
  900ms 後にその手を含まない棋譜が書き戻される。**指した手がメモリからもファイルからも消える。**
  失敗ではないので何も出ない。`main` から在る形だが、この PR の主題そのもの。
- 直し方: `doSaveRef` から最新を読む。`oxlint-disable-line` に理由も書き足した。
- 導入コミットの sha: `main` から在る形
- 主張を固定するテスト名: 未検証（盤と同時に動かす統合テストが要る → 見送り）

### [HIGH] K1-5 突き合わせている2値がどちらも game 側で、実際の書き込み先を見ていない（architecture / react）

- 場所: `KifuCommentNote.tsx` / `GamePersistenceGate.tsx` / `provider.tsx`
- 根拠: `absPath` も `loadedAbsPath` も `state.loadedAbsPath` 由来。実際に開くのは
  `saveKifuToFile(jkf, activeKifuPath, ...)`（file-tree 側）。繋いでいるのは
  `GameFileTreeBridge` の effect だけなので、その1コミットぶんのずれの中では
  **必ず「同じ棋譜だ」と判定する**。`game.md` の ※3 が同じ窓を明記している。
- なぜ問題か: #204 の門番が #204 の主要経路を塞げていない。しかもノートにしか無いので、
  `makeMove` / `swapBranches` / `deleteBranch` は無防備。
- 直し方: `GamePersistence` に `absPath` を持たせ、`persistIfPossible` で突き合わせる。
  **5つの書き込み経路が必ず通る場所**なので門番は1つで足りる。
- 導入コミットの sha: `41bf046`（**このブランチで私が入れた**）
- 主張を固定するテスト名: 未検証（`GameProvider` にテストが1本も無い → #276）

### [HIGH] K1-6 確認ダイアログが削除の**前に**閉じ、失敗が出ない（robustness / react）

- 場所: `src/widgets/kifu-stream/ui/KifuStreamList.tsx`
- 根拠: `setPendingDelete(null)` が `await deleteBranch(...)` より前。
- なぜ問題か: `isLoading` も「削除中...」も `closeOnEsc={!isLoading}` も**構造的に到達しない**。
  書き込みに失敗すると画面からは枝が消えてファイルには残る。
  確認文で「棋譜ファイルもすぐ書き換わります」と**この PR が新たに断言した**以上、破れたら伝える。
- 直し方: 書けたときだけ閉じる。失敗はダイアログの中に出す。
- 導入コミットの sha: `d3b6e5c`（**このブランチで私が入れた**）
- 主張を固定するテスト名: 未検証

### [HIGH] K1-7 閉じている #186 / #198 を「これから直す先」として8箇所から指している（comment）

- 場所: `provider.tsx` ×2 / `types.ts` / `KifuStreamList.tsx` ×3 / `game.md` / `failure-surfacing.md`
- 根拠: どちらも `CLOSED / COMPLETED`。統合先は #277（失敗が利用者に届かない）。
  8箇所とも**この差分で新設**。
- なぜ問題か: `asyncResultUse` の逃げ道は「理由」を要求している。飛び先が閉じていると、
  読み手は「もう出口はあるはずだ」と読み、印の妥当性を検証できない。
- 直し方: #277 へ張り替えた。
- 導入コミットの sha: `d83b6b9` ほか（**このブランチで私が入れた**）

### [MEDIUM] K1-8 手数を数えられなかったときの確認文が「が消えます。」で始まる（robustness）

- 場所: 同上。`.filter(Boolean).join(" ")` で組んでいた
- なぜ問題か: 1手目も手数も欠けると、**何が消えるのか1つも書かれていない確認**を
  取り消せない操作に出す。
- 直し方: 主語を必ず入れる関数（`describeDelete`）に閉じ込めた。
- 導入コミットの sha: `d3b6e5c`

### [MEDIUM] K1-9 `BranchIndex` への裸の算術が widget に増えた（architecture）

- 場所: 同上。`branchIndex === MAIN_LINE ? undefined : branchIndex - 1`
- 根拠: `entities/kifu/model/branch.ts` が「この変換が画面ごとに手書きされると
  `+1` の付け忘れが削除・入れ替えの対象を1つずらす」と名指しで書いている。#225 が同じ形。
- なぜ問題か: brand は `number & { ... }` なので tsc が減算を通す。
  ずれるとダイアログのラベルと1手目だけが別の枝を指し、削除は正しく走る（最悪の食い違い方）。
- 直し方: `forkIndexOrNull` をモデル側に置いた。
- 導入コミットの sha: `d3b6e5c`

### [MEDIUM] K1-10 台帳の ✓ が、固定していない主張まで含んで読める（comment）

- 場所: `game.md` の E12 / E15、`app.md` ※2、`failure-surfacing.md` §4、ADR-0004 の割り当て表
- 根拠: E12 の ✓ が指す `KifuCommentNote.test.tsx` は `entities/game` を丸ごとモックしており、
  `forceCommit` も #226 も見ていない。E15 の ✓ が指す `workspaceGuard.test.tsx` は
  `GameFileTreeBridge` を mount していない。`app.md` ※2 は「未検証 → #245」のまま。
  `failure-surfacing.md` §4 は F-12a を「まだ出口が無い」に残したまま。
  ADR-0004 は F-12a を `modal`、分岐削除を「確認なし」と書いたまま。
- なぜ問題か: 留保の無い ✓ は完全に固定済みと読まれる。台帳同士が真逆を言う状態は、
  #245 のループで6ラウンド繰り返した故障（`2026-08-30-game-cursor-plan-r6.md` S7）と同じ形。
- 直し方: ✓※ にして範囲を注に書き、4つの文書を実装に合わせた。
- 導入コミットの sha: `69d440d`（**このブランチで私が入れた**）

## 重複・矛盾した所見

K1-1 は3体、K1-2 は3体、K1-5 と K1-6 は2体が別経路で当てている。
矛盾は無し。

## 見ていない範囲

- 実機で動かしていない。VoiceOver が `role="alert"` の常設領域を読むかは未確認
- `JKFPlayer.getReadableForkKifu()` の添字が `readCandidates` の候補位置と常に一致するか。
  一致しないと確認文の「変化N」と1手目が実際に消える枝と別物になる（3体とも未確認）
- 未保存の下書きがある状態での棋譜切り替え・アプリ終了。**捨てるなら捨てたと言う**必要があるが、
  出す面が無い（→ #277）。今回は入れていない
- Rust 側（このブランチの差分に無い）
- `Ok` が「書けた」「変える必要が無かった」「保存先が無い」を兼ねる件は、
  `persistence` 未設定を `Err` にしたところまで。`changed: false` の経路は残っている

## lint / hook で強制できるもの

- **`BranchIndex` への裸の算術**。brand は `number & { ... }` なので tsc が通す。
  変換関数以外での `+ 1` / `- 1` を落とす走査は書ける。doc に「画面ごとに手書きされると
  1つずれる」と既に書かれ、#225 で一度踏んでいるので two-strikes を満たす
- **`asyncResultUse` の検出は行頭の `await f(` / `void f(` だけ**。
  `onClick={() => void deleteBranch(q)}` のような JSX の式中は素通りする
- **CLOSED な issue への参照**は `gh issue view --json state` で拾える（`docs/` と `.github/` を含める）
- **状態遷移表の ✓ が実在するテスト名を伴っているか**は `stateTransitionIndex` と同じ位置に置ける
- `countMovesToDelete` と `deleteBranchInKifu` の一致は property test（ランダムな入れ子棋譜）

## 結果（書き戻し）

| 所見                      | 直したコミット | 何をしたか                                                                 |
| ------------------------- | -------------- | -------------------------------------------------------------------------- |
| K1-1                      | `f67a2eb`      | 候補を再帰で数える。入れ子の fixture を足して変異で確認                    |
| K1-2                      | `f67a2eb`      | 開いた面が変わったときだけ取り込む                                         |
| K1-3                      | `f67a2eb`      | 閉じる前に必ず再試行。止めるのは初回だけ                                   |
| K1-4                      | `f67a2eb`      | `doSaveRef` から最新を読む                                                 |
| K1-5                      | `f67a2eb`      | `GamePersistence.absPath` と `persistIfPossible` の門番                    |
| K1-6 / K1-8 / K1-9 / K1-7 | `9d3a63d`      | 書けたときだけ閉じる。主語を空にしない。`forkIndexOrNull`。#277 へ張り替え |
| K1-10                     | `09129f1`      | ✓ の範囲を注に。`app.md` / `failure-surfacing.md` / ADR-0004               |

送ったもの: 無し（#276 / #277 が既に持っている）。

## このラウンドで分かったこと

**私が書いたテストが2本とも、主張を固定していなかった。**

- `countMovesToDelete` の照合側が `forks?.flat()` で1段しか数えず、入れ子の差を見逃した
- `KifuCommentNote` の「メモリの棋譜が動く」経路が、再レンダを起こしていないので発火しなかった

どちらも**変異を当てるまで気づけなかった**（`/implement` 手順6）。
`branchEdit.test.ts` の範囲検査でも同じことが起きている（`toThrow()` が
別の理由の TypeError で通っていた）。**このセッションで3回目。**

共通しているのは「テストが緑になった理由を確かめていない」こと。
次からは、テストを書いたら**必ず対になる変異を1つ決めてから**緑にする。
