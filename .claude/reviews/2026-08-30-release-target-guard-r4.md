# レビュー release-target-guard ラウンド4

- 日付: 2026-08-30
- 範囲: `.github/workflows/release.yml`
- 走らせた reviewer: `oss-hygiene-reviewer` / `comment-reviewer`
- 対象コミット: `c7d7eed`（rebase 前）
- 前ラウンド: [r3](2026-08-30-release-target-guard-r3.md)

**ラウンド3で入れた `outputs.sha` の解決に、状態の取り違えが2つあった。**
2体が別経路で同じ2件に当てている。

## 所見

### [BLOCK] R4-1 `createRelease` 経路で `context.sha` を配っていた

- 場所: `.github/workflows/release.yml:90-92`（reviewer: comment / oss-hygiene の両方）
- 根拠: `createRelease` に落ちる条件は **`getReleaseByTag` の 404＝リリースが無い**だけで、
  タグの有無ではない。REST の `createRelease` は `target_commitish` を
  `Unused if the Git tag already exists.` と定義しており、**タグが既にある状態で呼ばれることを
  想定済み**。コメントは「いま作ったので `context.sha` がそのままタグの commit」と書いていた。
- なぜ問題か: 状態空間は「リリースの有無」×「タグの有無」の4通りで、コードは3通りしか扱っていない。
  - push tag（この repo の全リリース）: タグは trigger なので必ず既にある。初回リリースは必ずこの分岐。
    結論はたまたま合うが**理由が違う**（push の `github.sha` がその ref の先端だから）
  - **タグはあるがリリースを消して撃ち直す**（`docs/RELEASE.md` の復旧手順が通る経路）:
    `sha` 出力はブランチの HEAD になり、資産がタグの木と別物になる。
    R1-4 / R2-5 / R3-1 が追い続けてきた「タグの木 ≠ 配布物」そのもの
- 直し方: タグの解決を先に1度だけ行い、`tagSha ?? context.sha` を配る。
- 導入コミットの sha: `eb8e77b`（**ラウンド3で私が入れた**）
- 主張を固定するテスト名: 未検証（inline `script:` はこの repo のどの検査にも掛からない → #270）

### [HIGH] R4-2 `shaOfTag` の 404 が「リリースが無い」に化けて `createRelease` へ落ちる

- 場所: 同上（reviewer: comment / oss-hygiene の両方）
- 根拠: `catch (e) { if (e.status !== 404) throw e; }` は `getReleaseByTag` の 404 を
  「リリース未作成」と読むために書かれているのに、`shaOfTag` の中の `git.getRef` /
  `git.getTag` が投げる 404 も同じ網に落ちる。
- なぜ問題か: **リリースはあるがタグが無い**セルに入ると、`getRef` の 404 が握り潰されて
  `createRelease` を撃ち、同名のリリースが既にあるので 422 で死ぬ。
  **表示される失敗は `already_exists` で、原因（タグが無い）とまったく結び付かない。**
- 直し方: `shaOfTag` が自分で 404 を捕まえて `null` を返す。
- 導入コミットの sha: `eb8e77b`（**ラウンド3で私が入れた**）
- 主張を固定するテスト名: 未検証

### [HIGH] R4-3 復旧手順が「同じタグで撃ち直しても無駄」と誤っていた

- 場所: `.github/workflows/release.yml:99-102`（reviewer: comment）
- 根拠: `workflow_dispatch` で走る yml は**選んだ ref のもの**。組むソースだけがタグの木。
  したがって**ビルド手順の側の失敗は、直したブランチから同じタグを撃てば直る。**
  #256（`rustup target add` に引数が無い）がまさにその形で、タグの木は無関係だった。
- なぜ問題か: このブランチが直した当の失敗に対して「撃ち直しても無駄」と言っている。
  読んだ人は Windows の資産が1本欠けただけでバージョンを1つ捨てるか、タグを force で動かす。
- 直し方: 失敗した場所で分ける。
- 導入コミットの sha: `b262162`（**ラウンド3で私が入れた**）
- 主張を固定するテスト名: 未検証

### [HIGH] R4-4 復旧手順が資産の残骸を残したままにする

- 場所: 同上（reviewer: oss-hygiene）
- 根拠: タグを付け替えて push すると `getReleaseByTag` が**既存のリリースを再利用**する。
  `tauri-action` の `upload-release-assets.ts` は
  `existingAssets.find(a => a.label === assetName || a.name === assetNameGH)` に当たったものだけを
  `deleteReleaseAsset` してから上げ直す。当たらなかった資産は**そのまま残る**。
  `upload-version-json.ts` は既存 `latest.json` を読んで `platforms` にマージする。
- なぜ問題か: 1回目が Windows で落ち、2回目が別の leg で落ちると、
  「古い木の macOS 資産」と「新しい木の Windows 資産」が同居し、`latest.json` にも両方が載る。
  checkout の `ref:` 固定が防ぐのは **run の中の4本だけ**。
- 直し方: 「先にリリースを資産ごと消す」を手順に入れる。checkout の断定も run 内に限定する。
- 導入コミットの sha: `b262162`（**ラウンド3で私が入れた**）
- 主張を固定するテスト名: 未検証

## 重複・矛盾した所見

R4-1 と R4-2 は2体が別経路で当てている（comment は「コメントが到達する経路で偽」、
oss は「404 の帰属が誤り」）。統合して1コミットで閉じた。

## 確認して問題が無かったもの（所見にしない）

- `git.getRef({ ref: 'tags/<tag>' })` の呼び方は正しい。`/` を含むタグ名でも通る
  （`tags%2Farchive%2F…` を実測して 200）
- `permissions: contents: write` で `git.getRef` / `git.getTag` は足りる
- `needs.create-release.outputs.sha` が空になる経路は見つからなかった
- 既存の英語コメント（`:3` `:38` `:86` `:94` `:198` ほか）は現在のコードに対して真

## 見ていない範囲

- ワークフローを走らせていない。R4-1 の到達性のうち「リリースを残したままタグだけ消せる」ことを
  API で実証していない
- annotated tag を push したときの `GITHUB_SHA`。この repo の release tag は9本とも lightweight
- `tauri-action@v1` での実行例が無い（r1 から未解決）

## lint / hook で強制できるもの

- `script:` の中身を `.github/scripts/*.mjs` へ出して `github` / `context` を引数で受ける関数にすれば、
  **「リリースの有無 × タグの有無」の4セルを vitest で固定できる**（octokit を差し替えるだけ、
  ネットワーク不要）。R4-1 と R4-2 はどちらもそのテストで落ちる。
  インラインのままでは、この種の分岐の誤りは人が読む以外に検出手段が無い → #270

## 結果（書き戻し）

| 所見        | 直したコミット | 何をしたか                                                          |
| ----------- | -------------- | ------------------------------------------------------------------- |
| R4-1 / R4-2 | `2d1725f`      | タグの解決を先に1度だけ。`shaOfTag` が自分で 404 を閉じる           |
| R4-3 / R4-4 | `4714d30`      | 復旧手順を失敗した場所で分け、「先にリリースを消す」を入れた        |
| —           | `4714d30`      | `if (!sha) throw`。空を配ると checkout が黙って `github.ref` へ戻る |

送ったもの: 無し。
