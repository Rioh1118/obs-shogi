# IDEAS

「やるかもしれないが、6週間以内に着手しない」もの置き場。

**運用ルール**: issue を新規に立ててよいのは **6週間以内に着手するものだけ**。それ以外はここに1行で書く。
ここから issue に昇格するのは、6週間以内に着手すると決めたときだけ。

> 背景: backlog は持ち越すだけでコストになる。本当に重要なアイデアは何度でも戻ってくる。
> 以下は 2026-07-27 に `direction:maybe` ラベルごと整理したもの。**すべて issue として再オープン可能**（番号を残してある）。

---

## 解析キャッシュ永続化（旧 Phase 1 / #86–#89）

局面に解析結果を紐付けて保存する構想。4 issue に分解済みだった。

- #86 Rust `analysis_cache` モジュール（load/save + atomic write）
- #87 FE `entities/analysis-cache` + Provider 統合 + 自動書込
- #88 `KifuMoveCard` 解析済バッジ + AnalysisPane 履歴セクション
- #89 解析キャッシュの肥大化対策 policy

判断: 方針転換メモで「あると良い」＝必須ではない。解析は現状 transient で設計されており（Analysis aggregate は永続しない）、永続化は aggregate 境界の変更を伴う。T1 が片付くまで着手しない。

## 定跡まわりの周辺タスク（旧 Phase 4 / #102–#104）

- #102 解析キャッシュ import / export（JSON + CSV）← 上記が前提
- #103 AI Library UI を新 book formats に対応
- #104 `.sbk` 直接対応の調査タスク

判断: 定跡の read/write 本体（#84 #90–#101）が先。

なお ShogiHome は4形式の read/write/変換をテスト付きで実装済みだが、**それは捨てる理由にならない**。
判断の軸は「ShogiHome と張り合えるか」ではなく「将棋AI開発者の需要を取れるか」（→ `PREMISES.md` P-008）。
`.sbk` の仕様把握には ShogiHome の `src/background/book/sbk.ts` が参考になる。
**`.db.bin` は実在しないフォーマットなので #103 / #104 で拡張子を数えるときは注意すること**
（やねうら王のバイナリ定跡は `.ybb`）。

## 棋譜内しおり（#118）

「この棋譜の山場」を手にマークする機能。課題局面（study positions）とは別物。
判断: 注釈機能（marks / file-meta）の設計が未決着なので、それを決めるまで着手しない。
（「2系統に分裂」は誤りと判明している → `research/findings/L0-annotation-implementations.md`）

## #120 の積み残し（構造）

レビュー3ラウンドで「別 issue に送る」と判定した所見のうち、**失敗経路以外**のもの。
失敗経路に関わる分は #157 / #158 として issue にした。以下は構造的な負債で、
単独で着手する価値がまだ判断できていない。

- **局面の同一性キーが3系統3粒度ある** — Rust の `position_key_from_sfen` にまで及ぶ。
  横断検索は `PositionKey`(SFEN由来)、棋譜内は `tesuuPointer`、解析はまた別。**触るなら一度に揃える**
- **`tesuuPointer` の生成が3箇所に重複** — `CLAUDE.md` は「`indexOf(",")` によるパースの重複」と
  書いているが**該当0件**。実在するのは生成側の重複。記述を直すこと
- **`entities/` の公開境界が10スライス中2つ欠落** — 揃えるには3段階の順序が要る
- **`ModalType` union が上位層のスライス名簿を持っている** — 下位層が上位層の一覧を知っている
- **Rust `open_project` にコマンド層・ドメイン・IO が同居**（144行）

**状態遷移表を他のモジュールに広げるかは未決。** いまは非同期・並行・外部プロセスが絡む箇所に
限って使う道具であって、規約ではない。

---

## 未 issue のアイデア

