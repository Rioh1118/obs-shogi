# 提案: 名前と置き場を揃える

- 日付: 2026-09-01
- 状態: **提案。**対応する問いは `docs/OPEN-QUESTIONS.md` **Q-006**。
  合意できたら `docs/decisions/` へ ADR として起こし、この案と Q-006 の両方を消す
- 関連: `research/shogihome/05-usi-engine.md`（比較対象）、`docs/IDEAS.md`（#120 の積み残し）、
  ADR-0003（SCSS のスケール — 「段を欠くと寄せ先が2つに割れる」という同じ論法）

## 文脈

対局を入れる前に名前を揃えたい。理由は2つ。

1. **対局は Tauri コマンドを10本以上増やす。** いまの語彙が割れたまま増やすと、
   割れが固定される。
2. **`aiName` のように名前が実態と食い違っているものがある。** 対局では
   「エンジンが名乗る名前」が別途必要になるので、いま直さないと3つ目の名前が生える。

### 数えた事実

**数え方**（2026-09-02 / `a435ba4`）:

```bash
grep -c '^            [a-z_]*,$' src-tauri/src/lib.rs        # 41
grep -rn '#\[tauri::command\]\|#\[command\]' src-tauri/src | wc -l  # 41
ls src-tauri/src/search | wc -l                            # 18
```

`src-tauri/src/lib.rs` の `generate_handler!` に **41 本**が並んでいる。

**同じ意味に別の語が当たっている。**

| 意味     | 使われている語                                  | 例                                                                                     |
| -------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| 取得     | `load_` / `get_` / `read_` / `scan_`            | `load_config` / `get_file_tree` / `read_file` / `scan_ai_root`                         |
| 書き込み | `save_` / `write_` / `create_` / `import_`      | `save_kifu_file` / `write_kifu_to_file` / `create_kifu_file` / `import_kifu_file`      |
| 移動     | `mv_` / `rename_`                               | `mv_directory` と `rename_directory` が**両方ある**                                    |
| 開始     | `start_` / `initialize_` / `analyze_` / `open_` | `start_infinite_analysis` / `initialize_engine` / `analyze_with_time` / `open_project` |
| 停止     | `stop_` / `shutdown_` / `cancel_`               | `stop_analysis` / `shutdown_engine` / `cancel_search`                                  |

**棋譜の書き込みが3経路あり、名前からは区別が付かない。**

| コマンド             | 置き場                      | 引数                                              | 実際にやること               |
| -------------------- | --------------------------- | ------------------------------------------------- | ---------------------------- |
| `save_kifu_file`     | `file_system/operations.rs` | `parent_dir, file_name, content: String`          | **文字列**を新しいパスへ書く |
| `import_kifu_file`   | `file_system/operations.rs` | `parent_dir, file_name, jkf_data: JsonKifuFormat` | **JKF** を新しいパスへ書く   |
| `write_kifu_to_file` | `kifu.rs`                   | `request: WriteKifuRequest { jkf, file_path }`    | **JKF** を既存のパスへ書く   |

**領域のプレフィックスが無いので、41 本がフラットな1つの名前空間に並んでいる。**
`read_file` と `set_position` と `get_last_result` が同じ平面にある。

### Rust のモジュール

```
src-tauri/src/
  lib.rs  main.rs
  ai_library.rs        (523行)   ← 直置き
  kifu.rs              (161行)   ← 直置き
  engine_presets.rs     (86行)   ← 直置き
  study_positions.rs    (86行)   ← 直置き
  config_dir.rs         (75行)   ← 直置き
  engine/       analyzer bridge manager mod protocol types utils
  file_system/  error mod mv operations tree types utils
  search/       api file_table fs_scan index_builder ... （18ファイル）
```

**ディレクトリになっているものと直置きのものが混在している。**
`ai_library.rs` は 523 行で `file_system/` 全体（7ファイル）より大きい。

