# レビュー 441-unmount-session ラウンド8

- 日付: 2026-09-07
- 範囲: `git diff origin/main...HEAD`（`origin/main` は #446 を取り込んだ後）
- 走らせた reviewer: react / robustness / comment / oss-hygiene
- 対象コミット: `5bdb4d1d`
- 前ラウンド: r1〜r7（同じディレクトリ）

## 所見

### [HIGH] 1. r7 の振る舞い修正4件が、テストで1本も固定されていない

reviewer: robustness（変異4種すべて 30/30 緑）

r7 の修正コミット（`8ed76f24`）はテストを1行も足していない。
**r1〜r6 は全部「テストn本、変異で確認」と記録されているのに、r7 だけ抜けた**
——main の取り込みに割り込まれて、そのまま次の作業へ移ったため。

### [HIGH] 2. 捨てた席の停止が枠に載らないので、次の再開が追い越す

reviewer: react（実測）

`discard` だけ `releasingRef` に載っていなかった。盤を続けて2手動かすと、
追い越された席を捨てる停止が飛んでいる間に次の再開が `releaseHeld` を素通りし
（席を握っていないので即座に抜ける）、**捨てた席がまだ Rust に居るうちに開始を投げる**。
`take_session` が断り、解析が黙って停止中になる。**この PR が入れた新しい口。**

### [MEDIUM] 3. `releaseHeld` が入口で見た1本しか待たない

reviewer: react / robustness（2人が独立に実測）

待っている間に後ろへ並んだ返却とこちらが、同じ席へ並列で撃つ。

### [MEDIUM] 4. `clear_error` の dispatch 元が0になった

reviewer: react

この PR が context から `clearError` を落とした結果。読み手0／呼び手0は
`state.sessionId`（r3）・`analysisResults`（r4）・context の口（r5）・`state.error`（r6）に続く**5回目**。

### [MEDIUM] 5. `waitUntil` / `clearDebounceTimer` が依存に載らず、lint も報告しない

reviewer: react（実測）

oxlint は「毎レンダ変わる」を知っていて、**欠けている側は報告しない**。
いまは ref しか触らないので無害だが、render スコープの値を読み始めた瞬間に固定される。

## BLOCK / HIGH（コメント）

6. **[BLOCK] 結末の列挙が、4口のうち2口が通らない関数に付いている**（comment / oss-hygiene）。
   r7-10 の直しが**逆向き**に入っていた（`shootQuietly` の1行を `quietly` へ移し、列挙は残した）。
7. **[BLOCK] 「同時に走っている別の解析を巻き添えにする」が2箇所で復活**（comment）。
   r6 で `provider.tsx` から、r7 で ※9 から消した文が、**r7 の修正コミットで
   `useEngineSeat` に新規に書かれていた**。Rust は席を1つしか許さない（この PR が書いた）。
8. **[HIGH] 「解析ペインごと畳まれるわけではない」がペインの実態と逆**（comment）。
   ※14 は r6 で直したが、コード側の写しは r4 以来そのまま。同じ2文の中でも矛盾していた。
9. **[HIGH] 同期打ち切りの5行が「必ず止める」と「握っていなければ何もしない」を同時に言う**（comment）。

## MEDIUM（コメント / doc）

10. `sweepOnUnmount` が ※12 へ「経路は挙げてある」と送るが、※12 は列挙を落とした（comment）。
11. `holdUnlessSuperseded` だけ `at` が残っている（comment）。
12. `runRestartRef` 冒頭が `supersededSince` と同じ判定を手書きしている（comment）。
13. `matches` の理由が2ファイルに逐語で写されている（comment）。
14. **[HIGH] r7 の「E14 のセルに ※13」が隣の E13 の列に落ちた**（oss-hygiene）。
    畳まれた回のセルから ※12 が消え、棋譜を閉じた回の注を指していた。
15. **[HIGH] `(S1, E11)` だけ「P1 が残る」と断定**（oss-hygiene）。他の行は「枝で違う」。
16. **[HIGH] 画面仕様の失敗表が ▶ と ■ を混ぜたまま**（oss-hygiene / robustness）。
    r7-15 の分割は「▶/■ 対 席を返す停止」で、▶ と ■ は分かれていなかった。
17. F-6 が「開始／停止」を1行で「押しても何も起きない」と書いたまま（oss-hygiene / robustness）。
    **r7-17 は「直した」と記録しているが、変わったのは `analysis-pane.md` の側だけ。**
18. F-29 の「`stop_analysis` を2回叩くと2回目がこれ」が踏めない（oss-hygiene / robustness）。
19. `engine.md` の `(S2/P3, E8)` と `analysis.md` ※5 が正反対（oss-hygiene）。
20. 不変条件1 と 5 が ※13 の枝について正反対（robustness）。
21. 不変条件3 の「破れているのは…だけ」が、席を返す停止も落ちる回を落としている（robustness）。
22. README の在庫表に、`analysis.md` が ✓ を使わないことが書かれていない（oss-hygiene）。
23. **`analysis.md` の正しさを機械が1つも見ていないことが、どこにも書かれていない**（oss-hygiene）。
24. #172 のコメントが「`(S1, E11)` は未検証」と書くが、この PR が両側とも固定した（oss-hygiene）。
25. `(S4/S5, E13)` のセルが ※14（E14 専用の注）を引いている（robustness）。

## 重複・矛盾した所見

- 所見3 は react と robustness が独立に、同じ再現手順で実測した。
- 所見6・7 は comment と oss-hygiene が同じ2箇所を挙げた。
- 所見16・17 は「r7 が直したと記録した hunk が片側しか入っていない」形で、
  **r7-5（r6 の ※12）に続いて2ラウンド連続**。

## 見ていない範囲

- `analyzer.rs` / `protocol.rs` の内部と #463 の窓の幅。**8ラウンド続けて未見。**
- `features/engine-position-sync` の実装。**8ラウンド続けて未見。**
- 実プロセスを使った検証は誰もしていない。
- main の #446 が書き直した `failure-surfacing.md` の、F-6 / F-7 / F-29 以外の行。

## lint / hook で強制できるもの

- **報告書が「直した」と書いた所見について、名指しされたファイルの当該節が実際に変わっているか。**
  r6（2件）・r7（1件）・r8（2件）で5件。`/review-fix` の締めに
  `git diff <前ラウンドのHEAD>..HEAD -- <名指しファイル>` を見るだけで落ちる。
- **`SeatReleasePoint` を撃つ全ての口が `releasingRef` に登録されているか**（所見2）。
- **`AnalysisAction` の各 `type` に dispatch する行があるか**（所見4。読み手0の5回目）。
- **同じ文（正規化後20文字以上一致）が2ファイル以上のコメントに現れること**（所見7・8・13）。
- 所見1・3・5・6・9〜25 は機械では止まらない。

## 修正の結果

| 所見              | 結果                                                                                                                   | コミット   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1 / 2 / 3 / 4 / 5 | 直した。`discard` を枠へ／入口の待ちを追う／r7 の2件をテストで固定／`clear_error` を落とす／`waitUntil` をモジュールへ | `8b5aa0ac` |
| 6 〜 13           | 直した                                                                                                                 | `7b207fd2` |
| 14 〜 25          | 直した                                                                                                                 | `0d02ea13` |

**r7 の残り2件**（`sweepOnUnmount` の並び／枠の自己照合）は、変異を当てても
落ちるテストを書けなかった（どちらも「重ねて撃たない」の保証で、結末が同じになる）。
**未固定として残す。**
