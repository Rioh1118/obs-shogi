# L2: 合流(transposition)を扱えないことは実際に痛いか

調査日: 2026-07-27 / 手法: 公開一次情報の受動的閲覧のみ（GitHub は `gh api` で raw 取得）。issue へのコメント・接触は一切していない。

## 結論（1段落）

痛みは**実在する**が、痛がっている人の数は現在の根拠からは**極めて小さい**。そして最も重要な発見として、ShogiHome は 2025-08 にこの痛みを**DAG化せずに解決して出荷済み**である（ツリーは維持したまま SFEN をキーにした同一局面インデックスを追加）。したがって現在の根拠は「合流を扱えないのは痛い」を部分的に支持するが、「だから棋譜を DAG にすべき」（Q-002）は**支持しない**。むしろ市場のリーダー実装が、同じ痛みに対してツリー＋局面インデックスという遥かに安い解を選び、それをリリースノートで「他の将棋アプリではあまり見かけない機能」と自賛している事実は、DAG 大工事に対する強い反証として働く。加えて、根拠の元になっていた「#236 が同リポジトリ最多議論」という二次情報は**事実として誤り**である（コメント数 2位、ユニーク参加者はわずか2名）。

## 判定: P-004 は [部分的に支持]

- 「合流が起きる」ことと「起きたときに研究家が困る」ことは一次で確認できた `[確定]`
- 「困っている人が多い / 頻度が高い」は**確認できなかった** `[未確認]`
- 「その痛みが DAG を要求する」は**反証された** `[反証]`（ツリー＋SFEN索引で解決済みの実例あり）

---

## ShogiHome #236 の実測

出典: https://github.com/sunfish-shogi/shogihome/issues/236
（リポジトリは `sunfish-shogi/shogihome`。旧名 `sunfish-shogi/electron-shogi` からのリネームで、issue 内リンクは旧 URL のまま残っている）

| 項目                           | 実測値                                                                                         | 等級     |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | -------- |
| タイトル                       | 一般のグラフ構造を意識し、定跡ファイルやデータベースをベースとした操作体系                     | `[確定]` |
| 起票者                         | `Paalon`（Koki Fushimi）                                                                       | `[確定]` |
| 開設日                         | 2022-10-16T02:09:19Z                                                                           | `[確定]` |
| コメント数                     | **30**（API の `comments` フィールド／コメント配列長ともに 30）                                | `[確定]` |
| **ユニーク参加者数**           | **2名**（`sunfish-shogi` 16件 / `Paalon` 14件）。起票者は Paalon なので**人間は2人しかいない** | `[確定]` |
| issue 本体のリアクション       | **0**（`reactions.total_count = 0`）                                                           | `[確定]` |
| 全30コメントのリアクション合計 | **👍 1件のみ**（2022-12-22 の sunfish コメントに +1）                                          | `[確定]` |
| 最終コメント日                 | 2023-05-07T07:13:56Z                                                                           | `[確定]` |
| 現在の状態                     | CLOSED（`state_reason = completed`）                                                           | `[確定]` |
| ラベル                         | なし                                                                                           | `[確定]` |

**クローズ理由（原文ママ）** — https://github.com/sunfish-shogi/shogihome/issues/236#issuecomment-1537340241 (2023-05-07):

> しばらく進展がないのと、私のモチベーションが低いので、Issue 管理のためにいったんクローズします。
> ディスカッションを再開すべききっかけがあったときに再オープンしてください。

※ `state_reason` は `completed` だが、原文は明確に「モチベーションが低い」ための整理クローズであり、**解決による完了ではない**。二次情報の「定跡フォーマット対応のみで閉じられた」という説明も原文とは一致しない。

### 「同リポジトリ最多議論」の検証 → **誤り** `[確定]`

`gh api --paginate "repos/sunfish-shogi/shogihome/issues?state=all"` で全1698件（issue 505 + PR 1193）を取得し、PR を除外してコメント数降順にソートした実測。

| 順位  | issue    | コメント数 | タイトル                                  |
| ----- | -------- | ---------- | ----------------------------------------- |
| 1     | #294     | **40**     | 二文字駒を用意する                        |
| **2** | **#236** | **30**     | 一般のグラフ構造を意識し…                 |
| 3     | #1061    | 14         | Engines do not use external book files    |
| 4     | #430     | 13         | ユーザーの駒画像を使用する機能            |
| 5     | #591     | 11         | [Bug] PV Value in mate cannot be stored…  |
| 6     | #358     | 10         | 封じ手を含むkifファイルの読み込みにエラー |

- 全 issue 505件、コメント数平均 **1.09**、コメント10件以上はわずか **6件** `[確定]`
- **#236 は 2位**。1位は「二文字駒（駒画像）を用意する」という見た目の話 `[確定]`
- さらに #294 のユニークコメント投稿者は **4名**（sunfish-shogi 22 / Paalon 16 / Zahajki 1 / Quisette 1）。#236 は **2名**。つまり #236 は**コメント数でも参加者数でも1位ではない** `[確定]`
- 30という数字は「30人が困っている」ではなく「2人が15往復した」である `[確定]`

### 参加者の属性分類

- `sunfish-shogi`（Kubo Ryosuke）= **開発者（メンテナ）** `[確定]`。ただし自身も大会出場経験のある指し手（#236 内 https://github.com/sunfish-shogi/shogihome/issues/236#issuecomment-1362755928 「人間として将棋の大会に出たり奨励会員とも対局をしてきました」）
- `Paalon`（Koki Fushimi）= **研究家兼開発者** `[推定]`。根拠2点:
  - 研究家側: https://github.com/sunfish-shogi/shogihome/issues/236#issuecomment-1304954761 「この図は 4,000 局面ほどで、私が本来可視化しようと思っていた局面のうちの 1/4 くらいです…人間のための定跡の機能でも 16,000 局面はアマ二段くらいの私には必要」— 実際に graphviz で4,000局面の手作り定跡グラフを保有
  - 開発者側: PR #244（+2635行 / 10ファイル）を自力で実装 https://github.com/sunfish-shogi/shogihome/pull/244
- **つまり「研究家の生の声」としてこの issue が提供しているのは、実質1名分である** `[確定]`

---

## 需要の証拠（軸ごと）

### 軸A: 独立した研究家の生の声（最重要 / 一次）

**A-1. トップアマからのヒアリング — obs-shogi の問題設定とほぼ同一** `[確定]`

