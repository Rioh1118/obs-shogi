# レビュー release-target-guard ラウンド1

- 日付: 2026-08-30
- 範囲: `.github/workflows/release.yml`（`main` `c6e1deb` からの差分）
- 走らせた reviewer: `oss-hygiene-reviewer` / `comment-reviewer`
- 対象コミット: `c78c02c`

`architecture-reviewer` は走らせていない。ファイルの追加・移動も import の変更も無く、
対象が workflow の yml 1本だけで、このレビュアーが見る軸（レイヤ・責務の置き場）に
掛かる変更が1つも無いため。

## 所見

### [HIGH] R1-1 tauri-action v1 で入力名が変わっており、`assetNamePattern` と `includeUpdaterJson` は黙って無視される

- 場所: `.github/workflows/release.yml:161,173,175-179`（reviewer: oss-hygiene）
- 根拠: `tauri-apps/tauri-action` の `action.yml` の inputs を実際に引いた
  （`gh api repos/tauri-apps/tauri-action/contents/action.yml`）。存在するのは
  `uploadUpdaterJson`（既定 `'true'`）と `releaseAssetNamePattern` で、
  `includeUpdaterJson` / `assetNamePattern` は**1つも無い**。
- なぜ問題か: GitHub Actions は未知の入力を `Unexpected input(s)` の warning にするだけで
  ジョブは成功する。`assetNamePattern` が届かないと `getAssetName` が CLI の既定名を返すので、
  v0.2.1 の `ObsShogi-v0.2.1-linux-amd64.AppImage` が `ObsShogi_0.2.2_amd64.AppImage` 系に変わり、
  `release.yml:175-178` に書いてある資産名のコメントが嘘になる。**空打ちは緑になるので気づけない。**
- 直し方: `releaseAssetNamePattern` / `uploadUpdaterJson` へリネームする。
- 導入コミットの sha: `d78964a`（`git log -S 'assetNamePattern' -- .github/workflows/release.yml`）
- 主張を固定するテスト名: 未検証（workflow の入力名を見る検査はこの repo に無い）

### [HIGH] R1-2 非数値の pre-release タグだと Windows の MSI 生成で必ず落ちる

- 場所: `.github/workflows/release.yml:8`（reviewer: oss-hygiene）
- 根拠: タグのパターンのコメントが `# pre-release: v1.0.0-beta.1` を例示している。
  `tauri-bundler` の msi は pre-release 識別子が数値でないと bail する
  （`crates/tauri-bundler/src/bundle/windows/msi/mod.rs` の
  `optional pre-release identifier in app version must be numeric-only`）。
  `src-tauri/tauri.conf.json` の `bundle.targets` は `"all"` なので Windows は msi も作る。
- なぜ問題か: `v1.0.0-beta.1` を打つと `RELEASE_VERSION=1.0.0-beta.1` が焼かれ、Windows だけ赤になる。
  **#256 と同じ「Windows の資産が欠けたまま公開される」に戻る。**
  いままでは `rustup target add` が先に落ちていたので、誰もここへ到達していない。
- 直し方: 例示を数値 pre-release（`v1.0.0-1`）へ直し、非数値が落ちることをコメントに残す。
  タグのパターン自体を `-[0-9]+` に絞るか `bundle.targets` から msi を外すかは
  **設計の選択**なので、この PR では決めない（`/implement` 手順7）→ issue へ。
- 導入コミットの sha: `d78964a`（`git log -S 'pre-release: v1.0.0-beta.1'`）
- 主張を固定するテスト名: 未検証（Windows の bundle を回す検査は CI に無い。#253 と同じ穴）

### [HIGH] R1-3 `workflow_dispatch` に dry-run が無く、空打ちが本番の公開になる

- 場所: `.github/workflows/release.yml:46-67`（reviewer: oss-hygiene）
- 根拠: `draft: false`（`:66`）で、`isPrerel` は `tag.includes('-')` か入力 `prerelease` でしか立たない。
  更新の endpoint は `releases/latest/download/latest.json`。
