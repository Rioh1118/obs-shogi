# レビュー cursor-vocabulary ラウンド14

- 日付: 2026-08-30
- 範囲: `git diff main...HEAD`
- 対象コミット: `907bc54`
- 走らせた reviewer: comment / architecture / robustness

**r13 で足したラチェットに穴があった。3人が独立に同じ根を指した。**

## BLOCK / HIGH

**R1 [robustness / architecture] `cursorKey` を使った直書きが、型もラチェットも素通りする**

r13 で「口を閉じた」と書いたが、閉じたのは `makeKifuCursor(` という綴りだけだった。

```ts
return { tesuu: p.tesuu, forkPointers: p.forkPointers, tesuuPointer: cursorKey(p) };
```

`KifuCursor` は素の `interface` で、brand が付いていたのは `tesuuPointer` の**型**だけ。
`cursorKey` はその brand 付きの値を返して公開されているので、
**キャストも `makeKifuCursor` も使わずに** `KifuCursor` が組める。
自分でも再現した（`tsc -b` exit 0・`lint` 緑・ラチェット緑）。

`cursorKey` は非 owner の4ファイルが既に import しているので、
そこで `KifuCursor` が要る場面に出くわした人が書く最短経路がこれになる。
入れば `provider.tsx` の移動前後の比較が着けもしない識別子で回り、
**盤が動かないのにエラーも出ない**（r4 A1 / r8 C2 / r10 が実測した退行）。

robustness の指摘のうち最も重いのはここ:
**ラチェットが緑のまま通るぶん、doc だけで禁じていた r13 以前より悪い。**
読み手は「機械が見ているから安全」と読む。

→ `KifuCursor` の**型そのものに brand** を足した（`e02e891`）。
`BranchPlan` / `PlannedCursor` で既に採っている手当てと同じ形。
直書きも、別名の補助関数を挟む形も **TS2741** で落ちる。

## ラチェットの作り直し（`d4df4b6`）

3人が挙げた残りの穴に、5つとも変異を当てて確認した。

| 逃げ道                                         | r13 | r14 で                             |
| ---------------------------------------------- | --- | ---------------------------------- |
| 外から `makeKifuCursor(` を呼ぶ                | 赤  | 赤                                 |
| `import { makeKifuCursor as mk }` で別名にする | 緑  | **赤**（綴りの持ち出しを見る）     |
| `playerCursor.ts` に `as TesuuPointer` を書く  | 緑  | **赤**（綴りごとに持ち主を分けた） |
| 文字列リテラル中の `/*` で検出を潰す           | 緑  | **赤**（行頭だけを見る形に）       |
| 持ち主側の呼び出しを消す（番人の空振り）       | 緑  | **赤**                             |

**番人が空振りしていた。** 「持ち主で実際に使っている」は `OWNERS` を2つの綴りの
**和**で判定していたので、`cursor.ts` は `export function makeKifuCursor(` という
**宣言行そのもの**に当たって通っていた。`as TesuuPointer` が使われているかは
一度も確かめていない。綴りごとに持ち主を分け、宣言行を数から外した
（`makeKifuCursor` を**呼ぶ**のは `playerCursor.ts` だけ、という事実がここで出た）。

### コメント除去は2度作り直した

文字列リテラル中の `/*` が遠くの閉じと組になり、**間の本物のコードが消える**
（robustness が実測）。消えた範囲は検査から外れるので、違反があっても緑になる。

1度目は「削った量が半分を超えたら落とす」にしたが、**この repo の
`cursor.ts` は本文の6割がコメント**で、健全なファイルが落ちた。比率は指標にならない。

2度目は文字列を見分ける1文字ずつの走査にしたが、JSX の `</div>` と `/>` を
正規表現リテラルの始まりと読んで同じ「黙って消える」に戻った。

**3度目に行頭だけを見る形へ落とした。** 言語を解析しない。
コードと同じ行の末尾コメントは落とさないので、そこに綴りを書くと違反として
**目に見えて落ちる**。黙って取りこぼすより、うるさく落ちる側に倒している。

### reviewer の指摘と食い違った点

