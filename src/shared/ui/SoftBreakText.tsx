import { Fragment } from "react";

/** この字の後で折る。パスとファイル名の区切り */
const BREAK_AFTER = /(?<=[/\\_\-.])/;

/**
 * パスやファイル名を、区切りの後で折れるように出す。
 *
 * 空白の無い長い綴りは、そのままだと箱から溢れるか、区切りでない所で折れる。
 */
function SoftBreakText({ text }: { text: string }) {
  return (
    <>
      {text.split(BREAK_AFTER).map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </>
  );
}

export default SoftBreakText;
