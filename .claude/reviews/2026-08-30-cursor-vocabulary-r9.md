# レビュー cursor-vocabulary ラウンド9

- 日付: 2026-08-30
- 範囲: `git diff main...HEAD`
- 対象コミット: `dc7b566`
- 走らせた reviewer: comment / architecture / robustness

## robustness の等価性確認

r8 で振る舞いを変えた3点。**すべて等価。**

| 何を                                 | どう確かめたか                          | 結果                           |
| ------------------------------------ | --------------------------------------- | ------------------------------ |
| E16 の検証（`null` → `ROOT_CURSOR`） | 壊れた `initial` **16通り**で突き合わせ | throw の有無・文言とも不一致 0 |
| `normalizeBefore` への置換           | 式が文字どおり同一                      | 差の出る余地なし               |
| `cursor: ROOT_CURSOR` の同一参照化   | `state.cursor` を読む全箇所を確認       | `===` 比較0件・dep の影響なし  |

さらに `GameProvider` を happy-dom で実際に mount し、壊れた `initial` で
`state.jkf === null` / `state.error` に文言が入ることを確認している。

## 所見

### HIGH

| #   | 所見                                                                         | 結果   |
| --- | ---------------------------------------------------------------------------- | ------ |
| C1  | `truncateFrom` の doc が勧める代替（`normalizeForkPointers`）は境界が1ずれる | 直した |
| C2  | `descendTo(null)` のテストのコメントが、直した doc と正反対                  | 直した |
| C3  | 不変条件1 の「`cursor.forkPointers` に載せたまま運ぶ」が実装に反する         | 直した |

**C1 が最も危ない。** doc が挙げた3つの使う側のうち2つで、言われたとおり
差し替えると壊れる（`p.te < te` と `p.te <= te`）。しかも同じファイルの
`normalizeBefore` は正しい対応を書いており、**2つの doc が反対のことを言っていた**。

**C3 は #310 の再現を妨げる形だった。** 壊れた `forkIndex` は
`state.cursor.forkPointers` には絶対に入らない（作るのは `cursorFromPlayer` だけで、
値は `forkAndForward` が成功したときの実測）。運び手は `branchPlan`。

### MEDIUM

| #   | reviewer     | 所見                                                                    | 結果                      |
| --- | ------------ | ----------------------------------------------------------------------- | ------------------------- |
| R1  | robustness   | **E16 の番人が「返り値を捨てる1行」になり、機械で支えるものが消えた**   | 直した（+テスト）         |
| R2  | robustness   | 新しいラチェットだけが相対パスで読み、`walk.ts` の存在理由を破っている  | 直した                    |
| A1  | architecture | 検査の範囲が `model/` 止まりで、`lib/` の `cursorFromPlayer` が無検査   | 直した（範囲を拡張）      |
| A2  | architecture | `cursorFromLite` が barrel に無く、この PR が deep import を1つ増やした | 直した                    |
| C4  | comment      | doc が指示する突き合わせを書くと、同じ PR のラチェットが落ちる          | 直した（`reachedCursor`） |
| C5  | comment      | `game.md` の E16 が2通りに定義されている                                | 直した                    |
| C6  | comment      | 「要求の鍵を入れない」と書いた直後に fixture 2つがそれを破っている      | 直した                    |

**R1 は自分がラウンド8で作った退行。** それまでは返り値が `dispatch` の payload に
流れていたので**消すと tsc が落ちた**。r8 でそのデータ依存を外し、代わりに
置いたのはコメントだけ。reviewer がこの1行を無効化して測った結果:

```
MUTANT → jkf が入った? true / error: null / view.player: null / loadedAbsPath: /x.kif
```

壊れた棋譜を選ぶと**盤も棋譜ペインも空、文言なし、`error` すら null**。
`provider.tsx` にテストが1本も無かったので新設した（`game.md` の
「`provider.tsx` にテストが1本も無い」の1マスも埋まる）。番人を消すと落ちる。

**A1 で範囲を `lib/` に広げたら4つ落ちた。** `cursorFromPlayer` は
**間接的にも1本も通っていなかった**。契約は「3つの値を同じ player の同じ `tesuu`
から取る」だけなので、`getForkPointers()` に書き換えても全部緑で通る状態だった。

**C4 は自分が入れたラチェットと自分が書いた doc の食い違い。**
doc は「一致を要求する側は `player.getTesuuPointer(...)` を突き合わせろ」と言い、
ラチェットは `entities/kifu/lib` の外でその呼び出しを禁じる。逃げ道が無かったので
`reachedCursor(player, path)` を出して3つの doc をそこへ向けた。

## このラウンドで足した機械の検査・テスト

- `entities/game/model/__tests__/provider.test.tsx`（E16 の番人。消すと落ちる）
- `entities/kifu/lib/__tests__/playerCursor.test.ts`（`cursorFromPlayer` / `reachedCursor`）
- `entities/kifu/lib/__tests__/createInitialJKFData.test.ts`
- `exportsTested` の範囲を `model/` + `lib/` の28モジュールへ拡張

## 見ていない範囲

- `src-tauri/`（差分に1行も無い）
- SCSS / レイアウト / キーボード操作 / フォーカス管理
- 実アプリを起動しての動作確認（`GameProvider` は happy-dom で mount した）
- perf（r1 / r6 で実測済み）
- `initial.data.board` の**中身**が壊れた場合（`{color:9, kind:"ZZZ"}` の9×9）は
  `new Shogi` を素通りする。`main` と同じで、パーサ経由でその形が出る経路を
  確かめていないので所見にしていない

## エピック #279 の完了判定（architecture）

「依存の向きと責務の置き場に関しては、上の2件（A1 / A2）を除いて
未決・番号なしのものは見つからなかった」。両方このラウンドで直した。

- 上向き import 0件・循環0件（層ごとに機械的に確認）
- `tesuuPointer` の手書き分解は `src/` に0件。`JSON.stringify` で組むのは `cursor.ts` の1本
- `p.te` を手で回すのは実装本体の3つだけ。UI 側は全て `forkIndexAt` /
  `truncateFrom` / `descendTo` を通る
- コード中の未決は全て番号付き（#295 / #297 / #302 / #306 / #310 / #216 / #183）

## lint / hook で強制できるもの

- （実装した）`exportsTested` の範囲拡張、`playerAccess` の絶対パス化
- 束縛なしの空 `catch {}` を UI 層で禁止（#308、未実装）
- `ROOT_CURSOR` を `Object.freeze` すれば、将来の `push` が即座に落ちる
  （reviewer が「いま壊す呼び出し側は居ないので所見にしない」と付記）

## 次ラウンドの対象

`reachedCursor` の新設、`provider.test.tsx`、`exportsTested` の拡張、
barrel への `cursorFromLite` 追加を見る。所見が0件になるかを確かめる。
