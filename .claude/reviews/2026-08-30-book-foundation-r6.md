# レビュー book-foundation ラウンド6

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/` 全7ファイル、`src-tauri/src/lib.rs` の book 登録部分、`.claude/hooks/verify-gate.sh` / `verify-gate.test.sh`
- 走らせた reviewer: rust / robustness / comment
- 前ラウンド: `-r1.md`（15件）/ `-r2.md`（17件）/ `-r3.md`（12件）/ `-r4.md`（10件）/ `-r5.md`（9件）

## 所見

### K-01 [BLOCK] git のオプション値に空白が入ると commit を検出できず、ゲートごと素通しする

rust。`verify-gate.sh:26`。値が `[^[:space:]]+` 固定なので `commit` まで届かない。実測:

```
SKIP!! : git -c 'user.name=A B' commit -m x
SKIP!! : git -C '/tmp/My Books/repo' commit -m x
CATCH  : git -C /tmp/nospace-repo commit -m x
```

`gate_matches_commit` が false になると `exit 0`。**deny でも検証でもなく、何も走らないまま通る。**
`git -c 'user.name=A B' commit` はワークツリーとも空白パスとも無関係な普通の綴り。

J-01 / J-02 は宛先の決定の話で、**検出そのものが外れる綴りは一度も表に無かった。**

→ 直す。値を引用符ごと飲む。

### K-02 [MEDIUM] 空白を含むパスへの `cd` が、従いようのない案内で止まる（J-02 の直し方が不完全）

rust / comment。`verify-gate.sh:80-88`。`%%[[:space:]]*` が引用符の中で切るので、
`cd '/tmp/My Books/repo'` は `/tmp/My` になり解決に失敗して deny。

**J-02 が引用符剥がしを入れた動機そのものの綴りが直っていない。**
利用者は変数も `~` も使っていないので、案内のどれにも当たらない。
`cd X&&git commit`（`&&` の前後に空白なし）も同様。

### K-03 [HIGH] 「解釈できない綴りは空を返す」が拒否リストで実装されている

comment。`verify-gate.sh:48-54` と `:68-70`。doc は許可リスト（判別できないなら止める）を宣言しているが、
コードは列挙した綴りだけを拒否する形。実測:

```
env --chdir=<other> git commit -m x    -> <here>   ← 別ツリーを検証
builtin cd <other> && git commit -m x  -> <here>   ← 別ツリーを検証
env -C <other> git commit -m x         -> （空 / deny）
```

`env -C` は列挙されているのに、同じオプションの長い綴り `env --chdir=` は素通し。
**R5 が「綴りを1つずつ足すのを止める」と決めた方針は、doc にだけ書かれてコードに入っていなかった。**

### K-04 [MEDIUM] deny の案内と doc の列挙が、実際に deny される綴りを覆っていない

comment。案内の3項目（変数 / `~` / commit 2つ）のどれにも当たらない綴りで止まる。

### K-05 [MEDIUM] `get_book_info` が reader の Drop を IPC スレッドで走らせうる

rust。`api.rs:193-202`, `session.rs:77-82`。`state.get` は `Arc` を複製して返し、
`get_book_info` は `async` が無いので IPC ハンドラのスレッドで同期に走る。
取り出した直後に別スレッドの `close_book` が map から外して先に Arc を落とすと、
**この参照が最後の1つになり `Box<dyn BookReader>` の Drop が IPC スレッドで走る。**

F-06 は `close_book` を async にして閉じたが、`Arc` を配る口が `get` にもある以上、性質が閉じていない。

→ 直す。メタ情報だけを返す `info` を足し、`Arc` を持ち出さない。

### K-06 [HIGH] `canonicalize` が失敗する枝では実体が今も残らない（J-03 の直し方が不完全）

robustness。`api.rs:90-91`。`requested_error` が挟まるのは `open_reader` の結果だけ。
外付けを外した symlink は `canonicalize` の時点で落ちるので、
**J-03 が BLOCK として挙げたシナリオの最も起きやすい枝が直っていない。**
`read_link` はリンク先を返せるのに載せていない。

テスト `errors_keep_the_resolved_path_in_the_message` は「実体まで読める symlink」しか通していない。

### K-07 [MEDIUM] J-06 の「開き直すこと」が `close_book` では逆の指示になる

robustness。`session.rs:137-142`。`invalid_handle` は `close` からも返る。
閉じるボタンを2回押した利用者に「開き直すこと」と言い、従うと閉じたはずの定跡が載り直す。

**J-04 で `join_error` に対して直した構造（案内が経路によって成立しない）から、ここだけ漏れていた。**

### K-08 [MEDIUM] `position_count: u64` が「0局面」と「数えられなかった」を潰す

robustness。`types.rs:85-90`。doc が「数えられない形式は 0 を返してよい」と決めていた。
`# NOE:` 行の無い定跡を開くと `positionCount === 0` になり、一覧に「0局面」と出る。
エラーは出ないので、利用者は正しい定跡を開いたのに空だと読んで別のファイルを探す。

J-05 が値の確定場所を1点に固定したので、**契約を締める最後の機会がここ。**
フロント側の呼び出しは0件なのでワイヤ型を変えても壊れる呼び出し元が無い。

### K-09 [MEDIUM] `open_book` の doc がディレクトリで成り立たない

