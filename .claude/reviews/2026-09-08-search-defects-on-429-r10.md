# ラウンド10 — main を取り込んだマージの解決を見る

対象: `review/388-on-429-all`、コミット `47ff8fe0`（`Merge branch 'main'`）。
観点は rust / react / comment の3つ。焦点は**マージの解決そのもの**——両側が同じ面を
触ったので手で合流させた、その合流で意味が壊れていないか。

所見16件（BLOCK 1 / HIGH 2 / MEDIUM 12 / LOW 1）。

## 先に: 解決が正しかったと確かめられたもの

所見ではないが、疑っていた点が潰れたので残す。

- `indexHealth` の9値の順序は無傷。`isIndexBusy` の true 集合は旧 or 連鎖と同一で、
  `health === "building"` は main の `isIndexBusy(idx.state)` と**完全に同じ集合**
- `session?.stale` は `sessionStale` として状況バーとヒット一覧の両方へ届いている。
  `health === "ok"` かつ `sessionStale === true` は実際に起こる（枝は死んでいない）
- main が足した TS の新規7ファイルは `git diff origin/main` が空。取りこぼしなし
- **刈りの門は破れていない。** `ScreenMessage(String)` の欄は非公開、`for_screen` /
  `followed_by` は `pub(crate)`、`Deserialize` も `From` も `Default` も無いので、
  crate 内でも `for_screen` を通さずに `ScreenMessage` は作れない

## 根

16件は4つの根に落ちる。

1. **合流で doc だけが片側に残った**（R10-13 / 14 / 6 / 10）。型とコードは合流したのに、
   その doc が語っている**相手側**（TS の画面、消した識別子）を突き合わせていない
2. **実在しない綴りが緑で通る**（R10-2 / 9 / 12）。`search_doc_names` は下線2つ以上の
   `fn` 名と呼び出し形しか見ないので、`Type::Variant` 形と欄名は素通しする
3. **網羅検査の後退と迂回口**（R10-4 / 5）。main が表にした理由が、残した実装では
   満たされていない面が2つある
4. **このラウンドで入れた退行**（R10-1 / 15 / 16 の一部）。マージの解決が作った

## BLOCK

### R10-1 `read_to_jkf` の戻り表で `indexed` が20形中19形で逆

`docs/state-transitions/search.md:181`

```
| `Ok(NothingToIndex { warns: [] })` | 空に見え、読み残しも見つからず | 出さない | **する** | 入らない | **真** |
```

現物は `kifu_reader.rs:298` の `looks_intentional = has_content && warn.is_none()` で、
`file_build.rs:74` が `indexed: looks_intentional`。同じファイルの corpus
（`an_empty_file_is_rejected_but_a_moveless_kifu_is_not`）は20形すべてに
`assert!(warns.is_empty())` を掛けたうえで `looks_intentional == (label == "hirate-only")`
を固定している。つまり**`warns: []` かつ `indexed: 偽` が19形**。

表の6行下が「**警告の有無では割れない**」と正反対を書いている。**表が自分の説明と
矛盾している。** しかもマージで腕の綴りを main の形（`{ warns: [] }`）に揃えたぶん、
**パターンで割れると読める度合いが上がった**。

ラウンド6〜9が4ラウンド追った故障（行の鍵では `indexed` を決められない）を、
マージの解決が doc に作り直したもの。

**直し方**: `NothingToIndex` の2行を `warns` ではなく `looks_intentional` で割る。
`warns` は別の列に残す（`warns: [_]` なら `looks_intentional` は必ず偽、
`warns: []` はどちらもありうる、が現物）。

## HIGH

### R10-2 `IndexUiState::BuildFailed` は実在しない

`docs/state-transitions/search.md:117`。現物は `announce.rs:213` の
`IndexAnnouncement::BuildFailed`。`IndexUiState` は Rust に1つも無く
（`git grep` 0件）、TS 側の同名はバリアントを持たないレコード型。
この節は「全件構築の走査が失敗したとき何を出すか」の唯一の出典。

### R10-3 `startNavigationToHit` を真偽値と書いている

