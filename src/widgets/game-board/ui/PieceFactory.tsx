import { PIECE_TYPES, convertJkfPiece } from "@/entities/position/model/shogi";
import {
  type PieceProps,
  Pawn,
  Lance,
  Knight,
  Silver,
  Gold,
  Bishop,
  Rook,
  King,
  PromPawn,
  PromLance,
  PromKnight,
  PromSilver,
  Horse,
  Dragon,
} from "./pieces";

interface PieceFactoryProps extends PieceProps {
  jkfKind: string;
  isPromoted?: boolean;
}

function PieceFactory({
  jkfKind,
  color,
  isPromoted = false,
  onClick,
}: PieceFactoryProps) {
  const pieceType = convertJkfPiece(jkfKind, isPromoted);

  const commonProps: PieceProps = { color, onClick };

  switch (pieceType) {
    case PIECE_TYPES.PAWN:
      return <Pawn {...commonProps} />;
    case PIECE_TYPES.LANCE:
      return <Lance {...commonProps} />;
    case PIECE_TYPES.KNIGHT:
      return <Knight {...commonProps} />;
    case PIECE_TYPES.SILVER:
      return <Silver {...commonProps} />;
    case PIECE_TYPES.GOLD:
      return <Gold {...commonProps} />;
    case PIECE_TYPES.BISHOP:
      return <Bishop {...commonProps} />;
    case PIECE_TYPES.ROOK:
      return <Rook {...commonProps} />;
    case PIECE_TYPES.KING:
      return <King {...commonProps} />;
    case PIECE_TYPES.PROM_PAWN:
      return <PromPawn {...commonProps} />;
    case PIECE_TYPES.PROM_LANCE:
      return <PromLance {...commonProps} />;
    case PIECE_TYPES.PROM_KNIGHT:
      return <PromKnight {...commonProps} />;
    case PIECE_TYPES.PROM_SILVER:
      return <PromSilver {...commonProps} />;
    case PIECE_TYPES.HORSE:
      return <Horse {...commonProps} />;
    case PIECE_TYPES.DRAGON:
      return <Dragon {...commonProps} />;
    default:
      return null;
  }
}

export default PieceFactory;
