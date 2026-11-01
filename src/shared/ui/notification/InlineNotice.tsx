import Notice, { type NoticeProps } from "./Notice";
import "./InlineNotice.scss";

export type InlineNoticeProps = Omit<NoticeProps, "count" | "className" | "onDismiss">;

/**
 * 通知基盤を通らない経路（ADR-0004 決定4）。
 *
 * 置き場が部品の中にあるので、基盤からは描けない。共通なのは段と動作だけで、位置は置く側が決める。
 *
 * 画面隅のトーストに出さないのは、利用者が対処できる場所に出すため。
 * 保存モーダルの失敗を隅に出すと、直すべき入力から目が離れる。
 *
 * **閉じる手段を型から落としてある。** 出ている間はその場所の状態が直っていないので、
 * 消えるのは置いた側が置くのをやめたとき。
 */
export default function InlineNotice(props: InlineNoticeProps) {
  return <Notice {...props} className="notice--inline" />;
}
