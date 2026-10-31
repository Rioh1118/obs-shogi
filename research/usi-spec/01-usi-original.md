# 01 USI の原典に書いてあること

取得日: 2026-10-31。資料の版と URL は [README.md](README.md)。
以下、**将棋所版** = 将棋所「USIプロトコルとは」、**原案** = Tord Romstad の draft 1 (2007-01-24)。

等級の無い表の行は、全て2つの原文を開いて確かめた [確定]。

## 0. 「規格」は1枚ではない

- [確定] 原典は2つあり、**内容が食い違う**。将棋所版は原案の直訳ではなく、未対応のコマンドの説明を省いている。
  ```text
  このページの文章は、原案の直訳ではなく、説明の仕方を適度に変更しています。また、前置きの部分や、将棋所で未対応のコマンドについて説明を省略しています。
  ```
- [確定] 将棋所版は自身を正式な定義と宣言している。ただし根拠は他に議論が無いことで、標準化団体のような裏付けは書かれていない。
  ```text
  そのため、このページで解説している内容を、USIの正式な定義ということにします。
  ```
- [確定] 互換の約束が1文ある。
  ```text
  既に実装済みのコマンド部分を変更することはありませんので、エンジン作者は安心してUSIに対応して下さい。
  ```
- [確定] したがって「規格にある／無い」は**どちらの原典かを添えないと言えない**。本書は常に両方を書く。

### 将棋所版が原案から変えた点

本文の「USIに追加されたコマンド」節が一覧にしている。

| 種別 | 内容 |
| --- | --- |
| 追加（GUI→エンジン） | `gameover` / `go` の `byoyomi` |
| 変更 | `go mate` の引数。原案は手数、将棋所版は制限時間（ミリ秒）または `infinite` |
| 追加（エンジン→GUI） | `bestmove resign` / `bestmove win` / `checkmate` / `score mate +` `score mate -` |
| 将棋所が未対応（GUI→エンジン） | `debug` / `register` / `go` の `searchmoves` `movestogo` `depth` `nodes` `movetime` |
| 将棋所が未対応（エンジン→GUI） | `registration` / `info` の `currmovenumber` `cpuload` `refutation` `currline` |

`score mate +` `-` は「追加」節の一覧には無く、`score mate` の説明の中で原案に無いと書いている。
原案の `copyprotection` は将棋所版のどこにも現れない（検索語: `copyprotection`、0件）。

## 1. GUI→エンジンの順序と義務

将棋所版の「対局における通信の具体例」が示す順序。

```text
起動 → usi → (id / option) → usiok
     → setoption …
     → isready → readyok
     → usinewgame
     → position → go → (info) → bestmove  の繰り返し
     → gameover → (次の対局なら isready から)
```

| コマンド | 将棋所版 | 原案 |
| --- | --- | --- |
| `usi` | 起動後に最初に送る。エンジンは `id`、必要に応じて `option`、最後に `usiok` を返す | 同じ。`usiok` が一定時間内に来なければ GUI が kill する（時間の値は書いていない） |
| `isready` | 「対局開始前に送ります」。エンジンは準備ができたら `readyok`。時間のかかる処理はこの間にやるとよい | **探索の前に1回必須。**同期と生存確認にも使ってよく、探索中でも `readyok` を返す。必ず答える |
| `setoption` | 値を設定するときに送る。例は `usiok` の後・`isready` の前 | **エンジンが待機中にだけ送る。**名前と値の大小文字は区別すべきでない。既定値から変えないなら送らなくてよい |
| `usinewgame` | 「対局開始時に送ります」。例は `readyok` の後 | 次の探索が別の対局のときに送る |
| `position` | 思考開始局面。続けて `go` を送る | 別の対局の局面を送る前には `usinewgame` を挟むべき |
| `go` | 思考開始の合図 | 同じ。全てのオプションは同じ行で送る |
| `stop` | 「できるだけすぐ」思考を中断し `bestmove` を返す必要がある | できるだけ早く止める。`bestmove` を忘れないこと |
| `ponderhit` | 先読みが当たったときに送る。以後エンジンは任意の時点で `bestmove` を返せる | 同じ |
| `quit` | 受信したらすぐに終了する必要がある | できるだけ早く終了する |
| `gameover` | 原案に無い。`win` / `lose` / `draw`。受信後は対局待ち状態に戻り、`isready` と `usinewgame` で次の対局 | **無い** |

