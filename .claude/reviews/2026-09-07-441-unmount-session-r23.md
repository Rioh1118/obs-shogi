# レビュー 441-unmount-session ラウンド23

- 日付: 2026-09-08
- 範囲: `git diff origin/main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / oss-hygiene / architecture（**5人とも走り切った**）
- 対象コミット: `bd4c6c07`
- 前ラウンド: [r21](2026-09-07-441-unmount-session-r21.md) / [r22](2026-09-07-441-unmount-session-r22.md)

## 所見

### [HIGH] 1. 起こし直しの窓で「設定でエンジンを選んでください」が出る。避けるために作った型が、その窓を取りこぼしている

reviewer: comment

```ts
// types.ts の `EngineNotReadyReason` の doc
// 「その窓で『エンジンを選んでください』と案内すると、起こし直しを案内された
//   利用者がその指示に従った直後に、もう一度同じ指示を受ける」

// provider.tsx の導出
state.phase === "error" ? "failed"
  : state.phase === "initializing" || (state.phase === "ready" && !!desiredRuntime) ? "starting"
    : "no-engine";
```

`restart()` は `shutdown()` → `initialize()` で、`shutdown` の reducer は **`phase: "idle"`**。
2つの dispatch の間には本物の `await` があるので**その状態は必ず commit される**。
`idle` は `starting` のどの枝にも当たらないので `"no-engine"` に落ちる
——**この型と定数が5ラウンドかけて避けようとした、まさにその文言**。

`provider.test.tsx` は `useEngine` をモックするので、この導出はテストが1本も触っていない。

### [HIGH] 2. `asyncResultUse` の下限が集計なので、この PR が足した枝を丸ごと落としても緑

reviewer: architecture（実測）

| 変異 | names.size | 判定 |
| --- | --- | --- |
| 現状 | 32 | 緑 |
| `AsyncResult<` を落とす | 1 | 赤 |
| **`Promise<SeatTakeResult>` を落とす** | **31** | **緑** |

名前の総数は `entities/file-tree` の 31 本が支配しているので、**この PR に関係する半分**だけを
消しても集計は1しか動かない。呼び出しは1箇所で既に印が付いているので offender も増えない。

### [HIGH] 3. `EXEMPT` に検査の名前が2件残っている——「足さないこと」と書いた同じファイルの中で

reviewer: oss-hygiene / architecture（独立に。どちらも実測）

r22 の直しは `asyncResultUse` **1件だけ**を外し、同じ理由で入っていた
`analysisRefusals` / `docsIdentifiers` を残した。外すと赤くなるのは3行
（`analysis.md` / `failure-surfacing.md` / `yaneuraou-db-parse.md`）で、
**いまその3行は改名しても黙って死ぬ**。r22 の所見3 が BLOCK と判定した故障がそのまま残っている。

### [HIGH] 4. ※13 / ※15 が、readiness で4本に割れた断りを1本しか持たない

reviewer: comment / robustness（独立に）

※13 自身が「開始が `Err` で返るほうが現物では起きやすい」と書いており、その枝は着地時点で
まだ `starting` なので**ほぼ必ず `ENGINE_STARTING_MESSAGE` に落ちる**。表が名指ししているのは
3本のうちいちばん起きにくい枝だけ。`ENGINE_STARTING_MESSAGE` の行を読んだ人は、
この入口があることを知らずに文言を「まだ押していないなら待って」の方向へ寄せられる。

## MEDIUM

5. **`takeSeatAndGo` の reject の枝だけが `dropPendingForLostSeat()` を通らない**（react。実測）。
   `PROBE candidates= 1` 対 `CMP candidates= 0`。**いま画面に出ないのは Rust がこの枝で
   `info` を配り始めないからだけ**で、その依存はどちらのファイルにも書かれていない。
6. **再開のタイマーを消す義務が呼び手4箇所に散り、2つの形に割れている**（react。実測）。
   置換の側（手書きの `clearDebounceTimer`）は3箇所とも**落としてもテストが緑**。
   r21 が足した「発火で欄を空ける」も無検査。
7. **`commentsOf` の7本が、行コメントを 492 本落とす変異を1つも殺さない**（architecture。実測）。
   7本のうちブロックと行コメントを同時に含む入力が1つも無い。**実ファイルは必ず両方を持つ。**
8. **`analysisRefusals` の否定の判定が matcher を列挙している**（robustness。実測）。
   `.not.toStrictEqual` / `.not.toMatch` に書き換えると素通りする。
9. **`asyncResultUse` は「行頭に来ない呼び出し」で抜けられ、その境界が doc に無い**（architecture。実測）。
   `setTimeout(() => void f(...), 0)` / `if (ok) void f(...)` / 代入。
10. **`asyncResultUse` の冒頭の契約が「`await f(...)` だけを見る」のまま**（comment）。
    判定は r22 で直したが、**ファイルを開いて最初に読む行**は直っていない。
11. **`docsIdentifiers.ts` の冒頭が「docs の検査」とだけ名乗っている**（comment）。
    `EXEMPT` に doc ブロックが2つ連続している（Rust 側が止めている形）。
12. **`failStart` の「▶ の失敗はどの段もここを通る」に例外が1つある**（comment）。
13. **`discard` と engine-gone の段に「関数を分ける合図」が残っている**（comment）。
14. **Rust 側2ファイルが「免除は3つ／`docsIdentifiers` の EXEMPT は `docs/**`」の写しのまま**（architecture）。
15. **`AnalysisPane.tsx` の `posKey` が局面でないものを指している**（comment）。中身は `tesuuPointer`。
16. **`provider.tsx` が946行・ref 18本・effect 10本**（react）。所見5 はその中の「組」が
    分かれていない結果。反映待ちの7つは外から触るのが `dispatch` と `analyzingRef` だけ。
17. **r21 の「修正の結果」が、取り消した判断を今も正として記録している**（oss-hygiene）。
    #504 / #505 / #506 は閉じたのに「issue へ」のまま。
18. **r22 の表の行18 が、現物を触っていないコミットを指している**（oss-hygiene）。
19. **`docs/state-transitions/README.md` の「これらの表の中で」が範囲より狭い**（oss-hygiene）。

## 確かめて問題が無かったもの

- **「埋まっていないセル」の5行は本当に未検証**（robustness が全 `it` に当てて確認）。
  **同じ故障の5ラウンド目は無かった。**
- **立たないまま終わる ▶ の枝は無い**（robustness が降り口を全部数えた）。
- **`engineChanged()` は「Rust にはまだ席が在る」回を飲み込まない**（robustness が引き金を遡って確認）。
- **`readinessRef` を書く effect は `onEngineGone` を呼ぶ effect より前に宣言されている**
  ので、世代より古い readiness を読む窓は無い（react）。
- **`testsLayerBoundary` の逆向きは実測で閉じている**（architecture が7通り試した）。
- **依存の方向の違反は0件**、`useCallback` / `useMemo` 23個すべて効いている（react / architecture）。

## 見ていない範囲

- `analyzer.rs` / `protocol.rs` の内部と #463 の窓。**23ラウンド続けて未見。**
- 実プロセスでの検証。誰もしていない。

## 修正計画

順は「振る舞い → 機械 → 表 → 構造 → doc」。

1. **所見1 → `notReadyReason` を `desiredRuntime` で割る。** `EnginePhase` の `switch` にして、
   値を足したときの書き落としを tsc に落とさせる。テスト1本（engine 側は初）
2. **所見5 → `takeSeatAndGo` の出口を1本に畳む。** テスト1本
3. **所見2・7・8・9・10 → 機械の穴。** 名前を名指しで固定、行コメント混在の入力、
   否定の判定を `\.not\.\w+\(` へ、境界を doc に書く
4. **所見3・11・14 → `EXEMPT` から検査名を外し、機械で禁じる。** Rust 側の写しも畳む
5. **所見4 → ※13 / ※15 を4本の割れに合わせる**
6. **所見6 → タイマーを消す義務を `scheduleRestart` の中へ畳む**
7. **所見12・13・15・17・18・19 → doc とコメント**
8. **所見16 → 反映待ちを `useResultFlush` に切り出す**（所見5 を畳んだ後）

**壊しうるもの。** 1 は `entities/engine` の振る舞いを変えるので、断りを固定している
既存テストの前提に触る。3 で免除を外すと3行が赤くなるので同じコミットで直すこと。
6 は4箇所の呼び手を同時に触る。

### 次ラウンドの焦点

- 1 で `idle` を `starting` に寄せたことで、**本当にエンジンを選んでいない回**に
  「起動を待っています」が出ていないか
- 2 で畳んだ出口が、**握れた回**に反映待ちを落としていないか
- 8 で切り出したフックが、**畳まれた後のタイマー**を残していないか

## 修正の結果

| 所見                 | 結果                                                                                | コミット                            |
| -------------------- | ------------------------------------------------------------------------------------ | ----------------------------------- |
| 1                    | 直した。理由を `desiredRuntime` で割った。**`entities/engine` 側のテストは初**       | `530b8cfe`（テスト3本、変異で確認） |
| 5 / 6                | 直した。握れなかった回の出口を1本に、タイマーを消す義務を張る側へ                    | `e11c93f2`（テスト1本、変異で確認） |
| 2 / 3 / 7 / 8 / 10   | 直した。枝ごとに名指し、混ぜた入力、`not` の後ろを問わない、境界を doc に            | `ac22cb8d`（どれも変異で確認）      |
| 4 / 11 / 12 / 14 / 15 / 17 / 18 / 19 | 直した                                                              | `e6363b69`                          |
| 16                   | 直した。反映待ちを `useResultFlush` に閉じた（946 → 905 行、ref 18 → 5）             | `86008fe6`                          |
| 13                   | 直した。`foldIntoSlot` に割った                                                     | `9044adad`（変異で確認）            |

### 所見3 について

`EXEMPT` から検査の名前を外すだけでなく、**入れられなくする検査**を足した。
この形は3件入って2回に分けて外しているので、人の注意で止める段は過ぎている。

### このラウンドで分かった、こちらの誤り

- **r22 の直しは `asyncResultUse` 1件だけを外して、同じ理由の2件を残した。**
  「同じ理由のものが他に無いか」を確かめずに、指摘された1件だけを直していた。
- **r22 で締めた3つの判定は、どれも実測で抜けられた。** r22 の記録に「抜け道に変異を
  当てていなかった」と書いた反省が、そのラウンドの修正には効いていない。
