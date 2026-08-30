# リリースの手順

`.github/workflows/release.yml` を回すときに知っておくこと。
**workflow のコメントに書かない。** ここを読むのは「リリースを出す人」「壊れたリリースを直す人」で、
yml の `strategy:` や `with:` の中を開く人ではない。

## 出し方

タグを push する。

```
git tag v0.3.0 && git push origin v0.3.0
```

`create-release` がリリースを作り（`draft: false`。`/releases/latest/download/` を
解決させるため）、`build` が4本（macOS arm64 / macOS x64 / Windows x64 / Linux x64）
走って資産を上げる。

`workflow_dispatch` でも撃てる。**組むソースはタグの木**だが、
**ビルドの手順は撃った ref の yml** から来る（両者は別）。

## タグの制約

| 制約                                            | 理由                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| `vN.N.N` か `vN.N.N-<任意>`                     | `on.push.tags` のパターン。**`-` の後ろは何でも通る**                   |
| pre-release 識別子は **65535 以下の10進数だけ** | Windows は msi も作る。MSI の ProductVersion に数値以外を載せられない   |
| `-` を含むと自動で pre-release 扱いになる       | `isPrerel` が `tag.includes('-')` を見る。`/releases/latest` に載らない |

`v1.0.0-beta.1` も `v1.0.0-20260830`（65535 超）も、**Windows のジョブだけ**が
bundler の bail で落ちる。`fail-fast: false` なので他の OS の資産が載ったリリースは
そのまま公開される。どちらを恒久的に潰すかは #285。

## 動作確認（空打ち）

**`dry_run` はまだ無い**（#285）。いま撃つと本物のリリースが作られる。
`-` を含まないタグで撃つと `/releases/latest` が置き換わり、
**既存の利用者全員にそのビルドが自動更新として降る。**

安全に確かめるには `v0.0.1-1` を使う。`-` を含むので pre-release になり
`/releases/latest` に載らず、`-` の後ろが数字なので Windows の msi も通る。

確かめること:

1. **4ジョブ全部が緑**
2. **資産名が下の「資産名」の形になっている**。`releaseAssetNamePattern` の綴りを
   誤ると**黙って無視され**、CLI の既定名（`ObsShogi_0.0.1-1_amd64.AppImage` 系）になる

   ```
   gh api repos/Rioh1118/obs-shogi/releases/tags/v0.0.1-1 --jq '.assets[].name'
   ```

   ジョブのログに `Unexpected input(s)` が出ていないことも見る。

3. **`latest.json` の url が `api.github.com/repos/.../releases/assets/<id>` 形式で、実際に引ける**

   ```
   curl -sL https://github.com/Rioh1118/obs-shogi/releases/download/v0.0.1-1/latest.json | jq '.platforms[].url'
   curl -s -o /dev/null -w '%{http_code}\n' -H "Accept: application/octet-stream" -L "<上の url の1つ>"
   ```

   2本目が `200` を返すこと（`curl -I -L … | head -1` は途中の 302 を出すので使わない）。未認証の `api.github.com` は IP あたり 60 req/h の制限下にあるので、
   ここで詰まると「手動ダウンロードは通るのに自動更新だけ静かに失敗する」形になる。

終わったらリリースと `refs/tags/v0.0.1-1` の両方を消す。

## 資産名

パターンは `ObsShogi-v[version]-[platform]-[arch][setup][ext]`。

**`[arch]` は bundle ごとに綴りが違う。** 同じ x86-64 に3通りの名前が出る。

| bundle           | `[arch]`  | 例                                      |
| ---------------- | --------- | --------------------------------------- |
| AppImage / deb   | `amd64`   | `ObsShogi-v0.2.1-linux-amd64.AppImage`  |
| rpm              | `x86_64`  | `ObsShogi-v0.2.1-linux-x86_64.rpm`      |
| Windows          | `x64`     | `ObsShogi-v0.2.1-windows-x64-setup.exe` |
| macOS (Intel)    | `x64`     | `ObsShogi-v0.2.1-darwin-x64.dmg`        |
| macOS (Apple Si) | `aarch64` | `ObsShogi-v0.2.1-darwin-aarch64.dmg`    |

**ダウンロードの URL を手で組む文書はここを見て書くこと。**

## 資産が欠けたリリースの直し方

`fail-fast: false` なので、1つの OS が落ちても残りは上がる。**リリースは公開されたまま残る。**

直し方は**失敗した場所**で分かれる。

| 失敗した場所                       | 直し方                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| ビルドの手順（`release.yml` 自身） | 直したブランチから**同じタグで `workflow_dispatch`**。手順は撃った ref から来る |
| タグの木（ソース側のコンパイル等） | 撃ち直しても再現する。**タグを付け替える**か新しいバージョンを切る              |

**撃ち直す前に、前の run が終わっているか見ること。** `concurrency` の group は
タグなので、走っている run があると dispatch は **pending のまま起動しない**。
`fail-fast: false` なので1つの leg が赤くなっても run は続いている。止めるならキャンセルする。

**どちらでも、先にリリースを資産ごと消すこと。**
撃ち直しは既存のリリースを再利用し、`tauri-action` は**同じ名前の資産しか差し替えない**。
前の run の資産が残ったまま `latest.json` にマージされ、
別の木から作った資産が1つのリリースに同居する。

リリースを消してもタグは残るので、消したあと同じタグで撃てば
`createRelease` の経路に戻り、残骸の無い状態から組み直せる。

## 同時に走らせない

`concurrency` の group はタグ（`github.event.inputs.tag || github.ref_name`）。
group が直列化するのは **run** で、1つの run の中の4本は並行に走ったまま。

push と dispatch を同じタグに対して撃つと、group が無ければ2つの run（計8本の leg）が
同じ `latest.json` を read-modify-write して後勝ちになる。group はそれを止める。
**1つの run の中の4本が同じ `latest.json` を触ることへの保護は無い。**
`tauri-action` は既存の `latest.json` を読んで自分の欄だけ差し替える read-modify-write で、
排他は無い。実害は観測していない（v0.2.1 には4プラットフォーム全部が載っている）。

## 関連

- [ADR-0001 ブランチと PR の方針](decisions/0001-branch-and-pr-policy.md)
- #285 エピック: リリースワークフローが本番を壊す（`dry_run`、非数値 pre-release と msi）
- #286 エピック: 検査が掛かっていない範囲（`.github/workflows/**` に検査が1つも無い）
