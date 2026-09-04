# 状態遷移表

**状態 × イベント**を先に列挙し、空のセルを未検証の経路として残す。手順は
`.claude/skills/state-transition-table/SKILL.md`。

**画面から入るなら `docs/spec/` が先。** あちらは「その画面で何ができて、何ができないか」を
書いた読み物で、状態の網羅はこちらへリンクしている。この表は網羅を担い、画面の説明を持たない。

## 表の階層

上の表ほど粒度が粗く、セルから下の表を参照する。**セルの中身を書ききれないと感じたら、
そこが下の表を分けるべき境目。**

```text
L0  app.md                    アプリ全体。どのスライスに委譲されるかだけを書く
      │
L1    ├─ engine.md            エンジンプロセスの起動・停止（外部プロセスを列に持つ）
      ├─ analysis.md          解析セッション（Rust 側のセッションを列に持つ）
      ├─ file-tree.md         ツリーとファイル操作
      ├─ game.md              棋譜の読み込み・移動・編集（カーソルと分岐計画）
      ├─ search.md            インデックスと検索（**Rust 側**。ディスクのキャッシュを列に持つ）
      └─ study-positions.md   （未作成）研究局面の読み書き

L2    engine-position-sync.md  局面の送信。L1 の analysis と engine の両方をまたぐ
L2    position-search-view.md  局面検索の**画面**。L1 の search の結果を出す側だけを扱う
L2    inline-name-editor.md    名前の入力欄。L1 の file-tree の中だけを扱う

横断  failure-surfacing.md     失敗が最終的にどこへ出るか。L0〜L2 のどの表からも参照される
横断  branch-index.md          分岐を指す値の分類。スライスの状態機械ではなく、値が取りうる形の表

判定  book-key-failures.md     book_key_or_reason の検査の順序 × 入力の形
判定  yaneuraou-db-parse.md    .db の読み取り。行の種類 × パーサの状態
判定  verify-gate-decision.md  verify-gate の段 × コマンドの形
```

`branch-index.md` だけ粒度が違う。スライスの状態ではなく**1つの値が取りうる形**を軸にしている。
「棋譜がどの状態にあるか」は [game.md](game.md)、
「`BranchIndex` にどの値が入りうるか」は `branch-index.md` が持つ。

「判定」の表はさらに粒度が違う。アプリの状態ではなく、**1つの関数 / 1つの hook が
入力をどの枝へ落とすか**を軸にしている。先に置いた検査が後ろの枝を覆い隠す形の穴を、
セルの重なりとして見るために作った。

## いま何が書けているか

| 表                                                 | 状態      | 備考                                                        |
| -------------------------------------------------- | --------- | ----------------------------------------------------------- |
| [app.md](app.md)                                   | ✅        | L0                                                          |
| [engine.md](engine.md)                             | ✅        | 外部プロセスを列に持つ                                      |
| [analysis.md](analysis.md)                         | ✅        | Rust セッションを列に持つ                                   |
| [file-tree.md](file-tree.md)                       | ✅        |                                                             |
| [engine-position-sync.md](engine-position-sync.md) | ✅        | 既存。issue #120 の産物                                     |
| [failure-surfacing.md](failure-surfacing.md)       | ✅        | どの失敗がどこへ出るかの台帳（F 番号の採番元）              |
| [inline-name-editor.md](inline-name-editor.md)     | ✅        | `file-tree.md` の下。入力欄の中だけを扱う                   |
| [branch-index.md](branch-index.md)                 | ✅        | 値の分類表。スライスの状態機械ではない                      |
| [book-key-failures.md](book-key-failures.md)       | ✅        | 判定表。`book_key_or_reason` の検査の順序                   |
| [yaneuraou-db-parse.md](yaneuraou-db-parse.md)     | ✅        | 判定表。`.db` の行の種類 × パーサの状態。一次資料の表を持つ |
| [verify-gate-decision.md](verify-gate-decision.md) | ✅        | 判定表。`verify-gate` の段                                  |
| [game.md](game.md)                                 | ✅        | `cursor.forkPointers` と `branchPlan` の食い違いが軸        |
| [search.md](search.md)                             | ✅        | **Rust 側**。ディスクのキャッシュを列に持つ                 |
| [position-search-view.md](position-search-view.md) | ✅        | `search.md` の画面側。選択・ホバー・焦点の3つを揃える       |
| `study-positions.md`                               | ❌ 未作成 |                                                             |

