# レビュー release-target-guard ラウンド2

- 日付: 2026-08-30
- 範囲: `.github/workflows/release.yml`（`main` `c6e1deb` からの差分）
- 走らせた reviewer: `comment-reviewer` / `oss-hygiene-reviewer`
- 対象コミット: `1dc2145`
- 前ラウンド: [r1](2026-08-30-release-target-guard-r1.md)

ラウンド1で入れた修正が新しい問題を作っていないかを見た。
**4件のうち3件が、ラウンド1で私が書いたコメントそのものの誤り。**

## 所見

### [BLOCK] R2-1 資産名の例が3つ中2つ実物と違う（ラウンド1で書き換えたブロックの中）

- 場所: `.github/workflows/release.yml:188-192`（reviewer: comment）
- 根拠: `gh release view v0.2.1 --json assets` の実物と例示の突き合わせ。

  | 例示していた綴り                     | 実物                                    |
  | ------------------------------------ | --------------------------------------- |
  | `ObsShogi-v0.2.0-darwin-aarch64.dmg` | 一致                                    |
  | `...-windows-x86_64-setup.exe`       | `ObsShogi-v0.2.1-windows-x64-setup.exe` |
  | `...-linux-x86_64.AppImage`          | `ObsShogi-v0.2.1-linux-amd64.AppImage`  |

  `[arch]` は bundle ごとに綴りが違う。AppImage / deb は `amd64`、rpm は `x86_64`、
  Windows と macOS は `x64` / `aarch64`。**同じ x86-64 に3通りの名前が出る。**

- なぜ問題か: このコメントは `[arch]` が何に展開されるかの唯一の説明で、
  README のダウンロード導線をここから写すと `.../ObsShogi-v0.2.2-linux-x86_64.AppImage` という
  存在しない URL を作る。`/releases/latest/download/<名前>` は 404 になるが、CI は緑のまま。
- 直し方: 例をやめて規則を書く。例は次のリリースで腐る。
- 導入コミットの sha: `d78964a`（`git log -S 'windows-x86_64-setup.exe'`）。
  **ラウンド1の `8ce379e` がこのブロックを書き換えたのに、嘘を残したまま通した。**
- 主張を固定するテスト名: 未検証（資産名を突き合わせる検査はネットワークが要るので CI 向きでない）

### [HIGH] R2-2 「届かないと updater の json が出ず」が `action.yml` の既定と食い違う

- 場所: `.github/workflows/release.yml:180-186`（reviewer: comment）
- 根拠: `uploadUpdaterJson` の `default` は `'true'`
  （`gh api repos/tauri-apps/tauri-action/contents/action.yml`）。
  `src-tauri/tauri.conf.json` の `bundle.createUpdaterArtifacts` も `true`。
- なぜ問題か: 入力名が届かなくても latest.json は上がる。将来 latest.json が出ない事故が起きたとき、
  この文を信じた読み手は入力名の綴りを疑って時間を溶かす（本当の原因は
  `createUpdaterArtifacts` か署名鍵の側）。名前の綴りで実害が出るのは
  `releaseAssetNamePattern` だけで、そこは正しく書けている。
- 直し方: 該当の節を落とす。`uploadUpdaterJson: true` は既定の再掲なので、
  明示する理由（消してよい入力に見せない）を書く。
- 導入コミットの sha: `8ce379e`（**ラウンド1で私が入れた**）
- 主張を固定するテスト名: 未検証

### [HIGH] R2-3 マトリクスのコメントが、ファイルに存在しない「2欄」を説明している

- 場所: `.github/workflows/release.yml:86-88`（reviewer: comment）
- 根拠: `include:` の各行が持つ欄は `name` / `runner` / `rust_target` の3つだけ。
  `tauri_args` は `c78c02c` で消えている。
- なぜ問題か: 「同じ文字列を2欄に置くと」が指す行がファイルの中に1つも無い。
  読み手は存在しない欄を探すか、`rust_target` と `args:` の `format(...)` を「2欄」と誤読して、
  1箇所しかない定義をさらに分ける方向に直す。**R1-6 の直しの理由づけがコメントに残った形**で、
  `CONTRIBUTING.md`「変更の経緯を書かない」に当たる。
  加えて、ここと「Add build target」の上とで同じ話を50行離れて2回書いていた。
- 直し方: 不変条件は欄を定義する `matrix:` の側に1つだけ。ステップ側はガードが要る理由の1行に削る。
- 導入コミットの sha: `c78c02c`（**ラウンド1で私が入れた**）
- 主張を固定するテスト名: 未検証

### [MEDIUM] R2-4 `（#256 と同じ形）` は経緯で、参照すべきは未解決の #269。制約も足りない

