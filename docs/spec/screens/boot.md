# 画面仕様: 起動とワークスペース選択

対象: `index.html` `src/pages/AppLoading.tsx` `src/pages/FolderSelect.tsx`
`src/widgets/boot-splash/` `src/features/choose-workspace/`
`src/app/routing/guards/RequireRootDir.tsx` `src-tauri/tauri.conf.json`

状態遷移: [`docs/state-transitions/app.md`](../../state-transitions/app.md) の A0 / A1

## 目的

**アプリが動くために唯一必要な設定 —— ワークスペース（`root_dir`）—— を決めさせる。**
決まるまで先へ進めない。決まっていれば素通りする。

## 出入口

ルート `/` に入ると `AppLoading` が出る。ここは3つに分かれる。

| 入ってきた状態                  | 出るもの                       | 抜け方                        |
| ------------------------------- | ------------------------------ | ----------------------------- |
| 設定を読み込み中（`isLoading`） | `BootSplash`                   | 読み込みが終わる              |
| 設定の読み込みが失敗（`error`） | 起動エラー＋選び直しボタン     | ワークスペースを選ぶ          |
| 読み込み済み・`root_dir` が無い | `FolderSelect`                 | ワークスペースを選ぶ → `/app` |
| 読み込み済み・`root_dir` がある | 何も描かず `/app` へ `replace` | —                             |

`/app` 側にも同じ判定が `RequireRootDir` として入っており、
`error` か `root_dir` 無しなら `/` へ戻す。**判定は2箇所にある**が、
`AppLoading` は出すものを決め、`RequireRootDir` は入れないことを決める、と役割が違う。

## 画面構成

### 窓の初期色

窓は `src-tauri/tauri.conf.json` の `backgroundColor` で `#3f4e4f`
（`src/index.scss` の `$color-primary-light`）に塗られる。

**この色は「画面」ではなく、まだ何も描いていない間の下地。** 窓枠は自前
（`decorations: false`）でプロセス起動と同時に画面へ載るので、これを指定しないと
webview の既定色（白）が出る。アプリの面は暗いので、**起動のたびに白が1枚挟まる。**

`$color-primary-light` を選ぶのは、窓の色が最初に接するのが常に `BootSplash` だから
（`BootSplash` の面と同じ）。`/app` へ抜けた後の `AppLayout` の面とも同じ。

**`FolderSelect` と起動エラーの面は `$color-primary-dark` で、ここだけ一段暗い。**
つまりワークスペース未設定の初回起動では、窓 → `BootSplash` → `FolderSelect` で
面が1回変わる。画面の最下面が2トークンに割れていることが原因 → #545

**`visible: false` にして描けてから見せる、は採らない。** React が着く前に落ちると
窓が一度も出ず、プロセスだけが残る（#513 の症状が悪化する）。

### 起動の1枚目（`index.html` の `.boot-static`）

`BootSplash` と同じ絵を、`index.html` が静的な HTML として持っている。
`#root` の中に書いてあり、`createRoot(...).render()` の初回コミットで消える
（React は HostRoot をコミットする段で container の子を空にする）。

**バンドルされた CSS もモジュールグラフも待たない。** ここが無いと、
最初の絵が出るまでの間ずっと窓の初期色だけになる —— 白は消えても、
利用者から見れば「何も起きていない窓」が数百 ms 続く。

寸法は px で書いてある。`html { font-size: 62.5% }`（`src/app/styles/global.scss`）は
バンドル側にあり、この時点ではまだ効かないので、`rem` を書くと CSS が届いた瞬間に
大きさが飛ぶ。`BootSplash.scss` の `rem` の 10 倍に揃えることは
`src/__tests__/bootStaticSplash.test.ts` が見る。

**アニメーションは写していない。** 写した宣言はどれも片方だけ動きうる。
`"Loading"` の書体も、`@font-face` がバンドル側にあるので**1回入れ替わる**。

**10秒経っても消えなければ、断りに切り替わる。** `createRoot` に入る前に落ちる経路
（モジュール評価中の throw、`#root` が無い、捕まえていない rejection）では
この1枚が永久に残るので、放っておくと「Loading が回り続ける窓」になる。
窓枠は自前で閉じるボタンも無いため、利用者にできることが無くなる。
出すのは一文と「ウィンドウを閉じる」だけ。**ドラッグ領域は持たない** → #513

### BootSplash

アイコンと `Loading` と点3つ。**進捗も中止も出ない。** 設定の読み込みは
`load_config` の1往復なので、通常はほぼ見えない。
上の静的な1枚と絵が同じなので、入れ替わりは書体と点の動き以外に出ない。

