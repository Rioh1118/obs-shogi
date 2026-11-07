//! 対局の入口で受ける値の書式と上限。
//!
//! 隠すのは「その値を線に出してよい形か」の判断。将棋のルールは見ない
//! （合法かどうかはフロントが持つ。切れ目は `session.rs` の冒頭）。
//! 根の SFEN から手番を読むことと、`position` に載せる1行を組むこともここに置く。
//! どちらも検査と同じ書式の知識で、別の場所に置くと同じ欄の読み方が2か所になる。

use crate::engine::logging::shown;
use crate::engine::protocol::contains_usi_breaking_char;
use crate::engine::setup::{self, MAX_WIRE_FIELD};

use super::types::*;

/// 1局に積める手数の上限。
///
/// **入口で弾く側の防御。** 溢れはしないが、線に出る1行の長さがここで決まる。
/// `position` は指し手を1行に並べるので、10万手なら1行が 900KB を超え、
/// 組み立てで写しが2本（`check_writable` の `to_string` と `push_pending` の
/// `clone`）作られ、積み置きは `PENDING_LIMIT` 件まで滞留しうる。
/// 書き込みは `WRITE_TIMEOUT` で切れて `fail_writes` が走り、
/// **そのエンジンは以後何も受け付けなくなる**——出るのは
/// 「stdin を読まなくなった」で、長すぎたことは分からない。
///
/// **盤に載る手数の上限**として読むこと。当たり方は入口と裁定で違う。
///
/// - `initial_moves`（`validate_settings`）は `>=` で**断る**。ここから最低1手は
///   指せる必要がある。揃えないと `start_game` が通した設定で1手も指せない局ができる
/// - 裁定（`accept_continue`）で超えたら**終局にする**（`Rule`）。断ると、
///   フロントは一意に固定された列しか返せないのでやり直しても同じ `Err` になり、
///   `RULING_TIMEOUT` 後に「アプリが裁定を返さなかった」で畳まれる——
///   **返しているのに「返さなかった」と棋譜に残る。**
///
/// 2000 にしたのは、相入玉の長手数の棋譜が通る幅だから。足りなくなったら上げてよい。
pub(super) const MAX_PLIES: usize = 2000;

pub(super) fn validate_settings(settings: &GameSettings) -> Result<(), String> {
    settings
        .black_time
        .validate()
        .map_err(|e| format!("black: {e}"))?;
    settings
        .white_time
        .validate()
        .map_err(|e| format!("white: {e}"))?;

    // `TimeLimit::validate` は片側の中しか見ない。**対局をまたぐ組み合わせは
    // ここでしか弾けない。** 先後で流儀が違うと、`go` に `byoyomi` と `winc` が
    // 同時に載る（`GameClocks::think_params` は手番側の秒読みと、両者の加算を
    // それぞれ載せるため）。どちらを優先するかはエンジンごとに割れる。
    //
    // 長さが違うのは通す（駒落ちのハンデなど）。弾くのは流儀が違うときだけ。
    let uses_byoyomi = settings.black_time.byoyomi_ms > 0 || settings.white_time.byoyomi_ms > 0;
    let uses_increment =
        settings.black_time.increment_ms > 0 || settings.white_time.increment_ms > 0;
    if uses_byoyomi && uses_increment {
        return Err("byoyomi and increment cannot be mixed between the two sides".to_string());
    }

    if contains_usi_breaking_char(&settings.start_sfen) {
        return Err("start_sfen contains a forbidden control character".to_string());
    }
    if settings.start_sfen.len() > MAX_WIRE_FIELD {
        return Err(format!(
            "start_sfen is {} bytes; the limit is {MAX_WIRE_FIELD}",
            settings.start_sfen.len()
        ));
    }
    for side in SIDES {
        // **表示名も入口で見る。** これは線ではなく `GameSnapshot` に載って
        // webview へ戻る欄で、`get_game_state` のたびに複製される。
        // 上限が無いと、対局を1つ開くだけで対局の寿命ぶん任意の大きさを抱え、
        // 状態を引くたびにその複製と直列化が走る
        let name = settings.spec(side).name();
        if name.len() > MAX_NAME_BYTES {
            // **文字数も出す。** 利用者が数えられるのは文字で、日本語なら
            // 1文字3バイト。バイトだけ返すと、どこまで削れば通るかが導けない
            return Err(format!(
                "{side:?} name is {} bytes ({} chars); the limit is {MAX_NAME_BYTES} bytes",
                name.len(),
                name.chars().count()
            ));
        }

        let PlayerSpec::Engine { options, .. } = settings.spec(side) else {
            continue;
        };
        // **入口で断る**（`setup::validate_options`）。`setup::checked_prepare` も同じことを見るが、
        // そちらはプロセスを起こした後に断ることになる。`start_sfen` の長さと制御文字も入口で見る。
        // 同じ1行を伸ばせる経路は、手数（`MAX_PLIES`）・`setoption`（ここ）・`start_sfen` の3つ
        setup::validate_options(options).map_err(|e| format!("{side:?}: {e}"))?;
    }
    validate_start_sfen(&settings.start_sfen)?;
    // **`>=` で弾く。** ちょうど `MAX_PLIES` を通すと、最初の手の裁定が
    // 必ず断られる対局ができる（フロントが返せる列は1つに固定されている）
    if settings.initial_moves.len() >= MAX_PLIES {
        return Err(format!(
            "initial_moves has {} moves; the limit is {} (one move must be playable)",
            settings.initial_moves.len(),
            MAX_PLIES - 1
        ));
    }
    for mv in &settings.initial_moves {
        validate_usi_move(mv)?;
    }
    Ok(())
}

