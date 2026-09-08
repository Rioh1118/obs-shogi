# レビュー 502-engine-never-returns ラウンド7

- 日付: 2026-09-09
- 範囲: `fix/441-stop-analysis-on-unmount...HEAD`
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 対象コミット: `63bb96d0`
- 前ラウンド: [r1](2026-09-08-502-engine-never-returns-r1.md) 〜 [r6](2026-09-08-502-engine-never-returns-r6.md)

**r1〜r6 の所見は1件も再掲されなかった。**

## 対象そのものを疑う

**振る舞いの欠陥が0件になった。** r7 の所見は12件だが、**うち11件は
「私が r6 で入れた直しの、doc とテストが主張どおりに働いていない」**で、
利用者に届く壊れ方は1つも出ていない。

| ラウンド | 振る舞いの欠陥               |
| -------- | ---------------------------- |
| r1       | 2（BLOCK）                   |
| r2       | 1（HIGH）                    |
| r3       | 1（HIGH。私が r2 で作った）  |
| r4       | 2（BLOCK。私が r3 で作った） |
| r5       | 1（BLOCK。私が r4 で作った） |
| r6       | 1（HIGH）                    |
| **r7**   | **0**                        |

**r7 の所見が集中しているのは「検査が名乗るものを見ていない」**——r6 と同じ場所。
r6 で「分類を現物の振る舞いから引き直す」と書いて置いた `test.each` は、
**戻る側の窓を永久に返らない起動で作っていたので恒真だった**（`RECOVERABLE_NOT_READY_REASONS` を
完全に反転しても緑。3人が独立に実測）。

**根は同じ**——性質そのものではなく、その周りを assert していた。r7 では
**戻す口の有無を両方向で見る**形にし、反転すると2本とも落ちることを確かめた。

## 所見

### HIGH-1 `engine.md` の ※7 が、`willRetryAfterError` を足した `97066f32` に追随していない（react / oss-hygiene / architecture / robustness の4本）

3つの文書（`provider.tsx` のコメント・`types.ts` の `RECOVERABLE_NOT_READY_REASONS`・
`analysis.md` の ※5）が「**どの理由が戻るかは ※7 が持つ／ここに写さない**」と
名指ししている表が、`phase: "error"` の**全部**を `failed`（戻らない）と書いたまま。
**r6 の HIGH-1 で直したばかりの誤りを、読んだ人が書き戻す形。**

### HIGH-2 `test.each` の戻る側が恒真（architecture / react / comment の3本。実測）

`if (isRecoverableNotReady(reason)) expect(isRecoverableNotReady(...)).toBe(true)`。
`starting` の窓を永久に返らない起動で作っているので状態が動かず、
式は分類の定義に還元される。`?? "starting"` の既定値が、ready へ着いた回まで合格側へ寄せていた。

**実測**——`RECOVERABLE_NOT_READY_REASONS` を `["failed"]` に反転しても engine の12本は緑。
`idle` の枝から `initialize()` を消しても `starting` の回は緑。

### MEDIUM-3 `willRetryAfterError` と effect の枝が `lastTried === null` で逆を向く（react / architecture / comment / robustness の4本）

effect は起動し直し、三項は終端を名乗る。**いまは踏めない**（`error` へ入る口が
`initialize` だけで、そこは `lastTriedRef` を先に埋める）が、
**コメントが「見る条件は下の `error` の枝と同じ」と断言している**。
`error` へ入る口が2つ目になった瞬間、赤くなるものが何も無いまま r6 の HIGH-1 が戻る。

### MEDIUM-4 ※15 の「次の一手」を2行のうち1行しか直していない（oss-hygiene / robustness）

文言は2本とも ▶ の押し直しで終えたのに、表は `ENGINE_FAILED_WHILE_ANALYZING_MESSAGE` だけ。
**r6 の MEDIUM-10（「2箇所を名指ししたのに直したのは片方だけ」）と同じ形が同じ PR で再発。**

