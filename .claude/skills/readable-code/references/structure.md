# 部品の構造と書き方

規則は `docs/rules/ts.md` の R-TSC と R-TSW、決定は ADR-0014。ここには実在の例、実測、動作の危険を置く。
数は基点 6545bcba、テストを除く `src/` の部品 204 本。**規則の根拠で、現在値ではない。**
現在値は `src/__tests__/componentShape.test.ts` の `BASELINE` を見る。

## 実測

| 測ったもの | 値 | 読み方 |
| --- | --- | --- |
| 部品の行数の中央値 | 36 | 1000行近いのは `AnalysisProvider` など provider の3本で、部品というより状態の持ち主 |
| hook の数の中央値 | 1 | 最大は `AnalysisProvider` の56 |
| 分岐の数の中央値 | 2 | 最大は `FileTreeProvider` の71 |
| effect が3本以上 | 10 本 | 上位の過半は provider 以外の画面（`KifuStreamList`、`KifuCommentNote` など） |
| state が5本以上 | 10 本 | `EditorCreateForm` の10が最大。フォームの欄が並ぶ形 |
| 素通しが3欄以上ある部品 | 11 本 | 大半は葉の部品へ1段渡すだけで、2段続く形ではない |
| 区画を `ReactNode` で受ける欄 | 26 欄 | `SField`、`SSection`、`GameBoard`、`FloatingNote` |
| `createContext` | 14 | スライスの provider が大半 |
| 部品の中で定義した部品 | 0 | 維持する |

## 例

### `children` と名前つきの区画

- `StepShell` は見出しを `title` で、本文を `children` で受ける。本文は呼び手の JSX で読める
- `GameBoard` は `topLeft` `center` `bottomRight` の3区画を受ける。位置は部品が決め、中身は呼び手が決める（R-TSC-3、R-TSC-9）
- `SField` は入力欄を `children` で受け、`label` と `error` を名前で受ける。本体が1つ、飾りが複数ある形
- `DirectoryNode` の `renderChild` は関数で受ける。子を描くのに部品が持つ `child` と `level` が要り、`import/no-cycle` のために `TreeNode` を読めない

### 素通しと Context

素通しは欄の数でなく段の数で見る。`Step3PlaceEngines` の `onScan` は葉の `Button` へ渡すだけで、これは素通しの問題ではない。
問題になるのは、中間の部品が読まない欄を受けて更に下へ渡す形が2段続くとき。先に `children` を試す。
React の文書も、何段か渡すだけでは Context にする理由にならないと書いている。

`RuntimeProviders` は `children` の入れ子で並びを読ませている。並びの理由はコメントに書き、配線は `gates/` と `bridges/` に置く。

### 粒度

分けると飛び先が1つ増える。分ける価値は、分けた後に呼び手が読む量が減ること。

- 分ける: 役割の1文に「と」が要る。state の寿命が別で、片方だけ作り直したい
- 分けない: 呼び手が1つで、受けた欄をそのまま描くだけ。2つのファイルを行き来しないと読めないなら絡み合いの合図（Ousterhout）

### 複雑さ

`EngineAction` は状態ごとに早期 return で1つのボタンを返す。分岐の数は多いが、上から読める。
数より、組み合わせが取りうる形を余らせていないかを見る。送信中と送信済みの真偽の組は状態の union にする（R-TST-1）。
3つ以上の state が絡むなら表に書ける形にする（R-TSS-3）。

## 動作が変わりうる変更

部品の分割、統合、`children` への置き換えは、コメントや改名と同じ扱いにしない。

| 変えるもの | 変わりうるもの | 確かめ方 |
| --- | --- | --- |
| 部品を分ける、まとめる | React の木の位置が動くと、その下の state が捨てられる | state を持つ子の値が保たれるテスト |
| 部品の型を差し替える | 同じ位置でも別の部品なら作り直される | 同上。`key` で作り直しているなら意図を確かめる |
| `children` へ置き換える | 親の state の更新で子が描き直されなくなる。描画の回数に依存した処理が変わる | 表示のテスト。描画中の副作用が無いことを R-TSR-1 で確かめる |
| ラッパーの要素を足す、外す | DOM の親子。CSS の子孫セレクタと `:first-child`、`gap` | `docs/spec/` の画面と実アプリ |
| effect の並びを変える | 同じ部品の effect は書いた順に走る | effect の順を変えない。変えるならテストで順を固定する |
| Provider の並びを変える | 子の effect は親より先に走る。初期化の順が変わる | 初期化の順を読み、`RuntimeProviders` の doc と突き合わせる |
| `.scss` の import を動かす | CSS の並びと上書きの勝敗 | `npm run build` の CSS の差分と実アプリ |

## 字面で揃えられる書き換え

型だけの書き換えは `.claude/skills/tidy-code/scripts/emit-unchanged.mjs <基点>` が差0と言う。
`interface` から `type`、`React.ReactNode` から `ReactNode` がこれに当たる。

宣言の位置を動かす書き換えは JS の差として出るので、`git diff --color-moved` で動いただけと見る。
`? : null` から `&&` は JS が変わる。左辺が真偽でなければ `0` や `""` が画面に出るので、左辺の型を読む。
