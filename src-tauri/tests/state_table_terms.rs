//! 状態遷移表が、実在しない定数を仕様として書いていないことを見る。
//!
//! **表は仕様として読まれる。** `docs/state-transitions/yaneuraou-db-parse.md` は
//! 冒頭で「仕様の突き合わせのために置く」と宣言していて、実装より表を信じる
//! 読み方を前提にしている。そこに消した定数が残っていると、次に触る人は
//! 存在しない検査を前提に設計する。
//!
//! 見るのは大文字の定数名だけ。表には他リポジトリの出典（ファイルと行番号）も
//! 関数名も出るので、それらまで実在を要求すると表が書けなくなる。定数は
//! 綴りが一意で、腐ったときに読み手が最も強く誤解する。
//!
//! ✓ の正しさ（そのセルを踏むテストが本当にあるか）はここでは見られない。
//! 表の全セルにテスト名を書く規約が要るので、それは別の話。

mod scanning;
use scanning::blank_out_comments;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

/// 表と、その表が指している実装。
///
/// **表がバッククォートで名指した識別子の定義元を全部並べる。** いまの定数が
/// どのファイルにあるかで選ばない。定数だけを見て選ぶと、表の主題のモジュールが
/// 抜けたまま緑になり、**そのモジュールの定数を表に1つ書いた瞬間に、実在するのに
/// 「実装に無い」と誤って落ちる。** 落ちた人は実在する行を表から消しにいく。
const TABLES: &[(&str, &[&str])] = &[
    (
        "docs/state-transitions/yaneuraou-db-parse.md",
        &[
            "src/book/reader.rs",
            "src/book/sfen.rs",
            "src/book/yaneuraou_db.rs",
        ],
    ),
    (
        "docs/state-transitions/book-key-failures.md",
        &["src/book/api.rs", "src/book/error.rs", "src/book/sfen.rs"],
    ),
    (
        "docs/state-transitions/game-session.md",
        &[
            "src/lib.rs",
            "src/engine/analyzer.rs",
            "src/engine/protocol.rs",
            "src/engine/registry.rs",
            "src/engine/commands/game.rs",
            "src/engine/game/clock.rs",
            "src/engine/game/events.rs",
            "src/engine/game/manager.rs",
            "src/engine/game/search.rs",
            "src/engine/game/session.rs",
            "src/engine/game/types.rs",
        ],
    ),
    (
        "docs/state-transitions/search.md",
        &[
            "src/search/api.rs",
            "src/search/file_table.rs",
            "src/search/fs_scan.rs",
            "src/search/index_builder.rs",
            "src/search/index_cache.rs",
            "src/search/index_store.rs",
            "src/search/kifu_reader.rs",
            "src/search/project_manager.rs",
            "src/search/query_service.rs",
            "src/search/types.rs",
        ],
    ),
];

/// Rust の実装を指していない表。**理由を書かずに足さない。**
///
/// 対応表を手で書く以上、足し忘れは必ず起きる。`root_guard.rs` と同じで、
/// 全ての表がここか [`TABLES`] のどちらかに載っていることを機械で見る。
const NOT_RUST: &[(&str, &str)] = &[
    ("analysis.md", "解析パネル。TS 側の reducer"),
    ("app.md", "アプリ全体の起動と終了。TS 側"),
    ("branch-index.md", "分岐の索引。TS 側"),
    ("engine-position-sync.md", "局面の送信。TS 側のフック"),
    ("engine.md", "エンジンの生存。TS 側から見た状態"),
    ("failure-surfacing.md", "失敗の見せ方。TS 側"),
    ("file-tree.md", "ファイル木。TS 側"),
    ("game.md", "棋譜のカーソルと分岐計画。TS 側"),
    ("inline-name-editor.md", "名前の編集。TS 側"),
    (
        "position-search-view.md",
        "局面検索の画面側。TS 側（引く方は search.md）",
    ),
    ("verify-gate-decision.md", "検証ゲート。shell スクリプト"),
];

