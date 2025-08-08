// src/debug/navTrace.ts
import type { Pointer, NavigationState, Branch } from "@/types/branchNav";
import type { PreviewData } from "@/types/branchNav";
import type { JKFPlayer } from "json-kifu-format";

declare global {
  interface Window {
    __navTrace?: any[];
  }
}

export const DEBUG_NAV = true;

export function trace(tag: string, payload: any) {
  if (!DEBUG_NAV) return;
  window.__navTrace = window.__navTrace || [];
  const entry = { t: Date.now(), tag, ...payload };
  window.__navTrace.push(entry);
  // 目で見たいとき
  // eslint-disable-next-line no-console
  console.log(`[NAV] ${tag}`, payload);
}

export function snapshotJKF(jkf: JKFPlayer) {
  return {
    tesuu: jkf.tesuu,
    forkPointers: jkf.getForkPointers(),
    max: jkf.getMaxTesuu(),
  };
}

export function pointerStr(p: Pointer) {
  return `${p.tesuu}:${JSON.stringify(p.path)}`;
}

export function stateBrief(s: NavigationState) {
  return {
    cur: pointerStr(s.current),
    pre: pointerStr(s.preview),
    selFork: s.selectedFork,
  };
}

export function branchesBrief(bs: Branch[]) {
  return bs.map((b) => ({
    id: b.id,
    start: b.startTesuu,
    forkIndex: b.forkIndex,
    path: JSON.stringify(b.path),
    len: b.length,
    first: b.description,
  }));
}

export function previewBrief(p: PreviewData | null) {
  if (!p) return null;
  return { tesuu: p.tesuu };
}
