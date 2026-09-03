import type { CSSProperties } from "react";
import type { PositionHit } from "@/entities/search";
import { toRelPath } from "@/shared/lib/path";
import { PositionHitItem } from "./PositionHitItem";
import type { ListProps } from "react-window";

export type HitRowProps = {
  hits: PositionHit[];
  activeIndex: number;

  rootDir: string | null;
  currentAbs: string | null;

  relCache: Map<string, string>;
  resolveAbsPath: (hit: PositionHit) => string | null;

  onActiveIndexChange: (next: number) => void;
  onAccept: (hit: PositionHit) => void;
};

function fileNameFromRel(rel: string) {
  const i = rel.lastIndexOf("/");
  return i >= 0 ? rel.slice(i + 1) : rel;
}

export const VirtualHitRow: ListProps<HitRowProps>["rowComponent"] = (
  props: {
    ariaAttributes: {
      "aria-posinset": number;
      "aria-setsize": number;
      role: "listitem";
    };
    index: number;
    style: CSSProperties;
  } & HitRowProps,
) => {
  const { index, style, hits } = props;

  const hit = hits[index];
  const isActive = index === props.activeIndex;

  const abs = props.resolveAbsPath(hit);
  const rel = (() => {
    if (!abs) return "path unknown";
    const cached = props.relCache.get(abs);
    if (cached) return cached;
    const next = toRelPath(abs, props.rootDir);
    props.relCache.set(abs, next);
    return next;
  })();

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
      fileName={fileNameFromRel(rel)}
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
};
