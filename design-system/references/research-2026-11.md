<!--
出典: Claude Docs「自分のデザインシステムを Claude Code に作らせ、育てる仕組みの設計」
  https://claude.ai/artifact/VYT2gVfcaughxa6MEbKZfv （作成 2026-11-08）
確認日: 2026-11-08 / 書き出し: Markdown エクスポート（図は本文から省略）
ライセンス: 自作の調査メモ。本文中の各出典のライセンスは各リンク先に従う
このファイルは参照用の写し。値・コード・文章をデザインシステム本体へ持ち込まない
-->

# 自分のデザインシステムを Claude Code に作らせ、育てる仕組みの設計

Nov 8, 2026 · @八田理央

## 結論

リポジトリを SKILL にして ./design\_system に本体を置く構成は妥当である。ただし、「正本はトークン JSON とコード、DESIGN.md は生成物、守らせたいことは検査で強制する」という形にするのが、2026年時点の実践から導ける答えだ。価値を確かめるには、AI の自己評価ではなく、このスキルを使う場合と使わない場合の eval 比較と、人の目を使う。

「まだ分かっていないこと」3点への答え：

1. どの層を流用し、どの層をカスタムするか。トークンの階層と命名、アクセシビリティ基準、コンポーネントの振る舞いは、既存のシステムに倣う。ブランドの個性を決めるのは、意味付けトークンに入れる値（色・書体・密度・角丸）と、文言の声である。日本語タイポの下限はデジタル庁デザインシステムに合わせるとよい。他社の値や DESIGN.md をそのまま持ち込まない。
2. どう作り、どう更新するか。初回と大改修では、brief から軸をずらした3案を作り、同じ画面で比べて人が選ぶ。確定後は差分で更新し、検査・画像差分・人の承認を通して、semver と CHANGELOG で記録する。変えるのは正本だけで、DESIGN.md は再生成する。
3. 「良い」とどう確かめるか。三段で確かめる。1段目は機械チェック（WCAG 2.2 AA のコントラスト、トークン外の値の lint、axe、画像差分）。2段目は別モデルによる採点。3段目は、人によるブランド適合の判断。さらに skill-creator や claude plugin eval で、スキルを使う場合と使わない場合の差を測る。

たたき台の構成への修正提案は次のとおり。トークンは DTCG 2025.10 形式にする。components/\_index.md（選定索引）、content/（文言）、explorations/（方向性の候補）、decisions/（ADR）、CHANGELOG.md を足す。利用先プロジェクトの CLAUDE.md にも数行のルールを置く。詳細は「推奨リポジトリ構成」にある。

## 優れたデザインシステムの構造比較

主要な7つのシステムは、どれも「基礎（foundations）→ 基礎トークン → 意味付けトークン → コンポーネント → パターン」という同じ骨格を持つ。違うのは、コンポーネントトークンの層を持つかどうか、配布の形式、そしてライセンスの縛りである。2026年には、多くが AI 向けの入口（MCP、Markdown、AGENTS.md）を足した。

