import type { ReactNode } from "react";
import DefaultBadge from "./DefaultBadge";
import "./OptionRow.scss";

interface OptionRowProps {
  name: string;
  defaultValue: string | undefined;
  isOverridden: boolean;
  /** type 別入力 UI（spin/string/combo/...） */
  control: ReactNode;
  /** Threads / USI_Hash の CPU・RAM バー等。控えめに表示するエリア。 */
  augment?: ReactNode;
}

export default function OptionRow({
  name,
  defaultValue,
  isOverridden,
  control,
  augment,
}: OptionRowProps) {
  return (
    <div className="usiOptRow">
      <div className="usiOptRow__head">
        <div className="usiOptRow__name" title={name}>
          {name}
        </div>
        <div className="usiOptRow__control">{control}</div>
        <div className="usiOptRow__default">
          <DefaultBadge defaultValue={defaultValue} isOverridden={isOverridden} />
        </div>
      </div>
      {augment ? <div className="usiOptRow__augment">{augment}</div> : null}
    </div>
  );
}
