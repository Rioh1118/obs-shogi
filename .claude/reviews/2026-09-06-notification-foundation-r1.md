# レビュー notification-foundation ラウンド1

- 日付: 2026-09-06
- 範囲: `git diff origin/main...HEAD`（22ファイル / +1605 -18）。#277 の通知基盤
- 対象コミット: `173bdc81`
- 走らせた reviewer: architecture / react / ui / robustness / comment / perf / oss-hygiene（7観点、絞らず）

変更の性質は `/implement` の**重**（失敗経路・`shared/`・レイヤをまたぐ import の増加）。

## 所見

深刻度順。同じ根から出たものは1つに束ね、指摘した reviewer を全部添える。

### BLOCK

無し。

### HIGH

#### H1. `autoDismiss` が見せ方を見ておらず、`banner` / `modal` も6秒で消える

architecture / react

- `types.ts:68-74` は「`toast` にだけ効く」と書いているが、`provider.tsx:69-71` は `presentation` を見ない
- ADR-0004 の割り当てで `banner` には F-8（`fatal`「アプリを再起動」）が載る。**消えてはいけない段が黙って消える**
- `modal` は `find` で1枚ずつ出すのに時計は出ていない2枚目にも走るので、**一度も画面に出ないまま消えうる**
- 直し方: `NotifyRequest` を `presentation` で判別する union にして `autoDismiss` を `toast` の枝にだけ置く。tsc が弾くので provider 側の防御も doc の但し書きも要らなくなる

#### H2. modal 経路の `Notice` に key が無く、前の通知の失敗文が次に残る

react（再現を確認済み: `DIALOG TEXT: 2枚目1件「再試行」を実行できませんでした。`）

- `NotificationLayer.tsx:58-68`。banner と toast は `key={n.id}` があるのに modal だけ無い
- modal は「1枚だけ」なので**2枚目は1枚目が消えた瞬間に同じ位置に入り、React が再マウントしない**。`Notice` の `actionError` / `running`（`Notice.tsx:59-60`）が持ち越される
- 直し方: `Notice` に `key={modal.id}`。**`Modal` 側に付けない**（`useOverlayLayer` の push/pop と `restoreTo` が入れ替わる）

#### H3. `foldInto` が actions を差し替えると、押していないボタンが busy かつ disabled になる

react（再現を確認済み: `BUTTONS AFTER FOLD: [["エンジンを再起動","true"],["",null]]`）

- `running` は**添字**（`Notice.tsx:59`）で `isLoading={running === at}`。`foldInto`（`reducer.ts:55`）は actions を配列ごと差し替えるが id は動かないので再マウントしない
- 「再試行」が返らないまま同じ鍵の通知が来ると、一度も押していない「エンジンを再起動」が `aria-busy` かつ `disabled`（`Button.tsx:54`）になる。**エンジンが死んでいる＝通知が出た理由そのものの場合、唯一の復帰導線が永久に押せない**
- 直し方: `running` を添字でなく action の同一性で持つ。`actionError` も `{ action, message }` にして `actions.includes` のときだけ描く

#### H4. モーダルの overlay が通知を覆い、押せなくする

robustness

- `.notice-layer` は 9998、`.modal__overlay` は 9999（`Modal.scss:22`）＋ `backdrop-filter: blur(4px)` ＋ 半透明の面。`#modal-root` はスタイルを持たない素の div なので単純に 9999 が勝つ
- 設定モーダルを開いている最中に F-9 の帯が出ると、**帯はぼけて読めず、「設定を開く」を押したつもりのクリックが overlay に当たってモーダルが閉じる**（編集中の入力ごと消える）
- 層の root は既に `pointer-events: none` なので、**上げてもモーダルの操作は塞がらない**。「モーダルを閉じる手段が隠れる」という現行コメントの理由は pointer-events で既に解けている
- 直し方: `.notice-layer` を overlay より上げる。`src/__tests__/modalOverlayTitlebar.test.ts` が既に SCSS をコンパイルして値を読む器を持っているので、大小をそこで固定する

#### H5. トーストが更新カードの操作ボタンを覆う

ui

- `UpdaterScreen` は `document.body` へ portal され、`bottom: 2.4rem / right: 2.4rem`・幅 `30rem`・`z-index: 9000`（`UpdaterScreen.scss:4-10`）
- トーストの入れ物は層の右下・幅 `36rem`・`padding: 1rem`・`z-index: 9998` で、**横は完全に、縦は下端から約 7rem を占めて `updater-card__actions` に被る**
- 入れ物が `pointer-events: auto` を箱全体（padding を含む）に持つので、「今すぐ更新」「後で」「再起動して適用」が押せなくなる。`autoDismiss` の既定は `false` なので**利用者がトーストを閉じるまで戻らない**
- 直し方: 最低限 `&__toasts { pointer-events: none }` ＋ `> .notice { pointer-events: auto }` にして padding が下を握る状態を外す。根本は右下の角の持ち主を1つに決めること（#432 と関連）

#### H6. 通知モーダルが `scroll="none"` で、本文が伸びると動作ボタンへ到達できない

ui

- `NotificationLayer.tsx:59` の `scroll="none"` ＋ `Modal.scss` の `&--scroll-none { overflow: hidden }`、`--size-sm` は `max-height: min(80vh, 100%)`
- `Notice` は本文を切り詰めない方針で、動作ボタンは本文の**下**。本文が 80vh を超えると `fatal` の「アプリを再起動」が画面外に落ちて押せない。`tauri.conf.json` に `minHeight` が無いので、縦に縮めれば数行でも同じ
- **同種の既存ダイアログは逆の選択をしている。** `KifuReadErrorDialog.tsx:55` と `FileConflictDialog.tsx:79` はどちらも `scroll="content"`
- 直し方: `scroll="card"` か `scroll="content"` に変える

