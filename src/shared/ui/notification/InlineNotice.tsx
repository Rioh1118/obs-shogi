import Notice, { type NoticeProps } from "./Notice";
import "./InlineNotice.scss";

export type InlineNoticeProps = Omit<NoticeProps, "count" | "className">;

/**
 * 通知基盤を通らない経路（ADR-0004 決定4）。
 *
 * **置き場がコンポーネントの中にあるので、基盤からは描けない。**
 * 解析ペインの中・検索モーダルの中・設定タブの中・入力欄の下がここに来る。
 * 共通なのは段（色）と動作だけで、位置はこれを置く側が決める。
 *
 * **画面隅のトーストに出さない理由**は「利用者が対処できる場所」にある。
 * 保存モーダルの失敗を隅に出すと、直すべき入力から目が離れる。
 * 解析の失敗をトーストにしないのは、解析が自動で走るので
 * 利用者が解析ペインを見ていないときにも失敗しうるため。
 *
 * **閉じる手段を持たない。** 出ているあいだは、その場所の状態がまだ
 * 直っていないということなので、閉じても状態は変わらない。
 * 消えるのは、置いた側が置くのをやめたとき。
 */
export default function InlineNotice(props: InlineNoticeProps) {
  return <Notice {...props} className="notice--inline" />;
}