/// SFEN が**書式として**送れる形か。
///
/// **将棋のルールは見ない**（合法性の判定はフロントが持つ、がこの層の切れ目）。
/// 見るのはワイヤに出せる形かどうかだけ。
///
/// ここが緩いと、壊れた SFEN が `position sfen <それ> moves ...` として
/// そのままエンジンへ出る。エンジンの反応は実装ごとに割れる（無視する／
/// エラー行を返す／落ちる）が、**どれになっても原因が `start_sfen` にあることは
/// 利用者にもログにも出ない**。無視された場合は前の局面のまま `go` を受けるので、
/// 返る `bestmove` は別の局面に対する手になり、フロントは反則と裁定する
/// ——エンジンが身に覚えのない負けを負う。
fn validate_start_sfen(sfen: &str) -> Result<(), String> {
    let fields: Vec<&str> = sfen.split_whitespace().collect();

    // `startpos` は受け取らない。`GuiCommand::Position` が `position sfen` を
    // 前置するので、`position sfen startpos moves ...` という壊れた行になる
    if fields.first() == Some(&"startpos") {
        return Err("start_sfen must be a full SFEN, not \"startpos\"".to_string());
    }
    // 盤面 / 手番 / 持ち駒 / 手数 の4つ。欠けたまま送ると解釈が実装依存になる
    if fields.len() != 4 {
        return Err(format!(
            "start_sfen must have 4 fields (board, side, hands, ply), got {}",
            fields.len()
        ));
    }
    // 段は9つ。`/` の数だけを見る（駒の綴りはルール側の話）
    if fields[0].split('/').count() != 9 {
        return Err("start_sfen board must have 9 ranks separated by '/'".to_string());
    }
    if Side::from_sfen_token(fields[1]).is_none() {
        return Err("start_sfen must have \"b\" or \"w\" as its second field".to_string());
    }
    if fields[3].parse::<u32>().is_err() {
        return Err("start_sfen ply must be a number".to_string());
    }
    Ok(())
}

/// `played` 手が指された後の手番。SFEN の2番目のフィールドを手数の偶奇で反転させる
pub(super) fn derive_side_after(settings: &GameSettings, played: usize) -> Side {
    let root = settings
        .start_sfen
        .split_whitespace()
        .nth(1)
        .and_then(Side::from_sfen_token)
        .unwrap_or(Side::Black);

    if played % 2 == 0 {
        root
    } else {
        root.opponent()
    }
}

pub(super) fn position_argument(start_sfen: &str, moves: &[String]) -> String {
    if moves.is_empty() {
        start_sfen.to_string()
    } else {
        format!("{start_sfen} moves {}", moves.join(" "))
    }
}

