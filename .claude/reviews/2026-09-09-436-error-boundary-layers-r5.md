# レビュー 436-error-boundary-layers ラウンド5

- 日付: 2026-09-09
- 範囲: `git diff origin/main...HEAD`（r1 24件 + r2 30件 + r3 24件 + r4 18件の修正を含む）
- 走らせた reviewer: architecture / react / ui / robustness / comment / oss-hygiene
- 対象コミット: `bbb86b6d` 系列
- 前ラウンド: [r1](2026-09-08-436-error-boundary-layers-r1.md) / [r2](2026-09-08-436-error-boundary-layers-r2.md) /
  [r3](2026-09-09-436-error-boundary-layers-r3.md) / [r4](2026-09-09-436-error-boundary-layers-r4.md)

## 所見

### [BLOCK] r5-01 未定義のトークンを参照していて、アプリがビルドできない

reviewer: ui / react / comment / robustness / architecture（**5人が独立に、実測で**）

- 場所: `src/shared/ui/AppErrorBoundary.scss` の `--floating`、定義が無いのは `src/index.scss`
- `e245c7e5`（r4-01 の修正）が `$error-fallback-width` を**参照だけして定義しなかった**。
  `npx vite build` が `Undefined variable.` で止まる。`AppErrorBoundary.scss` は
  `AppErrorBoundary.tsx` が import するので必ずバンドルに入る ——
  **`npm run tauri dev` も `tauri build` も通らない。**
- **それでも `npm run verify` は緑。** `verify` は `typecheck && lint && test && test:hooks` で
  **SCSS を一度もコンパイルしない**。vitest は SCSS を stub するので、テストも 994 件全部通る。
  CI の `quality` ジョブも同じ3つしか回さないので、落ちるのは `build-desktop` まで行ってから。
- **78コミット・4ラウンドがこれを素通りしている。** 「緑で通ったこと」を根拠に完了と報告すると
  壊れたまま出る。
- r4 が自分で立てた規則2（識別子を指す全参照を同じコミットに）の裏側 —— 参照を足して定義を足さなかった形。
- 結果: 対応済み `fe9d16bd` — トークンを部品側へ下ろし、`index.$name` の実在を見る走査を足した（変異で落ちることを確認）

### [HIGH] r5-02 「知らせを取り消す」が、待っているファイル操作を黙って捨てる

reviewer: robustness

- 場所: `src/pages/AppModalLayer.tsx`、`src/entities/file-tree/model/reducer.ts`
- `stale` は「知らせが立っているか」しか見ておらず、**それが落ちた原因かどうかは見ていない。**
- `closeConflict` が届く先は `conflict: null` で、`conflict` は**待機中の要求そのもの**
  （`create_file` / `import_kifu` / `rename` / `move` の request）。null にすればその操作は
  実行されずに消える。
- 筋道: 新規棋譜作成で衝突 → 裏の `CreateFileModal` が落ちる → 案内どおり押す →
  **衝突が捨てられ、別名で解決する唯一の口が消える** → 利用者は送信ボタンを押した後なので、
  ファイルが作られたのか作られなかったのかを知る手掛かりがどこにも無い。
- 対話側の同じ操作は「キャンセル」で、しかも説明の下に置かれている。fallback の綴りにはどちらも無い。
- 結果: 対応済み `aa9190c2` — 綴りで捨てるものを名指しし（「待っている操作を取り消す」/「知らせを閉じる」）、押した結果を `afterAction` に出す

### [HIGH] r5-03 `extraActions` を境界から外した理由が、同じラウンドで足した2枚目に当てはまらない

reviewer: architecture

- 場所: `src/shared/ui/AppErrorBoundary.tsx` の `fallback` の doc、`src/pages/AppModalLayer.tsx`
- doc は「どちらも『出口を押した結果』に依存していて、その state は fallback の中にしか無い」と
  書くが、`AppModalLayer` の `extraActions` は**落ちる前から決まっている** ——
  doc が「境界が持てる」と定義した側の値。
- 結合にも効いている: `pages` がボタン1つのために `shared/ui` から4つ import し、
  スプレッド契約を自分で守る責任を負っている。
- **r4-03（唯一の実装から一般則を書いた）と同じ形が、`extraActions` の側でもう一度起きている。**
  r4 の規則3 は「既存の」実装しかカバーせず、**同じラウンドで後から足される実装**を見ていない。