/// 表に出るが実装の識別子ではないもの。
///
/// **理由なしで足さない。** ここへ足すたびに検査の目が粗くなる。
const NOT_IDENTIFIERS: &[&str] = &[
    // ShogiHome（TypeScript）の識別子。この crate の定数ではない
    "SCORE_NONE",
    "DEPTH_NONE",
    // このリポジトリの TS 側の定数（`entities/analysis` の provider）。
    // 表はそれを「間引きは受け手側にある」の出典として引いている
    "RESULT_FLUSH_MS",
    // やねうら王の定跡フォーマットの見出し。文字列であって定数名ではない
    "YANEURAOU",
    // 局面数の注記。`# NOE:` の綴りの一部
    "NOE",
    // CSA の特殊手（`%MATTA`）。英大文字だけなので綴りの規則では落ちない。
    // 数字で始まる指し手は `constants_in` が規則で落とすので、ここには来ない
    "MATTA",
];

fn repo_file(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(relative)
}

/// バッククォートで囲まれた大文字の定数名を集める。
fn constants_in(text: &str) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    // バッククォートの中は式のこともある（`a * B + c > D`）ので、語ごとに切る。
    for chunk in text.split('`').skip(1).step_by(2) {
        for word in chunk.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')) {
            // **数字で始まる語は Rust の識別子になりえない。** CSA の指し手
            // （`-3334XX` / `+7776FU`）は大文字と数字だけなので、この条件が無いと
            // 定数の候補に入る。表が棋譜を1つ引用するたびに除外リストが伸びるので、
            // リストではなく綴りの規則で落とす。
            // **表のセルの記号（`E13` / `G0` / `S4`）も落とす。** 状態と事象は
            // どの表も「英字1文字＋数字」で名乗るので、綴りで分かる。除外リストに
            // 入れると表が1つ増えるたびに伸びる。
            let is_cell_label = {
                let mut chars = word.chars();
                chars.next().is_some_and(|c| c.is_ascii_uppercase())
                    && chars.clone().count() > 0
                    && chars.all(|c| c.is_ascii_digit())
            };
            let is_constant = word.len() >= 3
                && !is_cell_label
                && word.starts_with(|c: char| c.is_ascii_uppercase() || c == '_')
                && word
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
                && word.chars().any(|c| c.is_ascii_uppercase());
            if is_constant && !NOT_IDENTIFIERS.contains(&word) {
                found.insert(word.to_string());
            }
        }
    }
    found
}

/// ソースが**宣言している**定数の名前。
///
/// **全トークンから作らない。** 文字列リテラルと `assert!` のメッセージが
/// そのまま入るので、2つの向きで抜ける。
///
/// - 棋譜の fixture を持つファイルを sources に足すと、表が `%TORYO` と書いても
///   「実装に `TORYO` という定数がある」と読まれて緑になる
/// - `const VERSION` を消しても、その名前を引用した assert のメッセージが残っていれば
///   `` `VERSION` `` を書いた表は緑のまま
///
/// **`#[cfg(test)]` の中の `const` も数える。** 表は照合の相手としてテスト側の定数を
/// 名指すことがあり、`book-key-failures.md` の `LONGEST_VALID_INPUT_CHARS`
/// （`sfen.rs` の `mod tests`）が実例 —— コンパイル時 assert の根拠なので、
/// 落とすと**正当に書かれている行が赤くなる**。代価は、本番の `const` を
/// テストモジュールへ移しても表が緑のままになること。
///
/// 名前は語の区切りまでで切る。切らないと宣言名にコロンや型が付いたまま
/// （`MAX_MOVE_CHARS:`）入るので、**正しく書かれた表の綴りが「実装に無い」と
/// 誤って落ちる**。接頭辞で通らないことは [`missing_in`] が受け持つ。
fn declared_constants(code: &str) -> BTreeSet<&str> {
    code.lines()
        .filter_map(|line| {
            let mut rest = line.trim_start();
            // `pub` / `pub(crate)` / `pub(super)`
            if let Some(after) = rest.strip_prefix("pub") {
                rest = match after.strip_prefix('(') {
                    Some(scoped) => scoped.split_once(')')?.1,
                    None => after,
                }
                .trim_start();
            }
            let rest = rest
                .strip_prefix("const ")
                .or_else(|| rest.strip_prefix("static "))?;
            let name = rest
                .strip_prefix("mut ")
                .unwrap_or(rest)
                .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                .next()?;

            (!name.is_empty()).then_some(name)
        })
        .collect()
}

