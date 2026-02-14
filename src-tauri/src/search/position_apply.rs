use thiserror::Error;

use shogi_core::{Color as CoreColor, Move as CoreMove, PartialPosition, Piece, PieceKind, Square};
use shogi_kifu_converter::jkf::{Color as JkfColor, Kind as JkfKind, MoveMoveFormat, PlaceFormat};

use super::traverse::NodeAction;

/// 「適用した結果、この先を辿ってよいか」を返すためのステータス
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyStatus {
    /// 通常の1手を適用した
    Applied,
    /// Noneノードなどで局面は変わらない
    Noop,
    /// special を見たのでこの系列は終端として扱う
    Terminal,
}

#[derive(Debug, Error)]
pub enum ApplyError {
    #[error("invalid square: x={x}, y={y}")]
    InvalidSquare { x: u8, y: u8 },

    #[error("unsupported piece kind in JKF: {0:?}")]
    UnsupportedKind(JkfKind),

    #[error("drop with promoted kind is not allowed: {0:?}")]
    PromotedDropNotAllowed(JkfKind),

    #[error("side-to-move mismatch: pos={pos:?}, mv={mv:?}")]
    SideToMoveMismatch { pos: CoreColor, mv: CoreColor },

    #[error("cannot apply move")]
    ApplyFailed,
}

pub fn apply_node_action(
    pos: &mut PartialPosition,
    action: NodeAction,
) -> Result<ApplyStatus, ApplyError> {
    match action {
        NodeAction::Move(m) => {
            let mv_color = to_core_color(m.color);
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
        NodeAction::Special(_sp) => Ok(ApplyStatus::Terminal),
        NodeAction::None => Ok(ApplyStatus::Noop),
    }
}

fn jkf_move_to_core_move(m: MoveMoveFormat) -> Result<CoreMove, ApplyError> {
    let to = to_square(m.to)?;

    if let Some(from) = m.from {
        let from = to_square(from)?;
        let promote = matches!(m.promote, Some(true));
        Ok(CoreMove::Normal { from, to, promote })
    } else {
        // 駒打ち：Move::Drop は piece_kind ではなく Piece を取る
        // shogi_core 側は「promoted piece の drop」を弾くので、ここでも先に弾くと分かりやすい
        if is_promoted_kind(m.piece) {
            return Err(ApplyError::PromotedDropNotAllowed(m.piece));
        }

        let pk = to_piece_kind(m.piece)?;
        let color = to_core_color(m.color);
        let piece = Piece::new(pk, color);
        Ok(CoreMove::Drop { piece, to })
    }
}

fn to_square(p: PlaceFormat) -> Result<Square, ApplyError> {
    Square::new(p.x, p.y).ok_or(ApplyError::InvalidSquare { x: p.x, y: p.y })
}

fn to_piece_kind(k: JkfKind) -> Result<PieceKind, ApplyError> {
    let pk = match k {
        JkfKind::FU => PieceKind::Pawn,
        JkfKind::KY => PieceKind::Lance,
        JkfKind::KE => PieceKind::Knight,
        JkfKind::GI => PieceKind::Silver,
        JkfKind::KI => PieceKind::Gold,
        JkfKind::KA => PieceKind::Bishop,
        JkfKind::HI => PieceKind::Rook,
        JkfKind::OU => PieceKind::King,
        JkfKind::TO => PieceKind::ProPawn,
        JkfKind::NY => PieceKind::ProLance,
        JkfKind::NK => PieceKind::ProKnight,
        JkfKind::NG => PieceKind::ProSilver,
        JkfKind::UM => PieceKind::ProBishop,
        JkfKind::RY => PieceKind::ProRook,
    };
    Ok(pk)
}

fn to_core_color(c: JkfColor) -> CoreColor {
    match c {
        JkfColor::Black => CoreColor::Black,
        JkfColor::White => CoreColor::White,
    }
}

fn is_promoted_kind(k: JkfKind) -> bool {
    matches!(
        k,
        JkfKind::TO | JkfKind::NY | JkfKind::NK | JkfKind::NG | JkfKind::UM | JkfKind::RY
    )
}
