# レビュー preset-dialog-b

- 日付: 2026-10-04
- 範囲: プリセット編集の画面を案B（名前／使うもの／解析／エンジンの設定）へ組み直す変更（U2）。`feat/preset-dialog-b`、基点 `65b7f037`
- 走らせた reviewer: react / robustness / ui / comment / architecture（重: 状態機械・失敗経路・`entities/` を触る）
- 対象コミット: 4b331ad2 と、この報告書を含む次の1本（積む前の作業ツリーで1巡目を当てた）

## 入れた機械

- **`scssUnusedElements`**（`src/__tests__/scssUnusedElements.test.ts`）: SCSS が定義する BEM の要素のうち、`src/` のコードに綴りが無いものの件数を床にする。消した節の規則が2つの SCSS に残り、3クラスは同じ中身で重なっていた（ui）。消した規則を1つ戻すと `29 → 30` で落ちることを確かめた。拾えた要素の下限（500）を別に置く
- 新しい挙動はテストで固定し、それぞれ壊す変異で落ちることを確かめた（9件すべて落ちた）:
  - 補完を開いた後の1回に限る／エンジンのあるプリセットは補完しない（`presetDialogProbe` の「空欄の補完は…」）
  - 「指定しない」で `aiName` も空にする
  - 選び直したら名乗りを消す／いまのエンジンを読めていなければ保存した名乗りで出さない
  - 「使わない」定跡はパスごと保存で落とす／定跡ビューも `bookInUse` で出す（`bookViewStates`）／`bookInUse` はパスも要る
  - 「やめる」の後に「もう一度読み込む」が残る（`probeStatus` と `presetDialogProbe`）
  - カードの評価関数の行が1つで、評価関数が無くても設定済み（`engineTabCard`）

## 直した所見

積む前の作業ツリーで直したので、所見ごとのコミットは無い（4b331ad2 に畳み込み済み）。

- [BLOCK] 評価関数の「指定しない」を補完が埋め直す（react / robustness / comment）→ 補完を開いた後の1回、エンジンの無いプリセットに限る
- [HIGH] 「やめる」の後に読み込み直す口が消える（react / robustness）→ 定義が無いまま止まっていたら「まだ読み込んでいません」と「もう一度読み込む」
- [HIGH] 選び直したエンジンを、読めないまま前の名乗りで出し、保存する（robustness）→ 選び直しで名乗りを消し、表示は `hasCurrentDefinitions` のときだけ
- [HIGH] 欄は「使わない」なのに定跡ビューが出す（architecture / comment / robustness）→ `bookInUse` を entities に置き、ダイアログ・定跡ビュー・カードがそれで読む。保存で使わない定跡のパスを落とす
- [HIGH] カードに評価関数の行が2つ（architecture）→ 1つに。自分で入れた退行
- [HIGH] `aiName` の doc が「カードが出す」「表示だけ」と嘘（comment / architecture）→ 読むのは `autofillPreset` だけと書き直し、書く所を `onEvalChosen` に寄せた（節から下書きの setter を外した）
- ファイル型の行で、選ぶ画面の失敗が名前の列に落ちる（ui）→ 入力を1つの箱に入れた
- 長いパス・OS の出力が折り返さず節に切られる（ui）→ `hintMuted` / `hintWarn` / 綴りに `overflow-wrap: anywhere`
- エンジンのパスに綴りのクラスを流用し、起動できない理由を2回出す（ui）→ `presetDialog__enginePath` を立て、下はパスだけ
- インラインの直値2件（ui）→ クラスへ
- 「ほかの数…」がボタンに無い値の間は効かない（react）→ その間は押せなくする
- `ANALYSIS_OPTION_NAMES` と `AnalysisSection` の `"MultiPV"` が別々に同じことを決める（architecture）→ `MULTIPV_OPTION` を entities に1つ。行の置き場の定数は `optionRows` の中へ
- 「初期値（エンジンの既定）」の二重の言い方・`defaultLabel` の写し（comment）→ `engineDefaultLabel` に寄せた
- 読み込み失敗の `invalidValue` が、画面に無い「パスを確かめて」を求める（comment）→ 「エンジンを選び直すか…」
- 走査の失敗が `AI_ROOT` の語で、次にすることを言わない（robustness）→ 「AI のフォルダ…『探し直す』」
- 消えた節（重要オプション・AI ルートの選び直し・MultiPV の注意書き）を前提にしたコメント（comment / react）→ 綴りで指す形へ
- spec と現物のずれ3点・判定表の使い手の列挙・`engine-options.md` の古い要件（ui / comment）→ 直した

## 送ったもの

`docs/IDEAS.md`「プリセット編集の置き場と分け方」:

- `fileLabel` を `entities/engine` へ下げる（architecture）
- `UsedFilesSection` を帯とエンジンの欄に分ける（architecture。setter は外した）
- `quickOptions.ts` の改名（architecture）
- 「やめる」が Rust の取得を止めない（robustness の見ていない範囲から）

## 機械にできなかったもの

- JSX の `style` の直値（ui が走査を提案）→ `mechanization-backlog.md` に1回目として足した
- 「エンジン既定」の綴りを禁じる案（comment）→ **入れない。** 画面の語は「初期値」に揃えたが、コードの「エンジン既定」は「値を送らずエンジン自身の既定で動く」という別の概念を正しく指していて、禁じると正しい用法を巻き込む
- ファイル型の失敗の置き場をテストで見る案（ui）→ jsdom は配置を計算しないので、親が同じかを見ても列は分からない。入れない

## 見ていない範囲

- 実機での目視（幅・長いパスの折り返し）。jsdom はレイアウトをしない
- Rust 側（この変更では触っていない）
