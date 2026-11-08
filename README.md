# デザインシステム（構造のみ・値は仮）

このリポジトリは、デザインシステムの正本であり、そのまま Claude Code のスキルでもある。名前は `lumen.config.json` にある。

- 使い方の手順（AI 向け）：SKILL.md
- 保守の規約：CLAUDE.md
- 利用先への導入：docs/consumer-claude-md.md
- 構造を決めた理由：decisions/0001-structure.md
- 調査記事：references/research-2026-11.md

## セットアップ

```sh
npm install
npx playwright install chromium
npm run ds:build
npm run ds:check
ln -s "$PWD" ~/.claude/skills/obs-shogi-design-system   # スキルとして使う
```

## 次にやること

1. design_system/brief.md を書く。
2. Claude Code で「デザインシステムの方向性を探りたい」と頼み、SKILL.md のモード B で3案を作る。