比較対象（`research/shogihome/README.md`）: ShogiHome の `src/background/` は
`book/` `csa/` `file/` `usi/` `proc/` `security/` `image/` `stats/` `headless/` `helpers/`
の10ディレクトリで、直置きは `index.ts` `log.ts` `settings.ts` の3つだけ。

### 名前と実態の食い違い

| 名前                  | 何だと読めるか           | 実際                                                                                                                              |
| --------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `EnginePreset.aiName` | USI エンジンが名乗る名前 | **`ai_root` の下の AI プロファイルのディレクトリ名。** UI のラベルも「AI名（プロファイル）」（`EnginePresetEditDialogPanel.tsx`） |
| `EnginePreset.label`  | ？                       | 利用者が付けたプリセットの表示名                                                                                                  |
| `AppConfig.ai_root`   | AI 全般の根              | エンジン本体と評価関数を置くディレクトリ                                                                                          |
| `AppConfig.root_dir`  | 何の根か言っていない     | **棋譜のワークスペース。** UI では「ワークスペース」と呼んでいる                                                                  |

ShogiHome は同じ場所を `name`（利用者が付けた名前）/ `defaultName`（`id name` の応答）/
`author`（`id author` の応答）の**3つに分けて**持っている（`src/common/settings/usi.ts`）。
**obs-shogi にはエンジンが名乗る名前を入れる場所が無い。**

## 決定（案）

### 決定1: 動詞の語彙を5つに固定する

**「段を欠くと寄せ先が2つに割れる」**（ADR-0003）と同じ理由で、語彙を先に閉じる。

| 動詞             | 意味                               | I/O              |
| ---------------- | ---------------------------------- | ---------------- |
| `read`           | ディスクから読む                   | あり。失敗しうる |
| `write`          | ディスクへ書く                     | あり。失敗しうる |
| `get`            | **プロセスが持っている状態を返す** | **なし**         |
| `set`            | プロセスが持っている状態を変える   | なし             |
| `start` / `stop` | 走るものを起こす・止める           | —                |

これに、ファイルシステム固有の4つを足す: `create` / `delete` / `rename` / `move`。

**`load` / `save` / `import` / `scan` / `initialize` / `shutdown` / `cancel` / `analyze` は使わない。**

- `load` → `read`、`save` → `write`
- `import` → `create`（新しいファイルを作るので）
- `scan` → `read`
- `initialize` → `start`、`shutdown` → `stop`、`cancel` → `stop`
- `mv` → `move`（`rename` と併存させない。**同じディレクトリ内の改名が `rename`、別の親へ移すのが `move`**）

### 決定2: コマンド名は `<領域>_<動詞>[_<対象>]`

領域は9つ。**ただしこれはコマンドの語彙であって、いまの `mod` 名とは一致しない。**

基準を「**領域名と同じ名前の `mod` が `src/` 直下にあり、そこに実装がある**」と置くと、
実測で **41本中20本が食い違う**。

| 領域                                                            | 本数 | いまの置き場                                                                               | 一致するか                       |
| --------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| `analysis_*`                                                    | 8    | `engine/bridge.rs`                                                                         | ✗ `analysis` という `mod` が無い |
| `kifu_*` のうち                                                 | 5    | `file_system/operations.rs` と `file_system/mv.rs`                                         | ✗                                |
| `tree_*`                                                        | 7    | `file_system/`（`tree` は **その内側**の `mod`）                                           | ✗                                |
| `engine_*`                                                      | 5    | `engine/`                                                                                  | ✓                                |
| `search_*`                                                      | 3    | `search/`                                                                                  | ✓                                |
| `config_*` / `ai_*` / `preset_*` / `study_*` / `kifu_*` の残り3 | 13   | `config_dir.rs` / `ai_library.rs` / `engine_presets.rs` / `study_positions.rs` / `kifu.rs` | △ 直置きのファイル名が対応する   |

