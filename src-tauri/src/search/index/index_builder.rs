use std::sync::Arc;

use thiserror::Error;

use shogi_core::PartialPosition;
use shogi_kifu_converter_obsshogi::jkf::{JsonKifuFormat, MoveFormat};

use crate::search::position::initial_position::initial_partial_position;
use crate::search::position::position_apply::{
    apply_node_action, jkf_move_to_core_move, ApplyError, ApplyStatus, NodeAction,
};
use crate::search::position::position_key::{advance_key, key_from_partial_position, PositionKey};
use crate::search::store::node_table::{NodeTable, NodeTableBuilder};
use crate::search::types::{CursorLite, FileId, ForkPointer, Gen, NodeId, Occurrence};

/// 指せない手に当たったとき、その1手順を捨てるか、ファイルごと諦めるか。
///
/// **索引に何が入るかを決める最大のスイッチ。**
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildPolicy {
    /// その手順だけ打ち切って [`BuildWarn`] を積む。**本番はこちらだけを使う。**
    ///
    /// **「その手順だけ」は、その線の残り全部を含む。** `walk_sequence` は
    /// `break` でその線の `for` を抜けるので、**指せなかった手より後ろのノードに
    /// ぶら下がる変化も歩かない**。歩き終わっているのは、その手までの本譜と、
    /// そこまでの各ノードから分かれた変化（`forks` は手を指す前に降りる）。
    /// [`BuildWarn::to_user_message`] が「より先の局面は検索に出ません」と言うのは
    /// この範囲を指す
    Loose,
    /// ファイルごと [`BuildError`] にする。**本番の呼び手は無い。**
    /// 使うなら、`Display` が画面に出ることを先に手当てすること
    Strict,
}

/// 索引を組む途中で打ち切った手順。
///
/// **これを画面に出す口は [`BuildWarn::to_user_message`] だけ。**
/// ただし警告の口そのものは1つではない — [`BuildError`] が返ったときは
/// その `Display` が呼び手の `map_err` を通って同じ `EVT_INDEX_WARN` に出る。
#[derive(Debug, Clone)]
pub struct BuildWarn {
    /// 打ち切った場所。**`tesuu` は指せなかった手そのものの番号。**
    /// `tesuu = N` なら N 手目が指せず、**その手は指されていない**ので
    /// N 手目以降の局面は索引に無い（N-1 手目までは入っている）。
    ///
    /// 番号が合う根拠は、どちらも `walk_sequence` の `start_tesuu`。
    /// 本譜は `build_index_for_jkf` が `moves[1..]` を `1` で渡し、
    /// 変化は `walk_sequence` が `fork_line` を**分岐点と同じ `tesuu`** で
    /// 再帰する（変化の1手目は元の N 手目の代わり）。
    ///
    /// `push_or_replace_fork` が決めるのは `fork_pointers[].te`（どこで分かれたか）
    /// であって、変化の中の `tesuu` ではない。
    pub cursor: CursorLite,
    /// `ApplyError` の英語。**画面には出さない**（内部の理由）
    pub message: String,
}