### MEDIUM-5 F-38 / F-39 の出典に書いたコミットに、その行が無い（oss-hygiene）

`3cd256fc` には F-39 も、いまの F-38 の本文も無い（採ったのは `7b097266`）。
**出典を書いた `97066f32` 自身が、その分類を広げている。**

### MEDIUM-6 台帳が「台帳の中では書かない」と決めた「段」が、同じ台帳の F-38 に残っている（oss-hygiene）

但し書きが免除したのは「**他の doc の**」用法だけだった。

### MEDIUM-7 `slice(2)` の生の数（comment）

隣の2本は `const from = view.reasons.length` を取っている。マウント時のコミットが
1回増えるだけで、窓の手前から数え始めて `toContain` が素通りする。

### MEDIUM-8 `types.ts` の `starting` の TSDoc が、再トライを待つ窓を覆えていない（oss-hygiene）

「`phase` は `ready` のまま」と書いてあるが、その窓は `error`。

### MEDIUM-9 IDEAS の括弧が閉じていない（oss-hygiene）

`97066f32` で旧文を置き換えたときに外側の閉じ括弧が落ちた。

### 差分の外

- `cutRunningAnalysis(refusal: string)` の型付け（architecture が r6 で挙げ、
  r6 で #277 へ寄せると反論した件）。**r7 では再掲されなかった**

## 回し方の問題（reviewer から）

**並走する reviewer が同じワークツリーで変異を当て合い、互いの実験を壊している。**
react は「12本中10本が落ち、同時に別プロセス由来の `console.log` が `git status` に出た」
ため**変異実験を全て取りやめ**、所見3件を読解だけで立てた。architecture も
「上の実測値は並行編集が同時に入っていた可能性を排除できていない」と申告している。

**これは私の回し方の問題。** reviewer ごとに worktree を切るか、変異を当てるのを
1人に限る取り決めが要る。**r7 の実測値のうち、単独で再現を確認できたものだけを
上に採った**（`RECOVERABLE_NOT_READY_REASONS` の反転は3人が別々に同じ結果を出しており、
私自身も修正後に反転を当てて2本落ちることを確認した）。

## 修正の結果（`/review-fix`）

| 所見                            | 結果                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| HIGH-1 / MEDIUM-8               | `29f03653`。※7 の2行を三項の条件に合わせ、述語の出典を1行足した。`starting` の TSDoc も広げた   |
| HIGH-2                          | `29f03653`。戻る側を「待つ相手を解決すると ready へ着く」窓にし、**戻す口の有無を両方向で見る** |
| MEDIUM-3                        | `29f03653`。`retriesAfterError` に括り出し、三項と effect の両方から呼ぶ                        |
| MEDIUM-4 〜 MEDIUM-7 / MEDIUM-9 | `29f03653`                                                                                      |

**変異を当てて確かめたもの**（名指しした assert が落ちることまで）——
`RECOVERABLE_NOT_READY_REASONS` を `["failed"]` に反転すると、`starting` と `failed` の
**2本とも**落ちる（**直す前は 12/12 緑だった**）。

## 見ていない範囲

- `perf` / `ui` / `rust` reviewer は7ラウンドとも走らせていない
- **実プロセスでの確認は7ラウンドを通して1件も無い**
- 基底ブランチ側でも `analysis.md` が動いている。マージ時の衝突は見ていない
- `MEDIUM-3` の窓は**いまのコードでは作れない**ので、テストで固定していない
  （踏める口が増えたときに作ること）

## 次ラウンドの焦点

1. **`retriesAfterError` を effect からも呼ぶようにしたので、effect の依存に
   `willRetryAfterError` が入った。** 再実行の頻度が変わっていないか
2. **`starting` の窓の作り方を変えた**（永久 pending → 解決できる deferred）。
   他の11本のテストと mock の張り方が衝突していないか
3. **※7 の表を条件付きに書き換えたので、`failed` の行が長くなった。**
   `analysis.md` の ※5 と `types.ts` の doc が、その条件を写していないか（写さない約束）
