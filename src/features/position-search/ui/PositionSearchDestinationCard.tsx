import "./PositionSearchDestinationCard.scss";
import { useAppConfig } from "@/entities/app-config";
import { toRelPath } from "@/shared/lib/path";
import SoftBreakText from "@/shared/ui/SoftBreakText";

type Props = {
  currentAbsPath: string | null;
  destAbsPath: string | null;
};

export default function PositionSearchDestinationCard({ currentAbsPath, destAbsPath }: Props) {
  const { config } = useAppConfig();
  const rootDir = config?.root_dir ?? null;

  const currentRel = currentAbsPath ? toRelPath(currentAbsPath, rootDir) : null;
  const destRel = destAbsPath ? toRelPath(destAbsPath, rootDir) : null;

  return (
    <dl className="pos-search-dest" aria-label="選択中の棋譜">
      <dt className="pos-search-dest__label">選択中</dt>
      <dd className="pos-search-dest__path" title={destRel ?? undefined}>
        {destRel ? <SoftBreakText text={destRel} /> : "未選択"}
      </dd>

      <dt className="pos-search-dest__label">現在</dt>
      <dd className="pos-search-dest__current" title={currentRel ?? undefined}>
        {currentRel ? <SoftBreakText text={currentRel} /> : "—"}
      </dd>
    </dl>
  );
}