#### H7. 溢れた側に積むので、いちばん新しい通知が一度も画面に出ない

robustness

- `notifications` は末尾に push（`reducer.ts:82`）され、層はその順で `map`。両方の箱の `scrollTop` 初期値は 0 で、**見えているのは古い方**
- F-11 が10件続けて失敗して箱が上限に達すると、11件目以降と、その後に出る `fatal` も下端の外に描かれ**一度も見られない**
- 「高さで上限を置く」設計自体は成り立っているが、巻き取った先が常に新着側になっている
- 直し方: 新着が可視の端に来るように並べる。happy-dom では高さを測れないので、**DOM の並び**（最後に `notify` したものが箱の最初の子）をテストで固定する

#### H8. 動作を押した直後に自動で消えると、その動作の失敗が一切出ない

robustness

- `NotifyRequest` は `autoDismiss: true` と `actions` の同時指定を許す。5.5秒で押す → 6.0秒で `dismiss` → `Notice` が unmount → 6.5秒に reject → **画面に何も残らない**
- 利用者に見えるのは「押したらトーストが消えた」だけで、成功と失敗が区別できない。`Notice.test.tsx:102-120` が固定した「握り潰さない」がこの並びでは成立しない
- 壁時計なので、**別アプリを見ている6秒の間に出て消えた通知は痕跡が無い**
- 直し方: H1 の union で `autoDismiss` と `actions` を同時に書けなくする（ADR-0004 で `autoDismiss` は F-13 の1件だけで、そこにボタンは無い）

#### H9. 動作が失敗したときの表示に原因も次の一手も無く、例外は完全に捨てられる

robustness

- `Notice.tsx:78-82` の `catch(() => {...})` は引数を受け取らないので、**reject 値も例外もどこにも残らない**（console にも state にも行かない）
- 出るのは「「エンジンを再起動」を実行できませんでした。」の1行だけ。次に何をすればよいかが無く、同じボタンを押し続けることになる——ADR-0004 が「押しても直らない失敗に動作を付けない」と決めた状態を**基盤自身が作っている**
- 直し方: `NotifyAction` に利用者の言葉で書く `failureBody` を足して `actionError` の下に出す。原因は `console.error(e)` で別に残す（見える表示があるので握り潰しにならない）

#### H10. 過去の実装を語るコメントが残っていて、しかも現物と食い違う

comment

- `NotificationLayer.tsx:12-14` の「手書きは既に1回失敗していて、唯一の読み手がツリーごと消す実装になっていた」
- 「〜になっていた」は `CONTRIBUTING.md`「変更の経緯を書かない」の禁止形で、`commentHistory` が拾わない書き方
- **しかも現物と合っていない。** `FileTree.tsx:216-235` は `shownError && !hasTree` のときだけツリーの代わりに出し、ツリーがあるときは 240 行以降でモーダルに出す（台帳 `:60,89` も「ツリーは残したままモーダル」と書いている）
- 直し方: 2文とも消し、現在の理由だけ残す

#### H11. `InlineNotice` の TSDoc が型で保証していないことを断言している

comment / architecture

- `InlineNotice.tsx:4` の `Omit<NoticeProps, "count" | "className">` は `onDismiss` を落としていないので、`<InlineNotice onDismiss={...} />` が通って ✕ が出る
- 押しても状態は直っていないのに通知だけ消える——**そのコメントが警告している事故が、コメントを信じた読み手のすぐ隣で起きる**
- 直し方: `Omit` に `"onDismiss"` を足す

### MEDIUM

#### M1. `silent` が可視の通知とまったく同じ形で書けるので、事故で黙らせても痕跡が残らない

architecture / robustness

- `tier` を直し忘れる／デバッグで一時的に `"silent"` にしたまま出す → 型は通り、reducer は同じ state を返し、戻り値も無い。**`catch {}` と外形が同じ**
- ADR-0004 の割り当てで F-16 の見せ方は `—` なのに、いまは `presentation` を必ず書かされる（テスト自身が silent に toast を持たせている: `provider.test.tsx:129` / `reducer.test.ts:40`）
- 直し方: `{ tier: "silent"; reason: string }` の枝に割る。「なぜ出さないか」を書かないとコンパイルが通らなくなる。H1 の union と同じ変更で片付く

#### M2. context が「出す口」と「出ているもの」を1つに束ねている

perf（実測: `notify` しか使わない consumer が `1 → 2` 描画。context を読まない兄弟は 1 のまま）/ react / architecture

- `provider.tsx:38-41`。`notify` / `dismiss` / `dismissByKey` は `useCallback([])` で不変なのに、`state.notifications` と同居しているので値の同一性が通知の増減で必ず変わる
- 実測: 同一タスク内の50連発は React のバッチで1描画、**タスクを跨ぐ50連発は50描画**。F-15（SFEN のパース失敗）の発火元 `sfenConverter.ts:19` はエンジンの読み筋の変換経路にあり、MultiPV=5 なら毎秒10〜50回
- **いま呼び出し元は `NotificationLayer` 1つだけなので実害ゼロ。呼び出し元が20個に増えた後では PR が大きくなる**
- 直し方: context を2つに割る（actions は `useMemo(..., [])` で生涯不変、list は `state.notifications` を素で）

