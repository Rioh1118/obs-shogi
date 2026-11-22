---
version: alpha
name: ObsShogi
description: ObsShogi design system — 値は製品の今の画面から写した基準線（v0.1）。
colors:
  background-sunken: "#12181a"
  background-default: "#171e20"
  background-canvas: "#1f282b"
  background-stage: "#2c3639"
  background-hover: "#1e2729"
  background-selected: "#29353a"
  background-now: "#b07c55"
  background-dock: "#1b2325"
  background-dock-strip: "#161c1e"
  surface-raised: "#2a3336"
  surface-field: "#12181a"
  surface-overlay: "#12181a"
  text-default: "#d8dbd3"
  text-subtle: "#b5b9b0"
  text-faint: "#959c96"
  text-inverse: "#0b0e0e"
  text-accent: "#c8a07c"
  text-on-solid: "#ffffff"
  text-strong: "#efe8dc"
  text-label: "#a6aba4"
  accent-default: "#b07c55"
  accent-solid: "#8f6347"
  accent-solid-hover: "#865a3f"
  accent-bright: "#c79263"
  commit-solid: "#d8dbd3"
  commit-solid-hover: "#e9e7dd"
  border-weak: "#273033"
  border-default: "#3a474c"
  border-strong: "#6f7d83"
  feedback-info-default: "#8fa5b4"
  feedback-info-surface: "#1a2124"
  feedback-warning-default: "#d0a066"
  feedback-warning-surface: "#21201a"
  feedback-danger-default: "#b5645c"
  feedback-danger-surface: "#221d1d"
  feedback-danger-solid: "#b96d66"
  feedback-danger-solid-hover: "#c3817b"
  feedback-danger-text: "#d08f87"
  feedback-fatal-default: "#8c4a44"
  feedback-fatal-surface: "#201a1b"
  feedback-fatal-text: "#c18580"
  primary: "{colors.commit-solid}"
  focus-ring: "#c8a07c"
typography:
  body:
    fontFamily: system-ui, Hiragino Sans, Yu Gothic, Noto Sans JP, sans-serif
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  hint:
    fontFamily: system-ui, Hiragino Sans, Yu Gothic, Noto Sans JP, sans-serif
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.5
  aux:
    fontFamily: system-ui, Hiragino Sans, Yu Gothic, Noto Sans JP, sans-serif
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  section:
    fontFamily: system-ui, Hiragino Sans, Yu Gothic, Noto Sans JP, sans-serif
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.5
  title:
    fontFamily: system-ui, Hiragino Sans, Yu Gothic, Noto Sans JP, sans-serif
    fontSize: 18px
    fontWeight: 700
    lineHeight: 1.5
rounded:
  "0": 0px
  "1": 2px
  "2": 4px
  "3": 6px
  "4": 8px
  "5": 10px
  "6": 12px
  "7": 14px
  "8": 16px
  "9": 18px
  pill: 999px
  row: 0px
  control: 2px
  surface: 2px
  modal: 3px
spacing:
  "1": 2px
  "2": 4px
  "3": 6px
  "4": 8px
  "5": 10px
  "6": 12px
  "7": 14px
  "8": 16px
  "9": 18px
  "10": 20px
  "11": 22px
  "12": 24px
components:
  button-primary:
    backgroundColor: "{colors.commit-solid}"
    textColor: "{colors.text-inverse}"
    rounded: "{rounded.control}"
    padding: 6px 12px
    typography: "{typography.aux}"
  button-secondary:
    backgroundColor: "{colors.background-default}"
    textColor: "{colors.text-default}"
    rounded: "{rounded.control}"
    padding: 6px 12px
    typography: "{typography.body}"
---

