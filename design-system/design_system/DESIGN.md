---
version: alpha
name: ObsShogi
description: ObsShogi design system — 値は製品の今の画面から写した基準線（v0.1）。
colors:
  background-sunken: "#1c2325"
  background-default: "#2c3639"
  background-canvas: "#3f4e4f"
  surface-raised: "#3c4244"
  surface-field: "#000000"
  surface-overlay: "#1c2325"
  text-default: "#dcd7c9"
  text-subtle: "#b9b7ac"
  text-faint: "#9e9f97"
  text-inverse: "#0e1110"
  text-accent: "#c29a78"
  text-on-solid: "#ffffff"
  accent-default: "#a27b5c"
  accent-solid: "#8f6b4e"
  accent-solid-hover: "#866549"
  commit-solid: "#dcd7c9"
  commit-solid-hover: "#e8e4d9"
  border-weak: "#ffffff"
  border-default: "#ffffff"
  border-strong: "#ffffff"
  feedback-info-default: "#7d93a3"
  feedback-info-surface: "#222a2d"
  feedback-warning-default: "#c8955a"
  feedback-warning-surface: "#262a28"
  feedback-danger-default: "#b5645c"
  feedback-danger-surface: "#252728"
  feedback-danger-solid: "#b96d66"
  feedback-danger-solid-hover: "#c3817b"
  feedback-danger-text: "#c98a83"
  feedback-fatal-default: "#8c4a44"
  feedback-fatal-surface: "#232527"
  feedback-fatal-text: "#c18580"
  primary: "{colors.commit-solid}"
  focus-ring: "#c29a78"
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
  row: 4px
  control: 6px
  surface: 8px
  modal: 10px
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

状態：基準線。値は製品の今の画面（暗い緑黒の枠、砂色の文字、銅のアクセント）から写した。盤・駒台・駒は実物の画像で、トークンの対象外。洗練の方向は brief.md をもとにモード B で決める。

### 1. 枠より素材を立てる
盤・駒台・駒は実物の画像で、画面の主役。枠（それ以外の全部）は暗い緑黒・砂色の文字・銅のアクセントで、素材を引き立てる側に回り、自分で質感を主張しない。今のスタイリッシュさはこの2層の対比から来ている。
判断の例：枠の面に木目や和柄を足したくなったら足さない。盤を平らな色で描き直す案は採らない。テーマの色を変えるときは、盤（榧）と駒台（濃い木）の画像に対して決める。

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
部品は入力の種類で決め、同じ種類を別の部品にしない。同じ行に並ぶ部品は同じ高さと枠を持つ。選択の見せ方は1つ（左の銅の棒）。
判断の例：2〜4の択一は区切りボタン、5つ以上は選択。画面ごとに別の選択の見た目を作らない。

### 7. 既存の寸法は意図したものとして扱う
今の余白や大きさを「大きい／小さい」で評価しない。指摘してよいのは、(a) 同じ役割の部品が別々の値で書かれている、(b) その値のせいで中身が入りきらない・操作できない、のどちらか。利用者が画面を名指して違和感を言ったときは、その画面を作り直す工程で見直す。
判断の例：スクロールバーを出さないのは意匠。不具合として扱わない。

## Colors

色は「何に使うか」の名前（意味付けトークン）だけを使う。`primary` は確定のボタンの砂色（`commit-solid`）を指す。テーマは暗い1つだけ。

