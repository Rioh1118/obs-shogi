# L0: 注釈機能の「競合する2実装」は実在するか（ローカル検証）

着手: 2026-07-27 / 状態: **閉じた（判定確定）** / 対応する前提: **Q-001**（T1 の 🔴 ブロッカー）

OSINT レーンではない。**リポジトリ内の事実確認。** ループの規律（出典＝コマンドと出力）はそのまま適用する。

## 検証対象

`docs/OPEN-QUESTIONS.md` Q-001 の記述:

> 同じ「棋譜の枝に重要度と note を付ける」機能に、別ブランチで**競合する2実装**が存在する。どちらも main 未マージ。
>
> - 系統A: `feature/26-Zettelkasten` — `marks.rs` + `file_registry.rs`、`marks.json`、tone 0-4、SecondBrainModal
> - 系統B: `feature/zettelkasten` — `meta.rs`、`meta/<fileId>.json`、importance + `computeRanks`、branch-view モーダル

同じ記述が `CLAUDE.md`（normalizedTree を未マージブランチの識別子として参照）と
メモリ `unmerged-branch-work.md`（「注釈機能に競合する2実装あり」）にもある。

## 判定: **Q-001 の前提は3点で誤り**

### 1. `[確定]` 系統B は、このマシンと origin のどこにも存在しない

探索範囲と結果:

| 探索先                         | コマンド                                      | 結果                     |
| ------------------------------ | --------------------------------------------- | ------------------------ |
| origin の全ブランチ            | `git ls-remote --heads origin`                | 7本。zettelkasten系なし  |
| ローカルの全ブランチ           | `git branch -a`                               | zettelkasten系なし       |
| 到達可能な全履歴のファイル追加 | `git log --all --diff-filter=A --name-only`   | `meta.rs` の追加なし     |
| dangling commit 30本           | `git fsck --lost-found` → 各 `git ls-tree -r` | ヒット0                  |
| stash 7本とその親コミット      | `git ls-tree -r "stash@{N}^"`                 | 全て該当なし             |
| 別クローン（Desktop）          | `git -C "<Desktop>/obs-shogi" branch -a`      | 2025年の古いfork。無関係 |

`meta.rs` / `importance` / `computeRanks` / `normalizedTree.ts` / branch-view モーダル は**1つも見つからない**。

**限界（正直に）**: 別マシンのローカルブランチにある可能性は排除できない。origin に push された形跡が無いだけ。
→ 人間レーン: **他のマシンに `feature/zettelkasten` が無いか確認**。無ければ系統Bは存在しない。

### 2. `[確定]` 系統A は「ブランチ」ではない。**到達不能コミット + stash**

- 実体は commit `023e62e "claude first"`（**2026-03-02 12:36:09 +0900**）
- `git branch -a --contains 023e62e` → **出力が空**。ローカル・リモートいずれのブランチからも到達不可
- `refs/stash` 経由でのみ生存していた（だから `git log --all` の走査から漏れていた）
- その上に未コミットの stash（**コミット `7b95aaf`**）（2026-03-02 15:56:43、19ファイル **+1190 / −530**、`CommentPopover` 新規追加を含む）

**保全済み**: `git tag -a archive/annotation-marks-2026-03 023e62e` を作成し、到達可能にした。
**この stash は依然として stash のまま。`git stash clear` / `drop` で消える。**
**添字（`stash@{N}`）で書かない。** 新しい stash が積まれるたびにずれる。実際に 2026-09-02 時点で
執筆時の `stash@{2}` は `stash@{1}` になっており、`stash@{2}` は無関係な release 設定の WIP を指す。

コミット済み系統Aの規模（`git ls-tree -r 023e62e`）:

| ファイル                                             | 行数      |
| ---------------------------------------------------- | --------- |
| `src-tauri/src/marks.rs`                             | 54        |
| `src/entities/marks/` （7ファイル）                  | 230       |
| `src/features/second-brain/ui/SecondBrainModal.tsx`  | 441       |
| `src/features/second-brain/ui/SecondBrainModal.scss` | 393       |
| **計**                                               | **1,118** |

### 3. `[確定]` 系統A に `file_registry.rs` は無い

`git ls-tree -r 023e62e | grep -i registry` → **出力なし**。
Q-001 の表にある「fileId の持ち方＝外部レジストリ（`file-registry.json`）」は、少なくとも 023e62e 時点では未実装。
（`stash@{2}` 側に `useFileId.ts` が**新規追加**されているので、fileId の扱いは stash の中で作りかけ）

## この判定が変えること

**Q-001 は「2つの設計のどちらを採るか」という比較検討ではない。** 比較の材料が片側しか無い。

問いを立て直す必要がある:

1. 系統Bが本当に存在しないなら、Q-001 は「**系統A を復帰させるか、設計からやり直すか**」に変わる
2. 「棋譜ファイルに fileId を埋め込むか、外部レジストリか」という**本質的な分岐点はまだ誰も実装していない**。
   つまりこれは**発掘された既存設計の選択ではなく、これから決める新規の設計判断**（→ 単独で ADR に値するのは変わらない）
3. T1 のブロッカーの性質が変わる。「未決着の2実装」ではなく「**4ヶ月半 stash に埋まったまま忘れられた1実装**」

## 出た作業

- [ ] **人間レーン**: 他マシンに `feature/zettelkasten` が無いか確認（系統Bの実在の最終判定）
- [ ] この stash をブランチに退避する（`git stash branch <name> 7b95aaf`。**添字では引かない**）。stash のままにしない
- [ ] `docs/OPEN-QUESTIONS.md` Q-001 を書き直す（2実装の比較 → 系統Aの復帰可否 + fileId 設計の新規決定）
- [ ] `CLAUDE.md` の「未マージブランチの識別子」記述を修正（`normalizedTree` は**どこにも存在しない**）
- [ ] メモリ `unmerged-branch-work.md` を修正（「競合する2実装あり」は誤り）

## 教訓（`knowledge/` カード化候補）

`git log --all` は **`refs/stash` を走査しない**。
「全履歴を探した」と言うときの `--all` は全部ではない。stash の親コミットは、ブランチが消えると
`--all` から見えなくなり、しかし `refs/stash` に守られて生き続ける。**存在するのに見つからない**状態になる。
→ 不在証明には `git fsck --lost-found` と `git ls-tree "stash@{N}^"` を併せる。
