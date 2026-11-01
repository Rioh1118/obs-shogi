import { Color, type Kind } from "shogi.js";
import { PIECE_IMAGES } from "@/entities/position/model/pieceImages";
import "./Piece.scss";

type PieceLook = {
  /** `Piece.scss` のクラス `piece__<name>` と `data-piece` の値 */
  name: string;
  alt: string;
};

const PIECE_LOOKS: Record<Kind, PieceLook> = {
  FU: { name: "pawn", alt: "歩" },
  KY: { name: "lance", alt: "香" },
  KE: { name: "knight", alt: "桂馬" },
  GI: { name: "silver", alt: "銀" },
  KI: { name: "gold", alt: "金" },
  KA: { name: "bishop", alt: "角" },
  HI: { name: "rook", alt: "飛" },
  OU: { name: "king", alt: "玉" },
  TO: { name: "prom-pawn", alt: "と" },
  NY: { name: "prom-lance", alt: "成香" },
  NK: { name: "prom-knight", alt: "成桂" },
  NG: { name: "prom-silver", alt: "成銀" },
  UM: { name: "horse", alt: "馬" },
  RY: { name: "dragon", alt: "龍" },
};

type Props = {
  /** 駒台と成りの選択は駒を素の文字列で運ぶので `string` で受ける。知らない駒は描かない */
  kind: string;
  color: Color;
  onClick?: () => void;
};

function isKnownKind(kind: string): kind is Kind {
  return Object.prototype.hasOwnProperty.call(PIECE_LOOKS, kind);
}

function PieceImage({ kind, color, onClick }: Props) {
  if (!isKnownKind(kind)) return null;

  const { name, alt } = PIECE_LOOKS[kind];
  const isSente = color === Color.Black;

  return (
    <div
      className={`piece piece__${name} ${isSente ? "sente" : "gote"}`}
      onClick={onClick}
      data-piece={name}
      data-color={color}
    >
      <img
        src={PIECE_IMAGES[color][kind]}
        alt={kind === "OU" && isSente ? "王" : alt}
        className="piece-image"
        draggable={false}
      />
    </div>
  );
}

export default PieceImage;
