# レビュー cursor-vocabulary ラウンド15

- 日付: 2026-08-30
- 範囲: `git diff main...HEAD`
- 対象コミット: `3c8710a`
- 走らせた reviewer: comment / architecture / robustness

**r14 で足した brand に穴が2つあった。どちらも自分が作った退行。**

## BLOCK / HIGH

**B1 [comment / architecture] スプレッドが brand を素通りする**

r14 は「型そのものに brand を付けたので直書きは塞がった」と書いたが、
**止まるのは素のオブジェクトリテラルだけ**だった。

```ts
const c: KifuCursor = { ...cursor, tesuuPointer: cursorKey(path) };
```

スプレッドは brand プロパティを型ごと運ぶので `KifuCursor` のまま通る。
自分でも最小再現で確認した（A=リテラルのみ TS2741、B=スプレッド・C=二重キャストは0エラー）。
`cursorKey` は非 owner の4ファイルが既に import しているので、
そこで `KifuCursor` が要る人が書く最短経路がこれになる。

→ **要求の鍵に別の型 `CursorKey` を与えた**（`58d130a`）。書式は同じで型が違うので、
観測の欄に入れた時点で TS2322。文字列としての利用（キャッシュ鍵）はそのまま通る。
2つの鍵が出会ってよい唯一の場所を `pointsAtSame` にし、`reachedCursor` をそこへ通した。

型で止まらない綴り3つには規則を足した（`101bc2b`）:
`as KifuCursor` / `as PlannedCursor` / スプレッドで `tesuuPointer:` に書く形。

**H2 [robustness] 二重キャストが、欄の検査を丸ごと消していた**

`e02e891` で brand を付けるために `as unknown as KifuCursor` を**作る側に直接**書いた。
その結果、`ROOT_CURSOR` と `makeKifuCursor` の欄を tsc が突き合わせなくなっていた。

| 変異                                                    | r14 の tsc   | いま       |
| ------------------------------------------------------- | ------------ | ---------- |
| `tesuu` に文字列・`tesuuPointer` に数値（素の取り違え） | **0 エラー** | **TS2322** |
| `ROOT_CURSOR` から `forkPointers` を落とす              | **0 エラー** | **TS2345** |

**防具を足すために土台の検査を外していた。** 型注釈付きだった r14 以前のほうが、
この一点だけは強かった。

→ 欄を `KifuCursorFields` に切り出し、印を付ける単段のキャストを
`brandCursor` 1箇所に閉じた（`5b4b9ff`）。

## MEDIUM

| #   | reviewer     | 所見                                                                              | 結果                |
| --- | ------------ | --------------------------------------------------------------------------------- | ------------------- |
| R2  | robustness   | 行頭 `*` の継続行に綴りを載せると5本の規則を全部素通りできる                      | 直した（`9d2d6f6`） |
| R3  | robustness   | `docsSourcePaths` を広げたぶん、相対リンクや外部パスが赤くなる                    | 直した（`9d2d6f6`） |
| A1  | architecture | `codeOf` が2実装あり、`playerAccess` 側は危ない形のまま                           | 直した（`101bc2b`） |
| A2  | architecture | 4つの brand 型で守り方が揃っていない（`as PlannedCursor` が通る）                 | 直した（`101bc2b`） |
| C1  | comment      | `CONTRIBUTING.md` の `docsSourcePaths` 行が、同ラウンドの本体変更に追随していない | 直した（`82bb7fb`） |
| C2  | comment      | `playerAccess` 行が、存在しない「理由」の欄を書けと指示している                   | 直した（`82bb7fb`） |
| C3  | comment      | `navigate` の前提が「この5行」と数え、同じ式を持つ `edit` に無い                  | 直した（`284b28a`） |
| C4  | comment      | `TesuuPointer` の doc が「`cursor.test.ts` の2本」と数えて既に1本落としている     | 直した（`284b28a`） |
| C5  | comment      | `includeTests: false` の理由が書き直しで消えた                                    | 直した（`101bc2b`） |
| C6  | comment      | `game.md` の注が ※1→※6→※5→※2 の順に並んでいる                                     | 直した（`5b4b9ff`） |
| C7  | comment      | r14 報告書が、同ラウンドで消した識別子 `OWNERS` を現在形で参照                    | 直した（`5b4b9ff`） |