- **合流 / transposition を DAG として扱う** — ShogiHome issue #236（30コメント。**コメント数は2位で、ユニーク参加者は2名** → `research/findings/L2-transposition-demand.md`）が「木構造では千日手や局面の合流に対応できない、グラフを直接可視化・編集したい」と要求し未解決のまま。KIF/KI2/CSA いずれも仕様として合流を持たない。横断検索側は `PositionKey`(SFEN由来) なので既に合流に強く、棋譜内表現だけが木。**差別化の最有力候補**だが、着手前に現行 `normalizedTree` の設計影響を調べること
- **「ShogiHome で開く」導線** — エンジン/対局/検討 GUI を自前で磨くより価値が高い可能性
- **棋譜ブログ向けの出力** — ShogiHome #1271（複数棋譜横断の一括局面図）が 2025-07 から open のまま
- **`AsyncResult` のラチェットが、深いプロパティ経路の呼び出しを見ていない** —
  `src/__tests__/asyncResultUse.test.ts` の `bareCallOf` が拾えるのは `await f(` と
  `await obj.f(` の2形だけ。`await a.b.c(` と `await a!.b(` は素通りする。
  いま素通りしている 15 行は全て test か `AsyncResult` を返さない呼び出し
  （`navigator.clipboard.writeText`）なので**本番のコードで漏れているものは無い**が、
  緑を「戻り値を捨てている箇所は無い」と読める状態ではない。
  **正規表現を1箇所広げるだけでは済まない**——広げた瞬間に 15 行が赤くなり、
  1件ずつ「読むべきか、免除の注記を付けるべきか」を決めることになる。まとめて着手するときに
  1度で決めること

## SCSS の既存の負債（`refactor/app-shell-wiring` のレビューで出たもの）

`.claude/reviews/2026-09-06-app-shell-wiring-r1.md` の ui reviewer が挙げたもの。
**その PR は SCSS を1行も触っていない**ので範囲外にした。どれも単独では
着手する価値を判断できていない。

- **`--kifu-w` が2ファイルで別の意味で定義されている** — `.kifu` が自分の上で
  `29rem` を再定義するので `.workspace` の `clamp(...)` は内側では見えない。
  1280px 幅で約4rem ずれる。`.kifu` を別の場所に置いた瞬間に 29rem 固定へ戻る
- **`AppLayout.scss` が widget のルートクラスを名指しで上書きしている** — 打ち消しに
  見える `border` / `box-shadow` / `background` は元の宣言が無く、何も打ち消していない。
  寸法の契約が page と widget の2ファイルに割れている
- **解析ペインの `--active` が効かない** — `.analysis-header__icon` が svg に直接
  `color` を宣言していて親の `color` が継承に負ける。オン状態の表現も
  「クラス」「`aria-pressed` だけ」「アイコン差し替え」の3通りに割れている。
  向きのトグルは `?pov=gote` が付いていても見た目が素の状態と同じ
- **閉じたサイドバーの `transition` が一度も走らない** — 実際に変わるのは親の
  `grid-template-columns` と登録されていないカスタムプロパティで、どちらも遷移しない。
  仕切り線もスロットと `.sidebar` の2箇所で別々の直値で引かれている
- **メディアクエリの breakpoint が13種類の直値で散っている** — 対象幅（1280px 以上）では
  1つも発火しない。共有の定義が `src/index.scss` に無く、`scssScale` のラチェットも
  `@media` の条件部を対象外にしている
- **解析ペインの帯の右余白だけがコンテナの幅に比例する** — `padding-right: clamp(4rem, 18%, 20%)`
  で、ペインを広げるほど道具の並びが中央側へ寄る。左は `4rem` 固定で非対称。
  **なぜ右だけ空けるのかが現物からも履歴からも復元できない**（`419bd5df` で `20%` として
  登場し、`cc8ec2d4` で軟らかくなったが、どちらのメッセージにも理由が無い）。
  避けている相手があるのか、見た目の判断なのか、名残なのかが読めないので**動かせない**。
  #113 の C18 が「この余白の『なぜ』を書く」を予定していたが、
  **推測で「なぜ」を書くのは腐ったコメントを1つ足すのと同じ**なので書かずに残した

## `.tsx` のインライン直値が、どのラチェットにも数えられない（#436 のレビューで出たもの）

`.claude/reviews/2026-09-08-436-error-boundary-layers-r1.md` の r1-21（ui reviewer）。
**その PR では直値そのものを消した**ので、走査は要らないまま残した。

