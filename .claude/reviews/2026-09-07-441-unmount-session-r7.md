# レビュー 441-unmount-session ラウンド7

- 日付: 2026-09-07
- 範囲: `git diff main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / oss-hygiene
- 対象コミット: `22822384`（この後 `origin/main` の #446 を取り込んだ）
- 前ラウンド: r1〜r6（同じディレクトリ）

## 所見

### [HIGH] 1. 相乗りした返却の結末を見ないので、席を握ったまま `go` を出す

reviewer: react / robustness（2人が独立に実測）

`releaseHeld` が飛んでいる返却をそのまま返していた。相乗り先が
`releaseHeldQuietly` の張った返却だと、その失敗は既に `shootQuietly` の catch で
消えているので **resolve** し、呼び手は席を握ったまま `startInfiniteAnalysisCore()` へ進む。
Rust は `Analysis already running` で断り、`console.error` で終わる
——**r4-10 で足し、r5-3 で doc 5箇所を書き直した「▶ の復帰導線」が黙って空振りする。**

### [HIGH] 2. 手動開始が「押した瞬間の局面」に固定されている

reviewer: react / robustness（2人が独立に実測）

▶ を押した直後に盤を動かすと、待っている条件（押下時の局面と一致）は二度と真にならない。
上限いっぱい2秒回してから、**何も失敗していないのに**断りを積む。
その2秒は `startInfiniteAnalysisOnce` が押し直しを畳むので、もう一度押しても始まらない
（待ちは `main` から在るが、**押し直しを塞ぐ門はこの PR で入った**）。

### [MEDIUM] 3. `finally` が枠を無条件で空けるので、3本目が並列で飛ぶ

reviewer: react（実測）

後ろに並べた2本目が飛んでいる間に枠が空になる。`releasingRef` の doc が
「同じ席へ2本目を撃たない」と名乗る保証が3本目から無い。

### [HIGH] 4. 「世代を上げる口をここ1つにする」が偽

reviewer: comment

`supersedeRequests` を通らないもう1つの口（局面が変わった回）が同じファイルに在る。
r6-13 の直しで入った断定が、直後に外れていた。

### [HIGH] 5. ※12 の列挙2つが、r6 の修正コミットで**触られていなかった**

reviewer: comment / robustness / oss-hygiene（3人）

r6 の報告書は「直した」と記録しているが、`git diff` にその hunk が無い。
**列挙はどちらもコードで作れない**（5ラウンド目）。

### [HIGH] 6. ※9 が、いまの API では選べない判断を理由にしている

reviewer: robustness / oss-hygiene

r6-16 で `provider.tsx` からは落としたが、doc 側は前の前提のまま。

### [HIGH] 7. ※1 に r6 で入った「返せなければ ※11 に落ちる」が偽

reviewer: robustness（実測）

`releaseHeld` が reject すると `take_session` まで進まない。出るのは停止の失敗で、
`Analysis already running` ではない。

## MEDIUM

8. **不変条件1 の「どれも画面が生きていれば E1 が返し直せる」が ※14 に当たらない**（robustness）。
9. **`releasingRef` の相乗りの理由が `bridge.rs` の分岐と食い違う**（robustness）。
   席が空なら Rust は `Ok` を返す（「知らない席で断られる」は起きない）。
10. **結末の列挙が、その口を通らない関数の doc に書かれている**（comment）。
    `no-position` と `sync-timeout` は `quietly` を通らない。
11. **`at` と `by` の2語が同じ値を指している**（comment）。ログの綴りは `by`。
12. **`(S0/P1, E10)` が「席は Rust が返す」に倒れている**（oss-hygiene）。
    停止が届かなかった回で入った S0/P1 では、`take_session` が断るので席は残る。
13. **E14 の `S0/P1` セルが、その行の定義（開始の応答待ち）を書いていない**（oss-hygiene）。
    E13 の同じセルは書いている。S4/S5 の E14 にも ※13 が落ちている。
14. **「埋まっていないセル」が `(S1, E11)` を未検証として挙げている**（oss-hygiene）。
    この PR がそのセルを両側とも固定した。
15. **画面仕様の失敗表が ▶ と ■ を1行に混ぜている**（oss-hygiene）。
    ■ は「成功したように見える」、▶ は「押しても何も起きない」で結末が違う。
16. **`sweepOnUnmount` だけが `releasingRef` を見ない**（comment）。
17. **F-6 と `analysis-pane.md` が同じ失敗について反対を言う**（robustness）。
18. **`IDEAS.md` に足した2件に、6週間の判断が書かれていない**（oss-hygiene）。
19. **待ちの打ち切りのコメントが引き金を1つしか言っていない**（comment）。

## 重複・矛盾した所見

- 所見1・2 は react と robustness が独立に、同じ再現手順で実測した。
- 所見5 は3人が独立に「r6 の修正が入っていない」ことを突き止めた。
- 矛盾は無し。

## 見ていない範囲

- `analyzer.rs` / `protocol.rs` の内部と #463 の窓の幅。**7ラウンド続けて未見。**
- `features/engine-position-sync` の実装。**7ラウンド続けて未見。**
- 実プロセスを使った検証は誰もしていない。

## lint / hook で強制できるもの

- **報告書が「直した」と書いた所見について、名指しされたファイルの当該節が実際に変わっているか。**
  所見5 はこれで落ちる（r6 だけで2件出た）。
- **`.finally(() => { xxxRef.current = null })` に自分との照合があるか**（所見3）。
- **`docs/` が名乗る TS の識別子と、その関数の引数の数の突き合わせ**（所見6）。
- 所見1・2・4・5・7〜19 は機械では止まらない。

## 修正の結果

| 所見                                   | 結果                                                                                                                                            | コミット   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1 / 2 / 3 / 9 / 11 / 16                | 直した。相乗りは待つが結末は自分で確かめる／枠は自分照合で空ける／待つ相手は「いま盤が見ている局面」／畳まれた回も並べる／`at` を `by` に揃えた | `8ed76f24` |
| 4 / 5 / 6 / 7 / 8 / 10 / 12 〜 15 / 18 | 直した                                                                                                                                          | `bcc0c507` |
| 17 / 19                                | 直した（同上）                                                                                                                                  | `bcc0c507` |

**このラウンドの途中で `origin/main` に #446（定跡の土台）が入った。** 取り込みは
`2506ce03`。衝突は `failure-surfacing.md` の F-7 の1行だけで、main が書き直した表に
この PR の3欄（場所・いま起きること・復帰導線）を載せ直した。
`provider.tsx` は自動マージ（main の `clearTimeout` 化と `runRestartRef` 冒頭の門は両方残っている）。