- 結果: 対応済み `aa9190c2` — `extraActions` を境界の prop に上げた。`AppModalLayer` が `fallback` を渡す理由は `afterAction` だけになった

### [MEDIUM] r5-04 `floatingSlot` の番号を固定するものが何も無い。r4-01 の修正が変異で生き残る

reviewer: react / robustness / oss-hygiene

- 場所: `src/app/App.tsx`（`floatingSlot={1}`）、`src/pages/AppModalLayer.tsx`（`0`）
- 型は `number`、テストは「渡した番号が CSS へ出る」ことしか見ていない。
  **`App.tsx` を `floatingSlot={0}` に書き換えても `npm run verify` は全部緑。**
- 割り当ての記述は `pages` 側の JSDoc にしか無く、`app` 側の数字からは辿れない。
  3枚目を足す人は埋まっている番号を知らずに書く。
- 番号を詰めても、既定の窓（960px 高）では 3 以降が画面外へ出る。
- 結果: 対応済み `8cebb88b` — `FloatingSlot` union にした。番号を足す操作が `shared` の1行を通る

### [MEDIUM] r5-05 「知らせを取り消す」は一度も押されていない。出口を空にしてもテストは緑

reviewer: react

- 場所: `src/pages/__tests__/AppModalLayer.test.tsx`
- 検査は文字列の存在だけ。押せない理由は模擬の側にあり、`useFileTree` が**呼ばれるたびに
  新しい `vi.fn()`** を返すので、`onClick` の中身を丸ごと空にしても通る。
- これは `2ca5054d` が入れた**唯一の出口**で、無検査のまま壊れると症状は
  「押しても画面が1ドットも変わらないボタンが2つ並ぶ」になる。
- 結果: 対応済み `aa9190c2` — 模擬の関数が実際に原因を消すようにし、出口を押すテストにした（`onClick` を空にする変異で落ちる）

### [MEDIUM] r5-06 `kifuError` が模擬で常に `null`。鍵と分岐の半分が一度も動いていない

reviewer: react

- 場所: `src/pages/__tests__/AppModalLayer.test.tsx`
- 可変にしてあるのは `conflict` だけ。鍵から `kifuError` を落としても、`stale` を
  `conflict !== null` にしても全テストが緑。
- describe は「URL を持たない**2枚**の入力」を鍵にすると宣言しているのに、検査は1枚だけ。
- 結果: 対応済み `aa9190c2` — `kifuError` を可変にし、鍵と分岐の両方を見るテストを足した（鍵から落とす変異で落ちる）

### [MEDIUM] r5-07 `stale` が条件と合わない名前

reviewer: comment

- 場所: `src/pages/AppModalLayer.tsx`
- 判定しているのは「知らせが**立っているか**」で、「古いか」ではない。
  **いま正しく立っている通知**でも真になる。
- 名前と条件がずれたまま条件だけ増えると、`stale` に「本当に古いか」を足す修正が入り、
  出口が出るべき場面で出なくなる。
- 結果: 対応済み `aa9190c2` — `hasStandingNotice` に改名

### [MEDIUM] r5-08 `AppErrorFallbackView` は描かないものなのに `View` と名乗り、同じ概念に3綴りある

reviewer: comment

- 場所: `src/shared/ui/AppErrorBoundary.tsx`、`src/app/RootErrorFallback.tsx`
- 描くもの（`AppErrorFallbackBody`）が `Body`、描かれない材料が `View`。
  `RootErrorFallback` では同じものが `Props` という3つ目の名前で再宣言され、引数名は `view`。
- 結果: 対応済み `aa9190c2` — `AppErrorFallbackProps` に統一し、`RootErrorFallback` の別名も落とした

### [MEDIUM] r5-09 段構えの出典が `閉じる` と「知らせを取り消す」を知らない

reviewer: robustness / react

- 場所: `docs/spec/screens/app-layout.md` の「失敗の見せ方」、`docs/state-transitions/failure-surfacing.md`
- doc は「`再表示` は…原因が境界の外にあれば同じ行で落ち直す」「`resetKeys` を渡している境界以外は
  畳んだままになる」と復帰の経路を言い切っているが、**いま偽**。
  浮かせた2枚は `閉じる` で消え、モーダル層は provider の state を消す出口を持つ。