- `scssScaleRatchet` も `contrastRatchet` も `scssFiles(SRC)`（`.scss` だけ）を歩く。
  `tsFiles` を歩いて `style={{` の中の長さ・色リテラルを数えれば、「ここだけは直値でよい」という
  例外が意図した数に留まっていることを機械で保てる。**いまは例外が無言で増やせる。**
  実測は ADR-0003 の「諦めるもの」が持つ

## 到達しない分岐が `Board` に残っている

`.claude/reviews/2026-09-06-app-shell-wiring-r2.md` の r2-10 の付随（ui reviewer）。
**SCSS の話ではない**ので上の節とは分けてある。

- **`Board` の「盤面を読み込み中...」は到達しない** — `AppLayout` の `hasKifu` が同じ `view` を
  見て分岐しているので、`Board` が描かれた時点で `player?.shogi` は必ずある。しかも
  `.board-loading` の CSS 規則はリポジトリに1つも無く、ビルド後の CSS にも出ない。
  **仕様の側は直してある**（`docs/spec/screens/board.md` の P0 の※）。残っているのは
  分岐そのものを消すかどうかで、消すなら `GameView` の `hasKifu` の `?.shogi` と
  一緒に決めることになる

## 呼び出し元の無い公開 API が、スライスの barrel と context に残っている

`.claude/reviews/2026-09-06-app-shell-wiring-r3.md` の r3-17（architecture reviewer）。
`entities/file-tree/index.ts` は「ここに並ぶのはスライスの外に呼び出し元があるものだけ」を
規約として書いているが、機械が見ていないので守られているのは一部だけ。

- **barrel と context に、呼び手のいない口が残る。** `entities/search/index.ts` は
  型を中心に約30名を公開していて、スライス外の消費は7名。
  `sliceBarrels.test.ts` は「barrel が在ること」しか見ておらず、
  **未使用の export を数える走査は無い**。足せば落ちる
- **閉じるなら走査ごと入れる。** `src/__tests__/sliceBarrels.test.ts` の `publicModules()` に
  「公開する名前ごとにスライス外の出現があること」を足せば barrel 側は落ちる。
  `model/types.ts` の context インターフェースまで広げれば context 側も同じ形で落ちる

- 局面検索の「1つの検索」という単位が `entities/search` に無い。rid・撃ち直しの重複除け・取り下げ・破棄は `features/position-search/model/useSearchSession.ts` にまとまったので、`entities/search` に2つ目の呼び手が出たらそのまま下げられる

## 公開リポジトリとしての体裁が、配布物とドキュメントで揃っていない

`.claude/reviews/2026-09-07-441-unmount-session-r6.md` の所見（oss-hygiene）。
#441 の範囲外として持ち越した。**どれも `main` から在る。**

**判断: 6週間以内に着手しない。** 利用者に見える不具合ではなく、
公開の体裁（画像・前提・帰属）は T1 の機能が落ち着いてからまとめて直す方が安い。
帰属表示だけは配布を増やす前に要る——**Releases を人に配り始める回**が着手の合図。

- **README のトップ画像が古い。** 解析ペインのヘッダはボタン5つで、🔖（課題局面）が写っていない。
  仕様（`docs/spec/screens/analysis-pane.md`）と実装は6つ。README の Features にも
  課題局面が無いので、画像・機能一覧・仕様が揃って1機能を落としている
  （CONTRIBUTING は両方必須と書いている）
- **手元でビルドする前提が足りない。** Tauri の Linux 依存（`libwebkit2gtk-4.1-dev` ほか）は
  `.github/workflows/ci.yml` にしか無い。README と CONTRIBUTING の「前提」は
  同じ3行が二重にあり、片方だけ直すとまた食い違う
- **第三者コードの帰属表示が配布物に無い。** `src-tauri/Cargo.toml` は
  `license = ""` / `authors = ["you"]` / `description = "A Tauri App"` の雛形のままで、
  `package.json` にも `license` が無い。MIT / BSD 系はバイナリ配布でも著作権表示を求める。
  **`public/` に、どこからも参照されていない画像2枚が同梱されている**（`駒箱.jpg` /
  `kaya.jpg`）。`knip.json` の走査は `src/**` だけなので機械でも見つからない

**フォントは別**（→ #503）。`index.html` が読む Google Fonts は、アプリ自身の CSP に
オリジンが無いので**配布物では1本も読めない**。dev サーバには CSP が乗らないため
開発中と字面が違う。体裁ではなく不具合なので issue にしてある。

