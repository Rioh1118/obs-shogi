# レビュー 441-unmount-session ラウンド21

- 日付: 2026-09-08
- 範囲: `git diff origin/main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / oss-hygiene / architecture
- 対象コミット: `d9fa9dcf`
- 前ラウンド: [r19](2026-09-07-441-unmount-session-r19.md) / [r20](2026-09-07-441-unmount-session-r20.md)

## 所見

### [HIGH] 1. r20 が塞いだのは「席が返ってきた回」だけで、Rust が `Err` を返す**もう半分**が漏れている

reviewer: robustness（実測）

`takeSeatAndGo` の世代の判定は `startInfiniteAnalysisCore()` が **resolve した**ときしか通らない。
畳んでいる最中のエンジンへの `start_infinite_analysis` は `Err` で返る（`bridge.rs`）ので、
**現物ではこちらのほうが起きやすい**。

```
A1 error= 解析を再開できませんでした。▶ を押しても始まらないときは、設定でエンジンのオプションを…
A1 analyzing= false
A2 startCore= 2   ← エンジンが戻って 400ms。再開が張り直されない
B1 error= null    ← 隣の枝（resolve）。黙って降りる
B2 startCore= 3   ← 戻ったら同期の追従が張り直す
C1 error= 解析を開始できませんでした。設定でエンジンのオプションを変えて保存すると起こし直せます。
```

**隣り合う枝で、片方は無傷、片方は死ぬ。** 自動再開の回は `stop_analysis` が dispatch されて
`isAnalyzing` が倒れ、**盤を動かしても解析が戻らない**。▶ の回は「起こし直してください」
——**利用者がいま済ませたばかりの操作**——を案内する。

### [BLOCK] 2. コメントが名指す識別子が2つ、リポジトリに存在しない

reviewer: comment

- `provider.tsx` の「`hold` / `discard` に着くまでの微小タスク」——`hold` は r20 で公開面から消えた
- `runRestart` の catch（2箇所）——束縛は `runRestartRef` で、その catch は `swapSeatAndGo` へ移った

どちらも**触ると壊れる理由**を持つ唯一の場所。**このブランチで5ラウンド続けて出ている故障**で、
`src/**` の TS コメントだけが機械の穴に落ちている（Rust は `comment_identifiers`、
`docs/**` は `docsIdentifiers` が見ている）。

### [HIGH] 3. 「呼び手はこの3値を全部書き分ける」を、2人のうち1人が1つも書き分けていない

reviewer: comment / architecture（独立に）

`swapSeatAndGo` は `await takeSeatAndGo(...)` と式文で捨てている。契約は r20 の所見1
（枝ごとに後始末が落ちる）の再発を止めるために置いたもの。**契約と現物のどちらが正か**が
書かれていないので、3人目の呼び手を足す人が判断できない。
`asyncResultUse` は同じ形の綴りを `AsyncResult` に対して既に禁じているが、
`Promise<SeatTakeResult>` は拾わない。

### [MEDIUM] 4. `"engine-gone"` の断りだけが「要らなくなった要求」の門を通らない

reviewer: react（実測）

`landed` はエンジンを先に見るので、棋譜を閉じた回・畳まれた回も `"engine-gone"` が返る。

```
P1 error= エンジンを起こし直したので、解析を始められませんでした。もう一度 ▶ を押してください。
P2 error= null   ← 棋譜を閉じるだけの回（比較）。静かに resolve する
P4 caught= Error: engine was restarted while taking a seat   ← 畳まれた回でも同じ
```

`types.ts` の公開面の契約は「要らなくなった要求は静かに resolve する」。
#277 で欄を出した瞬間、**利用者が取り消した操作の断りが、次に棋譜を開いた画面で出る**。

### [MEDIUM] 5. 本番コードが `@/__tests__/` を読める。この PR がその辺を制度化した

reviewer: architecture（実測）

`entities/analysis/lib/candidates.ts` に `import { REPO_ROOT } from "@/__tests__/walk"` を足して
`npm run lint` は**緑**、`tsc -b` も通る。`vite.config.ts` は「`src/__tests__/` はレイヤに
属さない」を**片方向しか**守っていない。この PR は `*.ratchet.test.ts` を制度化したので、
**今後のスライス側ラチェットは全部この辺を通る**。

### [MEDIUM] 6. `debounceTimerRef` が発火で null に戻らず、「タイマーが張られているか」の門が嘘を返す

reviewer: react（実測。発火済み id への `clearTimeout` を数えた）

```
P8  analyzed= P2  clearedAfterFire= 1
P8b analyzed= P3  clearedAfterFire= 2
```

いま実害が出ないのは**別の effect の cleanup** に預けているからで、門自身が守っている条件ではない。
同じファイルの `scheduleFlush` / `clearFlushTimer` は正しい形をしている。

### [MEDIUM] 7. 「飛んでいる再開があるなら予約する」が2箇所の手書きになっている

reviewer: architecture

r20 の直しが「同じ門をもう1箇所に写す」だったので、次に門の中身が変わったとき片方だけ直る形が
残っている。**このファイル自身が「書き下ろしを2つ持つと片方だけに入る」と書いた直後**。

## MEDIUM

8. **▶ の本体に段ごとの説明ブロックが6つ残っている**（comment）。r20 は同じ基準で自動再開を割った。
9. **「上限や刻みを変えるときは両方を直すこと」——その2つは同じ定数を読んでいる**（comment）。
   二重化しているのは値ではなく**待ちの形**。
10. **`readinessRef` の doc が挙げる結末が、指している型の doc にも実装にも無い**（comment）。
11. **※15 の「起こし直す（※5）」が、起こし直し方を持たない方の ※5 を指す**（comment）。
    番号が偶然どちらも5。
12. **「呼び手が `isHeld()` を見るのは1箇所だけ」が現物と違う**（architecture）。2箇所ある。
13. **「埋まっていないセル」が、この branch のテストが踏んでいる `(S4, E10)` を未検証と名指す**
    （robustness）。**r19 の所見5・9 と同じ罠が3ラウンド目。**
14. **CONTRIBUTING が `exportsTested` を手本として名指した直後に、それが破っている規約を書いている**
    （oss-hygiene）。`readdirSync` を自前で書き、起点も `walk.ts` から引いていない。
15. **走査範囲の散文が4箇所に増えた**（oss-hygiene）。判定は1箇所に寄ったのに説明が散った。
16. **`analysis-pane.md` の失敗の表に、自動再開が落ちた回の行が無い**（oss-hygiene）。
    **利用者が最も踏みやすい失敗**（ボタンを1つも押していない）。
17. **skill 2本が、CLAUDE.md が名指しで禁じた所要時間を持つ**（oss-hygiene）。
    片方は CLAUDE.md を出典として引いているが、そこにはもう数字が無い。
18. **CONTRIBUTING から `docs/spec/` への導線が無い**（oss-hygiene）。義務の出典が
    エージェント向けのファイルにしかない。この PR が `spec/screens/` を走査対象にしたので、
    外部の人が予告のパスを書くと突然赤くなる。

## 範囲の外（この PR では直さない）

reviewer: oss-hygiene。**どれも #441 と無関係**なので issue へ送る。

- **配布物が CSP で読めない Google Fonts に依存している。** `style-src` / `font-src` に
  オリジンが無く、dev と配布物で字面が違う。**直し方に設計の選択が要る**
  （フォントを同梱するか、外部フォントをやめるか）
- **手元でビルドする前提が2箇所に重複し、Tauri のシステム要件と固定ツールチェーンを欠く**
- **第三者のコードと素材の帰属表示が無い**（未使用の画像2枚も同梱されている）
- **README の看板画像が現行 UI と違う**（ボタン5個。🔖 が無い）

## 重複・矛盾した所見

- 所見3 は comment と architecture が別の入口（契約の文／機械の不在）から同じ行に到達した。
- 矛盾は無し。

## 見ていない範囲

- `analyzer.rs` / `protocol.rs` の内部と #463 の窓の幅。**21ラウンド続けて未見。**
- 実プロセス（本物の USI エンジン）を使った検証は誰もしていない。
- 「埋まっていないセル」の残り5行の突き合わせ（所見13 で挙げた分）。
- `shutdown_engine` の invoke 自体が落ちた回（フロントは席を忘れた後）。

## 修正計画

順は「振る舞い → 機械 → 構造 → doc」。

1. **所見1 → `SeatTake.engineChanged()` を足し、`takeSeatAndGo` が開始の reject を包む。**
   消えたエンジンへの要求だったなら `"engine-gone"` に合流させる。テスト3本
2. **所見4・6 → `"engine-gone"` の断りに要求の門を足し、発火でタイマーの欄を空ける。** テスト2本
3. **所見7 → 予約の判断を `bookIfRestarting` 1つに寄せる**
4. **所見2 → `src/**` の TS コメントが名指す識別子を機械で見る。** `docsIdentifiers` の
   `missingIn` / `codeOf` がそのまま使える。**5ラウンド続いた故障に対する唯一の機械**
5. **所見3・5・14 → `asyncResultUse` の対象を広げ、本番から `@/__tests__/` を禁じ、
   `exportsTested` を `walk.ts` へ寄せる**
6. **所見8 → ▶ の本体を段ごとに割る**
7. **所見9〜13・15〜18 → doc とコメント**
8. **範囲の外の4件 → issue**

**壊しうるもの。** 1 は `takeSeatAndGo` の失敗の扱いを変えるので、`START_REFUSED_MESSAGE` を
固定している既存テストの前提に触る。4 のラチェットは**いま2件の違反を抱えている**ので、
同じコミットで直すこと。5 の `asyncResultUse` は逃げ道の綴りを1件足す必要がある。

### 次ラウンドの焦点

- 1 の `engineChanged` が、**エンジンが消えていないのに Rust が断った回**（#172 の本来の枝）を
  飲み込んでいないか
- 4 のラチェットが、**テストの中のコメント**や**意図的に落とした名前**で誤検出を出していないか
- 6 で割った関数が、呼び手の順序依存（門を通してから呼ぶ）を守れているか

## 修正の結果

（このラウンドの修正はこれから）
