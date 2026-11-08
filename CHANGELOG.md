# Changelog

形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に倣い、版は semver（上げ方は CLAUDE.md）。

## [Unreleased]

### 変更
- 汎用の土台（upstream）から製品専用に複製した。ブランド名・スキル名・パッケージ名を lumen.config.json と手書きの文書で替えた。CSS の接頭辞は upstream に合わせて `lm` のまま

### 追加
- references/current-screens-2026-11-08/：移行前の製品の画面16枚と一覧、実測の色
- brief.md v0.2：製品側の既存の決定と利用者の発言、モード B の質問への回答（コンセプト・性格の軸・成功を判定する目・避けたいもの）を埋めた

## [0.0.0] - 2026-11-08

### 追加
- リポジトリの器：スキル（SKILL.md）、保守規約（CLAUDE.md）、利用先向けルール（docs/consumer-claude-md.md）
- トークンの3層（base / semantic / component）を DTCG 2025.10 で。値はすべて仮（グレーの階調、4px 基数の余白、OS 標準書体）
- 固定値（locked.json）：フォーカス表示の二重リング、本文 16px・行間 1.5 の下限、コントラスト基準
- light / dark テーマ（`[data-theme]`）
- Button の見本（React + 素の CSS）
- ds:build / ds:check / ds:shot / ds:eval
- 判断記録 0001（構造）、0002（フックと CI の TODO）
