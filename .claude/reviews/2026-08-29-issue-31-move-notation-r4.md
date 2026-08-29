# レビュー issue-31-move-notation ラウンド4

- 日付: 2026-08-29
- 範囲: `fix/31-relative-kanji` の `main...HEAD`（レビュー時点は `5880fe8`、59ファイル）
- 走らせた reviewer: `architecture` / `comment` / `robustness` / `react` / `perf` / `ui`
  （ラウンド1〜3の3観点から拡大。差分が features / widgets / entities / shared と
  設定ファイルにまたがったため。`ui` は3ラウンド連続で申し送りだった「実画面未確認」の解消）
- 前ラウンド: `-r1.md` / `-r2.md`

ラウンド3までで #31 と、レビューで見つかった既存バグ6件をすべて同じブランチで直した。
ラウンド4は**その結果**に対するレビュー。

## 所見

### [BLOCK] 追加した lint ルールがレイヤ規則を潰していた — architecture / comment（独立に2件）

`no-restricted-imports` は override が後勝ちで**丸ごと**差し替わる。スライス単位の
override（自スライス barrel の禁止）に上位レイヤの group を並べ直していなかったため、
`src/{entities,features,widgets}` 配下（303中256ファイル）で上向き import が素通りしていた。

実測:

```
features/settings/ui/SettingsPanel.tsx  ← @/widgets/** を import → 検出されず
shared/lib/turn.ts                      ← @/widgets/** を import → error
```

CLAUDE.md の「lint が強制する」が成立しなくなっていた。違反が0件なので**壊れて見えない**。

**対応済み**: 上位レイヤの group を `upperLayers()` に切り出して両 override から使う。
合成後の設定を検査する `vite.config.test.ts`（8件）を追加し、設定ファイルも型検査対象にした。

### [BLOCK] 棋譜の保存が失敗しても画面に何も出ない — robustness

`GameState.error` を描画する箇所が `src/` に0件。盤で駒を動かす → 画面には反映される →
保存が失敗 → `set_error` → 誰も読まない。利用者は保存されたと信じて作業を続け、次に開くと
手が消えている。読み込み側には `KifuReadErrorDialog` があるのに書き込み側は完全に無音。

**対応せず**: これは既存 issue #157「解析やファイル操作の失敗が利用者に届かない」そのもの。
本ブランチは `GamePersistenceGate.tsx` の import 2行しか触っていない。#157 に委ねる。

### [HIGH] 正規化の失敗を検知しているのに握りつぶしている — robustness

`normalizeNotation` の catch は「この棋譜は N 手目から先へ進めない」という、アプリ内で唯一
検知できる情報を捨てている。その棋譜は無言で開き、N手目をクリックすると `goto` が throw し、
上の BLOCK により何も表示されない。利用者には「固まった」と映る。

**部分対応**: コメントが「開いて読むことはできる」と実態より楽観的だったので、
「その手より先へは進めない」「通知は #157 の担当」に直した。戻り値を
`{ jkf, unreplayableFrom }` にして利用者に通知する部分は #157 の範囲。

### [MEDIUM] 「変化N」の導出が3箇所に散っていた — react / ui / robustness（独立に3件）

ラウンド3で `BranchCard` を `forkIndex` 由来に直したが、同じモーダルのヘッダ
`StatusTips.tsx:12` は表示順の添字のまま、棋譜ストリーム側 `KifuForkMenu.tsx:77` は
`変化${i + 1}` の直書きのままだった。直した側のコメントが「同じ番号で呼べないと別の分岐を指す」
と書いているのに、その相手が追随していない状態。

**対応済み**: `branchLabel(forkIndex?)` を `entities/kifu/model/branch.ts` に置き、3箇所とも通す。

### [MEDIUM] `BranchOption` が同じ事実を2つ持っていた — react / architecture（独立に2件）

`isMainLine` と `forkIndex` は等価（型のコメント自身がそう書いていた）で、隣接する行が
別々の方を読んでいた。`{ isMainLine: false, forkIndex: undefined }` が型として作れ、
その値は「本譜と表示しながら本譜を1手進める」挙動になる。

**対応済み**: 判別可能ユニオンにした。`PositionNavigationModal` の到達不能な分岐も消えた。

### [MEDIUM] `memo(BranchCard)` は1件も再描画を止めていなかった — react

`ref={setCardRef(idx)}` と `onClick={() => ...}` が毎レンダ新しい参照になるため、
浅い比較は必ず外れる。実測で親1回の再レンダにつきカード本体が3枚とも走る。
「最適化してある」という見た目だけが残っていた。

**対応済み**: `memo` を外した（分岐は多くて数枚。`readableMove` は 40ns/回で、
1000個並べても 0.04ms という perf の実測がある）。

### [MEDIUM] `turnLabel` が3種類の別物を指していた — comment

`shared/lib/turn.ts` の `turnLabel(color)` は `"☗先手"` を返すが、同名のローカル変数が
`"先手番"`（記号なし）や `"先手"` を指していた。import した瞬間に衝突するか、
無自覚に画面表記が変わる。

**対応済み**: ローカル側を `turnText` に改名（`widgets/app-layout-header` の前例に揃えた）。

### [MEDIUM] 契約が関数本文に埋まり、片方の経路にしか書かれていなかった — comment

「渡した move は棋譜が所有し、正規化が書き換える」は分岐3の中のコメントだった。
JSDoc だけ読む呼び出し側には見えず、末端の `inputMove` 経路にも同じ契約が効くのに
書かれていなかった。

**対応済み**: JSDoc に移し、両経路に効くことを明記。

### [MEDIUM] `normalizeForDisplay` は表示専用ではなかった — comment