### 問いへの答え

**`isready` は何の前に必須か**

- [確定] 原案は「探索の前に1回必須」と書く。
  ```text
  This command is also required once before the engine is
  ```
  続きは `asked to do any search to wait for the engine to finish initializing.` 例のコメントも
  `this command and the answer is required here!`。
- [確定] 将棋所版に「必須」の語は無い。対局と詰将棋解答の例のどちらも `isready` → `readyok` → `usinewgame` の順で書かれている。
  将棋所版の `isready` の説明は対局にしか触れていない。**検討の流れは例が無い**
  （`go infinite` の説明に「検討機能で制限時間を無制限にした時」とあるだけ）。

**`usinewgame` と `isready` の順は原案の中で割れている**

- [確定] 原案の本文は `usinewgame` の**後に** `isready` を送るべきと書く。
  ```text
  can take some time the GUI should always send isready after
  ```
- [確定] 一方で原案の例は `isready` → `readyok` → `usinewgame` の順。将棋所版はこの順だけを示す。

**`setoption` はいつ送ってよいか**

- [確定] 原案: エンジンが待機中のときだけ。「待機中」の定義は無い。
  原案の例は `usiok` の後に加え、`usinewgame` の後に `setoption name USI_AnalyseMode value true` を送っている。
- [確定] 将棋所版: 時機の規定は無い。例は `usiok` の後・`isready` の前のみ。
- [確定] 探索中の `setoption` を明示的に禁じる文は将棋所版に無い。原案の「待機中にだけ」が唯一の制約。

**`stop` の後に `bestmove` は必須か**

- [確定] 必須。将棋所版は「bestmoveで指し手を返す必要があります」。原案はさらに `go` 全てに及ぼす。
  ```text
  a stop command, so for every go command
  ```
  続きは `a bestmove command is needed!`。
- [確定] `go infinite` と `go ponder` では、`stop`（`ponder` は `ponderhit` も）が来る前に `bestmove` を返してはいけない（両原典）。
- [確定] 原案: 探索していないときの `stop` のように来るはずのないコマンドは無視する。
  ```text
  for example stop when the engine is not calculating, it
  ```
  続きは `should also just ignore it.` つまり**探索外の `stop` に `bestmove` は返らない**。
  将棋所版にこの規定は無い。
- [確定] 将棋所版: 先読みが外れた `stop` への `bestmove` は GUI が無視する。GUI が破棄する `bestmove` がある前提で書かれている。

**`quit` の後の待ち**

- [確定] エンジン側の義務は「すぐに」「as soon as possible」のみ。
  GUI が何秒待つか、応答が無いときどうするかはどちらにも無い。

**`usiok` の後ですぐ `quit` してよいか**

- [確定] 原案の例のコメントがこの使い方を明示している。エンジン情報を知りたいだけなら `usiok` の時点で `quit` してよい。
  ```text
  // Note: here the GUI can already send a "quit" command if it just
  ```
  続きは2行のコメントで、`wants to find out details about the engine, so the engine should` の次の行が `not initialize its internal parameters before here.`（各行の先頭の `//` は略した）。

**応答待ちの上限**

- [確定] **数値の上限はどちらの原典にも無い。** 上限に触れた唯一の文は原案の `usiok`（`within a certain time period`）で、値は無い。
  `readyok` `bestmove` にはその文すら無い。
  検索語は §6。

## 2. `go` のサブコマンド

| サブコマンド | 将棋所版 | 原案 | 備考 |
| --- | --- | --- | --- |
| `ponder` | ある | ある | `go` の直後に書く |
| `btime` `wtime` | ある | ある | ミリ秒 |
| `byoyomi` | ある | **無い** | 将棋所の追加。`binc` `winc` と同時に使わない。両方0なら `byoyomi 0` |
| `binc` `winc` | ある | ある | ミリ秒 |
| `infinite` | ある | ある | `stop` まで `bestmove` を返さない |
| `mate` | ある（ミリ秒か `infinite`） | ある（手数） | **意味が違う** |
| `searchmoves` | 説明なし／未対応に列挙 | ある | |
| `movestogo` | 説明なし／未対応に列挙 | ある | |
| **`depth`** | 説明なし／未対応に列挙 | ある（`Search x plies only.`） | |
| **`nodes`** | 説明なし／未対応に列挙 | ある（`Search x nodes only.`） | |
| **`movetime`** | 説明なし／未対応に列挙 | ある（`Search exactly x milliseconds.`） | |

