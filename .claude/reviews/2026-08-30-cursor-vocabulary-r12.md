# レビュー cursor-vocabulary ラウンド12

- 日付: 2026-08-30
- 範囲: `git diff main...HEAD`
- 対象コミット: `6f76ac1`
- 走らせた reviewer: comment / architecture
  （robustness は r11 で「所見なし」。r11 以降の変更は doc とコメントだけで
  実装の変更が1行も無いので走らせていない）

## architecture: **所見なし**

r11 の判定を doc 変更後に洗い直し、覆す変化は無いと確認。

- `d111a38..HEAD` の差分は doc / コメント4ファイル・12行だけ。
  import 文・export・シグネチャの変更は**1行も無い**
- 上向き import **0件**／循環 **0件**
- `tesuuPointer` の手書き分解 **0件**／`as TesuuPointer` は `model/cursor.ts` の3箇所
- **差分中の番号なし未決 0件。** 参照している issue（#226 / #239 / #295 / #296 /
  #297 / #302 / #306 / #310）は全て OPEN。`#74` だけ CLOSED だが、
  これは回帰テストが「どの issue の再発を止めているか」を書いたもので未決の印ではない

## 所見（comment のみ、2件とも MEDIUM）

**C1 r11 で削った「要求を比べる正典」が、別ファイルの行末コメントに残っていた**

`KifuCommentNote.tsx` の `editorKey` の行。`cursorKey` をそこで最初に見た人には、
r11 で塞いだはずの穴（#239 の no-op ガードにこの鍵を使う）がそのまま開いている。
**用途そのものは正しい**（この `cursor` は `descendTo` 由来で `te <= tesuu` しか持たない）。
誤っているのは鍵の位置づけの説明だけ。→ 型側の語彙に揃えた。`「正典」`は `src/` から消えた。

**C2 CLAUDE.md の落とし穴「`goto` は `tesuu` が一致しなければ stale として扱う」が偽**

ライブラリの実装は届かなければ黙って止まるだけで、stale の印は返らない。
アプリ側にも `goto` 後に `tesuu` を突き合わせる箇所は無い（自分でも確認した）。

同じブランチの `buildPlayer.ts` は「`tesuu` の比較では後者を検出できない」、
`branch-index.md` は「**要求した局面に着いたかは `tesuu` では判定できない**」と
書いているので、**リポジトリの入口の doc だけが逆を言っていた**。
しかもこのリストの直上の行はこのブランチが語彙統一のために書き換えており、
対にすべき行が古いまま並んでいた。

これを先に読んだ人は「到達判定は再生器が面倒を見ている」と読む。#296 を実装する人が
最初に開くのが CLAUDE.md の落とし穴なので、r10 が実測した退行を `reachedCursor` を
通さずに再現する筋道がここに残っていた。→ 実在する規約に置き換えた。

## comment が確認して「食い違いなし」とした点

依頼した確認項目のうち、次は現物と一致していた（所見にしていない）。

- **`TesuuPointer` の一意性の記述** — `AnalysisPane` は `selectedNode.id` と組み、
  `KifuStreamList` は dep に `state.loadedAbsPath` を持つ。r11 で足した doc のとおり
- **4つのカーソル型と2つの鍵** — 「`te > tesuu` を持つのはどれか」「`asBranchPlan` の
  許可先3種」「`cursorKey` と `tesuuPointer` の役割分担」は現物と一致。
  `cursorKey` の doc は削除後も肯定と否定が並ばない
- **`game.md` / `branch-index.md` の数え上げ** — `set_error` 9箇所、`clear_error` 7箇所、
  `applyCursor` の呼び出し側3つ、`asBranchPlan` の書き込み7経路、※1 の脱出路3つ、
  ※6 の E16 の番人1行。いずれも実装と一致
- **変更の経緯の混入** — 差分の新規コメントに0件
- **命名** — `JKFPlayer` を受ける引数は `src/` 全体で `player` に統一（`jkf` / `sim` の残存0件）

## 見ていない範囲

- `src-tauri/`（差分に1行も無い）
- SCSS / レイアウト / キーボード操作 / フォーカス管理
- 実アプリを起動しての動作確認
- robustness（r11 で所見なし。以降の実装変更が0行）
- `branchEdit.test.ts` / `buildNextOptions.test.ts` / `comment.test.ts` の個々のケース名
- `entities/kifu` に barrel が無く deep import が規約である点（既存構成 → #216）

## lint / hook で強制できるもの

- C1（同じ関数の位置づけを別ファイルで逆に書く）は機械で止まらない。
  禁止語で「正典」のような断定語を狙い撃ちすることは可能だが、**two-strikes に
  達していない**（今回が1回目）
- C2 は「CLAUDE.md の落とし穴に書かれた識別子が実在するか」までしか作れず、
  **振る舞いの嘘は落とせない**

## 次ラウンドの対象

`KifuCommentNote` のコメントと CLAUDE.md の落とし穴を見る。
実装の変更はこのラウンドも0行なので、comment を中心に。
