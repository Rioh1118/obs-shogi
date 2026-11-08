# 0002. PreToolUse フックと CI（TODO）

- 状態：提案（未着手）
- 日付：2026-11-08

今回は器づくりなので作らない。後で着手するときの論点を残す。

## TODO

- [ ] **PreToolUse フック**（利用先の .claude/settings.json）：Write / Edit の内容に色の直書きや Tailwind が含まれていたら exit 2 で止め、理由を Claude に返す。判定は ds:check と同じ規則（stylelint.config.mjs、scripts/check.mjs の JSX 規則）を使い、二重管理しない。
- [ ] **CI（GitHub Actions）**：push と PR で `npm run ds:check` と `npm run ds:eval -- --dry-run`。
- [ ] **画像差分の環境**：基準画像は macOS（system-ui の書体）で撮っている。Linux の CI で ds:shot を回すには、Linux 用の基準画像を別に持つか、Web フォントを同梱して描画差を減らす。
- [ ] **eval の定期実行**：`npm run ds:eval` は実費がかかる。部品や SKILL.md を変えたときだけ回すか、閾値（`--threshold`）と上限額（`--max-cost-usd`）を決めて CI に載せるかを決める。
- [ ] **design.md の lint**：`designmd lint` の警告（orphaned-tokens）を CI で失敗にするかどうか。部品が増えるまでは警告のままにする。