#### M3. `mounted` ref は React 19 では何も守っていない

react

- React 18 以降、unmount 済みへの `setState` は no-op で警告も出ない。`Notice.tsx:62-70` を消しても振る舞いは1ビットも変わらない
- コメントは「外れているときに何かを防いでいる」と読ませるが、守ろうとしている経路のうち**modal では `Notice` はアンマウントすらしない**（H2）
- 直し方: ref と effect を削る。H2・H3 を入れれば想定していた事故はそちらで実際に塞がれる

#### M4. 畳むと復帰手段が消えることがある

robustness

- `foldInto` は全欄「最後が勝つ」で `actions` も例外ではない。同じ鍵で動作を添えずに `notify` すると、**表示は残ったままボタンだけ消えて件数が増える**
- `tier` の上書きには理由がコメントにあるのに、`actions` の上書きは意図か副作用かコードから読めない
- `reducer.test.ts` の畳みの節は `actions` を1つも見ていないので、どちらへ変えても緑
- 直し方: どちらかに倒してテストで固定する

#### M5. 読み上げ用の領域を中身と同時にマウントしている

robustness

- `role="status"` は**既に文書に在る領域の中身が変わったとき**に読まれる。ここでは領域と本文が同じコミットで挿入されるので、`info` / `warning` が読まれるかは実装依存
- 直し方: 常時マウントの `.notice-layer` の中に `aria-live="polite"` の視覚的に隠した領域を1つ置きっぱなしにし、通知が増えたときに文字を流し込む

#### M6. 動作を押すとボタンが `disabled` になり、キーボードの居場所が失われる

robustness

- `Modal` はこの経路を知っていて `Modal.tsx:85-98` で引き戻すが、**トースト／バナー／インラインには引き戻しが無い**
- 通知は `#modal-root`（文書の末尾）にあるので、フォーカスが `<body>` へ落ちるとアプリ全体を Tab で辿り直さないと理由に戻れない
- 直し方: 走行中も `disabled` にせず `aria-busy` だけにし、二重起動は `invoke` の先頭で弾く

#### M7. z-index が直値で4〜7ファイルに散り、関係がコメントの写しでしか担保されていない

ui / architecture / robustness

- 実測値: 9000（updater）/ 9998（通知）/ 9999（Modal / TitleBar）/ 100000・100001（棋譜のポップオーバー）
- `NotificationLayer.scss` のコメントが `Modal.scss` の 9999 を**書き写している**。あちらを動かしても通知側は緑のまま
- `$titlebar-height` が「片方だけ直値に書き換えると境がずれる」を理由に `index.scss` に置かれているのと同じ状況
- 直し方: `index.scss` に段を並べて置き、各ファイルから引く

#### M8. 帯とトーストの高さの主従が定義されていない

ui

- 両方 `flex-shrink: 1` のままなので、合計が層を超えると**縮み量は内容の高さに比例して両方から取られる**。帯1枚とトースト20枚なら帯は 80px 前後まで潰れる
- `max-height: 50%` は「半分までは許す」上限であって「半分を確保する」予約ではない。帯は自動で消えない側なので、**いちばん残したい通知がいちばん潰れる**
- `&__toasts` の `min-height: 0` に添えたコメントは理由として正しくない（`overflow-y: auto` を書いた時点で自動最小サイズは 0）
- 直し方: `&__banners { flex: none; max-height: 50% }` で主従を書く

#### M9. 帯だけ modifier でなく子孫セレクタで、他部品の内部クラスを指している

ui

- toast と modal は `notice--toast` / `notice--modal` の modifier なのに、帯だけ `&__banners { .notice { ... } }`
- `notice--banner` で grep しても出てこない。将来この中に `InlineNotice` を置くと意図しない `border-bottom` が付く
- 直し方: `notice--banner` を作って揃える

#### M10. `top: $titlebar-height` が無条件だが、タイトルバーの無い画面でもこの層は出る

ui

- `TitleBar` を描くのは `RuntimeShell.tsx:10` だけで、`AppRouter.tsx:11` の `AppLoading` はその外。**「起動できていない画面でも失敗は出る」が置き場の根拠**なのに、層はその画面でも 2.6rem を空ける
- `Modal.scss` が同じ `top` を使えるのは「`RuntimeShell` の配下でしか開かない」前提があるからで、その前提はこの層には無い
- 直し方: タイトルバーの有無を層に伝えるか、通知はタイトルバーのある画面でしか出さないと決めてコメントを直す

#### M11. 帯がアプリのヘッダ（5.6rem）を押し下げず覆う

ui

- 層は `position: fixed` で流れの中に居ないのに、SCSS のコメントは「帯は器の一部として出す」と書いている
- 題だけの帯でも 3.5rem 前後、本文付きならヘッダを完全に覆う。帯は `autoDismiss` の対象外なので、× を押すまでヘッダの操作が戻らない
- **「アプリが操作できない理由」を伝える帯が「アプリの操作」を奪う**
- 直し方: 器の行として出すか、少なくともコメントを実際の挙動に直して仕様に書く

#### M12. `FsErrorView` が新しく書いたルールに合わず、例外表にも載っていない

ui / architecture

- `FsErrorView.scss:18-28` は `$surface-danger` の上に `border-left-color: $color-danger`。`Notice.scss:149` は同じ面に `$color-danger-text`
- **同じ面に載る同じ役割の帯が、2つのファイルで別のトークンになった。** 今回 CONTRIBUTING に「帯・記号・文言は `-text` を選べ」と書いた以上、`FsErrorView` は文書と食い違う実装
- しかも #180 の「まだ寄り切っていない」一覧に `FsErrorView` は入っていないので、**規約に合っていないのに合っているように見える**
- 直し方: 寄せるか、一覧に行を足すか