### FolderSelect

- アプリ名（`Title`）
- 一文の案内: 「あなたの定跡を整理するノートアプリへようこそ」
- `ChooseWorkspaceButton` —— OS のフォルダ選択ダイアログを開く

選ばれたら `/app` へ `replace` で移る。
`config.root_dir` がすでにある状態でこの画面がマウントされた場合も `/app` へ飛ばす。

### 起動エラー

`AppLoading` が `error` を見て出す。中身は次の3つだけ。

- タイトル
- `起動エラー: {error}`（`role="alert"`）
- `ChooseWorkspaceButton`

**ここに `FolderSelect` を置くことはできない。** あちらは `config.root_dir` があれば
`/app` へ飛ぶが、`error` が立っている間は `RequireRootDir` が `/` へ戻すので
往復が止まらなくなる。`error` は `config` を消さないので、この組み合わせは実際に起きる。

## 状態

| 記号 | 状態                 | 判定                                  | 見えるもの     |
| ---- | -------------------- | ------------------------------------- | -------------- |
| B-1  | React が着く前       | `#root` に静的 markup が残っている    | 起動の1枚目    |
| B0   | 設定の読み込み中     | `isLoading && !config`                | `BootSplash`   |
| B1   | 読み込み失敗         | `error !== null`                      | 起動エラー     |
| B2   | ワークスペース未設定 | `config !== null && !config.root_dir` | `FolderSelect` |
| B3   | 設定済み             | `config.root_dir !== null`            | `/app` へ遷移  |

**B-1 と B0 は絵で区別できない。** そう作ってあるので、入れ替わりの継ぎ目が出ない。
区別が要るのは止まったときだけで、そちらは10秒後に断りへ切り替わることで付く。

## 操作と結果

| 操作                            | 結果                                          |
| ------------------------------- | --------------------------------------------- |
| 「フォルダを選ぶ」→ 選ぶ        | `root_dir` を保存 → `/app` へ `replace`       |
| 「フォルダを選ぶ」→ 取り消す    | 何も起きない。**画面にも何も出ない**          |
| 設定済みの状態で `/` を直接開く | `/app` へ `replace`。この画面は一瞬も見えない |

ワークスペースの**変更**はここではなく設定の「ワークスペース」タブが持つ。
→ [settings.md](settings.md)

## 失敗の見せ方

| 失敗                   | どこに出るか                     | 復帰             |
| ---------------------- | -------------------------------- | ---------------- |
| 設定 JSON が壊れている | `起動エラー: …` の1行            | 選び直すしかない |
| フォルダ選択の取り消し | **出ない**（正常な取り消し扱い） | もう一度押す     |
| 選んだ先が読めない     | **画面には出ない**               | —                |

設定の読み込み失敗は `serde_json::from_str` の失敗、つまり
**設定ファイルが壊れているとき**にしか起きない（ファイルが無い場合は既定値を返す）。
再試行では直らないので、ADR-0004 の段では `fatal` に当たる。
→ [`failure-surfacing.md`](../../state-transitions/failure-surfacing.md) F-1

**この画面のレンダ例外を受けるのは root の境界だけ。** `/` は `RuntimeShell` の外に居るので、
中の境界には届かない。→ [app-layout.md](app-layout.md) の「失敗の見せ方」

**正常時のこの画面には、ウィンドウを動かす帯も閉じるボタンも無い**（`TitleBar` は
`RuntimeShell` の中）。落ちたときだけ root の fallback が枠を描くという逆転になっている → #515

## いま満たしていないこと

- **`RequireRootDir` は `error` の内容を捨てる。** `/` へ戻すだけなので、
  設定が壊れている場合と単に未設定の場合が画面から区別できない
  （`AppLoading` に戻れば文言は出るが、戻る途中の1フレームは同じ絵になる）
- **`AppConfig` の `error` が2つの意味を兼ねている** —— 「起動できない」と
  「更新できなかった」。後者を積むとランタイムごと畳まれる → #249
- **`BootSplash` に進捗も中止も無い。** 読み込みが返らない場合、画面は Loading のまま止まる。
  静的な1枚が持っている10秒後の断りは**React が着く前にしか出ない**ので、
  `load_config` が返らない回はここに落ちる
- **選んだフォルダが読めなかった場合の経路が画面に出ない**

## これからの要件

決まっているものは無い。ワークスペースを複数持つ（最近開いた一覧、切り替え）
という構想は `docs/IDEAS.md` にも issue にも無いので、**ここには書かない**。
