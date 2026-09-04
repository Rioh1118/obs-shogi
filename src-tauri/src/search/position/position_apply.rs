//! 棋譜のノードを1つ受けて、盤を1手ぶん進める。
//!
//! **JKF から `shogi_core` への変換は自前で書かない。** クレートが
//! `Color` / `Kind` / `PlaceFormat` / `MoveMoveFormat` の変換を全部持っている。
//! 二重に書くと、ずれても症状が「検索が当たらない」だけで表に出ない
//! （同じ理由は `super::initial_position` の doc にも書いてある）。

use thiserror::Error;

use shogi_core::{Color as CoreColor, Move as CoreMove, PartialPosition, PieceKind};
use shogi_kifu_converter_obsshogi::{error::ConvertError, jkf::MoveMoveFormat};

use crate::search::position::traverse::NodeAction;

/// ノードを1つ食べた結果、**走査を続けてよいか**。
///
/// 盤の状態は見ていない。[`NodeAction`] の種類をそのまま写している。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyStatus {
    /// 1手進んだ
    Applied,
    /// 手を持たないノードだった。局面は動かない
    ///
    /// JKF の `moves[0]` は初期局面を表すので手を持たない。
    NoMove,
    /// 特殊手を見た。**この線の記録はここで止まる。**
    ///
    /// 対局が終わったとは限らない。投了や詰みだけでなく、中断・待った・
    /// 不詰も同じ腕に来る。走査を止めてよい、という意味しか持たない。
    Special,
}

#[derive(Debug, Error)]
pub enum ApplyError {
    /// JKF の手を `shogi_core` の手にできない。
    ///
    /// 実際に来るのは升が盤の外にある形。`PlaceFormat` の `x` / `y` は `u8` を
    /// そのまま持つので、`.jkf` が `{"x":0,"y":0}` を名乗れる。
    #[error("cannot read the move: {0}")]
    Convert(#[from] ConvertError),

    /// 成駒を打とうとしている。
    ///
    /// `make_move` も弾くので通ることはないが、`ApplyFailed` に混ぜると
    /// 「指せない手」としか読めなくなる。**理由を残すためだけに先に弾く。**
    #[error("drop with promoted kind is not allowed: {0:?}")]
    PromotedDropNotAllowed(PieceKind),

    /// 手の指し手と盤の手番が食い違う。**盤に触る前に返る。**
    ///
    /// 棋譜の手数と手番がずれている（手を1つ落としている等）と、
    /// 以降の手は全部この形になる。
    #[error("side-to-move mismatch: pos={pos:?}, mv={mv:?}")]
    SideToMoveMismatch { pos: CoreColor, mv: CoreColor },

    /// 盤の上で指せない手だった。
    ///
    /// 動かす駒がいない、動けない先へ動かす、といった形。
    /// `make_move` は理由を返さないので、こちらも持てない。
    #[error("cannot apply move")]
    ApplyFailed,
}

/// ノードを1つ食べて `pos` を進める。
///
/// **進むのは `Move` のノードだけ。** 他の2つは局面を動かさず、
/// 走査を続けてよいかだけを返す。
///
/// 失敗しても `pos` は動いていない。手番の照合は盤に触る前に済ませ、
/// 実際に指すのは最後の一手だけなので、途中で返ると盤は元のまま。
pub fn apply_node_action(
    pos: &mut PartialPosition,
    action: NodeAction,
) -> Result<ApplyStatus, ApplyError> {
    match action {
        NodeAction::Move(m) => {
            let mv_color = CoreColor::from(m.color);
            let pos_color = pos.side_to_move();

            if mv_color != pos_color {
                return Err(ApplyError::SideToMoveMismatch {
                    pos: pos_color,
                    mv: mv_color,
                });
            }

            let mv = jkf_move_to_core_move(m)?;
            pos.make_move(mv).ok_or(ApplyError::ApplyFailed)?;
            Ok(ApplyStatus::Applied)
        }
        NodeAction::Special(_sp) => Ok(ApplyStatus::Special),
        NodeAction::None => Ok(ApplyStatus::NoMove),
    }
}

/// JKF の指し手を `shogi_core` の指し手にする。
///
/// **盤を進める側と鍵を進める側が、同じ1本を通るために公開している。**
/// `index/index_builder.rs` は同じ手で [`apply_node_action`] と
/// `position_key::advance_key` の両方を呼ぶ。別々に組み直すと、組み直しの
/// 誤りが「局面は進んだが鍵は別の手で進んだ」という形で静かに入る。
pub(crate) fn jkf_move_to_core_move(m: MoveMoveFormat) -> Result<CoreMove, ApplyError> {
    let mv = CoreMove::try_from(&m)?;

    // 成駒の打ちだけは、クレートが素通しして `make_move` が弾く。
    // 理由を残すためにここで見る。成駒かどうかは core 自身に聞く
    if let CoreMove::Drop { piece, .. } = mv {
        if piece.unpromote().is_some() {
            return Err(ApplyError::PromotedDropNotAllowed(piece.piece_kind()));
        }
    }

    Ok(mv)
}
