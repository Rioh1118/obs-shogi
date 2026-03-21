import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Search, SlidersHorizontal, X, ChevronDown } from "lucide-react";

import Modal from "@/shared/ui/Modal";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useStudyPositions } from "@/entities/study-positions/model/useStudyPositions";
import type {
  StudyPosition,
  StudyPositionState,
} from "@/entities/study-positions/model/types";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";

import StateTabNav from "./StateTabNav";
import ActiveFilterChips from "./ActiveFilterChips";
import TagFilterPanel from "./TagFilterPanel";
import PositionListItem from "./PositionListItem";
import PositionDetail from "./PositionDetail";

import "./StudyPositionsManagerModal.scss";

type SortKey = "updatedAt_desc" | "updatedAt_asc" | "createdAt_desc" | "label_asc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "updatedAt_desc", label: "更新日↓" },
  { value: "updatedAt_asc", label: "更新日↑" },
  { value: "createdAt_desc", label: "作成日↓" },
  { value: "label_asc", label: "ラベル順" },
];

function matchesQuery(p: StudyPosition, q: string): boolean {
  const lower = q.toLowerCase();
  return (
    p.label.toLowerCase().includes(lower) ||
    p.description.toLowerCase().includes(lower) ||
    p.tags.some((t) => t.toLowerCase().includes(lower))
  );
}

function sortPositions(list: StudyPosition[], key: SortKey): StudyPosition[] {
  const sorted = [...list];
  switch (key) {
    case "updatedAt_desc":
      return sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    case "updatedAt_asc":
      return sorted.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    case "createdAt_desc":
      return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "label_asc":
      return sorted.sort((a, b) => a.label.localeCompare(b.label, "ja"));
    default:
      return sorted;
  }
}

function computeTagCounts(positions: StudyPosition[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of positions) {
    for (const t of p.tags) {
      map.set(t, (map.get(t) ?? 0) + 1);
    }
  }
  return map;
}

