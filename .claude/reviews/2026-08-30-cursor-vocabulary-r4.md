# レビュー cursor-vocabulary ラウンド4

- 日付: 2026-08-30
- 範囲: `git diff main...HEAD`
- 対象コミット: `4a587a5`
- 走らせた reviewer: comment / architecture
  （robustness は r3 で `main` との差分検証を済ませ退行なしを確認。今回の差分は
  型の絞りと doc の修正なので走らせていない。perf は r1 で実測済み）

## 所見

### HIGH（すべて自分が書いた doc の嘘）

| #   | 所見                                                                                               | 結果   |
| --- | -------------------------------------------------------------------------------------------------- | ------ |
| C1  | `PLAN_WALK_LIMIT` の「`goToEnd` は `goto` を通らない」が偽。`navigate` は毎回 `buildPlayer` を通る | 直した |
| C2  | `game.md` の ※1 が脱出路を2つしか数えていない（`forkAndForward` が `false` を返す3つ目がある）     | 直した |
| C3  | **「本譜へ落ちる」が嘘。落ちる先は「いま辿っている線」**（src と docs の7箇所）                    | 直した |

**C1 は同じ定数について4回目**（r1 で書き、r2 で直し、r3 で直し、r4 でまた別の形で外した）。

**C3 が最も重い。** 実測で確認した: te=2 の変化にいるとき、te=3 の壊れた計画は
本譜の `"t3"` ではなく**変化の続き `"f3"`** に進む。r2 で `advanceMainLine` →
`advanceCurrentLine` に改名した理由が、関数名からは消えたのに doc 本文には
7箇所そのまま残っていた。落ちる先をテストで固定した。

**C2 の E3 / E6 のセルは r3 で直したつもりが、置換が ※5 の変更後の行に当たらず
黙って no-op していた。** 以降の置換は `assert` を付けている。

### MEDIUM

| #   | reviewer     | 所見                                                                                  | 結果           |
| --- | ------------ | ------------------------------------------------------------------------------------- | -------------- |
| A1  | architecture | `requestedCursorAt` が `KifuCursor` を返すので、要求の鍵を観測の欄へ入れられる        | 直した         |
| A3  | architecture | `BranchPlan` の brand が `planByTe` / `navigate` の callback まで届いていない         | 直した         |
| A2  | architecture | テストの fixture が実物の構築関数を通らず、オラクルとして効かない                     | 直した         |
| C4  | comment      | `docsSourcePaths.ts` の doc が「docs 全体に掛ける」と言うが絞っている                 | 直した         |
| C5  | comment      | `truncateFrom` の「使う側は2つ」が数え違い（3つ目がある）                             | 直した         |
| C6  | comment      | `KifuCursor` / `tesuuPointer` の doc が `requestedCursorAt` の返り値に当てはまらない  | A1 で解消      |
| C7  | comment      | `PlannedCursor` の「`te > tesuu` を持てるのはこちらだけ」が `previewCursor` に反する  | 直した         |
| C8  | comment      | `makeKifuCursor` / `requestedCursorAt` の命名が別系統で `At` の引数規約とも衝突       | A1 で解消      |
| A4  | architecture | `entities/search/index.ts` の公開境界が逆（正規化の口が非公開、`ForkPointer` が公開） | **issue #304** |

## 重複・矛盾した所見

**A1（architecture）と C6 / C8（comment）は同じ根に対する別の提案だった。**

- comment: `KifuCursor` の doc に「組む口は2つあり `tesuuPointer` の意味が違う」と書け
- architecture: doc ではなく**型**で分けろ。`requestedCursorAt` の返りを `CursorPath` にし、
  比較用の鍵を別関数に出せ

**architecture を採った。** doc で「同じ型だが意味が2つ」と説明するのは、
この PR が3ラウンド連続で失敗している「doc が実装を追いかける」形そのもの。
`cursorKey(path)` を切り出して `requestedCursorAt` を消すと、`KifuCursor` を組むのは
`makeKifuCursor`（再生器由来）と `ROOT_CURSOR` だけになり、
「`tesuuPointer` は必ず観測値」が**型で**成り立つ。C8 の命名の不揃いも消える。

副産物として `KifuCommentNote.cursorToStableKey`（`7__2:0` 形式の2つ目の鍵）も落ちた。
r1 M15 で「#227 が触るファイルなので型を狭めるまで」と据え置いたものだが、
「カーソルの正典キーは1つ」は #276 / #278 が乗る前に決めておくべきものなので、
ここで決めた。

## 見ていない範囲

- `src-tauri/`（差分に1行も無い）
- SCSS / レイアウト / キーボード操作 / フォーカス管理
- 実アプリを起動しての動作確認
- robustness（r3 で `main` との差分検証済み。3000 + 200,000 + 4000 ケースで一致）
- perf（r1 で実測済み）
- react（r2 で1件、#227 へ送った）

## lint / hook で強制できるもの

- **`src/` 直下にレイヤ名以外のディレクトリを作らせない**検査（r3 から再掲）
- **`KifuCursor` の object literal と `as TesuuPointer` の箇所数のラチェット。**
  r3 / r4 で2回提案されている。ただし A1 の直しで構築箇所が `model/cursor.ts` の
  中だけになったので、いま入れるなら「`model/cursor.ts` の外に `tesuuPointer:` を
  書かない」で足りる
- **テストファイル名と対象モジュール名の一致検査**（r3 から再掲）

## 次ラウンドの対象

今回は**型を動かした**（`PlannedCursor.forkPointers: BranchPlan`、
`buildCursorWithForkSelection` → `CursorPath`、`cursorKey` の新設、
`KifuCommentNote` の prop）。robustness を走らせ直して退行を見る。
architecture / comment も再走。
