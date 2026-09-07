# レビュー 441-unmount-session ラウンド20

- 日付: 2026-09-08
- 範囲: `git diff origin/main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / oss-hygiene / architecture
- 対象コミット: `821b4bde`
- 前ラウンド: [r18](2026-09-07-441-unmount-session-r18.md) / [r19](2026-09-07-441-unmount-session-r19.md)

## 所見

### [HIGH] 1. r19 で足した「エンジンの世代」の枝が、3つの後始末を全部落としている

reviewer: robustness / architecture / react（3人が別々の結末に到達）

`takeSeatAndGo` の `if (engineEpochRef.current !== epoch)`（`provider.tsx:304-307`）は
席を捨てて `false` を返すだけで、兄弟の枝（`holdUnlessSuperseded`）が15行のコメント付きで
やっている後始末を1つも通らない。結末は3つ。

```
E2 (席が遅れて着地) analyzing= false error= null cands= 0 startCore= 2   ← settled= resolved
E3 (▶ 押し直し)     analyzing= true  error= null cands= 0 startCore= 3
```

- **▶ が黙って終わる。** `settled = resolved` なので `AnalysisPaneHeader` の `catch` にすら
  入らず、`console.error` も `state.error` も出ない。画面は停止中のまま控えを出すので
  **押す前と1ドットも変わらない**。1段あと（同期待ち）で同じことが起きれば断りが出る
  ——**隣り合う枝で片方だけ黙る**
- **反映待ちの結果を捨てない。** `dropPendingResult()` を通らないので、捨てた席の
  `info` が 80ms 後に commit される。`holdUnlessSuperseded` が塞いだ結末（別の局面の
  読み筋が、いまの局面の解析結果として出る）が、こちらの枝には開いたまま
- **自動再開が2回続けて落ちると再開の引き金が消える。** 同期の追従の effect
  （`provider.tsx:598`）は、飛んでいる再開が在ると**予約せずに降りる**。捨てた席の枝には
  再開を張り直す者が居ないので、`finally` の `pendingAfterRef` も立たない

```
B2 startCore= 2 analyzing= true error= null stopCore= [] candidates= 0   ← 500ms 以上動かない
```

引き金はどれも**この画面の断り6本が案内している操作**（設定でオプションを変えて保存）。

### [HIGH] 2. 停止が落ちた回の書き戻しが、エンジンが消えていても走る

reviewer: react（実測）

```
A4 after press: stopCore= [["s1","restart"],["s1","start"]]
```

`shoot` の catch は往復の前後でエンジンが同じかを見ないので、消えたエンジンの席を
欄へ書き戻す。以後の停止は**次のエンジン**へその識別子で飛ぶ。

### [HIGH] 3. 席の生死が2つのモジュールに分かれ、門が呼び手の任意になっている

reviewer: architecture

`useEngineSeat` は「席の識別子を書き換えるのはこのフックの中だけ」と名乗るのに、
「その席は生きているエンジンのものか」を決める状態（`engineEpochRef`）と判定は
provider 側に在る。`takeSeatAndGo` の中に門が2枚あり、落ちたときの後始末が枝ごとに違う
——その差が所見1 の欠け。`api/tauri.ts:93` が書くとおり席を取る口は増えうるので、
2本目の呼び手は `seat.hold()` を直に呼べて門を落とせる。止める機械は無い。

語彙も割れている。`provider.tsx` の中で「世代」が**エンジン**（`engineEpochRef`）と
**要求**（`restartSeqRef`）の2つを指し、`analysis.md` の ※10 が定義しているのは後者だけ。

### [HIGH] 4. `abandonOnEngineGone` が引数の有無で別の操作になり、doc は片方について嘘

reviewer: architecture

引数を渡した回は `seatRef` に触らず `remember` して帰る。doc は「こちらの欄も空ける」と
だけ書いているので、**署名を素直に読んだ呼び手が壊す**——握っている席を指して呼ぶと
欄は死んだ席を指したまま残り、#441 の症状そのものに戻る。

### [BLOCK] 5. 死んだ検査名を指すコメント

reviewer: comment

`useEngineSeat.ts:187` の `analysisSeatSlot.test.ts` はリポジトリに1つも無い綴り
（r19 で `__tests__/seatSlotShape.test.ts` へ移した）。**この規約が破れたときの症状は
tsc も lint も止めない**と、その行自身が書いている。

### [HIGH] 6. r19 が「違う」と結論した理由が、同じ枝を説明する3箇所に残っている

reviewer: comment

`analysis.md` の ※12 は「この理由をここに1つだけ置く」と名乗る出典なのに、
`useEngineSeat.ts:88-93` と**逆のこと**を書いている（「空撃ちだから無害」対
「起こし直したエンジンへ裸の `stop` が書かれる」）。`provider.tsx:375` と
`provider.test.tsx:545` も古い側。

### [HIGH] 7. 走査規則を広げたのに、限界の説明が古い条件のまま

reviewer: comment / oss-hygiene（独立に）

`docsIdentifiers.ts:121-123` は「`IDENTIFIER` が下線を要求するので型名は入らない」と
書くが、r19 の第3枝（camelCase）で下線は要求されなくなった。実際に効いている理由は
**先頭に小文字を要求している**こと。結論だけが偶然合っているので機械では落ちない。
第3枝を直接固定するテストも無い（枝を消しても赤くならない）。

## MEDIUM

8. **`EngineReadiness` の合併が ref の境界で割れ、`?? "no-engine"` が戻っている**
   （react / robustness / comment / architecture の4人）。r18 が消し、r19 が戻した。
   いまは踏めないが、既定値は「起こし直しの窓に出してはいけない」と結論した文言。
9. **`sliceBarrels` の接頭辞判定が `engine-presets` を丸ごと免除している**（architecture）。
   `entities/engine` の barrel を守る番人が、名前が接頭辞を共有するスライスに掛かっていない。
10. **`seatSlotShape` をスライスへ移したことで、索引を強制する側から外れた**（architecture）。
11. **`docsIdentifiers` の範囲が `docsSourcePaths` より狭いのに「同じ理由」を引いている**
    （oss-hygiene）。同じファイルでパスは検査され識別子は検査されない。広げても即座に緑。
12. **裸の `※N` が、どの表のものか決まらない**（comment / oss-hygiene）。
    `refusals.ts` は `engine.md` だけを名指ししているのに `※7` / `※11` を書く。
    `analysis-pane.md:96` は r19 が4行直した同じコミットで足した1行。
13. **`RELEASE_FAILED_MESSAGE` の doc が ※7 を指すが、※15 はその枝を ※2 に割り当てている**
    （oss-hygiene）。2つの定数が同じ `（→ ※7 / F-7）` を持つ。
14. **※5 が「`phase` は `ready` のままだから `isReady` は落ちない」と書き、E6 の行は
    同じ前提から逆の結論を書いている**（oss-hygiene）。実際の識別因子は `desiredRuntime`。
15. **doc ブロックが宣言から剥がれ、要約が2つ縦に並んでいる**（comment）。
    `_EveryPointIsAssigned` が無 doc、`InlineOnlyReleasePoint` が doc 2枚。
16. **`listenersFailedRef` の「張り直す口が無い」と「張り直せた回は」が条件抜きで並ぶ**
    （comment）。後者が起きるのは StrictMode だけ。
17. **自動再開の本体が、段ごとに説明を要する長さに戻っている**（comment）。
    86行・独立した説明ブロック7つ。▶ の本体だけが r19 で関数に割られた。
18. **`takeSeatAndGo` の `by` が「捨てるときの口」を意味している**（comment）。
    `EngineSeat` 側の `by`（撃つ口）と綴りは同じで意味が違う。
19. **表が「▶ の失敗は必ず断りが載る／`console.error` が出る」と書いている**
    （robustness）。所見1 の枝はどちらも出さない。※13 の引き金にもエンジンの世代が無い。

## 重複・矛盾した所見

- 所見1 は3人が別の結末（黙る／結果が出る／再開が消える）で同じ1つの枝に到達した。
- 所見8 は4人が独立に同じ行を指し、直し方も一致（ref を1本にする）。
- 矛盾は無し。

## 見ていない範囲

- `analyzer.rs` / `protocol.rs` の内部と #463 の窓の幅。**20ラウンド続けて未見。**
- 実プロセス（本物の USI エンジン）を使った検証は誰もしていない。

## 修正計画

束ねる根は5つ。順は「振る舞い → 構造 → 型 → 機械 → doc」。

1. **所見1・3・4・18 → 席の生死をフックに閉じる。** `engineEpochRef` を
   `useEngineSeat` へ移し、席を取る往復を `beginTake()` / `landed()` で包む。
   `landed` が「握った／エンジンが消えた／要らなくなった」の3値を返すので、
   呼び手は switch を書くことになり、後始末を枝ごとに落とせなくなる。
   `abandonOnEngineGone` は引数の無い `onEngineGone` だけにする。テスト1本
2. **所見2 → `shoot` の catch が往復の前後でエンジンの世代を見る。** 消えていたら
   書き戻さず `remember` する。1 でフックが世代を持つので、その中で閉じる。テスト1本
3. **所見1 の残り（▶ の断りと再開の予約）→** `"engine-gone"` に断りを1本足し、
   同期の追従の effect の門を `runRestart` と揃える（飛んでいる再開があるなら予約する）。
   テスト2本
4. **所見8 → `readinessRef` を1本にする。** `??` が書けなくなる
5. **所見17・15 → 自動再開の本体を段ごとの関数に割り、剥がれた doc を戻す**
6. **所見9・10・11・7 → 機械の穴。** `sliceBarrels` の区切り、索引の強制範囲、
   `docsIdentifiers` の走査範囲と第3枝のテスト
7. **所見5・6・12・13・14・16・19 → doc とコメント**

**壊しうるもの。** 1 は席の公開面を変えるので `useEngineSeat.test.tsx` と
`seatSlotShape.test.ts` が連動する。3 の予約は `pendingAfterRef` を2箇所から立てる形に
なるので、`supersedeRequests` が落とす経路を確かめること。6 の `sliceBarrels` は
直した瞬間に `engine-presets` の2本が違反として落ちるので、同じコミットで寄せる。

### 次ラウンドの焦点

- 1 の `landed` が、**要らなくなった要求とエンジンの消滅が同時に起きた回**で
  どちらに倒れるか（いまはエンジンが先。捨て方が違う）
- 3 の予約が、**エンジンが戻ってこない回**に再開を張り続けていないか
- 6 で広げた `docsIdentifiers` が、**画面仕様の中の誤検出**を出していないか

## 修正の結果

（このラウンドの修正はこれから）
