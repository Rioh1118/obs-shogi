import type { EnginesDir } from "@/entities/ai-library/lib/enginesDir";
import type { AiLibraryContents } from "@/features/settings/lib/aiLibraryContents";
import { SStats } from "../kit";

/** 状態の名前。網羅の理由は `EnginesDir` の doc */
const ENGINES_DIR_LABEL: Record<EnginesDir, string> = {
  unknown: "—",
  missing: "なし",
  dir: "あり",
  other: "フォルダでない",
};

type Props = {
  hasRoot: boolean;
  contents: AiLibraryContents;
  canCreateProfile: boolean;
};

/** 0件のときの次の一手。読めていない間は言わない */
function aiFolderHint({ indexed, profiles }: AiLibraryContents, canCreateProfile: boolean) {
  if (!indexed || profiles.length > 0) return undefined;
  return canCreateProfile ? "下のフォームから作成できます" : "エンジンを置いた後に作成できます";
}

/** 読み込んだ結果の数。**読めていない間は、0件と言い切らない** */
export function SetupStatus({ hasRoot, contents, canCreateProfile }: Props) {
  const { indexed, enginesDir, engineNames, profiles } = contents;

  return (
    <SStats
      items={[
        { label: "AI ライブラリ", value: hasRoot ? "設定済み" : "未設定" },
        { label: "engines フォルダ", value: ENGINES_DIR_LABEL[enginesDir] },
        {
          label: "エンジン",
          value: indexed ? `${engineNames.length} 件` : "—",
          hint: indexed && engineNames.length === 0 ? "engines/ に置いてください" : undefined,
        },
        {
          label: "AI フォルダ",
          value: indexed ? `${profiles.length} 件` : "—",
          hint: aiFolderHint(contents, canCreateProfile),
        },
      ]}
    />
  );
}
