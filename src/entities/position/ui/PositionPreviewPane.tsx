import { useEffect, useRef, useState } from "react";
import BoardPreview from "./BoardPreview";
import { Color } from "shogi.js";
import { GOTE_LABEL, SENTE_LABEL, turnBadgeText } from "@/shared/lib/turn";
import "./PositionPreviewPane.scss";
import HandRow from "./HandRow";
import type { PreviewData } from "@/entities/position/model/preview";
import { boardSideForFrame } from "@/entities/position/lib/boardSide";

type Props = {
  previewData: PreviewData | null;
};

function PreviewPane({ previewData }: Props) {
  const boardWrapRef = useRef<HTMLDivElement>(null);
  const [boardSize, setBoardSize] = useState(320);

  useEffect(() => {
    const el = boardWrapRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;

      const style = getComputedStyle(el);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);

      setBoardSize(boardSideForFrame(rect, { x: padX, y: padY }));
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!previewData) {
    return (
      <div className="position-navigation-modal__preview-container">
        <div className="position-navigation-modal__board-preview">
          <div className="board-preview-placeholder">
            <p>局面を読み込み中...</p>
          </div>
        </div>
      </div>
    );
  }

  const hands = (previewData.hands ?? []) as {
    [Color.Black]: string[];
    [Color.White]: string[];
  };

  return (
    <div className="position-navigation-modal__preview-container">
      <div className="position-navigation-modal__board-preview" ref={boardWrapRef}>
        {/*
          **手番はこの部品が出す。** 盤の絵には現れない値で、並んでいる駒からは
          初形からの偶奇を追わないと分からない（局面だけを渡されるこの面では追えない）。
          呼び手それぞれが横に添える形だと、添え忘れた面だけが手番の分からない盤になる。

          **段を作らず枠の上に浮かせる。** 盤の一辺はこの枠の内寸から決まるので、
          段を1つ足すとその高さのぶん盤が縮む（呼び手によっては測る軸が縦横で
          入れ替わり、縮む面と広がる面に分かれる）。浮かせれば内寸が動かない
        */}
        <div className="position-navigation-modal__turn-badge">
          {turnBadgeText(previewData.turn)}
        </div>

        <BoardPreview
          pieces={previewData.board}
          hands={hands}
          size={boardSize}
          showCoordinates={false}
          showLastMove={false}
          showHands={false}
          interactive={false}
        />
      </div>

      <div className="position-navigation-modal__hands">
        <HandRow label={SENTE_LABEL} kinds={hands[Color.Black] || []} />
        <HandRow label={GOTE_LABEL} kinds={hands[Color.White] || []} />
      </div>
    </div>
  );
}

export default PreviewPane;