**未作成を消さないこと。** 消すと「表を作った」だけで安心してしまう。

## 他リポジトリのパスの書き方（この置き場の中だけ）

**`docs/` の他の場所には掛からない。** `IDEAS.md` / `PREMISES.md` / `decisions/` /
`proposals/` は ShogiHome のパスをバッククォートのまま書いている。検査が
`docs/state-transitions/` にしか掛かっていないので、そちらは落ちない。

**広げるときの手順はこの節が持たない。** 落ちるものには外部リンクで片付かない種類が
あり、その一覧と順序は `src/__tests__/docsSourcePaths.test.ts` の doc にある。

`src/__tests__/docsSourcePaths.test.ts` が、これらの表の中でバッククォートに囲まれた
パスの実在を要求する。**要求されるのは自リポジトリの起点と綴りが重なるものだけ** ——
`src/` / `src-tauri/` / `docs/` で始まるか、`src/` の直下のレイヤ名
（`entities/` など）で始まるもの。判定を持つのは `src/__tests__/docsSourcePaths.ts`。

**ShogiHome は `src/` から始まるので、ここに当たる。囲まずに外部リンクで書く。**
囲むと「実在しないパスを指している」で落ちる。

```markdown
[ShogiHome src/background/book/yaneuraou.ts][shogihome-yaneuraou]

[shogihome-yaneuraou]: https://github.com/sunfish-shogi/shogihome/blob/v1.29.0/src/...
```

**参照名は `<リポジトリ名>-<対象>`。** 略すと、同じ表が複数の他リポジトリを引いたときに
参照名から出典が読めなくなる（この表は ShogiHome とやねうら王の両方を引いている）。
定義は使うファイルの末尾に置く。使用と定義の対応は
`src/__tests__/stateTransitionIndex.test.ts` が見る。

**やねうら王は `source/` から始まるので、この検査には当たらない。囲んでよい。**
当たらないのは綴りが重なっていないからであって、腐らないからではない。

**リンク先はタグで固定する。** 一次資料として引いた行が、あちらの `main` の移動で
別のものを指すようになる。

**引用元のライセンスを書く。** 規律は `research/README.md`（引用元のライセンスと
著作権者を各ディレクトリの README に書く）。この置き場が逐語で引くのは
`sunfish-shogi/shogihome`（MIT）、`yaneurao/YaneuraOu`（**GPL-3.0**）、
`yaneurao/YaneuraOu-ScriptCollection`（MIT）の3つ。引くのは実装を論じるのに要る
数行だけで、**いずれの成果物もこのリポジトリの配布物には含まない。**

**行番号を引いたら、囲む・囲まないに関わらず版を残す。** 腐りやすいのは
ファイルの参照より行番号のほうで、しかも版が無いと**どの時点で数えた行なのかを
遡れない**ので、ずれていることにも気づけない。リンクにしないなら、表の冒頭に
「行番号は `<tag>` 時点」と書く。

## 表を書くときに毎回忘れるもの

`.claude/skills/state-transition-table/SKILL.md` に理由つきで書いてある。要点だけ:

- **否定方向の遷移**（ready になる、だけでなく ready でなくなる）
- **同じ値のままの再初期化**（識別子が変わらないエンジンの再起動）
- **利用者による中断**（停止ボタン、モーダルを閉じる、棋譜を閉じる）
- **失敗**（成功だけ書いて失敗を書かない、が最頻）
- **外部プロセスの状態を列に入れる**。入れ忘れが issue #120 の BLOCK だった
