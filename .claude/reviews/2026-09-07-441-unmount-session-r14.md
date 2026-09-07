# レビュー 441-unmount-session ラウンド14

- 日付: 2026-09-07
- 範囲: `git diff origin/main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / oss-hygiene / architecture
- 対象コミット: `9b89968b`
- 前ラウンド: [r12](2026-09-07-441-unmount-session-r12.md) / [r13](2026-09-07-441-unmount-session-r13.md)

## 所見

### [HIGH] 1. 捨てた席の反映待ちが残り、別の局面の評価値が現在の局面の結果として出る

reviewer: react（実測）

`discard` が落とすのは**それ以降**の `info` だけで、席が欄に入る前に届いて
`latestResultRef` に入った1本と、それが張ったタイマーには触らない。この経路は
`stop_analysis` を dispatch しないので、タイマーは起きて commit される。

```
3) 捨てた s2 の後: candidates = [{"rank":1,"evaluation":{"type":"cp","value":999}}]
   currentPosition = P1 | analyzing = true   ← s2 が読んでいたのは P2、盤は P3
B2: AnalysisPane のキャッシュ条件 (currentPosition === currentSfen) = true
```

盤がその局面へ戻ると**ペインのキャッシュにも焼き付く**。r12-1 が塞いだのと同じ結末に、
`discard` という別の口から到達していた。

### [HIGH] 2. r13 の直しが同じ関数の中で1枝だけ。残り2枝は `error` にすら載らない

reviewer: robustness（実測）/ react（別の実測で同じ結論）

```
A 手動 ▶ が断られた: isAnalyzing= false error= null   thrown= Error: Analysis already running
B 自動再開が断られた: isAnalyzing= false error= "Failed to restart analysis: Analysis already running"
E 席を返せない ▶:    error= null startCore= 0 thrown= Error: ipc gone
```

**同じ Rust の失敗が、盤を動かして自動再開した回は `state.error` に載り、
利用者が ▶ を押した回は載らない。** A は #441 が再発したときの症状そのもの。

### 3. 送信の例外と上限切れが同じ文言。doc は復帰導線を書き分けている

reviewer: robustness / architecture（独立に）

`state.error` に入る文字列が1バイトも違わないので、#277 が出口を作った瞬間に
「もう一度押す」か「エンジンを起こし直す」かを選べない。定数名も `..._TIMEOUT_MESSAGE`
のままで、例外の枝に流用されている。どちらの文にも**次に何をすればよいかが無い**
（ADR-0004 の決定1／`main` の `REFUSALS` は本文に導線を書く）。

### 4. 自動再開の断りだけ、上流の英語をそのまま利用者向けの文にしている

reviewer: robustness

`"Failed to restart analysis: Analysis already running"` が `state.error` に入る。
他の口は日本語の1文。

### [HIGH] 5. 口ごとの表の `discard` の行が、本体が「それをやるとバグる」と書いた推論を正解として書いている

reviewer: comment

表だけを読んで `discard` を簡約すると、r13-3 が直した退行が戻る。
`useEngineSeat.test.tsx` が固定しているので**綴りでは止まらない**。

### [HIGH] 6. `stop_analysis_impl` の `///` だけ、3つの出典の中で `Err` の意味が違う

reviewer: comment

「指した側は照合してから消すので、席に居るのが別のセッションなら席は残る」だが、
実装は指した側も `remove` が先で、`analyzer.stop_analysis()` の失敗でも `Err` になる。
`useEngineSeat` / ※12 / F-7 は「エンジン側の失敗では席は空」と書いている。
ここを読んだ人は「指した `Err` なら席は残る」と判断して補償を足す。

## MEDIUM

7. **`matches` / `forget` / `send` / `occupy` の名前が振る舞いとずれ、doc がそれを打ち消している**（comment / architecture）。
   `matches` は席を握っていなければ**どの ID でも true**。`forget` は本体で `remember` を呼ぶ。
   `send` はこのファイルの語彙（撃つ）から外れ、provider では「局面の送信」を指す。
   `occupy` は「取って撃つ」と名乗るが `discard` は外で撃つ。
8. **同じ事実（Rust は席を消してから止める）が同じファイルに2度**（architecture）。
9. **`shoot` の catch が「握らない回にその席がどうなるか」を書いていない**（comment）。
10. **`AnalysisContextType` の2つの口に契約が無い**（comment）。▶ は reject する、
    ■ は届かなくても resolve する——この非対称がこの PR の主題そのもの。
11. **▶ の本体（90行）に頭の doc が無く、説明が7ブロック散っている**（comment）。
12. **■ の「世代を先に上げる」順序依存に理由が無い**（comment）。他の2箇所には書いてある。
13. **r13 で足したラチェットが、狙っている宣言の形をどれも見ていない**（architecture）。
    `const \w+ =` は分割代入も `let` も拾わず、`const tick = useRef(0)` を誤検知する。
