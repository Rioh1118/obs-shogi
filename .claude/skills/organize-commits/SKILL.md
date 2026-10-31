---
name: organize-commits
description: 積んだコミットを PR に出す形へ組み直して push する。`/review-and-plan` の後、PR の前、fixup! が残っているとき、履歴を読める単位に分けるときに使う。
argument-hint: "[基点のブランチ。省略時は origin/main]"
allowed-tools: Read, Grep, Bash, Write, AskUserQuestion
---

形の規則は `docs/rules/commits.md`。先に読む。

**ファイルの中身を記憶から書き直さない。** 再構成は git の操作だけで行う。
対話型のコマンド（`git add -p`、エディタが開く `rebase -i`）は使わない。

## 手順0: 触らないかを判定する

1つでも当たれば止める。

- 作業ツリーが汚れている（`git status --porcelain -uall` が非空）
- `main` の上にいる
- rebase や merge の途中

`fixup!` が無く、`docs/rules/commits.md` を満たしているなら組み直さず手順4へ。

## 手順1: 退避する

```bash
git fetch origin
git branch backup/<ブランチ名>-<日付>
git merge-base HEAD origin/main   # <base>
git rev-parse @{u}                # <remote-head>。上流が無ければ省く
```

**コミットを触る前に退避を作る。** 以後、失敗したら `git reset --hard backup/<...>` で戻る。

**`<base>` と `<remote-head>` は出力された sha をそのまま書く。** シェル変数は呼び出しを跨いで残らず、
`$(cat ...)` を含む `rebase` は検証ゲートが deny する。`<W>` はセッションの scratchpad の絶対パス。

## 手順2: 計画を書く

`git log --reverse --stat <base>..HEAD` で読む。推測で割らない。計画を `<W>/plan.md` に書く。

| 順  | 段  | メッセージ | 材料（元のコミット、または `path:hunk`） |
| --- | --- | ---------- | ---------------------------------------- |

段は `docs/rules/commits.md` の並び順。**畳まないもの**は別の行に残す。本体と独立して意味を持つ修正、
docs だけの変更、別の関心事に属する退行の修正。

完了: 元の全コミットと全 hunk が、どれかの行に入っている。

## 手順3: 組み直す

簡単な順に使う。組み合わせてよい。

**fixup! を畳むだけ**

```bash
git rebase --autosquash <base>
```

**並べ替える**: `<W>/todo.txt` に `pick <sha>` を、作りたい順に古い方から書いて渡す。

```bash
git -c sequence.editor="cp <W>/todo.txt" rebase -i <base>
```

`GIT_SEQUENCE_EDITOR=:` の前置は検証ゲートが deny する。`-c sequence.editor=` を使う。

**分ける**: 全体の差分を hunk で切り分けて、基点から積み直す。
[scripts/pick-hunks.mjs](scripts/pick-hunks.mjs) は差分を切るだけで、中身を作らない。
移動やバイナリのように hunk の無いファイルは `path:0` で選ぶ。

```bash
git diff --binary <base> backup/<...> > <W>/all.patch
node .claude/skills/organize-commits/scripts/pick-hunks.mjs list <W>/all.patch
git reset --hard <base>
```

計画の1行ごとに、次を繰り返す。

```bash
node .claude/skills/organize-commits/scripts/pick-hunks.mjs pick <W>/all.patch <path:1,3> ... > <W>/step.patch
git apply --index --recount <W>/step.patch
git commit -m "<メッセージ>"
```

- `--cached` でなく `--index` を使う。**ゲートが見るのは作業ツリー**で、`--cached` は移動と削除の古いファイルを残す
- `git commit` は1呼び出しに1つ。本文は `-F <ファイル>` で渡す
- 1つの hunk を分けたくなったら、分けない。行単位の切り分けは git の操作にならない
- 衝突したら `git rebase --abort` で止め、計画を変える。**手で解かない**

## 手順4: 検証する

```bash
git diff --exit-code backup/<...> HEAD
```

**空でなければ `git reset --hard backup/<...>` で戻す。** 履歴の整理で中身は1行も変えない。

全コミットでテストを通す。触った種類に合わせる（Rust を触ったなら `npm run verify:rust` も足す）。

```bash
git rebase -x "npm run verify" <base>
```

止まったら `git rebase --abort` して手順2へ戻る。見積もりは コミット数 × `npm run verify`。

## 手順5: 人が1回確認する

push は共有システムの変更なので止まる（`docs/rules/decisions.md` R-DEC-9）。組み直しの判断は `/decide` が決める。

`git log --reverse --format='%h %s' <base>..HEAD` の一覧、畳まずに残したものとその理由、手順4の結果を出す。
`AskUserQuestion` で1問だけ聞く。「push する（推奨）」と「push しない」の2択。

## 手順6: push する

**自分の作業ブランチだけ。** `main` と、他の人のコミットが載ったブランチには行わない。

```bash
git log --format='%an' <base>..@{u} | sort -u
git push --force-with-lease=<ブランチ名>:<remote-head> origin <ブランチ名>
```

**期待する sha を明示する。** 省くと、直前の `git fetch` で検査が素通りする。
上流が無い初回は `git push -u origin <ブランチ名>`。

## 手順7: 片付ける

- `.claude/reviews/` の報告書の短ハッシュを新しい sha へ直す。1対1でないものは `畳み込み済み` にする
- 退避ブランチは PR が入るまで残す

報告: 何コミットから何コミットになったか、畳まずに残したもの、手順4の結果、push の結果。