<!-- 生成物。手で編集しない。正本は design_system/tokens/*.tokens.json と principles.md。npm run ds:build で再生成する。 -->

# ObsShogi Design System

## Overview

状態：洗練の方向 C4（decisions/0004）。深く冷たい緑黒の枠、冷たい砂の文字、銅のアクセント。開発者の道具（計器）の精度で、タイトル戦の本物の盤と駒台を囲む。盤・駒台・駒は実物の画像で、トークンの対象外。

### 1. 枠より素材を立てる
盤・駒台・駒は実物の画像で、画面の主役。枠（それ以外の全部）は暗い緑黒・砂色の文字・銅のアクセントで、素材を引き立てる側に回り、自分で質感を主張しない。今のスタイリッシュさはこの2層の対比から来ている。
判断の例：枠のサーフェスに木目や和柄を足したくなったら足さない。盤を平らな色で描き直す案は採らない。テーマの色を変えるときは、盤（榧）と駒台（濃い木）の画像に対して決める。

### 2. 枠は記録係のように振る舞う。正確 → 行き届く → 寡黙 の順
対局室の隅で手と時間を正確に書き留め、聞かれたことに短く答え、盤の主役を奪わない。嘘にならないことが先で、手が打てることが次で、短さはその後。
判断の例：失敗を黙れば短いが、何が起きたか分からなくなるので出す（正確が寡黙に勝つ）。手を打てるなら、次の一手のボタンを同じ場所に添える。

### 3. 起きないことより、いま起きていることに場所を使う
うまくいった段階は出さない。まれな失敗のために常設の段や行を足さない。起きたときだけ、既存の場所の語とボタンが変わる。
判断の例：読み込みが成功したら何も出さない。失敗して手を打てるときだけ、帯と状態の語で知らせる。

### 4. 読むところは詰めて揃える
検討のドックと候補手のパネルが理想の見本（利用者、2026-11-08）。読むペインは本文の背景（`color.background.default`）の上で詰め、1行に1項目、表は列で揃え、数は等幅にする。数字が更新されても動かさない。
判断の例：候補手が入れ替わっても並び替えを滑らせない。評価値・深さ・ノード数は等幅で桁を揃える。

### 5. 動きは操作に応えるときだけ
押す・開く・選ぶに応える動きだけを使う。反復して動くのは待ちの表示だけ。読むペインの隣で脈打つものは視線を奪う。
判断の例：検討中であることは、点滅ではなく語と進む経過時間で示す。

### 6. 同じ役割は同じ形
部品は入力の種類で決め、同じ種類を別の部品にしない。同じ行に並ぶ部品は同じ高さと枠を持つ。選んだものは灰青の塗りと太さ、局面の「いま」は銅の線と温かい塗りで見せる（`patterns/selection.md`）。
判断の例：2〜4の択一は区切りボタン、5つ以上は選択。画面ごとに別の選択の見た目を作らない。

### 7. ペインは色で塗り分けない。区切りは線
サイドバー・棋譜・ヘッダ・ドックは同じ1色のサーフェスにし、境目は細い線で引く。色の段は、盤と駒台の周り（半段沈める）と、選ばれた行の濃淡にだけ使う（ユーザー「サイドバーと棋譜の色を分けているのはダサい」、2026-11-08。decisions/0004）。
検討のドックだけは半段明るい（`color.background.dock`。利用者が今のドックを選んだ、2026-11-23。decisions/0005）。
判断の例：新しいペインを足すとき、サーフェスの色を変えて区別したくなったら、線で区切る。

### 8. 既存の寸法は意図したものとして扱う
今の余白や大きさを「大きい／小さい」で評価しない。指摘してよいのは、(a) 同じ役割の部品が別々の値で書かれている、(b) その値のせいで中身が入りきらない・操作できない、のどちらか。利用者が画面を名指して違和感を言ったときは、その画面を作り直す工程で見直す。
判断の例：スクロールバーを出さないのは意匠。不具合として扱わない。

### 9. 盤を先に置き、残りを詰める
ウィンドウの高さから盤の大きさを決め、残りで棋譜とドックを組む。帯やボタンのために盤を縮めない（利用者が盤の広い案を選んだ、2026-11-23）。
判断の例：手の移動は盤の下でなく棋譜の下に置く。失敗を知らせるときも、盤の大きさを変えずドックの高さから取る。

### 10. 箱を作らず、見出しと行と線で組む
枠のある箱は、打つもの・押すもの・開いたもの（メニューとモーダル）だけ。中身をまとめるのは、見出し・行・細い線。箱の中に箱を入れない。
判断の例：設定の1つの話題は、見出しと行にする。角丸の枠、札、グラデーションの背景で囲まない。

### 11. 何が入っても箱から溢れない
長い名前・空・失敗・狭いウィンドウでも崩れないことを、見本のデータで確かめてから入れる（`ds:screens`）。長い文字は、名前なら折り返すか末尾を省き、読むものなら折り返す。増える一覧は自分の中で送り、まわりを動かさない。
判断の例：プリセットが 14 件でも、詰み探索の設定は動かない。知らせが2件を超えたら、残りは数で言う。

## Colors

色は「何に使うか」の名前（意味付けトークン）だけを使う。`primary` は確定のボタンの砂色（`commit-solid`）を指す。テーマは暗い1つだけ。

| 名前 | 役割 |
| --- | --- |
| `background-sunken` | いちばん暗いサーフェス。上の帯、棋譜の見出しと手の移動の帯。ペインの本文には使わない |
| `background-default` | 本文の背景。ペイン（サイドバー・棋譜・設定）は全部この1色にし、境目は線で引く（decisions/0004） |
| `background-canvas` | 持ち上げたサーフェス。いま見ているタブ、選ばれた区切りボタン |
| `background-stage` | 盤と駒台を置くサーフェス。墨から離した緑。利用者が 2026-11-21 に4色から選んだ（decisions/0005） |
| `background-hover` | 行のホバー |
| `background-selected` | 選んだもの（ファイル・設定のタブ・適用中のプリセット）の灰青。銅は使わない（patterns/selection.md） |
| `background-now` | 局面の「いま」（いまの手・最善手）の行。左の銅の線と組で使う（patterns/selection.md） |
| `background-dock` | 検討のドックの背景。ほかのペインより半段明るい（利用者が今のドックを選んだ。decisions/0005） |
| `background-dock-strip` | 検討のドックの見出しの帯 |
| `surface-raised` | 暗い背景を1段階持ち上げたサーフェス。意味色を持たず「いま触れない」を示す（$surface-raised） |
| `surface-field` | 打つ欄の背景。枠（border.strong）と組で使う（$surface-field） |
| `surface-overlay` | ツールチップ。半透明なので文字との比は走査で測れない（$surface-overlay） |
| `text-default` | 本文 |
| `text-subtle` | 名前の添え書き・説明（$color-text-muted） |
| `text-faint` | 無効・範囲の注記。selected と stage の上には載せない（4.5:1 を割る）（$color-text-faint） |
| `text-inverse` | 明るい背景（確定・危険のボタン）に載せる文字 |
| `text-accent` | 進めるボタンの銅の文字 |
| `text-on-solid` | 背景に敷いた銅に載せる白文字 |
| `text-strong` | 題、いまの手、値 |
| `text-label` | 表の見出し、数の添え書き（$color-text-label） |
| `accent-default` | 局面の「いま」の線、いま見ているタブの下線、最善手の左の線 |
| `accent-solid` | 背景に敷く銅 |
| `accent-solid-hover` | 背景に敷く銅のホバー（暗くする） |
| `accent-bright` | 「いま」を示す点（適用中） |
| `commit-solid` | 確定のボタンの背景。暗い文字を載せる |
| `commit-solid-hover` | 確定のボタンのホバー（明るくする） |
| `border-weak` | ペインの境目と行の区切り。不透明（$stroke-weak） |
| `border-default` | 表の見出しの下、モーダルとメニューの枠（$stroke） |
| `border-strong` | 打つ欄と押すものの枠。本文の背景で 3:1 以上（$stroke-strong） |
| `feedback-info-default` | 伝えるだけ（$color-info） |
| `feedback-info-surface` | 知らせの背景。不透明（$surface-info） |
| `feedback-warning-default` | 再試行で直る（$color-warning） |
| `feedback-warning-surface` | 知らせの背景。不透明（$surface-warning） |
| `feedback-danger-default` | 別の操作が要る。危険な操作の確認も（$color-danger） |
| `feedback-danger-surface` | 知らせの背景。不透明（$surface-danger） |
| `feedback-danger-solid` | 背景に敷く危険色。暗い文字 4.92:1（$color-danger-solid） |
| `feedback-danger-solid-hover` | 背景に敷く危険色のホバー。暗い文字 6.10:1。暗い文字なので明るくする（$color-danger-solid-hover） |
| `feedback-danger-text` | 暗い背景に載せる危険色の文字（$color-danger-text） |
| `feedback-fatal-default` | アプリ再起動（$color-fatal） |
| `feedback-fatal-surface` | 知らせの背景。不透明（$surface-fatal） |
| `feedback-fatal-text` | 暗い背景に載せる fatal の文字（$color-fatal-text） |

フォーカスリング（`focus-ring`）は固定の値（銅の1本、2px）。変えない（decisions/0003）。

## Typography

文字は用途で選ぶ（hint / aux / body / lead / section / title / display / hero）。本文は 13px 以上、全体は 11px 以上（固定の規則、decisions/0003）。太さは4段階。書体は端末の和文書体。数は等幅にする。

## Layout

余白は 2px 刻みの段階（spacing 1〜12）だけを使う。同じ N の角丸と同じ値。段階にない値が必要になったら、作らずに質問する。

## Elevation & Depth

ペイン（サイドバー・棋譜・ヘッダ・ドック）は `background-default` の1色にし、境目は線で引く。色で塗り分けない。盤と駒台の周りだけ `background-stage` で半段沈める。`background-canvas` は選ばれた行の濃淡、`background-sunken` は暗いカードと入力の沈みにだけ使う。サーフェスは影で浮かせない（panel・control の影は無し）。影はポップオーバーとメニュー（overlay）だけ。

## Shapes

角丸は役割で選ぶ（row / control / surface / modal / pill）。外のサーフェスほど大きく、内側は1段階以上小さい。

## Components

見本は Button（primary / secondary）だけ。部品を選ぶときは components/_index.md の選定索引を引く。

## Do's and Don'ts

- Do: 盤と駒台の画像を主役にし、枠の色はその木の色に対して決める
- Do: 状態は語で言い、色と記号は語を支えるだけにする。tier の区別を色だけに持たせない
- Do: 数は等幅にし、表は列で揃える。読み筋と綴りは等幅の書体
- Don't: 白透明の背景で選択を見せる（利用者「白透明はダサい」）。代わりに灰青の塗り（`color.background.selected`）と太さで見せる
- Don't: 銅を飾りに使う。代わりに、局面の「いま」といま見ているタブだけに使う
- Don't: 枠にグラデーション・ぼかし・光る影を使う。代わりに平らな塗りと線。影は、盤・駒台と、開いたメニュー・モーダルだけ
- Don't: 角丸の箱を箱に入れる。代わりに見出し・行・線で組む
- Don't: 和風の装飾、白い業務 SaaS の見た目、ゲーミングの派手さ（brief §7）。代わりに暗い枠と砂色・銅の3色で組む
- Don't: ペインをサーフェスの色で塗り分ける。代わりに1色のサーフェスを線で区切る
- Don't: 待ち以外を反復して動かす。代わりに語と経過時間で進行を示す