`docs/spec/screens/position-search.md:95-98` と
`docs/state-transitions/failure-surfacing.md:147`。現物は
`usePositionHitNavigation.ts:18` の
`type NavigationOutcome = "started" | "not-in-tree" | "tree-unavailable"`。

**同じ仕様書の失敗の表が3行に割れている根拠がこの3値そのもの**
（`not-in-tree` は `danger`、`tree-unavailable` は `warning`）。真偽値と書くと
段を分ける理由が仕様書から消え、読んだ人は `if (!startNavigationToHit(...))` を書く
——`"started"` は truthy なので**全ての失敗が成功として閉じる**。

## MEDIUM

### R10-4 `runningLabel` の `default:` で `IndexState` の網羅検査が後退

`WorkspaceTab.tsx:92-101`。マージは `badgeForIndex`（`IndexHealth` 9値）については
`const never: never = health` で網羅を守ったが、**`IndexState` 5値に対する分類は
main の表から `default:` 付き `switch` へ戻った**。oxlint に
`switch-exhaustiveness-check` に当たる規則は無い。

段を1つ足すと `BUSY` の表は分類を迫るが、そこで `true` にした瞬間
`runningLabel` が tsc を1つも落とさずに「更新中」と出す。

### R10-5 `isIndexBusy` が barrel から公開されたまま消費者ゼロ

`src/entities/search/index.ts:47`。3行下に `indexHealth` を「唯一の関門」と書いた
doc がある。barrel 経由の消費者は1人も居ない（`indexHealth.ts` はスライス内から
相対で読む）。

`screenSpecCoverage` の網は `/\bIndexHealth\b/ || /\bindexHealth\s*\(/` なので、
**`isIndexBusy` で分岐する画面は `SCREENS` 漏れの検査に一度も掛からない**
——ラウンド9が塞いだ穴が別の扉から開いている。

### R10-6 `provider.tsx` のコメントが、マージで消した識別子を指している

`src/entities/search/model/provider.tsx:89-90`。`indexStale` は main の
`PositionSearchModal` のローカルで、マージが `health` に置き換えて消した。
結論も現物と違う——`Empty` のままなら `indexHealth` は `notStarted` を返し、
画面は「索引がありません」を出す。「最新として出る」はもう起きない。

### R10-7 `WorkspaceTab` の「索引済み」欄が `settings.md` に無い

`WorkspaceTab.tsx:203-206` / `docs/spec/screens/settings.md:47-52`。
**マージ由来ではなく、このブランチが画面だけ足して仕様書を追っていない。**
JSX の地の文なので `screenSpecCoverage` の `labelsOf`（3形しか拾わない）が
構造的に拾えない。`未同期` の三項も片腕が識別子なので同じく素通り。

### R10-9 `build.rs` の `indexed: ok` は実在しない綴り

`docs/state-transitions/search.md:272`。束縛の名は `indexed`。`ok` はマージで
落ちた main 側の記述が指していた旧名で、こちらの綴りだけが残った。

### R10-10 早期 `return` の説明が全件構築の節に置かれている

`docs/state-transitions/search.md:129-131`。説明している2つの腕は
`project_manager.rs`（差分適用）の側で、節の主題は全件構築。全件構築側に
`root_dir` が `None` の腕は無い。加えて「どちらも `main` から続く」は
**変更の経緯**で `CONTRIBUTING.md` が禁じている形。

### R10-11 F-32 のセルに同じ一文が2回入り、存在しない `※6` を指している

`docs/state-transitions/failure-surfacing.md:147`。注は `※` / `※2` / `※5` のみ。

### R10-12 `CACHE_VERSION` の doc が実在しないファイル名を「固定の綴り」と書いている

`src-tauri/src/search/cache/format.rs:73`。`index.v1.*` はリポジトリのどこにも無い
（`git grep` でこの行だけ）。現物の名前は `cache_key`（blake3 の16進64文字）＋
`.blob` / `.bak` / `.tmp`。`docs/state-transitions/search.md:303-307` の表とも食い違う。