/// 表が名指した定数のうち、実装が宣言していないもの。
///
/// **部分文字列で見ない。** `MAX_MOVE` は `MAX_MOVE_CHARS` に含まれるので、
/// 接頭辞で照合すると、消した定数の接頭辞が別の定数に残っているだけで通る。
/// この性質を決めているのはここで、`declared_constants` ではない。
fn missing_in(table: &str, code: &str) -> Vec<String> {
    let declared = declared_constants(code);

    constants_in(table)
        .into_iter()
        .filter(|name| !declared.contains(name.as_str()))
        .collect()
}

#[test]
fn every_constant_named_in_a_table_exists_in_the_source() {
    for &(table, sources) in TABLES {
        let text = fs::read_to_string(repo_file(table)).expect("表を読めない");
        let code: String = sources
            .iter()
            .map(|s| {
                fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join(s))
                    .unwrap_or_else(|e| panic!("{s} を読めない: {e}"))
            })
            .collect();

        // **コメントアウトされた宣言を、宣言と読まないため**に落とす。
        // doc の言及（`/// 旧 `FOO` は…`）は `declared_constants` が宣言行しか
        // 見ないので元から入らない。
        let missing = missing_in(&text, &blank_out_comments(&code));

        assert!(
            missing.is_empty(),
            "{table} が実装に無い定数を書いている: {missing:?}\n\
             消した定数なら表も直すこと。表は仕様として読まれるので、\n\
             存在しない検査を前提に設計する人が出る。",
        );
    }
}

/// その表が [`TABLES`] か [`NOT_RUST`] のどちらかに載っているか。
///
/// **ファイル名で厳密に比べる。** 接尾辞で見ると
/// `"docs/state-transitions/search.md".ends_with("arch.md")` が真になり、
/// **登録していない表が登録済みとして素通りする。**
fn is_registered(name: &str) -> bool {
    let checked = TABLES
        .iter()
        .any(|(path, _)| Path::new(path).file_name().and_then(|f| f.to_str()) == Some(name));
    let excused = NOT_RUST.iter().any(|(excused, _)| *excused == name);

    checked || excused
}

/// 表を足したときに、この検査へ取り込み忘れないこと。
///
/// **対応表を手で書いている以上、これが無いと表を1つ足すだけで検査を抜けられる。**
/// 抜けた表は、定数を書いていても誰にも見られない。
#[test]
fn every_table_is_either_checked_or_declared_not_rust() {
    let dir = repo_file("docs/state-transitions");
    let mut unregistered = Vec::new();

    for entry in fs::read_dir(&dir).expect("表の置き場を読めない") {
        let name = entry.expect("表を読めない").file_name();
        let name = name.to_string_lossy().to_string();
        if !name.ends_with(".md") || name == "README.md" {
            continue;
        }
        if !is_registered(&name) {
            unregistered.push(name);
        }
    }

    assert!(
        unregistered.is_empty(),
        "この検査に登録されていない表がある: {unregistered:?}\n\
         Rust の実装を指す表なら TABLES へ、そうでないなら理由を添えて NOT_RUST へ。",
    );
}

