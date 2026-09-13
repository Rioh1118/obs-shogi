# レビュー 441-unmount-session ラウンド25

- 日付: 2026-09-09
- 範囲: `git diff origin/main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / oss-hygiene / architecture（5人とも走り切った）
- 対象コミット: `6e4825a0`
- 前ラウンド: [r23](2026-09-07-441-unmount-session-r23.md) / [r24](2026-09-07-441-unmount-session-r24.md)

## 所見

### [HIGH] 1. r24 で入れた `shortenWaits` が、触っていないテストの余白を 1945ms → 145ms に縮めた

reviewer: react（実測で1回落ちた）/ robustness / comment / oss-hygiene（4人が別々の側面から）

```
AssertionError: expected 205 to be less than 200
  provider.test.tsx:537   expect(elapsed).toBeLessThan(POSITION_SYNC_TIMEOUT_MS);
```

**このテストは r24 の diff に1行も入っていない。** 変わったのは上限の定数だけ（2000 → 200）。
実測の経過は約 55ms なので、余白は 1945ms（36倍の遅延で落ちる）から **145ms（3.6倍）** になった。

**r24 の所見10 が直そうとしたのは「触っていないコミットがランダムに落ちる」形で、
その修正が別のテストで同じ形を作った。**

さらに2つ壊れている。

- **「比は現物と揃えてある」は算術的に誤り。** 刻みと猶予は 1/4、上限だけ 1/10
- **間引き（`RESULT_FLUSH_MS = 80`）は `waits` に入っていないので縮まない。**
  現物は `80 < 100`（間引きが猶予より先）だが、縮めた側は `80 > 25` で**順序が逆転している**

### [HIGH] 2. 縮めた寸法のせいで、「畳まれたら同期待ちをやめる」が検査でなくなった

reviewer: robustness（実測）

```tsx
view.unmount();
// 上限（2000ms）よりずっと手前で見る。
await advance(200);          // 合計 250ms ＞ 縮めた上限 200ms
expect(settled).toBe(true);
```

`waitUntil` の `abort` を丸ごと落としても**このテストは緑**。上限で自分から終わるため。
利用者に起きるのは「畳んだ後も、居ない画面のために同期待ちが上限いっぱい回り続ける」
——r18 以降なんども直してきた枝が、機械の側から無防備になった。

### [HIGH] 3. `withShortWaits` という関数は存在しない

reviewer: oss-hygiene / comment（独立に）

`grep` で1件——このコメントだけ。現物は `shortenWaits`。
**`srcCommentIdentifiers` は `__tests__` を除くので、テストのコメントの腐りは機械が1つも止めない。**

### [HIGH] 4. 縮めた後も「上限は2秒」を前提にしたコメントが6箇所以上残っている

reviewer: comment / robustness（独立に）

`// 同期待ちの上限（2秒）を越えるまで進める。` の次の行が `await advance(320);`。
**コメントと次の行が直接矛盾している。** 読み手は「足りていない」と読むか、
2400 へ戻して r24 の所見10 を再導入する。

### [HIGH] 5. r24 の所見12（`docs/**` の写し）が2箇所閉じていない

reviewer: oss-hygiene / comment / architecture（3人が独立に）

`docsIdentifiers.test.ts` と `comment_identifiers.rs`。**前者はこのブランチが足した行**で、
同じファイルの別の行は「範囲は `scannedDocs`」と正しく書いている——**同一ファイル内で矛盾**。
r24 で「5箇所」と数えたこちらの数え漏れ。

### [MEDIUM] 6. `dropPendingForLostSeat` の doc が、r24 で入れた席の門と矛盾している

reviewer: react / robustness / architecture / comment（4人）

**ただし「この行が要るか」で reviewer の測定が割れた。**

- **react**: 本体を無害化しても 63/63 緑。**要らない**（doc を「掃除」に直すか、行ごと消す）
- **robustness**: `shoot` の catch（`keepOrForget`）が捨てた席を書き戻す窓では、
  席の門が開くので**この1行だけが守っている**。使い捨てのテストで
  `candidates: [{...}]` を観測したと報告

**こちらで両方を確かめた。** react の測定は再現した（無害化して 63/63 緑）。
robustness の窓は**再現できなかった**——組んだ筋では `isAnalyzing` が倒れ、
`analyzing` の門で止まった。**どちらが正しいかを確定できていない。**

### [MEDIUM] 7. `useResultFlush` の第3引数は同一性が要求だが、doc も機械も無い

reviewer: react（実測）/ comment（独立に）

```
AssertionError: expected "vi.fn()" to be called with arguments: [...]
Number of calls: 0
```

返す面は初回で凍るので、毎描画で新しい述語を渡すと**席の門が初回の答えに凍る**。
症状は「解析中の表示のまま候補手が出ない」で、断りも `console.error` も出ない。
いま安全なのは `seat.isHeld` が凍った面のメソッドだからだが、**その理由がどこにも書かれていない**。

## MEDIUM

8. **`shortenWaits` は本番から呼べる**（architecture）。`positionSyncTimeoutMs` が 200 に落ち、
   重い評価関数の初期化で必ず打ち切りに落ちる。止める機械が1つも無い。
