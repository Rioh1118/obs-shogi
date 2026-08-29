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
```

## いま何が書けているか

| 表                                                 | 状態      | 備考                                                       |
| -------------------------------------------------- | --------- | ---------------------------------------------------------- |
| [app.md](app.md)                                   | ✅        | L0                                                         |
| [engine.md](engine.md)                             | ✅        | 外部プロセスを列に持つ                                     |
| [analysis.md](analysis.md)                         | ✅        | Rust セッションを列に持つ                                  |
| [file-tree.md](file-tree.md)                       | ✅        |                                                            |
| [engine-position-sync.md](engine-position-sync.md) | ✅        | 既存。issue #120 の産物                                    |
| [failure-surfacing.md](failure-surfacing.md)       | ✅        | Q-005 の材料                                               |
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