- 場所: `.github/workflows/release.yml:8-12`（reviewer: comment）
- 根拠: #256 の題は「rustup target add に引数が無い」で、Linux も落ちる別の故障。
  一方 `tauri-bundler` の msi は
  `optional pre-release identifier in app version must be numeric-only and cannot be greater than 65535`
  と言うので、**`v1.0.0-20260830` のような日付付きも落ちる**。「数字だけ」では足りない。
- なぜ問題か: 参照先を開いても話が合わないと、コメント全体の信用が落ちる。
  `CONTRIBUTING.md` が issue 番号を許すのは `TODO(#N)` の形だけ。
- 直し方: 制約を「65535 以下の10進数」まで書き、`TODO(#269)` で未解決の設計判断を指す。
- 導入コミットの sha: `a2b33a6`（**ラウンド1で私が入れた**）
- 主張を固定するテスト名: 未検証

### [HIGH] R2-5 `build` がタグを checkout しないので、R1-4 では「タグ ≠ 資産」が塞がっていない

- 場所: `.github/workflows/release.yml:112`（`actions/checkout@v4` に `ref` が無い）（reviewer: oss-hygiene）
- 根拠: REST の `createRelease` は `target_commitish` を
  「Unused if the Git tag already exists」と定義している。`create-release` の冒頭（`:55-62`）は
  タグが既にあれば `getReleaseByTag` で既存のリリースを返して終わる。
- なぜ問題か: **R1-4 が閉じたのは初回 dispatch だけ。** 残った経路が #256 の復旧そのもの。
  1. `v0.2.2` を push → Windows だけ落ちて、macOS / Linux の資産だけが載ったリリースが残る
  2. `main` に修正を積む
  3. `workflow_dispatch` で同じ `v0.2.2` を撃ち直す
  4. `getReleaseByTag` が既存のリリースを返し、`target_commitish` は無視される（タグは古い commit のまま）
  5. `build` は `github.ref` の**動いた後の HEAD** を組む

  1つのリリースの中に「タグの木から作った macOS / Linux」と「タグより後の木から作った Windows」が
  混ざり、`latest.json` がそれを自動更新に載せる。

- 直し方: `build` の checkout を `ref: ${{ env.RELEASE_TAG }}` で固定する。
  `needs: create-release` を通っているのでタグは必ず存在する。
- 導入コミットの sha: `d78964a`。**`c4c212e`（R1-4）が塞いだつもりで塞ぎ切れていなかった。**
- 主張を固定するテスト名: 未検証

### [MEDIUM] R2-6 資産名の例（R2-1 と同じ所見。2体が別経路で当てた）

- reviewer: oss-hygiene。`gh api releases/tags/v0.2.1` と、v1 の `src/build.ts` が
  `debianArch`（deb / AppImage → `amd64`）と `rpmArch`（→ `x86_64`）を別々に作り、
  windows 節が `arch = 'x64'` に畳んでいることの両方から当てている。
- 追加で分かったこと: `[arch]` を `x86_64` に固定しようとしてパターンをいじると、
  `upload-version-json.ts` の `filteredAssets.find(a => a.assetLabel === …)` が
  資産と署名を突き合わせられなくなり、**`latest.json` から該当プラットフォームが丸ごと落ちる。**

### [MEDIUM] R2-7 v1 は `latest.json` の url を `api.github.com` の asset API 形式で書く

- 場所: `.github/workflows/release.yml:169,185-186`（reviewer: oss-hygiene）
- 根拠: v1 の `src/upload-version-json.ts` が
  `url: \`${githubBaseUrl}/repos/${owner}/${repo}/releases/assets/${data.id}\``を組む。
v0.2.1 の`latest.json`（v0 で生成）は全エントリが
`https://github.com/Rioh1118/obs-shogi/releases/download/v0.2.1/…`。
  `@v0 → @v1` は `bfa609b`（dependabot）で入っただけで、**この bump 以降リリースが1本も出ていない。**
- なぜ問題か: 自動更新のダウンロード先がホストごと移る。動作自体はする
  （`tauri-plugin-updater` は `Accept: application/octet-stream` を付ける）が、
  未認証の `api.github.com` は IP あたり 60 req/h の制限下にある。詰まったときの症状は
  「ブラウザからの手動 DL は通るのに自動更新だけ静かに失敗する」で、
  workflow を触った変更が原因だと後から誰も結び付けられない。
- 直し方: 事実をコメントに残し、空打ちの受入に `latest.json` の url 形式の確認を足す（#267 へ）。
- 導入コミットの sha: `bfa609b`（dependabot の major bump）
- 主張を固定するテスト名: 未検証

## 重複・矛盾した所見

R2-1（comment）と R2-6（oss-hygiene）は同じ所見。**2体が別の経路で当てている**
（comment は公開済み資産名との突き合わせ、oss は `src/build.ts` の arch 変換）。
統合して R2-1 の修正1つで閉じた。

矛盾は無し。