### 着手の合図は、もう過ぎている

`.claude/reviews/2026-09-07-441-unmount-session-r29.md`（oss-hygiene）。
上は「**Releases を人に配り始める回**が着手の合図」と書いているが、実測では
v0.1.0（2026-02-27）から v0.2.1（2026-03-21）まで**9本が既に公開済み**で、
README がそこへ利用者を誘導している。**帰属表示の判断は据え置けない。**

同じラウンドで挙がった、上に無いもの。

- **`CODE_OF_CONDUCT.md` に報告の連絡先が無い。** 「リポジトリ所有者に連絡」としか
  書いておらず、GitHub に非公開 DM は無い。公開 issue を立てさせるのは同じ文書の
  「報告者の身元は秘匿されます」と矛盾する。`SECURITY.md` の窓口を流用できる
- **CI が `verify` と同じものを走らせていない。** `test:hooks` と `ratchet:rustdoc` が
  抜けているので、`CONTRIBUTING.md` が「手で流してください」と書いた2つは
  誰も流さなければ緑のまま通る
- **`docs/` に索引が無い。** 直下に運用の記録（`IDEAS` / `PREMISES` /
  `OPEN-QUESTIONS` / `OPERATING-MODEL`）と利用者向け（`spec/`）が並び、
  アルファベット順で最初に来るのが「やらないこと置き場」
- **Rust の版が3箇所で違うことを言っている。** README と CONTRIBUTING は `stable`、
  `rust-toolchain.toml` は固定、`Cargo.toml` の `rust-version` は雛形の既定値
- **画面仕様2本が、`.gitignore` された `.claude/plans/` を設計の出典に挙げている。**
  外部の人は辿れない
- **`AGENTS.md` が `vp install` を指示している。** README / CONTRIBUTING は
  `npm install` で、`vp` はグローバル導入が前提の綴り

**ここに並べたものは issue にしない**（`docs/OPERATING-MODEL.md`）。着手すると決めた
時点で昇格すること。

## `entities/ai-library` の `api/` を barrel に載せるか

`.claude/reviews/2026-09-07-441-unmount-session-r12.md` の所見17（architecture）で、`entities/engine` の
`api/` が barrel を通さずに読まれていると出た。エンジン横断の棚卸し（`docs/audits/2026-11-engine.md`）で、
読まれていたもののうち `aiLibrary` は `entities/ai-library` へ、`setPositionFromSfen` は `entities/analysis` へ移し、
`probeEngine` は `entities/engine` の barrel から出した。`entities/engine` へ深く入る import はもう無い。

残るのは `entities/ai-library` で、barrel を持たず `features/settings` が深く読む。`sliceBarrels` は
barrel を持つスライスしか縛らないので、いまは何も検査されていない。

**判断: 6週間以内に着手しない。** 利用者に見える不具合ではない。

- **(a) `api/` を境界として認めて barrel に載せる。** 載せたモジュールの deep import が
  その瞬間に `sliceBarrels` の違反になる（`vi.mock` を含むファイルは免除）
- **(b) `api/` を非公開のままにする。** スライスを跨ぐ語彙は
  跨がせず、呼び手側が自分で持つ。IPC の境界の型が緩む

## エンジン横断の棚卸しで送った、振る舞いの変わる直し

`docs/audits/2026-11-engine.md`（基点 20b74095）で見つけ、振る舞いか画面の文言か線の文言が変わるので、
構造の整理の PR に混ぜなかったもの。根拠と場所は ID でそちらを引く。**判断: 6週間以内に着手しない。**
第3範囲（オプションの部品）を始めるなら、R-15 だけは先に取る。

