import SoftBreakText from "@/shared/ui/SoftBreakText";
import { cx } from "@/features/settings/lib/cx";
import "./SPath.scss";

type Props = {
  path: string;
  /** まだ決まっていないときの文 */
  placeholder?: string;
};

/**
 * 打てないパス。長くても折って全部を出す。
 *
 * 打てない入力欄にしない。1行に省かれ、どこを指しているかが読めない。
 */
export default function SPath({ path, placeholder = "" }: Props) {
  return (
    <div className={cx("sui-path", !path && "sui-path--none")} title={path || undefined}>
      {path ? <SoftBreakText text={path} /> : placeholder}
    </div>
  );
}