- なぜ問題か: `-` を含まないタグ（`v0.2.2` など）で空打ちすると、公開リリースが即座に作られて
  `/releases/latest` が置き換わり、**v0.2.1 を使っている利用者全員にテストのつもりのビルドが
  自動更新として降る。**
- 直し方: この PR では workflow を変えない。空打ちのタグを `v0.0.1-1`（`-` を含み、
  かつ MSI が通る数値 pre-release）にすれば `prerelease: true` になり `/releases/latest` に載らない。
  `dry_run` 入力を足す案は分岐が増えて式が読みにくくなるので **issue へ送る**（下の「次ラウンドの対象」）。
- 導入コミットの sha: `d78964a`（`git log -S 'draft:      false'`）
- 主張を固定するテスト名: 未検証

### [MEDIUM] R1-4 dispatch でタグを作ると、タグはデフォルトブランチ・バイナリは dispatch したブランチになる

- 場所: `.github/workflows/release.yml:60-67`（reviewer: oss-hygiene）
- 根拠: `createRelease` に `target_commitish` が無い。既定はリポジトリのデフォルトブランチ。
  一方 `build` の `actions/checkout@v4`（`:104`）は `github.ref` を取る。
- なぜ問題か: このブランチから空打ちすると、Git タグは `main`（ガードを含まない `c6e1deb`）の上に
  作られるのに、バイナリはガード入りのブランチから作られる。**タグが指す木と配布物が一致しない。**
  今回の空打ちがまさにこの経路。
- 直し方: `target_commitish: context.sha` を渡す。
- 導入コミットの sha: `d78964a`
- 主張を固定するテスト名: 未検証

### [MEDIUM] R1-5 コメントの「クロスコンパイルする macOS の2本だけ」が、マトリクスの実態と食い違う

- 場所: `.github/workflows/release.yml:129-134`（reviewer: comment）
- 根拠: macOS の2本はどちらも `macos-latest` で走る（`:80`, `:85`）。片方は必ずホストと同じ
  ターゲットなのでクロスコンパイルではない。`if` が実際に表しているのは
  「`--target` を渡す行かどうか」。
- なぜ問題か: この理由を信じた読み手が macOS-arm64 から `rust_target` を落とすと、
  `tauri_args` の `--target` だけが残って std が無いまま落ちる。
  `/implement` 手順5 の「コメントに書いた理由が実装している条件と違う」に当たる。
- 直し方: 理由を「`--target` を渡す行かどうか」に寄せる。
- 導入コミットの sha: `cc7da8f`（この PR で私が入れた。**私の作った所見**）
- 主張を固定するテスト名: 未検証（`commentHistory` は `src/` と `src-tauri/` しか見ない）

### [MEDIUM] R1-6 `rust_target` と `tauri_args` の `--target` が一致していなければならない不変条件がどこにも書かれていない

- 場所: `.github/workflows/release.yml:79-99`（reviewer: comment）
- 根拠: 同じターゲット文字列が2つの欄に重複している。
- なぜ問題か: **今回のガードが不一致の通り道を増やした。** `rust_target` だけ空にすると
  `if` が false になって add がスキップされ、`--target` だけが残ってビルドが
  `can't find crate for 'std'` で落ちる。逆に `tauri_args` だけ消すと、ホスト向けの成果物が
  macOS-x64 の名前で上がる。
- 直し方: `args` を `rust_target` から導出して、重複そのものを無くす。
- 導入コミットの sha: `d78964a`（`git log -S 'tauri_args'`）
- 主張を固定するテスト名: 未検証

### [LOW] R1-7 `release.yml` のコメントが英語と日本語で割れている（同種10箇所以上のため1件に畳む）

