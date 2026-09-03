# 画面遷移マップ

対象: `src/app/routing/` `src/pages/AppModalLayer.tsx` `src/shared/lib/router/useURLParams.ts`

## 全体の形

**画面は2階建て。** 下は `react-router` のルートで、**2本しかない**。
上はモーダルで、`?modal=` の1つのパラメータで切り替わる。

```
/                                AppLoading  ── 設定の状態で3つに分かれる
│                                              ├ 読み込み中     → BootSplash
│                                              ├ 読み込み失敗   → 起動エラー + 選び直し
│                                              └ root_dir 無し  → FolderSelect
│
└ /app          RuntimeShell（RequireRootDir → RuntimeProviders → TitleBar）
   └ AppLayout  ヘッダ ＋ サイドバー ＋ 本体（盤・棋譜・解析）
      └ /app/panel/filetree   サイドバーの中身（`index` はここへ replace）
```

`/app` 直下の `index` は `panel/filetree` へ `replace` で飛ばす。
**サイドバーに入る面は、いまファイルツリー1つだけ。**
`/app/panel/*` という形にしてあるのは面が増えることを見越したもので、
2本目はまだ無い。

### ルートが2本しか無いことの帰結

盤・棋譜・解析ペインは**ルートを持たない**。どれも `AppLayout` が常に描く。
「どの棋譜を開いているか」も「何手目か」もルートには乗らず、
前者は `file-tree` の state、後者は `?tesuu=` が持つ。

## モーダル層

`AppModalLayer`（`pages/AppModalLayer.tsx`）は、開いているかどうかに関わらず
**9枚すべてを常時マウントする。** 各モーダルが自分で `params.modal` を見て
`null` を返す。

このため、**モーダルの中の state は閉じても消えない。** 消したいものは
各モーダルが明示的にリセットする（例: `SfenKifuCreateModal` は開いた時に
フォームを初期化する）。リセットを書き忘れると、前回開いたときの入力が残る。

9枚のうち **URL で開くのは7枚**で、残り2枚は state で開く。

| 種類             | 枚数 | 開き方                                      |
| ---------------- | ---- | ------------------------------------------- |
| URL で開くもの   | 7    | `ModalType` の union（`useURLParams.ts`）   |
| state で開くもの | 2    | `useFileTree()` の `conflict` / `kifuError` |

`ModalType` の7つ:

| 値                    | 画面                     |
| --------------------- | ------------------------ |
| `navigation`          | 局面ナビゲーション       |
| `settings`            | 設定                     |
| `create-file`         | ファイル作成／インポート |
| `position-search`     | 局面検索                 |
| `study-position-save` | 課題局面の登録・編集     |
| `study-positions`     | 課題局面の一覧           |
| `sfen-kifu-create`    | 課題局面から棋譜を作成   |

**モーダルを増やすときは `ModalType` も増やす**（`CLAUDE.md` の「連動が必要な箇所」）。
なお、この union が下位層（`shared/`）に上位層のスライス名簿を持たせている点は
構造の負債として `docs/IDEAS.md` に載っている。

### プリセット編集だけ URL を持たない

エンジンプリセットの編集は `Modal` を使った別窓だが、
`EngineTab` のローカル state（`editingId`）で開く。**設定モーダルの上に重なる。**
そのため URL からは開けず、リロードすると閉じる。
→ [screens/engine-preset-dialog.md](screens/engine-preset-dialog.md)

## URL パラメータ

`URLParams`（`useURLParams.ts`）が持つ8つ。

| キー       | 型                  | 誰が読むか                                                                  |
| ---------- | ------------------- | --------------------------------------------------------------------------- |
| `modal`    | `ModalType`         | 各モーダル                                                                  |
| `tab`      | `string`            | 設定（`workspace`/`aiLibrary`/`engine`）・ファイル作成（`create`/`import`） |
| `dir`      | `string`            | ファイル作成の保存先                                                        |
| `sfen`     | `string`            | 局面検索・課題局面の登録・SFEN からの棋譜作成                               |
| `returnTo` | `ModalType`         | 閉じたときに戻る先のモーダル                                                |
| `pov`      | `"sente" \| "gote"` | 盤の向き                                                                    |
| `tesuu`    | `number`            | `navigateToPosition` が書く。**読み手は現状いない**                         |
| `branch`   | `string`            | 同上                                                                        |

