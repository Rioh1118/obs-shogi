import { useEffect, useMemo, useRef, useState } from "react";
import type { PositionHit } from "@/commands/search/types";
import { useAppConfig } from "@/contexts/AppConfigContext";
import { useGame } from "@/contexts/GameContext";
import "./PositionSearchHitList.scss";
import { toRelPath } from "@/utils/path";

type Props = {
  hits: PositionHit[];
  activeIndex: number;
  onActiveIndexChange: (next: number) => void;
  onAccept: (hit: PositionHit) => void;
  isSearching: boolean;
  error: string | null;
  resolveAbsPath: (hit: PositionHit) => string | null;
};

type InputMode = "keyboard" | "pointer";
type PointerCause = "hover" | "click";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;

    const onChange = () => setReduced(mq.matches);
    onChange();

    return () => {
      mq.removeEventListener("change", onChange);
    };
  }, []);

  return reduced;
}

// 「見えてない分だけ」スクロールする（パディング等の数値に依存しない）
function isFullyVisible(container: HTMLElement, el: HTMLElement) {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return r.top >= c.top && r.bottom <= c.bottom;
}

function revealIfNeeded(
  container: HTMLElement,
  el: HTMLElement,
  behavior: ScrollBehavior,
) {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();

  if (r.top < c.top) {
    container.scrollBy({ top: r.top - c.top, behavior });
    return;
  }

  if (r.bottom > c.bottom) {
    container.scrollBy({ top: r.bottom - c.bottom, behavior });
  }
}

