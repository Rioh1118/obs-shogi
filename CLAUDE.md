# obs-shogi

Tauri v2 デスクトップアプリ（React 19 + TypeScript + SCSS / Rust）。将棋の棋譜研究環境。

## 検証（変更後に必ず実行）

```bash
npm run verify          # tsc -b + lint + vitest      （約8秒）
npm run verify:rust     # cargo fmt + clippy + test   （約2分15秒）
```

`git commit` は `.claude/hooks/verify-gate.sh` が横取りし、変更ファイルの種類に応じて
上を自動で走らせる。落ちればコミット自体が止まる。**止まったら直す。飛ばさない。**
docs や `.claude/` だけの変更は素通しする。

作業を「完了」と報告する前に該当する方を必ず通すこと。通していないなら「未検証」と明示すること。

## レビュー

実装を変えたら必ずレビューを通す。

- `/review-round` — 観点ごとの reviewer を並列で走らせ `.claude/reviews/` に報告書を書く
- `/review-fix` — 報告書の所見を1件1コミットで直し、結果を報告書に書き戻す

指摘がゼロのラウンドが1回出るまでこのループを終わらせない。

## コメント

基準は `CONTRIBUTING.md` の「コメントの書き方」。読み手は**その変更を書いた人ではない**。

- 書くのは「なぜ」。何をしているかはコードで表す
- **変更の経緯を書かない。**「今回の修正で」「〜に変更した」「PR #N で対応」は全て禁止。
  経緯は git log と PR に残る。コードには現在どうあるべきかだけを書く
- コードを変えたらコメントも変える。腐ったコメントは無いより悪い
- `TODO` は issue 番号を伴わせる（`// TODO(#123): ...`）

## テストの現状（誇張しないこと）

TS 側のテストは2ファイル、Rust 側は `#[test]` が0個。`cargo test` の green は**何も保証しない**。
「テストが通ったので安全」と書いてはいけない。新規ロジックには実際にテストを足すこと。

## 依存の方向（`src/`）

レイヤは Feature-Sliced Design。import は**下向きだけ**。

```
app → pages → widgets → features → entities → shared
```

上向きの import を新しく作らない。共有したい型やロジックは、共有できる位置まで**下げる**。
（2026-08 時点で違反8件が残っている。lint で強制する準備はできているが、まだ有効化していない）

## 変更時に連動が必要な箇所

- Tauri コマンドを追加 → `src-tauri/src/lib.rs` の登録も必ず更新する
- モーダルを追加 → `src/shared/lib/router/useURLParams.ts` の `ModalType` union を更新する

## 既知の落とし穴

- `tesuuPointer` は `"7,[{\"te\":3,\"forkIndex\":0}]"` 形式。パースは `indexOf(",")` で分割し後半を `JSON.parse`。この手書きパースが複数箇所に重複しているので、触るなら共通化を検討する
- `JKFPlayer.goto(tesuu, forkPointers)` は goto 後に `tesuu` が一致しなければ stale として扱う
- JSX 内の全角スペースは `no-irregular-whitespace` で lint エラーになる → `{"　"}` で囲む
- SCSS トークンは `@use "@/index.scss" as index;` で読み込む
- `main` に注釈機能（marks / file-meta / normalizedTree）は**存在しない**。未マージブランチの識別子を既存として参照しないこと

## 進め方

- 着手中の issue は**常に1件**。`gh issue list --assignee @me` が2件以上返る状態を作らない
- コミットは `<type>: <description>`（type: feat/fix/refactor/docs/test/chore/perf/ci）
- `main` に直接コミットしない。ブランチを切ること
- 同じ失敗を2回するまでルールを足さない。1回目は**ルールではなくテスト**を書く