14. **`docsSourcePaths` の doc・`describe`・`CONTRIBUTING.md` が「状態遷移表だけ」のまま**（architecture）。
15. **`spec/screens/` を走査に入れた根拠が、`spec/README.md` が義務づける「これからの要件」と衝突**（oss-hygiene）。
16. **※1 の「4つ」が、この PR が5つ目を足した後も4つのまま**（oss-hygiene / robustness / react の3人）。
    ※4 の「同期タイムアウトのときだけ」も嘘になった。
17. **※15 の「自動再開の側は投げる回を `catch` で拾う」が現物と違う**（oss-hygiene）。
    その `catch` は無く、実際は上限切れの枝へ最大 2000ms 遅れて落ちる。
18. **`app.md` の ※1「立てる口は3つだけ」に起動時ロードが入っていない**（oss-hygiene）。
    r13 でこの注を A0 も読む位置へ移した結果、そこが欠けた。
19. **F-2 の失敗名と復帰導線が更新されていない**（oss-hygiene）。上位2つの文書が
    新しい枝をそこへ送り、台帳だけが逆を書いている（r13-11 の F-7 と同じ形）。
20. **F-7 と `analysis-pane.md` が、起こし直し方の結論を逐語で写している**（oss-hygiene）。
    「出所を一本化した」と言いながら、直すときは3箇所を同時に直す必要がある。
21. **`IDEAS.md` の `vi.mock` の行数（10）が再現しない**（oss-hygiene）。実測4。
22. **r13-16（棚卸しカタログ）は「直した」と記録されているが、現物は1バイトも変わっていない**（oss-hygiene）。
    `obs-shogi-spec.md` の発掘元も ADR-0009 前のモジュール名のまま。
23. **▶ を押してから最大数秒、画面が1ドットも動かない**（robustness。実測 457ms、
    実機の最悪値は約5秒）。**永久に壊れた回と画面が完全に同じ。**

## 重複・矛盾した所見

- 所見2 は robustness と react が別の実測で同じ枝を指した。
- 所見3 は robustness（利用者への案内）と architecture（定数名の嘘）から同じ結論。
- 所見16 は3人が独立に数え直した。
- 矛盾は無し。

## 見ていない範囲

- `analyzer.rs` / `protocol.rs` の内部と #463 の窓の幅。**14ラウンド続けて未見。**
- 実プロセス（本物の USI エンジン）を使った検証は誰もしていない。
- `provider.test.tsx` の本体（コメントと `SLOW` の適用範囲だけ）。

## 修正計画

1. **所見1 → 席を捨てる行で `dropPendingResult()` を通す。** テスト1本、変異で確認
2. **所見2・3・4 → ▶ の失敗3枝を同じ形に揃え、文言を枝ごとに割る。**
   どの文も次の一手で終える。自動再開の断りから上流の英文を落とす。テスト2本
3. **所見5〜9・13 → 名前と doc。** `accepts` / `closeFinished` / `shoot` / `holdSlot` へ改名し、
   ラチェットの判定を「`useRef` を含まない宣言を列挙」に反転する
4. **所見10〜12・14・15 → 公開面の契約と走査の範囲**
5. **所見16〜22 → doc。** 数の断言をやめ（`grep` で数える形へ）、枝ごとの断りを台帳まで通す
6. **所見23 → issue #491**（r10 で立てたものと同じ。この PR では直さない）

### 次ラウンドの焦点

- 2 で足した `failStart` が、**要らなくなった要求の失敗まで画面に出していない**か
- 3 の改名（`accepts` / `closeFinished` / `shoot` / `holdSlot`）が、doc の参照を1つでも
  取り残していないか
- 5 で「数え上げない」に変えた ※1 が、**分類そのものを現物と食い違わせて**いないか

## 修正の結果

| 所見             | 結果                                                                  | コミット                            |
| ---------------- | --------------------------------------------------------------------- | ----------------------------------- |
| 1                | 直した。席を捨てる行で反映待ちも捨てる                                | `bd8ede5e`（テスト1本、変異で確認） |
| 2 / 3 / 4        | 直した。3枝を同じ形に揃え、文言を割って次の一手を書いた               | `7147cffc`（テスト2本、変異で確認） |
| 5〜9 / 13        | 直した。改名4件とラチェットの判定の反転（変異で確認）                 | `bd065bc8`                          |
| 10〜12 / 14 / 15 | 直した                                                                | `972ab524`                          |
| 16〜22           | 直した。※1 から数を落とし、F-2 を更新し、r13 の報告書の誤りも訂正した | `b929cd50`                          |
| 23               | **issue #491 へ**（この PR では直さない）                             | —                                   |
