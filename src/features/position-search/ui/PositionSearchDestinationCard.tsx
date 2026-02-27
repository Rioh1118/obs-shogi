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

  const mode: "none" | "same" | "switch" = useMemo(() => {
    if (!destAbsPath) return "none";
    if (currentAbsPath && destAbsPath === currentAbsPath) return "same";
    return "switch";
  }, [destAbsPath, currentAbsPath]);

  const currentRel = useMemo(() => {
    if (!currentAbsPath) return null;
    return toRelPath(currentAbsPath, rootDir);
  }, [currentAbsPath, rootDir]);

  const destRel = useMemo(() => {
    if (!destAbsPath) return null;
    return toRelPath(destAbsPath, rootDir);
  }, [destAbsPath, rootDir]);

  return (
    <div className="pos-search-dest">
      <div className="pos-search-dest__head">
        <div className="pos-search-dest__title">移動先</div>

        {mode !== "none" && (
          <span
            className={[
              "pos-search-dest__badge",
              mode === "switch" ? "is-switch" : "is-same",
            ].join(" ")}
          >
            {mode === "switch" ? "切替" : "同一"}
          </span>
        )}
      </div>

      {mode === "none" ? (
        <div className="pos-search-dest__empty">候補がありません</div>
      ) : (
        <>
          <div className="pos-search-dest__path">{destRel}</div>

          <div className="pos-search-dest__current">
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
