# obs-shogi

Tauri v2 デスクトップアプリ（React 19 + TypeScript + SCSS / Rust）。将棋の棋譜研究環境。

## 検証（変更後に必ず実行）

```bash
npm run verify          # tsc -b + lint + vitest
npm run verify:rust     # cargo fmt --check + clippy -D warnings + cargo test
```

作業を「完了」と報告する前に該当する方を必ず通すこと。通していないなら「未検証」と明示すること。

## テストの現状（誇張しないこと）

TS 側のテストは2ファイル、Rust 側は `#[test]` が0個。`cargo test` の green は**何も保証しない**。
「テストが通ったので安全」と書いてはいけない。新規ロジックには実際にテストを足すこと。

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
