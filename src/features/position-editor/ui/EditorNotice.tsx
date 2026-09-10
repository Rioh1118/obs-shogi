import InlineNotice from "@/shared/ui/notification/InlineNotice";
import type { PositionIssue } from "@/entities/position/lib/inspectPosition";

interface EditorNoticeProps {
  issues: PositionIssue[];
}

/**
 * 規則に反する配置の断り
 *
 * **止めない。通す。** 「作成」は押せるまま。押せなくすると詰将棋が作れない
 * （攻め方の玉が無い形は、王手放置の検査に掛からないだけで玉の枚数としては
 * 規則から外れている）。研究のために規則から外れた局面を組むこともある。
 *
 * 段は `danger`（ADR-0004 決定1）—— どれも同じ操作を繰り返しても直らず、
 * 直し方は配置ごとに違う。**ボタンは付けない**（同 決定3 の F-12b と同じで、
 * 押して直るものが無い）。
 *
 * 置き場は右の列の一番上。盤の右隣の上端で、枠を付けた升との距離が最短になる。
 * 高さが変わってもフォームが下がるだけで**盤は動かない**。
 */
function EditorNotice({ issues }: EditorNoticeProps) {
  if (issues.length === 0) return null;

  return (
    <InlineNotice
      tier="danger"
      title="規則に反する配置があります。"
      // 「対局には使えません」と書かない。用途を決めつける（研究のために組むことはある）
      body={issues.map((issue) => `・${issue.message}`).join("\n")}
    />
  );
}

export default EditorNotice;