戻り値はそのまま `saveKifuToFile` でディスクに書き戻される。正規化が足した
`same` / `relative` は保存物にも出る。名前が "ForDisplay" だと「安全に外せる」と読める。

**対応済み**: `normalizeNotation` に改名し、doc に保存にも使われる旨を明記。

### [MEDIUM] 削除したファイルに対応する型が取り残されていた — architecture

`createRelPathCache.ts` / `makeItemData.ts` を消したのに `RelPathCache` /
`HitListItemData` / `VirtualListRef` が `virtual/types.ts` に残り、`@/entities/search` への
import も残っていた。検出手段（knip）を用意した PR が、その手段で拾えるものを残した形。

**対応済み**: 3つの型と不要な import を削除。

### [MEDIUM] `buildNextOptions` の置き場 — architecture

盤面も駒も見ておらず `currentStream` と `forks` しか触っていないのに `entities/position` に
あり、`entities/position` が `entities/kifu` の内部規約（`forks` の添字＝`forkIndex`）を
知る羽目になっていた。テストのファイル名と SUT のモジュール名も一致していなかった。

**対応済み**: `entities/kifu/lib/buildNextOptions.ts` へ移設。テストも同時に移動。
これで `entities/position` → `entities/kifu` の依存が0本になった。

### [MEDIUM] `PreviewPane` の盤の枠が4画面中3つで消えている — ui

`--board-pad` / `--board-surface` / `--board-border` が `.position-navigation-modal` ブロックの
下で定義されており、カスタムプロパティは継承なので、そのブロックを祖先に持たない
局面検索 / 研究局面の詳細 / SFEN 作成では未定義になる。同じコンポーネントが画面によって
padding 0・背景透明・border なしで出る。

**対応せず**: SCSS の変更が要る。別窓で進行中の issue #160 に回す。

### [MEDIUM] `BranchList` のスクロールバー指定が死んでいる — ui

`src/index.scss` が全要素に `::-webkit-scrollbar { display: none }` を掛けており、
`BranchList.scss` は `display: block` を書いていないので12行が一度も描画されない。
分岐が増えうる変更を入れたのに、スクロール可能な手掛かりが無い。同じ repo の他5箇所は
すべて `display: block` を書いている。

**対応せず**: SCSS。#160 に回す。

### [MEDIUM] クラス名の綴り違いでルールが死んでいる — ui

`BranchList.scss:55` の `brannch-selector__card--selected`（n が3つ）。見た目への影響は無い。

**対応せず**: SCSS。#160 に回す。

## 重複・矛盾した所見

- **レイヤ規則の BLOCK**: architecture と comment が独立に発見。両者とも実測で確認しており、
  comment 側は修正後の作業ツリーで層違反が報告されることまで確認している。
- **「変化N」の重複**: react / ui / robustness の3者が独立に発見。react と ui は `StatusTips`、
  robustness は `KifuForkMenu` を指しており、合わせると導出が3箇所あった。
- **`BranchOption` の2重表現**: react と architecture が独立に発見。直し方も一致（判別可能ユニオン）。
- **矛盾なし。**

## 検証して事実と違うことが判明したもの（reviewer の指摘を採用しなかった）

**この節の結論はラウンド5で誤りと判明した。取り消す。**

当初「`structuredClone` は現在の入口では効かない（tsshogi が先に埋めるので部分書き換えは
起こせない）」と結論したが、確かめたのは KIF 経路だけだった。実際には:

- `same` を先に埋めるのは **KIF と KI2 だけ**。CSA と JKF は埋めない
- `importCSA` は非合法手を**受理する**（当初の probe が使った `-9988UM` は「Invalid turn」という
  別の理由で弾かれており、それを一般化してしまった）
- CSA の非合法手を含む棋譜では `normalizeMinimal` が失敗した手に `same` を書き込んでから throw する

つまり `structuredClone` は実際に効いている。r5 で コメントを実態に直し、回帰テストも
KIF 版から CSA 版に差し替えた（差し替え前は clone を外しても落ちなかった）。

## 見ていない範囲

- Rust 側（差分に無い）。`npm run verify:rust` 未実行
- 実機での目視確認。ui は SCSS の読解と数値計算による判断で、ブラウザ実測ではない
- KI2 経路、Shift_JIS の KIF
- 正規化を通すようになったことによる保存内容の変化を実ファイルで確認していない
  （CSA で開いて編集すると保存物に `same` が新たに入る。main でも分岐を足せば同じ）
- `catch` して `console.error` だけの箇所が6つある（robustness、差分外）。#157 の範囲

## lint / hook で強制できるもの

- **レイヤ規則が生きていること**: `vite.config.test.ts` として**導入済み**
- **先後の記号の直書き**: `src/shared/lib/__tests__/turn.test.ts` として**導入済み**
  （oxlint に `no-restricted-syntax` が無いためテストで担保）
- **先後の「語」の直書き**: 記号は閉じたが `"先手"` / `"後手"` は5箇所に残る。
  記号付きに寄せるか付けないかを決めれば同じ手段で閉じられる（表示仕様の判断）
- **`変化${i + 1}` の直書き**: `BranchIndex` を branded type にすれば tsc が落とす（未実施）
- **未使用 export / 型**: `knip` は導入済みだが `verify` に未接続。未使用 export 75件の
  多くが未マージのエンジン作業が使いうる Tauri コマンド薄皮のため
- **`console.error` で終わる catch**: oxlint の `no-console` を features / widgets に限れば止まる（未実施）
- **未定義のカスタムプロパティ参照**: 定義と参照を突き合わせる自前チェックが要る（ui、#160 の範囲）

## 次ラウンドの対象

- 今回直した所見の確認
- 見送り: #157（保存失敗の通知、`console.error` 6件）、#160（SCSS 4件）、
  `BranchIndex` の branded type 化、`knip` の verify 接続