9. **`allCheckNames()` に「0件で緑」を止める段が無い**（oss-hygiene）。
   `ratchetIndex` は同じ母数の別の口に3本置いている。`helpers` は文字列の直書きに依存する。
10. **`waits.ts` の doc が、同じコミットが消した状態を現在形で書いている**（architecture / oss-hygiene）。
    「跨ぐテストは 2.4 秒進めており、余白は 264ms しかない」——該当は現物に0本。
11. **`POSITION_SYNC_TIMEOUT_MS = 200` が `waits.ts` の値の手写し**（oss-hygiene / robustness / comment）。
12. **`notReadyReason` の導出コメントが、自分の `failed` 枝を打ち消している**（comment）。
    「在る限り、いま何段目に居ても起動を待っている」は `error` の段を除外していない。
13. **`analysis.md` ※3 が、結果を捨てる条件を半分しか書いていない**（comment）。
    門は2枚（`analyzing` と席）あるのに、席の門が表に無い。
14. **`useResultFlush` の doc が `holdsSeat` の呼び出し規約を書いていない**（comment。所見7 と同じ根）。

## 確かめて問題が無かったもの

- **席を握る前に届いた1本は落ちていない**（react が変異で確認）
- **`onComplete` の最後の1本は消えていない**（react が使い捨てで組んで実測）
- **`notReadyReason` に逆向きの窓は無い**（robustness が3つの筋で実測）
- **F-37 / F-38 の参照は揃っている**（oss-hygiene / robustness）
- **r23 の数値の訂正は正しい**（oss-hygiene / architecture が実測）
- **`seatSlotShape` のラチェットは `useResultFlush` にも効いている**（react が変異で確認）
- 依存の方向の違反は0件

## 見ていない範囲

- `analyzer.rs` / `protocol.rs` の内部と #463 の窓。**25ラウンド続けて未見。**
- 実プロセスでの検証。誰もしていない。

## 修正計画

順は「自分が作った退行 → 検査の穴 → doc」。

1. **所見1・2・4・11 → 寸法の縮め方をやり直す。** 比を本当に 1/4 に揃え（500 / 25 / 4）、
   間引きも `waits` に入れて縮める（20。順序 `20 < 25` を保つ）。テストは定数の写しをやめて
   `waits()` を読む。上限を跨ぐテストは割合で書く。**所見2 の変異で赤くなることを確かめる**
2. **所見3 → `shortenWaits` に直す**
3. **所見5 → `docs/**` の写し2箇所**
4. **所見6・7・10・12・13・14 → doc。** 所見6 は**測定が割れたことをそのまま書く**
5. **所見8・9 → `ownedSpelling` に `shortenWaits` の持ち主、`allCheckNames` に非空の段**

**壊しうるもの。** 1 は6本の待ちを全部触る。所見2 のテストは変異で確かめるまで直したと言わない。

### 次ラウンドの焦点

- 1 で揃えた比が、**間引きと猶予の順序**を本当に保っているか
- 所見6 の窓（`keepOrForget` の書き戻し）を**再現できるか**。できたならテストを置く
- 5 の写しが、**Rust 側も含めて**本当に消えたか

## 修正の結果

| 所見                    | 結果                                                                              | コミット                       |
| ----------------------- | ------------------------------------------------------------------------------------ | ------------------------------ |
| 1 / 2 / 3 / 4 / 11      | 直した。4つとも 1/4 に揃え、間引きも `waits` に入れ、テストは `waits()` を読む      | `6c60aa52`（所見2 は変異で確認） |
| 5 / 12 / 13 / 14        | 直した                                                                            | `b447d44e`                     |
| 8 / 9                   | 直した。`ownedSpelling` に持ち主、母数に非空の段                                   | `b447d44e`（どちらも変異で確認） |
| 6 / 7 / 10              | 直した（doc）。所見6 は**測定が割れたことをその場に書いた**                        | `b447d44e`                     |

### 所見6 について——測定が割れた

`dropPendingForLostSeat` が要るかで、reviewer 2人の実測が逆になった。
**両方をこちらで当て直した。**

- **react の測定は再現した**——本体を無害化しても 63/63 緑
- **robustness の窓は再現できなかった**——組んだ筋では `isAnalyzing` が倒れ、
  `analyzing` の門で止まった（`candidates= []`）

**確定できていないので、行は残した。** doc には「落としても全部緑になる」ことと、
「`keepOrForget` の書き戻しで門が開くという指摘があり、その窓は再現できていない」ことを
両方書いた。**消すなら先に再現を作ること。**

### 所見1 について——こちらが作った退行

r24 の所見10 は「触っていないコミットがランダムに落ちる」を直すためのものだったが、
**その修正が別のテストで同じ形を作った**（余白 1945ms → 145ms、実際に1回落ちた）。
比を「揃えた」と書きながら上限だけ 1/10 に縮め、間引きは縮め忘れて順序を逆転させていた。
**寸法を縮めるときは、縮めない寸法との順序も確かめること。**
