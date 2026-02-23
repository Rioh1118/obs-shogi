import { useEffect, useMemo, useRef, useState } from "react";

import { useURLParams } from "@/hooks/useURLParams";

import Modal from "../Modal";
import { usePositionHitNavigation } from "@/hooks/usePositionHitNavigation";

import PositionSearchModalHeader from "./PositionSearchModalHeader";
import PositionSearchHitList from "./PositionSearchHitList";
import PositionSearchModalFooter from "./PositionSearchModalFooter";

import "./PositionSeachModal.scss";

import { JKFPlayer } from "json-kifu-format";
import type { Kind } from "shogi.js";
import { buildPreviewData } from "@/utils/buildPreviewData";
import PreviewPane from "../NavigationModal/PreviewPane";
import PositionSearchStatusBar from "./PositionSearchStatusBar";
import PositionSearchDestinationCard from "./PositionSearchDestinationCard";
import { hitKey, orderPositionHits } from "@/utils/orderPositionHits";
import { useGame } from "@/entities/game";
import { usePositionSync } from "@/app/providers/bridges/position-sync";
import { usePositionSearch, type PositionHit } from "@/entities/search";

export default function PositionSearchModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "position-search";

  const { currentSfen } = usePositionSync();
  const { state: gameState } = useGame();

  const {
    state,
    searchCurrentPositionBestEffort,
    clearSearch,
    getCurrentSession,
    getHits,
    resolveHitAbsPath,
  } = usePositionSearch();

  const { navigateToHit } = usePositionHitNavigation();

  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLElement | null>(null);

  const session = getCurrentSession();
  const hits = getHits();

  const isSearching = state.isSearching;
  const isDone = !!session?.isDone && !isSearching;
  const error = session?.error ?? null;

  const indexState = state.index.state;
  const indexStale = indexState === "Building" || indexState === "Updating";

  const lastIndexedRef = useRef<number>(0);
  const retryTimerRef = useRef<number | null>(null);

  const didFinalRefreshRef = useRef(false);

  const statusText = useMemo(() => {
    if (isSearching) return "検索中…";
    if (error) return "エラー";
    if (isDone) return "完了";
    return "待機中";
  }, [isSearching, error, isDone]);

  const toKan = useMemo(
    () => (k: string) => JKFPlayer.kindToKan(k as Kind) ?? k,
    [],
  );

  const previewData = useMemo(() => {
    const jkf = gameState.jkfPlayer;
    if (!isOpen || !jkf) return null;

    const nodeId = jkf.getTesuuPointer(jkf.tesuu);
    return buildPreviewData(jkf, nodeId);
  }, [isOpen, gameState.jkfPlayer]);

  const lastNonEmptyHitsRef = useRef<{
    sfen: string | null;
    hits: PositionHit[];
  }>({ sfen: null, hits: [] });

  const lastSfenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (!currentSfen) return;
    if (hits.length > 0) {
      lastNonEmptyHitsRef.current = { sfen: currentSfen, hits };
    }
  }, [isOpen, currentSfen, hits]);

  const displayHits = useMemo(() => {
    // 今回のrequestがまだ空でも、検索中orstale中は前回の結果を見せる
    if (hits.length > 0) return hits;

    const prev = lastNonEmptyHitsRef.current;
    const canReuse =
      prev.sfen === currentSfen && (isSearching || !!session?.stale);

    return canReuse ? prev.hits : hits;
  }, [hits, currentSfen, isSearching, session?.stale]);

  const orderedHits = useMemo(() => {
    return orderPositionHits(
      displayHits,
      resolveHitAbsPath,
      gameState.loadedAbsPath ?? null,
    );
  }, [displayHits, resolveHitAbsPath, gameState.loadedAbsPath]);

  useEffect(() => {
    if (!isOpen) return;
    if (!currentSfen) return;

    // 初回 or SFENが変わったときだけクリアして新規検索
    if (lastSfenRef.current !== currentSfen) {
      lastSfenRef.current = currentSfen;
      setActiveIndex(0);
      clearSearch();

      queueMicrotask(() => rootRef.current?.focus());

      searchCurrentPositionBestEffort(5000).catch((e) => {
        console.error("[PositionSearchModal] auto search failed:", e);
      });
    }
  }, [isOpen, currentSfen, clearSearch, searchCurrentPositionBestEffort]);

  useEffect(() => {
    if (!isOpen) return;
    if (!currentSfen) return;
    if (!indexStale) return;
    if (isSearching) return;

    // indexedFiles が進んだときだけ再検索（無駄撃ち防止）
    const indexed = state.index.indexedFiles;
    if (indexed <= lastIndexedRef.current) return;
    lastIndexedRef.current = indexed;

    if (retryTimerRef.current != null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    retryTimerRef.current = window.setTimeout(() => {
      searchCurrentPositionBestEffort(5000).catch((e) => {
        console.error(
          "[PositionSearchModal] progress-triggered search failed:",
          e,
        );
      });
    }, 250);

    return () => {
      if (retryTimerRef.current != null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [
    isOpen,
    currentSfen,
    indexStale,
    isSearching,
    state.index.indexedFiles,
    searchCurrentPositionBestEffort,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    if (!currentSfen) return;

    const isReady = state.index.state === "Ready";
    if (!isReady) {
      didFinalRefreshRef.current = false;
      return;
    }
    if (didFinalRefreshRef.current) return;

    didFinalRefreshRef.current = true;
    searchCurrentPositionBestEffort(5000).catch((e) => {
      console.error("[PositionSearchModal] final refresh failed:", e);
    });
  }, [isOpen, currentSfen, state.index.state, searchCurrentPositionBestEffort]);

  const activeHit = orderedHits[activeIndex];
  const activeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    activeKeyRef.current = activeHit ? hitKey(activeHit) : null;
  }, [activeHit]);

  useEffect(() => {
    if (!isOpen) return;
    const n = orderedHits.length;
    if (activeIndex < n) return;
    setActiveIndex(Math.max(0, n - 1));
  }, [isOpen, activeIndex, orderedHits.length]);

  useEffect(() => {
    const k = activeKeyRef.current;
    if (!k) return;
    const next = orderedHits.findIndex((h) => hitKey(h) === k);
    if (next >= 0 && next !== activeIndex) setActiveIndex(next);
  }, [orderedHits, activeIndex]);

  const accept = (hit: PositionHit) => {
    const absPath = resolveHitAbsPath(hit);
    if (!absPath) return;
    navigateToHit(absPath, hit.cursor);
    closeModal();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (isSearching) return;
      if (activeHit) accept(activeHit);
      return;
    }

    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setActiveIndex((i) =>
        Math.min(i + 1, Math.max(0, orderedHits.length - 1)),
      );
      return;
    }
    if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
  };

  if (!isOpen) return null;

  const destAbsPath = activeHit ? resolveHitAbsPath(activeHit) : null;

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
      showCloseButton={false}
    >
      <section
        ref={(el) => {
          rootRef.current = el;
        }}
        className="pos-search"
        onKeyDown={onKeyDown}
        tabIndex={-1}
        aria-label="局面検索"
      >
        <header className="pos-search__header">
          <PositionSearchModalHeader
            isSearching={isSearching}
            title="局面検索"
          />
        </header>

        <main className="pos-search__main" aria-label="検索とプレビュー">
          <div className="pos-search__grid">
            <section className="pos-search__left" aria-label="検索状態">
              <PositionSearchStatusBar
                hitsCount={displayHits.length}
                statusText={statusText}
                stale={
                  state.index.state === "Building" ||
                  state.index.state === "Updating"
                }
                error={error}
              />

              <PositionSearchHitList
                hits={orderedHits}
                activeIndex={activeIndex}
                onActiveIndexChange={setActiveIndex}
                onAccept={accept}
                isSearching={isSearching}
                error={error}
                resolveAbsPath={resolveHitAbsPath}
              />
            </section>
            <aside className="pos-search__right" aria-label="局面プレビュー">
              <div className="pos-search__paneTitle">現在の局面</div>
              <PreviewPane previewData={previewData} toKan={toKan} />
              <PositionSearchDestinationCard
                currentAbsPath={gameState.loadedAbsPath ?? null}
                destAbsPath={destAbsPath}
                tesuu={activeHit?.cursor.tesuu ?? null}
                forks={activeHit?.cursor.fork_pointers.length ?? null}
              />
            </aside>
          </div>
        </main>

        <footer className="pos-search__footer">
          <PositionSearchModalFooter />
        </footer>
      </section>
    </Modal>
  );
}
