# レビュー cursor-vocabulary ラウンド11

- 日付: 2026-08-30
- 範囲: `git diff main...HEAD`
- 対象コミット: `d111a38`
- 走らせた reviewer: comment / architecture / robustness

## robustness: **所見なし**

r10 で直した `reachedCursor` を、旧実装と並べて実測。

| 何を                                       | 結果                          |
| ------------------------------------------ | ----------------------------- |
| 届かずに手前で止まった（`tesuu` がずれる） | 旧 `true` / 新 **`false`**    |
| 同じ `tesuu` で別の線に着いた              | **`false`**                   |
| **偽陽性**（正しく着いているのに `false`） | 乱択 **3608ケース**で **0件** |

偽陽性の検証は独立オラクル（JKF の `forks` を手で降りて期待手順を組み、
`player.getMoveFormat(t)` の実際と突き合わせる）と比較している。

一致する理由も追ってある。`gotoPath` が `goto` に渡すのも `cursorKey` が
直列化するのも `normalizeForkPointers(path.forkPointers, path.tesuu)` の結果で、
`ForkPointer` リテラルは `src/` 全体で `te` が先（`forkIndex` 先行は0件）。
だから `JSON.stringify` の並びが揃う。

**差分全体として `main` より悪くなった箇所は無い。** 振る舞いが変わった2つ
（`goToEnd` / `nextMove` が内部文言を投げなくなった、Enter が `unreachable` を見る）は
どちらも改善側。

## architecture: **所見なし**

エピック #279 の完了判定を機械的に洗い直し、r10 の判定は変わらないと確認。

- 上向き import **0件**（全層）／モジュール循環 **0件**
- 同一レイヤ横断は `app-config ↔ engine-presets`（#313、差分外）を除いて **DAG**。
  `entities/{game,search,file-tree,study-positions} → kifu` は片方向で `kifu` は読み返さない
- `tesuuPointer` を手で分解する経路 **0件**／`as TesuuPointer` は `model/cursor.ts` の **3箇所**
- 3つ目の鍵書式は残っていない／`p.te` を手で回すのは `entities/kifu` の外に **0件**
- `model/` は JKF の**型**しか読まない。`JKFPlayer` を値で触るのは `lib/` だけ
- 差分で足した export で本番の呼び出し側が無いのは `reachedCursor` だけ（→ #296）
- **差分の中に番号の付いていない未決は無い**

## 所見（comment のみ）

### HIGH

**C1 `cursorKey` の doc が7行のあいだで肯定と否定を両方言っている**

```
:301  * つまり鍵は2種類あり、**要求を比べるのがこれ**。      ← r5 で書いたもの
:309  * **要求の重複判定にこの鍵を使わないこと**            ← r10 で足したもの
```

r10 で後者を足したとき、前者を落とし忘れた。上から読んだ人は4行目で
「要求の比較はこの鍵」と読み、#239 の no-op ガードを書いて次の段落まで読まない。
**r10 が塞いだつもりの穴がそのまま残っていた。** → `:301` を削除。

### MEDIUM

| #   | 所見                                                                      | 結果                |
| --- | ------------------------------------------------------------------------- | ------------------- |
| C2  | 「`tesuuPointer` の読み手がテストの中に居ない」が偽（3本が読んでいる）    | 直した              |
| C3  | `TesuuPointer` の型 doc に「一意なのは1つの棋譜の中だけ」が無い           | 直した              |
| C4  | `reachedCursor` の「呼ぶ側は無い」が3つの doc のうち1つにしか入っていない | 直した              |
| C5  | `usePositionHitNavigation` のコメント3箇所が `jkfPlayer` のまま           | 直した              |
| C6  | `→ issue #183` が CLOSED な issue を指す（差分外・`main` と同一）         | **#183 へコメント** |

**C4 で自分の報告書の誤りが見つかった。** r10 の報告書は
「`reachedCursor` / `branch-index.md` の不変条件2 に『いま呼ぶ側は無い → #296』を足した」と
書いたが、実際に入っていたのは `playerCursor.ts` だけ。
**`branch-index.md` への編集は、検証ゲートで止まったコミットの巻き戻しで消えていた**
（CLAUDE.md の `/implement` が警告している形そのもの）。
r10 の報告書の該当箇所も訂正した。

**C2 が指す番人は落とすと危ない。** `cursor.test.ts` の
`expect(ROOT_CURSOR.tesuuPointer).toBe(cursorKey(ROOT_CURSOR))` は、手書きリテラルの
`ROOT_CURSOR.tesuuPointer` が `JKFPlayer.getTesuuPointer` の書式から外れていないかを
見る唯一の番人。「どうせテストは読まない」と読んで落とされると書式のずれが緑になる。

**C3 は CONTRIBUTING が「必ず書け」と言う種類の情報。** 本番の読み手は2つしか無く、
**その2つが両方とも独立に「ファイル識別子と組め」を再発見していた**
（`KifuStreamList` のコメント3行と `AnalysisPane` の `cacheKey` の合成）。

## 見ていない範囲

- `src-tauri/`（差分に1行も無い）
- SCSS / レイアウト / キーボード操作 / フォーカス管理
- 実アプリを起動しての動作確認
- robustness の乱択棋譜は `move` を持たない手なので、**`doMove` が投げる経路
  （盤上で再生できない手）は通っていない**
- `provider.tsx` の `swapBranches` / `deleteBranch` がほぼ同型である点
  （差分に1行も無く、11ラウンドで一度も挙がっていない）
- `failure-surfacing.md` の F-12a / F-12b が `game.md` の主張と合っているか

## lint / hook で強制できるもの

- **doc 中の `#N` が CLOSED な issue を指していないかの検査。**
  今回の #183 と、過去に `#213` / `#243` を落とし忘れて2回指摘されたのが全部これ。
  `gh` に依存するので CI の別ジョブ向き。**two-strikes を満たしている**
- 「1つの doc の中で同じ関数について肯定と否定が並ぶ」（C1）は機械では止まらない。
  根は `cursorKey` の doc が長いことで、鍵を2つの型に割れば doc の半分が消える。
  ただし #279 の範囲外の設計変更

## 次ラウンドの対象

`cursorKey` の doc、`TesuuPointer` の一意性の記述、`branch-index.md` の #296 を見る。
robustness と architecture は今回0件なので、comment を中心に。
