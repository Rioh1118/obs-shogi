# レビュー entities-kifu ラウンド5

- 日付: 2026-08-30
- 範囲: `refactor/163-entities-kifu`（issue #163 / #164 / #165 / #166）の `origin/main` からの差分
- 対象コミット: `889f3e5`
- 走らせた reviewer: architecture / react / robustness / perf / comment
- 前ラウンド: `-r1.md` / `-r2.md` / `-r3.md` / `-r4.md`

**doc の嘘は HIGH が0件になった**（r1:2 / r2:1 / r3:1 / r4:2 / r5:0）。
代わりに、直しの網が1形ぶん粗かった件が2つ出ている。

## 所見

| 番号  | 深刻度 | reviewer                     | 内容                                                                                                                                                                                                                                                   | 結果                                              |
| ----- | ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| R5-01 | MEDIUM | comment, robustness          | `privatizeHead` が弾くのは「長さ0」だけで、`sanitizeJkf` が落とすもう1形「先頭が null」を素通しする。`forks: [[null]]` を入れ替えると `{ ...null }` が `{}` になり、中身の無い手が本譜に入ってファイルに書き戻される。R4-05 が塞いだのは片方だけだった | 直した（判定を `isUsableFork` 1本に。変異で確認） |
| R5-02 | MEDIUM | comment                      | `@throws`「`te` に手が無いとき」が `te = 0` で成り立たない。`moves[0]` は開始局面のエントリなので truthy で、本譜の削除が `moves` を空にする。止めていたのは `KifuMoveCard` の `row.te !== 0` だけ                                                     | 直した（`te < 1` を弾く。変異で確認）             |
| R5-03 | MEDIUM | comment                      | `readCandidates` の doc が `privatizeHead` の上に取り残され JSDoc が2連。`readCandidates` は doc を失っていた                                                                                                                                          | 直した                                            |
| R5-05 | MEDIUM | architecture                 | `cursorRuntime.ts` の中身が `buildPlayer` 1本になり、ファイル名が何も指していない                                                                                                                                                                      | 直した（`buildPlayer.ts` に改名）                 |
| R5-04 | MEDIUM | comment, react, architecture | R4-09 の改名が型名まで巻き込み、`previewCursorDraft` が `src` 全体で唯一の小文字始まりの型になっていた                                                                                                                                                 | 範囲外として `main` の形へ戻した（下記）          |
| R5-06 | MEDIUM | comment                      | `useLayoutEffect` の理由コメントが挙げる「0手目のプレビュー」は起動後の初回しか起きない                                                                                                                                                                | 同上（コメントごと戻した）                        |
| R5-07 | MEDIUM | react                        | `useLayoutEffect` は同期ではなく初期化。開くたびにプレビューを2回組み1回目を捨てる                                                                                                                                                                     | 同上。#217 へ                                     |

## 範囲を戻した判断

`features/position-navigation` の effect は、この PR の範囲（`entities/kifu` の整理）の外にある。
レビューの所見に引きずられて R2-10 / R4-02 / R4-03 と3ラウンド触り、その過程で回帰を1つ作った
（R4-03: 開いた最初のフレームが古い値で描かれる）。触り続ける理由が無いので、
**範囲内の変更だけ残して `main` の形へ戻した。**

| 残したもの                                                                     | 戻したもの                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `selectedBranchIndex` → `selectedOptionIndex`（#166 の「派生・紛らわしい値」） | 2本の `useEffect` を1本にまとめ `isOpen` で門番した変更 |
| `appliedForkPointers` → `normalizeForkPointers`（R4-04 の統合）                | その回帰を塞ぐための `useLayoutEffect` 化               |
| `BranchList` の key（#166）                                                    | 根拠が成り立たなかった `gameView.player` の三項         |
|                                                                                | `PreviewCursor` / `PreviewCursorDraft` の改名           |

戻したぶんの所見（R2-10 / R5-04 / R5-06 / R5-07）は #217 に1本でまとめた。