| システム | トークンの層と命名例 | 配布と現行版 | ライセンスの要点 | アクセシビリティ | 2026年の動き |
| --- | --- | --- | --- | --- | --- |
| [デジタル庁 DADS（β）](https://design.digital.go.jp/dads/) | Primitive → Semantic（`{Color.Primitive.Blue.500}`、`Semantic.Success.1`）。タイポは `Std-16N-170` のように「サイズ・太さ・行間」を名前に含める | v2.18.2（最終更新 2026-10-21）。Figma、npm [@digital-go-jp/design-tokens](https://github.com/digital-go-jp/design-tokens)、React/HTML 例、AI 向け Markdown zip | サイトの文章は出典を表示し、編集した場合はその旨を明記する。Figma データは CC BY 4.0、コードは MIT（[ご利用にあたって](https://design.digital.go.jp/dads/introduction/notices/)） | JIS X 8341-3:2016 AA を目標にし、WCAG 2.1/2.2 の基準を順次追加。文字 4.5:1、文字以外 3:1 | 2026-10 に使い方ページを約17件追加。React 例に AGENTS.md と .agents/skills/。公式 MCP は未確認 |
| [GOV.UK](https://design-system.service.gov.uk/) | トークンという層名はない。Sass 関数で「パレット」と「用途」を分ける（`govuk-colour("blue")` と `govuk-functional-colour("error")`） | govuk-frontend v6.6.0（2026-10-15） | コードは MIT。GDS Transport 書体は service.gov.uk 上のサービスに限る（[typeface](https://design-system.service.gov.uk/styles/typeface/)） | WCAG 2.2 AA | v6.0.0（2026-02-09）で新しい文字サイズ体系を既定にし、最小を 16px にした |
| [Material 3](https://github.com/material-components/material-web/blob/main/docs/theming/README.md) | reference → system → component（`--md-ref-typeface-brand`、`--md-sys-color-primary`、`--md-filled-button-container-color`） | @material/web v2.5.0（2026-07-15）。README に「メンテナンスモード」と明記 | Apache-2.0 | 公式サイトが表示できず未確認 | 公式の DTCG 出力は未確認 |
| [IBM Carbon](https://carbondesignsystem.com/elements/themes/overview/) | パレット → テーマトークン（`$text-primary`、`$layer-01`）。White/G10/G90/G100 の4テーマ | v11.120.0（2026-11-04） | Apache-2.0 | WCAG AA、Section 508、EU 基準を含む IBM のチェックリスト | [Carbon MCP](https://carbondesignsystem.com/developing/carbon-mcp/overview/) の文書（2026-09-28） |
| [GitHub Primer](https://primer.style/product/primitives/token-names/) | Base → Functional → Component の3層を明示（`base-color-green-5` → `fgColor-default` → `button-primary-bgColor-hover`） | @primer/primitives 11.10.0、@primer/react 38.45.0。Style Dictionary でビルド | MIT | 製品ごとの適合報告は WCAG 2.2 A/AA | [@primer/mcp](https://primer.style/product/getting-started/foundations/mcp)。トークンに LLM 向けの使用法を `org.primer.llm` 拡張で埋め込む |
| [Shopify Polaris](https://github.com/Shopify/polaris) | 旧：foundations・tokens・components・patterns・content | Web Components 版に移行し、React 版リポジトリは 2026-09-11 にアーカイブ | MIT ベースだが、Shopify と連携するアプリでの利用に限定 | 未確認 | React 版を廃止 |
| [Atlassian ADS](https://atlassian.design/foundations/tokens/design-tokens) | foundation.property.modifier（`color.text.subtle`、`color.icon.success`）。light/dark/high contrast に加え、余白とモーションのテーマも持つ | @atlaskit/tokens 20.9.1 | Atlassian 製品と連携するアドオン専用で、派生物の作成を禁止（[license](https://atlassian.design/license)、2025-03-13） | 文字 4.5:1、大きい文字と図 3:1 | ADS MCP。atlassian.design/DESIGN.md を公開（2026-06-15） |

7つのシステムから読み取れる共通点は次の3つ。

- 色は「何色か」と「何に使うか」を別の名前で持つ。コンポーネントが参照するのは、用途の名前だけである。この分離があるから、ダークモードや別ブランドへの差し替えができる。
- コンポーネントの上に、「いつ使うか」を書いたパターンと文言の層を置く。GOV.UK と旧 Polaris が特に厚い。
- バージョンと更新履歴を公開している。利用者は、何が変わったかを履歴で追える。

### デジタル庁デザインシステムの特徴

- 日本語タイポグラフィを数値で定めている。本文は 16px が基準で、14px 未満は原則として許容しない。本文の行間は 1.5 倍以上（許容範囲は 100–175%）。字間は 0・1%・2% の3段階。書体は Noto Sans JP。日本語書体にはイタリックがないことも明記している（[タイポグラフィ](https://design.digital.go.jp/dads/foundations/typography/)、2026-08-05 更新）。全角・約物のルールは、このページでは確認できなかった。
- フォーカス色（Yellow-300 と Black）は変更不可としている（[カラー](https://design.digital.go.jp/dads/foundations/color/)）。「ブランドで変えてよい値」と「安全のため固定する値」を分ける、よい手本だ。
- トークンは Tokens Studio で作り、Style Dictionary 5 で CSS と JS に変換している。`$value`・`$type`・`{参照}` という DTCG 風の書式だが、型名は Tokens Studio 独自で、厳密には 2025.10 準拠ではない。余白はトークン JSON に含まれていない（[tokens.json](https://github.com/digital-go-jp/design-tokens)）。
- 海外の主要システムとの最大の違いは、日本語組版の規定と JIS 準拠である。もう一つは、サイト全体を AI が読める Markdown（`dads-markdown-20261021.zip`）として配布していることだ（[リソース](https://design.digital.go.jp/dads/resources/)）。

### トークンの標準：W3C DTCG

- 2025-10-28 に [Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/2025.10/format/) が「最初の安定版」として公開された（[告知](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/)）。位置づけは Community Group の報告書で、W3C 勧告ではない。2026年に新しい安定版は出ておらず、草案（2026-09-08）には「実装しないこと」と書かれている。
- 書式。`$value` は必須。`$type` は省略可で、グループから継承する。他に `$description`、`$extensions`、`$deprecated` がある。参照は `"{color.blue.500}"` と書く。色は `colorSpace` を持つオブジェクトで、OKLCH や Display P3 も扱える。
- 採用状況。[Style Dictionary](https://styledictionary.com/info/dtcg/) は v4 から DTCG を正式にサポートしているが、2025.10 への対応は本人たちが「まだ完全ではない」と書いている（最新は v5.8.0、2026-11-03）。Tokens Studio は旧形式と DTCG を切り替えられる。Figma はネイティブのインポートで DTCG 形式を要求する（[Help Center](https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables)）。Penpot は「準拠」としているが、実際の出力は Tokens Studio 形式だという指摘がある（[コミュニティ、投稿 2026-05-04](https://community.penpot.app/t/token-export-is-tokens-studio-format-not-dtcg-2025-10/10544)）。
- 結論。自分のシステムは DTCG 2025.10 の書式で書き、Style Dictionary で CSS 変数や Tailwind に変換するのがいちばん無難である。DESIGN.md の CLI も DTCG を出力できる。

## 倣う部分とカスタムする部分

「構造と安全基準は倣い、値と声は自分で決める」が線引きになる。トークンの階層、命名規則、アクセシビリティの基準、コンポーネントの振る舞いは、どのシステムでもほぼ同じだ。自分で発明する理由はない。一方、ブランドの個性は、意味付けトークンに入れる値と、文言の口調で決まる。

| 層 | 方針 | 倣う元（例） | 自分で決めるもの |
| --- | --- | --- | --- |
| 原則 | 自分で書く（3〜5個） | GOV.UK の書き方（短く、判断に使える形で） | 全部。迷ったときにどちらを取るかの優先順位 |
| 基礎トークン（色の階調・寸法の段階） | 仕組みは流用し、値はカスタム | DADS の 50–1200 階調、Primer の base-size、4px または 8px のグリッド | ブランド色の色相、彩度、ニュートラルを暖色寄りにするか寒色寄りにするか |
| 意味付けトークン | 名前の体系はほぼ流用し、割り当てはカスタム | Primer の `fgColor-*`、Atlassian の `color.text.subtle` | どの階調を primary や accent に当てるか、状態色のトーン |
| アクセシビリティ | そのまま流用し、変えない | WCAG 2.2 AA、DADS のフォーカス表示、最小文字サイズ | なし。合格する範囲でブランド色を調整する |
| コンポーネント（振る舞い・状態・アクセシビリティ） | ほぼ流用する。自作より既存の部品層を使う | shadcn/ui、Radix、DADS の HTML/React 例 | 密度（サイズごとの高さ）、角丸、影、バリアントをどこまで絞るか |
| パターン（フォーム・エラー・空状態） | 構造は倣い、自分の製品の場面に合わせて絞る | GOV.UK のパターン、DADS の使い方ページ | どの場面でどのパターンを使うか（カナリーの選定索引に当たる部分） |
| 文言（ボイス＆トーン） | 自分で書く | 構成は旧 Polaris の content や GOV.UK のスタイルガイドを参考にする | 敬体か常体か、一人称、エラー文の形、用語の表記揺れ |

### カスタムすべきパラメータ（brief から導くもの）

- ブランド色：主色と1つの強調色。状態色との距離も決める。たとえば主色が赤系なら、エラー色と区別できるようにする。
- 書体：和文・欧文・等幅の組み合わせとフォールバックの順。太さは2〜3段階に絞る。
- 文字サイズの段階と行間：DADS を下限にする（本文 16px、行間 1.5 以上）。
- 密度：管理画面のように詰めるのか、読み物のようにゆったりさせるのか。余白の基数と、コントロールの高さ（32/40/48px など）を決める。
- 形：角丸の段階（0 / 4 / 8 / 全丸）、境界線と影のどちらで面を分けるか。
- 動き：継続時間とイージング。prefers-reduced-motion への対応も含める。
- イラストとアイコン：線の太さ、塗りか線か。アイコンは1種類に統一する。
- トーン＆マナー：口調、絵文字の可否、ボタン文言の形（「保存する」か「保存」か）。
- 「やらないこと」：AI が既定で寄せがちな表現を具体的に列挙する。Anthropic の frontend-design は、紫のグラデーション、Inter 単体、クリーム地にセリフとテラコッタの組み合わせ、などを名指しして避けている（[SKILL.md](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)、2026-09-03 版）。

### ライセンスと「丸ごと真似る」ことの問題

- デジタル庁 DADS：サイトの文章を参照・転載するときは出典を表示し、編集したらその旨を書く。国が作ったものと誤解させないようにもする。Figma データは CC BY 4.0 で、コードは MIT（[ご利用にあたって](https://design.digital.go.jp/dads/introduction/notices/)、[Uravation の解説](https://uravation.com/media/digital-agency-design-system-claude-code/)）。「政府標準利用規約」への言及は見つからず、未確認である。官公庁のサイトと紛らわしい見た目にしないようにも気をつけたい。
- Atlassian：Atlassian 製品と連携するアドオンにしか使えず、派生物の作成も禁じられている。npm の表記は Apache-2.0 だが、[ライセンスページ](https://atlassian.design/license)の条件が優先すると読むべきだ。Polaris も Shopify 連携アプリに限定されている。構造を学ぶのは構わないが、値やコードを自分の製品に持ち込んではいけない。
- GOV.UK：コードは MIT だが、GDS Transport 書体は gov.uk のサービス専用である。
- Carbon、Material、Primer のコードは Apache-2.0 または MIT。ただし IBM Plex などの書体やブランドの印象は、ライセンスとは別の問題である。
- 他社サイトから抽出した DESIGN.md 集：[awesome-design-md](https://github.com/VoltAgent/awesome-design-md) は MIT だが、各サイトのビジュアルアイデンティティの所有は主張していない。MIT が対象にするのはリポジトリ自体の内容だけで、各ブランドの権利は含まない。日本語版も「公式文書ではなく、商標は各権利者に帰属する」と明記している。商標法や不正競争防止法の観点から分析した日本語の文献は見つからなかった。

実務上の結論。他社の DESIGN.md をそのまま自分のブランドに使うと、権利の問題に加え、「どこかで見た UI」になって独自性も失う。参考元は references/ に、「何を学んだか」という形で要約して残す。値は brief から自分で導く。

## 推奨リポジトリ構成

たたき台の骨格はそのまま使える。変える点は5つある。(1) 値の正本は DTCG 形式のトークン JSON にし、DESIGN.md はそこから生成する。(2) コンポーネントの「選定索引」を足す。(3) 文言（content）を独立した層にする。(4) 方向性の探索と確定版を分ける。(5) 変更履歴と判断記録を残す。

「DESIGN.md だけ」では足りないというデータがある。Supernova が Skyscanner Backpack を DESIGN.md に変換したところ、434個のトークンが32個に減り、ダークモードは残らなかった（[2026-11-03](https://www.supernova.io/blog/design-md-design-system)、提供元は MCP を売るベンダー）。Atlassian の検証でも、DESIGN.md だけを渡すと MCP よりトークン消費が約92%多く、コンポーネントを import せずに作り直していた（[2026-06-15](https://www.atlassian.com/blog/how-we-build/atlassians-design-md-is-here-what-we-learned-testing-portable-design-context-in-practice)、著者自身は「結論的ではない」と注記）。そのため DESIGN.md は「意図と全体像」を担い、正確な値はトークン JSON とコードに任せる。

```text
.
├── SKILL.md                    # 使うとき／更新するときの手順と、各ファイルへの目次（500行未満）
├── CLAUDE.md                   # このリポジトリを保守するときの規約（200行未満）
├── CHANGELOG.md                # semver。破壊的変更は major
├── design_system/
│   ├── brief.md                # 入力：コンセプト・性格・避けたいもの
│   ├── principles.md           # 設計原則 3〜5個（判断に迷ったときの優先順位）
│   ├── tokens/
│   │   ├── primitive.tokens.json   # 基礎トークン（色の階調、寸法の段階）DTCG 形式
│   │   ├── semantic.tokens.json    # 意味付けトークン（text.primary など）
│   │   └── themes/dark.tokens.json
│   ├── components/
│   │   ├── _index.md           # 選定索引：「こういうときはどれ」の表
│   │   └── button.md …         # 用途／使わない場面／バリアント／状態／良い例・悪い例
│   ├── patterns/               # フォーム、空状態、エラー、レイアウトの選定条件
│   ├── content/                # voice-and-tone.md、用語集、表記ルール
│   └── DESIGN.md               # 生成物：トークン＋意図。手で直接編集しない
├── explorations/               # 方向性の候補（2026-11-a/b/c）。確定版には混ぜない
├── decisions/                  # ADR：なぜその値・その案にしたか
├── examples/                   # good/ と bad/（コード＋スクリーンショット）
├── preview/                    # トークンとコンポーネントの一覧 HTML（生成物）
├── references/                 # 参考元の調査メモ。出典 URL・確認日・ライセンスを必ず書く
├── scripts/                    # build-tokens / contrast / lint-tokens / gen-design-md / screenshot
└── evals/                      # evals.json（ケースとアサーション）、baselines/
```

リポジトリをそのままスキルにする場合、配置に注意がいる。エージェントは \~/.claude/skills/\<name>/ または利用先の .claude/skills/\<name>/ にある SKILL.md を読むので、そこへ clone かシンボリックリンクで置く（[Claude Code の Skills](https://code.claude.com/docs/en/skills)）。もう一つの注意は、このリポジトリの CLAUDE.md が、スキルを使う別プロジェクトでは読まれないことだ。そのため利用先の CLAUDE.md にも、下の表の「利用先」行を数行だけ置く。

### CLAUDE.md・SKILL.md・DESIGN.md の役割分担

| ファイル | 読まれるとき | 書くこと | 書かないこと |
| --- | --- | --- | --- |
| 利用先の CLAUDE.md | そのプロジェクトでは常に | ルールだけを書く。「UI を触る前に \<name> スキルを使う」「トークン以外の色・余白を書かない」「新しいコンポーネントは作る前に聞く」 | hex 値、props、コンポーネント一覧（[Supernova、2026-08-11](https://www.supernova.io/blog/what-to-put-in-claude-md-for-a-design-system)） |
| このリポジトリの CLAUDE.md | デザインシステムを保守するとき | ビルド・検査コマンド、「DESIGN.md は生成物」「値を変えたら CHANGELOG と ADR」などの規約 | 手順の詳細。Anthropic は「事実と常設ルールは CLAUDE.md、手順と参照資料は Skills」と分けている（[memory](https://code.claude.com/docs/en/memory)） |
| SKILL.md | UI を作るとき、または DS を更新するとき（description で起動） | モード別の手順（使う／方向性を探る／差分更新）、どのファイルをいつ読むか、完了前に回す検査 | トークンの値そのもの。参照は1階層の深さまで（[best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)） |
| DESIGN.md | SKILL.md の手順から参照。他ツール（Stitch など）への持ち出しにも使う | 性格と雰囲気、色の役割、タイポの使い分け、Do's and Don'ts。[公式仕様](https://github.com/google-labs-code/design.md)の節の順序に従う | 全トークンの羅列、コンポーネント API。これらは JSON とコードが正本 |
| brief.md | 方向性を決めるときと、レビューの基準として | ターゲット、性格、具体的な参照、避けたいもの | 解決策（値）。brief は「何を目指すか」だけを書く |

AI に読ませる書き方で効くもの：

- 具体値で書く。「ゆったり」ではなく「本文の行間 1.7」と書く。Anthropic も「2スペースでインデント」のような具体指示のほうが効くと書いている（[memory](https://code.claude.com/docs/en/memory)）。
- ただし性格は形容詞ではなく参照で書く。DESIGN.md の [PHILOSOPHY.md](https://github.com/google-labs-code/design.md) は、「モダンで清潔で信頼できる」は何も喚起しないとしている。代わりに「1970年代の大学院の講義プリント」のような具体的な参照を勧めている。
- 禁止するだけでなく、代わりにどうするかも書く。Anthropic の手法は「収束しがちな既定値を特定し、具体的な代替案を示す」（[2025-11-12 のブログ](https://claude.com/blog/improving-frontend-design-through-skills)）。
- 「いつ使う／使わない」を書く。トークンは色の値を教えるが、いつ使うかは教えない（[AI For Developers、2026-07-26](https://aifordevelopers.substack.com/p/designmd-for-design-in-claude-code)）。カナリーの選定索引はこの穴を埋めた例だ。
- 良い例・悪い例はペアで置き、悪い例には「どのルールに違反したか」を一行添える。
- 必ず守らせたいものは文章ではなく仕組みで強制する（lint、フック、MCP の入口）。「禁止よりツールで入口を絞る、検証ループでガイドラインを関門にする」（[State of AI in Design Systems](https://state-of-ai-in-design-systems.netlify.app/)）。

## 作成ワークフロー

手順は「初回」と「確定後」で分ける。初回は3案を並べて、人が選ぶ。確定後は1案を差分で更新し、検査と人の承認を通してから反映する。方向性を大きく変える大改修のときだけ、初回の手順に戻る。

&#91;embedded content: 作成ワークフロー · 初回5工程と確定後5工程\]

上の段は1回きりの方向性決め、下の段は繰り返す差分更新である。人が判断するのは各段で1か所だけで、主色や書体を変える大改修のときだけ上の段に戻る。

### 二つの方式の使いどころ

|  | 複数案から選ぶ | 1案を反復して詰める |
| --- | --- | --- |
| 向く場面 | 初回の方向性決め、リブランド、新しい製品ライン | 確定後のトークン追加、コンポーネント追加、不具合修正 |
| 狙い | AI が既定の「ありがちな UI」に収束するのを防ぐ。人は比較して初めて好みを言葉にできる | 一貫性を保ち、変更の影響範囲を小さくする |
| 事例 | Anthropic の theme-factory（案を示し、人が選ぶまで待つ）、[Claude Design](https://www.anthropic.com/news/claude-design-anthropic-labs)（「幅広い方向性」を出す、2026-04-17）、X の @joacode\_（完成品ではなくバリアントを頼む、2026-11-04） | frontend-design（トークン体系を書き、brief と照合してから作る）、[v0 DS 2.0](https://v0.app/docs/design-systems-2)（承認後にスキルとして履歴つきで更新）、Hardik Pandya（レビューで2回直したものを文書化） |
| 注意 | 3案が似通うと意味がない。軸をずらして作らせる | 小さな変更を重ねるうちに、元の意図からずれていく。brief との照合を毎回行う |

「3案」という数について。調べた範囲では、「ちょうど3案」を指定している一次情報はなかった。2案だとどちらかを選ぶだけになり、たいてい中間を取りたくなる。4案以上だと比較の負担が増える。3案はその間を取った、実務上の筆者の推奨である。

### 初回：方向性を決める

1. brief.md を書く（付録のテンプレート）。形容詞よりも具体的な参照（物、場所、印刷物、既存サイト）と、「避けたいもの」を書く。参考画像や既存サイトは references/ に置く。
2. Claude Code に brief を読ませ、不明点を質問させる。答えた内容は brief に追記する。
3. 3案を作らせる（付録のプロンプト）。各案は explorations/<日付>-a～c/ に、小さなトークン案、同一の3画面の見本、設計の意図を置く。画面を揃えるのは、比較できるようにするため。
4. 機械チェック（コントラスト、トークンの構文）を全案にかけ、不合格の案は直してから人に見せる。
5. 人が選ぶ。「A の色と C の密度」のように組み合わせてもよい。選んだ理由と、採らなかった案の要素を decisions/ に ADR として残す。
6. 選んだ案を体系化する。primitive と semantic のトークン JSON、主要コンポーネントの文書と選定索引、content のルールを作り、そこから DESIGN.md と preview/ を生成する。
7. evals を作り、スキルありとスキルなしで比較する。差が出たら v1.0.0 としてタグを打つ。

### 確定後：差分で更新する

1. 変更のきっかけを記録する。実際の画面で迷ったこと、レビューで2回直したこと、新しい要件など。変更はファイル単位で小さく分ける。
2. Claude Code に変更案を作らせる。変更するのは正本（トークン JSON、コンポーネント文書）だけで、DESIGN.md は再生成する。既存のトークンで表せないかを先に確かめさせる。新しいトークンやコンポーネントを足すときは、人に確認を取る。
3. 検査を回す。トークンのビルド、コントラスト、lint、画像差分、evals を実行する。
4. 人が差分を確認する。見るのは画像の差分と、brief の方向性からずれていないかの2点。
5. CHANGELOG と semver を更新する。値の変更は minor、トークン名の削除や改名は major にする。判断の理由は ADR に残す。

大改修に当たるのは、主色や書体を変えるとき、密度を大きく変えるとき、対象ユーザーが変わるとき。この場合は brief を更新し、初回の手順 3 からやり直す。

### 入力の扱い方

- 既存サイトがある場合：まず「現状の抽出」を作らせ、それを方向性の1案（現状維持案）として扱う。X では「好きなサイトからスタイルを design.md に抽出させ、実装後に別モデルで同じ基準で検証する」運用が共有されている（[@fankaishuoai、2026-11-04](https://x.com/fankaishuoai/status/2117982660429816077)）。ただし他社サイトからの抽出は参考にとどめる。
- Figma で先に作る場合：生の値で自由に作り、構造を定義したスキルで体系化させる方法がある（[@\_heyrico、2026-11-02](https://x.com/_heyrico/status/2117239556114358552)）。Figma MCP の get\_variable\_defs で変数を取り込む手順は、[azukiazusa の記事](https://azukiazusa.dev/blog/using-figma-mcp-to-provide-design-system-for-ai-coding-agents)（2026-01-03）が詳しい。
- 文脈の渡し方：常に読むもの（利用先の CLAUDE.md）、必要なときに取りに行かせるもの（SKILL.md から参照する各ファイル）、その場で渡すもの（画面ごとの要件）に分ける（[Hikari、2026-10-29](https://note.com/hgffdgn654/n/n92467b83a1c1)）。

## 品質チェックと eval

デザインシステムの品質は三段で確かめる。1段目は機械で白黒がつく検査を CI とフックで毎回回す。2段目は別モデルによる採点で絞り込む。3段目のブランド適合は人が判断する。AI が自分の出力を自分で採点するだけでは足りない。

### 1. 自動でチェックできること

| 検査 | 基準・ツール | 備考 |
| --- | --- | --- |
| 文字のコントラスト | WCAG 2.2 SC 1.4.3（AA）：通常文字 4.5:1、大きい文字 3:1。SC 1.4.6（AAA）は 7:1 | トークンの前景色×背景色の全ペアを CI で計算する。生成には [Adobe Leonardo](https://github.com/adobe/leonardo) が使える |
| 文字以外のコントラスト | SC 1.4.11（AA）：UI 部品と状態表示に 3:1 | JIS X 8341-3:2016 は WCAG 2.0 相当でこの項目がない。改正 JIS では要求される見込み（下記） |
| トークン外の値の混入 | [stylelint-declaration-strict-value](https://github.com/AndyOGo/stylelint-declaration-strict-value)、Atlassian の [ensure-design-token-usage](https://atlassian.design/components/eslint-plugin-design-system/ensure-design-token-usage/usage)、[Primer stylelint-config](https://github.com/primer/stylelint-config)、[Carbon stylelint plugin](https://github.com/carbon-design-system/stylelint-plugin-carbon-tokens) | 色の直書き（#hex、rgb()）、トークン外の余白・角丸・フォントサイズを検出する |
| トークンの構文 | [DTCG 2025.10](https://www.designtokens.org/TR/2025.10/format/) の検証規則（$type 必須、循環参照はエラー、寸法は px/rem）、[Style Dictionary](https://styledictionary.com/reference/logging/) の参照切れ = throw | ビルドが通ることを検査の代わりにする |
| アクセシビリティ全般 | [axe-core](https://github.com/dequelabs/axe-core)、[@axe-core/playwright](https://playwright.dev/docs/accessibility-testing) | axe 自身が「WCAG 問題の平均 57% を自動検出」と書いている。残りは手動確認が必要 |
| 見た目の回帰 | Playwright の [toHaveScreenshot](https://playwright.dev/docs/test-snapshots)、[reg-suit](https://github.com/reg-viz/reg-suit)（国産 OSS）、Chromatic | 基準画像の承認は人が行う。OS やフォントで描画差が出るため、環境を固定する |
| エージェント向けの即時ガード | Claude Code の PreToolUse フック、[design-system-mcp（onsystem）](https://github.com/dgesteves/design-system-mcp) | onsystem は check\_ui ツールと ESLint ルールを持つ（2026年、Star 21 の小規模プロジェクト）。フックは「exit 2 で書き込みを止め、理由を Claude に返す」形が [X で共有されている](https://x.com/HackrLife/status/2116849411938799775)（@HackrLife、2026-11-01） |

規格の現状（2026-11 時点）：

- WCAG 2.2 は 2024-12-12 版が最新の勧告。[W3C](https://www.w3.org/WAI/news/2025-10-21/wcag22-iso) は 2025-10-21 に ISO/IEC 40500:2025 として承認されたと発表した。
- JIS X 8341-3 の現行版は 2016 年版で、WCAG 2.0 相当。WAIC の [2026-02-06 の資料](https://waic.jp/wp-content/uploads/2026/02/20260206-waic-a11y-seminar-2.pdf)によると、2025年10月に改正原案作成委員会が発足し、ISO/IEC 40500 との一致規格（IDT）になる見込み。公示日は未確定（[Allyera、2026-11-05 更新](https://allyera.cultive.co.jp/columns/jis-x8341-3-current/)）。
- WCAG 3 は [2026-09-10 の作業草案](https://www.w3.org/TR/wcag-3.0/)でもコントラストの算出方法が未決定で、APCA は名指しされていない。APCA は参考指標にとどめ、合否は WCAG 2.2 の比率で判定するのが安全。

### 2. AI の自己採点だけでは足りない理由

- 自分の出力をひいきする。LLM は自分の生成物を見分け、高く評価する傾向がある（[Panickssery ほか、NeurIPS 2024](https://arxiv.org/abs/2404.13076)、2024年の研究）。
- 見た目の判断はまだ弱い。フォント・レイアウト・配色の美的評価で、VLM には人の判断とのはっきりした差がある（[AesEval-Bench、2026-03](https://arxiv.org/abs/2603.01083)）。
- 対策として、異なるモデル系統の審査員を並べるとバイアスが減る（[Verga ほか、2024](https://arxiv.org/abs/2404.18796)）。ただし検証されたのは QA と対話で、UI 評価ではない。X でも「作ったのとは別のモデルに、同じ design.md で検証させる」運用が共有されている（[@fankaishuoai、2026-11-04](https://x.com/fankaishuoai/status/2117982660429816077)）。
- Anthropic の [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)（2026-01-09）は、コードによる採点を「速く安く客観的だが脆い」、モデルによる採点を「人の採点で較正が必要」、人の採点を「ゴールドスタンダードだが高く遅い」と整理している。審査は観点ごとに分け、「判断不能」の選択肢を持たせることも勧めている。

人が判断すべきこと：ブランドらしさ（brief のキーワードに合うか）、情報の優先順位と視線の流れ、文言の口調、そして「新しいトークンやコンポーネントを足してよいか」という設計判断。skill-creator 自身も「デザイン品質のような主観的なスキルは定性的に評価し、人の判断が要るものに無理にアサーションを付けない」と書いている（[SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)）。

### 3. Agent Skills の eval をデザインシステムに応用する

仕組みは2つある。

- [skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)：evals/evals.json にケース（prompt と期待するアサーション）を書く。スキルあり／なしで同時に実行し、合格率・時間・トークンを benchmark.json で比べる。人の感想はビューアから feedback.json に残す。
- [claude plugin eval](https://code.claude.com/docs/en/plugin-evals.md)：採点方式は regex、tool\_used、file\_exists、llm（3票中2票で合格）、baseline。llm 採点にはスクリーンショット画像を渡せる。既定で各ケースを3回実行し、閾値を下回ると exit 1 を返すので CI に載せやすい。ケースの書式は skill-creator の evals.json と互換性がない。

Anthropic の[ベストプラクティス](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)は「ドキュメントを書き込む前に eval を作る」「最低3ケース」と勧めている。デザインシステムに当てはめると次のようになる（ケースの中身は筆者の提案）。

| ケース（prompt） | 機械採点 | 人・別モデルの採点 |
| --- | --- | --- |
| 料金ページを作って | 色の直書きなし（regex）、Button コンポーネントを使う、トークンのコントラスト検査が合格 | 3プランの比較が一目で分かるか |
| エラー状態つきの設定フォーム | axe の wcag2aa 違反ゼロ、エラーメッセージがトークンの danger 色 | 文言の口調が voice ルールに沿うか |
| ダークモードのダッシュボードカード | ダークテーマのトークンだけを使用、SC 1.4.11 の 3:1 | 密度と余白がブランドの性格に合うか |
| 誤発火の確認：「この SQL を直して」 | スキルが起動しないこと | — |

合格率は「スキルなし」の結果と並べて読む。差が出ないアサーションは役に立っていないので入れ替える。

## X での情報収集と公開事例

2026年は「DESIGN.md を置けば終わり」という段階から、「コンポーネントの索引・検証ループ・人のレビューを足す」段階に移った。質の高い発信は、試した結果の数字と、失敗した点を書いている。

### X の動向（2026-11-01〜11-08、X API の Recent Search で取得）

X API の Recent Search は過去7日分しか対象にしない。そのため、以下はこの1週間の断面である。ここでは「いいね」の数より、構造や運用に踏み込んでいるかで選んだ。

| 投稿日 | 発信者 | 内容 |
| --- | --- | --- |
| 2026-11-05 | [@kgsi（こぎそ）](https://x.com/kgsi/status/2118147692950159496) | カナリーの事例を紹介。DESIGN.md だけでは、生成のたびにコンポーネントの扱いをその都度判断するためブレる。そこで種類一覧と使い分けの索引を足した。このアカウントは、デザイン×AI の国内事例を継続して紹介している |
| 2026-11-07 | [@MacopeninSUTABA](https://x.com/MacopeninSUTABA/status/2118901755001913660) | Hikari さんの note を紹介。渡す文脈を「常駐させる・取りに行かせる・その場で渡す」の三層に分ける |
| 2026-11-05 | [@this\_majika](https://x.com/this_majika/status/2118394206620405795) | awesome-design-md-jp を紹介。日本語タイポに合わせて拡張した DESIGN.md テンプレートがある。収録ファイルは公式文書ではなく、各社サイトの CSS から抽出したものだと明記している |
| 2026-11-01 | [@CULUMU\_Design](https://x.com/CULUMU_Design/status/2116817785321886037) | Brad Frost の番組で取り上げた State of AI in Design Systems を紹介。「21件中20件が MCP」と書いているが、元サイトの insights ページでは公式 MCP は 18/21 |
| 2026-11-01 | [@HackrLife](https://x.com/HackrLife/status/2116849411938799775) | PreToolUse フックで、既存コンポーネント以外の新規作成を止める |
| 2026-11-02 | [@\_heyrico](https://x.com/_heyrico/status/2117239556114358552) | Figma で、生の値を使って自由に作る。その後、構造を定義したスキルで Claude Code に体系化させる |
| 2026-11-04 | [@edo\_lunardi](https://x.com/edo_lunardi/status/2117958290860617957) | デザインシステムを本番サイトの非公開ルートとして置き、本番と同じコンポーネントで描画する。トークンはソースから直接読むので、ドキュメントと実装がずれない |
| 2026-11-06 | [@VNallatamby](https://x.com/VNallatamby/status/2118811245986075046) | 元 Google Labs で Stitch の最初の PM。方向性は Figma で決め、確定後に Claude Code でコード化して専用リポジトリにまとめた |

見分け方。次のような投稿は後回しでよい：「holy f\*ck」「…ないと仕事を失う」で始まるリポジトリ列挙。同じ文面を毎日貼る宣伝。スクリーンショットだけの「代理店の仕事を消した」系。読む価値があるのは、次の3点のどれかを含む投稿だ。(1) ファイル構成やルールの中身が具体的。(2) うまくいかなかったこととその対処がある。(3) 一次情報（記事・リポジトリ・調査）へリンクしている。収集した投稿ではハッシュタグはほとんど使われていなかった（最多は #ClaudeCode の3件）。人と記事を追うほうが効率がよい。

### 日本語の実践記事（2026年）

| 公開日 | 記事（著者） | 要点 |
| --- | --- | --- |
| 2026-11-03 | [カナリーの「UI生成ワークフロー」の現在地](https://cocoda.design/mayuge33/p/p044da4c62735)（寺本 裕成ほか） | 同じ操作なのに、ドロップダウンとラジオボタンが生成のたびに入れ替わっていた。そこで「コンポーネント選定の索引」「レイアウトの選定条件」「px で書いた余白ルール」を足し、生成とは別のレビューエージェントを置いた |
| 2026-10-29 | [Figmaを離れてClaude CodeでUIデザインをするようになった話](https://note.com/hgffdgn654/n/n92467b83a1c1)（Hikari） | 文脈を「常駐／取りに行かせる／その場」の三層に分ける。「指示は削る、文脈は盛る」 |
| 2026-07-25 | [デジタル庁デザインシステム×Claude Code](https://uravation.com/media/digital-agency-design-system-claude-code/)（佐藤傑） | デジタル庁が AI 向けに公開している Markdown をプロジェクトに展開して使う。出典表示の書き方も解説 |
| 2026-07-24 | [デザインシステムMCPは"配って終わり"じゃなかった。](https://speakerdeck.com/superstudio/2026-dot-07-dot-22-deng-tan-zi-liao)（武藤 広、SUPER STUDIO） | MCP を叩かない、既定のバリアントを間違える、といった問題が起きた。rules.json・DESIGN.md・デザイン lint をガードレールにした |
| 2026-07-04 | [AIエージェント対応が進むデザインシステムの最近の動き](https://dev.classmethod.jp/articles/design-system-ai-agent-roundup/)（佐藤雅史） | Meta Astryx、v0、Serendie、SmartHR（ESLint ルールから Skills を生成）を比較 |
| 2026-06-29 | [DESIGN.md：人間とAIが共通の設計資産を介して…](https://speakerdeck.com/nagatsu/design-dot-md-ren-jian-toaigagong-tong-noshe-ji-zi-chan-wojie-sitexie-dong-si-guan-xing-tosupidowoliang-li-saseruci-shi-dai-nokai-fa-ekosisutemu)（長津孝輔） | 振る舞い（AGENTS.md／CLAUDE.md）、手順（SKILL.md）、見た目（DESIGN.md）の三層に分ける |
| 2026-06-18 | [デザイナーが2人でも回るUIレビュー体制を、DESIGN.mdで作った話](https://zenn.dev/rakko_inc/articles/df4a4994239857)（ラッコ） | 禁止事項と WCAG AA のセルフチェックを含む DESIGN.md を、PR レビューの基準にする。課題はファイルが肥大化すること |
| 2026-04-06 | [クラメソのデザインガイドをDESIGN.mdで実装してみた](https://dev.classmethod.jp/articles/design-md-ai-agent-design-system/)（せーの） | Skill から DESIGN.md に移し、プロンプト量が約70%減った（1回の実測）。ロゴとフォントは別に扱う必要があり、併用を勧めている |

### 公開リポジトリ・テンプレート・調査（スター数は 2026-11-08 時点）

| 名前 | 何か | この仕組みでの使いどころ |
| --- | --- | --- |
| [google-labs-code/design.md](https://github.com/google-labs-code/design.md) | DESIGN.md の仕様と CLI。Apache-2.0、alpha、約28.8k★。[Google の発表](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/)は 2026-04-21 | 節の順序を揃える。`lint` で参照切れとコントラストを検査し、`export` で DTCG や Tailwind を出力する |
| [anthropics/skills の frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) | 2026-09-03 に書き直し。まず小さなトークン体系を書き、brief と照合して直してから作る「2段階」 | 「ありがちな既定値を避ける」書き方の手本 |
| anthropics/skills の theme-factory | テーマ案を見せ、人が明示的に選ぶまで待ち、それから適用する | 複数案から選ぶ手順の手本 |
| [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | 有名サイトの DESIGN.md 集（84件、MIT、約126k★） | 参考資料としてのみ使う（注意点を参照） |
| [kzhrknt/awesome-design-md-jp](https://github.com/kzhrknt/awesome-design-md-jp) | 日本のサイト625件と、日本語タイポの拡張（フォールバック、行間 1.5–2.0、字間、禁則、palt） | 日本語タイポ節の書き方を借りる |
| [bydiorama/ui](https://github.com/bydiorama/ui) | AGENTS.md、CLAUDE.md、変更台帳、ADR、169組のトークンのコントラスト検査、axe、画像の基準を持つ小さな公開デザインシステム（MIT、9★） | 個人規模で「検証まで含む」構成の実例 |
| [Hardik Pandya: Expose your design system to LLMs](https://hvpandya.com/llm-design-systems) | 階層ごとの specs、閉じたトークン集合、token-audit.js。「レビューで2回直したパターンは文書化する」 | 差分更新の運用ルール |
| [State of AI in Design Systems](https://state-of-ai-in-design-systems.netlify.app/)（Kaelig Deloumeau-Prigent、2026-07-28 時点） | 21の主要デザインシステムを調査。公式 MCP は18件、Skills も多数 | 「禁止よりツールで入口を絞る」「検証ループでガイドラインを関門にする」 |
| [v0 Design Systems 2.0](https://v0.app/docs/design-systems-2)（2026-11-06 更新） | スターターアプリを作り、レビューして承認すると SKILL.md として保存される。履歴つきで更新できる | 「確定後は差分更新」の製品例 |
| [github/replica](https://github.blog/changelog/2026-10-28-introducing-replica-an-open-source-ai-prototyping-tool)（2026-10-28、MIT） | 自社のデザインシステムを使って試作するツール | 参考 |

未確認のもの：Codrops の Diorama の記事（403 で開けず）。UI UX Pro Max（約146.6k★、README 未読）。「unslop」（デザイン用の同名スキルを特定できず）。Stitch のバリアント生成機能の詳細。

## 注意点

- DESIGN.md の仕様はまだ alpha である（2026-11 時点）。テーマ（ダークモード）は書けず、コンポーネントの props も持てない。そのため正本にはせず、生成物として扱う。仕様が変わっても、生成スクリプトを直すだけで済む。
- DESIGN.md には内部で立場の違いがある。仕様書は「トークンが規範的な値」とし、PHILOSOPHY.md は「デザインは散文に宿る」としている。実務では両方が要る。値は検査で守らせ、意図は散文で伝える。
- 文書を増やすほど効くわけではない。Atlassian の約20k トークンの DESIGN.md は、MCP より多くトークンを消費していた。ラッコ社もファイルの肥大化を課題に挙げている。SKILL.md は目次に徹し、必要なファイルだけを読ませる。
- 文章に書いた禁止事項は破られる前提で考える。SUPER STUDIO の報告では、MCP を用意しても叩かれなかった（[2026-07](https://speakerdeck.com/superstudio/2026-dot-07-dot-22-deng-tan-zi-liao)）。守らせたいものは lint、フック、CI で機械的に止める。
- AI の自己採点を合格の根拠にしない。別モデルの審査と人の承認を挟む。画像差分の基準画像を更新するのも人である。
- 規格は動いている。JIS X 8341-3 は改正作業中で、公示日は未確定。改正後は文字以外のコントラストも求められる見込みなので、今のうちから WCAG 2.2 AA（SC 1.4.11 を含む）で作っておく。APCA はまだ参考値にとどめる。
- 参考元の状態も変わる。Material Web はメンテナンスモードに入り、Polaris の React 版はアーカイブされた。references/ には、確認日とバージョンを必ず書く。
- X の数字は元の資料で確かめる。「21件中20件が MCP」という投稿に対し、元の調査の insights ページでは公式 MCP は18件だった。リポジトリのスター数も数日で大きく変わる。
- 確認できなかったこと。Material 3 公式サイトの記述（ページが表示できなかった）。Polaris のトークン名。DADS の全角・約物の規定。EightShapes（Nathan Curtis）のレビュー運用記事。Codrops の Diorama 記事。freee vibes の刷新記事。これらは推測で埋めていない。
- X API の Recent Search は過去7日分しか検索できない。月単位で動向を追うには、定期的に取得して references/x/ に溜める運用が要る。

## 付録：たたき台

以下はそのままコピーして使える。`<ブランド名>` と npm スクリプト名は自分の環境に合わせて置き換える。スクリプト名は例である。frontmatter は [Agent Skills の制約](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)に従う。name は小文字・数字・ハイフンで64文字以内で、「claude」を含めない。description は三人称で「何をするか」と「いつ使うか」を書き、1024文字以内に収める。

### SKILL.md（全文）

```markdown
---
name: brand-design-system
description: <ブランド名>のデザインシステム（トークン、コンポーネント、パターン、文言）を適用・保守する。画面・コンポーネント・スタイル・画面上の文言を作る／直すとき、またはデザインシステム自体の方向性を探る・更新するよう頼まれたときに使う。Use when building or editing any UI, CSS, or on-screen copy, or when asked to explore or update the design system. バックエンド、データ処理、UI を含まない作業には使わない。
---

# <ブランド名> Design System

このスキルには3つのモードがある。依頼からモードを判断し、判断できなければユーザーに聞く。

- A. 使う（既定）：このブランドの UI を作る・直す
- B. 方向性を探る：brief から3案を作る。初回と大改修のときだけ
- C. 更新する：確定したデザインシステムを差分で変える

## どのファイルをいつ読むか

| ファイル | 読むとき |
| --- | --- |
| design_system/DESIGN.md | 最初に必ず。性格、色の役割、Do's and Don'ts |
| design_system/components/_index.md | 部品を選ぶとき。「この場面にはどれ」を引く |
| design_system/components/<名前>.md | その部品を使うときだけ |
| design_system/patterns/*.md | フォーム、エラー、空状態、レイアウトを組むとき |
| design_system/content/voice-and-tone.md | 画面に文言を書くとき |
| design_system/tokens/*.tokens.json | 値を厳密に確かめるとき。DESIGN.md よりこちらが正 |
| design_system/brief.md | モード B・C、または「ブランドらしいか」迷ったとき |
| examples/good, examples/bad | 迷ったときの判断材料 |

## モード A：使う

1. DESIGN.md を読み、components/_index.md で使う部品を決める。
2. 既存のコンポーネントを import して使う。生の <button> や自作の類似部品を作らない。
3. 色・余白・角丸・影・文字サイズには、意味付けトークン（CSS 変数）だけを使う。hex、rgb()、任意の px を直接書かない。
4. 合う部品やトークンがないときは、作らずに止まる。「足りないもの」と「既存での代替案」を示し、ユーザーに確認する。
5. 文言は content/voice-and-tone.md に従う。
6. 完了前に `npm run ds:check`（lint、コントラスト、axe）を実行する。失敗したら直して再実行する。失敗したまま完了と報告しない。
7. 画面をスクリーンショットで確認し、DESIGN.md の Don'ts に触れていないかを自分で点検する。合否は検査結果とユーザーが決めるので、自己評価で「問題なし」と断定しない。

## モード B：方向性を探る

1. brief.md を読み、空欄や曖昧な点を最大5つまで質問する。答えは brief.md に追記する。
2. explorations/_template.md の指示に従い、3案を explorations/<YYYY-MM-DD>-a, -b, -c/ に作る。3案は「軸」をずらし、互いに似せない。
3. 各案に `npm run ds:check -- --dir <案のパス>` をかけ、不合格は直してから提示する。
4. 3案を比較表で示し、ユーザーが選ぶまで待つ。勝手に1案を推して確定しない。
5. 選ばれたら、理由を decisions/ に ADR として書き、モード C の手順で本体に反映する。採らなかった案は消さずに残す。

## モード C：更新する

1. 変更の理由（きっかけとなった画面や指摘）を確認する。理由がなければ質問する。
2. 既存のトークンやコンポーネントで解決できないかを先に調べる。
3. 変更するのは正本（tokens/*.tokens.json、components/*.md、patterns/、content/）だけ。DESIGN.md と preview/ は `npm run ds:build` で再生成し、手で編集しない。
4. `npm run ds:check` と `npm run ds:eval` を実行し、画像差分の結果をユーザーに示す。基準画像はユーザーの承認なしに更新しない。
5. CHANGELOG.md を更新する。値の変更は minor、トークン名の削除や改名は major。判断の理由は decisions/ に書く。
6. 主色・書体・密度を大きく変える依頼だった場合は、モード B を提案する。

## 常に守ること

- brief に書かれた言葉が、一般的な「良いデザイン」より優先する。
- アクセシビリティの値は変えない。対象はフォーカス表示、最小文字サイズ 16px（補助は 14px）、コントラストの WCAG 2.2 AA（文字 4.5:1、UI 部品 3:1）。
- 分からない値を推測で埋めない。トークンにない値が必要になったら質問する。
- 他社の DESIGN.md やスクリーンショットの値を、そのまま持ち込まない。

## コマンド

- `npm run ds:build`：トークンの変換（Style Dictionary）、DESIGN.md と preview/ の生成
- `npm run ds:check`：トークンの構文検査、トークン外の値の lint、全ペアのコントラスト、axe（wcag2aa）
- `npm run ds:shot`：見本画面のスクリーンショットと画像差分
- `npm run ds:eval`：evals/ のケースを実行する
```

### design\_system/brief.md（入力テンプレート）

```markdown
# Brief: <ブランド名>

更新日: YYYY-MM-DD / 版: v0.1

## 1. 何のための UI か
- 製品・サイトの一文説明:
- 主な画面（3つ）: 例）LP / 一覧画面 / 設定フォーム
- 使われる環境: PC中心 / スマホ中心 / 両方、ライト / ダーク

## 2. 誰が使うか
- 主な利用者と、その人がその画面でやりたいこと:
- 配慮が必要なこと: 例）高齢者が多い、業務で長時間使う、数字を比べる

## 3. コンセプト
- 一文で: 
- キーワード（3〜5個。形容詞だけでなく、物・場所・素材も入れる）:
  - 例）「町の写真館の封筒」「方眼紙」「晴れた日の駅の案内板」
- そのキーワードを選んだ理由:

## 4. 性格（対になる言葉で位置を決める）
| 軸 | 左 | 1–5 | 右 |
| --- | --- | --- | --- |
| 密度 | ゆったり | | 密 |
| 温度 | 冷静 | | 親しみ |
| 古さ | 伝統 | | 先端 |
| 音量 | 控えめ | | 大胆 |
| 形 | 直線的 | | 丸み |

## 5. 参考（何を借りたいかを必ず書く）
| 参考 | URL / ファイル | 借りたい点 | 借りたくない点 |
| --- | --- | --- | --- |
| | references/images/... | 例）見出しと本文の大きな差 | 例）全体の暗さ |

## 6. 既に決まっているもの（変えられないもの）
- ロゴ、コーポレートカラー（hex）、指定書体、ライセンス上の制約:
- 技術的な制約: 例）React + Tailwind v4、shadcn/ui を使う

## 7. 避けたいもの（具体的に）
- 例）紫〜青のグラデーション、角丸大きめのカードを並べただけの SaaS 風
- 例）競合 X 社に似て見えること
- 例）絵文字、「！」の多用

## 8. 文言の声
- 敬体 / 常体、一人称、呼びかけ方:
- エラー文の例（1文）:
- ボタン文言の形: 例）「保存する」

## 9. 成功の基準
- このデザインシステムがうまくいったと言える状態（人が判断する項目）:
  - 例）ロゴを隠しても自社の画面だと分かる
  - 例）新しい画面を作っても、文字サイズの段階が増えない
```

### 3案を出させるときのプロンプト例（explorations/\_template.md）

```markdown
design_system/brief.md を読んで、デザインシステムの方向性を3案作ってください。

進め方
1. まず brief の空欄や曖昧な点を最大5つまで質問してください。私の回答を待ってから次に進んでください。
2. 3案は「軸」をずらして作ってください。以下を一例として、brief の「4. 性格」のうち別々の軸を強調してください。
   - A：brief にいちばん忠実な王道案
   - B：「音量」と「古さ」を一段大胆に振った案
   - C：「密度」と「形」を逆側に振った案
   3案のうち2案以上で、同じ書体や同じ主色の色相を使わないでください。
3. brief の「7. 避けたいもの」に加えて、AI が既定で選びがちな表現も避けてください。たとえば紫のグラデーション、Inter 単体、どこにでもあるカードの並び。
4. 各案を explorations/<今日の日付>-a, -b, -c/ に保存し、下の「各案に必ず含める項目」をすべて作ってください。
5. 各案に npm run ds:check -- --dir <案のパス> をかけ、不合格は直してください。直せないものは、その旨を書いてください。
6. 最後に比較表を出してください。列は「案 / 一言 / brief との対応 / 強み / リスク / コントラスト検査の結果」です。おすすめは書いてかまいませんが、確定はせず、私が選ぶまで待ってください。
```

各案に必ず含める項目：

1. 名前と一文のコンセプト。brief のどのキーワードをどう解釈したかを書く。
2. 具体的な参照。1〜2文で、形容詞ではなく「何のような」で書く。
3. カラー：名前つきの色 5〜7 色（hex）とその役割（背景、本文、主色、強調、境界線、危険）。主要な組み合わせのコントラスト比も付ける。
4. タイポグラフィ：和文・欧文の書体とフォールバック。文字サイズの段階（6 段階程度）とそれぞれの行間・太さ。本文は 16px 以上、行間 1.5 以上。
5. 密度と形：余白の基数、コントロールの高さ、角丸の段階、影または境界線の方針。
6. 文言の声：ボタン・エラー・空状態の文言例を各 1 つ。
7. 同じ 3 画面の見本：brief の「主な画面」を HTML で作る。比較できるよう、全案で同じ画面と同じ内容にする。
8. トークン案：DTCG 形式の小さな JSON（primitive と semantic）。
9. Do's and Don'ts：各 3 つずつ。
10. リスクと弱点：この案を選んだ場合に作りにくくなる画面や、アクセシビリティ上の懸念。

## 出典

確認日はすべて 2026-11-08。括弧内は、ページに記載された公開日または更新日である。2024年以前のものは「古い」と明記した。

**デザインシステムの公式情報**

- デジタル庁デザインシステム：[トップ（v2.18.2、2026-10-21）](https://design.digital.go.jp/dads/)、[ご利用にあたって（2026-08-05）](https://design.digital.go.jp/dads/introduction/notices/)、[タイポグラフィ（2026-08-05）](https://design.digital.go.jp/dads/foundations/typography/)、[カラー（2026-08-05）](https://design.digital.go.jp/dads/foundations/color/)、[リソース](https://design.digital.go.jp/dads/resources/)、[ウェブアクセシビリティ](https://design.digital.go.jp/dads/webaccessibility/)、[design-tokens](https://github.com/digital-go-jp/design-tokens)
- [GOV.UK Design System（v6.6.0、2026-10-15）](https://design-system.service.gov.uk/)、[Typeface](https://design-system.service.gov.uk/styles/typeface/)、[Colour](https://design-system.service.gov.uk/styles/colour/)
- [Material Web theming](https://github.com/material-components/material-web/blob/main/docs/theming/README.md)（m3.material.io は表示できず）
- [Carbon Themes（2026-08-12）](https://carbondesignsystem.com/elements/themes/overview/)、[Carbon MCP（2026-09-28）](https://carbondesignsystem.com/developing/carbon-mcp/overview/)
- [Primer token names](https://primer.style/product/primitives/token-names/)、[Primer MCP](https://primer.style/product/getting-started/foundations/mcp)、[primer/primitives](https://github.com/primer/primitives)
- [Shopify/polaris（2026-09-11 アーカイブ）](https://github.com/Shopify/polaris)
- [Atlassian design tokens](https://atlassian.design/foundations/tokens/design-tokens)、[ADS License（2025-03-13）](https://atlassian.design/license)、[Atlassian’s DESIGN.md is here（2026-06-15）](https://www.atlassian.com/blog/how-we-build/atlassians-design-md-is-here-what-we-learned-testing-portable-design-context-in-practice)

**トークンと DESIGN.md の仕様**

- [Design Tokens Format Module 2025.10（2025-10-28）](https://www.designtokens.org/tr/2025.10/format/)、[W3C の告知](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/)
- [Style Dictionary の DTCG 対応](https://styledictionary.com/info/dtcg/)、[Figma Modes for variables](https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables)、[Penpot コミュニティ（2026-05-04）](https://community.penpot.app/t/token-export-is-tokens-studio-format-not-dtcg-2025-10/10544)
- [google-labs-code/design.md（alpha）](https://github.com/google-labs-code/design.md)、[Google の発表（2026-04-21）](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/)
- [Supernova: DESIGN.md for Design Systems（2026-11-03）](https://www.supernova.io/blog/design-md-design-system)、[Supernova: What to Put in CLAUDE.md（2026-08-11）](https://www.supernova.io/blog/what-to-put-in-claude-md-for-a-design-system)

**Anthropic と Claude Code**

- [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)、[Claude Code Skills](https://code.claude.com/docs/en/skills)、[Claude Code Memory](https://code.claude.com/docs/en/memory)、[Plugin evals](https://code.claude.com/docs/en/plugin-evals.md)
- [anthropics/skills: frontend-design（2026-09-03）](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)、[skill-creator（2026-03-06）](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)
- [Improving frontend design through Skills（2025-11-12）](https://claude.com/blog/improving-frontend-design-through-skills)、[Claude Design（2026-04-17）](https://www.anthropic.com/news/claude-design-anthropic-labs)、[Demystifying evals for AI agents（2026-01-09）](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

**品質・規格・研究**

- [WCAG 2.2（2024-12-12）](https://www.w3.org/TR/WCAG22/)、[ISO/IEC 40500:2025 の告知（2025-10-21）](https://www.w3.org/WAI/news/2025-10-21/wcag22-iso)、[WCAG 3.0 Working Draft（2026-09-10）](https://www.w3.org/TR/wcag-3.0/)
- [WAIC セミナー資料（2026-02-06）](https://waic.jp/wp-content/uploads/2026/02/20260206-waic-a11y-seminar-2.pdf)、[Allyera：JIS X 8341-3 の現状（2026-11-05 更新）](https://allyera.cultive.co.jp/columns/jis-x8341-3-current/)
- [axe-core](https://github.com/dequelabs/axe-core)、[Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing)、[Playwright snapshots](https://playwright.dev/docs/test-snapshots)、[reg-suit](https://github.com/reg-viz/reg-suit)、[Adobe Leonardo](https://github.com/adobe/leonardo)
- [stylelint-declaration-strict-value](https://github.com/AndyOGo/stylelint-declaration-strict-value)、[ensure-design-token-usage](https://atlassian.design/components/eslint-plugin-design-system/ensure-design-token-usage/usage)、[primer/stylelint-config](https://github.com/primer/stylelint-config)、[stylelint-plugin-carbon-tokens](https://github.com/carbon-design-system/stylelint-plugin-carbon-tokens)、[design-system-mcp](https://github.com/dgesteves/design-system-mcp)
- [Panickssery ほか（2024、古い）](https://arxiv.org/abs/2404.13076)、[Zheng ほか（2023、古い）](https://arxiv.org/abs/2306.05685)、[Verga ほか（2024、古い）](https://arxiv.org/abs/2404.18796)、[AesEval-Bench（2026-03）](https://arxiv.org/abs/2603.01083)

**調査・解説記事・公開事例**

- [State of AI in Design Systems（2026-07-28 時点）](https://state-of-ai-in-design-systems.netlify.app/)、[Hardik Pandya: Expose your design system to LLMs](https://hvpandya.com/llm-design-systems)、[Brad Frost: Agentic Design Systems in 2026（2025-12-16）](https://bradfrost.com/blog/post/agentic-design-systems-in-2026/)
- [v0 Design Systems 2.0（2026-11-06）](https://v0.app/docs/design-systems-2)、[GitHub Replica（2026-10-28）](https://github.blog/changelog/2026-10-28-introducing-replica-an-open-source-ai-prototyping-tool)、[bydiorama/ui](https://github.com/bydiorama/ui)、[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)、[kzhrknt/awesome-design-md-jp](https://github.com/kzhrknt/awesome-design-md-jp)
- [AI For Developers: DESIGN.md for Design in Claude Code（2026-07-26）](https://aifordevelopers.substack.com/p/designmd-for-design-in-claude-code)、[designproject.io: Agentic design system（2026-08-28）](https://designproject.io/blog/agentic-design-system-context/)
- 日本語記事は「X での情報収集と公開事例」の表を参照。このほか [Classmethod：AIエージェント対応の動き（2026-07-04）](https://dev.classmethod.jp/articles/design-system-ai-agent-roundup/)、[azukiazusa：Figma MCP（2026-01-03）](https://azukiazusa.dev/blog/using-figma-mcp-to-provide-design-system-for-ai-coding-agents)

**X の投稿**（X API v2 の Recent Search で 2026-11-08 に取得。投稿日と発信者は本文の表を参照）：[@kgsi](https://x.com/kgsi/status/2118147692950159496)、[@MacopeninSUTABA](https://x.com/MacopeninSUTABA/status/2118901755001913660)、[@this\_majika](https://x.com/this_majika/status/2118394206620405795)、[@CULUMU\_Design](https://x.com/CULUMU_Design/status/2116817785321886037)、[@HackrLife](https://x.com/HackrLife/status/2116849411938799775)、[@\_heyrico](https://x.com/_heyrico/status/2117239556114358552)、[@edo\_lunardi](https://x.com/edo_lunardi/status/2117958290860617957)、[@VNallatamby](https://x.com/VNallatamby/status/2118811245986075046)、[@fankaishuoai](https://x.com/fankaishuoai/status/2117982660429816077)、[@joacode\_](https://x.com/joacode_/status/2117968073017700828)