impl BuildWarn {
    /// 利用者に出す文言にする。**`EVT_INDEX_WARN` に載るのはこれ。**
    ///
    /// `cursor` の `Debug` と `message`（`ApplyError` の英語）をそのまま並べると、
    /// 画面に `CursorLite { tesuu: 30, fork_pointers: [] }: side-to-move mismatch: …`
    /// が素のテキストで出る（`WorkspaceTab` は Markdown を解釈しない）。
    /// 何が起きたかが利用者の言葉になっておらず、次に何をすればよいかも無い。
    ///
    /// **内部の理由（`message`）はここで捨てる。** 呼び手がログへ回す。
    ///
    /// **次に何をすればよいかまで書く。** 場所だけ言われても、直せば索引に
    /// 入り直すのか放っておいてよいのかが分からない。画面（`WorkspaceTab`）に
    /// あるのは「警告をクリア」だけで、開く導線も再構築のボタンも無い。
    /// 「直して保存すれば入り直す」が成り立つのは、読み直しを決めるのが
    /// `fs_scan` の `(size, mtime_ms)` 比較だから。
    ///
    /// **変化の中なら、そう言う。** 本譜が最後まで正しく変化にだけ反則手がある棋譜で
    /// 「30手目」とだけ言うと、利用者は本譜の30手目を見に行って何も見つけられない。
    /// 同じ手数で本譜と変化の両方が打ち切られたときに、文言が同じにならない意味もある。
    ///
    /// **言葉は画面に合わせる。** `branchLabel`（`entities/kifu/model/branch.ts`）が
    /// 「本譜」「変化N」で、N は `forkIndex + 1`。ここだけ「本線」「変化」と呼ぶと、
    /// 警告に出た変化を棋譜欄で探すときに名前で突き合わせられない。
    ///
    /// **見るのは `fork_pointers` の末尾。** 変化の中の変化では先頭が一番外側で、
    /// 打ち切られた手が乗っている線を決めるのは**一番内側の選択**。
    /// 先頭を見ると、外側の分岐点を名指して利用者を別の場所へ送る。
    ///
    /// **`tesuu` に足さない。** `walk_sequence` は `moves[1..]` を `start_tesuu = 1` で
    /// 歩くので、`tesuu` はそのまま「何手目が指せなかったか」。足すと、
    /// 索引に入っていない1つ先の手を名指しすることになる。
    /// 検索結果の `手数` 表示（`PositionHitItem`）も `tesuu` を素で描くので、
    /// ずらすとアプリの中で数え方が2つになる。
    pub fn to_user_message(&self) -> String {
        let where_ = match self.cursor.fork_pointers.last() {
            None => "本譜の".to_owned(),
            Some(fork) => format!("{}手目から分かれた変化{}の", fork.te, fork.fork_index + 1),
        };
        format!(
            "{where_}{}手目に、その局面では指せない手があります。\
             この手順はそこで打ち切られるので、より先の局面は検索に出ません。\
             棋譜を開いてその手を確かめてください。直して保存すれば索引に入り直します",
            self.cursor.tesuu
        )
    }
}

#[derive(Debug)]
pub struct FileIndexBuild {
    /// 局面の鍵と、それが出た場所（どのファイルのどのノードか）の対。
    ///
    /// **[`crate::search::types::PositionHit`] ではない。** あちらは検索が返す形で、
    /// `cursor` を伴う。ここではまだ解決していない — `NodeTable` を引いて
    /// `cursor_lite` を通すのは `query_service` の仕事。
    pub entries: Vec<(PositionKey, Occurrence)>,
    pub node_table: Arc<NodeTable>,
    pub warns: Vec<BuildWarn>,
}

/// 索引を組めなかった理由。
///
/// **`Display` がそのまま利用者の画面に出る**（呼び手が `map_err(|e| e.to_string())`
/// で `EVT_INDEX_WARN` に流す）。`ParseFailed` のような文字数の刈り込みも通らない。
///
/// **[`BuildPolicy::Loose`] でも `Initial` は返る。** `build_index_for_jkf` が
/// 開始局面を組むのは `policy` を見るより前なので、`Loose` が受け止めるのは
/// `Apply` だけ。`.jkf` は外部の JSON をそのまま信じるうえ、
/// `kifu_reader.rs` の `says_nothing` は `preset != PresetHirate` を
/// 「中身がある」と見るので、`{"initial":{"preset":"OTHER"}}` はここまで届く。
///
/// 内部の理由を括弧に残すのは、利用者の言葉だけにすると報告を受けた側が
/// 原因を絞れないから（`ParseFailed` と同じ形）。
#[derive(Debug, Error)]
pub enum BuildError {
    #[error(
        "開始局面を組み立てられませんでした。このファイルの局面は検索に出ません。\
         書き出し元のアプリで保存し直してください（内部の理由: {0}）"
    )]
    Initial(#[from] shogi_kifu_converter_obsshogi::error::ConvertError),

    #[error(
        "{}手目に、その局面では指せない手があります。\
         このファイルの局面は検索に出ません。\
         棋譜を開いてその手を確かめてください（内部の理由: {source}）",
        cursor.tesuu
    )]
    Apply {
        cursor: CursorLite,
        #[source]
        source: ApplyError,
    },
}

#[derive(Debug)]
struct IndexBuilder {
    file_id: FileId,
    gen: Gen,
    policy: BuildPolicy,
    node_table: NodeTableBuilder,
    entries: Vec<(PositionKey, Occurrence)>,
    warns: Vec<BuildWarn>,
}

impl IndexBuilder {
    fn new(file_id: FileId, gen: Gen, policy: BuildPolicy) -> Self {
        Self {
            file_id,
            gen,
            policy,
            node_table: NodeTableBuilder::new(),
            entries: Vec::new(),
            warns: Vec::new(),
        }
    }

