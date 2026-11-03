import {
  canCreateEnginesDir,
  classifyEnginesDir,
  type EnginesDir,
} from "@/entities/engine/lib/enginesDir";
import type { AiRootIndexState } from "@/features/settings/model/useAiRootIndex";
import Button from "@/shared/ui/Button/Button";
import RescanButton from "./RescanButton";

/** `engines` の帯の文言。`null` は帯を出さない。 */
const ENGINES_DIR_HINT: Record<EnginesDir, ((path: string) => string) | null> = {
  unknown: null,
  dir: null,
  missing: (path) => `engines/ フォルダがありません（${path}）。`,
  other: (path) =>
    `engines がフォルダではありません（${path}）。同じ名前のものを削除してください。`,
};

/** `engines` が使えないときに、理由と直す操作を出す帯。 */
export default function EnginesDirBand({ library }: { library: AiRootIndexState }) {
  const { index, scan, rescan, createEnginesDir } = library;
  const dir = classifyEnginesDir(index?.engines_dir);
  const hint = ENGINES_DIR_HINT[dir];
  if (!hint) return null;

  const loading = scan.status === "loading";

  return (
    <div className="presetDialog__hintWarn">
      {hint(index?.engines_dir.path ?? "")}
      <div className="presetDialog__bandActions">
        {/* 帯の文言は読み直しの間も前の索引のままなので、押せると効かなかったと読まれる */}
        {canCreateEnginesDir(dir) && (
          <Button tone="accent" size="sm" onClick={createEnginesDir} disabled={loading}>
            フォルダを作成
          </Button>
        )}
        <RescanButton loading={loading} onClick={rescan} />
      </div>
    </div>
  );
}