### `tesuu` / `branch` は書かれるが読まれない

`navigateToPosition(tesuu, branch)` は URL に両方を書くが、
盤の位置を決めているのは `entities/game` の `state.cursor` であって
このパラメータではない。**URL を直接書き換えても盤は動かない。**
リロードすると `tesuu` は URL に残ったまま盤は0手目に戻る。

### `returnTo` の連鎖

課題局面の一覧から子のモーダルを開くとき、`returnTo=study-positions` を積む。

```
study-positions ──[検索]──→ position-search?sfen=…&returnTo=study-positions
                ──[編集]──→ study-position-save?sfen=…&returnTo=study-positions
                ──[棋譜作成]→ sfen-kifu-create?sfen=…&returnTo=study-positions
```

- **取り消して閉じる**（Esc・オーバーレイ・キャンセル）→ `returnTo` の画面へ戻る
- **確定して閉じる**（検索結果を開く）→ `closeModal({ skipReturn: true })` で全部落とす

一覧側は「`returnTo` が自分を指している間は絞り込みの state を捨てない」ことで、
戻ってきたときに検索語とタグの選択を保つ。

## 画面遷移表

**状態**は `docs/state-transitions/app.md` の A0〜A5 と同じものを使う。
ここでは**どの画面が見えるか**だけを書く。中身の遷移は各仕様書と L1 の表が持つ。

| 状態   | 見えている画面                           | 出口                                            |
| ------ | ---------------------------------------- | ----------------------------------------------- |
| A0     | `BootSplash`                             | 設定の読み込み完了・失敗                        |
| A1     | `FolderSelect`（または起動エラー）       | ワークスペースを選ぶ → A2                       |
| A2     | シェル ＋ ツリー ＋ `WelcomeScreen`      | 棋譜を選ぶ → A3                                 |
| A3〜A5 | シェル ＋ ツリー ＋ 盤・棋譜・解析ペイン | 棋譜を閉じる → A2 / ワークスペース変更 → 再読込 |

**A2 と A3 の切り替えは `hasFile`（`gameView.player?.shogi` の有無）1つで決まる。**
棋譜を開く経路は2つあり、どちらも同じ state を通る。

| 経路             | 起点                             | 効果                                        |
| ---------------- | -------------------------------- | ------------------------------------------- |
| ツリーから開く   | `FileNode` のクリック            | `openKifuNode` → `activeKifuPath` が変わる  |
| 検索結果から開く | 局面検索で Enter／ダブルクリック | `usePositionHitNavigation` が同じ経路を通す |

棋譜が変わると `AppLayout` が `pov` を落とす（盤の向きは棋譜ごとに持ち越さない）。

## モーダルを開くボタンの所在

**同じモーダルへの入口が複数ある。** 増やすときは、ここに足す。

| モーダル              | 入口                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `settings`            | ヘッダの歯車（`tab=general`※）／解析ペインの歯車（`tab=general`※）／ツリーの失敗通知（`tab=workspace`） |
| `study-positions`     | ヘッダの本アイコン                                                                                      |
| `study-position-save` | 解析ペインのしおりアイコン／課題局面一覧の「編集」と `e` キー                                           |
| `position-search`     | 解析ペインの虫眼鏡／課題局面一覧の「検索」と `s` キー                                                   |
| `navigation`          | 解析ペインのコンパス                                                                                    |
| `create-file`         | ツリーのフォルダ行のホバーで出る「＋」                                                                  |
| `sfen-kifu-create`    | 課題局面の詳細の「棋譜を作成」                                                                          |

※ `tab=general` というタブは `TABS`（`features/settings/model/tabs.ts`）に無い。
`SettingsPanel` が知らない値を `workspace` に読み替えるので実害は出ていないが、
**URL には存在しないタブ名が入る。**

## いま満たしていないこと

- **`tesuu` / `branch` に読み手がいない。** URL は局面を復元できない
- **`tab=general` が実在しないタブを指している**（上記）
- **モーダルは9枚とも常時マウントされる。** 閉じている間もフックが走るので、
  各モーダルが自前で「閉じている間は何もしない」を書く必要がある。
  書き漏らすと盤を1手進めるたびに閉じたモーダルの state が更新される
- **プリセット編集がリロードで消える。** URL を持たないため