出典: https://github.com/sunfish-shogi/shogihome/issues/236#issuecomment-1354594965 (2022-12-16) および issue https://github.com/sunfish-shogi/shogihome/issues/271 (2022-12-16)
発言者属性: ShogiHome メンテナが「AIを活用して最新定跡を研究されているトップアマの方」からヒアリングした内容を転記したもの（**伝聞だが、記録者は当事者メンテナ**）

原文:

> 先日、AIを活用して最新定跡を研究されているトップアマの方に将棋のGUIアプリの利用についてヒアリングする機会がありました。
> その方によれば、戦型別に1つの棋譜ファイルに分岐を作りコメントに検討した結果等を書き込んでいるということでした。
> **別の経路で局面が合流するような場合にどの分岐にコメントをしたかわからなくなってしまうことはあるので、他の分岐の同一局面へジャンプできる機能があると良い**という意見をいただきました。
> その方は将棋GUIを使っているそうですが、定跡編集機能は使っていないということでした。

**この1件が P-004 の最も強い単独証拠である。** 理由:

- Paalon とは独立した人物（研究家であって開発者ではない）
- 「注釈（コメント）を手に紐付けているせいで、合流したときにどこに書いたか分からなくなる」= obs-shogi が想定している痛みと**逐語的に一致**
- ただし**この人が要求したのは「ジャンプ機能」であって DAG ではない** `[確定]`
- 併記: この人は定跡編集機能を使っていない（＝Paalon 型の定跡グラフ需要は持っていない）

issue #271 本文（メンテナ起票、2022-12-16）:

> 現代角換わりなどの研究をしていると、別の経路で同一局面に至ることが珍しくありません。
> 他の経路の同一局面を一覧表示してジャンプできるような機能の開発を検討します。

**A-2. Paalon 自身の実践** `[確定]`
出典: https://github.com/sunfish-shogi/shogihome/issues/236#issuecomment-1304954761 (2022-11-07)

> 手作業で編集した局面数が 1000 以上あるような定跡データを GraphViz で静的に可視化したり…（別コメント）
> この図は 4,000 局面ほどで…少なくともソフトウェアとして、100,000 局面くらいは扱える機能が必要
> **小規模な定跡は既存の棋譜の木構造の機能でもユーザはあまり不満足に感じることはないと思いますが、それ以上を可視化しようとすると、困難が生じると思います。**

最後の一文は本人による**需要の上限の自己申告**でもある（小規模ならツリーで足りる）。

**A-3. 自力で同一局面検索を実装したユーザー** `[確定]`
出典: https://touch-sp.hatenablog.com/entry/2021/07/14/162202 (2021-07-14, 著者 touch-sp)
自分の棋譜（激指との対局）に対して SFEN 変換＋正規表現で同一局面検索する Python を自作。
※ ただしこれは**棋譜ファイル横断**の同一局面検索であり、1ファイル内の分岐合流の話ではない。obs-shogi の「堀＝横断検索」側の証拠としては有効だが、DAG の証拠としては弱い。

**A-4. 同一局面検索は古くからの研究手法** `[確定]`（ただし日付不明）
出典: http://www2.ttcn.ne.jp/tsuma/kenkyu.htm （HTTPS 不可。HTTP のみ）

> そして、私独自の研究方法（同一局面検索）を編み出したのです。
> 同一局面検索は、赤富士にもあるのですが、その棋譜を見つけだすだけで、私はそれにその局面で誰がどういう手を指したか表示するようにしたのです。

PC-98 期（赤富士＝1980年代末〜90年代）から「同一局面検索」は研究手法として存在した。→ 局面同一性への関心自体は将棋研究に**古くから根付いている** `[確定]`。ただしこれもデータベース横断であって棋譜内合流ではない。

### 軸B: 他リポジトリ軸 — ほぼ空振り `[確定]`

すべて `gh api search/issues` の実測。

| リポジトリ                | クエリ          | ヒット                                    | 内容                                       |
| ------------------------- | --------------- | ----------------------------------------- | ------------------------------------------ |
| `WandererXII/lishogi`     | `transposition` | **0**                                     | —                                          |
| `WandererXII/lishogi`     | `合流`          | 1                                         | #470 駒落ち戦の宣言法（無関係）            |
| `WandererXII/lishogi`     | `book` (title)  | **0**                                     | —                                          |
| `yaneurao/YaneuraOu`      | `合流`          | 5                                         | 全て無関係（segfault, 定跡マージツール等） |
| `TadaoYamaoka/cshogi`     | `定跡`          | **0**                                     | —                                          |
| `gunyarakun/python-shogi` | `book`          | **0**                                     | —                                          |
| `na2hiro/Kifu-for-JS`     | `合流`          | 0（`分岐` は2件、いずれもツリー分岐の話） | —                                          |

さらに `gh api search/repositories`:

- `shogi kifu graph dag in:readme` → 実質 **0件**（無関係な1件のみ）`[確定]`
- **将棋の棋譜を DAG として持つ OSS 実装は GitHub 上に存在しない** `[確定]`

→ これは両義的。先行実装がない＝差別化余地、とも読めるし、誰も必要としていない、とも読める。単独では需要の証拠にならない。

### 軸C: チェス側の隣接軸

**C-1. lichess/lila の transposition 系 issue（実測）** `[確定]`