    fn finish(self) -> FileIndexBuild {
        FileIndexBuild {
            entries: self.entries,
            node_table: Arc::new(self.node_table.finish()),
            warns: self.warns,
        }
    }

    #[inline]
    fn push_entry(&mut self, tesuu: u32, fork_path: &[ForkPointer], key: PositionKey) {
        let node_id: NodeId = self.node_table.push_node(tesuu, fork_path);

        let occ = Occurrence {
            file_id: self.file_id,
            gen: self.gen,
            node_id,
        };

        self.entries.push((key, occ));
    }

    fn walk_sequence(
        &mut self,
        seq: &[MoveFormat],
        start_tesuu: u32,
        mut pos: PartialPosition,
        mut key: PositionKey,
        fork_path: Vec<ForkPointer>,
    ) -> Result<(), BuildError> {
        for (offset, node) in seq.iter().enumerate() {
            let tesuu = start_tesuu + offset as u32;
            let parent_pos = pos.clone();
            let parent_key = key;

            // forks
            if let Some(forks) = &node.forks {
                for (i, fork_line) in forks.iter().enumerate() {
                    if fork_line.is_empty() {
                        continue;
                    }
                    let mut fork_path2 = fork_path.clone();
                    push_or_replace_fork(&mut fork_path2, tesuu, i as u32);

                    self.walk_sequence(
                        fork_line,
                        tesuu,
                        parent_pos.clone(),
                        parent_key,
                        fork_path2,
                    )?;
                }
            }

            // mainline
            let action = node_action(node);

            // 差分は**指す前の局面**から取る。`apply_node_action` が
            // 局面を進めてしまうので、手を core の形にするのも先
            let stepped = match action {
                NodeAction::Move(m) => jkf_move_to_core_move(m)
                    .ok()
                    .and_then(|mv| advance_key(key, &pos, mv)),
                // 局面が動かない腕は鍵も動かない
                NodeAction::Special(_) | NodeAction::None => Some(key),
            };

            match apply_node_action(&mut pos, action) {
                Ok(status) => {
                    // **差分が読めなかったら盤を舐め直す。** 黙って違う鍵を作らない
                    key = stepped.unwrap_or_else(|| key_from_partial_position(&pos));
                    self.push_entry(tesuu, &fork_path, key);
                    if status == ApplyStatus::Special {
                        break;
                    }
                }
                Err(e) => match self.policy {
                    BuildPolicy::Strict => {
                        let cursor = CursorLite {
                            tesuu,
                            fork_pointers: fork_path.clone(),
                        };
                        return Err(BuildError::Apply { cursor, source: e });
                    }
                    BuildPolicy::Loose => {
                        self.warns.push(BuildWarn {
                            cursor: CursorLite {
                                tesuu,
                                fork_pointers: fork_path.clone(),
                            },
                            message: e.to_string(),
                        });
                        break;
                    }
                },
            }
        }
        Ok(())
    }
}

/// 1つのJKFを全分岐込みで列挙して、局面キーと出現箇所を集める
///
/// - root( tesuu=0 ) も必ず入れる（開始局面）
/// - node_id はこの関数内で 0.. の連番で採番する
pub fn build_index_for_jkf(
    file_id: FileId,
    gen: Gen,
    jkf: &JsonKifuFormat,
    policy: BuildPolicy,
) -> Result<FileIndexBuild, BuildError> {
    let init_pos = initial_partial_position(jkf)?;
    // 初期局面だけはフル計算。ここから先は差分で進める
    let init_key = key_from_partial_position(&init_pos);

    let mut b = IndexBuilder::new(file_id, gen, policy);

    // root
    b.push_entry(0, &[], init_key);

    if jkf.moves.len() > 1 {
        b.walk_sequence(&jkf.moves[1..], 1, init_pos, init_key, vec![])?;
    }

    Ok(b.finish())
}

#[inline]
fn node_action(node: &MoveFormat) -> NodeAction {
    if let Some(m) = node.move_ {
        NodeAction::Move(m)
    } else if let Some(s) = node.special {
        NodeAction::Special(s)
    } else {
        NodeAction::None
    }
}

#[inline]
fn push_or_replace_fork(fps: &mut Vec<ForkPointer>, te: u32, fork_index: u32) {
    if let Some(pos) = fps.iter().position(|p| p.te == te) {
        fps[pos].fork_index = fork_index;
    } else {
        fps.push(ForkPointer { te, fork_index });
    }
    fps.sort_by_key(|p| p.te);
}

