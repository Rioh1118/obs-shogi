import { useEffect, useRef, useState } from "react";
import BoardPreview from "./BoardPreview";
import { Color } from "shogi.js";
import { GOTE_LABEL, SENTE_LABEL, turnGlyph, turnText } from "@/shared/lib/turn";
import "./PositionPreviewPane.scss";
import HandRow from "./HandRow";
import type { PreviewData } from "@/entities/position/model/preview";

type Props = {
  previewData: PreviewData | null;
};
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

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
      const usable = Math.floor(Math.min(rect.width - padX, rect.height - padY));

      const next = clamp(usable, 240, 820);
      setBoardSize(next);
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!previewData) {
    return (
      <div className="position-navigation-modal__preview-container">
        {/* 手番の段が無い枠。読み込み中の一文を、盤が入る位置の中央に置く */}
        <div className="position-navigation-modal__board-preview position-navigation-modal__board-preview--empty">
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
      <div className="position-navigation-modal__board-preview">
        {/*
          **手番はこの部品が出す。** 盤の絵には現れない値で、並んでいる駒からは
          初形からの偶奇を追わないと分からない（局面だけを渡されるこの面では追えない）。
          呼び手それぞれが横に添える形だと、添え忘れた面だけが手番の分からない盤になる。

          記号を語に添える（`turnGlyph`）—— 下の持ち駒の段が見出しに同じ記号を持つので、
          字が揃っていないと、どちらの段を指しているのかを読み手が対応付け直すことになる
        */}
        <div className="position-navigation-modal__turn-badge">
          {turnGlyph(previewData.turn)}
          {turnText(previewData.turn)}
        </div>

        {/*
          **測るのは盤に配る枠だけ。** 枠そのものを測ると、同じ枠の中にあるバッジの
          高さが引かれないまま一辺が決まり、盤が枠の下端からはみ出す
        */}
        <div className="position-navigation-modal__board-fit" ref={boardWrapRef}>
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
      </div>

      <div className="position-navigation-modal__hands">
        <HandRow label={SENTE_LABEL} kinds={hands[Color.Black] || []} />
        <HandRow label={GOTE_LABEL} kinds={hands[Color.White] || []} />
      </div>
    </div>
  );
}

export default PreviewPane;