comment は「山括弧キャスト `<TesuuPointer>s` が tsc も lint も通るので
`GUARDED` に足せ」と書いたが、**これは誤り**。`tsconfig.app.json` に
`erasableSyntaxOnly: true` があり、実際に書くと **TS1294** で落ちる（自分で確認）。
robustness は同じものを B 行で「落ちる」と正しく測っている。
正規表現には足さず、その旨をラチェットの doc に書いた。

## MEDIUM

| #   | reviewer | 所見                                                          | 結果                          |
| --- | -------- | ------------------------------------------------------------- | ----------------------------- |
| C1  | comment  | `cursorSelection.ts:23` だけ「`makeKifuCursor` が作る」のまま | 直した（`e03afbd`）           |
| C2  | comment  | `provider.tsx` の比較に、それを守る規約が1行も書かれていない  | 直した（`09f78bc`）           |
| C3  | comment  | `CONTRIBUTING.md` の「機械で止めているもの」に新しい4本が無い | 直した（`09f78bc`）           |
| C4  | comment  | 検査の doc に作業の回数（禁じている経緯）が入っている         | 直した（`09f78bc`）           |
| C5  | comment  | `docsSourcePaths` が接頭辞を省いたパスを拾わない              | **検査を広げた**（`25c7843`） |
| C6  | comment  | `CLAUDE.md:67` に主張が5つ入り、いちばん危ないものが200字先   | 直した（`fefd2b5`）           |
| C7  | comment  | `resolveLine.ts:19` の `side` が2行下の「側」と混在           | 直した（`e03afbd`）           |

**C1 は r13 の直し漏れ。** 位置づけを書いている箇所は13あり、r13 で揃えたのは
CLAUDE.md と `game.md` の2つだけ。分岐メニュー側の1行が残っていた。
r13 の報告書の表もこの2箇所しか数えていない。

**C5 は doc を直すのでなく検査を広げた。** 接頭辞を省いた8件は全て実在するので、
`ROOTS` を前から順に付けて探す形にすれば doc を1件も書き換えずに範囲が広がる。
広げたら `engine-position-sync.md` が**実在しないパス**を指していた
（`__tests__/useEnginePositionSync.test.tsx`）。この形は一度も検査されていない。
壊したパスで落ちることも確認した。

## architecture が確かめて「所見なし」とした点

- `src/__tests__/` と スライス内 `__tests__/` の使い分けには**明文化された基準がある**
  （`testsLayerBoundary.test.ts` が「`src/**` をデータとして読む検査だけ」を機械で強制）。
  場当たりではない
- `OWNERS` のパスのハードコードは、改名すると2本とも赤になる（fail-safe）
- 上向き import 0件／循環0件／`tesuuPointer` の手書き分解 0件／
  `p.te` を手で回すのは `entities/kifu` の外に0件／番号なしの未決 0件
- コミットの刻みは「元に戻すときに一緒に戻したい単位」になっている

## 見ていない範囲

- `src-tauri/`（差分に1行も無い）
- SCSS / レイアウト / キーボード操作 / フォーカス管理
- 実アプリを起動しての動作確認
- `main` との差分試験の再実行（robustness が「本番コードは r13 の対象コミットから
  バイト単位で変化なし」を確認したうえで省略。r14 で本番コードを変えたのは
  `KifuCursor` の brand と `provider.tsx` のコメントで、**前者は型だけ・
  後者はコメントだけ**なので実行時の振る舞いは変わっていない）
- `entities/kifu` に barrel が無い点（→ #216。architecture が具体例として記録）

## lint / hook で強制できるもの

- （実装した）型 brand による直書きの禁止、綴りごとの持ち主、行頭コメント除去、
  接頭辞を省いた doc パスの検査
- `CONTRIBUTING.md` の表と実在するラチェットの数え上げ突き合わせ
  （今回の4本の抜けはこれで止まる）。**two-strikes に達していない**（今回が1回目）
- doc 中の `#N` が CLOSED を指していないかの検査（r11 で two-strikes 到達、CI 向き）

## 次ラウンドの対象

`KifuCursor` の brand、作り直したラチェット、広げた `docsSourcePaths` を見る。
**r14 は実装に手を入れているので robustness を必ず走らせる。**
