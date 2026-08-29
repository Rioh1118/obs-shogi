# レビュー entities-kifu ラウンド6

- 日付: 2026-08-30
- 範囲: `refactor/163-entities-kifu`（issue #163 / #164 / #165 / #166）の `origin/main` からの差分
- 対象コミット: `86b3d0a`
- 走らせた reviewer: architecture / react / robustness / perf / comment
- 前ラウンド: `-r1.md` 〜 `-r5.md`

## 所見

| 番号  | 深刻度 | reviewer              | 内容                                                                                                                                                                                                                                                                                                                  | 結果                                                               |
| ----- | ------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| R6-01 | HIGH   | robustness            | `BranchIndex` の範囲検査が整数を要求していない。`NaN` も小数も `< 0` と `>= count` の両方を false にするので素通りし、`splice` が 0 方向へ丸める。`target: NaN` / `0.5` で**本譜が消え**、`1.9` / `2.000001` で頼んだのと違う変化が消える。どちらも `changed: true` なので `persistIfPossible` がファイルを上書きする | 直した（`assertBranchIndex` に統合。変異で確認）                   |
| R6-02 | MEDIUM | robustness            | 同じ不正入力で swap は内部の `TypeError` 文言、delete は成功を返す。`writeCandidates` の `main.length === 0` も黙って `te` 以降を消す                                                                                                                                                                                 | 直した（R6-01 と同じ検査を swap にも。空の候補は throw に）        |
| R6-03 | MEDIUM | architecture          | `isUsableFork` を `sanitizeJkf.ts` に置いたため、「このパスは `api/parse` からしか import できない」という #191 の lint が書けなくなった                                                                                                                                                                              | 直した（`model/jkf.ts` へ移動）                                    |
| R6-04 | MEDIUM | architecture, comment | R5-01 が1本化したはずの判定が `buildNextOptions` に3箇所目として残っている。`isUsableFork` の doc は「判定はここ1つ」と断言している                                                                                                                                                                                   | 直した                                                             |
| R6-05 | MEDIUM | comment               | `LineRef` 型に付いた doc が `resolveLine` の説明になっている（R5-03 と同型）                                                                                                                                                                                                                                          | 直した                                                             |
| R6-06 | MEDIUM | comment               | `BranchPointRef` の規約 `p.te < te` が3箇所に手書きで、`- 1` の理由がどこにも無い。`resolveLine` の `filter` は何も落とさない死んだ条件                                                                                                                                                                               | 直した（doc + 死んだ filter の除去）                               |
| R6-07 | MEDIUM | comment               | 公開2関数の `@throws` に `empty fork` が入っていない（3ラウンド連続で網羅を外している）                                                                                                                                                                                                                               | 直した                                                             |
| R6-08 | MEDIUM | comment               | 「入れ替えた候補どうしが同じオブジェクトを共有しない」テストが、どの実装でも落ちない                                                                                                                                                                                                                                  | 直した（複製の粒度そのものを固定。両方向の変異で落ちることを確認） |
| R6-09 | LOW    | comment               | 1行 doc が6箇所、自明・英語・旧語彙のまま                                                                                                                                                                                                                                                                             | 直した                                                             |

## 重複・矛盾した所見

- R6-04 は architecture と comment が独立に同じ3箇所目を指した。
- robustness が挙げた「分岐編集と保存の失敗が画面に出ない」は #186 / #198 で送り済みのため再掲扱い。
  ただし robustness の指摘どおり、**R4-05 / R5-01 / R5-02 / R6-01 で足した throw は
  すべてこの経路で「押しても無反応」になる**。この PR で足した検査が利用者に届くかは #186 / #198 次第。

## 検証で所見にならなかったもの

- **perf は所見なし。** 5つの操作すべてで HEAD は `main` と同じか少ない。
  最大の減は矢印キー1打（500手級で 9.68ms → 0ms）と分岐編集（分岐点以下7700ノードで 26.64ms → 0.15ms）。
  純増した操作は無い
- **robustness が `branchEdit` の引数を体系的に洗った。** `te` 10通り / `a`・`b`・`target` 8通り /
  `forkPointers` 11通り / `kifu` の形6通り / `cursor` 10通りを実際に走らせ、
  R6-01 の1形以外はすべて throw か正しい動作。`forks: [[]]` を作る経路が構造上存在しないことも確認
- **react が巻き戻しを1行ずつ検証した。** `git diff origin/main -- src/features/position-navigation/` は
  意図した3点だけを返し、`previewCursor` の小文字始まりの残存は0件。2本の `useEffect` は
  deps・門番・本体すべて `main` と同一
- **`isUsableFork` の新しい公開の使われ方**: `sanitizeJkf` 側は実質到達しない
  （tsshogi が `forks: [[]]` を `importJKFString` の時点で落とし、`[null]` 系は `KifuParseError` になる）。
  `privatizeHead` 側だけが実効

## 別の issue へ送る

| reviewer     | 内容                                                                                         | issue |
| ------------ | -------------------------------------------------------------------------------------------- | ----- |
| architecture | `json-kifu-format` の `dist` 内部パスを13ファイルが直接読んでいる                            | #222  |
| react        | 棋譜を続けてクリックすると、ツリーの選択と盤の棋譜が食い違う（世代ガードが失敗側にしか無い） | #223  |

## この PR の範囲について

architecture が33ファイルを #163 / #164 / #165 / #166 に突き合わせ、
**紐づかないのは `selectedBranchIndex` → `selectedOptionIndex` の改名1件**と報告した。
これは R1-20 由来で、#166 の「派生フィールド」ではなく「添字を `BranchIndex` と紛らわしい名前で
持っている」という別の話。害は無く、付けた doc に取り違え防止の実質的な価値があるので残す。
PR 本文でその旨を書く。

## 見ていない範囲

- Rust 側。この PR に `src-tauri/` の差分が無いため `npm run verify:rust` は未実行
- WebKit（実行環境）での実測。perf の数値はすべて V8（Node v26）
- 実機での操作確認。R6-01 の再現は `vite-node` で `branchEdit` を直接叩いた実測と、
  `provider.tsx` / `GamePersistenceGate.tsx` の読解を繋いだもの
- SCSS とレイアウト。`BranchList` の key 変更の見え方
- `features/kifu-comment-note` / エンジン周り

## lint / hook で強制できるもの

- `entities/kifu/lib/**` で `x < 0 || x >= y.length` 形の手書き範囲検査を禁止し、
  `assertBranchIndex` 経由に強制する。R6-01 は「検査を書いた」のに「`NaN` を考えていなかった」ので、
  検査の存在では防げない
- `json-kifu-format/dist/**` からの直接 import 禁止（#222）
- `entities/kifu/lib/**` での `fork[0]` / `forks?.[0]` への直接アクセス禁止（R6-04 の再発防止）
- 「書き込みはあるが読み出しが0件の state フィールド」の検出。`state.error` は6ラウンド誰も
  気づいておらず、人の注意では止まらない
- 型宣言の直上の JSDoc が動詞で始まることの検出（R5-03 / R6-05 と2ラウンド連続）
- 未使用 export の検出（`knip` 等）。通算9件、6ラウンド連続で提案が出ている
- 拾えないもの: `@throws` の網羅性（4ラウンド連続）、テストの assertion が実装差し替えで落ちるか

## 次ラウンドの対象

R6-01〜R6-09 を直したうえで、修正で新しい問題が入っていないかを見る。
R6-01 は `assertBranchIndex` という新しい境界を入れたので、robustness に
「この境界を通らずに `BranchIndex` が使われる経路が無いか」を当てさせる。