/// USI の指し手として**形が**通るか。合法かどうかは見ない（ルールは持たない）。
///
/// **断り文句に生の値を載せない。** ここへ来るのは webview から来た文字列か
/// エンジンが吐いた行で、どちらも長さも改行も無検査。載せると、断り1回で
/// ログの予算（`LOG_FILE_BUDGET` ＋ `KeepOne`）を一周させられ、改行を混ぜれば
/// その後ろに好きなログ行も作れる（`GameId::Display` が同じ理由で切っている）。
pub(super) fn validate_usi_move(usi_move: &str) -> Result<(), String> {
    if usi_move.is_empty() {
        return Err("move is empty".to_string());
    }
    if usi_move.len() > MAX_USI_MOVE_BYTES {
        return Err(format!(
            "move is too long: {} bytes; the limit is {MAX_USI_MOVE_BYTES}",
            usi_move.len()
        ));
    }
    if !usi_move.is_ascii()
        || usi_move
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(format!(
            "move has an unusable shape: {}",
            // 長さは既に上限を通った後で、指し手は ASCII なので
            // ここで切れることはない。渡すのは制御文字を潰すため
            shown(usi_move, MAX_USI_MOVE_BYTES)
        ));
    }
    Ok(())
}

/// USI の指し手として通す最大のバイト数。
///
/// 一番長いのは成りを伴う**移動**（`7g7f+` の5バイト）。打ちは `P*7f` の4バイトで、
/// **打った駒は成れない**ので `+` は付かない。余裕を見て8。
///
/// **文字数の上限としても使える。** 指し手は ASCII しか通らない
/// （`validate_usi_move` が `is_ascii` を見る）ので、この値を `shown` の
/// 第2引数（文字数）に渡してよい。ASCII の縛りを緩めたら、この兼用も外すこと。
const MAX_USI_MOVE_BYTES: usize = 8;

/// 対局者の表示名として通す最大のバイト数。
///
/// **線に出る値ではない。** `GameSnapshot` に載って webview へ戻り、
/// `get_game_state` のたびに2本複製される。縛らないと、対局を1つ開くだけで
/// 対局の寿命ぶん任意の大きさを抱え込む（`GameId::is_safe_to_retain` と同じ懸念）。
///
/// **断る。** 名前は対局が始まる前に決まっていて、切り詰めると利用者は
/// 「なぜ短くなったのか」を知る手立てが無い。ここで断れば `startGame` の
/// `Err` として理由が出る。
///
/// **縮める根拠を doc に置かない。** 通したい実例は
/// `a_name_that_only_goes_back_to_the_app_is_checked_too` が持っていて、
/// そちらは日本語の棋戦名を含む（日本語は1文字3バイトなので、
/// バイトで見ると余裕は見た目より小さい）。縮めるならその一覧を見ること。
const MAX_NAME_BYTES: usize = 128;

#[cfg(test)]
mod tests {
    use super::super::fixtures::{minutes, two_humans, HIRATE};
    use super::*;
    use crate::engine::setup::MAX_SENT_OPTIONS;

    /// 線に出る1行を伸ばせる経路を、入口で全部見ていること。
    ///
    /// **手数だけ見ても足りない。** 同じ1行は `start_sfen` の盤面欄からも
    /// `setoption` の値からも伸ばせる。どれも `check_writable` の `to_string` と
    /// `push_pending` の `clone` を通り、`WRITE_TIMEOUT` で切れて `fail_writes` が
    /// 走ると**そのエンジンは以後何も受け付けなくなる**——出るのは
    /// 「stdin を読まなくなった」で、長すぎたことは分からない。
    #[test]
    fn every_way_to_stretch_the_wire_is_checked_at_the_door() {
        // 通したい形: 平手も、最長の駒落ちも、実在するエンジンの option の件数も
        validate_settings(&two_humans(vec![])).expect("平手を断っている");

        let engine = |options: Vec<SetOptionValue>| PlayerSpec::Engine {
            name: "エンジン".to_string(),
            engine_path: "/path".to_string(),
            work_dir: None,
            options,
            ponder: false,
        };
        let option = |value: String| SetOptionValue {
            name: "EvalDir".to_string(),
            value,
        };

        let mut settings = two_humans(vec![]);
        settings.black = engine(vec![option("/very/long/path/to/eval".to_string()); 32]);
        validate_settings(&settings).expect("32件の option を断っている");

        // 断る形
        let mut settings = two_humans(vec![]);
        settings.start_sfen = format!(
            "{}{} b - 1",
            HIRATE.split(' ').next().expect("盤面欄がある"),
            "1".repeat(MAX_WIRE_FIELD)
        );
        let error = validate_settings(&settings).expect_err("長すぎる SFEN を通している");
        assert!(error.contains("bytes"), "断る理由が変わっている: {error}");

        let mut settings = two_humans(vec![]);
        settings.black = engine(vec![option("x".to_string()); MAX_SENT_OPTIONS + 1]);
        validate_settings(&settings).expect_err("多すぎる option を通している");

        let mut settings = two_humans(vec![]);
        settings.black = engine(vec![option("x".repeat(MAX_WIRE_FIELD + 1))]);
        validate_settings(&settings).expect_err("長すぎる option の値を通している");

        // **制御文字も入口で断る。** `setup::checked_prepare` も見るが、そちらは
        // プロセスを起こした後——起こしてから断ることになる
        let mut settings = two_humans(vec![]);
        settings.black = engine(vec![option("/eval\ninjected".to_string())]);
        let error =
            validate_settings(&settings).expect_err("改行を含む option の値を入口で通している");
        assert!(
            error.contains("control character"),
            "断る理由が変わっている: {error}"
        );
    }

