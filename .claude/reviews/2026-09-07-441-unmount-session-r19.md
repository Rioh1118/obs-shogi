# レビュー 441-unmount-session ラウンド19

- 日付: 2026-09-07
- 範囲: `git diff origin/main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / oss-hygiene / architecture
- 対象コミット: `015ef80a`
- 前ラウンド: [r17](2026-09-07-441-unmount-session-r17.md) / [r18](2026-09-07-441-unmount-session-r18.md)

## 所見

### [HIGH] 1. 前ラウンドの修正は立ち下がりを1回見るだけで、飛んでいる開始が捨てた印を書き戻す

reviewer: react / robustness / architecture（3人が独立に、別々の順序で実測）

```
C1 analyzing= true analyzedSfen= P1 error= null startCore= 1   ← !isReady の間に席が返ってきた
C2 analyzing= true error= null startCore= 1 stopCore= []       ← エンジンが戻って600ms、再開しない
A2-2 after stop returns: startCore= 2 analyzing= true          ← 畳んでいる最中のエンジンへ go
B2 after late seat: startCore= 1 analyzing= true               ← ▶ の応答待ちに落ちた回
```

窓は3つ——▶ の応答待ち、自動再開の往復中、`isAnalyzing` が立つ前。どれも
**この画面の断り6本が案内している操作**（設定でオプションを変えて保存）で踏む。
結末は前ラウンドの BLOCK と同じ（「解析中」のまま数字が動かず、断りも出ない）。

### [HIGH] 2. エンジンが戻ってこない回は、何も出ないまま「解析中」が残る

reviewer: robustness（実測）

```
A2 analyzing= true error= null startCore= 1 stopCore= []   ← 2000ms 経っても何も起きない
```

候補手は死んだエンジンが最後に返した1本が残り、盤を進めると**いま見ている盤の
解析結果に見える**。不変条件2 の破れ。

### [MEDIUM] 3. 購読が1度落ちると、張り直せた回も印が残り、▶ が永久に断る

reviewer: react（StrictMode で実測）

```
D1 setupCalls= 2  listeners registered= true  error= 解析結果を受け取れません。アプリを起動し直してください。
D2 after ▶: startCore= 0  analyzing= false
```

購読は生きているのに ▶ が `go` を出さない。すぐ上の `unmountedRef` は同じ形の ref なのに
setup で戻している——こちらだけ戻していない。

### [MEDIUM] 4. 同期待ちの最中にエンジンが落ちても、2秒待たせたうえで別の理由を案内する

reviewer: robustness（実測）

```
D1 settled= rejected startCore= 0 error= "エンジンが局面を受け取るのに時間が掛かっています。もう一度 ▶ を押してください。"
```

正しい案内は「少し待ってからもう一度 ▶」。その指示（すぐ押し直す）に従うと、今度は
起動待ちの断りが出る。

### [MEDIUM] 5. r18 のコミットが名指しした2箇所は、実際には1文字も動いていない

reviewer: oss-hygiene

`analysis.md` の E6 の発生源と、`analysis-pane.md` の失敗の表。置換が黙って空振りしていた。
**同じ罠（台帳の「直した」を根拠に確認を飛ばす）が2ラウンド連続で成立している。**

## MEDIUM

6. **`abandonOnEngineGone` の「なぜ撃たないか」が `stop_session` の照合と食い違う**（comment）。
   巻き添えは Rust が塞いでいる。実際の危険は**席が空の回に、起こし直したエンジンへ裸の `stop`**。
7. **※5 が同じ注の中で「席の欄を空ける」と「握ったまま」を両方書いている**（comment / oss-hygiene）。
8. **`(S0/P0, E1)` / `(S6/P0, E1)` の「同期→開始」が、購読が落ちた後は成り立たない**（oss-hygiene）。
   ※2 にも購読の門が書かれていない。
9. **「埋まっていないセル」が、この branch で足したテストを「未検証」と名指ししている**（robustness）。
10. **`docsIdentifiers` が camelCase を1つも見ていない**（oss-hygiene）。
    **このリポジトリで実際に腐るのは TS 側の綴り**で、そこが空いていた。
11. **画面仕様に、どの表のものか分からない裸の `※15` がある**（oss-hygiene）。
12. **r18 で割った2つの段が、断りの立て方について逆の作法**（architecture）。
13. **`SeatReleasePoint` の網羅検査に、名前も理由も持たない逃げ道が埋まっている**（architecture）。
14. **`analysisSeatSlot` が、リポジトリ横断の検査だけを置くと決めた場所に居る**（architecture）。
    1ファイルの内部の形しか見ていない。
15. **同期待ちの規則が2つの機械で書かれている**（architecture）。片方だけ直すと、盤を動かして
    再開した回だけが古い上限で断られる。
16. **`docsSourcePaths` の doc と `tableFiles` の名前が「状態遷移表だけ」のまま**（comment）。
17. **`startInfiniteAnalysis` に doc が無い**（comment）。席は応答より先に埋まる／返ってきた席は
    必ず返す、が呼び手から読めない。
18. **brand の doc の「この provider」が、そのファイルの中の何も指していない**（comment）。

## 重複・矛盾した所見

- 所見1 は3人が別々の順序（▶ の応答待ち／自動再開の往復中／`isAnalyzing` が立つ前）で
  同じ根に到達した。直し方も一致（エンジンの世代を持つ）。
- 矛盾は無し。

## 見ていない範囲

- `analyzer.rs` / `protocol.rs` の内部と #463 の窓の幅。**19ラウンド続けて未見。**
- 実プロセス（本物の USI エンジン）を使った検証は誰もしていない。

## 修正計画

1. **所見1・4 → エンジンの世代（`engineEpochRef`）を持つ。** 席を取る往復を跨いで
   「その席はどのエンジンのものか」を言えるようにし、進んだ後の席は撃たずに捨てる。
   同期待ちも `isReady` を見る。テスト2本
2. **所見3 → 張り直せた回に印を戻し、catch も `alive` を見る**
3. **所見2 → issue #502**（何秒待って断るかは設計の選択）
4. **所見6・7・8・9・11・16・17・18 → doc**
5. **所見5・10 → 取り残しの修正と、`docsIdentifiers` の camelCase**
6. **所見12・13・14・15 → `failStart` の一本化・逃げ道の命名・検査の置き場・規則の指し**

### 次ラウンドの焦点

- 1 の世代が、**エンジンが2回続けて落ちた回**に取りこぼしていないか
- 2 の印の戻しが、**畳まれた pass の成功**で立ってしまわないか
- 10 で広げた識別子の検査が、**誤検出**（別スライスに同綴りがある形）を出していないか

## 修正の結果

| 所見               | 結果                                                                         | コミット                            |
| ------------------ | ---------------------------------------------------------------------------- | ----------------------------------- |
| 1 / 3 / 4 / 6      | 直した。エンジンの世代・同期待ちの中断・印の戻し                             | `eabc4113`（テスト2本、変異で確認） |
| 12 / 13 / 14       | 直した。`failStart` の一本化・逃げ道の命名・検査をスライスへ                 | `29369fb3`                          |
| 5 / 7〜11 / 16〜18 | 直した。`docsIdentifiers` は camelCase を見るようにし、死んだ綴り3件を直した | `06e45b00`                          |
| 2                  | **issue #502 へ**（何秒待って断るかは設計の選択）                            | `4bc0746c`（※5 に番号を書いた）     |
| 15                 | 直した。両方を直すことを自動再開の側に書いた                                 | `4bc0746c`                          |