- **B-9** 対局の失敗の文（`GameResult.detail`、`start_game` の `Err`）に USI の語が乗って線を越える。故障の種類を型にする
- **B-14** 検討の停止の `by` を Rust が任意の文字列で受ける。serde の列挙にし、知らない値を断る
- **B-15** TS の呼び手が0の検討のコマンド3つ（`get_analysis_result` ほか）と、それが読む欄。線の名前なので消すかを決める
- **R-15** TS が USI の名前（`MultiPV` の写し、`Threads`、`USI_Hash`）を綴る。カードの見出しを Rust の辞書に揃える
- **R-12 / R-13 / R-14** 「中止」の判定、中止の文、ボタンの語が `entities/engine` と `entities/analysis` と widget に割れる
- **R-16 / R-17** 候補手の数の欄が `fitSpin` を通らない。帯の「設定を開く」が `useOpenSettings` を通らない
- **D-4 / D-5** 評価関数の優先の規則と、保存するプリセットの正しい形が2か所にある
- **W-7 / W-8 / W-9** 同じ種類を2語で言う文言、画面に出る英語の `New Preset` と `(copy)`、カードの英語の見出し
- **C-2 / C-5 / C-6** `EngineAction` の部品と型の同名、`startInfiniteAnalysis` の同名、`engineKey` の2つの値
- **P-5** `isPresetConfigured` と `bookInUse` が `entities/engine-presets` の型のファイル（`model/types.ts`）にある

## 貼った棋譜を打鍵のたびに読み直している

`fix/create-file-import-face` のレビュー（perf reviewer）。`useKifuImportDraft` は
`rawContent` が変わるたびに `readKifuText` を同期で呼ぶ。実測（Node v26、この repo の
tsshogi 2.3.x）で **KIF 1KB あたり約 0.47ms**、総手数に線形。

| 入力                     | 大きさ | 1回のパース |
| ------------------------ | ------ | ----------- |
| 300手・分岐なし          | 9.6KB  | 5.7ms       |
| 300手 ＋ 変化50本×10手   | 26KB   | 13.2ms      |
| 300手 ＋ 変化200本×10手  | 72KB   | 35.3ms      |
| 300手 ＋ 変化1500本×10手 | 479KB  | 226ms       |

**問題になるのは手数ではなく変化の本数。** 総手数800手（約32KB）を跨ぐと打鍵ごとに
1フレーム落ちる。貼るのは1イベントなので体感に出るのは**貼ったあとに打ち足したとき**で、
研究用の分岐付き棋譜は容易にこの域に入る。

直すなら2段階。(1) 直前に読んだテキストを覚えて、`trim()` が同じなら読み直さない
（末尾に改行を足しただけでも全文を読み直している。仕様への影響ゼロ）。
(2) trailing debounce を 100〜150ms。貼り付けは1イベントなので体感は変わらない。
**仕様書の「貼った瞬間に読む」とは矛盾しない**（150ms 後に出る）。

固定するなら `vi.mock` で `readKifuText` の呼び出し回数を数え、fake timer で
連続した `change` が1回にまとめられることを見る。

## 棋譜を作る3つのフォームで、同じ語が3通りに割れている

同じレビュー（comment / architecture reviewer）。`SfenKifuCreateModal` だけが
「フォーマット」「保存先フォルダ」「キャンセル」を名乗る（他の2つは「形式」
「保存先」「やめる」で、仕様書の語彙表もそちら）。仕様書の表も
`create-file.md` の中で割れている。

**2:1 になったので、どちらが正かがコードから読めない。** 寄せるなら
`label="フォーマット"` / `label="保存先フォルダ"` を禁じる綴りの走査で再発を止められる。

## feature の SCSS が shared の部品の内部クラスを掴んでいる

同じレビュー（ui / architecture reviewer）。`KifuImportForm.scss` は
`.form` / `.form__group--buttons` / `.form__textarea` を子孫セレクタで掴み、
`PositionEditor.scss` も同じことをしている。**依存はどこにも宣言されない** ——
`shared/ui/Form` の DOM 構造が変わると、この2つのフォームのレイアウトだけが静かに崩れ、
lint もテストもラチェットも赤くならない。

件数ラチェット（`src/shared/ui/**` の外の SCSS が `.form` / `.notice` / `.fsError` /
`.modal` で始まるセレクタを書く数）なら今日から張れる。0 にはできないので
`knip-ratchet.sh` と同じ「増える方向にだけ落とす」形。

## 自動再開に、差の出る筋を組めていない門が2つある