| 名前 | 役割 |
| --- | --- |
| `background-sunken` | いちばん深い面。サイドバー、暗いカード |
| `background-default` | 本文の背景。ドック、ヘッダ、読むペイン |
| `background-canvas` | 盤と棋譜を置く面 |
| `surface-raised` | 暗い背景を1段階持ち上げた面。意味色を持たず「いま触れない」を示す（$surface-raised） |
| `surface-field` | 打つ欄の背景。半透明なのは載る背景の明るさを保つため（$surface-field） |
| `surface-overlay` | ツールチップ。半透明なので文字との比は走査で測れない（$surface-overlay） |
| `text-default` | 本文 |
| `text-subtle` | 名前の添え書き・説明。本文の背景で 6.16:1。不透明に混ぜる（$color-text-muted） |
| `text-faint` | 無効・範囲の注記。本文の背景で 4.64:1。surface.raised の上には載せない（$color-text-faint） |
| `text-inverse` | 明るい背景（確定・危険のボタン）に載せる文字 |
| `text-accent` | 進めるボタンの銅の文字 |
| `text-on-solid` | 背景に敷いた銅に載せる白文字 |
| `accent-default` | 選択の棒、つまみの満たした側、目印の帯 |
| `accent-solid` | 背景に敷く銅 |
| `accent-solid-hover` | 背景に敷く銅のホバー（暗くする） |
| `commit-solid` | 確定のボタンの背景。暗い文字を載せる |
| `commit-solid-hover` | 確定のボタンのホバー（明るくする） |
| `border-weak` | 弱い区切り（$stroke-weak） |
| `border-default` | 枠。打つ欄と中立のボタン（$stroke） |
| `border-strong` | 強い枠（$stroke-strong） |
| `feedback-info-default` | 伝えるだけ（$color-info） |
| `feedback-info-surface` | 失敗を伝える箱の背景。不透明（$surface-info） |
| `feedback-warning-default` | 再試行で直る（$color-warning） |
| `feedback-warning-surface` | 失敗を伝える箱の背景。不透明（$surface-warning） |
| `feedback-danger-default` | 別の操作が要る。危険な操作の確認も（$color-danger） |
| `feedback-danger-surface` | 失敗を伝える箱の背景。不透明（$surface-danger） |
| `feedback-danger-solid` | 背景に敷く危険色。暗い文字 4.92:1（$color-danger-solid） |
| `feedback-danger-solid-hover` | 背景に敷く危険色のホバー。暗い文字 6.10:1。暗い文字なので明るくする（$color-danger-solid-hover） |
| `feedback-danger-text` | 暗い背景に載せる危険色の文字。#1c2325 で 5.66:1（$color-danger-text） |
| `feedback-fatal-default` | アプリ再起動（$color-fatal） |
| `feedback-fatal-surface` | 失敗を伝える箱の背景。不透明（$surface-fatal） |
| `feedback-fatal-text` | 暗い背景に載せる fatal の文字。#1c2325 で 5.27:1（$color-fatal-text） |

フォーカスリング（`focus-ring`）は固定の値（銅の1本、2px）。変えない（decisions/0003）。

## Typography

文字は用途で選ぶ（hint / aux / body / lead / section / title / display / hero）。本文は 13px 以上、全体は 11px 以上（固定の規則、decisions/0003）。太さは4段階。書体は端末の和文書体。数は等幅にする。

## Layout

余白は 2px 刻みの段階（spacing 1〜12）だけを使う。同じ N の角丸と同じ値。段階にない値が必要になったら、作らずに質問する。

## Elevation & Depth

面の暗さは sunken / default / canvas の3段。影は浮き上がりの高さでなく、何が浮いているか（panel / overlay / control）で選ぶ。

## Shapes

角丸は役割で選ぶ（row / control / surface / modal / pill）。外のサーフェスほど大きく、内側は1段階以上小さい。

## Components

見本は Button（primary / secondary）だけ。部品を選ぶときは components/_index.md の選定索引を引く。

## Do's and Don'ts

- Do: 盤と駒台の画像を主役にし、枠の色はその木の色に対して決める
- Do: 状態は語で言い、色と記号は語を支えるだけにする。tier の区別を色だけに持たせない
- Do: 数は等幅にし、表は列で揃える。読み筋と綴りは等幅の書体
- Don't: 白透明の背景で選択を見せる（利用者「白透明はダサい」）。代わりに左の銅の棒と、面の濃淡で見せる
- Don't: 和風の装飾、白い業務 SaaS の見た目、ゲーミングの派手さ（brief §7）。代わりに暗い枠と砂色・銅の3色で組む
- Don't: 待ち以外を反復して動かす。代わりに語と経過時間で進行を示す