**△ は「`mod` ではなく直置きファイルだが名前は対応する」もの。** 決定3 でディレクトリにすれば ✓ になる。
**✗ の20本は名前を変えるだけでは一致しない。** 決定3 で移動もセットにする。

`config` / `tree` / `kifu` / `preset` / `ai` / `engine` / `analysis` / `search` / `study`

| いま                      | 案                         | 備考                                  |
| ------------------------- | -------------------------- | ------------------------------------- |
| `load_config`             | `config_read`              |                                       |
| `save_config`             | `config_write`             |                                       |
| `backup_broken_config`    | `config_backup_broken`     |                                       |
| `get_file_tree`           | `tree_read`                | ディスクを読むので `get` ではない     |
| `create_directory`        | `tree_create_dir`          |                                       |
| `delete_directory`        | `tree_delete_dir`          |                                       |
| `rename_directory`        | `tree_rename_dir`          |                                       |
| `mv_directory`            | `tree_move_dir`            |                                       |
| `delete_file`             | `tree_delete_file`         |                                       |
| `read_file`               | `tree_read_file`           | 汎用の読み取り                        |
| `create_kifu_file`        | `kifu_create`              |                                       |
| `save_kifu_file`          | `kifu_write_text`          | **文字列**を書く                      |
| `import_kifu_file`        | `kifu_create_from_jkf`     | **JKF** から新規作成                  |
| `write_kifu_to_file`      | `kifu_write`               | **JKF** を既存のパスへ                |
| `rename_kifu_file`        | `kifu_rename`              |                                       |
| `mv_kifu_file`            | `kifu_move`                |                                       |
| `convert_jkf_to_format`   | `kifu_convert`             |                                       |
| `normalize_jkf`           | `kifu_normalize`           |                                       |
| `load_presets`            | `preset_read`              |                                       |
| `save_presets`            | `preset_write`             |                                       |
| `scan_ai_root`            | `ai_read_profiles`         | 何を返すのかを名前に入れる            |
| `ensure_engines_dir`      | `ai_create_engines_dir`    | `ensure` は語彙に無い                 |
| `create_ai_profile_dirs`  | `ai_create_profile_dirs`   |                                       |
| `initialize_engine`       | `engine_start`             |                                       |
| `shutdown_engine`         | `engine_stop`              |                                       |
| `get_engine_info`         | `engine_get_info`          |                                       |
| `apply_engine_settings`   | `engine_set_options`       | **USI の語彙に寄せる**（`setoption`） |
| `get_engine_settings`     | `engine_get_options`       | 同上                                  |
| `set_position`            | `analysis_set_position`    |                                       |
| `start_infinite_analysis` | `analysis_start_infinite`  |                                       |
| `analyze_with_time`       | `analysis_start_by_time`   |                                       |
| `analyze_with_depth`      | `analysis_start_by_depth`  |                                       |
| `stop_analysis`           | `analysis_stop`            |                                       |
| `get_analysis_result`     | `analysis_get_result`      |                                       |
| `get_last_result`         | `analysis_get_last_result` | 何の result か名前に無い              |
| `get_analysis_status`     | `analysis_get_status`      |                                       |
| `open_project`            | `search_open_project`      |                                       |
| `search_position`         | `search_start`             |                                       |
| `cancel_search`           | `search_stop`              |                                       |
| `load_study_positions`    | `study_read`               |                                       |
| `save_study_positions`    | `study_write`              |                                       |

**41 本のうち 41 本が変わる。** 変わらないものは1つも無い。

### 決定3: Rust の直置きを無くす