/// 逆向き —— 登録が実在しない表やソースを指していないこと。
///
/// 表やモジュールを消しても、登録の行は残る。残った行は「その表は見られている」と
/// 読めるので、次に同じ名前で別のものを置いた人が**登録し直さずに済むと判断する。**
/// 上の検査は実在するファイル側からしか見ないので、この向きは誰も見ていない。
#[test]
fn every_registration_points_at_something_that_exists() {
    let dir = repo_file("docs/state-transitions");
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));

    let stale: Vec<String> = TABLES
        .iter()
        .flat_map(|(table, sources)| {
            std::iter::once(repo_file(table)).chain(sources.iter().map(|s| manifest.join(s)))
        })
        .chain(NOT_RUST.iter().map(|(name, _)| dir.join(name)))
        .filter(|path| !path.exists())
        .map(|path| path.display().to_string())
        .collect();

    assert!(
        stale.is_empty(),
        "登録が実在しないものを指している: {stale:?}\n\
         消したなら登録の行も消すこと。残っていると「見られている」と読める。\n\
         **綴り違いなら直すこと。消すと、その sources は誰にも見られなくなる。**",
    );
}

/// どの表も空振りしていないこと。
///
/// 表から定数を1つも拾えていなければ、その表の周回は何を書いても通る。
/// **表ごとに見る。** 1つの表だけを見ていると、後から足した表が
/// no-op になっていても気づけない。
#[test]
fn every_table_yields_at_least_one_constant() {
    for &(table, _) in TABLES {
        let text = fs::read_to_string(repo_file(table)).expect("表を読めない");

        assert!(
            !constants_in(&text).is_empty(),
            "{table} から定数を1つも拾えていない。この表の周回は何を書いても通る。\n\
             定数を書き戻すか、この表が Rust の定数を1つも名指さないなら\n\
             理由を添えて NOT_RUST へ移すこと。",
        );
    }
}

/// 綴りの規則が丸ごと壊れていないこと。
///
/// 上のテストは1件でも拾えれば通るので、規則が大幅に狭まっても気づけない。
/// 件数で見るのは定数を最も多く書いている表1つだけ。**表ごとの件数には幅があり、
/// 共通の下限は置けない**（2件しか書いていない表がある）。
///
/// **添字で引かない。** [`TABLES`] を並べ替えただけで対象が変わり、
/// 「綴りの規則が変わったかもしれない」という**嘘の理由**で落ちる。
#[test]
fn the_check_actually_finds_constants() {
    const RICHEST: &str = "docs/state-transitions/yaneuraou-db-parse.md";

    assert!(
        TABLES.iter().any(|(table, _)| *table == RICHEST),
        "{RICHEST} が TABLES から消えた。件数の下限を見る表を選び直すこと",
    );

    let text = fs::read_to_string(repo_file(RICHEST)).expect("表を読めない");
    let found = constants_in(&text);

    assert!(
        found.len() >= 5,
        "表から拾えた定数が少なすぎる（{}件）。綴りの規則が変わったかもしれない: {found:?}",
        found.len()
    );
}

/// 登録の判定が、接尾辞の一致で素通りしないこと。
///
/// 実在するファイルを見る [`every_table_is_either_checked_or_declared_not_rust`] では、
/// **素通りする形（登録していない表）をそもそも置けない**ので踏めない。
#[test]
fn a_table_is_not_registered_by_being_a_suffix_of_another() {
    assert!(is_registered("search.md"), "TABLES に載っている表");
    assert!(is_registered("game.md"), "NOT_RUST に載っている表");

    // `search.md` / `yaneuraou-db-parse.md` の接尾辞。どれも登録していない
    assert!(!is_registered("arch.md"));
    assert!(!is_registered("db-parse.md"));
    assert!(!is_registered("e.md"));
}