function topTags(tagCounts: Map<string, number>, limit: number): string[] {
  return [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}

export default function StudyPositionsManagerModal() {
  const { params, closeModal, openModal } = useURLParams();
  const isOpen = params.modal === "study-positions";

  const { state: spState, deletePosition } = useStudyPositions();
  const positions = spState.positions;

  // --- filter/sort state ---
  const [stateFilter, setStateFilter] = useState<StudyPositionState | null>(null);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("updatedAt_desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showTagPanel, setShowTagPanel] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rootRef = useRef<HTMLElement | null>(null);

  // --- state counts (unfiltered) ---
  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of positions) {
      counts[p.state] = (counts[p.state] ?? 0) + 1;
    }
    return counts;
  }, [positions]);

  // --- filter pipeline ---
  // 1. State filter
  const stateFiltered = useMemo(
    () =>
      stateFilter === null
        ? positions
        : positions.filter((p) => p.state === stateFilter),
    [positions, stateFilter],
  );

  // 2. Text search
  const textFiltered = useMemo(
    () =>
      query ? stateFiltered.filter((p) => matchesQuery(p, query)) : stateFiltered,
    [stateFiltered, query],
  );

  // 3. Contextual tag candidates
  const tagCounts = useMemo(() => computeTagCounts(textFiltered), [textFiltered]);
  const contextualTags = useMemo(() => topTags(tagCounts, 8), [tagCounts]);

  // Frequent tags (from all positions)
  const allTagCounts = useMemo(() => computeTagCounts(positions), [positions]);
  const frequentTags = useMemo(() => topTags(allTagCounts, 8), [allTagCounts]);

  // 4. Tag filter (AND)
  const tagFiltered = useMemo(() => {
    if (tagFilter.length === 0) return textFiltered;
    return textFiltered.filter((p) =>
      tagFilter.every((t) => p.tags.includes(t)),
    );
  }, [textFiltered, tagFilter]);

  // 5. Sort
  const displayPositions = useMemo(
    () => sortPositions(tagFiltered, sort),
    [tagFiltered, sort],
  );

  // --- selection ---
  const selectedIndex = useMemo(() => {
    if (!selectedId) return 0;
    const idx = displayPositions.findIndex((p) => p.id === selectedId);
    return idx >= 0 ? idx : 0;
  }, [displayPositions, selectedId]);

  const selectedPosition = displayPositions[selectedIndex] ?? null;

  // Sync selectedId when list changes
  useEffect(() => {
    if (displayPositions.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !displayPositions.some((p) => p.id === selectedId)) {
      setSelectedId(displayPositions[0]?.id ?? null);
    }
  }, [displayPositions, selectedId]);

  // --- preview data for list items ---
  const previewCache = useRef(new Map<string, { turn: number }>());
  const getTurnInfo = useCallback(
    (sfen: string): { turnLabel: string | null; tesuu: number } => {
      if (previewCache.current.has(sfen)) {
        const cached = previewCache.current.get(sfen)!;
        const tokens = sfen.trim().split(/\s+/);
        const tesuu = tokens.length >= 4 ? parseInt(tokens[3], 10) || 0 : 0;
        return {
          turnLabel: cached.turn === 0 ? "先手" : "後手",
          tesuu,
        };
      }
      const pd = buildPreviewDataFromSfen(sfen);
      if (pd) {
        previewCache.current.set(sfen, { turn: pd.turn });
        const tokens = sfen.trim().split(/\s+/);
        const tesuu = tokens.length >= 4 ? parseInt(tokens[3], 10) || 0 : 0;
        return {
          turnLabel: pd.turn === 0 ? "先手" : "後手",
          tesuu,
        };
      }
      return { turnLabel: null, tesuu: 0 };
    },
    [],
  );

  // --- scroll to selected ---
  useLayoutEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (!el || !listRef.current) return;
    const container = listRef.current;
    const viewTop = container.scrollTop;
    const viewH = container.clientHeight;
    const elTop = el.offsetTop;
    const elH = el.offsetHeight;

    if (elTop < viewTop + viewH * 0.15) {
      container.scrollTo({
        top: Math.max(0, elTop - viewH * 0.25),
        behavior: "smooth",
      });
    } else if (elTop + elH > viewTop + viewH * 0.85) {
      container.scrollTo({
        top: elTop + elH - viewH * 0.75,
        behavior: "smooth",
      });
    }
  }, [selectedIndex]);

  // --- keyboard ---
  const moveSelection = useCallback(
    (delta: number) => {
      const n = displayPositions.length;
      if (n === 0) return;
      const next = Math.max(0, Math.min(n - 1, selectedIndex + delta));
      setSelectedId(displayPositions[next]?.id ?? null);
    },
    [displayPositions, selectedIndex],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const isInInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveSelection(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveSelection(-1);
        return;
      }

      if (isInInput) return;

      if (e.key === "j") {
        e.preventDefault();
        moveSelection(1);
        return;
      }
      if (e.key === "k") {
        e.preventDefault();
        moveSelection(-1);
        return;
      }
      if (e.key === "s" && selectedPosition) {
        e.preventDefault();
        openModal("position-search", { sfen: selectedPosition.sfen, returnTo: "study-positions" });
        return;
      }
      if (e.key === "e" && selectedPosition) {
        e.preventDefault();
        openModal("study-position-save", { sfen: selectedPosition.sfen, returnTo: "study-positions" });
        return;
      }
    },
    [moveSelection, selectedPosition, openModal],
  );

  // --- actions ---
  const handleSearch = useCallback(
    (sfen: string) => {
      openModal("position-search", { sfen, returnTo: "study-positions" });
    },
    [openModal],
  );

  const handleEdit = useCallback(
    (sfen: string) => {
      openModal("study-position-save", { sfen, returnTo: "study-positions" });
    },
    [openModal],
  );

  // --- tag toggle ---
  const toggleTag = useCallback((tag: string) => {
    setTagFilter((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }, []);

  const removeTag = useCallback((tag: string) => {
    setTagFilter((prev) => prev.filter((t) => t !== tag));
  }, []);

  const clearTags = useCallback(() => {
    setTagFilter([]);
  }, []);

  // --- reset on close ---
  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setStateFilter(null);
      setTagFilter([]);
      setSort("updatedAt_desc");
      setSelectedId(null);
      setShowTagPanel(false);
      setShowSortMenu(false);
    }
  }, [isOpen]);

  // --- focus on open ---
  useLayoutEffect(() => {
    if (!isOpen) return;
    rootRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  if (!isOpen) return null;

  const sortLabel =
    SORT_OPTIONS.find((o) => o.value === sort)?.label ?? "更新日↓";

  const isEmpty = positions.length === 0;
  const isFilterEmpty = !isEmpty && displayPositions.length === 0;

  return (
    <Modal
      onClose={closeModal}
      theme="dark"
      variant="workspace"
      size="xl"
      chrome="card"
      padding="none"
      scroll="none"
      closeOnEsc
      closeOnOverlay
      showCloseButton
    >
      <section
        ref={(el) => {
          rootRef.current = el;
        }}
        className="sp-manager"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        aria-label="課題局面"
      >
        <header className="sp-manager__header">
          <h2 className="sp-manager__title">{"課題局面"}</h2>
        </header>

        <div className="sp-manager__body">
          {/* ===== LEFT ===== */}
          <div className="sp-manager__left">
            {/* Layer 1: State tabs */}
            <div className="sp-manager__stateTabs">
              <StateTabNav
                value={stateFilter}
                onChange={setStateFilter}
                counts={stateCounts}
                totalCount={positions.length}
              />
            </div>

            <div className="sp-manager__divider" />

            {/* Layer 2: Search + Filter */}
            <div className="sp-manager__searchRow">
              <div className="sp-manager__searchBox">
                <Search size={14} className="sp-manager__searchIcon" />
                <input
                  ref={searchRef}
                  type="text"
                  className="sp-manager__searchInput"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ラベル・メモを検索"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      if (query) setQuery("");
                    }
                  }}
                />
                {query && (
                  <button
                    type="button"
                    className="sp-manager__searchClear"
                    onClick={() => {
                      setQuery("");
                      searchRef.current?.focus();
                    }}
                    aria-label="検索クリア"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <button
                type="button"
                className={`sp-manager__filterBtn ${tagFilter.length > 0 ? "sp-manager__filterBtn--active" : ""}`}
                onClick={() => setShowTagPanel((v) => !v)}
                title="タグで絞り込む"
              >
                <SlidersHorizontal size={14} />
                {tagFilter.length > 0 && (
                  <span className="sp-manager__filterBadge">
                    {tagFilter.length}
                  </span>
                )}
              </button>
            </div>

            {/* Active tag chips */}
            <ActiveFilterChips
              tags={tagFilter}
              onRemoveTag={removeTag}
              onClearAll={clearTags}
            />

            {/* Tag filter panel */}
            {showTagPanel && (
              <TagFilterPanel
                contextualTags={contextualTags}
                frequentTags={frequentTags}
                selectedTags={tagFilter}
                onToggleTag={toggleTag}
                onClose={() => setShowTagPanel(false)}
              />
            )}

            {/* Sort */}
            <div className="sp-manager__sortRow">
              <div className="sp-manager__sortBtn">
                <button
                  type="button"
                  className="sp-manager__sortTrigger"
                  onClick={() => setShowSortMenu((v) => !v)}
                >
                  <span>{sortLabel}</span>
                  <ChevronDown size={12} />
                </button>
                {showSortMenu && (
                  <div className="sp-manager__sortMenu">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`sp-manager__sortOption ${sort === opt.value ? "sp-manager__sortOption--active" : ""}`}
                        onClick={() => {
                          setSort(opt.value);
                          setShowSortMenu(false);
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className="sp-manager__count">
                {displayPositions.length}件
                {(query || tagFilter.length > 0) &&
                  ` / ${stateFiltered.length}件中`}
              </span>
            </div>

            {/* List */}
            <div
              className="sp-manager__list"
              ref={listRef}
              role="listbox"
              aria-label="課題局面一覧"
            >
              {isEmpty && (
                <div className="sp-manager__empty">
                  <p>{"課題局面がまだ登録されていません"}</p>
                  <p className="sp-manager__emptyHint">
                    {"★ ボタンで登録できます"}
                  </p>
                </div>
              )}
              {isFilterEmpty && (
                <div className="sp-manager__empty">
                  <p>{"この条件に一致する局面はありません"}</p>
                  <button
                    type="button"
                    className="sp-manager__emptyClear"
                    onClick={() => {
                      setQuery("");
                      setTagFilter([]);
                      setStateFilter(null);
                    }}
                  >
                    {"条件をクリア"}
                  </button>
                </div>
              )}
              {displayPositions.map((pos, idx) => {
                const info = getTurnInfo(pos.sfen);
                return (
                  <PositionListItem
                    key={pos.id}
                    ref={(el) => {
                      itemRefs.current[idx] = el;
                    }}
                    position={pos}
                    selected={selectedIndex === idx}
                    onClick={() => setSelectedId(pos.id)}
                    turnLabel={info.turnLabel}
                    tesuu={info.tesuu}
                  />
                );
              })}
            </div>
          </div>

          {/* ===== RIGHT ===== */}
          <div className="sp-manager__right">
            <PositionDetail
              position={selectedPosition}
              onSearch={handleSearch}
              onEdit={handleEdit}
              onDelete={deletePosition}
            />
          </div>
        </div>
      </section>
    </Modal>
  );
}
