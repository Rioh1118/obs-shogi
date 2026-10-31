---
name: write-issue
description: 実装やレビューの途中で見つけた作業を Issue に1件起票する。仕様から複数を起票するときは `/spec-to-issues` を使う。
argument-hint: "[何を見つけたか。1行で]"
allowed-tools: Read, Grep, Glob, Bash
---

**規則の正本は `docs/issue-guidelines.md`。先に読む。ここに写さない。**
`/implement` 手順7 の分類で Issue と決まったものだけを扱う。未決やアイデアは置き場の表に従う。

## 手順

1. **再現を確かめる。** 実際に踏むか、テストで再現する
2. **既存を探す。** `gh issue list --state all --search "<語>"`
3. **詳細を先に置く。** 実測と場所は、仕様の「いま満たしていないこと」かレビュー報告へ書く。
   正本が無い作業なら、まず置き場を作る
4. **本文を書く。** 型は `.github/ISSUE_TEMPLATE/task.yml`。バグは `bug_report.yml`。親は `tracking.yml`
5. **ラベルを選ぶ。** `gh label list --limit 100` で実在を確かめる。存在しないラベルを渡すと `gh` は落ちる
6. **起票する。**

```bash
gh issue create --title "..." --body-file <scratchpad>/issue.md --label <種別> --label <エリア> --label <優先度>
```

完了: 本文が上限に収まり、正本へのリンクと出どころがあり、正本に番号が書き戻してある。