- `e245c7e5` / `2ca5054d` はどちらも `docs/spec/` を1行も触っていない。
  **r4 の規則3 の逆向き（出口を増やす修正は、出口を数え上げている doc を同じコミットで直す）が抜けている。**
- 結果: 対応済み `42f120e5` — 出口3つの表を出典に置き、台帳は「出口による」にして表を指すだけにした

### [MEDIUM] r5-10 `system-dialogs.md` に足した一文が、同じ節の次の段落と正面から矛盾する

reviewer: oss-hygiene

- 場所: `docs/spec/screens/system-dialogs.md`
- 「ここに並ぶダイアログはどれもその中に居る」を `## 更新（UpdaterScreen）` 節の中に置いたので、
  **2行あとの「この画面は専用の境界で包んである」と正反対**になっている。
- この doc の4つのうちモーダル層に居るのは2つだけ。`ConfirmDialog` は置かれた画面の境界が受ける。
- 結果: 対応済み `42f120e5` — 節の外へ移し、4つの受け側の違いを書いた

### [MEDIUM] r5-11 `$app-header-height` の doc が、r4 で切った依存をまだ「見ている」と書いている

reviewer: ui / comment / robustness / architecture（4人）

- 場所: `src/index.scss`
- 「帯を避ける `position: fixed` の箱（`.app-error-fallback--floating`）もこれを見る」。
  その参照は `e245c7e5` で消えていて、`AppErrorBoundary.scss` は「**ヘッダは避けない**」と
  正反対のことを書いている。
- **規則2 を書いた次のコミットが規則2 を破っている。**
- 結果: 対応済み `fe9d16bd` — 消えた読み手の名指しを落とした

### [MEDIUM] r5-12 部品固有の寸法が `index.scss` に溜まり始めた。理由がラチェットの逃げ道を無視している

reviewer: architecture / ui

- 場所: `src/index.scss` の `$error-fallback-slot-height`（と先例の `$floating-note-header-height`）
- 「ローカル変数に下ろすと `indirect` が増えて落ちるため」と書いてあるが、
  **ADR-0003 が用意した `// scale-exempt` を使えばローカルのまま `exempt` へ移せる。**
- 理由が「落ちる」で止まっているので、次の人は選択肢の存在を知らないまま `index.scss` に足す。
  **2件目が1件目を「同じ理由」として引いているので、この形は自己複製する。**
- 置き場も `// 重なりの段` 節の中で、根拠に挙げた先例（`// layout` 節）と違う。
- 結果: 対応済み `fe9d16bd` — `scale-exempt` で部品側へ下ろした（`exempt` 3→5、`indirect` は据え置き）

### [MEDIUM] r5-13 issue 3本の本文が、この PR が途中で動かしたものを古いまま持っている

reviewer: oss-hygiene

- **#512**: 「`AppLayout` の中で個別に囲ってあるのは4つ」。現物は3つで、モーダル層は `AppModalLayer` へ移った
- **#514**: 「失敗は `shared/lib/notification` へ載せる（シェルの境界より上＝生き残る）」。
  `RootErrorFallback` が出ている間は `NotificationLayer` も畳まれているので、
  **案どおりに寄せると #436 が入れた唯一の出口を消す**
- **#511**: 棋譜一覧の行が CLOSED の #295 を追跡先として指す（docs 側は r2-28 で #277 へ統一済み）
- 結果: 対応済み — #512 / #514 / #511 の本文を直した（#514 は「通知へ載せる」案が #436 の出口を消すので、そこも明記）

### [MEDIUM] r5-14 棋譜一覧の案内が、境界には分からない原因を断定している

reviewer: robustness

- 場所: `src/pages/AppLayout.tsx`
- 境界の内側には一覧の行だけでなく、コメント編集・分岐メニュー・削除の確認も入っている。
  それらの事故でも「この棋譜は途中から一覧を組めません」と出るので、
  **利用者は自分の棋譜ファイルが壊れていると読む。**
- 他の6枚は原因を断定せず操作だけを言っているので、この1枚だけが形から外れている。
- 結果: 対応済み `8cebb88b` — 断定を落として操作だけにした

### [MEDIUM] r5-15 台帳の G-8 が、存在しない再試行ボタンを復帰導線として載せている（**`main` から在る**）

reviewer: robustness

