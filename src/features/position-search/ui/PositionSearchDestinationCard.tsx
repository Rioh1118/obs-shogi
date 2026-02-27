import "./PositionSearchDestinationCard.scss";
import { useMemo } from "react";
import { useAppConfig } from "@/entities/app-config";
import { toRelPath } from "@/shared/lib/path";

type Props = {
  currentAbsPath: string | null;
  destAbsPath: string | null;
};

export default function PositionSearchDestinationCard({
  currentAbsPath,
  destAbsPath,
}: Props) {
  const { config } = useAppConfig();
  const rootDir = config?.root_dir ?? null;

  const currentRel = useMemo(() => {
    if (!currentAbsPath) return null;
    return toRelPath(currentAbsPath, rootDir);
  }, [currentAbsPath, rootDir]);

  const destRel = useMemo(() => {
    if (!destAbsPath) return null;
    return toRelPath(destAbsPath, rootDir);
  }, [destAbsPath, rootDir]);

  const hasDest = !!destRel;

  return (
    <div className="pos-search-dest" aria-label="選択中の棋譜">
      <div className="pos-search-dest__head">
        <div className="pos-search-dest__title">選択中</div>
      </div>

      {!hasDest ? (
        <div className="pos-search-dest__empty">未選択</div>
      ) : (
        <>
          <div className="pos-search-dest__path" title={destRel}>
            {destRel}
          </div>

          <div className="pos-search-dest__current" title={currentRel ?? ""}>
            <span className="pos-search-dest__currentLabel">現在:</span>
            <span className="pos-search-dest__currentPath">
              {currentRel ?? "—"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
