# レビュー cursor-vocabulary ラウンド3

- 日付: 2026-08-30
- 範囲: `git diff main...HEAD`
- 対象コミット: `719ec62`
- 走らせた reviewer: robustness（r2 の取り戻し）/ architecture / comment

## robustness の差分検証（ラウンド2の取り戻し）

r2 で途中終了したぶんを走らせ直した。**`main` と `HEAD` を実際に走らせて突き合わせ、
退行なしを確認した**（reviewer が差分検証用のコピーを作って実行、後に削除）。

| 何を                                                             | どう確かめたか                                                                                                                                | 結果                                                       |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `selectAt` への集約（`setBranchIndex`）と `truncateFrom`（退避） | 乱択の入れ子棋譜で `swapBranchesInKifu` / `deleteBranchInKifu` を **3000ケース**、棋譜全体・`changed`・`nextCursor`・throw の有無を突き合わせ | **全ケース一致**                                           |
| `sameStreamPrefix` の書き換え                                    | 重複 `te`・逆順・空を混ぜた **200,000ケース**で旧実装と直接比較                                                                               | **全ケース一致**                                           |
| `comment.ts` の `resolveLine` 化                                 | 手ごとに固有のコメントを埋めた棋譜で **各4000ケース**                                                                                         | **当たる手・`{ok, changed}`・書き換え後の JKF すべて一致** |

型を狭めた3件（`cursorFromLite` / `BranchEditResult.nextCursor` / コメント経路）で
落ちた `tesuuPointer` は、**`main` の時点でどの呼び出し側も読んでいなかった**ことも確認。
失敗の検出手段が新たに失われた箇所は無い。

## 所見

### HIGH（すべて自分が書いた doc の嘘）

| #   | 所見                                                                                                          | 結果   |
| --- | ------------------------------------------------------------------------------------------------------------- | ------ |
| C1  | 「この型を作ってよいのはここだけ」が3つとも守られていない（`TesuuPointer` 3箇所 / `KifuCursor` 3箇所）        | 直した |
| C2  | `PlannedCursor` の doc が「`KifuCursor` も `te > tesuu` を持ちうる」と言うが、3行下で「持たない」と書いている | 直した |
| C3  | `PLAN_WALK_LIMIT` の「この値が先に効く場面は無い」が偽（`goto` を通らない経路が2つある）                      | 直した |
| C4  | `game.md` の ※1 / E3 / E6 が「捨てて本譜へ」と書くが、線の末尾では1手も動かない                               | 直した |
| C5  | `docsSourcePaths` の除外理由が実測と違う（3件とも ShogiHome のパスで、「作らないと決めたもの」ではない）      | 直した |

**C3 は同じ定数について3回目。** r1 で書き、r2 で直し、r3 でまた別の形で外した。

### MEDIUM

| #   | reviewer       | 所見                                                                                       | 結果                 |
| --- | -------------- | ------------------------------------------------------------------------------------------ | -------------------- |
| C6  | comment        | `docsSourcePaths` の doc に変更の経緯（「#279 の中で3回起きた」）が入っている              | 直した               |
| C7  | comment        | `sameStreamPrefix` の doc が、実際に効いている理由（整列）を書いていない                   | 直した（+テスト）    |
| C8  | comment/robust | レンダ中に throw が漏れたときの結末が、同じ PR の中で2通り書かれている                     | 直した               |
| C9  | comment        | `plannedForkIndexAt` / `truncatePlanFrom` が計画専用でないのに「計画」の語で固定されている | 直した               |
| A5  | architecture   | `docsSourcePaths` が `tables()` と二重の集合定義で、0件でも緑になる                        | 直した（下限を追加） |
| A2  | architecture   | `ApplyMoveResult.forkPointers` に読み手が無い                                              | **issue #302**       |
| A3  | architecture   | `PreviewData.nodeId` に読み手が無く、識別子の知識が UI 2箇所に染み出す                     | **issue #302**       |
| A4  | architecture   | `asBranchPlan` が公開された無検査 cast で、brand が本来止めたいものを止めていない          | **issue #303**       |

### 所見にしなかったもの

**`src/__difftmp__/` が未追跡で残り `tsc` が落ちる**（architecture が HIGH で報告）
→ **これは robustness reviewer が差分検証のために作った作業ファイル**で、
このブランチの成果物ではない。削除して `npm run verify` が緑（53 files / 457 tests）に
戻ることを確認済み。コードの所見ではないので所見表に入れない。

## 重複・矛盾した所見

**C8 は comment と robustness が独立に挙げた。** 両者とも「`AppModalLayer` は
`AppErrorBoundary` に包まれているので root は unmount しない」を根拠にしており、
`pages/AppLayout.tsx` を読んで裏を取った。

**C7 は所見が正しく、自分の最初の直しが不十分だった。**
doc を直した時点では「置き換えると壊れる」ことを**テストが1本も見ていなかった**
（変異を当てても20本すべて緑）。fixture を組み直して、編集する `te` より手前に
選択が**2つ**ある形にして初めて落ちるようになった。所見に従って doc を直すだけでは、
次に同じ置き換えをする人を止められなかった。

## 見ていない範囲

- `src-tauri/`（差分に1行も無い）。`search/index_builder.rs` の `fork_path` の
  生成規則だけ、`cursorAdapter` の主張の裏取りに読んだ
- SCSS / レイアウト / キーボード操作 / フォーカス管理
- 実アプリを起動しての動作確認
- perf（r1 で実測済み。以降は置き場の移動と doc の修正のみ）
- react（r2 で所見1件、それは #227 へ送った。今回の差分に `.tsx` の
  ロジック変更が無いので走らせていない）

## lint / hook で強制できるもの

- **`src/` 直下にレイヤ名以外のディレクトリを作らせない**検査。`__difftmp__` のような
  作業ファイルが `tsc` と vitest の対象に混ざるのを止める。`.gitignore` は逆効果
  （見えないまま対象に残る）
- **`as TesuuPointer` / `KifuCursor` リテラルの構築箇所の数をラチェットで固定する。**
  doc が「ここだけ」と言い続けられるかは人の注意では保てない（C1 がまさにそれ）
- **テストファイル名と対象モジュール名の一致検査**（`__tests__/X.test.ts` に対し
  `../X.ts` が実在すること）。C9 で直した `branchPlan.test.ts` はこれで止まる
- `commentHistory` の `HISTORY_WORDS` に回数表現を足す。C6 はいまの語彙を素通りする

## 次ラウンドの対象

今回の修正（`requestedCursorAt` の新設、`forkIndexAt` / `truncateFrom` への改名、
doc の書き直し）に対して architecture / comment を再走。
robustness は差分検証で退行なしを確認済みなので、`requestedCursorAt` の新設だけを見る。