    /// webview へ戻る欄も、入口で見ていること。
    ///
    /// **上のテストが見ているのは線に出る値だけ。** 表示名は
    /// エンジンへ出ないので同じ網に掛からないが、`GameSnapshot` に載って
    /// `get_game_state` のたびに複製される。上限が無いと、対局を1つ開くだけで
    /// 対局の寿命ぶん任意の大きさを抱える。
    #[test]
    fn a_name_that_only_goes_back_to_the_app_is_checked_too() {
        // **通したい形の一覧。** 上限を縮める人はここを見る。
        // 日本語は1文字3バイトなので、いちばん効くのは棋戦名を含む長い形
        for name in [
            "YaneuraOu NNUE 7.0.0 64ZEN2",
            "Kristallweizen-Kai-Ultimate-2021 (YaneuraOu NNUE 6.00 64AVX2)",
            "先手（わたし）",
            "第4期叡王戦本戦 佐々木大地七段",
            "水匠5改（やねうら王 7.6.1）",
        ] {
            let mut settings = two_humans(vec![]);
            settings.black = PlayerSpec::Human {
                name: name.to_string(),
            };
            validate_settings(&settings).unwrap_or_else(|e| panic!("{name} を断っている: {e}"));
        }

        let mut settings = two_humans(vec![]);
        settings.black = PlayerSpec::Human {
            name: "x".repeat(MAX_NAME_BYTES + 1),
        };
        let error = validate_settings(&settings).expect_err("長すぎる表示名を通している");
        assert!(error.contains("bytes"), "断る理由が変わっている: {error}");
    }

    #[test]
    fn settings_accept_every_pair_of_time_limits_we_want_to_support() {
        // 弾く方向の検査なので、通したいものを先に並べる（/implement 手順5）
        let allowed: [(&str, TimeLimit, TimeLimit); 5] = [
            ("先後とも切れ負け", minutes(10), minutes(10)),
            ("先後で持ち時間が違う（ハンデ）", minutes(10), minutes(5)),
            (
                "先後とも秒読み。長さは違う",
                TimeLimit {
                    main_ms: 0,
                    byoyomi_ms: 60_000,
                    increment_ms: 0,
                },
                TimeLimit {
                    main_ms: 0,
                    byoyomi_ms: 30_000,
                    increment_ms: 0,
                },
            ),
            (
                "先後ともフィッシャー。加算が違う",
                TimeLimit {
                    main_ms: 300_000,
                    byoyomi_ms: 0,
                    increment_ms: 10_000,
                },
                TimeLimit {
                    main_ms: 300_000,
                    byoyomi_ms: 0,
                    increment_ms: 5_000,
                },
            ),
            (
                "片側だけ秒読み付き（もう片方は秒読み0）",
                TimeLimit {
                    main_ms: 600_000,
                    byoyomi_ms: 30_000,
                    increment_ms: 0,
                },
                minutes(10),
            ),
        ];

        for (label, black, white) in allowed {
            let mut settings = two_humans(vec![]);
            settings.black_time = black;
            settings.white_time = white;
            assert!(
                validate_settings(&settings).is_ok(),
                "{label} が弾かれた: {:?}",
                validate_settings(&settings)
            );
        }
    }

    #[test]
    fn settings_reject_mixing_byoyomi_and_increment_across_the_two_sides() {
        // 片側ずつは `TimeLimit::validate` を通るので、ここでしか弾けない。
        // 通すと `go` に `byoyomi` と `winc` が同時に載る
        let mut settings = two_humans(vec![]);
        settings.black_time = TimeLimit {
            main_ms: 0,
            byoyomi_ms: 30_000,
            increment_ms: 0,
        };
        settings.white_time = TimeLimit {
            main_ms: 300_000,
            byoyomi_ms: 0,
            increment_ms: 5_000,
        };
        assert!(settings.black_time.validate().is_ok());
        assert!(settings.white_time.validate().is_ok());
        assert!(validate_settings(&settings).is_err());
    }

