# レビュー 441-unmount-session ラウンド17

- 日付: 2026-09-07
- 範囲: `git diff origin/main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / oss-hygiene / architecture
- 対象コミット: `d484b843`
- 前ラウンド: [r15](2026-09-07-441-unmount-session-r15.md) / [r16](2026-09-07-441-unmount-session-r16.md)

## 所見

### [HIGH] 1. 起こし直している最中に ▶ を押すと、「設定でエンジンを選んでください」が出る

reviewer: robustness / architecture / comment（3人が独立に）

`isReady` が false になる理由は4つあるのに、断りは `phase` の3値でしか割っていない。
**4つ目——設定が変わって起こし直している最中——は `phase` が `"ready"` のまま
`isReady` だけ false になる。**

```
B shutdown の往復中:      ready false      ← ここで ▶ を押せる
R1 error= エンジンが起動していません。設定でエンジンを選んでください。
```

他の6本の断りが「設定でオプションを変えて保存すると起こし直せます」と案内した先で、
**その指示に従った直後の利用者**がこれを受け取る。効く手（数秒待って ▶）はどこにも無い。

### [MEDIUM] 2. 購読の登録が途中で落ちると、先に登録した分が誰にも解除されない

reviewer: react（実測）

```
R1 leaked-unlisten-calls= 0 (registered=1)
R2 un2= 0 un3= 0
```

漏れた `onUpdate` は畳まれた画面の ref に書き、タイマーを張る——`clearDebounceTimer` の
doc が名指しで警戒している「`window` が消えた後にタイマーが投げる」状態を、この経路が作る。
解除側も `forEach` なので、1本目が投げると残りが登録されたまま残る。

### [MEDIUM] 3. リスナ登録が落ちた枝（E12）にだけ断りが無く、ラチェットも見えない

reviewer: react（実測）

```
S setup 呼び出し回数= 1  listeners= 未登録  analyzing= true  candidates= 0  error= null
```

effect の依存は全部固定なのでマウント1回きり——**張り直す口が無い**。
F-4 は既に「断りが要る」と書いている。新設したラチェットは `refusals.ts` に**在る**定数しか
見ないので、「まだ断りが無い枝」は構造的に検出できない。

### [MEDIUM] 4. 断りのラチェットが名前の末尾で対象を決めている

reviewer: robustness / architecture / oss-hygiene（3人）

```
export const NO_ENGINE_NOTICE  → 21 passed（素通り）
export const NO_ENGINE_MESSAGE → 2 failed
```

`..._NOTICE` と名付けた1本が黙って義務から外れる。※15 の照合も**ファイル全体**を見るので、
表以外の場所に名前が1度出れば通る（イベントの表のセルにも `※15` の参照がある）。

### [MEDIUM] 5. 断りが立つようになった枝の行き先が、表では S0 のまま

reviewer: oss-hygiene

`(S0/P0, E10)` / `(S0/P1, E10)` / `(S1/P1, E11)` と ※7。S6 の判定はこの表自身が
`error !== null` と定めている。**この表を根拠に「S0 なら断りは立っていない」と読むと、
▶ を押して断られた回を「何も起きていない」と扱う。**

### [MEDIUM] 6. 改名した識別子が、表の状態定義と画面仕様に残っている

reviewer: oss-hygiene / robustness（独立に）

`analysis.md:17` の S1 の判定が `lastAnalyzedSfenRef`（`src/` に0件）、
`analysis-pane.md:66` が `state.currentPosition`（同）。前者は**表の状態そのものの定義**で、
これを頼りに grep した人は何も見つけられない。

### 7. r16-18（時間の定数の置き場）は「直した」と記録されているが、現物は動いていない

reviewer: react

`git log -S "RESULT_FLUSH_MS" origin/main..HEAD` は空。**台帳に「直した」と書かれた所見が
現物では直っていない**と、次のラウンドの読み手はその行を根拠に確認を飛ばす。

## MEDIUM

8. **「停止だけが断りの無い枝だった」——修正前の状態を過去形で書いたコメント**（comment）。
9. **▶ の契約「失敗したら `state.error` に断りを立てて reject する」が、局面なしの枝と食い違う**（comment）。
   同じ PR の provider のコメントは「ここは断りを立てない」と書いている。
10. **`refusals.ts` のファイル doc が、唯一「断りではない」定数の TSDoc になっている**（comment）。
11. **brand の doc が、ラチェットの守備範囲を違う軸で書いている**（comment / architecture）。
    綴りの規則は owners を4つ許すので、`provider.tsx` の中の `as` は止まらない。
12. **`closeFinished` の doc の根拠（覚えたから握り直さない）が、`shoot` の catch と繋がっていない**（comment）。
13. **このファイルで唯一、理由の書かれていない effect がある**（comment）。
    `isReady` が戻った回の唯一の入口なのに、`runRestart` の門の写しにしか見えない。
14. **`analysisSeatSlot` が枠への書き込み数を `2` で固定している**（oss-hygiene）。
    中で何回書くかは規約ではないのに、増やすと「書いていない」という逆の意味で落ちる。

## 重複・矛盾した所見

- 所見1 は3人が別の入口（実測・型の置き場・doc の食い違い）から同じ結論に達した。
- 所見4 は3人が独立に、同じ変異で確かめた。
- 矛盾は無し。

## 見ていない範囲

- `analyzer.rs` / `protocol.rs` の内部と #463 の窓の幅。**17ラウンド続けて未見。**
- 実プロセス（本物の USI エンジン）を使った検証は誰もしていない。
- `effect :513`（同期の追従）が現在の実装で1度でも発火するか——react が「推測なので所見にしない」と留保。

## 修正計画

1. **所見2・3・4 → 購読の後始末と、E12 の断り、ラチェットの対象の広げ方。** テスト1本
2. **所見1 → 理由の判定を `entities/engine` へ移し、断りへの `Record` で対応させる**
3. **所見5・6・9・11・12 → 表と契約と doc**
4. **所見7・8・10・13・14 → 取り残しとコメント**

### 次ラウンドの焦点

- 2 の `notReadyReason` が、**`phase` では区別できない状態を取りこぼして**いないか
- 4 のラチェットの `PARTS`（断りでない export の allowlist）が、**逃げ道として使われて**いないか
- 1 で足した `LISTENERS_FAILED_MESSAGE` が、**張り直す口が無いこと**と矛盾しない文言か

## 修正の結果

| 所見                        | 結果                                                                     | コミット                            |
| --------------------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| 2 / 3 / 4 / 7 / 8 / 10 / 13 | 直した。購読の後始末・E12 の断り・ラチェットの対象・定数の置き場         | `896019df`（テスト1本、変異で確認） |
| 1                           | 直した。`EngineNotReadyReason` を engine 側に置き、`Record` で対応させた | `c0266631`                          |
| 5 / 6 / 9 / 11 / 12 / 14    | 直した                                                                   | `9c0405f8`                          |