- [確定] `movetime` `depth` `nodes` は**原案にある**。**将棋所版は構文の説明を持たず**、
  「将棋所で未対応のコマンド」として名前だけを列挙している。
  ```text
  goのオプションのうち、searchmoves, movestogo, depth, nodes, movetime
  ```
- [確定] 同じ節は「今後の対応も未定です」と続く。
- [確定] これは将棋所という GUI が送らないという記述で、エンジン側がこれらを受理してはいけないという記述ではない。
- [確定] 原案: 送らなかったオプションは探索に影響しないものとして解釈する。
- [未確認] 各エンジン（やねうら王など）が実際に受理するか。本書は規格の原文だけを見ている。

### `bestmove`

- 将棋所版: `bestmove <move1> [ponder <move2>]` のほか `resign` / `win`。
- 原案: `resign` `win` は無い。
- [確定] `bestmove` の直前に最終の `info` を送るべき（原案）。

## 3. `option`

### 6つの型

| 型 | 将棋所版 | 原案 |
| --- | --- | --- |
| `check` | チェックボックス。既定は `true` / `false` | 同じ |
| `spin` | **数値のみを入力できるコントロール** | **`A spin wheel or slider`。** 範囲内の整数 |
| `combo` | ポップアップメニュー。`var` で選択肢を足す | コンボボックス |
| `button` | ボタン。押すと `setoption name <名前>`（`value` なし） | エンジンにコマンドを送るボタン |
| `string` | 文字列を入力するコントロール | テキスト欄 |
| `filename` | ファイル名。ファイル選択ボタンでダイアログを開き、**絶対パス**が値になる | `string` と同じで、表示がファイルブラウザになるだけ |

- [確定] 原案は `There are 5 different types` と書いた直後に6種類を挙げている。
- [確定] 原案に `option` のパラメータとして挙がるのは `default` `min` `max` の3つ。
  `var` は説明が無く、例にだけ現れる。将棋所版は `var <x1> var <x2> ...` を説明している。
- [確定] 将棋所版: どのコントロールを表示するかは型で決まると書いている。
  ```text
  このオプションの種類により、エンジン設定ダイアログで表示されるコントロールの型が決まります。
  ```

### `min` / `max` / `default`

- [確定] 将棋所版: `min` `max` は「種類がspinである場合」の下限と上限。
- [確定] 範囲外の値を GUI やエンジンがどう扱うかはどちらにも無い（検索語: `範囲`、`range`）。
- [確定] `default` `min` `max` を省いたときの扱いはどちらにも無い。将棋所版は「指定することができます」。

### `<empty>`

- [確定] 将棋所版: **`string` と `filename`** で既定が空のとき `<empty>` を指定する。
  ```text
  なお、stringまたはfilenameでデフォルト値が空の文字列の場合は<empty>を指定して下さい。
  ```
- [確定] 原案: **`string`** の説明に `an empty string has the value <empty>.` とある。`filename` は「`string` と同様」。
- [確定] **`combo` の `<empty>` はどちらにも書かれていない。** 将棋所版は `combo`、`string`、`filename` の既定を「任意の文字列」と書くが、
  `<empty>` の文は `string` と `filename` に限っている。
- [確定] GUI が空文字列を `setoption` でどう送るか（`value` を付けないのか、`<empty>` を送るのか）はどちらにも無い。

### 予約名と `USI_` 接頭辞

- [確定] 原案: 意味が固定されたオプションは全て `USI_` で始まる。
  ```text
  All options with fixed semantics start with the
  ```
