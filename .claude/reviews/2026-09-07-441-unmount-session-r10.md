# レビュー 441-unmount-session ラウンド10

- 日付: 2026-09-07
- 範囲: `git diff origin/main...HEAD`
- 走らせた reviewer: react / robustness / comment / oss-hygiene
- 対象コミット: `026f273e`
- 前ラウンド: r1〜r9（同じディレクトリ）

## 所見

### [HIGH] 1. 「もう採らない席」が1枠しか無く、続けて2つ手放すと古い方の `info` が通る

reviewer: react / robustness（2人が独立に実測）

`send` は成功のたびに `retiredRef` を**上書き**する。捨てる停止が1本挟まるだけで、
その前に返した席が「retired ではない」に戻り、席の空いた窓で `matches` を素通りする。
**P1 の評価値と読み筋が、盤が P3 を映したまま解析結果として出る。**

### [HIGH] 2. `sweepOnUnmount` だけが並ぶときに枠を取らない

reviewer: react（実測）

同じ1本を待っている `releaseHeld` が「誰も並んでいない」と見て先に進み、
**指す停止と指さない停止が並列で線に出る**。実測:
`[["session-1","stop"],["session-1","stop"],[null,"unmount"]]`。
r9 が固定したのは並んだ側が `releaseHeldQuietly` の回だけで、この筋は通らない。

### [HIGH] 3. ※5 の追記と `(S2/P1, E6)` が現物と逆

reviewer: robustness（実測）

`isReady` は局面を見る effect の依存に載っているので、false に変わると
前の回の cleanup（`clearDebounceTimer`）が走る。**debounce タイマは落ちる。**
r9-6 で全行に写した文言の、S2 の行が偽になっていた。

### [HIGH] 4. 復帰導線「エンジン再起動」に、利用者が踏める操作が1つも無い

reviewer: robustness

`restart` を呼ぶ口は「プリセットが別物に変わったとき」だけで、UI に再起動のボタンは無い。
畳まれた後に停止が落ちた回は、doc が案内する操作を**画面のどこからも実行できない**。

### [BLOCK] 5. `matches` の doc が「直前に返した席のものだけ」と書いたまま

reviewer: comment

r9-1 が本体に足した除外（捨てると決めた席）が、公開面の doc に入っていない。
`だけ` で閉じているので、`retiredRef` で足りると読んで同じ穴を戻せる。

### [HIGH] 6. 「指さない理由」の3つ目の写しがテストに残っている

reviewer: comment

r9-5 の修正コミットは `provider.test.tsx` を触っていない（`git show --stat` で確認）。
**「直したと記録した節が実際には変わっていない」が r7・r8 に続き3ラウンド連続。**

### [HIGH] 7. `(S0/P0, E5)` が `—`。手動開始の同期打ち切りはそこで起きる

reviewer: oss-hygiene

同じ文書の ※4 は「同期タイムアウトのときだけ `set_error` が飛ぶ」と、その経路を明示している。
※1 の「`set_error` を撃つ他の2経路」も数え落とし（4つある）。

## MEDIUM

8. `discardingRef` から消す条件が固定されておらず、握り直した回は消えないまま残る（react）。
9. `send` の catch の照合が、いま火を噴くのは所見2 の並列が起きている回だけ（react）。
10. ▶ の復帰が最大5秒かかるのに、その間の手掛かりが画面に1つも無い（robustness）。
    押し直しも同じ Promise に畳まれるので本当に何も起きない。→ **issue #491**
11. `releaseHeldQuietly` の doc が「結末の正は `shootQuietly`」と書きながら、自分でも書いている（comment）。
12. `failure-surfacing.md` の「残り5つは0」が現物と合わない（comment / oss-hygiene）。
    r9-13 は前半だけ直した。3行上に「数は書かない」と書いてある。
13. `by` の語彙に `"unnamed"` が無く、公開 API 側は裸の `string`（comment）。
14. `(S0/P1, E9)` だけ `—`。`onError` は P を見ないので `(S0/P0)` と割れる理由が無い（oss-hygiene）。
15. 不変条件1 が、**正常系の開始の応答待ち**（必ず一時的に破れる）を落としている（oss-hygiene）。
16. E13 の発生源（`RequireRootDir` の差し戻し）へ降りる入口が `app.md` に無い（oss-hygiene）。
17. `.claude/reviews/` が `OPERATING-MODEL.md` の装置表に無いまま、`IDEAS.md` の一次資料になった（oss-hygiene）。
18. **マージコミットが、宣言した1件以外に #446 の報告書6本を整形し直していた**（oss-hygiene）。
    lint-staged の prettier が `.claude/reviews/` も走査するため。

## 重複・矛盾した所見

- 所見1 は react と robustness が独立に、別の再現手順で同じ結論に達した。
- 所見12 は comment と oss-hygiene が同じ括弧を指した。
- 矛盾は無し。

## 見ていない範囲

- `analyzer.rs` / `protocol.rs` の内部と #463 の窓の幅。**10ラウンド続けて未見。**
- `features/engine-position-sync` の実装。**10ラウンド続けて未見。**
- 実プロセスを使った検証は誰もしていない。
- `analysis.md` の表のうち、名指ししていないセル。

## lint / hook で強制できるもの

- **`shootQuietly` / `send` を呼ぶ関数の中に `releasingRef.current =` があるか**（所見2）。
  r8 の案（「登録されているか」）では、読むだけの `sweepOnUnmount` が素通りした。
- **同じ文が2箇所以上（**ファイル内・`src` と `docs` をまたぐ場合も**）に現れること**（所見6・11）。
- **`docs/` の「N つ」「残りN」という数え上げ**（所見12）。r9-13 に続き2回目。
- **マージコミットが `# Conflicts:` 以外のファイルを両親のどちらとも違う内容にしていないか**（所見18）。
- 所見1・3〜5・7〜10・13〜17 は機械では止まらない。

## 修正の結果

| 所見                          | 結果                                                                | コミット / 送り先 |
| ----------------------------- | -------------------------------------------------------------------- | ----------------- |
| 1 / 2 / 8 / 9                 | 直した。「採らない席」と「Rust が持っていない席」を別の集合に。`sweepOnUnmount` も枠を取る | `67c7766c`（テスト1本、変異で確認） |
| 3 / 5 / 6 / 7 / 11 〜 17      | 直した                                                              | 直後のコミット    |
| 4                             | 直した（F-7 の復帰導線と `analysis-pane.md` の「いま満たしていないこと」）| 同上              |
| 10                            | **issue #491** へ                                                   | —                 |
| 18                            | `origin/main` の内容へ戻した                                        | `67c7766c`        |
