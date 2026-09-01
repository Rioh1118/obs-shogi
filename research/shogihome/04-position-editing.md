# 04 局面編集

出典: `specs/position-editing-mode.md`（**仕様書が実在する**）、
`src/renderer/view/dialog/PositionEditingDialog.vue`、
`src/renderer/store/index.ts`（`showPositionEditingDialog` / `closePositionEditingDialog`）
版: `de27f0c1c352`

## 1. 仕様書の全文要旨

`specs/position-editing-mode.md` は 30 行ほどの短い文書で、次を決めている。

- メニューから開く**専用ダイアログ**。完了で**その局面で棋譜が初期化される**。
  キャンセルで開く前に戻る。
- 局面は**ポートレイトモード**（横帯の駒台）で表示する。
- **ダイアログを開いた時の局面で初期化するが、完了までメインの盤面とは同期しない。**
- 構成要素は6つ: 完了・キャンセル / 局面 / コピー・ペースト / プリセット / 手番変更 / 駒の枚数

### 駒の移動（仕様書の原文に沿った要約）

> 盤上の駒や持ち駒を**クリック（またはドラッグ）**で選択し、
> 移動先の盤上のマスまたは駒台を指定することで駒を移動する。

移動先に駒があった場合の規則が明示されている。

- **対局中に駒を取ったときと同様に、元あった駒を「移動する駒と同じ側」の駒台へ移す。**
- そのとき**成駒は成っていない駒として**駒台へ移す。
- 移動する駒と移動先の駒が**どちらの側の駒であるかは問わない**。
- **例外は玉だけ。** 玉は駒台に載せられないので、移動先が玉のときに限り**2つの位置を入れ替える**。
- 駒台への移動と盤上の移動は**1回の編集操作**として扱い、取り消しで一括して戻せる。

## 2. 駒箱もごみ箱も無い

**代わりに「駒の総枚数」を直接編集する。**

`PositionEditingDialog.vue`:

```html
<div class="title">{{ t.changePieceSet }}</div>
<div v-for="pieceType of pieceTypes">
  <span class="piece-name">{{ standardPieceName(pieceType) }}</span>
  <input
    class="number"
    type="number"
    min="0"
    max="18"
    :value="currentCounts[pieceType]"
    @change="onChangeCount(pieceType, $event)"
  />
</div>
<HorizontalSelector
  v-model:value="destination"
  :items="[
  { label: t.addToBlackHandPieceStand, value: 'blackHand' },
  { label: t.addToWhiteHandPieceStand, value: 'whiteHand' },
  { label: t.addToBoard,               value: 'board' } ]"
/>
<button class="bulk thin" @click="setStandardCounts">{{ t.setAllPiecesToStandardCounts }}</button>
<button class="bulk thin" @click="setAllZero">{{ t.setAllPiecesToZero }}</button>
```

- 駒種ごとに**数値入力**（0〜18）。増やした駒がどこへ行くかは
  **「先手の駒台 / 後手の駒台 / 盤上」の水平セレクタ**で決める。
- 一括操作は2つだけ: **標準の枚数に戻す** / **全部 0 にする**。

**つまり「40枚を使い切らない局面」は、駒箱に余らせるのではなく
"その駒種の総数を減らす" ことで表す。** 余り駒という概念自体が無い。

## 3. その他のダイアログ要素

```html
<button data-hotkey="Mod+z" :disabled="!canUndo" @click="undo">
  <!-- 元に戻す -->
  <button data-hotkey="Mod+Shift+z" :disabled="!canRedo" @click="redo">
    <!-- やり直し -->
    <button @click="isInitialPositionMenuVisible = true">
      初期局面（プリセット）
      <button @click="onChangeTurn">
        手番変更
        <button @click="onCopySFEN">
          コピー(SFEN) <button @click="onCopyBOD">コピー(BOD)</button>
        </button>
      </button>
    </button>
  </button>
</button>
```