function isTextEditingElement(el: Element | null) {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

export default function PositionSearchHitList({
  hits,
  activeIndex,
  onActiveIndexChange,
  onAccept,
  isSearching,
  error,
  resolveAbsPath,
}: Props) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const inputModeRef = useRef<InputMode>("keyboard");
  const pointerCauseRef = useRef<PointerCause>("hover");
  const listRef = useRef<HTMLDivElement | null>(null);

  const wheelLockRef = useRef(false);
  const wheelTimerRef = useRef<number | null>(null);

  const lastFollowAtRef = useRef(0);
  const prefersReduced = usePrefersReducedMotion();

  const prevRowsLenRef = useRef(0);

  const { config } = useAppConfig();
  const { state: gameState } = useGame();

  const rootDir = config?.root_dir ?? null;
  const currentAbs = gameState.loadedAbsPath ?? null;

  const rows = useMemo(() => {
    return hits.map((hit, idx) => {
      const abs = resolveAbsPath(hit);
      const rel = abs ? toRelPath(abs, rootDir) : "path unknown";
      const isSame = abs && currentAbs ? abs === currentAbs : false;

      return {
        idx,
        hit,
        relPath: rel,
        isSameFile: isSame,
        tesuu: hit.cursor.tesuu,
        forks: hit.cursor.fork_pointers.length,
        id: `pos-search-opt-${hit.occ.file_id}-${hit.occ.gen}-${hit.occ.node_id}-${idx}`,
      };
    });
  }, [hits, resolveAbsPath, rootDir, currentAbs]);

  useEffect(() => {
    optionRefs.current = optionRefs.current.slice(0, rows.length);
  }, [rows.length]);

  const activeId = rows[activeIndex]?.id;

  useEffect(() => {
    const onKeyDown = () => {
      inputModeRef.current = "keyboard";
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // ★ フォーカス + 追従スクロール（まとめてシンプルに）
  useEffect(() => {
    const container = listRef.current;
    const el = optionRefs.current[activeIndex];
    if (!container || !el) return;
    if (isSearching) return; // disabled の button に focus しない

    const wasEmpty = prevRowsLenRef.current === 0;
    prevRowsLenRef.current = rows.length;

    const isKeyboard = inputModeRef.current === "keyboard";
    const isClick =
      inputModeRef.current === "pointer" && pointerCauseRef.current === "click";

    // hover では基本フォーカスもスクロールも奪わない（見切れてたらスクロールだけ直す）
    const isHover = !isKeyboard && !isClick;

    // 入力欄で編集中ならフォーカス奪わない（ただし、すでにこのリスト内にフォーカスがあるならOK）
    const ae = document.activeElement;
    const typing = isTextEditingElement(ae);
    const focusInsideList = ae instanceof Node ? container.contains(ae) : false;
    const allowStealFocus = !typing || focusInsideList;

    // ここが「レンダリングしたら普通にフォーカスしたい」の中心：
    // - 0件→表示ありに変わった瞬間（wasEmpty）や
    // - keyboard/click で active が動いた時は focus を当てる
    if (!isHover && allowStealFocus) {
      try {
        el.focus({ preventScroll: true });
      } catch {
        // preventScroll 非対応環境でもOK
        el.focus();
      }
    } else if (wasEmpty && rows.length > 0 && allowStealFocus) {
      // 初回表示時は hover 判定より優先してフォーカスしても良い（欲しければ）
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
    }

    // スクロール方針：
    // - hover: 見切れてたら直すだけ
    // - keyboard/click: 見えるように追従
    if (isHover && isFullyVisible(container, el)) return;

    const now = performance.now();
    const rapid = now - lastFollowAtRef.current < 120;
    lastFollowAtRef.current = now;

    const behavior: ScrollBehavior =
      prefersReduced || rapid ? "auto" : "smooth";

    revealIfNeeded(container, el, behavior);
  }, [activeIndex, rows.length, prefersReduced, isSearching]);

  useEffect(() => {
    return () => {
      if (wheelTimerRef.current != null) {
        window.clearTimeout(wheelTimerRef.current);
        wheelTimerRef.current = null;
      }
    };
  }, []);

  return (
    <section className="pos-search__results" aria-label="検索結果">
      <div
        className="pos-search__list"
        role="listbox"
        aria-activedescendant={activeId}
        ref={listRef}
        onWheel={() => {
          wheelLockRef.current = true;
          if (wheelTimerRef.current != null)
            window.clearTimeout(wheelTimerRef.current);
          wheelTimerRef.current = window.setTimeout(() => {
            wheelLockRef.current = false;
            wheelTimerRef.current = null;
          }, 140);
        }}
      >
        {rows.length === 0 ? (
          <div className="pos-search__empty" role="status" aria-live="polite">
            {isSearching
              ? "検索結果を受信中…"
              : error
                ? "検索に失敗しました"
                : "一致する棋譜がありません"}
          </div>
        ) : (
          rows.map((row) => {
            const isActive = row.idx === activeIndex;

            return (
              <button
                key={row.id}
                id={row.id}
                ref={(el) => {
                  optionRefs.current[row.idx] = el;
                }}
                type="button"
                role="option"
                aria-selected={isActive}
                className={[
                  "pos-search__item",
                  isActive ? "pos-search__item--active" : "",
                ].join(" ")}
                onPointerEnter={() => {
                  if (isSearching) return;
                  if (wheelLockRef.current) return;
                  inputModeRef.current = "pointer";
                  pointerCauseRef.current = "hover";
                  if (row.idx !== activeIndex) onActiveIndexChange(row.idx);
                }}
                onPointerDown={() => {
                  if (isSearching) return;
                  inputModeRef.current = "pointer";
                  pointerCauseRef.current = "click";
                }}
                onClick={() => onAccept(row.hit)}
                disabled={isSearching}
              >
                <div className="pos-search__rowTop">
                  <div className="pos-search__path">{row.relPath}</div>
                  <span
                    className={[
                      "pos-search__badge",
                      row.isSameFile ? "is-same" : "is-switch",
                    ].join(" ")}
                  >
                    {row.isSameFile ? "同一" : "切替"}
                  </span>
                </div>

                <div className="pos-search__rowMeta">
                  <span className="pos-search__chip">手数 {row.tesuu}</span>
                  <span className="pos-search__chip">分岐 {row.forks}</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