    #[test]
    fn settings_reject_startpos_because_position_sfen_is_prepended() {
        let mut settings = two_humans(vec![]);
        settings.start_sfen = "startpos".to_string();
        assert!(validate_settings(&settings).is_err());
    }

    #[test]
    fn settings_reject_an_sfen_without_a_side_field() {
        let mut settings = two_humans(vec![]);
        settings.start_sfen =
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL".to_string();
        assert!(validate_settings(&settings).is_err());
    }

    /// 通したい形と弾きたい形を並べる。
    ///
    /// **見るのは書式だけ。** 駒の綴りも局面の妥当性もルール側の話で、
    /// この層は「ワイヤに出せる形か」しか見ない（→ `validate_start_sfen`）。
    /// 緩いと、壊れた SFEN が `position sfen <それ>` としてエンジンへ出る。
    #[test]
    fn start_sfen_is_checked_as_a_wire_format() {
        // 通す
        for ok in [
            HIRATE,
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 42",
            // 持ち駒あり・途中局面
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b P2p 7",
        ] {
            assert!(validate_start_sfen(ok).is_ok(), "通らない: {ok}");
        }

        // 弾く
        for (ng, why) in [
            ("startpos", "`position sfen startpos` という壊れた行になる"),
            (
                "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -",
                "手数が無い（3フィールド）",
            ),
            (
                "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1 extra",
                "余分なフィールド",
            ),
            (
                "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1 b - 1",
                "段が8つしかない",
            ),
            (
                "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL x - 1",
                "手番が `b` でも `w` でもない",
            ),
            (
                "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - one",
                "手数が数でない",
            ),
        ] {
            assert!(
                validate_start_sfen(ng).is_err(),
                "弾けていない（{why}）: {ng}"
            );
        }
    }

    #[test]
    fn position_is_built_as_sfen_plus_moves() {
        assert_eq!(position_argument(HIRATE, &[]), HIRATE);
        assert_eq!(
            position_argument(HIRATE, &["7g7f".to_string(), "3c3d".to_string()]),
            format!("{HIRATE} moves 7g7f 3c3d")
        );
    }

    #[test]
    fn move_shape_is_checked_but_legality_is_not() {
        // 通したい形
        for mv in ["7g7f", "8h2b+", "P*5e", "5a5b"] {
            assert!(validate_usi_move(mv).is_ok(), "{mv} が弾かれた");
        }
        // 合法かどうかは見ない。盤の上でありえない手でも形が通れば通す
        assert!(validate_usi_move("1a1a").is_ok());

        // 形が壊れているもの
        assert!(validate_usi_move("").is_err());
        assert!(validate_usi_move("7g 7f").is_err());
        assert!(validate_usi_move("7g7f\nquit").is_err());
        assert!(validate_usi_move("７六歩").is_err());
        assert!(validate_usi_move("aaaaaaaaa").is_err());
    }

    /// 断り文句が、渡された値の長さにも中身にも引きずられないこと。
    ///
    /// ここへ来るのは webview から来た文字列かエンジンが吐いた行で、どちらも
    /// 無検査。載せると断り1回でログの予算を一周させられ、改行を混ぜれば
    /// その後ろに好きなログ行も作れる（`log_rejection` が `{e}` を丸ごと書く）。
    #[test]
    fn a_refusal_never_carries_the_raw_move() {
        let long = "x".repeat(300_000);
        let error = validate_usi_move(&long).expect_err("長すぎる手を通している");
        assert!(
            error.len() < 100,
            "断り文句が渡された値の長さに引きずられている: {} バイト",
            error.len()
        );

        assert!(
            error.contains("300000"),
            "実際の長さを報告していない: {error}"
        );

        let sneaky = validate_usi_move("7g\nERROR").expect_err("改行を含む手を通している");
        assert!(
            !sneaky.contains('\n'),
            "改行をそのまま断り文句に載せている: {sneaky:?}"
        );
    }

    #[test]
    fn control_characters_are_rejected_across_the_whole_range() {
        // 列挙で書くと必ず漏れる。範囲を回す（/implement 手順5）
        for code in 0x00u8..=0x1F {
            let mv = format!("7g7{}", code as char);
            assert!(
                validate_usi_move(&mv).is_err(),
                "制御文字 {code:#04x} が通った"
            );
        }
    }
}
