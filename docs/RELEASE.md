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
解決させるため）、`build` が4ジョブ（macOS arm64 / macOS x64 / Windows x64 / Linux x64）
走って資産を上げる。

**タグを push してから資産が揃うまで、リリースは資産ゼロで公開されている。**
`draft: false` なので `create-release` が終わった時点で `/releases/latest` はもう
新しい方を指し、前のバージョンの資産は見えなくなる。README の「最新版のダウンロード」も
そこへ飛ぶ。run 全体の実測は **5〜15分**（`gh run list --workflow=release.yml`）。
利用者が来ない時間帯に撃つか、資産が揃うまで見ている。

資産が揃ったらリリースノートを書く。yml が置くのは
`## What's new` の1行だけで、**既存のリリースの本文を書き換える経路は yml に無い**。
`v0.1.3` 以降は全て人手で書いている。雛形は前回のものを引き、書いたら反映する。

```
gh release view v0.2.1 --json body -q .body > notes.md
# notes.md を書き換えてから
gh release edit v0.3.0 --notes-file notes.md
```

ダウンロードの表を書くなら、資産名は下の「資産名」から取る。

`workflow_dispatch` でも撃てる。**組むソースはタグの木**だが、
**ビルドの手順は撃った ref の yml** から来る（両者は別）。

## タグとリリースの4通り

`create-release` が最初にやるのは、**タグとリリースがそれぞれ在るか**を別々に見ること。
片方だけ在る状態が実際に起きる（リリースを消してもタグは残る／dispatch はタグの無い状態で撃てる）。

| タグ | リリース | どうなるか                                                                               |
| ---- | -------- | ---------------------------------------------------------------------------------------- |
| あり | あり     | 既存のリリースへ、タグの木から組んだ資産を足す。撃ち直しの通常経路                       |
| あり | なし     | タグの上にリリースを作る。`target_commitish` はタグがあるので無視される                  |
| なし | あり     | **止める。** タグの木が無いので、撃った ref の先端から組んだ資産が既存のリリースへ混ざる |
| なし | なし     | 撃った ref の先端にタグごとリリースを作る。`workflow_dispatch` で新しく切る経路          |

**`create-release` を触るときは、この表を先に更新してから yml を書くこと。**
3行目と4行目はどちらも「タグが無い」なので、条件を1つにまとめると必ず巻き込む。
分けて書く。

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

3. **`latest.json` の鍵が11個そろい、url を全部引ける**

   ```
   URL=https://github.com/Rioh1118/obs-shogi/releases/download/v0.0.1-1/latest.json
   curl -sL "$URL" | jq -r '.platforms | keys | length'
   curl -sL "$URL" | jq -r '.platforms[].url' | while read -r u; do
     curl -s -o /dev/null -w "%{http_code} $u\n" -H "Accept: application/octet-stream" -L "$u"
   done
   ```

   1本目が `11`、2本目が**全行 `200`**（`curl -I -L … | head -1` は途中の 302 を出すので使わない）。

   **1本だけ叩いて済ませない。** 4ジョブが同じ `latest.json` を read-modify-write するので、
   競り負けたときの結果は「url が壊れる」ではなく**「鍵が丸ごと落ちる」**（下の「同時に走らせない」）。
   落ちた側のプラットフォームでは更新の確認が「更新なし」を返すだけで、
   **エラーはどこにも出ない**。先頭の1本だけ見ると、Windows の鍵が落ちていても受入が通る。

   未認証の `api.github.com` は IP あたり 60 req/h の制限下にあるので、
   ここで詰まると「手動ダウンロードは通るのに自動更新だけ静かに失敗する」形になる。

終わったらリリースとタグを消す。空打ちのリリースには書いた本文が無いので、
そのまま消してよい。

```
gh release delete v0.0.1-1 --cleanup-tag -y
```

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

