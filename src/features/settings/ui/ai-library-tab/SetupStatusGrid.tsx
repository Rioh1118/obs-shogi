import type { ReactNode } from "react";
import { Bot, Database, FolderOpen, Wrench } from "lucide-react";

import type { EnginesDir } from "@/entities/engine/lib/enginesDir";
import type { AiLibraryContents } from "@/features/settings/lib/aiLibraryContents";

/** カードに出す状態の名前。網羅の理由は `EnginesDir` の doc */
const ENGINES_DIR_LABEL: Record<EnginesDir, string> = {
  unknown: "—",
  missing: "なし",
  dir: "あり",
  other: "フォルダでない",
};

const ENGINES_DIR_TONE: Record<EnginesDir, "ok" | "warn" | "todo"> = {
  unknown: "todo",
  missing: "warn",
  dir: "ok",
  other: "warn",
};

type Props = {
  hasRoot: boolean;
  /** カードに出す長さへ詰めたルート。ルートが無ければ空 */
  shortRoot: string;
  contents: AiLibraryContents;
  canCreateProfile: boolean;
};

function aiFolderHint({ indexed, profiles }: AiLibraryContents, canCreateProfile: boolean) {
  if (!indexed) return undefined;
  if (profiles.length > 0) return `評価関数あり ${profiles.filter((p) => p.hasEval).length} 件`;
  return canCreateProfile ? "下のフォームから作成できます" : "エンジンを置いた後に作成できます";
}

function countState(indexed: boolean, count: number) {
  if (!indexed) return "todo";
  return count > 0 ? "ok" : "warn";
}

function StatusCard({
  label,
  value,
  hint,
  icon,
  state,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: ReactNode;
  state: "ok" | "warn" | "todo";
}) {
  return (
    <div className="setupGuide__statusCard" data-state={state}>
      <div className="setupGuide__statusCardTop">
        {icon}
        <span className="setupGuide__statusCardLabel">{label}</span>
      </div>
      <div className="setupGuide__statusCardValue">{value}</div>
      {hint && <div className="setupGuide__statusCardHint">{hint}</div>}
    </div>
  );
}

export function SetupStatusGrid({ hasRoot, shortRoot, contents, canCreateProfile }: Props) {
  const { indexed, enginesDir, enginesDirPath, engineNames, profiles } = contents;
  const enginesCount = engineNames.length;

  return (
    <div className="setupGuide__statusGrid">
      <StatusCard
        label="AI ライブラリ"
        value={hasRoot ? "設定済み" : "未設定"}
        hint={shortRoot || undefined}
        icon={<FolderOpen size={13} />}
        state={hasRoot ? "ok" : "todo"}
      />
      <StatusCard
        label="engines フォルダ"
        value={ENGINES_DIR_LABEL[enginesDir]}
        hint={enginesDirPath}
        icon={<Wrench size={13} />}
        state={ENGINES_DIR_TONE[enginesDir]}
      />
      <StatusCard
        label="エンジン"
        value={indexed ? `${enginesCount} 件` : "—"}
        hint={!indexed ? undefined : enginesCount > 0 ? "検出済み" : "engines/ に置いてください"}
        icon={<Bot size={13} />}
        state={countState(indexed, enginesCount)}
      />
      <StatusCard
        label="AI フォルダ"
        value={indexed ? `${profiles.length} 件` : "—"}
        hint={aiFolderHint(contents, canCreateProfile)}
        icon={<Database size={13} />}
        state={countState(indexed, profiles.length)}
      />
    </div>
  );
}