comment。`api.rs:23-24`。ディレクトリは `validate_book_path` も `resolve_book_path` も通り、
`open_reader` で `InvalidType` になる。「検査を通った場合の失敗は `UnsupportedFormat`」が偽。
`InvalidType` は公開面のどこにも書かれていない（J-08 と同じ失敗の再発）。

### K-10 [MEDIUM] `errors_keep_the_resolved_path_in_the_message` が名前の述べない性質を固定し、文言に依存している

comment。`api.rs:427-447`。後半は逆の性質（同じなら添えない）を固定し、
判定が `requested_error` の書式文字列の日本語1語（「実体」）に結びついている。
**R4 I-10 で同型の指摘を受けて分割した直後に、R5 の修正が同じ形を持ち込んだ。**

## 重複・矛盾した所見

- K-01 / K-02 / K-03 / K-04 は全てゲートの文字列解析。**4ラウンド続けて「綴りを変えると抜ける」が出た。**
  個別に足すのを止め、方針そのものを変えた（下記）
- K-06 は J-03 の、K-07 は J-06 の、K-10 は I-10 の**直し方の不完全**。
  いずれも「片方の枝だけ直して、もう片方が同じ形で残った」
- rust は `normalize_board` の u32 オーバーフロー（単一段に約4G文字が要る）と、
  非 UTF-8 パスの往復不能（APFS では作れない）を**所見にしなかった**と明示している

## 見ていない範囲

- フロント側（`src/`）。呼び出しは R1 から0件のまま
- 実際の定跡ファイルでの動作。`open_reader` は今も必ず `Err`
- やねうら王 `source/book/book.h` / `Position::sfen()` の一次資料（R1 から変わらず）
- Windows / Linux の実行時挙動。実測は macOS のみ。`env --chdir` は GNU coreutils の綴りで
  macOS の `/usr/bin/env` には無いので、素通しになるのは Linux 側
- `tauri::async_runtime::spawn_blocking` の join が `Err` になる条件
- `cargo audit` / dashmap 6.1.0 の deadlock 実測
- 意図して見送っている4件（issue #197 / ゲートの誤発火側 / 検査と使用の窓 / Windows CI）は再提出されていない
- comment は `TODO(#91)` が3箇所（指示では2箇所と伝えたが実際は3）で、いずれも #91 で消せる形だと確認した。
  変更の経緯の混入は grep で0件

## lint / hook で強制できるもの

- **ゲートの判定表に「値に空白を含むオプション」を足す** — K-01 の5行を `expect_match CATCH` で固定した
- **宛先の表を deny 期待で埋める** — K-02 / K-03 の綴り（`(cd …)` / `pushd` / `builtin cd` /
  `env -C` / `env --chdir=` / `cd X&&` / 引用付き / `$(…)` / `~`）を全て `""` 期待で並べた
- **`requested_error` を直接呼ぶテスト** — K-10。文言ではなく等値で見るので書式変更で壊れない
- **`position_count: Option<u64>`** — K-08。`None` を 0 と混ぜる実装がコンパイルエラーになる

## 修正結果

| 所見 | 結果 | コミット |
| ---- | ---- | -------- |
| K-05 | 直した | `eb165e5` |
| K-07 | 直した | `eb165e5` |
| K-06 | 直した | `397ba64` |
| K-10 | 直した | `397ba64` |
| K-08 | 直した | `8acbc74` |
| K-09 | 直した | `8acbc74` |
| K-01 | 直した | `4611b91` |
| K-02 | 直した | `4611b91` |
| K-03 | 直した | `4611b91` |
| K-04 | 直した | `4611b91` |

### ゲートの方針を変えた

K-01〜K-04 は、綴りを1つ足す形では直さなかった。**コマンド文字列からコミット先を読み取るのをやめた。**

4ラウンドの経過:

| ラウンド | 塞いだ綴り | 次のラウンドで出た穴 |
| -------- | ---------- | -------------------- |
| R3 H-01/H-02 | `-C` / `--git-dir=` | `cd X &&` / `-C` の帰属 / git 以外の `-C` |
| R4 I-01/I-02 | `cd X &&` / 呼び出し区間 | `(cd X …)` / `pushd` / `env -C` / `%%` の取り違え |
| R5 J-01/J-02 | `(cd …)` / `pushd` / 引用符 | `env --chdir=` / `builtin cd` / 空白パス / 値の空白 |
| R6 K-01〜K-04 | — | — |

シェルの文字列から「このコマンドはどのツリーへコミットするか」を言い当てるのは決定可能ではない。
そこで**言い当てない**ことにした。宛先が自明な形（起点の作業ディレクトリで、ディレクトリ指定の無い
`git commit` が1つだけ走る）だけを通し、それ以外は全て deny にする。

代償: `cd <dir> && git add -A && git commit -m ...` のような書き方が通らなくなる。
対象のツリーへ移動する呼び出しと、commit する呼び出しを分ける必要がある。
**素通し（検証されないまま通る）と、余分な手数のどちらを取るかであれば後者を取る**
というのが、ファイル冒頭の「逃げ道は用意しない」の意味だと読んだ。

## 検証

`npm run verify:rust` を通した。book のテストは 51件。
`bash .claude/hooks/verify-gate.test.sh` も通した（判定 21 / 宛先 22）。
