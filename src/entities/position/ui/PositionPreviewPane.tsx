import { Color } from "shogi.js";
import { GOTE_LABEL, SENTE_LABEL, turnBadgeText } from "@/shared/lib/turn";
import type { PreviewData } from "@/entities/position/model/preview";
import BoardPreview from "./BoardPreview";
import HandRow from "./HandRow";
import "./PositionPreviewPane.scss";

type Props = {
  previewData: PreviewData | null;
};

/**
 * 局面のプレビュー。**呼び手が高さを決める** —— 盤は、渡された高さと幅に収まる最大の大きさになる。
 *
 * 手番はこの部品が出す。盤の絵には現れない値で、局面だけを渡されるこの部品では
 * 初形からの偶奇を追えない。呼び手が添える形だと、添え忘れた画面だけ手番が分からなくなる。
 *
 * 局面が無いあいだも、手番と持ち駒の行は空のまま残す。消すと、局面が届くたびに盤の大きさが変わる。
 */
function PositionPreviewPane({ previewData }: Props) {
  return (
    <div className="position-preview">
      <div className="position-preview__stack">
        <p className="position-preview__turn">{previewData && turnBadgeText(previewData.turn)}</p>

        <div className="position-preview__board">
          {previewData ? (
            <BoardPreview pieces={previewData.board} />
          ) : (
            <p className="position-preview__wait">局面を読み込み中…</p>
          )}
        </div>

        <div className="position-preview__hands">
          {previewData && (
            <>
              <HandRow label={SENTE_LABEL} kinds={previewData.hands[Color.Black]} />
              <HandRow label={GOTE_LABEL} kinds={previewData.hands[Color.White]} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default PositionPreviewPane;