| issue                                                                                                          | 開設日     | 状態                | 👍等リアクション | コメント |
| -------------------------------------------------------------------------------------------------------------- | ---------- | ------------------- | ---------------- | -------- |
| [#12928 Study: Add the possibility to handle Transpositions](https://github.com/lichess-org/lila/issues/12928) | 2023-05-29 | **open（3年放置）** | **3**            | **1**    |
| [#17458 Improve /opening's handling of transpositions](https://github.com/lichess-org/lila/issues/17458)       | 2025-05-03 | open                | 1                | 1        |
| [#8118 [Feature] Opening Trainer](https://github.com/lichess-org/lila/issues/8118)                             | 2021-02-08 | open                | **78**           | 11       |

#12928 本文（起票者 `poettler-ric`、レパートリー作成者）:

> I am using a Study to build my repertoire. Often there are transpositions from one position/opening/variation to another one. It would be nice if there was some kind of automatism to detect and handle those **instead of manually keeping track of them and noting them in handwritten comments**.
>
> - It would be nice if it were possible to click on the transposition and it takes me to the tree it links to

**「手書きコメントで手動追跡している」＝ A-1 の将棋トップアマの証言と完全に同型** `[確定]`。将棋固有の問題ではなく、木構造で棋譜を持つ全てのツールに共通する問題であることが確認できた。

一方で **#8118（Opening Trainer, 78リアクション）が #12928（3リアクション）の26倍**という比率は重要。チェス界でも「合流を扱う」より「レパートリーを暗記させる」ほうが遥かに大きい需要である `[確定]`。#8118 の本文には要件の1行として `- Handle transposition.` が入っており、**合流対応は主要機能ではなく主要機能の付帯要件として現れる** `[確定]`。

**C-2. en-croissant（Tauri + React 製チェス GUI = obs-shogi と同一スタックの直接類似物）** `[確定]`

[#849 Repertoire: Transpositions are not being handled properly.](https://github.com/franciscoBSalgueiro/en-croissant/issues/849) (2026-06-17 起票, `home15c6`, open, リアクション1, コメント1)

> When a position has 100% coverage, any transposition (from a different move order) should be handled similarly. But when the same position is reached via transposition, it doesn't behave well: Showing 0% coverage / "Go to your biggest gap" still refers to that position / "Your response" doesn't pick up responses from the original position.
> **The "Go to your biggest gap" is the biggest issue. It prevents users from detecting the real gap.**

コメント（`davorzdralo`, 2026-07-06, https://github.com/franciscoBSalgueiro/en-croissant/issues/849#issuecomment-4892253461）:

> I have the exact same problem. It would be nice to merge that fix by @VTrngNghia if it works correctly.

→ 独立2名が同じ痛みを訴え、既にパッチ提案が存在。**「合流未対応は実際にバグとして表面化する」ことの一次証拠** `[確定]`。ただしこれも**レパートリー訓練機能の文脈**であり、注釈の紐付け先の話ではない。

**C-3. ChessBase — 合流は「データベース結合レベルでは標準機能、レパートリー訓練レベルでは未解決」** `[確定]`

一次: https://help.chessbase.com/CBase/18/Eng/merging_transpositions.htm （ChessBase 18 公式ヘルプ）

- `File → Options → Misc` に **"Merge transpositions"** 設定が存在
- 複数の対局を1つの variation tree に統合する際、`1.e4 d6 2.d4 d5` と `1.d4 d6 2.e4 d5` のように**別手順で同一局面に到達する対局を統合するか**を選択できる
- → **チェスでは30年以上前から商用標準機能である** `[確定]`

しかし訓練側は未解決。一次: https://lichess.org/forum/general-chess-discussion/chessbase-repertoire-training-transpositions-not-merging （投稿者 `clementeen`、8投稿、日付はページ上に非表示 `[未確認]`）

> When I create repertoire lines that transpose to the same position via different move orders, ChessBase treats them as completely separate lines during Replay Training. **This means I have to practice the same continuation multiple times, once for each move order, which is ridiculous.**
> This seems like basic functionality for repertoire training software.
> I've contacted ChessBase support three times without response.

他の投稿者の回避策:

- `TheMagnusAura`: ChessBase には Chessable の movetrainer に相当する機能がない
- `TotalNoob69`: LiChess Tools ブラウザ拡張なら PGN 内の合流を正しく扱える
- `dn69`: Polyglot / Arena / Fritz のエンジン定跡形式を使う

**将棋への含意** `[推定]`（根拠: C-1〜C-3）:

1. 合流の痛みは**盤ゲーム共通の構造的問題**であり、将棋固有の妄想ではない → P-004 の方向性自体は妥当
2. チェスは**局面キーのデータベース**（ChessBase の統合、Polyglot book）で解いており、**棋譜フォーマット（PGN）自体は依然としてツリーのまま** → 「棋譜を DAG にする」という解法はチェス側でも採られていない `[確定]`
3. 需要の相対的な大きさは、暗記トレーナー ≫ 合流対応（78 vs 3）

### 軸D: フォーマット軸 → [フォーマット仕様の一次確認](#フォーマット仕様の一次確認kifki2csajkf-が合流を持てないことの出典) を参照

### 軸E: 実利用軸（ブログ・note）

**E-1. ShogiHome メンテナ自身のリリース記事（最重要の実利用証拠）** `[確定]`
出典: https://note.com/ryosuke_kubo/n/n0c3e23ccfc01 「ShogiHome v1.25.0 リリースと関連ニュース」2025年9月7日 00:18、著者 Kubo Ryosuke（＝sunfish-shogi）

> **棋譜の分岐が手順前後で合流したり、あるいは千日手によって 1 つの棋譜ファイルのなかで同一局面が現れる場合があります。**そういった棋譜中の同一局面を自動で検出する機能が加わりました。
> 同一局面が存在する場合は棋譜エリアの該当箇所に「同一局面」というボタンが表示され、ボタンを押すと同一局面発生箇所の一覧が表示されます。
> 一覧にはその局面に至るまでの通過した分岐や手数が表示され、各局面へジャンプすることが可能です。
> またメニューバーの「同一局面を検索」メニューで、すべての同一局面の組みを列挙することも可能です。

そして記事末尾:

> 今回のアップデートでは**開発者が個人的に重要視していたマージ機能と同一局面検出機能**が加わりました。**他の将棋アプリではあまり見かけない機能**が増え、独自性を感じられる部分も多くなったのではないかと思います。

→ 2022年に「あまり需要無さそう」と切ったメンテナが、**2025年には自ら最重要視して実装し、差別化ポイントとして訴求している** `[確定]`。P-004 に対する最も強い支持証拠。

**E-2. 検索したが見つからなかったもの** `[未確認]`

- 一般ユーザー（メンテナ・起票者以外）が「合流が扱えなくて困る」と書いた note / ブログ / X の投稿は**発見できなかった**
- ShogiHome v1.25.0 の同一局面検出機能に対するユーザー側の感想記事も**発見できなかった**（リリースから約10か月経過）
- → 「困っている頻度」の実測は**できていない**。ここが本調査の最大の穴。

### 軸F: 定跡研究の実務軸 — 「手順前後」の語義に落とし穴 `[確定]`

「手順前後」は将棋用語として一般的である（Weblio・将棋講座ドットコム等に見出し語として存在）。しかし**その主たる語義は「合流」ではない**。

一次: https://xn--pet04dr1n5x9a.com/将棋用語/手順前後.html （将棋講座ドットコム、更新日表示なし）

> AとBの２つの候補手がある局面で、先にAを指してからBを指す手順と、先にBを指してからAを指す手順のこと。
> **そのどちらかの手順は成立するが、もう一方の手順は成立しないことが多い。**

つまり将棋の実務用語としての「手順前後」は、**順序を変えると成立しなくなる（＝合流しない）**ケースを指すことが多い。「同じ局面に合流する」意味で使われるのは、むしろソフト実装側の用法である。

対照的に ShogiHome 側では両義で使われている:

- 合流の意味: note 記事「棋譜の分岐が**手順前後で合流**したり」`[確定]`
- 入力ミスの意味: issue [#684](https://github.com/sunfish-shogi/shogihome/issues/684)「手順前後を修正する機能（棋譜の切り貼り機能）」、note 記事「棋譜入力中に間違えてしまった手順前後を修正することも可能です」`[確定]`

**含意**: 「手順前後は将棋で頻出の概念だから合流も頻出のはず」という推論は**成立しない**。むしろ「手順前後＝順序が効く＝合流しない」が将棋の一般的な語感である。この点は需要見積もりを下方修正する材料。

---

## 反証側の証拠

### R-1. #236 の議論はコミュニティ需要の証拠になっていない `[確定]`

ユニーク参加者2名、issue リアクション0、30コメント中のリアクション計1。上記「実測」節参照。

### R-2. メンテナによる明示的な需要否定（複数回・原文） `[確定]`

https://github.com/sunfish-shogi/shogihome/issues/236#issuecomment-1304632857 (2022-11-05) — ユースケースを3分類した上で:

> - 人間のための定跡研究
>   - 強いプレイヤー（プロやアマ強豪）が自分の対局、あるいは書籍の執筆などを目的に行う。
>   - 未知の領域を開拓したり、複雑な分岐を整理する作業。
>   - **ループ（千日手）や合流を表現する必要性は薄いと思われる。**
>   - 一度に大量のデータを扱う必要はない。
> - 既存の定跡の勉強
>   - **ループ（千日手）や合流を図示することが、多少役に立つケースもあるのかもしれない。**

https://github.com/sunfish-shogi/shogihome/issues/236#issuecomment-1304497281 (2022-11-05):

> 将棋の場合、単なる合流だけでなく、手の間合いを測ることによる迂回や循環（千日手）は確かにあります。
> **しかし、定跡を検討する場合、そのほとんどは開始局面から最短で到達する経路をメインに考えればよく**、この図のように開始局面からの最短手数によるヒエラルキーで配置するのが良い気がします。

→ **「合流は存在するが、最短経路を主経路として木で並べれば実用上足りる」**という具体的な反論。DAG 不要論の中核。

https://github.com/sunfish-shogi/shogihome/issues/236#issuecomment-1362755928 (2022-12-22):

> **そもそも私は定跡を熱心に編集するユーザーがそれほど居ないと考えています。**
> 特別に定跡編集に熱心な sumon_fan さんや、くらっきぃさんは例外だと思いますが私が知る多くの将棋関係者や将棋AI関係者の中でも**相当なレアケース**です。

### R-3. #271（合流通知機能）は「需要無さそう」で一度クローズされ2年以上放置された `[確定]`

https://github.com/sunfish-shogi/shogihome/issues/271#issuecomment-1537343085 (2023-05-07):

> **あまり需要無さそうな感じがするので、いったんクローズして必要があればまたの機会に検討します。**

トップアマから直接ヒアリングした要望（A-1）ですら、メンテナ判断で2年以上棚上げされた。

### R-4. 実装済みプロトタイプが13か月後に未マージクローズ `[確定]`

[PR #244「定跡グラフの操作」](https://github.com/sunfish-shogi/shogihome/pull/244)（Paalon, 2022-11-04 開設）: **+2635行 / -37行 / 10ファイル**、`merged=false`、2023-12-10 クローズ。

マージ拒否の判断基準（原文）https://github.com/sunfish-shogi/shogihome/issues/236#issuecomment-1359481228 (2022-12-20):

> 大型の機能開発なので以下の観点が整理されて合意できていないと取り込めない可能性が高いです。
>
> - どのような UI, UX を提供するのか / 需要があるものか / アウトカムが期待できるのか …

https://github.com/sunfish-shogi/shogihome/issues/236#issuecomment-1361225880 (2022-12-21):

> **なぜ十分に利用されるような想定ができるのかもっと客観的な情報を頂きたいです。**
> Paalon さんの研究スタイルに求められる機能であることはわかったのですが、これまでそれ以外の情報が十分になく、私自信が必要性を感じていないので現時点で機能開発に着手することはできません。

→ **obs-shogi が今まさに直面しているのと同じ問い**を、3年半前に同じ領域で誰かが突きつけられ、答えられずに終わっている。

### R-5. 「コミュニティが本当に議論したこと」との比較 `[確定]`

コメント数1位は #294「二文字駒を用意する」= 40コメント・4名。駒画像 > 定跡グラフ。全505 issue の平均コメント数は 1.09。

### R-6. メンテナが名指しした「定跡編集に熱心なレアケース」本人が合流に言及していない `[確定]`（不在の証拠）

sunfish が R-2 で「くらっきぃさん」を熱心な定跡編集者の例に挙げているが、当人の序盤研究方法解説記事 https://note.com/spiritual_sh/n/n4379b5a4b536 （2021-03-17）には**合流・同一局面・手順前後・分岐管理への言及が一切ない**。痛点として挙げられているのはマシン性能と評価関数の得意不得意。
※「書いていない」は「困っていない」の証明にはならないが、最有力候補ユーザーの一次記述に痛みが現れないことは弱い反証。

### R-7. チェス側でも合流対応の需要順位は高くない `[確定]`

lila #12928（合流）: 3年 open・👍3・コメント1 / lila #8118（暗記トレーナー）: 👍78・コメント11。

### R-8. **決定的反証: ShogiHome は DAG を作らずに同じ痛みを解消して出荷済み** `[確定]`

タイムライン（全て一次で確認）:

| 日付           | 出来事                                                                                                 | 出典                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 2022-12-16     | #271 起票（トップアマの要望）                                                                          | https://github.com/sunfish-shogi/shogihome/issues/271                         |
| 2023-05-07     | #236 / #271 ともにクローズ（需要なし判断）                                                             | issue comments                                                                |
| 2023-11-30     | #684「手順前後を修正する機能（棋譜の切り貼り機能）」起票                                               | https://github.com/sunfish-shogi/shogihome/issues/684                         |
| 2025-08-03     | PR #1290「棋譜の途中からコピー・マージする機能」マージ（#684 解決）                                    | https://github.com/sunfish-shogi/shogihome/pull/1290                          |
| **2025-08-05** | **#271 に実装方針コメント**                                                                            | https://github.com/sunfish-shogi/shogihome/issues/271#issuecomment-3155678109 |
| 2025-08-11〜14 | PR #1298「棋譜中の同一局面を検出する機能」マージ、#271 クローズ（completed）                           | https://github.com/sunfish-shogi/shogihome/pull/1298                          |
| 2025-09-06     | v1.25.0 リリース                                                                                       | https://github.com/sunfish-shogi/shogihome/releases/tag/v1.25.0               |
| 2026-07-26     | #1701 「同一局面の一覧画面のレイアウトがスマートフォンブラウザで崩れる問題」= 機能は現役で使われている | https://github.com/sunfish-shogi/shogihome/issues/1701                        |

**採用された実装方針（原文ママ）** — https://github.com/sunfish-shogi/shogihome/issues/271#issuecomment-3155678109 (2025-08-05):

> 棋譜のマージ機能を実装したことにより、同一局面を探したいケースも出てきそうなので改めて実装方法を検討する。
> **リアルタイムに同一局面の有無を表示するなら、 SFEN をキーにして該当局面のノードの個数を Map に持つイメージ。**
> **Record クラスのノードが追加・削除されたイベントを受け取り更新していく必要がある。**

**これは DAG ではない。** 棋譜のデータ構造は木（`Record` のノードツリー）のまま維持され、その**上に** `Map<SFEN, ノード群>` という副次インデックスを載せただけである。注釈（コメント）の紐付け先は「手」のまま変わっていない。UI としては「同一局面」ボタン → 一覧 → ジャンプ、という A-1 のトップアマが要望した通りのものになった。

PR #1298 の変更内容（自動生成リリースノートより）:

> - Added "Search Duplicate Positions" menu action and dialog listing duplicate positions with counts, previews, and navigation.
> - Added a dialog to show all occurrences of a position and jump to a selected occurrence.
> - Record view shows a duplicate-position button next to moves/branches when duplicates exist.
> - Exposed position counts and a direct node-navigation action in the store.
> - Added a user setting "Live Duplicate Position Detection" (enabled by default).

**Q-002 への含意（最重要）**: 同じ問題領域で、より大きなユーザーベースを持ち、より長く運用されているソフトが、**DAG 化を明示的に検討した上で（#236/#240 で3年かけて議論した上で）却下し、ツリー＋SFEN索引を選び、出荷し、差別化ポイントとして訴求している**。obs-shogi が DAG 大工事に踏み切る前に、この選択が不十分である理由を具体的に言えなければならない。

---

## チェス側の先例（合流をどう扱っているか。将棋への含意）

上記 軸C に集約。要点のみ再掲:

| ツール                          | 合流の扱い                                                                                                                            | 一次出典                                                                                                    | 等級     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------- |
| ChessBase 18                    | `File→Options→Misc` に "Merge transpositions"。複数対局を variation tree に統合する際、別手順で同一局面に至るものを統合するか選択可能 | https://help.chessbase.com/CBase/18/Eng/merging_transpositions.htm                                          | `[確定]` |
| ChessBase 18 の Replay Training | **未対応**。同一局面でも手順ごとに別ラインとして反復させられる                                                                        | https://lichess.org/forum/general-chess-discussion/chessbase-repertoire-training-transpositions-not-merging | `[確定]` |
| lichess Study                   | **未対応**。手書きコメントで手動追跡している。3年放置の open issue                                                                    | https://github.com/lichess-org/lila/issues/12928                                                            | `[確定]` |
| lichess /opening                | **未対応**。同一局面でも手順が違うと別ページ扱い                                                                                      | https://github.com/lichess-org/lila/issues/17458                                                            | `[確定]` |
| En Croissant                    | レパートリー機能で**バグとして表面化**（カバレッジ0%誤判定）                                                                          | https://github.com/franciscoBSalgueiro/en-croissant/issues/849                                              | `[確定]` |
| Chessable / LiChess Tools 拡張  | 合流を扱えるとフォーラムで言及                                                                                                        | 同上フォーラム（三次情報の紹介）                                                                            | `[推定]` |
| PGN フォーマット自体            | **ツリーのまま。DAG 化されていない**                                                                                                  | —                                                                                                           | `[確定]` |

**将棋への含意** `[推定]`:

1. 痛みは実在し普遍的。将棋固有の思い込みではない → P-004 の方向性は妥当
2. **チェス30年の歴史でも、解法は「局面キーのDB／インデックス」であって「棋譜フォーマットのDAG化」ではない**。PGN は今もツリー。これは Q-002 に対する外部からの独立した反証
3. 需要の相対順位は暗記トレーナー ≫ 合流対応（👍78 vs 👍3）
4. 「合流対応」が単体機能として売れるのではなく、**レパートリー訓練／カバレッジ計算という上位機能があって初めてバグとして顕在化する**（en-croissant #849 がまさにこれ）。obs-shogi に上位機能がないなら、合流対応の価値は出にくい

---

## フォーマット仕様の一次確認（KIF/KI2/CSA/JKF が合流を持てないことの出典）

### KIF `[確定]`

一次: 柿木義一「棋譜ファイル KIF 形式」更新 2024/08/02 http://kakinoki.o.oo7.jp/kif_format.html
Wayback: https://web.archive.org/web/20241115230917/http://kakinoki.o.oo7.jp/kif_format.html

全文（HTMLタグ除去後、UTF-8）を機械的に検査した結果:

- 「**変化**」の出現回数: **0**
- 「**分岐**」の出現回数: **0**
- （対照: 「コメント」7回、「しおり」4回 → 検査自体は正しく動作している）

→ **公式 KIF 仕様には分岐（変化）の規定がそもそも存在しない**。14節構成で、9節が指し手表記、12節が指し手コメント、13節がしおり。合流以前に分岐が仕様外である。

実際に流通している `変化：N手` 記法は**デファクト拡張**であり、その文法は実装側にしかない。一次実装:
https://github.com/na2hiro/Kifu-for-JS/blob/master/packages/json-kifu-format/src/peg/kif-parser.pegjs

```
(L225) fork = "変化：" " "* te:[0-9]+ "手" nl moves:moves {return {te:parseInt(te.join("")), moves:moves.slice(1)}}
```

そして L129-138 で `forkStack` を使い、`move.forks.push(nowFork.moves)` として**単一の親の手に配列としてぶら下げる**。分岐は必ず1つの親の手に属し、既存ノードを指す手段がない → **構造的にツリーしか表現できない** `[確定]`。

### KI2 `[確定]`

柿木公式サイト（http://kakinoki.o.oo7.jp/ のリンク一覧を実測）には「棋譜ファイル KIF 形式」のみが掲載されており、**KI2 の公式仕様書ページは存在しない** `[確定]`。
デファクト文法は KIF と同一構造:
https://github.com/na2hiro/Kifu-for-JS/blob/master/packages/json-kifu-format/src/peg/ki2-parser.pegjs

```
(L213) fork = "変化：" " "* te:[0-9]+ "手" nl moves:moves {...}
```

L125-134 の forkStack 処理も KIF と同一 → **ツリーのみ** `[確定]`。

### CSA `[確定]`

一次: CSA標準棋譜ファイル形式 V2.2（第6版 2008年1月12日 CSA理事会決定）http://www2.computer-shogi.org/protocol/record_v22.html
（ISO-2022-JP エンコード。Wayback: https://web.archive.org/web/2024/http://www2.computer-shogi.org/protocol/record_v22.html）

2.1 概要より（原文）:

> 棋譜ファイルは、次のデータから成る。(1)バージョン (2)棋譜情報 (3)開始局面(持駒、手番を含む) (4)指し手と消費時間 (5)コメント
> セパレータ("/"だけの行)をはさんで、これらデータを繰り返し、複数の棋譜や局面を示すことができる。

2.6 指し手と消費時間より:

> 1手の指し手を1行とし、次の行にその指し手で消費した時間を示す。

→ **指し手は完全に線形**。分岐記法は仕様に存在しない（全文に「変化」「分岐」の記述なし）。複数の棋譜は `/` で区切って**並置**できるだけで、木にも合流にもならない `[確定]`。
実装側でも: https://github.com/na2hiro/Kifu-for-JS/blob/master/packages/json-kifu-format/src/peg/csa-parser.pegjs には `fork` 規則が**1つも存在しない** `[確定]`。

### JKF `[確定]`

一次: https://github.com/na2hiro/json-kifu-format#json%E3%81%AE%E5%BD%A2%E5%BC%8F-version-10 （現在は https://github.com/na2hiro/Kifu-for-JS/tree/master/packages/json-kifu-format に移動）

> moves `MoveFormat[]` n番目はn手目の棋譜(0番目は初期局面のコメント用)
>
> `MoveFormat` 指し手を表す
>
> - comments? `string[]` コメント
> - move? 駒の動き …
> - **forks? `MoveFormat[][]` 任意の長さの分岐を任意個格納する．分岐の初手はこのforksを持つ棋譜の代替の手とする(次の手ではなく)**

→ `forks` は**入れ子配列**であり、ノードに ID がない。ある分岐が別の分岐の途中ノードを指す表現手段が型として存在しない → **合流は表現不可能** `[確定]`。
また comments は `MoveFormat`（＝手）に付く。**注釈は構造上「手」に紐付いており「局面」ではない** `[確定]`。これが obs-shogi の Q-002 が問題視している点そのもの。

### USI `[確定]`

`position startpos moves 7g7f 3c3d ...` の単一系列。分岐概念なし。（USI プロトコル仕様。やねうら王側の拡張命令は `docs/USI拡張コマンド.txt` にあるが棋譜分岐の拡張はない）`[推定]`（USI 公式仕様原文の逐語確認までは行っていない）

---

## 「定跡は局面キー＝DAG、棋譜はツリー」の非対称は実在するか

**実在する。一次で確認済み。** `[確定]`

### 定跡側は SFEN キー（＝実質 DAG）

やねうら王のメモリ上の定跡データ構造（原文ママ）:
https://github.com/yaneurao/YaneuraOu/blob/master/source/book/book.h

```cpp
// L24
static const char* BookDBHeader2016_100 = "#YANEURAOU-DB2016 1.00";
// L48  将棋ソフト用の標準定跡ファイルフォーマットの提案 : http://yaneuraou.yaneu.com/2016/02/05/standard-shogi-book-format/
// L166-167
// sfen文字列からBookMovesPtrへの写像。(これが定跡データがメモリ上に存在するときの構造)
typedef std::unordered_map<std::string /* sfen */, BookMovesPtr > BookType;
// L169-170
// メモリ上にある定跡ファイル
// ・sfen文字列をkeyとして、局面の指し手へ変換するのが主な役割。
```

→ **キーが SFEN（局面）である以上、到達経路に関わらず同一局面は同一エントリ。定義上 DAG（かつ循環も表現できる）** `[確定]`

ShogiGUI も同様に局面単位: https://sites.google.com/site/shogigui/マニュアル/定跡

> 定跡タブ：**現在の局面の指し手など**が表示されます。
> （定跡ツリーのコンテキストメニュー）**その局面の指し手を全て削除します。**

しかも ShogiGUI は 棋譜用の「ツリーダイアグラム（樹形図）ウインドウ」と 定跡用の「定跡ツリーウインドウ」を**別々に持っている** `[確定]`（同マニュアルのサイドナビ）。非対称がそのまま UI に現れている。

### 棋譜側はツリー

前節の通り KIF/KI2/CSA/JKF/USI いずれも合流不可 `[確定]`。

### 非対称はメンテナ自身が明言している `[確定]`

issue #240「内部で使用する定跡データの実装」（2022-11-02）

Paalon — https://github.com/sunfish-shogi/shogihome/issues/240#issuecomment-1299912596 :

> [Record](.../src/shogi/record.ts#L315) では一般の定跡（トポロジカルに非連結なグラフなどを含む）を表現できないので、定跡の型（クラスやインターフェイスなど）を作成する必要がある。

sunfish-shogi の返答 — https://github.com/sunfish-shogi/shogihome/issues/240#issuecomment-1300343419 :

> ご指摘の通り、 **Record クラスは定跡を表現するために作られていないので、 SFEN やハッシュ値をベースにグラフを表現するデータ構造が別で必要です。**

→ ShogiHome は **Record（棋譜＝ツリー）と Book（定跡＝SFEN キーのグラフ）という2つの別ドメインを内部に持つ**という設計判断を明示的に下している `[確定]`。

そして Paalon の主張の核心（https://github.com/sunfish-shogi/shogihome/issues/236#issuecomment-1360497139, 2022-12-20）:

> https://github.com/sunfish-shogi/electron-shogi/issues/271 の機能は「棋譜」で合流を扱う機能ですが、現状の「棋譜」だと分岐や合流の可視化ができていないので、その機能が必要と考えています。

**結論**: 非対称は実在し、当事者に自覚もされている。しかし ShogiHome が選んだ解は「棋譜を DAG にする」ではなく「**2つのドメインを分けたまま、棋譜側に SFEN インデックスを載せて橋を架ける**」だった。この選択は 2025年に実装され現在も運用されている。

---

## 需要の規模の見積もり

**定量的な見積もりはできない。** 以下が観測できた全ての数字である。推測で埋めない。

| 観測量                                       | 実測値                                           | 出典               |
| -------------------------------------------- | ------------------------------------------------ | ------------------ |
| ShogiHome #236 のユニーク参加者              | 2名                                              | GitHub API         |
| ShogiHome #236 のリアクション                | issue 0 / コメント計 1                           | GitHub API         |
| ShogiHome リポジトリの全 issue               | 505件（PR 1193件別）                             | GitHub API         |
| #236 のコメント数順位                        | 2位 / 505                                        | GitHub API         |
| 独立に「合流で困る」と述べた将棋の研究家     | **1名**（#271 のトップアマ、メンテナ経由の伝聞） | issue #271         |
| 合流可視化を自作した将棋関係者               | 2名（Paalon / junkoda）                          | issue #236, Qiita  |
| lichess #12928（Study 合流）の 👍            | 3（3年間）                                       | GitHub API         |
| lichess #8118（暗記トレーナー）の 👍         | 78                                               | GitHub API         |
| en-croissant #849 の 👍 / 同意コメント       | 1 / 1                                            | GitHub API         |
| 将棋の棋譜を DAG で持つ OSS 実装             | 0件                                              | GitHub repo search |
| ShogiHome 同一局面検出機能のユーザー感想記事 | 0件（発見できず）                                | Web検索            |

**言えること**: 「合流で困る人はゼロではない」は言える。「N人いる」は言えない。
**言えないこと**: 頻度、影響度、支払い意思。**全て `[未確認]`。**

**唯一の間接的な規模指標**: ShogiHome（GitHub ★239、Windows/macOS/Linux 対応の主要 OSS 将棋 GUI）のメンテナが、**3年間の観察の末に**「実装する価値がある」と判断して v1.25.0 に入れた。これは「ゼロではない」の上限としてはかなり強い。ただしその実装は**約2週間・1PR で完了している**（#1290 が 2025-08-03、#1298 が 2025-08-11〜14）。つまり**「価値がある」と「大工事に値する」の間には大きな距離がある**。

---

## 試した検索語の全リスト（失敗も含む。軸ごと）

### GitHub（`gh api search/issues` / `search/repositories` / `search/code`）

成功 = 関連ヒットあり、空振り = 0件または全て無関係

| クエリ                                                                                                                                   | 結果                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `gh search repos shogihome`                                                                                                              | 成功（`sunfish-shogi/shogihome` 特定）                         |
| `repos/sunfish-shogi/shogihome/issues?state=all` --paginate（全1698件）                                                                  | 成功（順位算出）                                               |
| リポジトリ内 title フィルタ: 合流 / 転換 / 千日手 / グラフ / graph / transpos / DAG / マージ / merge / 同一局面 / 手順前後 / 循環 / loop | 成功（#236 #271 #684 #1290 #1298 #1701 #244 #245 #240 を特定） |
| `repo:sunfish-shogi/shogihome 271 in:body`                                                                                               | 成功（PR #1298 特定）                                          |
| `repo:WandererXII/lishogi transposition`                                                                                                 | **空振り（0件）**                                              |
| `repo:WandererXII/lishogi 合流`                                                                                                          | 空振り（1件・無関係）                                          |
| `repo:WandererXII/lishogi in:title book`                                                                                                 | **空振り（0件）**                                              |
| `repo:lichess-org/lila transposition`                                                                                                    | 成功（14件、#12928 #17458 #8118）                              |
| `repo:lichess-org/lila transposition in:title`                                                                                           | 空振り（0件）                                                  |
| `repo:lichess-org/lila transpose in:title`                                                                                               | 成功（3件）                                                    |
| `repo:lichess-org/lila repertoire transposition`                                                                                         | 成功（2件）                                                    |
| `repo:lichess-org/lila transposition in:comments`                                                                                        | 成功（10件、うち関連は薄い）                                   |
| `repo:yaneurao/YaneuraOu 合流`                                                                                                           | 空振り（5件全て無関係）                                        |
| `repo:TadaoYamaoka/cshogi 定跡`                                                                                                          | **空振り（0件）**                                              |
| `repo:gunyarakun/python-shogi book`                                                                                                      | **空振り（0件）**                                              |
| `repo:na2hiro/json-kifu-format 分岐`                                                                                                     | 成功（2件、ツリー分岐のみ）                                    |
| `repo:na2hiro/json-kifu-format 合流`                                                                                                     | 空振り（1件・無関係）                                          |
| `repo:na2hiro/Kifu-for-JS 合流`                                                                                                          | **空振り（0件）**                                              |
| `repo:franciscoBSalgueiro/en-croissant transposition`                                                                                    | 成功（4件、#849）                                              |
| `transposition repertoire in:title state:open`（全GitHub）                                                                               | 空振り（0件）                                                  |
| `transposition repertoire`（全GitHub, reactions降順）                                                                                    | 成功（99件、上位は lila #8118 #12928, en-croissant #849）      |
| `transposition shogi in:title`（全GitHub）                                                                                               | **空振り（0件）**                                              |
| `合流 定跡 in:title`（全GitHub）                                                                                                         | **空振り（0件）**                                              |
| repo検索 `shogi kifu graph dag in:readme`                                                                                                | **空振り（実質0件）**                                          |
| repo検索 `将棋 定跡 グラフ in:readme`                                                                                                    | 空振り（10件、DAG棋譜実装なし）                                |
| repo検索 `shogi transposition in:readme`                                                                                                 | 空振り（72件、全て探索アルゴリズムの transposition table）     |
| `repo:yaneurao/YaneuraOu YANEURAOU-DB2016`（code）                                                                                       | 成功（`source/book/book.h`）                                   |
| `repo:na2hiro/Kifu-for-JS 変化`（code）                                                                                                  | 成功（PEG 文法3件）                                            |

### Web検索

| クエリ                                                                | 結果                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------- |
| `将棋 研究 棋譜 分岐 合流 同じ局面 管理できない`                      | 部分成功（touch-sp, tsuma, mizutama）                   |
| `将棋 定跡 研究 "手順前後" 分岐 整理 note`                            | 空振り（初心者向け定跡学習記事のみ）                    |
| `将棋 棋譜 グラフ 可視化 局面 合流 DAG 定跡`                          | 空振り（ShogiGUI マニュアルのみ収穫）                   |
| `ChessBase transposition opening repertoire feature merge move order` | 成功（公式ヘルプ + lichess フォーラム）                 |
| `"手順前後" 将棋 用語 意味 定跡`                                      | 成功（語義の一次確認）                                  |
| `ShogiHome 同一局面 検出 便利 感想`                                   | **空振り**（ユーザー感想は0件、メンテナ自身の記事のみ） |
| `将棋 研究 ファイル 分岐 多すぎ 管理 大変 定跡ノート note 2025`       | 空振り（くらっきぃ記事のみ収穫）                        |

### 直接取得（curl / WebFetch）

| URL                                                                                                         | 結果                                                  |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| http://www2.computer-shogi.org/protocol/record_v22.html                                                     | 成功（ISO-2022-JP デコード、全文確認）                |
| http://kakinoki.o.oo7.jp/kif_format.html                                                                    | 成功（UTF-8、変化=0回を確認）                         |
| http://kakinoki.o.oo7.jp/ki2_format.html                                                                    | **404（KI2 公式仕様は存在しない）**                   |
| http://kakinoki.o.oo7.jp/KifuwFormat.html                                                                   | 404                                                   |
| http://kakinoki.o.oo7.jp/ （リンク一覧）                                                                    | 成功（棋譜形式仕様は KIF のみと確認）                 |
| https://note.com/ryosuke_kubo/n/n0c3e23ccfc01                                                               | 成功（v1.25.0 リリース記事全文）                      |
| https://help.chessbase.com/CBase/18/Eng/merging_transpositions.htm                                          | 成功                                                  |
| https://lichess.org/forum/general-chess-discussion/chessbase-repertoire-training-transpositions-not-merging | 成功（本文全文取得）                                  |
| https://qiita.com/junkoda/items/2d12ecdd3b4b5c99d994                                                        | 部分成功（2016-10-03, LGTM 31。ただし合流の議論なし） |
| https://sites.google.com/site/shogigui/マニュアル/定跡                                                      | 成功                                                  |
| https://touch-sp.hatenablog.com/entry/2021/07/14/162202                                                     | 成功                                                  |
| http://www2.ttcn.ne.jp/tsuma/kenkyu.htm                                                                     | 成功（HTTPS 不可、HTTP のみ。要 Wayback 併記）        |
| https://mizutama-shogi.hatenablog.com/entry/2018/06/03/234621                                               | 空振り（合流の言及なし）                              |
| https://note.com/spiritual_sh/n/n4379b5a4b536                                                               | 空振り（合流の言及なし＝R-6 の反証材料に）            |
| https://xn--pet04dr1n5x9a.com/将棋用語/手順前後.html                                                        | 成功（語義確認）                                      |

---

## 未解決・人間に見てほしいこと

1. **`[未確認]` 頻度が測れていない。** 「1つの研究棋譜ファイル内で、実際に何%の分岐が合流するのか」を測る手段がある。ShogiHome v1.25.0 の「同一局面を検索」メニューを、手元の実際の研究棋譜（角換わり・相掛かりなど手順前後の多い戦型）に対して回せば、**自分のデータで実測できる**。これは公開情報調査より遥かに強い証拠になる。**これが次にやるべき唯一のこと**だと考える。

2. **`[要判断]` Q-002 の再設計。** ShogiHome の解（Record ツリー維持 + `Map<SFEN, Node[]>` + ジャンプUI、実装コスト約2週間/1PR）が obs-shogi にとって不十分である理由を明示できるか。明示できないなら DAG 化は YAGNI である。特に「注釈を局面に紐付ける」という要件は、`Map<SFEN, Node[]>` があれば「局面キーの注釈テーブルを別に持つ」だけで**木構造を壊さずに実現できる**可能性がある。DAG 化と、注釈テーブルの局面キー化は、**分離可能な2つの決定**かもしれない。

3. **`[未確認]` ShogiHome 実装の中身を読んでいない。** PR #1298 の実際のコード（`Map` の更新イベント処理、大きな棋譜での性能）は未確認。obs-shogi が同等機能を作るときのコスト見積もりに直結する。https://github.com/sunfish-shogi/shogihome/pull/1298

4. **`[禁止事項に抵触するため未実施]` #236 の Paalon 氏は現在も同じ需要を持っているか。** 本人に接触せずに確認する方法として、Paalon 氏の公開リポジトリ（過去4年の活動）を見れば、定跡グラフの取り組みが継続しているか放棄されたかが分かる可能性がある。今回は時間の都合で未実施。

5. **`[未確認]` 日本語圏の生の声がほぼ取れなかった。** X（Twitter）は今回の調査手段では検索できていない。将棋ウォーズ／将棋クエストのコミュニティ、将棋AI系 Discord などクローズドな場に声がある可能性は残る。ただし**現時点で公開の場に声がほぼ無いこと自体が、需要規模の上限を示す情報である**とも読める。

6. **`[注意]` 元の前提文の「二次情報」に事実誤認が2点あった。** (a)「同リポジトリ最多議論」→ 実際は2位、かつ参加者2名。(b)「定跡フォーマット対応のみで閉じられた」→ 実際のクローズ理由は「進展がなくモチベーションが低いための整理クローズ」。**この二次情報の出所を確認し、他の前提も同様に汚染されていないか点検したほうがよい。**

7. **`[保全]` 消えるリスクのあるページ。** `http://www2.ttcn.ne.jp/tsuma/kenkyu.htm`（個人サイト・HTTPS非対応）、`http://kakinoki.o.oo7.jp/kif_format.html`（@nifty ホームページサービス。ミニプランは2025-09-30終了済みと同ドメインの404ページに記載あり＝**消滅リスクが現実的**）。KIF 仕様の Wayback: https://web.archive.org/web/20241115230917/http://kakinoki.o.oo7.jp/kif_format.html