#### M13. `NotifyAction` が shared にできたのに、同じ形が `widgets/file-tree` に手書きで残っている

architecture

- `FileTreeErrorNotice.tsx:13` の `fallback?: { label: string; run: () => void }`。ADR-0004 決定3 を根拠に書かれた型が、その決定を落とし込んだ `NotifyAction` と別に存在している
- **既にズレている**: `run` が `Promise` を返せないので、非同期の逃げ道を渡すと `void` に潰れて unhandled rejection になる。`Notice.tsx` は同じ `run` の失敗を通知の中に出す作りなので、**同じ概念に失敗の扱いが違う2実装がある**
- 直し方: `NotifyAction` を import する（`widgets → shared` は下向き）

#### M14. 段の語彙が `entities/file-tree` にもう1つあり、`VisibleTier` と結ばれていない

architecture

- `fsErrorTier`（`error.ts:169`）の戻り値 `"warning" | "danger"` は ADR-0004 決定1 の段そのものだが、型として `VisibleTier` と無関係。段の名前を変えても **tsc が `fsErrorTier` へ連れて行かない**
- 直し方: `Extract<VisibleTier, "warning" | "danger">` にする（`entities → shared` で下向き）

#### M15. `UpdaterScreen` が `BootstrapProviders` の外にあり、「通知はいちばん外」が現物と違う

architecture

- `App.tsx:12-17`。`UpdaterScreen` は**手書きの失敗の出口をもう1つ持っている**画面で、そこだけが provider の外にある
- 基盤へ載せようとして `useNotifications()` を呼ぶと throw し、**この位置を囲う `AppErrorBoundary` は無い**（`pages/AppLayout.tsx` の中）ので root ごと落ちる
- 直し方: `<UpdaterScreen />` を `<BootstrapProviders>` の中へ入れる（`document.body` へ portal するので描かれる場所は動かない）。入れないならコメントを直して外に残す部品を名指しする

#### M16. `FsErrorView` と `Notice` の寄せ先がコードから読み取れない

architecture

- 重複自体は ADR-0004 の「移行を一度にやらない」で意図的だが、**いま `entities/file-tree` に失敗の面を1つ足す人にはどちらを使うか決める材料が無い**
- `FsErrorView` は `details`（`code` / `message` / `cause`）を持ち `Notice` には差し込み口が無いので、**そのままでは寄せられない**という事実もどこにも書かれていない
- 直し方: どちらか一方に出典を1つ置く（`TODO(#277)` の形）

#### M17. 台帳の追記に `（測定日 / ブランチかコミット）` が無い

oss-hygiene

- `failure-surfacing.md:13-18` が自分で課した規約。§2 の F-19〜F-30 は全て持っているのに、今回の追記だけ持たない
- **この追記は最も早く腐る種類の記述**（1件目が載った瞬間に嘘になる）なのに、いつ測ったかが無い
- 直し方: `（2026-09-06 / 173bdc81）` を付ける

#### M18. §0 で「出口」が2つの意味に割れ、§4 の用法と衝突する

oss-hygiene

- §4 の「出口」は**利用者に何かが届く経路**の意味。§0 は同じ語を「描く仕組みが存在する」の意味で使い、見出しへの答えが `1 + 8` に読める
- 通知基盤を通る失敗は0件なので**届く経路は依然 8**。この PR が最も避けたかった混同が、章の見出しの位置で起きている
- 直し方: 「利用者に届く経路は 8つで、変わっていない」から始め、基盤を「出口」と呼ばない

#### M19. §1 の追記が、測定でなく将来の予測を断定で書いている

oss-hygiene

- 「**通知を載せても**発火元も読み手も減らない」は載せ替え後の話でまだ観測できない。決定6 が言っているのは「`state.error` を消さない」だけで、`notify` をどこから呼ぶかは何も決めていない
- UI が `state.error` を読んで `notify` すれば「UI の読み手」列は 0 → 1 に動く。**未決なのに断定しているので、載せた人がこの行を根拠に表を更新しない**
- 直し方: 観測できる範囲に切り、予測でなく更新の指示として書く

#### M20. CONTRIBUTING の意味色の表と、新設した注意書きが互いに矛盾する

oss-hygiene / comment

- 表の1行目は「枠・薄い面・アイコンには意味色（`$color-danger` ほか）」、10行下は「帯・記号・文言に使うときは `-text` を選べ」。**枠と帯、アイコンと記号は同じもの**
- 注意書き自身が「fatal は 3:1 **も**割る」と書いており、裏を返せば danger（3.75）は輪郭なら足りる。「直接置けません」は danger には過大
- `index.scss:39` は「`$color-danger` は枠・**文字**・薄い面に残す」と逆を言っている
- 現物も割れている: `Notice.scss` は danger/fatal の帯に `-text`、warning の帯は生
- 直し方: 表の行を基準（3:1 / 4.5:1）ごとに割る。`index.scss:39` から「文字」を落とす

#### M21. CONTRIBUTING に「失敗をどう出すか」の入口が無く、9つ目の手書き出口を作らせる

oss-hygiene

