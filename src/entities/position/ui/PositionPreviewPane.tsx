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

function LoadedPreview({ previewData }: { previewData: PreviewData }) {
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

  return (
    <div className="position-preview__container">
      <div className="position-preview__frame" ref={boardWrapRef}>
        {/*
          **手番はこの部品が出す。** 盤の絵には現れない値で、並んでいる駒からは
          初形からの偶奇を追わないと分からない（局面だけを渡されるこの面では追えない）。
          呼び手それぞれが横に添える形だと、添え忘れた面だけが手番の分からない盤になる。

          **段を作らず枠の角に重ねる。** 盤の一辺はこの枠の内寸から決まるので、
          段を1つ足すとその高さのぶん盤が縮む（呼び手によっては測る軸が縦横で
          入れ替わり、縮む面と広がる面に分かれる）。重ねれば内寸が動かない
        */}
        <div className="position-preview__turn-tab">{turnBadgeText(previewData.turn)}</div>

        <BoardPreview pieces={previewData.board} size={boardSize} />
      </div>

      <div className="position-preview__hands">
        <HandRow label={SENTE_LABEL} kinds={previewData.hands[Color.Black]} />
        <HandRow label={GOTE_LABEL} kinds={previewData.hands[Color.White]} />
      </div>
    </div>
  );
}

/**
 * 局面のプレビュー
 *
 * 枠を測る effect は、枠に `ref` が付いた状態で mount する `LoadedPreview` に置く。
 * ここへ置くと、局面が無いまま mount したときに測る先が無く、盤が初期値のまま残る。
 */
function PositionPreviewPane({ previewData }: Props) {
  if (!previewData) {
    return (
      <div className="position-preview__container">
        <div className="position-preview__frame">
          <div className="board-preview-placeholder">
            <p>局面を読み込み中…</p>
          </div>
        </div>
      </div>
    );
  }

  return <LoadedPreview previewData={previewData} />;
}

export default PositionPreviewPane;