- 場所: `docs/state-transitions/failure-surfacing.md`、`docs/spec/screens/system-dialogs.md`
- G-8 は「専用画面。**再試行ボタンあり**」だが、`error` 相に並ぶのは `閉じる` 1つだけ。
  同じリポジトリの `system-dialogs.md` は「再試行が無い」と書いていて食い違う。
- 取得そのもの（`check()`）の失敗は `catch {}` で `idle` に戻すので、**画面が1枚も出ない。**
- 結果: **見送り** → 既存の #405 へコメント。`main` から在り、同じ画面の沈黙を持っている issue

### [MEDIUM] r5-16 報告書 r4 だけ「対象そのものを疑ったか」が規約の位置から外れている

reviewer: oss-hygiene

- 場所: `.claude/reviews/2026-09-09-436-error-boundary-layers-r4.md`
- 雛形は `## 修正計画` の下に `###` で並べる形。r1〜r3 はそう。r4 だけ `##` で計画の前に出ている。
- **この PR は `b975edc2` でまさにこの種のずれを直している。** その同じ PR の4本目が、
  別の見出しで同じずれを作った。
- 結果: 対応済み `42f120e5` — 見出しを `###` にして修正計画の中へ移した

### [MEDIUM] r5-17 `secondary` の理由が3箇所に写され、doc が説明の要る側に付いていない

reviewer: comment

- 場所: `src/shared/ui/AppErrorBoundary.tsx`、`.scss`
- 同じ一文が `.tsx` と `.scss` に写り、`.scss` の中でもう一度言っている。
  この PR 自身が「2箇所に置くと片方だけ直る」を3回宣言しているのに、そこから漏れている。
- `secondary` の doc だけが分割代入側に付いていて、ホバーで出る型側は無 doc。
- 結果: 対応済み `aa9190c2` — 重複した doc を落とし、型側に1つだけ残した

### [MEDIUM] r5-18 PR を出す前の判断材料2つ

reviewer: oss-hygiene

- **「手元で実際に動かして確認した」は付けられない**（r5-01 でビルドが落ちるため）。
  テンプレートは「通したふりをされる方が困ります」と明記している
- **`/tidy-commits` は「触らない」側。** 判定表の「畳まないと決めたコミットが本体と同じファイルを触る
  → 触らない」に当たる（`7e8c3e00` は #436 と独立した修正で、`AppLayout.tsx` と
  `kifu-stream.md` を触る）。報告書4本が **76個の短ハッシュ**を参照している点も同じ向き
- 付随: `tidy-commits/SKILL.md` と `review-protocol/SKILL.md` が「約8秒 / 約2分15秒」という
  **CLAUDE.md が名指しで否定している数字**を持っている（`review-protocol` は「Rust 側 `#[test]` 0個」も）
- 結果: **PR の作法として実行** —— `/tidy-commits` は呼ばない。理由と、`verify:rust` を走らせていないことを PR 本文に書く。SKILL の数字は #522 の範囲

## 重複・矛盾した所見

- **`floating` の束**: r5-01 / r5-04 / r5-12。どれも r4 で入れた枠の作り替えの周辺。
- **契約と写しの束**: r5-03 / r5-08 / r5-09 / r5-11 / r5-17。**5件とも「同じことを2箇所以上に書き、
  片方だけが動いた」形**で、r4 が立てた順序の規則が1ラウンドももたなかったことを示している。
- **テストの束**: r5-05 / r5-06。どちらも「模擬が固定値で、直した経路が一度も走っていない」。
- architecture の判定: **「対象を替える根拠は今回も無い」**（r5-01〜r5-18 のうちファイル分割で消えるものは0件）。
  ただし r4 の処方（人が守る規則）は効かなかったので、**`lint / hook で強制できるもの` に挙げながら
  1本も書かなかったことが共通の原因**と指摘している。

## 見ていない範囲

- **実プロセスで描いた reviewer は居ない。** そもそも r5-01 でビルドが通らないので描けない。
- `--floating` の2枚を同時に落とした画面、`/` での見え方は算術のみ。
- `FileConflictDialog` / `KifuReadErrorDialog` が実際に throw する入力は未特定（r3 から変わらず）。
- README の画像は「ヘッダ右のアイコンの数」しか突き合わせていない。

## lint / hook で強制できるもの

- **`index.$name` が `index.scss` に実在すること**（r5-01）。`scssScaleRatchet` の `definedIn()` が
  そのまま使える。**これ1本でこの BLOCK は書いた瞬間に赤くなる。**