- 寄稿者が読む唯一の文書が、依然「失敗の箱を**新しく作る**とき」を既定の行動として書いている。この節を今回触っているのに基盤に1行も触れていない
- 直し方: 「まず `notify` か `InlineNotice` を通す」を先に置き、`$surface-*` の指示は基盤に載らない箱に限定する

#### M22. モーダルの在庫を持つ文書が、`AppModalLayer` の外に出る通知モーダルを数えていない

oss-hygiene

- `navigation-map.md:33-34` は「9枚すべてを常時マウントする」と全在庫を主張しているが、通知の modal は**URL でも state でも開かない3種類目**
- 「モーダルを増やすときは `ModalType` も増やす」の例外がどこにも無い
- 基盤側のモーダルの決まり（重ねない／閉じるボタンを置く／z-index）は SCSS と tsx のコメントにしかない
- 直し方: `navigation-map.md` に1段落、`system-dialogs.md` の対象に `shared/ui/notification/` を足す

#### M23. コメントに書いた比が、書いてある基準では再現しない

comment（この repo の `contrastRatio` で再計算。既存の 3.75 / 5.66 は完全一致したので計算器は信頼できる）

| 書いてある                              | 実測                                                 |
| --------------------------------------- | ---------------------------------------------------- |
| `$color-fatal` は暗いカードで `2.32:1`  | #1c2325 では **2.41**。2.32 は `$surface-fatal` の上 |
| `$color-fatal-text` … `5.29:1`          | #1c2325 で **5.27** / `$surface-fatal` で **5.07**   |
| `Notice.scss:10` 面どうしの差は `1.2:1` | 最大 **1.055**                                       |
| 「HSL でどちらも 0.01 台」              | degree では 6.0 / 4.6。`hue()` も devtools も degree |

- `CONTRIBUTING.md:268` の「それぞれ 3.75:1 と 2.32:1」は**基準の違う2つを並べている**（3.75 は #1c2325、2.32 は面の上）
- **結論（段は帯と記号が持つ）は実測の方がむしろ強いのに、数字が合わないせいで根拠ごと疑われる**
- 直し方: 基準を明記して実測値に直す

#### M24. 「unmount では cleanup が走らない」は React の挙動として誤り

comment

- `provider.tsx:90-92`。cleanup は unmount でも必ず走る。走らないのではなく、上の effect が**そもそも cleanup を返していない**（張り直すと残り時間が巻き戻るため意図的に）
- この文を信じた読み手が他の effect にも当てはめると、別の場所で本当に必要な後始末を消す
- 直し方: 「上の effect は張り直しを避けるために cleanup を返していない」に書き換える

#### M25. 「このエピック」は読み手が特定できない変更文脈

comment

- `BootstrapProviders.tsx:11-13` と `BootstrapProviders.test.tsx:10-12`。#277 という作業単位を指す語でコードには残らない
- 主張の前半（層と置き場を離さない）は現在形で成立しているので、後半は削るだけで情報が減らない
- 直し方: 一文を落とし、残りを関数の頭の TSDoc へ移す

#### M26. 公開面が裸で、非公開の補助関数にだけ厚い doc が付いている

comment

- `useNotifications`（出す側が唯一触る入口）に、throw する条件も `silent` を黙って捨てることも書かれていない。`NotificationContext` は公開されているので `useContext` を直に書けてしまい、そのとき throw は効かない
- 一方 `foldInto` / `withoutMatching`（非公開）には5行の doc。**厚みが逆向き**
- 直し方: 公開面に書き、reducer の呼び出し規約を1つの TSDoc に集める

#### M27. `Notify*` と `Notification*` の分け方が書かれていない

comment

- `NotifyAction`（押すボタン）と `NotificationAction`（reducer の指令）が隣接ファイルに同居。`Notification.actions` の要素型を取り違えても文脈だけでは気づきにくい
- `Notification` は DOM のグローバル `Notification`（`title` / `body` / `silent` を持つ）と同名。**import を忘れた新規ファイルは型検査を素通りする**
- 直し方: 正とする語彙を `types.ts` の冒頭に1行で書く

#### M28. 意図して選んだ数値に理由が無い

comment

- `AUTO_DISMISS_MS = 6000` / `max-height: 50%` / `width: 36rem`。どれも「1つに固定する理由」はあるが**なぜその値か**が無い
- 6000 は `provider.test.tsx:71-75` が 5999/6000 で固定しているので、根拠を知らない人は「テストが決めた値」と読んで動かせなくなる
- 直し方: 由来を1行ずつ。無いなら測って決め直す

#### M29. コメントがその行を説明していない（ポータル先）

comment

- `NotificationLayer.tsx:27-29`。「タイトルバーの下から敷く」を実現しているのは SCSS の `top` であってこの行ではない
- この行について知りたいこと（なぜ `#root` でなく `#modal-root` か、`#modal-root` が `#root` の後ろに来ること）は書かれていない
- 直し方: `#modal-root` を選んだ理由に差し替える。タイトルバーの話は SCSS の1箇所だけに残す

#### M30. 同じ理由が3〜5ファイルに写経されていて、既に片方が現物とずれている

comment

- 件数の意味（5箇所）/ console に落とさない（3箇所）/ インラインは基盤から描けない（4箇所）/ モーダルは1枚（2箇所）
- **すでにずれている**: `Notice.scss:38-39` の「1件目から出す」は全通知に件数が出ると読めるが、実際に出るのは `dedupeKey` を持つ通知だけ（`NotificationLayer.tsx:83`）
- 密度そのものは既存ファイルと同程度なので、量ではなく**重複**が問題
- 直し方: 各理由の正本を1箇所に決め、他は消すか参照の1行に落とす

