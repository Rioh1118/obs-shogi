# レビュー 441-unmount-session ラウンド22

- 日付: 2026-09-08
- 範囲: `git diff origin/main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / oss-hygiene / architecture
- 対象コミット: `9d6d59ee`
- 前ラウンド: [r20](2026-09-07-441-unmount-session-r20.md) / [r21](2026-09-07-441-unmount-session-r21.md)

**react は API の週次上限で途中終了した**（所見0件。走り切っていない）。
残る4人の所見だけでこのラウンドを組む。**次のラウンドで react を必ず走らせること。**

## 所見

### [HIGH] 1. r21 で足した `asyncResultUse` の判定は、`await` を消すだけで抜けられる

reviewer: architecture（実測）

```
void takeSeatAndGo(seq, want, "late-restart").catch(() => {});   → 1 failed
takeSeatAndGo(seq, want, "late-restart").catch(() => {});        → 1 passed（lint も緑）
```

判定は頭に `void ` か `await ` を要求する。**素の呼び出しが最も普通の投げっぱなしの形**で、
そこは見ていない。しかも素の呼び出しは順序も失うので、席の返却が `finally` より後へずれる。

### [HIGH] 2. r21 で足した `testsLayerBoundary` の逆向きは、綴りが `@/` のときしか当たらない

reviewer: architecture（実測）

`src/main.tsx`（アプリの入口）に `import { REPO_ROOT } from "./__tests__/walk";` を足すと、
`npm run lint` / `tsc -b` / ラチェットの**3つとも緑**。同じファイルの順方向
（`appReference`）は `(?:@/|\.{1,2}/)` と相対も見ているので、これは意識した除外ではなく漏れ。

`src/main.tsx` は `node:fs` が本番の束に入ると**いちばん致命的な1ファイル**（入口なので
ツリーシェイクの逃げ道が無い）。CONTRIBUTING は「本番のモジュールから読むと落とします」と
断言しているので、この形で入ったものは機械が守っている前提のまま通る。

### [BLOCK] 3. `docsIdentifiers` の「見るのは `docs/**` だけ」が、この PR で嘘になった

reviewer: comment / architecture / oss-hygiene（3人が別々の入口から）

`missingIdentifiers` / `EXEMPT` / `IDENTIFIER` は r21 から**2つの走査範囲**を裁いている。
`docsIdentifiers.ts` を開いた人は「docs の検査だけ」と読むので、`docs/**` にしか出ない綴りを
`EXEMPT` に足したとき、**同じ綴りが `src/**` のコメントでも黙って免除される**ことに気づけない。

実害が既に1件ある——`EXEMPT` に足した `asyncResultUse` は `src/**` のコメント2箇所が
唯一の出典で、`docs/**` には1件も出ない。**免除に入れた瞬間、その2箇所は二度と検査されない**。
r21 所見2 の再発を止めるために入れた機械が、その最初の1件で無効化されている。

### [HIGH] 4. IDEAS と issue に同じ3件が生きていて、判断が逆

reviewer: oss-hygiene

`docs/IDEAS.md` は「**6週間以内に着手しない**」、#504 / #505 / #506 は OPEN。
**これは r21 でこちらが作った矛盾**——ラウンド6 が IDEAS へ送ると決めた3件を、r21 の
oss-hygiene が再度挙げたときに、IDEAS を確かめずに issue を立てた。
`docs/OPERATING-MODEL.md` は「`docs/IDEAS.md` は issue にしない」と決めている。

### [MEDIUM] 5. 「埋まっていないセル」の残り5行のうち2行を、既存テストが踏んでいる

reviewer: robustness（実測）

`(S3, E11)` は `provider.test.tsx` の「飛んでいる返却が落ちたら…」が、
`(S2〜S5, E6)` の S4 は r21 が同じラウンドで足した2本が踏んでいる。
**r19 所見5・9、r21 所見13 と同じ故障が4ラウンド目**で、しかも「行を足す／消すときは
`provider.test.tsx` を grep すること」と書いた同じコミットが2行を残している。

### [MEDIUM] 6. 断りを踏むテストの検査が、`.not.toBe` でも通る

reviewer: robustness（実測）

この PR は `START_REFUSED_MESSAGE` に肯定と否定を1本ずつ持っている。
**「その断りが出ないこと」を確かめる行が、そのまま「踏んでいる」の根拠に数えられる。**
肯定形の当たりを落としても緑のまま。

### [MEDIUM] 7. 起こし直しの断りが案内した「もう一度 ▶」が、その瞬間には効かない

reviewer: robustness（実測）

```
A1 error= エンジンを起こし直したので、解析を始められませんでした。もう一度 ▶ を押してください。
A2 error= エンジンを起動できていません。設定でエンジンのオプションを…      ← 押し直した結果
```

同じファイルの `sendAndAwaitSync` は**まったく同じ判断をしないように**書いてある
（「上限まで待たせてから違う理由を告げないこと」）。

### [MEDIUM] 8. `commentsOf` に単体テストが1本も無く、ブロックコメントを丸ごと落としても緑

reviewer: architecture（実測）

`commentsOf` を行コメントだけ返す形に潰しても 20 passed。この変異は TSDoc を全部
走査から外すので、**r21 所見2 の腐り2件はどちらもこの変異で見逃される**（両方 TSDoc の中）。
`codeOf` は同じ危険に12本のテストを持つのに、その裏返しは0本。

### [MEDIUM] 9. `asyncResultUse` が `codeOf` を通さないので、自分の doc から関数名を拾っている

reviewer: architecture（実測）

`names.size` は 33、うち2件（`f` / `MUST_READ`）は**自分の doc の例文**由来。
`f` が入っているので、`src/**` のどこかで1文字名のヘルパを式文で `await` した瞬間、
無関係な理由で赤くなる。

## MEDIUM

10. **`docs/state-transitions/README.md` が「`docs/state-transitions/` にしか掛かっていない」と書いている**（oss-hygiene）。r21 が `spec/screens/` を走査に入れたので嘘。しかも赤を直す規約はこの節にしかない。
11. **走査範囲の散文は4箇所残っている**（oss-hygiene）。「ここに写さない」の5行上に写しがある。
12. **`docs/spec/README.md` に識別子の規約が無い**（oss-hygiene）。CONTRIBUTING はそこを出典に指している。
13. **`review-plan/SKILL.md` が3本目の「所要時間は CLAUDE.md の検証節」**（oss-hygiene）。`tidy-commits` は禁止を書いた11行下で `20分` を判断の根拠に据えている。
14. **CONTRIBUTING のラチェットの表が2行で現物と食い違う**（oss-hygiene）。`testsLayerBoundary` の逆向きが載っていない／`srcCommentIdentifiers` の除外が SCSS だけになっている（`__tests__` も外れている）。
15. **`startInfiniteAnalysis` の doc が数える4段のうち、4段目だけが約束を満たさない**（comment）。段を1つ足す人が読む契約なので、断りの立て方が2通りに割れる入口。
16. **タイマーから呼ぶ本体を毎描画で差し替える理由が書かれていない**（comment）。`useCallback` に包むと本体が古い描画の値で凍る。
17. **`srcCommentIdentifiers` の doc が変更前の状態を過去形で書いている**（comment）。`CONTRIBUTING.md` が禁じている形。
18. **`testsLayerBoundary` の doc が「テストかどうかだけ」と書きながら、置き場で分けている**（comment）。
19. **`takeSeatAndGo` と `shoot` に「関数を分ける合図」が残っている**（comment）。
20. **`asyncResultUse` は `landed` の戻り値を見ていない**（comment）。3値を最も守らせたいのはそちら。
21. **`(S4/S5, E10)` の行き先が2つに割れたのに、表と ※15 は片方しか持たない**（robustness）。
22. **`(S0/P1, E6)` が「—」のまま**（robustness）。この PR の主題そのものの枝。
23. **※13 が判定の口として `landed` しか名指していない**（robustness）。起きやすいほうの半分（`engineChanged()`）が doc に無い。
24. **`analysis-pane.md` の自動再開の行が、両立しない2つの結末を1行に潰している**（robustness）。`set_error` は `isAnalyzing` を倒すので、「断りが載る」と「解析中のまま止まる」は同じ回に起きない。
25. **`src/__tests__/` に `commentsOf` が2つあり、片方は自分が危険だと名指しした形**（architecture）。

## 確かめて問題が無かったもの

- `engineChanged()` は #172 の本来の枝を飲み込んでいない（robustness が実測）
- 断り12本すべてに肯定的な当たりがある（ただし所見6 の穴あり）
- `"engine-gone"` の要求の門は、断るべき回を黙らせていない
- 依存の方向の違反は0件（architecture が機械で洗った）

## 見ていない範囲

- **react の観点は今回まるごと未検査**（上限で途中終了）。
- `analyzer.rs` / `protocol.rs` の内部と #463 の窓。**22ラウンド続けて未見。**
- 実プロセスでの検証。誰もしていない。
- `(S6/P0, E5)` / `(S4/S5, E11)` / `(S5, E2)` の現物の振る舞い（テストが無いことだけ確認）。

## 修正計画

順は「自分が入れた機械の穴 → 振る舞い → 表 → doc」。

1. **所見1・2・9 → r21 で入れた機械の穴を塞ぐ。** 判定を素の呼び出しと相対パスへ広げ、
   `asyncResultUse` は `codeOf` を通す。**どれも変異で確かめる**
2. **所見3・25 → `EXEMPT` と `commentsOf` の持ち主を現物に合わせる。** `asyncResultUse` の
   免除を外し、コメントを指す正しい書き方を1つ決める
3. **所見8 → `commentsOf` の単体テスト**
4. **所見7 → 起こし直しの断りを readiness で割る**（`sendAndAwaitSync` と同じ形）
5. **所見6 → 断りの照合を肯定形に締める**
6. **所見4 → IDEAS と issue の重複を解く。こちらが作った矛盾**
7. **所見5・21〜24 → 表と注**
8. **所見10〜20 → doc とコメント**

**壊しうるもの。** 1 の `asyncResultUse` を広げると既存の呼び出しが新たに落ちうる
（`codeOf` を通すと逆に減る）。2 で免除を外すと2箇所が赤くなるので、同じコミットで
書き方を直すこと。4 は既存の `ENGINE_RESTARTED_MESSAGE` のテストの前提に触る。

### 次ラウンドの焦点

- **react を必ず走らせる**（今回まるごと欠けている）
- 1 で広げた判定が、**既存の正しい呼び出しを誤検出**していないか
- 4 で割った断りが、**エンジンが戻っている回に起動待ちの文言を出して**いないか

## 修正の結果

| 所見            | 結果                                                                                | コミット                            |
| --------------- | ------------------------------------------------------------------------------------ | ----------------------------------- |
| 1 / 2 / 8 / 9   | 直した。判定を素の呼び出しと相対パスへ広げ、`codeOf` を通し、`commentsOf` に7本      | `bfe59cd4`（変異で確認）            |
| 3 / 14          | 直した。免除から検査の名前を外し、コメントはパスで指す。表の2行も現物に合わせた      | `51811055`                          |
| 6 / 7           | 直した。断りを readiness で割り、照合から否定の当たりを引いた                        | `c9942ab4`（テスト1本、変異で確認） |
| 4               | 直した。issue #504 / #505 / #506 を閉じ、IDEAS を残した                              | `1db23729`                          |
| 5 / 21〜24      | 直した。踏んでいる2行を落とし、`(S0/P1, E6)` を埋め、※13 に `engineChanged` の枝     | `4ef1d149`                          |
| 10〜13 / 15〜17 | 直した                                                                              | `460da657`                          |
| 25              | 直した。`commentPatternFor` に改名し、危険の向きが逆である理由を書いた               | `a2c04658`                          |
| 19              | 直した。`dropPendingForLostSeat` / `keepOrForget` に割った                           | `c15f037c`                          |
| 18              | 直した（`460da657` に含む）。置き場で分けている事実をそのまま書いた                  | `bfe59cd4`                          |

### 所見20 について

`asyncResultUse` を `landed` まで広げる案は**採らなかった**。`landed` は interface の
プロパティなので `function ` / `const ` を頭に要求する判定に載らず、呼び出しも
`seat.beginTake(...).landed(...)` と2段のドットで、拾うには判定を別物に作り替えることになる。
**doc の側を現物に合わせた**——「`asyncResultUse` が止めるのは `Promise<SeatTakeResult>` を
返す口だけ。`landed` の戻り値は人が見る」。

### このラウンドで分かった、こちらの誤り

- **r21 で issue を3件立てたのは誤り。** ラウンド6 が `docs/IDEAS.md` へ送ると決めた
  3件を、IDEAS を確かめずに立て直していた。`docs/OPERATING-MODEL.md` は「issue に
  しない」と決めている。閉じて IDEAS 側を残した
- **r21 で入れた2つの機械は、どちらも実測で抜けられた。** 判定を書いた時点で
  変異を当てていなかった（当てたのは「違反が赤くなること」だけで、
  「抜け道が塞がっていること」は当てていない）
