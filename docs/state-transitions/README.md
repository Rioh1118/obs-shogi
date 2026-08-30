# 状態遷移表

**状態 × イベント**を先に列挙し、空のセルを未検証の経路として残す。手順は
`.claude/skills/state-transition-table/SKILL.md`。

## 表の階層

上の表ほど粒度が粗く、セルから下の表を参照する。**セルの中身を書ききれないと感じたら、
そこが下の表を分けるべき境目。**

```
L0  app.md                    アプリ全体。どのスライスに委譲されるかだけを書く
      │
L1    ├─ engine.md            エンジンプロセスの起動・停止（外部プロセスを列に持つ）
      ├─ analysis.md          解析セッション（Rust 側のセッションを列に持つ）
      ├─ file-tree.md         ツリーとファイル操作
      ├─ game.md              （未作成）棋譜の読み込み・移動・編集
      ├─ search.md            （未作成）インデックスと検索セッション
      └─ study-positions.md   （未作成）研究局面の読み書き
            │
L2          └─ engine-position-sync.md   局面の送信（L1 の analysis / engine をまたぐ）

横断  failure-surfacing.md     失敗が最終的にどこへ出るか。L0〜L2 のどの表からも参照される
横断  branch-index.md          分岐を指す値の分類。スライスの状態機械ではなく、値が取りうる形の表

判定  book-key-failures.md     book_key_or_reason の検査の順序 × 入力の形
判定  verify-gate-decision.md  verify-gate の段 × コマンドの形
```

`branch-index.md` だけ粒度が違う。スライスの状態ではなく**1つの値が取りうる形**を軸にしている。
`game.md` を書くときは「棋譜がどの状態にあるか」をそちらへ、
「`BranchIndex` にどの値が入りうるか」は `branch-index.md` に置く。

「判定」の2つはさらに粒度が違う。アプリの状態ではなく、**1つの関数 / 1つの hook が
入力をどの枝へ落とすか**を軸にしている。先に置いた検査が後ろの枝を覆い隠す形の穴を、
セルの重なりとして見るために作った。

## いま何が書けているか

| 表                                                 | 状態      | 備考                                                       |
| -------------------------------------------------- | --------- | ---------------------------------------------------------- |
| [app.md](app.md)                                   | ✅        | L0                                                         |
| [engine.md](engine.md)                             | ✅        | 外部プロセスを列に持つ                                     |
| [analysis.md](analysis.md)                         | ✅        | Rust セッションを列に持つ                                  |
| [file-tree.md](file-tree.md)                       | ✅        |                                                            |
| [engine-position-sync.md](engine-position-sync.md) | ✅        | 既存。issue #120 の産物                                    |
| [failure-surfacing.md](failure-surfacing.md)       | ✅        | どの失敗がどこへ出るかの台帳（F 番号の採番元）             |
| [inline-name-editor.md](inline-name-editor.md)     | ✅        | `file-tree.md` の下。入力欄の中だけを扱う                  |
| [branch-index.md](branch-index.md)                 | ✅        | 値の分類表。スライスの状態機械ではない                     |
| [book-key-failures.md](book-key-failures.md)       | ✅        | 判定表。`book_key_or_reason` の検査の順序                  |
| [verify-gate-decision.md](verify-gate-decision.md) | ✅        | 判定表。`verify-gate` の段                                 |
| `game.md`                                          | ❌ 未作成 | `set_error` が9箇所から飛ぶが読み手が0。**書く価値が高い** |
| `search.md`                                        | ❌ 未作成 | インデックスと検索セッションで状態機械が2つある            |
| `study-positions.md`                               | ❌ 未作成 |                                                            |

**未作成を消さないこと。** 消すと「表を作った」だけで安心してしまう。

## 表を書くときに毎回忘れるもの

`.claude/skills/state-transition-table/SKILL.md` に理由つきで書いてある。要点だけ:

- **否定方向の遷移**（ready になる、だけでなく ready でなくなる）
- **同じ値のままの再初期化**（識別子が変わらないエンジンの再起動）
- **利用者による中断**（停止ボタン、モーダルを閉じる、棋譜を閉じる）
- **失敗**（成功だけ書いて失敗を書かない、が最頻）
- **外部プロセスの状態を列に入れる**。入れ忘れが issue #120 の BLOCK だった