## 重複・矛盾した所見

**束ねたもの**

- H1（`autoDismiss`）/ M1（`silent`）/ H8（押下直後の自動消滅）は**すべて `NotifyRequest` を union にすれば同時に片付く**。architecture は H1 を、robustness は H8 を、両方が M1 を別々に挙げたが根は1つ
- M2 は perf / react / architecture の3観点が独立に同じ結論（context を2つに割る）に着いた。perf は実測（`1 → 2` 描画、タスクを跨ぐ50連発で50描画）を持っている
- H11 / M13 / M14 / M16 は「**shared にできた語彙が、既存の手書きと結ばれていない**」という同じ根。ただし直す範囲が違う（H11 は自分のファイル、M13/M14 は他スライス、M16 は doc だけ）
- M20 / M23 は「CONTRIBUTING と `index.scss` と `Notice.scss` の3者で、意味色の使い分けと数値が食い違う」1つの塊

**矛盾したもの — 判断が要る**

- **z-index の向き。** robustness（H4）は「`.notice-layer` を overlay より**上げろ**。`pointer-events: none` があるのでモーダルは塞がらない」と言う。一方 ui（H5）は「トーストが更新カードを覆って押せない」と言い、こちらは**上げるとさらに悪化する**。両者は同じ「右下と全面の取り合い」を別の側から見ている。
  - 上げれば H4 は消えるが H5 は残る（更新カードは 9000 なので元から負けている）
  - 上げなければ H4 が残る
  - **どちらにせよ `pointer-events` を箱でなく通知1枚ずつに移す（H5 の最小の直し方）は両立する**ので、それを先に入れてから z-index の向きを決めるのが安全
- **`Notice` の `mounted` ref。** react（M3）は「消せ、何も守っていない」。robustness（H8）は「押下中に unmount されると失敗が消える」を問題にしており、ref が守ろうとした経路そのものが実在する。**M3 が正しい（ref は実際には守れていない）が、H8 の実害は別途塞ぐ必要がある**——ref を消すだけだと H8 が残る

## 見ていない範囲

- **実機のレンダリング。** z-index・重なり・溢れの挙動はすべて SCSS と flex の解決規則からの推論で、画面で目視していない（E2E も無い）。H4 / H5 / H7 / M8 / M11 はこの性質
- 支援技術の実挙動（M5 は ARIA の既知の制約に基づく指摘で、読まれる環境もありうる）
- `docs/decisions/0004-notification-taxonomy.md` 本体の整合（ADR の表が「6件」と書きつつ7行ある、など）。この PR の差分外
- `docsSourcePaths` / `docsIdentifiers` / `stateTransitionIndex` が今回の追記（拡張子無しのパス表記）をどう扱うか
- Rust 側（差分に含まれない）
- テストの網羅性そのもの。**変異を当てて落ちることは実装側で確認済み**だが、reviewer はその評価をしていない

## lint / hook で強制できるもの

| 何を                                              | どう                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| H1 / M1 / H8（`autoDismiss` / `silent`）          | **型で足りる。** `NotifyRequest` を union にすれば `tsc -b` が弾く。lint 規則を足さない                  |
| H11（`onDismiss`）                                | **型で足りる。** `Omit` に1語                                                                            |
| M13 / M14（手書きの複製）                         | **型で足りる。** `shared/lib/notification/types` から取れば tsc が全ての複製へ連れて行く                 |
| H4 / M7（z-index）                                | `src/__tests__/modalOverlayTitlebar.test.ts` が既に SCSS をコンパイルして値を読む器を持つ。大小を1本足す |
| M23（コメントの比）                               | `contrast.ts` の `resolveColor` / `contrastRatio` が既にある。`N.NN:1` の形を拾って実測と突き合わせる    |
| M4（畳んだときの `actions`）                      | reducer のテスト1本。いまはどちらへ変えても緑                                                            |
| H7（新着の並び）                                  | 高さは測れないが「最後に `notify` したものが箱の最初の子」は DOM で固定できる                            |
| H2（modal の key）                                | oxlint では拾えない（`react/jsx-key` は配列の中しか見ない）。テスト1本が唯一の歯止め                     |
| M17（台帳の測定日）                               | `failure-surfacing.md` の差分に対するフック。追加段落が `（\d{4}-\d{2}-\d{2} / …）` を持たなければ落とす |
| H10 / M25（経緯の語）                             | `commentHistory` に「エピック」「〜になっていた」を足せる                                                |
| M26（公開 API の TSDoc）                          | `src/shared/**` 限定なら走査テストで固定できる                                                           |
| M12（`$color-danger` の使い分け）                 | `contrast.ts` の変数解決を流用すれば走査できる。いまは CONTRIBUTING の文章だけが根拠                     |
| M18 / M19 / M21 / M27 / M28 / M29 / M30 / M3 ほか | 機械では防げない。語の意味の一貫性・予測と観測の区別・設計の選択                                         |

## 修正計画（r1 → r2）

所見を全部読んでから書いた。数値の主張（M23）は自分でも検算して**4件とも reviewer が正しい**ことを確かめた
（`$color-fatal`/#1c2325 = 2.41、`$color-fatal-text`/#1c2325 = 5.27、面どうしの差は最大 1.055、色相は 4.6/6.0deg）。
`scroll="none"` がリポジトリの多数派（10件中8件）で、`content` を選んでいるのは
**可変長の失敗文を出す2件だけ**（`KifuReadErrorDialog` / `FileConflictDialog`）であることも確認した。