```
src-tauri/src/
  lib.rs  main.rs
  config/       mod.rs  dir.rs                 ← config_dir.rs から
  ai/           mod.rs  profile.rs  engines.rs  scan.rs   ← ai_library.rs(523行) を割る
  kifu/         mod.rs  write.rs  convert.rs   ← kifu.rs から
                create.rs                     ← file_system/operations.rs の *_kifu_file 3本
                mv.rs                         ← file_system/mv.rs の kifu 2本
  analysis/     mod.rs                        ← engine/bridge.rs のコマンド層8本
  preset/       mod.rs                         ← engine_presets.rs から
  study/        mod.rs                         ← study_positions.rs から
  engine/       （変えない）
  file_system/  → tree/ へ改名                 ← コマンドの領域名と合わせる
  search/       （変えない。18ファイルを割る余地はあるが別の話）
```

**規則: `src/` 直下に置いてよいのは `lib.rs` と `main.rs` だけ。**

### 改名だけでなく、移動が要る

決定2 で数えた ✗ の20本のうち13本は、動かさないと「名前から開くファイルが決まる」が成立しない
（`tree_*` 7本は `file_system` → `tree` の改名で解決するので移動は要らない）。

| 動かすもの                                                 | いま                        | 移す先              |
| ---------------------------------------------------------- | --------------------------- | ------------------- |
| `analysis_*` 8本のコマンド層                               | `engine/bridge.rs`          | `analysis/`（新設） |
| `create_kifu_file` / `save_kifu_file` / `import_kifu_file` | `file_system/operations.rs` | `kifu/`             |
| `rename_kifu_file` / `mv_kifu_file`                        | `file_system/mv.rs`         | `kifu/`             |

`analysis/` は `bridge.rs` 末尾のコマンド層のうち **`analysis_*` 8本だけ**を持つ。
同じ範囲に `engine_*` 5本（`initialize_engine` / `shutdown_engine` / `apply_engine_settings` /
`get_engine_settings` / `get_engine_info`）が**行番号順に交互に並んでいる**ので、
**行範囲では切り出せない。この5本は `engine/` に残す**（決定2 で ✓ と数えたもの）。
実体も `engine/` に残す。セッションの寿命を持っているのは
`EngineBridge` の `active_sessions` と `AppState`（どちらも `engine/bridge.rs`）で、
**実体まで動かすと所有が壊れる。**

### `file_system` → `tree` の改名には条件が付く

`file_system/` の中には**既に `tree.rs` がある**（`mod.rs` の `mod tree;`、
`mod.rs` の `pub use tree::get_file_tree;`）。そのまま改名すると
`tree/tree.rs` になり、パスが `crate::tree::tree::get_file_tree` になる。
clippy の `module_inception` に当たるし、「`tree` を開け」と言われた読み手が
`tree/mod.rs` と `tree/tree.rs` のどちらを開くか毎回考えることになる。
**これは改名が消そうとしていた問題そのもの。**

改名するなら**内側の `tree.rs` も同時に改名する**（この版は `get_file_tree` 1本だけを
公開しているので、動詞の語彙に合わせて `tree/read.rs`）。
条件を満たせないなら、改名は落とす。

### 決定3-2: `ai_library.rs` は動詞でなく概念で割る

**走査／作成で割ってはいけない。** 現物のコメントが、その境界を跨ぐことを
不変条件として書いている。

```
ai_library.rs:14  `read_profiles` がこの名前を一覧から除くので、作れても出てこない。
ai_library.rs:15  除く側と弾く側で綴りが分かれると、作成は通るのに一覧に出ないフォルダができる
ai_library.rs:23  **一覧に出す側と作成を拒否する側で、同じ述語を使う。**
```

走査側（`read_profiles`）と作成側（`create_ai_profile_dirs`）が**両方から使うのは3つ**
（`ENGINES_DIR` / `is_listed_profile` / その内側の `PROFILE_SUBS`）。
しかも**意図的に非対称**（除く側は綴りで比べず、断る側は `eq_ignore_ascii_case`）。
動詞で割ると、この規約は同居でしか強制されていないので消える。