## 検証で所見にならなかったもの

- **perf は所見なし。** `normalizeForkPointers` の O(n²) は n ≤ 手数で、500手の最悪ケースでも
  +0.13ms/打鍵。1フレームに届くには n ≈ 4000 が必要で到達しない。
  `useLayoutEffect` 化でレンダ回数は `main` と同じ2回、paint 前に強制される JS は 0.15ms 未満
- **`readCandidates` の `empty fork` throw は到達しない。** robustness が `JKFData` の生成経路を
  数え直し、`parse` の出口 / `createInitialJKFData` / `applyMoveWithBranch` / `writeCandidates` /
  Rust の `normalized_jkf`（消費者0件）のいずれからも空の変化は入らないことを確認
- **`cursor.forkPointers` が `undefined` になる経路は無い。** `KifuCursor` を作る8箇所すべてが
  配列を入れており、文字列から復元する経路（URL / localStorage / 設定）は0件。R4-04 は等価
- **`buildPlayer` の doc（`goto` は届かなくても throw しない）は実測どおり。**
  comment が `goto(99)` / 手の無い `te` の `ForkPointer` / 再生できない手 / 短い変化の4通りで確認
- **「同じ手数の入れ子の変化は兄弟に平坦化される」は4通りで確認**（swap / delete / 3段の入れ子 /
  先頭以外にぶら下がる `forks`）

## 別の issue へ送る

| reviewer     | 内容                                                                                                          | issue |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ----- |
| react        | 局面ナビの `nav` は「開いた瞬間の初期値」なのに effect で同期している（R2-10 / R5-04 / R5-06 / R5-07 を統合） | #217  |
| react        | 局面検索の続き取得が、選択の外れた後に前のヒットの手を書き戻す                                                | #218  |
| react        | 局面ナビが全キーの既定動作を消し、`Escape` を2箇所で拾っている                                                | #219  |
| architecture | `cursor` から手を辿る走査が `comment.ts` と `branchEdit.ts` に2実装ある                                       | #220  |
| robustness   | 局面検索の続きが、索引と棋譜の世代ずれを検査せずに別の局面の手を出す                                          | #221  |
| architecture | `buildPlayer` が `KifuCursor` 全体を要求する件（#206 と同じ結論、根拠を追記）                                 | #206  |

## 見ていない範囲

- Rust 側の実行。`src-tauri/` に差分が無いため `npm run verify:rust` は未実行
- WebKit（実行環境）での実測。数値はすべて V8（Node v26.5.0）と happy-dom
- React のレンダ・reconcile・style/layout の時間。`useLayoutEffect` の判断はここが空白のまま
- SCSS とレイアウト、実機での操作確認
- 変化を含む棋譜での `goto` の実測（合成した変化が非合法で `normalizeMinimal` が通らなかった）

## lint / hook で強制できるもの

- 型・インタフェース名の PascalCase。R5-04 は R4-09 の修正で入った回帰なので、
  人の注意では止まらないことが実証されている
- 連続する JSDoc ブロック（`*/` の直後に `/**`）の禁止（R5-03）
- 未使用 export の検出（`knip` 等）。今ラウンドの `getMoveByCursor` / `normalizeCommentLines` で通算9件目。
  5ラウンド連続で出ている
- `as TesuuPointer` / `as BranchIndex` を宣言元ファイル以外で禁止する `no-restricted-syntax`
- 拾えないもの: 「同じ不変条件を2箇所で別の条件式にしている」ずれ（R5-01 は1つの関数に寄せる以外に
  防ぎ方が無い）、`@throws` の網羅性（R5-02）、`buildPlayer` の返り値の不一致を見ていないこと（#221）

## 次ラウンドの対象

R5-01〜R5-03 / R5-05 と範囲の巻き戻しを入れたうえで、修正で新しい問題が入っていないかを見る。
R5-01 / R5-02 はどちらも `branchEdit` の入力検査なので、robustness に入力の網羅をもう一度当てさせる。