### 束（同じ根から出ている所見）

- **型で言い切る**: H1 → M1 → H8。`NotifyRequest` を `presentation` の判別 union にすると、
  `autoDismiss` が `toast` の枝だけになり（H1 が消える）、`actions` と同時に書けなくなり（H8 が消える）、
  `silent` を `{ tier: "silent"; reason }` に割れる（M1 が消える）。**1つの型変更で3件が消える**
- **`Notice` の内部 state**: H3 → M3。`running` を action の同一性に変えると、
  `mounted` ref が守ろうとしていた経路が実際に塞がるので M3 は「消す」だけになる
- **重なりの取り合い**: H5 → H4。`pointer-events` を箱から通知1枚ずつへ移す（H5）と、
  層を上げても下の UI を握らなくなるので H4 の直し方が安全側になる。**H5 が先**
- **意味色の使い分け**: M20 → M23 → M12。CONTRIBUTING の表を基準ごとに割る（M20）と、
  そこに書く数値が M23 の実測になり、`FsErrorView` が適合するかの判定基準（M12）も決まる
- **台帳の言葉**: M18 → M17 → M19。§0 の語を直してから測定日を付ける（直す前に日付を付けると
  直した日と食い違う）

### このラウンドで直すもの

**機械で強制できるものを先に置く**（`/review-plan` 手順3）。人の注意に頼る修正を先に入れると、
後から型を入れたときに同じ場所をもう一度触ることになる。

| 順  | 所見                                          | なぜこの順か                                                   | この直し方で壊しうるもの                                                                                                                                                                                                                                        |
| --- | --------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | H1 / M1 / H8                                  | **型。3件が同時に消える。** 以降の全ての修正がこの型の上に載る | `NotifyRequest` を書く既存の全テストが型エラーになる。`silent` のテスト2本は `presentation` を書けなくなるので**書き換えが必要**。`Notification.autoDismiss` が「時計が付くか」の意味に変わるので、`provider.tsx` の `if (!n.autoDismiss)` は据え置きでよくなる |
| 2   | H11                                           | 型。`Omit` に1語                                               | 無し（`InlineNotice` の呼び出し元がまだ0件）                                                                                                                                                                                                                    |
| 3   | M13                                           | 型。`FileTreeErrorNotice.fallback` を `NotifyAction` にする    | `run` が `Promise<void>` を返せるようになるので、`FileTreeErrorNotice` の `onClick={fallback.run}` が**浮いた Promise を作る**。呼び出し元（`FileTree.tsx`）が同期の関数を渡している限り実害は無いが、**その場で `void` に潰れる経路が新しくできる**            |
| 4   | M14                                           | 型。`fsErrorTier` を `VisibleTier` に結ぶ                      | `entities/file-tree` から `shared/lib/notification` への import が新しく1本増える。下向きなので lint は通るが、**`entities/file-tree` のテストが通知の型を引くようになる**                                                                                      |
| 5   | H5                                            | 束の先頭。これを入れないと H4 の直し方が決まらない             | 箱の `padding` の上で押していたクリックが通らなくなる。**トーストの隙間をクリックすると背後の盤に届く**ようになる（意図した挙動だが、いまと変わる）                                                                                                             |
| 6   | H4 / M7                                       | 失敗経路と門番。H5 の後                                        | 層をモーダルより上げると、**モーダルのカードに重なったトーストがモーダルのクリックを食う**。カードは中央、トーストは右下なので、狭いウィンドウでだけ起こる。`modalOverlayTitlebar` に大小を固定する検査を足して、次に触る人が向きを戻せないようにする           |
| 7   | H6                                            | 失敗経路。`scroll="content"` へ                                | `Modal` の `.modal__body` が中身を囲うので、`notice--modal` の `padding` が二重になりうる。**見た目が変わる**                                                                                                                                                   |
| 8   | H2                                            | 失敗経路。key                                                  | `Notice` が modal のたびに再マウントするので、**動作の走行中に2枚目が来ると走行状態が消える**。これは望ましい側（H3 と同じ理由）                                                                                                                                |
| 9   | H3 / M3                                       | 失敗経路。束                                                   | `running` が identity になるので、**同じ action オブジェクトを2つの通知が共有していると両方が busy になる**。`NotifyAction` は呼び出し側がその場で作る前提なので実害は無いが、共有すると壊れる形が新しくできる                                                  |
| 10  | H7                                            | 失敗経路。新着が見えない                                       | 並びが逆になるので、**`NotificationLayer.test.tsx` の「見せ方が違えば同時に出る」以外の順序を見るテストが落ちる**。DOM の並びを固定する検査を同時に足す                                                                                                         |
| 11  | H9                                            | 失敗経路。動作の失敗に次の一手                                 | `NotifyAction` に欄が1つ増える。**必須にすると既存のテストが全部落ちる**ので任意にする。任意にすると書き忘れが起きるが、書き忘れても今より悪くならない                                                                                                          |
| 12  | M4                                            | 畳んだときに復帰手段が消える                                   | `actions` を残す側に倒すと、**動作が要らなくなった通知からボタンを消せなくなる**。消したいときは明示的に `actions: []` を書く形になる                                                                                                                           |
| 13  | M6                                            | 走行中の `disabled` でフォーカスが落ちる                       | 二重起動の防止が `Button` の `disabled` から `invoke` の先頭のガードに移る。**`isLoading` を落とすと視覚的な待ちの表示も消える**ので、`aria-busy` と回転は残す                                                                                                  |
| 14  | M5                                            | 読み上げ                                                       | 常設の live region を足すと、**通知の本文が DOM に2回出る**。視覚的に隠すクラスが `src/` に1つも無いので新しく作ることになる                                                                                                                                    |
| 15  | M2                                            | context を割る                                                 | `useNotifications` の戻り値が変わる。**`NotificationLayer` と全テストが影響を受ける**。`useNotify` を新しい入口にすると、どちらを使うかの判断が呼び出し側に増える                                                                                               |
| 16  | M8 / M9 / M10 / M11                           | SCSS の主従・modifier・前提                                    | M11（帯がヘッダを覆う）を器の行として出す形に変えると **`AppLayout` を触ることになり、並行ブランチ `refactor/app-shell-wiring` と衝突する**。今回は「覆う」ことを仕様として書く側に倒す                                                                         |
| 17  | M20 / M23 / M12                               | 意味色の束                                                     | `index.scss:39` から「文字」を落とすと、**`$color-danger` を文字に使っている既存箇所が規約違反になる**。`grep` で数えてから落とす                                                                                                                               |
| 18  | H10 / M24 / M25 / M26 / M27 / M28 / M29 / M30 | コメント。振る舞いを変えない                                   | 無し（コメントのみ）。ただし M27（語彙）は**型名を変えるなら振る舞いに触る**ので、今回は「規則を1行書く」だけに留める                                                                                                                                           |
| 19  | M18 / M17 / M19                               | 台帳の束                                                       | `docs/state-transitions/` を触るので **`verify:rust` が要る**                                                                                                                                                                                                   |
| 20  | M21 / M22                                     | CONTRIBUTING の入口・モーダルの在庫                            | 無し（docs のみ）                                                                                                                                                                                                                                               |