**R2 は「静かに落ちる側」だった。** `codeOf` は行頭 `*` を無条件に落としていたので、
名前空間 import と整形を組み合わせると widget から `makeKifuCursor` を直に呼んでも
5本の規則が全部通る（robustness が実測、188 passed）。
継続行の `*` を落とすのは**ブロックの内側にいるときだけ**にした。
ブロックの開始は行頭の `/*` だけで見るので、文字列リテラル中の `/*` では開かない。

**R3 は自分が r14 で入れた過剰。** 接頭辞なしを追うのに候補を絞っていなかったので、
`` `./branch-index.md` `` と丁寧に書くと赤、`` `branch-index.md` `` と雑に書くと緑になっていた。
`resolve` の振る舞いを固定する単体テストが**1本も無かった**ので5本足した
（`ROOTS` を戻す変異・`tracked` を外す変異の両方で落ちる）。

**C3 は `observedPointerOf` に畳んだ。** `navigate` と `edit` が同じ式を持ち、
前提のコメントは `navigate` にだけ付いていた。式を1つにして doc をその頭に置いた。

## 止められていないと分かっている形

`{ ...cursor, tesuu: cursor.tesuu + 1 }` のように `tesuuPointer` を書かずに
スプレッドで手数だけ動かすと、手数と識別子が食い違ったまま通る。
綴りで見分けるには「カーソルのスプレッド」を名前で拾うしかなく、
`previewCursor`（`CursorPath` なので無害）が現に引っ掛かる。
**名前に頼る規則は足さず**、`cursorConstruction.test.ts` の doc に書いた。

## reviewer の指摘と食い違った点

comment は「山括弧キャストが tsc も lint も通る」として `RULES` への追加を求めたが、
`tsconfig.app.json` の `erasableSyntaxOnly: true` により **TS1294 で落ちる**（自分で確認）。
robustness は同じものを正しく「落ちる」と測っていた。r14 に続いて同じ食い違い。

architecture は `/tesuuPointer\s*:/` を足せば「S1 / S2 が赤になる」と書いたが、
**S2 は `tesuuPointer:` を含まない**ので赤にならない。実測で確認し、上に別項として残した。

## 作業ツリーの汚染（記録）

3人の reviewer が同じワークツリーで変異試験を回しており、そのうち1つの
`git checkout --` が**こちらの未コミットの編集を巻き戻した**（`cursor.ts` の
`CursorKey` 追加と `CONTRIBUTING.md` の2行）。`playerCursor.ts` 側だけが残って
`pointsAtSame` が見つからず tsc が落ちて気づいた。**再適用済み。**
robustness も同じ衝突を検出し、以降の計測を `git archive HEAD` の隔離コピーに切り替えている。

## 見ていない範囲

- `src-tauri/`（差分に1行も無い）
- SCSS / レイアウト / キーボード操作 / 実アプリの起動
- `main` との差分試験（r13 の 20000ケース×7関数以降、`src/` の**実行時**に効く変更は
  無い。r14/r15 で足したのは型・コメント・検査のみで、実行時には消える。
  **回していないのは事実**）

## lint / hook で強制できるもの

- （実装した）`CursorKey` による型の分離、`brandCursor` への単段キャスト、
  綴り3種の規則、`codeOf` のブロック追跡、`docsSourcePaths` の絞り込み
- `as unknown as` そのものを `no-restricted-syntax` で禁じる（robustness の提案）。
  brand を付ける関数の中の単段キャストだけを許せば、綴りのラチェットを増やさずに済む。
  **two-strikes を満たしている**（`KifuCursor` で1回、同じ形が `PlannedCursor` にもある）
- `CONTRIBUTING.md` の表と実在する検査の突き合わせ。r14 で「1回目」と書いたが、
  **今回 C1 / C2 で2回目**。two-strikes に達した

## 次ラウンドの対象

`CursorKey` の分離、`brandCursor`、`observedPointerOf`、`codeOf` のブロック追跡、
`docsSourcePaths` の絞り込みを見る。実装に手を入れているので robustness を必ず走らせる。