自動更新の `.sig` は各資産の隣に、`darwin` は `.app.tar.gz` も出る。
`latest.json` の `platforms` は bundle ごとに分かれた11個の鍵を持ち
（`linux-x86_64-appimage` / `-deb` / `-rpm` など）、**`[arch]` の綴りとは別の語**を使う。
`latest.json` を読む側はそちらの鍵を見ること。

## 資産が欠けたリリースの直し方

`fail-fast: false` なので、1つのジョブが落ちても残りは上がる。**リリースは公開されたまま残る。**

直し方は**失敗した場所**で分かれる。

| 失敗した場所                       | 直し方                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| ビルドの手順（`release.yml` 自身） | 直したブランチから**同じタグで `workflow_dispatch`**。手順は撃った ref から来る |
| タグの木（ソース側のコンパイル等） | 撃ち直しても再現する。**タグを付け替える**か新しいバージョンを切る              |

```
gh workflow run release.yml --ref <直したブランチ> -f tag=v0.3.0
```

**`--ref` を省くと既定ブランチの `release.yml` が走る。** UI の "Run workflow" の
ブランチ選択も既定ブランチが初期値。直したブランチを指さないと、同じジョブが同じ理由で落ちる。

**撃ち直す前に、前の run が終わっているか見ること。** `concurrency` の group は
タグなので、走っている run があると dispatch は **pending のまま起動しない**。
`fail-fast: false` なので1つのジョブが赤くなっても run は続いている。止めるならキャンセルする。

**どちらでも、先に資産を消すこと。**
撃ち直しは既存のリリースを再利用し、`tauri-action` は**同じ名前の資産しか差し替えない**。
前の run の資産が残ったまま `latest.json` にマージされ、
別の木から作った資産が1つのリリースに同居する。

```
gh release view v0.3.0 --json assets -q '.assets[].name' \
  | xargs -I{} gh release delete-asset v0.3.0 {} -y
```

**リリースごと消さない。** リリースノートは人手で書いたものが本文に入っており、
git にもどこにも控えが無い。消すと復元できない。資産だけ消せば
「タグあり／リリースあり」＝上の表の1行目に留まり、撃ち直しの通常経路に乗る。

リリースごと作り直す必要が本当にあるなら、先に本文を退避する。

```
gh release view v0.3.0 --json body -q .body > notes.md
gh release delete v0.3.0 -y
```

リリースを消してもタグは残るので、消したあと同じタグで撃てば
`createRelease` の経路に戻り、残骸の無い状態から組み直せる。

**資産が揃ったら、退避した本文を戻すこと。**

```
gh release edit v0.3.0 --notes-file notes.md
```

戻すまでの間、リリースの本文は yml が置く placeholder のままで公開されている。

## 同時に走らせない

`concurrency` の group はタグ（`github.event.inputs.tag || github.ref_name`）。
group が直列化するのは **run** で、1つの run の中の4ジョブは並行に走ったまま。

push と dispatch を同じタグに対して撃つと、group が無ければ2つの run（計8ジョブ）が
同じ `latest.json` を read-modify-write して後勝ちになる。group はそれを止める。
**1つの run の中の4ジョブが同じ `latest.json` を触ることへの保護は無い。**
`tauri-action` は既存の `latest.json` を読んで自分の欄だけ差し替える read-modify-write で、
排他は無い。**競り負けると鍵が丸ごと落ちる**ので、空打ちでは鍵の数を数えること（「出し方」の3）。

実害は観測していない。ただし**根拠にできる実績は空打ちの1回だけ**で、
公開済みのリリースは `v0.2.1` まで `tauri-action@v0` で作られており、
いま走る v1 とは `latest.json` を書く実装が違う（url の形も違う）。

## 関連

- [ADR-0001 ブランチと PR の方針](decisions/0001-branch-and-pr-policy.md)
- #285 エピック: リリースワークフローが本番を壊す（`dry_run`、非数値 pre-release と msi）
- #286 エピック: 検査が掛かっていない範囲（`.github/workflows/**` に検査が1つも無い）