- **Undo / Redo がある**（`Mod+Z` / `Mod+Shift+Z`）。
- プリセットは `InitialPositionMenu.vue` を共有（対局ダイアログと同じ部品）。
- SFEN と BOD の両方でコピー／ペーストできる。
- 盤の大きさは Small / Medium / Large の3段を**利用者が選ぶ**。

## 4. ドラッグ＆ドロップは設定で切れる

```html
:enable-drag-and-drop="appSettings.enableDragAndDrop"
```

`BoardView` に渡している。**アプリ設定（`src/common/settings/app.ts`）の
`enableDragAndDrop` で、D&D を使うかクリックだけにするかを利用者が選ぶ。**
`ghost-teleport-target` を渡しているので、ドラッグ中のゴースト駒を
別の DOM ノードへ portal している。

`:allow-edit="true"` / `:allow-move="false"` の2つで、
**「編集はできるが着手はできない」**を盤側に伝えている。
同じ `BoardView` が対局用と編集用を兼ねている。

## obs-shogi との対応・食い違い

**obs-shogi 側は2つの時点があるので列を分ける。**
2026-06 の計画は `.claude/plans/position-editor.plan.md` にあるが、
**そのディレクトリは `.gitignore` 済みで公開リポジトリの読み手には見えない**（`.gitignore:30`）。
ここに転記した内容が唯一の参照可能な記録になる。

| 論点           | ShogiHome                                      | obs-shogi の計画（2026-06・追跡外）              | obs-shogi の現在の検討（2026-09）                      |
| -------------- | ---------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| 出口           | **既存の棋譜の初期局面を書き換える**           | **常に新しい棋譜ファイル。**既存は mutate しない | 新規ファイル / 課題局面へ登録 / この局面で対局 の3出口 |
| 駒の供給       | **駒箱なし。**総枚数を数値で増減               | **駒箱（無限供給）**                             | **駒箱 ＋ 一時置き場（ごみ箱）**                       |
| 入力           | クリック **または** ドラッグ（設定で切替）     | ドラッグ前提                                     | **D&amp;D あり。**アニメーションにこだわる             |
| 移動先に駒     | 駒台へ移す（成駒は不成に戻す）。玉だけ入れ替え | 未定                                             | 未定                                                   |
| 成／先後の切替 | 仕様書に記述なし                               | 未定                                             | **右クリックで4状態を巡回**                            |
| Undo           | あり                                           | 計画に無い                                       | 未定                                                   |
| 盤の大きさ     | 利用者が3段から選ぶ                            | 未定                                             | 未定                                                   |
| 駒台の形       | PORTRAIT（横帯）                               | 未定                                             | 未定                                                   |

**出口の違いが一番大きい。** ShogiHome は「初期局面を変える＝この棋譜を作り直す」で、
obs-shogi の計画は「初期局面を変える＝別の対局＝別ファイル」というドメイン不変条件を
明示的に置いている。どちらが正しいかはドメインの判断で、実装の都合ではない。

## 所感

- **「余った駒をどこへ置くか」に、3つの別々の答えがある。**
  ShogiHome は「総枚数の数値入力」で、盤の外に駒を置く場所そのものを作っていない。
  obs-shogi の 2026-06 の計画は「駒箱（無限供給）」。
  2026-09 の検討はその中間で、「駒箱 ＋ 一時置き場」を2つに分ける。これは
  **「一時的に外す」と「その駒を局面から消す」を区別できる**利点がある一方、
  画面資源を1ブロック余計に食う。
- 「移動先に駒があったら駒台へ移す（成駒は不成に戻す、玉だけ入れ替え）」は
  **仕様として書かないと必ず抜ける類の規則**。obs-shogi 側の
  §10 の状態表で「未定義」にしていたセルが、まさにここ。
- **`specs/` に仕様書が1本ある**ことの効き目が大きい。30 行で、
  読めば実装できるし、後から読んで判断の根拠が分かる。
  obs-shogi の `docs/state-transitions/` と同じ役割だが、
  **状態遷移表より前の「何を作るか」の層**を持っている点が違う。
