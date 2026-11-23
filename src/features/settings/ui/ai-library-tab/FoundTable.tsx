import type { AiFolderSummary } from "@/features/settings/lib/aiLibraryContents";
import SoftBreakText from "@/shared/ui/SoftBreakText";
import SettingsBadge from "../kit/SettingsBadge";

type Props = {
  engineNames: string[];
  profiles: AiFolderSummary[];
};

/** 読み込んで見つかったもの。エンジンと AI フォルダを1行ずつ */
export function FoundTable({ engineNames, profiles }: Props) {
  if (engineNames.length === 0 && profiles.length === 0) return null;

  return (
    <table className="setupGuide__found">
      <tbody>
        {engineNames.map((name, i) => (
          <tr key={name}>
            <th scope="row">{i === 0 ? "エンジン" : ""}</th>
            <td colSpan={2}>
              <SoftBreakText text={name} />
            </td>
          </tr>
        ))}
        {profiles.map((profile, i) => (
          <tr key={profile.path}>
            <th scope="row">{i === 0 ? "検出されたAI" : ""}</th>
            <td title={profile.path}>
              <SoftBreakText text={profile.name} />
            </td>
            <td className="setupGuide__foundHas">
              <SettingsBadge tone={profile.hasEval ? "accent" : "warn"}>
                評価関数 {profile.hasEval ? "あり" : "不足"}
              </SettingsBadge>
              {/* 定跡は任意。無くても注意の色にしない */}
              <SettingsBadge tone={profile.hasBook ? "accent" : "muted"}>
                定跡 {profile.hasBook ? "あり" : "未設定"}
              </SettingsBadge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
