---
name: tidy-code
description: 既存コードを1ディレクトリか1スライスずつ点検し、動作を変えずに読みやすくする。整理、リファクタ、コメントの書き直しを既存コードへ行うときに使う。新しいコードと差分には /readable-code を使う。
argument-hint: "[範囲: 1ディレクトリ / 1スライス]"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Skill
---

基準は `/readable-code`。ここには**一度に壊さず進める手順**だけを置く。
**全体を一度に書き換えない。** 差分が大きいほどレビューが効かず、動作の変化が紛れる。

`/implement` の手順の中で使う。ブランチ、検証、PR はそちらに従う。
判定は `/decide` で決める。**人の確認を待たず、手順3の「送る」「残す」を含めて最後まで進める。**

## 手順1: 範囲を切る

- 1回の範囲は**1ディレクトリか1スライス**。テストのファイルを除いて2000行を超えるなら更に割る
- 範囲は依存の下から選ぶ。TS は `shared` → `entities` → `features`、Rust は `src-tauri/tests/layering.rs` の `LAYERS` の下の段から。上を先に直すと下の改名で触り直す
- `shared/` と `entities/` の公開の名前を変えるなら、呼び手の数を先に数え、範囲に含める
- 次の範囲には手を付けない。見つけたものは手順3の「送る」

完了: 範囲のパスと行数を書いた。

## 手順2: 棚卸しする

機械で作る。

```bash
D=.claude/plans/tidy-<日付>-<範囲>
mkdir -p "$D"
node .claude/skills/cross-cutting-audit/scripts/inventory.mjs "$D/inventory" <範囲>
COMMENT_REPORT="$D/comments.json" ./node_modules/.bin/vp test run src/__tests__/commentReadability.test.ts
SHAPE_REPORT="$D/shapes.json" ./node_modules/.bin/vp test run src/__tests__/componentShape.test.ts
node .claude/skills/naming/scripts/word-usage.mjs verbs <範囲>
```

範囲を絞ると棚卸しの一部は0件になり、`inventory.mjs` は終了コード1で返る。**ここでは失敗ではない**ので、`&&` で繋がない。

棚卸しに映らないものがある。

- 範囲の外との衝突: `word-usage.mjs word <語>` で全体から引く
- `functions.tsv` は `pub` の付いた宣言の1行目だけ。trait のメソッド、非公開、複数行の署名は本体を開いて読む

1. 範囲の公開の宣言を全部、`/readable-code` の「確かめるとき」の手順2〜4で読む。差分の代わりに範囲を見る
2. コメントは全部読み、`.claude/skills/readable-code/references/comments.md` の順で判定する
3. 同じ名前と似た動詞を `functions.tsv` で寄せ、本体を読み比べる
4. `comments.json` と `shapes.json` から範囲の行を拾う（`grep <範囲> "$D/comments.json"`）。**ここでは機械が見ている形も所見に数える。** 片付けるのが整理の仕事
5. `.tsx` は `/readable-code` の「部品の構造」の問いで全部読む
6. 公開の宣言の呼び手を `git grep -w` で数える。**本番の呼び手が0でテストだけが使うものは knip に映らない**。knip は Rust も見ない

完了: 見た宣言の数と所見の数を書いた。

## 手順3: 振り分ける

| 行き先 | 条件                                       | やること                                           |
| ------ | ------------------------------------------ | -------------------------------------------------- |
| 機械   | 字面で判定でき、範囲か backlog で2件目以上 | 検査にする。`.claude/knowledge/mechanization-backlog.md` を先に読む |
| 直す   | 範囲の中で閉じ、動作を変えない             | 手順4                                              |
| 送る   | 動作が変わる、範囲の外へ広がる、設計の判断 | テストか実行で再現してから `/implement` 手順7 へ。再現できないものは「未再現」と書いて PR の確認事項へ |
| 残す   | 測ると理由がある                           | 理由を PR の判断ログに書く。`.claude/plans/` は git に載らない |

**コードと食い違うコメントを見つけたら、関数を全行読み、どちらが正しいかをテストと呼び手で確かめる。**
コードが誤りなら動作の修正なので「送る」。

## 手順4: 種類ごとに1コミットで直す

**1コミットに1種類。混ぜない。** 種類が同じなら、コミットは範囲の中でまとめてよい。
**下の順に進める。** 前の種類を終えると、後の種類の所見が減る。

| 順 | 種類       | 動作を変えていない確認                                                                  |
| -- | ---------- | --------------------------------------------------------------------------------------- |
| 1  | コメント   | `node .claude/skills/tidy-code/scripts/code-unchanged.mjs <基点>` が差なしと言う        |
| 2  | 改名       | 名前は `/naming` で決める。テストは綴りの置換だけ。`npm run verify`。**線の名前**（Tauri コマンド、serde の欄、イベント名）は変えない      |
| 3  | 移動、分割 | 本体を変えずに移す。テストの本文を変えない。`git diff --color-moved` で動いただけと見る |
| 4  | 共通化     | 呼び手ごとの振る舞いを固定するテストを確かめ、変異を当てて落ちることを見る              |
| 5  | 型の補い   | `Debug` の derive、`Error` の実装など、振る舞いを足さないもの。`npm run verify:rust`    |
| 6  | 書き方     | `docs/rules/ts.md` の R-TSW へ揃える。型だけなら `scripts/emit-unchanged.mjs <基点>` が差なしと言う。それ以外は差分を読み、理由を PR の表に書く |
| 7  | 構造       | 動作が変わりうる。テストで振る舞いを固定し、変異を当て、画面に出るものは `docs/spec/` と実アプリで確かめる（`/readable-code` の `references/structure.md`） |

- **テストの期待値を変えたくなったら止める。** 動作が変わっている
- 検査の基準（`BASELINE`）が下がったら、同じコミットで下げる
- 種類の7は整理だけの PR と分ける。大きくなる範囲は別の段にする
- 強調を外した跡に `。 ` の空白を残さない

完了: 種類ごとに検証が通っている。Rust を触ったなら `npm run verify:rust` も通っている。

## 手順5: 報告する

書くのは5つ。

- 見た数（宣言、コメント）と所見の数、行き先ごとの内訳
- 下がった検査の基準
- 送ったもの
- この skill や `/readable-code` で判定に迷った箇所。**迷ったら基準の側を直す**
- `/decide` で決めたもののうち、利用者が見る価値のあるもの。`/decide` の手順で PR の確認事項へ載せる

## やらないこと

- 触った範囲の外の改名
- 見た目の好みによる書き換え。`/readable-code` の問いに当たらないものは直さない
- 動作の修正を整理のコミットに混ぜる
- 動いている抽象を、形が似ているという理由でまとめる（R-DUP-1）
