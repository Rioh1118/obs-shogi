# デザインの決め方（移り先の案内）

**デザインの正本はデザインシステム（`design-system/`）に移った。** UI・SCSS・画面の文言を作る／直す前に
`obs-shogi-design-system` スキルを使う。このファイルには規則を書かない。

ADR と仕様がこのファイルの節を名指しているので、節ごとの移り先だけを残す。
振り分けの経緯は `docs/proposals/design-system-migration.md`。

| 旧い節                                        | 移り先                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 0. 性格（2つの層、額縁の性格）                | `design-system/design_system/principles.md` の原則1・2、`design-system/design_system/brief.md`                          |
| 1. 置き場                                     | `CLAUDE.md`「依存の方向」。新しい画面は `docs/spec/README.md` の一覧に足す                                              |
| 2. 寸法（文字、間隔と角丸、角丸の役割、太さ） | `design-system/design_system/tokens/semantic.tokens.json`。製品の名前は `src/index.scss` が結ぶ。ラチェットは ADR-0003  |
| 3. 色（意味色の tier、ホバーの向き）          | `design-system/design_system/patterns/status-and-feedback.md`、`design-system/design_system/components/button.md`       |
| 4. 重なりと影                                 | `design-system/design_system/tokens/semantic.tokens.json` の `z` と `shadow`                                            |
| 5. 振る舞い（状態の見せ方、動き、密度）       | `design-system/design_system/patterns/status-and-feedback.md`、`design-system/design_system/principles.md` の原則3〜5   |
| 5. 部品の選び方、ボタンの役割、部品の基準     | `design-system/design_system/components/_index.md`、`design-system/design_system/components/button.md`                  |
| 5. 選択の見せ方                               | `design-system/design_system/patterns/selection.md`                                                                     |
| 6. 言葉（文の型）                             | `design-system/design_system/content/voice-and-tone.md`                                                                 |
| 6. 用語、将棋 GUI の語                        | `design-system/design_system/content/glossary.md`。語の決定は ADR-0012、コードの名前は `CONTEXT.md`                     |
| 6. 表記                                       | `design-system/design_system/content/writing-rules.md`                                                                  |
| 7. まだ決まっていないこと                     | `design-system/design_system/patterns/README.md` の問い                                                                 |
| 参考にしてよいもの                            | `design-system/references/product-references-2026-11.md`                                                                |
| やらないこと                                  | `design-system/design_system/principles.md` の原則7。幅の下限は `design-system/design_system/patterns/README.md` の問い |