`.claude/reviews/2026-09-07-441-unmount-session-r29.md`（react reviewer）。
`provider.tsx` の追従 effect にある `bookIfRestarting()` と、`runRestart` の
`sentSfenRef` の門。**3ラウンド続けて、落としても全テストが緑になる筋しか作れていない。**
落とすのは危ない（差が無いことを示せていないだけで、無いことの証明ではない）が、
「効いている」と読める根拠も無い。**#489 で自動再開の8本の ref を切り出す回に、
機構ごと見直す対象として拾うこと。**

## `useEngineSeat` から、席を返すスロットの管理を割る

`.claude/reviews/2026-09-09-441-unmount-session-r33.md`（architecture reviewer）。
このフックは2つのことをしている——**席を取る/手放す**（`beginTake` /
`keepOrForget` / `sendStop`）と、**返却を1本ずつに並べるスロット**（`holdSlot` /
`queueBehind` / `foldIntoSlot` / `sweepOnUnmount`）。後者は前者を知らなくても書ける。

`useReleaseSlot` として割れば、スロット側だけを単体で固定できる。いまはスロットの振る舞いを
見るテストが席の生死をぜんぶ組み立ててからでないと書けない。

責務の割り方の判断であり、#441 の欠陥とは独立している。**同じ PR に混ぜると
差分が読めなくなる**ので送る。

## 辿った局面を、綴りを経由せずに定跡の鍵にする

#95（定跡ビュー）のレビュー（perf reviewer）。実測は release / aarch64 macOS、
実物の定跡 `user_book1.db`（11.3 MB / 111,176 局面）。

`walk_line` は1手ごとに `position.to_sfen_owned()` で綴りを作り、
`to_book_key` がそれを読み直して盤・持駒・駒数を検査し、同じ文字列を組み立て直す。
**1手あたりの時間の 65%、確保の 61%** がこの作り直しに乗っている
（16.5 回の確保のうち 10 回、2.15us のうち 1.37us）。

`to_sfen_owned()` の出力は既に正規形で、**実物 111,176 局面すべてで
手数トークンを落としただけの綴りが `to_book_key` の結果と1件もずれない**（ずれ 0 件）。
`sfen/key.rs` に3つ目の入口（`PartialPosition` → `BookKey`、確保1回）を足せば消える。

同じ回に、`BookReader` へ「先頭の1手の綴りだけ」を返す口を足すと、
`lookup` が候補手を丸ごと複製して2本目以降を捨てている分も消える
（1手あたり 候補手1本につき +0.066us。局面に 26 手あると他の全部と並ぶ）。

**実物の分布（平均 1.04 手 / 最大 5 手）では画面に出ない**ので送る。
効き始めるのは1局面に数十手を書く定跡で、そちらの上限と中断は #577。

## パスの末尾と親を取る実装を1つに寄せる

#95（定跡ビュー）のレビュー（architecture reviewer）。
`Math.max(lastIndexOf("/"), lastIndexOf("\\"))` の手書きが
`entities/book/lib/recents.ts` / `features/file-conflict/ui/ConflictMeta.tsx`
ほかに散っている。
`shared/lib/path.ts` は既に在る。

同じ知識（区切りは2種、末尾区切りの扱い、`at === 0` のときに何を返すか）が
層をまたいで散っていて、差も既にある（`bookParentPath` は `at <= 0` で `""`、
`ConflictMeta` の `dirname` は先に末尾区切りを落とす）。

走査は書ける（字面の出現数を現在値で固定する件数ラチェット）が、
**集約が先**。ラチェットだけ張ると、寄せ先が無いまま赤くなる。

## 「ホバーの目印＝押せる」を design-language に書く

#95（定跡ビュー）のレビュー（ui reviewer）。
ドックの隣り合うタブで、同じ濃さのホバーの塗りが片方は「押せる」、
片方は「押しても何も起きない」を意味していた（#95 では定跡側を下線に替えた）。

**対応そのものがどこにも綴りとして無い**ので、次に表を足す人は同じ判断を
その場でやり直す。`docs/spec/design-language.md` の「3. 色」か新しい節に、
背景の塗り・下線・`cursor` のどれが何を意味するかを書く。

あわせて、`:disabled` の薄さがリポジトリ全体で
0.25 / 0.35 / 0.4 / 0.45 / 0.5 / 0.52 / 0.55 / 0.6 / 0.66 の9通りに散っている。
1つ選んでトークンにすれば、`scssScaleRatchet` と同じ形の件数ラチェットが張れる。