/// 宣言だけを拾い、ソースの中の**文字列**を拾わないこと。
///
/// ここが緩むと検査は両向きに抜ける。棋譜の fixture を持つファイルが sources に
/// 入っただけで表の綴りが通り、定数を消しても assert のメッセージが残っていれば緑になる。
#[test]
fn only_declarations_count_as_constants() {
    fn declared(code: &str) -> Vec<&str> {
        declared_constants(code).into_iter().collect()
    }

    assert_eq!(
        declared("const MAX_LINE_BYTES: usize = 4096;"),
        ["MAX_LINE_BYTES"]
    );
    assert_eq!(
        declared("pub const EVT_INDEX_WARN: &str = \"warn\";"),
        ["EVT_INDEX_WARN"]
    );
    assert_eq!(
        declared("    pub(crate) static REGISTRY: u8 = 0;"),
        ["REGISTRY"]
    );

    // 棋譜の fixture。これを拾うと、表が `%TORYO` と書いても緑になる
    assert!(declared("let csa = \"+7776FU\\n%TORYO\\n\";").is_empty());

    // 定数の名前を引用した assert のメッセージ。実装から const を消しても残る
    assert!(declared("assert!(ok, \"VERSION と一緒に動かすこと\");").is_empty());

    // 行コメントは行頭が `//` なので、剥がさなくても宣言に見えない
    assert!(declared("// const OLD_NAME: u8 = 1;").is_empty());
}

/// `blank_out_comments` を通す理由。
///
/// **ブロックコメントで囲った宣言だけが、剥がさないと宣言に見える。**
/// doc の言及（`/// 旧 `FOO` は…`）は宣言行しか見ない時点で元から入らないので、
/// 剥がしの理由にならない。
#[test]
fn a_declaration_inside_a_block_comment_is_not_a_declaration() {
    let code = "/*\nconst OLD_NAME: u8 = 1;\n*/\n";

    assert_eq!(
        declared_constants(code).into_iter().collect::<Vec<_>>(),
        ["OLD_NAME"]
    );
    assert!(declared_constants(&blank_out_comments(code)).is_empty());
}

/// 照合が接頭辞で通らないこと。
///
/// **この性質を決めているのは `missing_in` の照合で、`declared_constants` ではない。**
/// あちらは宣言名を語の区切りで切るだけなので、接頭辞は落ちない。
/// 照合を接頭辞一致へ緩めると、ここが赤くなる。
#[test]
fn a_prefix_of_a_declared_constant_is_still_missing() {
    let code = "const MAX_MOVE_CHARS: usize = 8;";

    assert_eq!(missing_in("`MAX_MOVE`", code), ["MAX_MOVE"]);
    assert!(missing_in("`MAX_MOVE_CHARS`", code).is_empty());
}

/// 綴りの規則の境界。**実データの件数を見るテストでは踏めない。**
///
/// ここが緩むと、拾いすぎた語を `NOT_IDENTIFIERS` へ足す運用に倒れる。
/// 厳しすぎると本物の定数を拾わず、表が腐っても黙る。
#[test]
fn the_spelling_rule_separates_constants_from_kifu() {
    let picked = |s: &str| constants_in(s).into_iter().collect::<Vec<_>>();

    assert_eq!(picked("`MAX_LINE_BYTES`"), ["MAX_LINE_BYTES"]);
    assert_eq!(picked("`_UNUSED`"), ["_UNUSED"]);

    // CSA の指し手。数字で始まるので Rust の識別子になりえない
    assert!(picked("`-3334XX`").is_empty());
    assert!(picked("`+7776FU`").is_empty());

    // CSA の特殊手。英大文字だけなので規則では落ちず、除外リストが受け持つ
    assert!(picked("`%MATTA`").is_empty());

    // 小文字を含む綴りは定数ではない。関数名で落ちると表が書けなくなる
    assert!(picked("`parse_move`").is_empty());

    // 表のセルの記号。英字1文字＋数字なので、除外リストではなく規則で落ちる
    assert!(picked("`E13`").is_empty());
    assert!(picked("`(G0, E16)`").is_empty());

    // **記号の形に見えても、下線が続けば定数。** 規則を「英字で始まり数字を含む」
    // まで広げると、この綴りが表から消える
    assert_eq!(picked("`E1_TIMEOUT`"), ["E1_TIMEOUT"]);
}
