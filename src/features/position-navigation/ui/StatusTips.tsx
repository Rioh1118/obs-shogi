import type { PreviewData } from "@/entities/position/model/preview";
import { branchLabel, type BranchOption } from "@/entities/kifu/model/branch";
import "./StatusTips.scss";

type Props = {
  previewData: PreviewData | null;
  /** 選択中の分岐。表示順の添字ではなく option を渡す（番号の出どころを1つにするため）。 */
  selectedBranch: BranchOption | undefined;
};

export default function StatusTips({ previewData, selectedBranch }: Props) {
  const tesuu = previewData?.tesuu ?? 0;
  const sel = selectedBranch ? branchLabel(selectedBranch.forkIndex) : "—";

  // **手番はここに出さない。** 同じ器の中で盤のプレビュー（`PositionPreviewPane`）が
  // 出しており、2箇所に置くと綴りが割れる（この段は先後の記号を持たない）
  return (
    <div className="position-navigation-modal__status-tips" aria-label="局面ステータス">
      <span className="position-navigation-modal__chip">{tesuu}手目</span>
      <span className="position-navigation-modal__chip position-navigation-modal__chip--accent">
        選択:{sel}
      </span>
    </div>
  );
}