### 直さないもの

| 所見 | 行き先                        | 理由                                                                                                                                                                                                                                                                 |
| ---- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M15  | **issue #432**                | `UpdaterScreen` を provider の中へ入れる修正は、**更新画面を通知へ載せ替える判断（#432）と同じ場所を触る**。先に入れると #432 でもう一度触ることになる。今回は `BootstrapProviders` のコメントを現物に合わせ、外に残る部品を名指しする（M25 のコミットで一緒に直る） |
| M16  | 同じ PR。ただし doc の1行だけ | `FsErrorView` を `Notice` へ寄せるのは ADR-0004 が「移行を一度にやらない」と書いている範囲。**寄せられない理由**（`details` の差し込み口が無い）を `TODO(#277)` として書くところまでにする                                                                           |

### 対象そのものを疑ったか

**所見が集まっている機構を数えた。**

- `NotifyRequest` の形に **4件**（H1 / M1 / H8 / H11）。いずれも「フラットな1つの型が、
  見せ方ごとに違う制約を表せていない」。→ **union にすることが機構の落とし方そのもの**なので、順1 で対応する
- 重なりと `pointer-events` に **5件**（H4 / H5 / M7 / M10 / M11）。これは
  「**`position: fixed` の層でアプリの器の上に浮かせる**」という機構に集まっている。
  落とす案は「帯を `AppLayout` の grid の行にし、トーストだけを層に残す」だが、
  **`AppLayout` は並行ブランチが触っている**ので今回は落とさない。落とすなら次のサイクル
- コメントに **9件**。うち4件は数値の誤り、3件は写経、2件は経緯。
  **機構ではなく密度の問題**なので、正本を1箇所に決める（M30）ことで残りが減る

**所見が減らないラウンドが3回続いたら対象を疑う**——まだ1回目なので、機構を落とす判断は保留する。

### 次ラウンドの焦点

次の `/review-round` は、これを reviewer へ渡す。

1. **union にしたことで、`silent` を書く経路が本当に残っているか。** `presentation` を書けなくした結果、
   F-16 のような「出さないと決めた失敗」を書くのが**面倒になりすぎていないか**
2. **層を上げたことで、モーダルのクリックをトーストが食う経路が生まれていないか**（狭いウィンドウ）
3. **`running` を identity にしたことで、action オブジェクトを共有すると両方 busy になる形**が
   呼び出し側の書き方として自然に起きないか
4. **並びを逆にしたことで、読み上げの順序と視覚の順序が食い違っていないか**
5. **`actions` を残す側に倒したことで、動作を消せない通知が生まれていないか**
6. **context を割ったことで、`useNotifications` と `useNotify` のどちらを使うかの判断が
   呼び出し側に増えていないか**
7. `scroll="content"` にしたことで `notice--modal` の余白が二重になっていないか
8. **前ラウンドの修正で入った新しい欠陥**（`.claude/reviews/` の実測では4ラウンド連続で出ている）

### 検証の見積り

**このワークツリーでは `.claude/hooks/verify-gate.sh` が働かない**（`CLAUDE_PROJECT_DIR` が
主チェックアウトを指すので、clean な別ツリーを見て素通しする → #394 / #342）。
**検証は手で走らせる。**

- 直す件数: 20 の順、コミットは約 25 本（束の中で1所見1コミットを崩さない）
- `npm run verify` … 約 25 秒 × 25 = **約 10 分**
- `npm run build` … SCSS を触るコミットで追加（順 6/7/16/17）
- `npm run verify:rust` … `docs/state-transitions/` を触る順 19 で **1回**（約 3 分。ビルドは暖まっている）

**減らしていない。** 全件このラウンドで取る。件数は多いが1件あたりの差分が小さく、
順序の依存（束）が既に解けているため。
