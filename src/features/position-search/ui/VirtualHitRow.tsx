import type { PositionHit } from "@/entities/search";
import { getBaseName } from "@/shared/lib/path";
import { PositionHitItem } from "./PositionHitItem";
import type { RowComponentProps } from "react-window";

export type HitRowProps = {
  hits: PositionHit[];
  activeIndex: number;

  currentAbs: string | null;

  /** ワークスペースのルートからの相対パスを返す */
  relPathOf: (absPath: string) => string;
  resolveAbsPath: (hit: PositionHit) => string | null;

  onActiveIndexChange: (next: number) => void;
  onAccept: (hit: PositionHit) => void;
};

export function VirtualHitRow(props: RowComponentProps<HitRowProps>) {
  const { index, style, hits } = props;

  const hit = hits[index];
  const isActive = index === props.activeIndex;

  const abs = props.resolveAbsPath(hit);
  const rel = abs ? props.relPathOf(abs) : "path unknown";

  const isSame = abs && props.currentAbs ? abs === props.currentAbs : false;

  // 包まずに行そのものを返す。`listbox` と `option` のあいだに要素を挟むと、
  // 支援技術から見て option が listbox の子でなくなり、件数も現在位置も伝わらない。
  // `ariaAttributes.role` は `listitem` なので使わない（option を上書きしてしまう）
  return (
    <PositionHitItem
      style={style}
      posInSet={props.ariaAttributes["aria-posinset"]}
      setSize={props.ariaAttributes["aria-setsize"]}
      relPath={rel}
      fileName={getBaseName(rel)}
      isSameFile={isSame}
      tesuu={hit.cursor.tesuu}
      forks={hit.cursor.forkPointers.length}
      isActive={isActive}
      onSelect={() => {
        if (index !== props.activeIndex) props.onActiveIndexChange(index);
      }}
      onAccept={() => props.onAccept(hit)}
    />
  );
}