## 確認して問題が無かったもの（oss-hygiene が潰した分。所見にはしない）

- `args: ${{ matrix.rust_target && format('--target {0}', matrix.rust_target) }}` は**正しい**。
  空文字は falsy なので Windows / Linux では空になり、v1 の `inputs.ts` が `stringArgv('')` → `[]`、
  `runner.ts` が `--` も付けないので `npm run tauri build` になる。
  `getTargetInfo(undefined)` が `process.arch` を使うため `target/release` を見る
- `target_commitish` の **push tag 経路での副作用は無い**（タグが既にあるので無視され、
  値も `context.sha` と一致する）
- v0.2.1 の資産名は再現する。`renderNamePattern` の `[version]` `[platform]` `[arch]` `[setup]` `[ext]`
  はすべて `Artifact` に存在する
- `tauri_args` の参照は残っていない
- `Stamp version` の `python3 -c` は `^version = ` に `count=1` で当たり、`Cargo.toml` の
  `[package]` 側1本だけに効く。`jq` は `.version` だけ差し替え、`plugins.updater` を保持する
- `swatinem/rust-cache` の `key: ${{ matrix.name }}` は4行とも別値。`permissions: contents: write` で足りる
- `.claude/worktrees/*/src-tauri/tauri.conf.json` は `.gitignore` 済みで CI の checkout に現れない

## 見ていない範囲

- ワークフローを実際に走らせていない。`Unexpected input(s)` が warning 止まりでジョブが緑になること
  自体も、実行ログでは確認していない（v0.2.0 / v0.2.1 はどちらも `tauri-action@v0` で公開されており、
  `@v1` での実行例がまだ無い）
- `[platform]` / `[setup]` / `[ext]` の展開規則はソースを読んでおらず、公開済み資産名からの逆算のみ
- R1-7（英語と日本語の混在、#271）に該当する既存の英語コメントは方針どおり触れていない
- `.github/workflows/` 配下の他の yml とのコメント粒度の比較

## lint / hook で強制できるもの

- `commentHistory` の `ROOTS` は `src/` と `src-tauri/` だけなので、R2-3 も R2-4 も機械では止まらない。
  `ROOTS` に `.github/workflows/` を足せば、少なくとも issue 番号の裸書きと「元は」系の語は拾える
  （#270 と同じ穴）
- **R2-1 は機械化より書き方で解くほうが安い。** 資産名の例示をやめて規則だけ書けば腐りようが無い
- `uploadUpdaterJson: true` のような「既定と同じ値の明示」は、action の `action.yml` の `default` と
  workflow の `with:` を突き合わせれば拾える（#270 の検査を作るなら同じ場所）

## 結果（書き戻し）

| 所見 | 直したコミット | 何をしたか                                                           |
| ---- | -------------- | -------------------------------------------------------------------- |
| R2-1 | `e6ed584`      | 例をやめ、`[arch]` の綴りが bundle ごとに違う規則を書いた            |
| R2-2 | `3ba96bd`      | 「届かないと json が出ない」を落とし、既定が true であることを書いた |
| R2-3 | `48a0ba7`      | 存在しない「2欄」の説明を削除。二重書きを1箇所に寄せた               |
| R2-4 | `1dc2145`      | 「65535 以下の10進数」まで書き、`TODO(#269)` へ                      |
| R2-5 | `28c12c6`      | `build` の checkout を `ref: ${{ env.RELEASE_TAG }}` で固定          |
| R2-6 | —              | R2-1 と同じ所見。`e6ed584` で閉じている                              |
| R2-7 | `5e8af7d`      | `latest.json` の url がホストごと変わることをコメントに残した        |

送ったもの: R2-7 の空打ちでの確認手順を #267 へ（資産名の確認と、
`latest.json` の url を `Accept: application/octet-stream` で引いて 200 を見る2本）。
R2-4 の設計判断は r1 で立てた #269 が既に持っている。

## この2ラウンドで分かったこと

**ラウンド1の所見4件中3件が、ラウンド1で私が書いたコメント自身の誤り。**
`/implement` 手順5 が名指ししている「コメントに書いた理由が、実装している条件と違う」が
そのまま再現した。共通しているのは次の形。

- **直した理由をそのままコメントにした。** R2-3 は「なぜ `tauri_args` を消したか」を
  現在の状態の説明として書いてしまい、消えた欄を指す文が残った
- **外部の既定を確かめずに「効かないと困る」と書いた。** R2-2 は `action.yml` の
  `default: 'true'` を引けば5秒で分かった
- **例示を写した。** R2-1 は元からあった例をブロックごと書き換えながら、
  中身が現物と合っているかを一度も確かめなかった

次のラウンドからは、コメントに事実を書いたら**その事実の出どころを1つ挙げられるか**を
自分で確かめる（`action.yml` のどの行か、実物の資産名か、コード中のどの式か）。
