# 承認された一覧の適用

## 順序

1. **再取得する。** 全件の `updatedAt` をスナップショットと比べる。変わった Issue は適用せず、未適用として報告する
2. **ファイルを先に直す。** 仕様へ移す案と、書き直しで移す実測を `docs/` へ書く。閉じる Issue を指す
   仕様の `→ #N` も、実態に合わせて直す。検証を通す
3. **`gh` を適用する。** 書き直す → 閉じる の順
4. 進んだ番号を `.claude/plans/issue-triage/<日付>/applied.log` に1行ずつ書く

**移した先が `main` に入るまで、その Issue は閉じない。** リンクが誰にも辿れないため。
先に残りを適用し、PR が入った後に同じ一覧のまま再実行する。再承認は要らない。
再実行は `applied.log` にある番号を飛ばす。

## コマンド

```bash
# 書き直す
gh issue edit <N> --body-file <bodies/N.md>
gh issue edit <N> --add-label <ラベル> --remove-label <ラベル>

# 閉じる
gh issue close <N> --reason "not planned" --comment "<理由と行き先を1行>"
gh issue close <N> --reason completed --comment "<理由と行き先を1行>"
```

`--reason` の選び方とコメントの中身は `docs/issue-guidelines.md`「閉じる基準」。
重複は `gh` の版によって専用の指定が無いので、残す番号をコメントに書く。

`gh issue edit --body` は Projects classic の deprecation で黙って失敗することがある。
適用の後に `gh issue view <N> --json body` で本文を確かめ、変わっていなければ次を使う。

```bash
gh api -X PATCH repos/<owner>/<repo>/issues/<N> -F body=@<bodies/N.md>
```

## 止めるとき

- 1件失敗したら、そこで止める。適用済みと未適用を報告する
- API の制限に当たらないよう、書き込みの間に1秒置く
- 件数が承認した一覧と合わなければ止める