- [確定] 原案: 知らない `USI_` のオプションは無視し、ダイアログに出さない。
- [確定] 原案: 固定の意味を持つオプションは、通常のオプション画面に出さず別扱いにするのが普通。
- [確定] オプション名に空白は入れられない（両原典）。
- [確定] 原案: GUI はオプション名を直接見せず、翻訳ファイルの訳を見せる（ファイルの形式は未定）。
  将棋所版は「日本語変換用ファイル」を別ページ `translate.html` で定めている（[未確認] 本書では開いていない）。

| 予約名 | 型 | 将棋所版 | 原案の記述 |
| --- | --- | --- | --- |
| `USI_Hash` | spin | 説明あり。**宣言の有無に関わらず対局開始時に必ず送る**。単位 MB | ハッシュの MB |
| `USI_Ponder` | check | 同上。false なら先読み禁止 | 先読みできることを示す。エンジンが勝手に先読みを始めてよい意味ではない |
| `USI_OwnBook` | check | 名前だけ。将棋所は設定しない | エンジン自身の定跡を使うか |
| `USI_MultiPV` | spin | 名前だけ。将棋所は設定しない | k-best モード。既定 1 |
| `USI_ShowCurrLine` | check | 名前だけ | `info currline` |
| `USI_ShowRefutations` | check | 名前だけ | `info refutation` |
| `USI_LimitStrength` | check | 名前だけ | `USI_Strength` と対で実装 |
| `USI_Strength` | spin | 名前だけ | 負は級、正はアマ段位 |
| `USI_AnalyseMode` | check | 名前だけ | 解析中か対局中かを GUI が伝える |

- [確定] 原案の本文はひとまとめに `USI_Pondering` とも綴っている（一覧は `USI_Ponder`）。
- [確定] `USI_MultiPV` は**予約名である**。接頭辞の無い `MultiPV` はどちらの原典にも無い
  （大文字小文字を区別した `MultiPV` のヒットは両原典とも1行ずつで、どちらも `USI_MultiPV`）。
- [確定] **`Threads` `NumberOfThreads` はどちらの原典にも無い**（検索語は §6、0件）。
  エンジンの慣習で、規格の語ではない。
- [確定] 原案には GUI が定跡を扱う前提の文がある。
  ```text
  By default all the opening book handling is done by the GUI, but
  ```
  続きは `there is an option for the engine to use its own book (USI_OwnBook option, see below).`
- [確定] 評価関数のオプションを定める記述はどちらにも無い（検索語: `eval` は原案の `USI_AnalyseMode` の説明文 `evaluation function` の1件のみ、`評価関数` は両方0件）。

## 4. `info`

| 項目 | 将棋所版 | 原案 |
| --- | --- | --- |
| `depth` | ある | ある |
| `seldepth` | ある。直前に `depth` が必要 | 同じ行に `depth` が必要 |
| `time` | ある。`pv` と一緒に返す | 同じ |
| `nodes` | ある。定期的に返す | 同じ |
| `pv` | ある。**行の最後に書く**。`string` と併用不可 | ある |
| `multipv` | ある。昇順でも降順でもよい（将棋所がソートする） | ある。k 本を k 行まとめて送る |
| `score cp` | ある。エンジンから見た値。歩1枚＝100 | 同じ |
| `score mate` | ある。`+` `-` の記号も可（原案に無い） | 手数のみ。負ならエンジンの負け |
| `lowerbound` `upperbound` | ある。`score cp <x> lowerbound` の形。将棋所は `++` `--` を表示 | 下限／上限であることを示す |
| `currmove` | ある | ある |
| `currmovenumber` | 説明なし／未対応に列挙 | ある |
| `hashfull` | ある。パーミル。定期的に | 同じ |
| `nps` | ある。定期的に | 同じ |
| `cpuload` | 説明なし／未対応に列挙 | ある |
| `string` | ある。以降を全てそのまま表示。`pv` と併用不可 | ある。行の残り全部 |
| `refutation` | 説明なし／未対応に列挙 | ある |
| `currline` | 説明なし／未対応に列挙 | ある |

- [確定] `score cp <x> lowerbound` の形は将棋所版が指定している。`score mate` に付けてよいかは書かれていない。
- [確定] 定期的に返す `info` の間隔は「少なくとも１秒」空けるのがよい（将棋所版）。原案は `currmove` などを1秒後から送ることを勧める。
- [確定] `info` は `go` から `bestmove` までの間に返せる（将棋所版）。
  探索外の `info string` については書かれていない。原案は `The engine wants to send information to the GUI.` と時機を限らない。