## `pickBookFile` を `entities/book` へ移す

#95（定跡ビュー）のレビュー（architecture reviewer）。
定跡の4拡張子（`db` / `bin` / `sbk` / `ybb`）が `shared/api/picker/` に手写しされていて、
受理集合を決めている実装（`src-tauri/src/book/types.rs` の `from_path`）とは別の場所を
出典として指している。形式を5つ目にすると、`from_path` を直すだけでは選べるファイルが
増えない。

`shared/` には汎用の口（`pickFile(title, filters)`）だけを残し、定跡の語彙は
`entities/book/api/` へ移す。隣の `pickDirectory.ts` は `title` を引数で受ける
完全に汎用の口で、この2つは同じ棚に並ぶものではない。

走査も書ける（`from_path` の `Some("...")` と `extensions: [...]` の突き合わせ。
どちらも固定の1ファイルなので誤検知が出ない）。

## 設定ファイルの書き込みまわり（D1 のレビューで出たもの。2026-09-27）

- **`atomic_write` の一時ファイル名が固定**（`<名前>.tmp`。`crates/fs/src/write.rs`）。同じファイルへ2つの
  書き手が同時に書くと、同じ一時ファイルを切り詰め合う。アプリのウィンドウは1枚なので同じプロセスの中では
  起きない。多重起動を防いでいるかは確かめていない
- **読めない設定ファイルを退避する仕組みが2つ**（`app.json` は `back_up_broken` で `.broken[.n]`、
  判定は TS。プリセットは `presets.rs` の `unused_path` で `.unreadable-<時刻>.json`、判定は Rust）。
  3つ目の設定ファイルを足すときに、どちらに倣うかを決めて寄せる。`app.json` 側は 99 個で上書きする
- **プリセットの重複した `id` を読み込みで採番し直し、次の保存でそのまま書く**
  （`normalizeLoadedPresets`）。`last_preset_id` などの参照が外れる。手で編集したファイルでしか起きない

## 評価関数・定跡の流し先で、判定表に載せていない形（F のレビューで出たもの。2026-09-27）

判定表は `docs/state-transitions/option-binding.md`。

- **`EvalDir` / `Eval_Dir` のエンジンで、選んだファイルの名前が送られない**（E3 / E4 は親のフォルダだけを送る）。
  フォルダの中に評価関数が2つあると、エンジンは自分の決めた名前（やねうら王なら `nn.bin`）を読み、
  利用者が選んだ方は読まれない。`EvalFile` 相当の名前を併せて申告するエンジンがあるかを実機で確かめてから決める
- **`DNN_Model` と `EvalDir` を両方申告するエンジン**（ふかうら王と見ている。実機の申告は取っていない）では、
  E1 が当たってファイルを `DNN_Model` に送り、`EvalDir` は送らない。それで読めるかは確かめていない
- **欄の名前が意味と合っていない**: プリセットの `bookEnabled` は「定跡を使うか」（解析と定跡ビューの両方。`bookInUse`）、
  `evalFilePath` はフォルダも入る。版を上げる変更と一緒に改名する（G の画面の作り直しで版を上げるなら、そこで）

## プリセット編集の置き場と分け方（U2 のレビューで出たもの。2026-10-04）

`.claude/reviews/2026-10-04-preset-dialog-b.md`（architecture）。

- **`fileLabel` が AI ライブラリの配置（`<名前>/eval|book/<file>`）を知っている**のに `features/settings/lib` にある。
  配置を変えると、表示だけが黙ってファイル名に落ちる。`entities/engine` に下げ、分解は `shared/lib/path.ts` に寄せる（#216）
- **「やめる」は Rust の取得を止めない**（上限まで動く。`probeEngine` の doc）。開くたびに読み込むので、
  応答しないドライブでは開いて閉じるたびに1本ずつ残りうる

## `GameManager` と `EngineRegistry` の語を揃える（#364 から。2026-10-31）

`GameManager` と `EngineRegistry` はどちらも ID で引く一覧（registry）だが語が違う。`registry.rs` は検討側からも使うので差分が対局の外へ出る。語を揃える利得に対して差分が大きく、やらない判断もありうる。