/// 1 ファイル分の entries を bucket に振り分け、`(z0, z1)` で stable sort する。
///
/// 同一ファイル内では `file_id` は一定、`node_id` も push 順 = 既にソート済みなので
/// tie-break は不要 (stable sort で挿入順が保たれる)。
pub fn bucketize_entries(
    entries: Vec<(PositionKey, Occurrence)>,
) -> [Vec<(PositionKey, Occurrence)>; 256] {
    let mut buckets: [Vec<(PositionKey, Occurrence)>; 256] = std::array::from_fn(|_| Vec::new());

    for e in entries {
        buckets[e.0.bucket() as usize].push(e);
    }

    for b in &mut buckets {
        b.sort_by_key(|(k, _)| (k.z0, k.z1));
    }

    buckets
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_support::kifu::one_move_kif;

    /// 警告の手数が、指せなかった手そのものを指す。
    ///
    /// `tesuu` の起点は `walk_sequence(&moves[1..], 1, ..)` で決まっていて、
    /// 1手目が `tesuu = 1`。**足すと索引に入っていない1つ先を名指しする**
    /// （打ち切るので、その手より先は入らない）。
    /// 検索結果の `手数` 表示も `tesuu` を素で描くので、ずらすと数え方が2つになる。
    #[test]
    fn the_warning_names_the_move_that_could_not_be_played() {
        let warn = BuildWarn {
            cursor: CursorLite {
                tesuu: 30,
                fork_pointers: vec![],
            },
            message: "side-to-move mismatch".to_owned(),
        };
        let message = warn.to_user_message();

        assert!(
            message.contains("30手目"),
            "指せなかった手そのものを言っていない: {message}"
        );
        // 変化でないなら本譜と言う。同じ手数で2件出たときに区別が付く
        assert!(
            message.contains("本譜"),
            "どの手順かを言っていない: {message}"
        );
        // 内部の理由は出さない。`WorkspaceTab` は素のテキストで描く
        assert!(
            !message.contains("side-to-move"),
            "内部の理由が画面に出る: {message}"
        );
        // 場所だけ言って終わらない。`EVT_INDEX_WARN` に載る他の文言と揃える
        assert!(
            message.contains("ください"),
            "次に何をすればよいかが無い: {message}"
        );
    }

    /// `Loose` でも開始局面の失敗は返る。**そのときの文言も利用者の言葉であること。**
    ///
    /// `build_index_for_jkf` は `initial_partial_position` を `policy` より前で
    /// 呼ぶので、`Loose` はこの失敗を受け止めない。`.jkf` は外部の JSON を
    /// そのまま信じ、`says_nothing` も `preset != PresetHirate` を通すので、
    /// **`{"initial":{"preset":"OTHER"}}` だけでここへ届く**。
    ///
    /// `BuildError` の `Display` は呼び手の `map_err(|e| e.to_string())` を通って
    /// `EVT_INDEX_WARN` に素のテキストで出る（`api.rs` / `project_manager.rs`）。
    #[test]
    fn a_jkf_without_an_initial_board_fails_in_the_users_words() {
        // `preset: OTHER` は「盤面を書く」の意味なのに `data` が無い
        let jkf: JsonKifuFormat =
            serde_json::from_str(r#"{"header":{},"initial":{"preset":"OTHER"},"moves":[{}]}"#)
                .expect("題材の JKF が読めること");

        let err = build_index_for_jkf(1, 1, &jkf, BuildPolicy::Loose)
            .expect_err("開始局面が組めない棋譜が通った");
        let message = err.to_string();

        assert!(
            !message.starts_with("failed to"),
            "内部の英語がそのまま画面に出る: {message}"
        );
        assert!(
            message.contains("検索に出ません"),
            "何を失ったかを言っていない: {message}"
        );
        assert!(
            message.contains("ください"),
            "次に何をすればよいかが無い: {message}"
        );
    }

    /// 変化の中の変化では、**一番内側の分岐点**を名指す。
    ///
    /// `fork_pointers` は外側から並ぶので、先頭を見ると
    /// 「10手目から分かれた変化」と言ってしまう。打ち切られた手が乗っているのは
    /// **20手目から分かれた線**で、利用者が開くべきはそちら。
    ///
    /// 番号は `branchLabel`（`entities/kifu/model/branch.ts`）に合わせて
    /// `fork_index + 1`。画面が「変化2」と描いているものを
    /// ここが「変化1」と呼ぶと、名前で突き合わせられない。
    #[test]
    fn the_warning_names_the_innermost_variation() {
        let warn = BuildWarn {
            cursor: CursorLite {
                tesuu: 25,
                fork_pointers: vec![
                    ForkPointer {
                        te: 10,
                        fork_index: 0,
                    },
                    ForkPointer {
                        te: 20,
                        fork_index: 1,
                    },
                ],
            },
            message: "side-to-move mismatch".to_owned(),
        };
        let message = warn.to_user_message();

        assert!(
            message.contains("20手目から分かれた変化2"),
            "一番内側の分岐点を言っていない: {message}"
        );
        assert!(
            !message.contains("10手目"),
            "外側の分岐点で利用者を別の場所へ送っている: {message}"
        );
        assert!(
            message.contains("25手目"),
            "指せなかった手を言っていない: {message}"
        );
    }

    /// **組み立てから警告までを1本の題材で繋ぐ。**
    ///
    /// [`BuildWarn::to_user_message`] を見る他のテストは `CursorLite` を手で組むので、
    /// **`BuildWarn` を作る行（`walk_sequence` の `Loose` の腕）を通らない**。
    /// そこを `tesuu + 1` に書き換えると他は緑のまま文言だけがずれるので、
    /// 実際に指せない手を通して番号を見る。
    ///
    /// 題材は先手の1手目を2回並べる。断るのは `make_move` ではなく
    /// **`apply_node_action` の手番の照合**で、盤に触る前に返る
    /// （`position_apply.rs` の `SideToMoveMismatch`）。
    /// 2手目は先手の手なのに、そこでの手番は後手。
    #[test]
    fn the_warning_names_the_move_the_builder_stopped_at() {
        use shogi_kifu_converter_obsshogi::parser::parse_kif_str;

        let one = parse_kif_str(&one_move_kif("平手")).expect("題材の KIF が読めること");
        let mut jkf = one.clone();
        // 1手目をもう1度繰り返す。7七の歩はもう居ないので2手目で必ず失敗する
        jkf.moves.push(one.moves[1].clone());

        let built =
            build_index_for_jkf(1, 1, &jkf, BuildPolicy::Loose).expect("Loose は Err にしない");

        assert_eq!(built.warns.len(), 1, "警告が1件でない: {:?}", built.warns);
        assert_eq!(
            built.warns[0].cursor.tesuu, 2,
            "指せなかったのは2手目なのに {} と言っている",
            built.warns[0].cursor.tesuu
        );
        assert!(
            built.warns[0].to_user_message().contains("2手目"),
            "文言が2手目を指していない: {}",
            built.warns[0].to_user_message()
        );
        // 断った理由を固定する。題材を変えて別の理由で落ちるようになると、
        // 上の doc が指している経路を通らないまま緑になる
        assert!(
            built.warns[0].message.contains("side-to-move"),
            "手番の照合で断っていない: {}",
            built.warns[0].message
        );
        // 指せなかった手は索引に入らない。入るのは初期局面と1手目だけ
        let tesuu: Vec<u32> = built.node_table.nodes.iter().map(|n| n.tesuu).collect();
        assert!(
            !tesuu.contains(&2),
            "指せなかった手が索引に入っている: {tesuu:?}"
        );
    }

    /// `tesuu` の起点を、組み立ての側から固定する。
    ///
    /// `to_user_message` だけを見る2本（`the_warning_names_the_move_that_could_not_be_played`
    /// と `the_warning_names_the_innermost_variation`）は `CursorLite` を手で組むので、
    /// **`walk_sequence` が起点を変えても緑のまま**になる。
    ///
    /// `the_warning_names_the_move_the_builder_stopped_at` も組み立てを通るが、
    /// **あちらが見るのは指せなかった手の番号**。成功した手が `tesuu = 1` から
    /// 始まることは見ていない（打ち切った先は索引に入らないので、見ようがない）。
    /// 1手指した棋譜を最後まで組んで、入った側の起点を見る。
    #[test]
    fn the_first_move_is_tesuu_one() {
        let jkf = shogi_kifu_converter_obsshogi::parser::parse_kif_str(&one_move_kif("平手"))
            .expect("題材の KIF が読めること");
        let built =
            build_index_for_jkf(1, 1, &jkf, BuildPolicy::Loose).expect("1手の棋譜が組めること");

        let tesuu: Vec<u32> = built.node_table.nodes.iter().map(|n| n.tesuu).collect();
        assert!(
            tesuu.contains(&0) && tesuu.contains(&1),
            "初期局面が 0、1手目が 1 になっていない: {tesuu:?}"
        );
    }
}
