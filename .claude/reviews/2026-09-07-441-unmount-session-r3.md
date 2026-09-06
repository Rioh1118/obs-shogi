# レビュー 441-unmount-session ラウンド3

- 日付: 2026-09-07
- 範囲: `git diff main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / oss-hygiene / architecture
- 対象コミット: `fd668a90`
- 前ラウンド: [r1](2026-09-07-441-unmount-session-r1.md) / [r2](2026-09-07-441-unmount-session-r2.md)

## 所見

### [BLOCK] 1. `npm run verify` が HEAD で赤い

reviewer: robustness / architecture（2人が独立に実測）

`provider.test.tsx` が `@/entities/engine/api/rust-types` を直に読んでいて、
`src/__tests__/sliceBarrels.test.ts` が落ちる。入ったのは `95337f3a`（r2-8）。
**7コミット、赤いまま積まれていた。**

落とした原因は確認の仕方——`npm run verify | tail -3 && git commit` は
**パイプの終了コードしか見ない**ので、verify が落ちても後続が走る。

### [HIGH] 2. 手動開始に「go を出す直前の門」が無い

reviewer: react（実測）

再開側は 前・後・catch の3枚だが、手動側は後の1枚だけ。`syncPosition` と
`waitUntil`（最大2秒）を挟んだ後、**要らなくなっていても `go infinite` を出す**。

- 同期待ちの間に ■ を押す → 止めた後にエンジンへ `go` が出る。以降 ▶ は
  `Analysis already running` で断られ、※4 の「押しても何も起きない」に落ちる
- `syncPosition()` の応答が畳まれた後に返る → **畳まれた画面のために席を作ってから返す**

### [HIGH] 3. `releaseSeatQuietly` の「空撃ち」の説明が、r2-6 の修正で嘘になった

reviewer: robustness

4つの呼び口を数えると、席を持たずに撃つ経路は**もう1つも無い**。
しかも助言が逆で、`sync-timeout` の解放が落ちた回は席を握ったまま残り、
以後 ▶ が断られ続ける。ログを見た人はこのコメントを読んで**閉塞を見送る**。

### [HIGH] 4. ※13 の前段（一括停止と `take_session` の順序競合）が、まだ残っている

reviewer: comment / oss-hygiene

r2-4 で `provider.tsx` は直したが ※13 は前の理由のまま。
開始の応答を待つ間 `seatRef` は必ず空なので、その窓で一括停止は飛ばない。
**同じ注の中で前段と後段が反対の前提に立っている**（r1-4 → r2-4 → r3、3回目）。

### [HIGH] 5. ※12 が「完了通知の ID が一致しなかった回」を根拠に残している

reviewer: comment / oss-hygiene

同じ文書が11行上で「この通知は飛ばない」と書いた事象。r2-3 で ※6 と不変条件5 は
直したが ※12 は直っていない。**指さない停止を選んだ根拠の半分が、踏めない事象。**

### [HIGH] 6. 「停止が落ちた＝Rust に席が残る」が doc 側の2箇所で直っていない

reviewer: comment / oss-hygiene

`failure-surfacing.md` の F-7 と `analysis.md` の不変条件5。r2-2 で `provider.tsx` の
コメントだけ直り、doc は前の前提のまま。**同じ事実について TS のコメントと表が正反対。**

### [HIGH] 7. `analysis-pane.md` の「停止が失敗 → 押しても何も起きない」が逆

reviewer: comment / oss-hygiene

`finally` が必ず `stop_analysis` を dispatch するので、失敗しても表示は「停止中」になる。
**「何も起きない」ではなく「成功したように見える」**——#120 の形そのもの。
r2-14 で直した行が別の向きに外れた。

### [HIGH] 8. `releaseSeatOnUnmount` の「ID が主とずれる」経路が、書いたとおりには作れない

reviewer: comment

「停止が他人の席に断られ、その後の開始が席を取った回」——席が埋まっている間は
`take_session` が断るので、開始が成功した時点で前の席は消えている。
実際にずれるのは、打ち切った開始の返却（`late-start` / `late-restart`）が届かなかった回。
しかも同じ理由が ※12 と別の列挙になっている。

### [HIGH] 9. ※1 / 不変条件1 / S6 の判定 / `bridge.rs` の照合コメントが、飛ばない E9 を根拠にしている

reviewer: oss-hygiene

`sessionId` が残る S6 は `onError` 経由でしか作れず、その通知は飛ばない。
E8 には ※6 で処置を入れたのに、E9 には1つも入っていない。

## MEDIUM

10. **`state.sessionId` の読み手が0になった**（robustness / architecture）。r2-8 で最後の読み手を
    畳んだ結果、書かれるだけの欄が公開型（`AnalysisState`）に残った。
    **doc は今もこの欄で S0 / S6 を定義している。** 次に触る人がここから停止を撃つと r1-1 が戻る。
11. **打ち切られた再開が、門の手前で `clear_results` を dispatch する**（react、実測）。
    `clear_results` は `error` も消す（`reducer.ts`）。`main` では門に掛かる回＝画面が無い回
    だったので無害だったが、門が `supersededSince` に広がって**画面が生きたまま掛かる回**ができた。
    表の `S3/P1 × E5`（停止して S6）が、実際には S0 に落ち着く。
12. **`waitUntil` が畳まれても回り続ける**（react、実測）。畳んだ後 300ms で25回、
    上限まで走れば約125回。`scheduleRestart` には門があるのに、もう1本のタイマー連鎖だけ素通り。
13. **`late-start` / `late-restart` の解放が落ちると、席を握る者が居なくなる**（robustness）。
    その2口は欄が空のまま撃つので、失敗しても書き戻さない。以後 `releaseSeatOnUnmount` の門は
    閉じたまま——**画面が生きているのに返し直せない**唯一の枝。
14. **r2-6 の門を戻してもテストは全部緑**（robustness、変異で実測）。振る舞いが固定されていない。
15. **`stop_all_sessions` のログが、呼び手を言えない**（robustness）。`shutdown_engine_impl` も
    同じ口を通るので、エンジン交換で席が消えた回と #441 の再発が**字面で区別できない**。
    コメントの「出す先の画面が無い」も `shutdown` 経由では成り立たない。
16. **同じ「なぜ」が4箇所に写されている**（comment）。`seatRef` の doc / `releaseSeatOnUnmount` の doc /
    ※12 / F-7。r1-4 → r2-4 → r3 と3ラウンド続いているのは**写しが4つあること**が原因。
17. **`bridge.rs` の中で同じものが「席」と「項目」の2語で呼ばれている**（comment）。
    この PR で「席」が Rust に入り、既存の「項目」と混在した。
18. **`provider.tsx` の「■ を押されると」が、その窓では起こせない**（oss-hygiene）。
    手動開始の応答待ちでは `state.isAnalyzing` が false なのでボタンは ▶ のまま。
    門は畳まれた回に要るので残すが、理由が違う。
19. **#356 の現物が、`analysis-pane.md` から付け替えた事実と別のものを指している**（oss-hygiene）。
    issue のタイトルと事実節は ADR-0007 で解決済みの綴りの話。
20. **`runRestartRef` を render 中に書いていて、`syncedSfen` の真実の源が2つある**（react）。
    `runRestart` は render スコープの `syncedSfen` を読み、`startInfiniteAnalysis` は
    `syncedSfenRef` を読む。どちらが正かはどこにも書かれていない。
    **`react-hooks/exhaustive-deps` の射程外**（`runRestartRef.current` は依存配列を持たない）。
21. **席の欄に触る行が4つあり、うち3つは `releaseSeat` 系の外**（architecture）。
    r1-6 で「返す口を1つに」と決めたのに、欄そのものは誰でも書ける。
    **`useAnalysisSeat` に閉じるべき。この PR で。**（architecture の判断。範囲は席だけ、
    自動再開の機械は動かさない）
22. **`failure-surfacing.md:130`（F-32）に重複した1文と、存在しない ※6 への参照**（oss-hygiene）。
    #420 由来で `origin/main` に既に在る。

## LOW

23. F-7 の測定日のブランチ名だけコードスパンになっていない（oss-hygiene）。

## 重複・矛盾した所見

- 所見1 は robustness と architecture が独立に実測。**同じ直し方**（barrel に戻す）。
- 所見4・5・6・8 は comment と oss-hygiene が同じ箇所を別の入口から指した。
- 所見10 は robustness（doc との食い違い）と architecture（公開型に残った）で角度が違うが同じ根。
- 矛盾は無し。architecture だけが所見21 で「この PR でやる」と踏み込んでいる。

## 見ていない範囲

- `protocol.rs` / `analyzer.rs` の内部と、#463 の窓の幅。3ラウンド続けて未見。
- `features/engine-position-sync`（`syncPosition` の実装）。3ラウンド続けて未見。
- 実プロセスを使った検証は誰もしていない。
- `analysis.md` の表のうち E13 列以外のセル（E1〜E12 × S1〜S6）の正しさ。

## lint / hook で強制できるもの

- **所見1 は既に機械が拾っていた。** 足りなかったのは検査ではなく、
  **パイプで潰さずに終了コードを見ること**。
- `docs/state-transitions/*.md` の `※N` 参照が同じファイルに定義されているか（所見22）。
- doc が名乗るイベント名が Rust の `emit` に実在するか（r2 で既出。所見9 の E9 列に効く）。
- 所見2〜8・10〜21 は機械では止まらない。

## 修正計画

### 束ね方と順

**振る舞い → 席の閉じ込め → コメント → doc** の順。所見16 が言うとおり、
コメントを先に直すと閉じ込めでまた書き直しになる。

1. **所見1**（BLOCK）→ 即。以後 `npm run verify` の終了コードを必ず見る
2. **所見2 → 手動開始の `go` の前にも門。** テストを1本
3. **所見11 → 後始末の dispatch を門の後ろへ。** 重複した2行も畳む
4. **所見12 → `waitUntil` に脱出を渡す**
5. **所見13 → 返せなかったときに、欄が空なら ID を書き戻す。** テストを1本
6. **所見14 → r2-6 の門を固定するテストを1本**
7. **所見10 → `state.sessionId` を落とす**（読み手0）。doc の S0 / S6 / ※1 も書き直す
8. **所見15 → `stop_all_sessions` に呼び手の名前を渡す**
9. **所見21 → `useAnalysisSeat` に席を閉じる。** テストは1行も変えずに緑であることが検証
10. **所見3・8・16・17・18 → コメント。** 正を ※12 に置き、コードからは参照する
11. **所見4・5・6・7・9・19・22・23 → doc と issue**

### 次ラウンドの焦点

- 所見21 の切り出しで、**席の欄を書く行が本当にフックの中だけになったか**（grep で数える）
- 所見2・11・12・13 の門と後始末が、4つの経路で同じ形になっているか
- 所見16 の「写しを1つにする」が守れているか。**同じ列挙が2箇所に残っていないか**
- doc の記述が、直した後のコードとまた食い違っていないか（3ラウンド続けて出ている）
