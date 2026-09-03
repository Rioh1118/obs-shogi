# obs-shogi

Tauri v2 デスクトップアプリ（React 19 + TypeScript + SCSS / Rust）。将棋の棋譜研究環境。

## 検証（変更後に必ず実行）

```bash
npm run verify          # tsc -b + lint + vitest      （約8秒）
npm run verify:rust     # cargo fmt + clippy + test   （約2分15秒）
```

`git commit` は `.claude/hooks/verify-gate.sh` が横取りし、**その変更を見る検査がある側**を
自動で走らせる。落ちればコミット自体が止まる。**止まったら直す。飛ばさない。**

**種類で二分しない。** `docs/` も `CONTRIBUTING.md` も `.claude/hooks/` も `verify` を通り、
`docs/state-transitions/` は `verify:rust` まで通る（表とテストの名乗りを突き合わせる
ラチェットが Rust 側にある）。どれがどちらを通るかは
`.claude/hooks/verify-gate.test.sh` が固定している。

作業を「完了」と報告する前に該当する方を必ず通すこと。通していないなら「未検証」と明示すること。

## 実装

**コードを変更する前に `/implement` を読む。** 刻み方・レビューの厚さの決め方・
途中で見つけた既存の問題の扱い・PR までの順序をそこに置いてある。

- `/review-round` — 観点ごとの reviewer を並列で走らせ `.claude/reviews/` に報告書を書く
- `/review-plan` — 1ラウンド分の所見を読み切り、直す順と「その修正が壊しうるもの」を報告書に書く
- `/review-fix` — 計画の順に所見を1件1コミットで直し、結果を報告書に書き戻す

指摘がゼロのラウンドが1回出るまでこのループを終わらせない。

**画面に触る前に `docs/spec/` を読む。** 画面ごとに「いま何ができて、何ができないか」が
書いてある。触った画面の仕様が現物と違うようになったら、同じ PR で直す。

## コメント

基準は `CONTRIBUTING.md` の「コメントの書き方」。読み手は**その変更を書いた人ではない**。

- 書くのは「なぜ」。何をしているかはコードで表す
- **変更の経緯を書かない。**「今回の修正で」「〜に変更した」「PR #N で対応」は全て禁止。
  経緯は git log と PR に残る。コードには現在どうあるべきかだけを書く
- コードを変えたらコメントも変える。腐ったコメントは無いより悪い
- `TODO` は issue 番号を伴わせる（`// TODO(#123): ...`）

## テストの現状（誇張しないこと）

**件数をここに書かない。** 書くと必ず腐る。現在値は `npm run test` と
`cargo test` の末尾で確認すること。

**厚さは面によって全く違う。** 対局の状態機械（`engine/game/`）は変異を当てて
埋めてあるが、**実プロセスを要する経路は1つも固定されていない**（`gameover` が
実際にワイヤへ出ること、`ponderhit` の書き込みが落ちたとき）。
`src-tauri/tests/` の大半は**ソースを走査するラチェット**で、振る舞いは見ていない。
**例外は `engine_timeouts.rs`** ——ソースを読まず、段を跨ぐ上限どうしの関係を
式で固定している。`CLOSE_TIMEOUT` の doc はその保証を根拠にしているので、
赤くなったら「走査の都合」と読まず、どちらの定数が動いたのかを見ること。

**`cargo test` の green は「Rust が壊れていない」を意味しない。**
「テストが通ったので安全」と書いてはいけない。新規ロジックには実際にテストを足し、
**変異を当てて落ちることを確かめる**こと（落ちないなら、そのテストは別の理由で通っている）。

## 依存の方向（`src/`）

レイヤは Feature-Sliced Design。import は**下向きだけ**。

```
app → pages → widgets → features → entities → shared
```

上向きの import を新しく作らない。共有したい型やロジックは、共有できる位置まで**下げる**。

lint が強制する。`vite.config.ts` の `no-restricted-imports` をレイヤごとの override で表現してあり、
違反すると `npm run lint` が落ちる。**2階層以上遡る相対 import も禁止**（`@/` を通らない経路を残すと
レイヤ規則が素通りするため）。循環は `import/no-cycle` が拾う。

## 変更時に連動が必要な箇所

- Tauri コマンドを追加 → `src-tauri/src/lib.rs` の登録も必ず更新する
- モーダルを追加 → `src/shared/lib/router/useURLParams.ts` の `ModalType` union を更新する

## 既知の落とし穴

- **`KifuCursor` を作る口は `cursorFromPlayer`（`entities/kifu/lib/playerCursor.ts`）と定数の `ROOT_CURSOR` だけ。** `tesuuPointer` の欄に入れてよいのは再生器が返した**観測値**で、要求の鍵（`cursorKey`）を入れない。入れると着けもしない局面の識別子が `state.cursor` に入り、移動前後の比較が「動いていない」と誤判定して**盤が止まるのにエラーも出ない**。要求の鍵は `CursorKey` という別の型なので、観測の欄に入れると tsc が落とす。キャストとスプレッドは `src/__tests__/cursorConstruction.test.ts` が見る
- `tesuuPointer` は `"7,[{\"te\":3,\"forkIndex\":0}]"` 形式。**解く経路はリポジトリに1つも無い。** 分解したくなったら、それは `KifuCursor` の `tesuu` / `forkPointers` を直接見るべき合図。鍵を組む側は `cursorKey`（`entities/kifu/model/cursor.ts`）に寄せる。正規化を通すのはこれだけで、整形だけを担う `formatPointer` は同ファイルの非公開
- **要求した局面に着いたかは `tesuu` では判定できない。** `goto` は届かなければ黙って止まり、実在しない変化は黙って捨てて同じ `tesuu` の別の線に着く。突き合わせは `reachedCursor`（`entities/kifu/lib/playerCursor.ts`）を通す
- JSX 内の全角スペースは `no-irregular-whitespace` で lint エラーになる → `{"　"}` で囲む
- SCSS トークンは `@use "@/index.scss" as index;` で読み込む
- SCSS の寸法は直値を書かず `src/index.scss` のトークンから選ぶ。**文字サイズはサイズ名でなく用途名**
  （`$font-hint` / `$font-aux` / `$font-body` …）。ラチェットが見るのは
  **スケールに載るプロパティだけ**（ADR-0003）。`min-height` などは素通りするので、
  緑で通ったことを「規約に沿っている」と読まない
- `main` に注釈機能（marks / file-meta / normalizedTree）は**存在しない**。未マージブランチの識別子を既存として参照しないこと

## 進め方

- コミットは `<type>: <description>`（type: feat/fix/refactor/docs/test/chore/perf/ci）
- `main` に直接コミットしない。ブランチを切ること
- 同じ失敗を2回するまでルールを足さない。1回目は**ルールではなくテスト**を書く