## 5. 将棋所版にあって、GUI の振る舞いとして読めること

規格の義務ではなく、将棋所の説明として書かれている。

- [確定] `USI_Hash` と `USI_Ponder` は、エンジンが宣言しなくても対局開始時に必ず送る。
- [確定] `USI_Hash` `USI_Ponder` 以外の予約オプションは設定しない。
- [確定] エンジン設定ダイアログの設定を GUI 側で保存し、対局開始時に同じ内容を `setoption` で送る
  （将棋所 2.8.0 以降）。エンジン側の保存は不要になった、と書いている。
- [確定] `id name` は登録に使う。`usiok` を返さないエンジンは登録できない。
- [確定] 検討機能で制限時間を無制限にしたときに `go infinite` を送る。
  **制限時間を付けたときに何を送るかは書かれていない。**
- [確定] 本文の `go inifinite` は綴りの誤り（原文のまま）。

## 6. 規格が定めていないこと

**「無い」の検出力。** どちらの原典もタグを除いた本文に対して、大文字小文字を無視して行単位で数えた。

| 検索語 | 原案 | 将棋所版 | ヒットの中身 |
| --- | --- | --- | --- |
| `Threads` / `NumberOfThreads` | 0 | 0 | |
| `timeout` / `time-out` | 0 | 3 / 0 | 将棋所版の3件は全て `checkmate timeout` |
| `タイムアウト` | 0 | 0 | |
| `待ち` | 0 | 3 | 対局待ち状態・問題待ちの類。応答待ちの上限ではない |
| `restart` / `再起動` | 0 | 0 | |
| `crash` / `異常` | 0 | 0 | |
| `kill` | 1 | 0 | 原案の `usiok` の1文 |
| `slider` / `スライダ` | 1 | 0 | 原案の `spin` の定義 |

次はどちらの原典にも定めが無い。

| 分類 | 定めが無いこと |
| --- | --- |
| 時間 | `usi` `isready` `stop` `quit` への応答待ちの上限の数値。超えたときの GUI の振る舞い（`usiok` の kill を除く） |
| 異常 | エンジンの異常終了の検知、利用者への通知、再起動、復帰の手順 |
| 異常 | 不正な `bestmove`、`usiok` の後の沈黙、標準エラー出力の扱い |
| 異常 | `readyok` が返らないときの処置 |
| 見せ方 | オプションの並び順、絞り込み、日本語名の出し方の詳細、既定に戻す口、`spin` の入力部品の選び方 |
| 見せ方 | `check` に「既定のまま」という第3の状態を持つかどうか |
| 見せ方 | 複数の設定の持ち方、エンジン更新時の設定の引き継ぎ |
| 値 | 範囲外の `spin` の扱い、空文字列の送り方、`combo` の `<empty>`、値に空白を含む `setoption` の区切り |
| 値 | `Threads` など慣習のオプション、評価関数のパス、定跡ファイルのパス |
| 検討 | 検討の開始手順、局面を変えるときの `stop` → `bestmove` → `position` の間隔、遅れて届く `bestmove` の識別 |
| 検討 | `go` のたびに `usinewgame` が要るか（原案は別の対局のときのみ） |
| 検討 | `MultiPV` を探索中に変えられるか（原案の「待機中にだけ」が残るのみ） |
| 外部 | エンジンのプロセスの起動方法、作業ディレクトリ、文字コード（将棋所版は半角英数字とだけ言う） |

- [確定] 文字に関する記述: 将棋所版はコマンドに半角英数字を使うと書くが、`info string` や日本語のパスの扱いには触れていない。
- [判定不能] 将棋所が内部で持つタイムアウトの値。将棋所はクローズドソースで、このページには書かれていない。
  検索語は上の表のとおり。

## 失効条件

- 上の `shasum` が変わったら本書の将棋所版の記述を見直す。
- 将棋所版は1語だけ変わることがある。このページに変更履歴は無い（[README.md](README.md)「版の差」）。
