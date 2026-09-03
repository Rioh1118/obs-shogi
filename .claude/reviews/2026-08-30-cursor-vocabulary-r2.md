# レビュー cursor-vocabulary ラウンド2

- 日付: 2026-08-30
- 範囲: `git diff main...HEAD`（37ファイル）
- 対象コミット: `1d2877e`
- 走らせた reviewer: architecture / comment / robustness / react
  （perf はラウンド1で「所見なし」＋実測済み。置き場の移動しかしていないので再走させていない）

**robustness はセッション上限で途中終了した。** 出力は不完全で、所見は1件も
返っていない。ラウンド3で走らせ直す。

## 所見

### HIGH

**C1 [comment] `PLAN_WALK_LIMIT` の根拠が実測と両方向で食い違う**

ラウンド1で「`goto` が進める最長と同じ」「`<` にすると `goto` は届く 10000 手の線で
ここだけが投げる」と書いたが、**どちらも偽**。`goto` の番人は上限ではなく等値判定:

```js
var c = 1e4; for (; tesuu !== e && forward() && c-- > 0;); if (0 === c) throw
```

自分で実測: `goto(9999)=9999` / `goto(10000)=throw` / `goto(10001)=10001`。
ぴったりの手数だけが投げ、それより長い線は素通りする。

**同じ定数の理由を2回続けて間違えた。** ADR-0003 r1〜r4 と r1 H1 と同じ故障。
→ 直した。`goto` の非単調さをテストで固定。

**C2 [comment] `game.md` がまた実在しないパスを指している**

ラウンド1の H2 で「削除済みの `entities/game/lib/cursor.ts` を指している」を直したが、
その後の置き場の移動で**同じ2行が `cursorRuntime.ts` という別の死んだパスに変わっていた**。
→ 直した。

**C3 [comment] `game.md` の E3 / E6 を ✓ にしたのは誇張**

`advanceWithPlan.test.ts` が固定しているのは1手ぶんの純関数だけで、
`navigate` を通した `branchPlan` の遷移は未検証。`provider.tsx` にテストは1本も無い。
CLAUDE.md の「テストの現状を誇張しないこと」に反していた。
→ `△` と注（※5）に直した。

### MEDIUM

| #   | reviewer     | 所見                                                                                             | 結果                           |
| --- | ------------ | ------------------------------------------------------------------------------------------------ | ------------------------------ |
| A1  | architecture | `lib/branchPlan.ts` は `entities/kifu/lib` 15本で唯一 JKF を触らない。lib/model の切れ目が破れる | 直した（model へ集約）         |
| A2  | architecture | `PositionNavigationModal` に `selectAt` 相当の4つ目の手書きが残っている                          | 直した                         |
| A3  | architecture | `truncatePlanFrom` / `sameForkPointers` 相当が3箇所に手書きで残っている                          | 直した                         |
| A4  | architecture | `advanceMainLine` は本譜を進めない。`MAIN_LINE` / `isMainLine` と語が衝突                        | 直した（`advanceCurrentLine`） |
| A5  | architecture | `CursorSource` / `cursorFromSource` は実装が1つしかない抽象になった                              | 直した（畳んだ）               |
| A6  | architecture | 局面ナビの種が `state.branchPlan` を読まず、先の計画が落ちる                                     | **issue #297** へ              |
| C4  | comment      | `comment.test.ts` の fixture の説明が座標系を取り違えている                                      | 直した                         |
| C5  | comment      | `buildStreamRows` の `@throws` が呼び出し側の義務を言い切るが、唯一の呼び出し側は守っていない    | 直した（`TODO(#295)`）         |
| C6  | comment      | `upsertForkPointer` が `selectAt` と二重の公開名。doc の理由も現物に対応しない                   | 直した                         |
| R1  | react        | コメントの自動保存が完了すると編集中の `draft` が巻き戻る（保存**成功**時）                      | **#227 へ**（差分外）          |

## 重複・矛盾した所見

**C1 は所見そのものは正しいが、提案された直し方は誤り。**

comment-reviewer は「`steps < PLAN_WALK_LIMIT` にして doc と一致させよ」と書いた。
これは**採らなかった**。葉に着いたことを確かめるには前進 N 回に加えて空振り1回が
要るので、`<` にすると確かめられる最長が 9999 手に落ちる。反復回数は据え置き、
doc の側を実測に合わせた。所見（doc が嘘）は正しく、修正案（境界を動かせ）は誤り。

**A4 と r1 M12 は同じ関数についての連続した所見。**
r1 で「計画が空振りするので `advanceMainLine` を置け」と言われて置いたら、
r2 で「その名前は本譜を進めないので嘘」と言われた。両方正しい。

## 見ていない範囲

- **robustness の観点全体**（途中終了）。特に `selectAt` に寄せたことによる
  分岐の削除・入れ替えの退行は未確認 → ラウンド3で最優先
- `src-tauri/`（差分に1行も無い）
- SCSS / レイアウト / キーボード操作 / フォーカス管理
- 実アプリを起動しての動作確認
- perf（ラウンド1で実測済み。置き場の移動しかしていない）

## lint / hook で強制できるもの

- **doc 中のファイルパスの存在検査**。`docs/**/*.md` のバッククォート内で `src/` から
  始まる文字列を拾い、実在しなければ落とす。**r1 で同じ提案をして実装せず、C2 で
  同じ故障が再発した。two-strikes rule を満たしている** → 別 issue に送る候補
- `ForkPointer[]` への裸の `.filter((p) => p.te < X)` / `.find((p) => p.te === X)` を
  `model/cursor.ts` の外で禁じる。A3 と r1 M16 で**同じ失敗が2回目**

## 次ラウンドの対象

- robustness を走らせ直す（今回の途中終了ぶん）
- architecture / comment / react を、今回の修正（`model/cursor.ts` への集約、
  `makeKifuCursor` への畳み込み、`advanceCurrentLine` への改名）に対して再走