- 場所: 英語 `:3,32,51,64,70,106,119,141,164,172,175-178` / 日本語 `:125-126,129-131`（reviewer: comment）
- なぜ問題か: `CONTRIBUTING.md`「コメントの書き方 > 言語」は日本語指定なので既存の英語が方針外。
  ファイル単位で流儀が2つあると、次に触る人が毎回判断することになる。
- 直し方: この差分では触らない。issue へ。

## 重複・矛盾した所見

無し。2体の見た軸が重なっていない（oss は workflow の振る舞い、comment はコメントと不変条件）。

矛盾に近いものが1組ある。R1-3 の「空打ちで確かめる」と R1-2 の「pre-release タグは数値でないと
Windows が落ちる」は、**同時に満たすタグが `v0.0.1-1` の形しか無い**。片方だけ読むと
`v0.0.1-beta` や `v0.2.2` を選んでしまう。空打ちの手順はこの2つを合わせて決めること。

## 見ていない範囲

- 実際にワークフローを走らせていない。Windows の WiX/NSIS 取得、Linux の AppImage ツール取得など
  ネットワーク越しの外部依存は静的には確認できない（v0.2.1 の実行では成功している）
- v0.2.1 以降に増えた Rust 依存（`notify` / `zstd` / `blake3` / `rayon` / `sysinfo`）が
  ubuntu-22.04 の bundle 段で追加の共有ライブラリを要求しないか
- `latest.json` の URL が tauri-action v1 で API 形式に変わる点。実機の自動更新は試していない
- `vp build`（vite-plus）が Linux ランナーでライセンス等を要求しないか
  （`ci.yml` に Linux のフロントエンドビルドのジョブが無い）
- `macos-latest` が現在どの arch にマップされるか

## lint / hook で強制できるもの

- **`.github/workflows/**` は検証ゲートの分岐（`gate_kinds_for_path`）に1つも当たらないので、
workflow だけの変更はコミット時に何の検査も走らない。** `commentHistory`の`ROOTS`も`src/`と`src-tauri/` だけなので、変更の経緯の混入も見られていない
- 廃止された入力名（R1-1）は機械で拾える。GitHub Actions が `Unexpected input(s)` を
  warning で出すので、dependabot が major を上げた PR では action の `action.yml` の
  inputs と workflow の `with:` の差分を突き合わせる運用が要る。
  **`ci.yml` は tauri-action に `args` しか渡していないので、この種のリネームは Release でしか露見しない**
- 元のバグ（空の matrix 変数がコマンド行に展開される）は actionlint でも拾えない。
  `if:` ガードで同じ結果が得られるので追加の規則は不要

## 結果（書き戻し）

この PR で直したもの。1所見1コミット。

| 所見 | 直したコミット | 何をしたか                                                                          |
| ---- | -------------- | ----------------------------------------------------------------------------------- |
| R1-1 | `8ce379e`      | 入力名を `releaseAssetNamePattern` / `uploadUpdaterJson` へ。理由をコメントに残した |
| R1-2 | `a2b33a6`      | **コメントの例示だけ**。`v1.0.0-beta.1` → `v1.0.0-1` と、非数値が落ちる理由         |
| R1-4 | `c4c212e`      | `target_commitish: context.sha`                                                     |
| R1-5 | `0b1ba7a`      | 理由を「`--target` を渡す行かどうか」へ                                             |
| R1-6 | `c78c02c`      | `tauri_args` を消し、`args` を `rust_target` から導出                               |

この PR では直さず送ったもの。

| 所見 | 送り先 | 理由                                                                         |
| ---- | ------ | ---------------------------------------------------------------------------- |
| R1-2 | #269   | msi を外すか タグのパターンで弾くかは設計の選択（`/implement` 手順7）        |
| R1-3 | #267   | `dry_run` 入力。式が滑りやすいので分けた。今回は `v0.0.1-1` で空打ちして凌ぐ |
| R1-7 | #271   | 英語コメントの日本語化。中身を変えない言い換えなので混ぜない                 |
| —    | #270   | `.github/workflows/**` に検査が1つも掛かっていない                           |
