import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useURLParams } from "@/shared/lib/router/useURLParams";

import Modal from "../../../shared/ui/Modal";
import { usePositionHitNavigation } from "@/features/position-search/lib/usePositionHitNavigation";

import PositionSearchModalHeader from "./PositionSearchModalHeader";
import PositionSearchHitList from "./PositionSearchHitList";

import "./PositionSearchModal.scss";

import { JKFPlayer } from "json-kifu-format";
import type { Kind } from "shogi.js";
import { buildPreviewData } from "@/entities/position/lib/buildPreviewData";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";
import PreviewPane from "../../../entities/position/ui/PositionPreviewPane";
import PositionSearchStatusBar from "./PositionSearchStatusBar";
import PositionSearchDestinationCard from "./PositionSearchDestinationCard";
import { hitKey, orderPositionHits } from "@/features/position-search/lib/orderPositionHits";
import { useGame } from "@/entities/game";
import { usePositionSync } from "@/app/providers/bridges/position-sync";
import { usePositionSearch, type PositionHit } from "@/entities/search";
import PositionSearchContinuation from "./PositionSearchContinuation";

export default function PositionSearchModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "position-search";

  const { currentSfen } = usePositionSync();
  const { state: gameState, view: gameView } = useGame();

  const {
    state,
    searchPosition,
    searchCurrentPositionBestEffort,
    getSessionByRequestId,
    getHitsByRequestId,
    isSearchingRequest,
    resolveHitAbsPath,
  } = usePositionSearch();

  const { navigateToHit } = usePositionHitNavigation();

  const [activeIndex, setActiveIndex] = useState(0);
  const [requestId, setRequestId] = useState<number | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);

  const rootRef = useRef<HTMLElement | null>(null);

  const session = getSessionByRequestId(requestId);
  const hits = getHitsByRequestId(requestId);

  const isSearching = isLaunching || isSearchingRequest(requestId);
  const isDone = !!session?.isDone && !isSearching;
  const error = launchError ?? session?.error ?? null;

  const indexState = state.index.state;
  const indexStale =
    indexState === "Restoring" || indexState === "Building" || indexState === "Updating";

  const resultStale = indexStale || !!session?.stale;

  const statusText = useMemo(() => {
    if (isSearching) return "検索中…";
    if (error) return "エラー";
    if (isDone) return "完了";
    return "待機中";
  }, [isSearching, error, isDone]);

  const toKan = useMemo(() => (k: string) => JKFPlayer.kindToKan(k as Kind) ?? k, []);

  const previewData = useMemo(() => {
    if (!isOpen) return null;

    // params.sfen がある場合は SFEN から直接構築
    if (params.sfen) {
      return buildPreviewDataFromSfen(params.sfen);
    }

    // 通常: 現在の棋譜の局面から構築
    const jkf = gameView.player;
    if (!jkf) return null;
    const nodeId = jkf.getTesuuPointer(jkf.tesuu);
    return buildPreviewData(jkf, nodeId);
  }, [isOpen, params.sfen, gameView.player]);

  const orderedHits = useMemo(() => {
    return orderPositionHits(hits, resolveHitAbsPath, gameState.loadedAbsPath ?? null);
  }, [hits, resolveHitAbsPath, gameState.loadedAbsPath]);

  // -------------------------
  // 検索トリガ：queryKey（検索対象SFEN）が変わったら再検索
  // params.sfen があればそのSFENで検索、なければ現在局面で検索
  // -------------------------
  const queryKey = params.sfen ?? currentSfen ?? null;
  const lastQueryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      lastQueryKeyRef.current = null;
      setRequestId(null);
      setLaunchError(null);
      setIsLaunching(false);
      setActiveIndex(0);
      return;
    }

    if (!queryKey) return;
    if (lastQueryKeyRef.current === queryKey) return;

    lastQueryKeyRef.current = queryKey;
    setRequestId(null);
    setLaunchError(null);
    setIsLaunching(true);
    setActiveIndex(0);

    const doSearch = params.sfen
      ? searchPosition({ sfen: params.sfen, consistency: "BestEffort", chunk_size: 5000 })
      : searchCurrentPositionBestEffort({ chunkSize: 5000 });

    doSearch
      .then((out) => {
        setRequestId(out.request_id);
      })
      .catch((e) => {
        console.error("[PositionSearchModal] search failed:", e);
        setLaunchError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setIsLaunching(false);
      });
  }, [isOpen, queryKey, params.sfen, searchPosition, searchCurrentPositionBestEffort]);

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
    // 確定操作なので returnTo は適用しない（キャンセル時のみマネージャーに戻る）
    closeModal({ skipReturn: true });
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
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, orderedHits.length - 1)));
      return;
    }

    if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    const el = rootRef.current;
    if (!el) return;

    el.focus({ preventScroll: true });
  }, [isOpen]);

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
          <PositionSearchModalHeader isSearching={isSearching} title="局面検索" />
        </header>

        <main className="pos-search__main" aria-label="検索とプレビュー">
          <div className="pos-search__grid">
            <section className="pos-search__left" aria-label="検索状態">
              <PositionSearchStatusBar
                hitsCount={hits.length}
                statusText={statusText}
                stale={resultStale}
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
              <div className="pos-search__paneTitle">
                {params.sfen ? "検索対象の局面" : "現在の局面"}
              </div>
              <div className="pos-search__preview">
                <PreviewPane previewData={previewData} toKan={toKan} />
              </div>

              <div className="pos-search__aux">
                <PositionSearchContinuation
                  activeHit={activeHit ?? null}
                  resolveAbsPath={resolveHitAbsPath}
                  ply={5}
                />

                <PositionSearchDestinationCard
                  currentAbsPath={gameState.loadedAbsPath ?? null}
                  destAbsPath={destAbsPath}
                />
              </div>
            </aside>
          </div>
        </main>
      </section>
    </Modal>
  );
}