`has_any_content` は作成側だけ、`validate_dir` は `scan_ai_root` /
`create_ai_profile_dirs` / `ensure_engines_dir` の3つから使う（走査側は呼んでいない）。

| 置き場          | 持つもの                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `ai/profile.rs` | `PROFILE_SUBS` / `is_listed_profile` / `has_any_content` / `read_profiles` / `create_ai_profile_dirs` |
| `ai/engines.rs` | `ENGINES_DIR` / エンジンの走査と作成                                                                  |
| `ai/scan.rs`    | `kind_of` / `list_file_candidates` / `AiRootIndex` / `scan_ai_root`                                   |
| `ai/mod.rs`     | `validate_dir`（3ファイルから使う）                                                                   |

依存は `scan → {profile, engines}` の一方向。

### 決定4: 名前を実態に合わせる

| いま                  | 案              | 理由                                                      |
| --------------------- | --------------- | --------------------------------------------------------- |
| `EnginePreset.aiName` | `aiProfileName` | **AI プロファイルのディレクトリ名**であることを名前に出す |
| `EnginePreset.label`  | `displayName`   | 何の label か言っていない                                 |
| （無い）              | `engineName`    | **エンジンが `id name` で名乗った名前。**対局で要る       |
| （無い）              | `engineAuthor`  | 同上                                                      |
| `AppConfig.root_dir`  | `workspace_dir` | UI が「ワークスペース」と呼んでいるものと一致させる       |
| `AppConfig.ai_root`   | `ai_dir`        | `_root` と `_dir` の2語を1つに                            |

**`root_dir` / `ai_root` のルール自体は正しい**（ワークスペース1つ、AI置き場1つ）。
直すのは名前だけで、意味は変えない。

### 決定5: 設定ファイルは後方互換で移行する

`AppConfig` と `EnginePreset` はディスク上の JSON なので、名前を変えると
**既存の利用者の設定が読めなくなる。**

- **読むときは新旧の両方を受け付ける。** `serde` の `#[serde(alias = "root_dir")]`
- **書くときは新しい名前だけ。** 一度保存すれば移行が終わる
- **alias を消す時期を決める。** 消さないと「2つの名前がある」状態が固定される。
  ADR に消す条件を書く（例: 次のマイナーリリースを2回跨いだら）

`config_backup_broken`（旧 `backup_broken_config`）が既にあるので、
**読めない設定を壊す前に退避する経路は既に持っている。**

## 結果

### 得られるもの

- 対局で増える10本以上のコマンドが、最初から揃った語彙に載る
- 「どのファイルを開けばいいか」がコマンド名から決まる
- **エンジンが名乗る名前を入れる場所ができる**（対局のブロッカーが1つ外れる）

### 諦めるもの / コスト

- **41 本のコマンド名と、その全呼び出し側を一度に書き換える。**
  TS 側の `invoke("...")` を全部追う必要がある
- **設定ファイルの移行を2バージョン抱える**（alias の期間）
- **git blame が41本ぶん流れる**

### 失効条件

- コマンドが100本を超えたら、領域プレフィックスでは足りなくなる（さらに分けるか、
  Tauri の複数 handler に割る）

## 未決

- **一度にやるか、触るたびに直すか。** 提案は**一度にやる**。
  半分だけ揃っている状態は、揃っていない状態より悪い（どちらの規則か毎回考える）
- **`search/` の18ファイルを割るか。** ここでは触らない。別の関心事
- **`file_system` → `tree` の改名を含めるか。** 含めると差分がさらに増える

## やらないこと

- **`ModalType` union の構造**（`docs/IDEAS.md` の「下位層が上位層のスライス名簿を持っている」）。
  これは名前でなく依存の向きの話で、別の ADR に値する
- **`tesuuPointer` / `PositionKey` / 解析キーの3系統3粒度**（同 IDEAS）。同じ理由
- **TS 側のレイヤ名や FSD のスライス名。** いまの命名に問題が見つかっていない