- **`floatingSlot={N}` の重複・連番**（r5-04）。型を union にすれば足す操作が `shared` の1行を通る。
- **doc 中の `` `識別子` `` が実在すること**（r5-08 / r5-11）。Rust 側に `comment_identifiers` がある。
- **`hint={...}` の中の `「…」` がボタンの綴りと一致すること**（r4-08 の続き）。
- **`.claude/reviews/*.md` が雛形の見出しを持つこと**（r5-16）。
- **`SKILL.md` が `verify` の所要時間の数値を持たないこと**（r5-18）。

## 修正計画（r5 → r6）

### 束

- **ビルドの束**: r5-01 →（走査を足すと以後この形が全部止まる）
- **契約と写しの束**: r5-03 → r5-08 → r5-17（`extraActions` を境界へ上げると、
  `AppModalLayer` の `fallback` が減り、写す先が1つ減る）
- **出口の束**: r5-02 → r5-05 / r5-06 → r5-09
- **doc / issue の束**: r5-09 / r5-10 / r5-11 / r5-13 / r5-14 / r5-15 / r5-16

### 対象そのものを疑ったか

**件数の推移: r1 31 / r2 31 / r3 25 / r4 20 / r5 18。** 減り続けている。

architecture は「ファイル分割で消える所見は0件」と数え、**対象を替える根拠は今回も無い**と判定した。
一方で **r4 の処方（人が守る順序の規則）は1ラウンドももたなかった** —— r5-01 / r5-11 は
規則を書いた次のコミットが破っている。

**替えるのは処方の形。** CLAUDE.md は「同じ失敗を2回するまでルールを足さない。1回目は
**ルールではなくテスト**を書く」と定めている。r4 は `lint / hook で強制できるもの` に
6項目を挙げながら1本も書かなかった。**このラウンドは、いちばん高くついた1件（r5-01）だけ
走査にする。** 残りは所見として直す。

### このラウンドで直すもの

| 順  | 所見                                          | なぜこの順か                                  | この直し方で壊しうるもの                                                                  |
| --- | --------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | r5-01 + r5-12                                 | BLOCK。**走査を同じコミットで入れる**         | 部品側へ下ろすと `exempt` の枠が増え、`indirect` が減る                                   |
| 2   | r5-03 + r5-08 + r5-02 + r5-05 + r5-06 + r5-07 | 契約と出口の束。1つの編集で解ける             | `extraActions` を境界へ上げると `AppModalLayer` の `fallback` が `afterAction` だけになる |
| 3   | r5-04 + r5-14                                 | 型と文言                                      | union にすると3枚目を足す人が `shared` を触る（意図どおり）                               |
| 4   | r5-09 + r5-10 + r5-16                         | doc                                           | 出口の表が増えるので、出口を足すたびに表を直すことになる                                  |
| 5   | r5-11                                         | 順1 で参照が消えたので、その doc も同じ向きで | 無し                                                                                      |
| 6   | r5-13 + r5-15                                 | issue 側                                      | 無し                                                                                      |
| 7   | r5-17                                         | 無し                                          | 無し                                                                                      |

### 直さないもの

| 所見  | 行き先                  | 理由                                                                         |
| ----- | ----------------------- | ---------------------------------------------------------------------------- |
| r5-15 | **#405 へコメント済み** | 台帳の G-8 と `check()` の沈黙。`main` から在り、#405 が同じ画面を持っている |
| r5-18 | **PR の作法として実行** | `/tidy-commits` は呼ばない。理由を PR 本文に残す。SKILL の数字は別件（#522） |

### 次ラウンドの焦点

1. **`npm run build` が通るか。** そして走査がその形を捕まえるか（変異を当てて確かめること）
2. **`extraActions` を境界へ上げたこと。** `AppModalLayer` の `fallback` が `afterAction` だけになったか
3. **出口が捨てるものを綴りと `afterAction` で示したこと。** 押した後に何が起きたか読めるか
4. **`floatingSlot` を union にしたこと。** 3枚目を足す動線
5. **doc に出口の表を足したこと。** 出口が増えるたびに腐る形になっていないか
6. **件数が18 → いくつになったか**

### 検証の見積り

7束（束の中は1所見1コミット）で概ね10コミット。**`npm run build` も毎回通す**（`verify` は含まない）。