### R10-13 `IndexWarnPayload::message` の doc が、こちらが置き換えた画面と逆を言っている

`src-tauri/src/search/types.rs:433-437`。main から入った塊がそのまま残った。3点とも事実に反する。

| doc                                              | 現物                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `WorkspaceTab` が描くのは先頭5件                 | `pickWarns` が**新しい順**の5件（場所を先に、`path` が空の場所を後ろへ） |
| 200件を超えると先頭から落とす                    | `appendWarn` が同一鍵を末尾へ動かし、`PLACE_KEPT` 20 とファイル枠で切る  |
| 後から出した警告を読ませることはできない（#465） | `pickWarns` が新しい順で**解いた**当のもの                               |

`read/diagnosis.rs:104` と `read/csa.rs:31` がこの doc を基準として名指ししている。

### R10-14 `path` の doc が丸ごと落ち、「刈る口を通らない」が src-tauri から消えた

`src-tauri/src/search/types.rs:427-428`。落ちた3段落は現物と合っていた
（`WorkspaceTab.scss:167-174` の `text-overflow: ellipsis`、`WorkspaceTab.tsx:260` の `title`）。

結果2つ。`message.rs` が型で保証すると宣言する一方、**同じ payload の `path` は
保証の外**という但し書きが消えた（#459 の言及が別の話の1本だけになった）。
残った `message` の doc の「`path` と違って `title` も無く」が**参照先の無い比較**になった。

**戻さない一文がある**: main の「走査の失敗時は文言にも根が埋まる」。こちらの
`scan_failure` は `ScanError` の `Display` を埋めず腕ごとの定型文に落とすので、今は嘘。

### R10-15 刈った文言の出口が3つあるのに doc は2つと書いている

`message.rs:35-36` と `commands.rs:230`。マージが `scan_failure(...).to_string()` を
足したことで、**3つ目の出口だけが裸の `String`**。型の門も doc の一覧も掛からない。
`open_project` に別の `Err` を足す人は `ScanError` の `Display`
（`root directory is not readable: /Users/…`）をそのまま返せる。

`openError` にまだ読み手が居ない（#403 / F-17）ので今は画面に出ないが、
読み手が付いた時点でこの穴がそのまま利用者に見える。

### R10-16 `IndexWarnPayload` の欄が全部 `pub` なので構造体リテラルが書ける

`src-tauri/src/search/types.rs:424-467`。doc は「組み立てる口をここに閉じてある」と
書いているが閉じていない。合流直前まで main の `build.rs` と `project_manager.rs` が
実際に構造体リテラルを使っていた。

`kind` を取り違えると `pickWarns` の場所優先の枠から外れ、「ワークスペースを
読めません」がファイル単位の警告に押し出されて画面から消える。型検査は止めない
（`place` と `file` は引数の型も数も同じ、と `announce.rs:631` 自身が書いている）。

併せて: マージが足した `IndexWarnPayload` の `PartialEq, Eq`（とそのために
`ScreenMessage` に足した `PartialEq, Eq`）は**消費者がいない**。

## LOW

### R10-8 `PositionSearchModal` に同一の4行コメントが2回

`src/features/position-search/ui/PositionSearchModal.tsx:217-220` と `223-226`。
main 由来。マージがそのまま持ち込んだ。

## 機械で止められるもの（このラウンドで足す）

- **`Type::Variant` 形**を `search_doc_names` の第3の向きに足す。R10-2 と R10-9 は
  両方それで落ちていた
- **注番号の突き合わせ**（`※N` の参照と定義の差集合）。R10-11 が落ちる
- `open_project` の戻り型を `Result<_, ScreenMessage>` にすれば R10-15 は
  人の注意ではなくコンパイラが見る
- `IndexWarnPayload` の欄を非公開にすれば R10-16 の構造体リテラルは
  コンパイルエラーになる

**機械で止められないもの**: R10-1 の `indexed` 列。列の意味が実装の1式
（`has_content && warn.is_none()`）に依存していて、走査でその対応を書ける形になっていない。
ここは人が読むしかない。
