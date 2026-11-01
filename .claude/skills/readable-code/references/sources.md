# 出典

2026-11-01 に読んだ。取ったのは考え方で、本文は転載していない。

| 出典 | 取ったもの |
| --- | --- |
| [Rust API Guidelines: Documentation](https://rust-lang.github.io/api-guidelines/documentation.html) | 失敗の条件を doc に書く（C-FAILURE）。実装の詳細を利用者向けの doc に出さない（C-HIDDEN） |
| [rustdoc book: How to write documentation](https://doc.rust-lang.org/rustdoc/how-to-write-documentation.html) | 要約は1行。型は署名から分かるので doc で書き直さない |
| [RFC 1574](https://rust-lang.github.io/rfcs/1574-more-api-documentation-conventions.html) | 要約は短い1文。モジュールの doc と型の doc の分担 |
| [TSDoc: @remarks](https://tsdoc.org/pages/tags/remarks/) | 短い要約と詳細を分ける。`@throws` は種類ごとに書く（[@throws](https://tsdoc.org/pages/tags/throws/)） |
| [Go Doc Comments](https://go.dev/doc/comment) | 関数の doc は何を返すか何をするかを書く。アルゴリズムの内部を書かない。型の doc は1つの値が何を表すかを書く |
| [Swift API Design Guidelines](https://www.swift.org/documentation/api-design-guidelines/) | 要約で始める。簡単に説明できないなら API の設計を疑う |
| [Linux kernel coding style 8) Commenting](https://www.kernel.org/doc/html/latest/process/coding-style.html) | どう動くかを書かない。本文でなく関数の頭に書く。説明が要るほど複雑なら割る。署名を繰り返す定型の doc を足さない |
| [Google C++ Style Guide: Comments](https://google.github.io/styleguide/cppguide.html) | 自明なことを書かない。良い名前を先に。TODO は識別子を伴う（要約を介して読んだ。原文の逐語は未確認） |
| [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) | 利用者向けは JSDoc、実装向けは行コメント。名前と型を言い換えるだけの `@param` を書かない（同上） |
| [Google eng-practices: Comments](https://google.github.io/eng-practices/review/reviewer/looking-for.html) | なぜを書く。コードが語れないならコードを単純にする |
| [PEP 8: Comments](https://peps.python.org/pep-0008/#comments) | コードと矛盾するコメントは無いより悪い |
| [PEP 257](https://peps.python.org/pep-0257/) | 要約は1行。署名を繰り返さない |
| [John Ousterhout, APOSD vs Clean Code](https://github.com/johnousterhout/aposd-vs-clean-code) | 深いモジュールと浅いモジュール。2つのメソッドを行き来しないと読めないなら絡み合いの合図。小さく割りすぎない（Method Length の節は原文、Comments の節は要約を介して読んだ） |
| [A Philosophy of Software Design 公式ページ](https://web.stanford.edu/~ouster/cgi-bin/book.php) | 書籍の位置づけだけ。**本体は読んでいない** |
| [文化審議会「公用文作成の考え方」(2022)](https://www.bunka.go.jp/seisaku/bunkashingikai/kokugo/hokoku/pdf/93651301_01.pdf) | 一文を短く（50〜60字で意識する）、一文の論点は1つ、結論を早めに、指示語を近くに、二重否定を避ける |
| [JTF 標準スタイルガイド](https://www.jtf.jp/tips/styleguide) | 敬体か常体に統一する。句読点は「、」「。」（文の組み立ての本文 PDF は読めなかった） |
| [『リーダブルコード』目次](https://www.oreilly.co.jp/books/9784873115658/) | 名前、コメント、制御、再構成の章立てを見る項目の順の参考にした。**本文は読んでいない**。読み手の理解を基準に置く考え方は `docs/rules/` と同じ |
| [React: Passing Props to a Component](https://react.dev/learn/passing-props-to-a-component) | `children` は親が埋める穴。カードやパネルのような包む部品で使う。`props` の展開は控えめにする |
| [React: Passing Data Deeply with Context](https://react.dev/learn/passing-data-deeply-with-context) | Context の前に `props` と `children` を試す。何段か渡すだけでは Context にする理由にならない |
| [React: Thinking in React](https://react.dev/learn/thinking-in-react) | 部品は1つのことだけを扱う。state は読み手の最も近い共通の親に置く |
| [React: You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) | 描画のための変換と利用者の操作の処理に effect は要らない |
| [React: Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state) | state は木の位置に結び付く。同じ位置の別の部品で捨てられる。部品の中で部品を定義しない |
| [React: Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure) | 矛盾する state を避け、送信中と送信済みの真偽の組を1つの状態にする |
| [React: Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) | hook は用途の名前で抜く。`useState` 1行を包まない。部品の寿命を名乗るだけの hook を作らない |
| [React: Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks) | hook は最上位で早期 return の前に呼ぶ。宣言の順の決まりは無いので、順はこのリポジトリの決定（R-TSW-4） |
| [React: memo](https://react.dev/reference/react/memo) | `children` で受けるラッパーは、自分の state の更新で子を描き直さない。`memo` は最適化で保証ではない |
| [TypeScript Handbook: Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html) | `interface` と `type` はほぼ同じで、違いはマージの可否と union |
| [typescript-eslint: consistent-type-definitions](https://typescript-eslint.io/rules/consistent-type-definitions/) | 既定は `interface`。どちらでも1つに揃える利点が大きい |

## 読めなかったもの

- Oracle「How to Write Doc Comments」: HTTP 403
- `yomiyasu` という skill: `~/.claude`、`~/dev`、公開情報のいずれにも見つからず、外した

## 出典が割れる点と、ここでの決定

| 点 | 出典 | 決定 |
| --- | --- | --- |
| 要約の形 | Go は完全文、Swift は文の断片、Rust は三人称現在形 | 関数は文、型は名詞句。日本語で両方が自然に書け、1行の doc で現に並んでいる |
| 全ての宣言に doc を書くか | Swift は全宣言、Go と rustdoc は公開だけ | 公開だけ。非公開は名前で足りないときに書く。`CONTRIBUTING.md` の既存の規則と同じ |
| 例を必ず書くか | Rust だけが強い | 求めない。アプリの内部 API で、呼び手がリポジトリの中に居る |
| `interface` か `type` か | Handbook と typescript-eslint は `interface` | `type`。リポジトリの形を標準より先に見る基準で決めた（ADR-0014） |
