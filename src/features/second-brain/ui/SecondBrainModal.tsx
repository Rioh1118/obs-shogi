import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { JKFPlayer } from "json-kifu-format";
import type { Kind } from "shogi.js";
import Modal from "@/shared/ui/Modal";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useGame } from "@/entities/game";
import { useMarks } from "@/entities/marks";
import type { MarkEntry, MarkTag } from "@/entities/marks";
import { MARK_TAGS } from "@/entities/marks";
import PreviewPane from "@/entities/position/ui/PositionPreviewPane";
import { buildPreviewData } from "@/entities/position/lib/buildPreviewData";
import type { PreviewData } from "@/entities/position/model/preview";
import type { ForkPointer, KifuCursor, TesuuPointer } from "@/entities/kifu/model/cursor";
import "./SecondBrainModal.scss";

// tesuuPointer の文字列をパースする
function parseTesuuPointer(ptr: string): {
  tesuu: number;
  forkPointers: ForkPointer[];
} {
  const commaIdx = ptr.indexOf(",");
  if (commaIdx < 0) return { tesuu: 0, forkPointers: [] };
  const tesuu = parseInt(ptr.substring(0, commaIdx), 10);
  const forkPointers = JSON.parse(ptr.substring(commaIdx + 1)) as ForkPointer[];
  return { tesuu, forkPointers };
}

type MarkWithPointer = {
  tesuuPointer: string;
  entry: MarkEntry;
};

type LevelFilter = "all" | 1 | 2 | 3 | 4;

function SecondBrainModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "second-brain";

  const { state: gameState, applyCursor } = useGame();
  const { getFileMarks, upsertMark, deleteMark } = useMarks();

  const absPath = gameState.loadedAbsPath;
  const fileMarks = useMemo(
    () => (absPath ? getFileMarks(absPath) : {}),
    [absPath, getFileMarks],
  );

  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [tagFilter, setTagFilter] = useState<MarkTag | null>(null);
  const [selectedPointer, setSelectedPointer] = useState<string | null>(null);
  const [editNote, setEditNote] = useState<string>("");

  const listRef = useRef<HTMLUListElement>(null);

  // フィルタ済みマーク一覧（手数順）
  const filteredMarks = useMemo((): MarkWithPointer[] => {
    const all = Object.entries(fileMarks).map(([ptr, entry]) => ({
      tesuuPointer: ptr,
      entry,
    }));
    return all
      .filter((m) => {
        if (levelFilter !== "all" && m.entry.level < levelFilter) return false;
        if (tagFilter && !m.entry.tags.includes(tagFilter)) return false;
        return m.entry.level > 0 || m.entry.tags.length > 0;
      })
      .sort((a, b) => a.entry.tesuu - b.entry.tesuu);
  }, [fileMarks, levelFilter, tagFilter]);

  // 選択インデックス
  const selectedIndex = useMemo(
    () =>
      selectedPointer !== null
        ? filteredMarks.findIndex((m) => m.tesuuPointer === selectedPointer)
        : -1,
    [filteredMarks, selectedPointer],
  );

  // Modal open 時に最初のマークを選択
  useEffect(() => {
    if (!isOpen) return;
    if (filteredMarks.length > 0) {
      setSelectedPointer(filteredMarks[0].tesuuPointer);
      setEditNote(filteredMarks[0].entry.note);
    } else {
      setSelectedPointer(null);
      setEditNote("");
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // 選択変更時に note を同期
  useEffect(() => {
    if (selectedPointer === null) {
      setEditNote("");
      return;
    }
    const entry = fileMarks[selectedPointer];
    setEditNote(entry?.note ?? "");
  }, [selectedPointer, fileMarks]);

  // フィルタ変更時に選択をリセット
  useEffect(() => {
    if (filteredMarks.length > 0) {
      setSelectedPointer(filteredMarks[0].tesuuPointer);
    } else {
      setSelectedPointer(null);
    }
  }, [levelFilter, tagFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // プレビューデータ生成
  const { previewData, isStale } = useMemo((): {
    previewData: PreviewData | null;
    isStale: boolean;
  } => {
    if (!isOpen || !gameState.jkfPlayer || !selectedPointer) {
      return { previewData: null, isStale: false };
    }
    try {
      const { tesuu, forkPointers } = parseTesuuPointer(selectedPointer);
      const sim = new JKFPlayer(gameState.jkfPlayer.kifu);
      sim.goto(tesuu, forkPointers);
      if (sim.tesuu !== tesuu) {
        return { previewData: null, isStale: true };
      }
      const pd = buildPreviewData(sim, selectedPointer);
      return { previewData: pd, isStale: false };
    } catch {
      return { previewData: null, isStale: true };
    }
  }, [isOpen, gameState.jkfPlayer, selectedPointer]);

  const selectedMark = selectedPointer ? fileMarks[selectedPointer] : null;

  const handleSaveNote = useCallback(() => {
    if (!absPath || !selectedPointer || !selectedMark) return;
    upsertMark(absPath, selectedPointer, {
      ...selectedMark,
      note: editNote,
    });
  }, [absPath, selectedPointer, selectedMark, editNote, upsertMark]);

  const handleDeleteMark = useCallback(
    (ptr: string) => {
      if (!absPath) return;
      deleteMark(absPath, ptr);
      const remaining = filteredMarks.filter((m) => m.tesuuPointer !== ptr);
      if (remaining.length > 0) {
        setSelectedPointer(remaining[0].tesuuPointer);
      } else {
        setSelectedPointer(null);
      }
    },
    [absPath, deleteMark, filteredMarks],
  );

  const handleJump = useCallback(() => {
    if (!gameState.jkfPlayer || !selectedPointer) return;
    try {
      const { tesuu, forkPointers } = parseTesuuPointer(selectedPointer);
      const sim = new JKFPlayer(gameState.jkfPlayer.kifu);
      sim.goto(tesuu, forkPointers);
      if (sim.tesuu !== tesuu) return;

      const cursor: KifuCursor = {
        tesuu,
        forkPointers,
        tesuuPointer: sim.getTesuuPointer(tesuu) as TesuuPointer,
      };
      applyCursor(cursor);
      closeModal();
    } catch {
      // stale
    }
  }, [gameState.jkfPlayer, selectedPointer, applyCursor, closeModal]);

  const moveSelection = useCallback(
    (delta: number) => {
      if (filteredMarks.length === 0) return;
      const cur = selectedIndex < 0 ? 0 : selectedIndex;
      const next = Math.max(0, Math.min(filteredMarks.length - 1, cur + delta));
      const m = filteredMarks[next];
      if (m) setSelectedPointer(m.tesuuPointer);
    },
    [filteredMarks, selectedIndex],
  );

  // キーボード操作
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTextInput =
        target.tagName === "TEXTAREA" || target.tagName === "INPUT";

      switch (e.key) {
        case "ArrowDown":
        case "j":
          if (isTextInput) return;
          e.preventDefault();
          moveSelection(1);
          break;
        case "ArrowUp":
        case "k":
          if (isTextInput) return;
          e.preventDefault();
          moveSelection(-1);
          break;
        case "Enter":
          if (isTextInput) return;
          e.preventDefault();
          handleJump();
          break;
        case "Escape":
          e.preventDefault();
          closeModal();
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, moveSelection, handleJump, closeModal]);

  const toKan = (k: string) => JKFPlayer.kindToKan(k as Kind) ?? k;

  if (!isOpen) return null;

  const LEVEL_OPTIONS: Array<{ label: string; value: LevelFilter }> = [
    { label: "全て", value: "all" },
    { label: "L1以上", value: 1 },
    { label: "L2以上", value: 2 },
    { label: "L3以上", value: 3 },
    { label: "L4", value: 4 },
  ];

  return (
    <Modal
      onClose={closeModal}
      theme="light"
      variant="workspace"
      size="xl"
      chrome="none"
      padding="none"
      scroll="none"
      closeOnEsc={false}
    >
      <div className="sb-modal">
        {/* Header */}
        <header className="sb-modal__header">
          <h2 className="sb-modal__title">第二の脳</h2>
          <div className="sb-modal__filters">
            <div className="sb-modal__filter-group">
              {LEVEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`sb-modal__filter-btn${levelFilter === opt.value ? " sb-modal__filter-btn--active" : ""}`}
                  onClick={() => setLevelFilter(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="sb-modal__filter-group">
              {MARK_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`sb-modal__filter-btn${tagFilter === tag ? " sb-modal__filter-btn--active" : ""}`}
                  onClick={() => setTagFilter((prev) => (prev === tag ? null : tag))}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="sb-modal__close-btn"
            onClick={closeModal}
            aria-label="閉じる"
          >
            ✕
          </button>
        </header>

        {/* 3-pane body */}
        <div className="sb-modal__body">
          {/* Left: Board preview */}
          <div className="sb-modal__pane sb-modal__pane--preview">
            {selectedPointer === null ? (
              <div className="sb-modal__empty">マークがありません</div>
            ) : isStale ? (
              <div className="sb-modal__stale">
                <p>この地点は見つかりません</p>
                <button
                  type="button"
                  className="sb-modal__stale-delete"
                  onClick={() => handleDeleteMark(selectedPointer)}
                >
                  マークを削除
                </button>
              </div>
            ) : (
              <PreviewPane previewData={previewData} toKan={toKan} />
            )}
          </div>

          {/* Center: Marks list */}
          <div className="sb-modal__pane sb-modal__pane--list">
            {filteredMarks.length === 0 ? (
              <div className="sb-modal__empty">
                {Object.keys(fileMarks).length === 0
                  ? "まだマークがありません"
                  : "フィルタに一致するマークがありません"}
              </div>
            ) : (
              <ul className="sb-marks-list" ref={listRef}>
                {filteredMarks.map((m) => (
                  <li
                    key={m.tesuuPointer}
                    className={`sb-marks-list__item${selectedPointer === m.tesuuPointer ? " sb-marks-list__item--selected" : ""}`}
                    onClick={() => setSelectedPointer(m.tesuuPointer)}
                    onDoubleClick={handleJump}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleJump();
                      }
                    }}
                  >
                    <div className="sb-marks-list__row">
                      {m.entry.level > 0 && (
                        <span className="sb-badge sb-badge--level">
                          L{m.entry.level}
                        </span>
                      )}
                      <span className="sb-marks-list__move">
                        {m.entry.tesuu}手 {m.entry.moveText}
                      </span>
                      {m.entry.tags.map((tag) => (
                        <span key={tag} className="sb-badge sb-badge--tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                    {m.entry.note && (
                      <div className="sb-marks-list__note">
                        {m.entry.note.substring(0, 40)}
                        {m.entry.note.length > 40 ? "…" : ""}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Right: Detail / note edit */}
          <div className="sb-modal__pane sb-modal__pane--detail">
            {selectedMark ? (
              <div className="sb-detail">
                <div className="sb-detail__meta">
                  <span className="sb-detail__tesuu">
                    {selectedMark.tesuu}手目
                  </span>
                  <span className="sb-detail__move">{selectedMark.moveText}</span>
                </div>

                <div className="sb-detail__badges">
                  {selectedMark.level > 0 && (
                    <span className="sb-badge sb-badge--level">
                      L{selectedMark.level}
                    </span>
                  )}
                  {selectedMark.tags.map((tag) => (
                    <span key={tag} className="sb-badge sb-badge--tag">
                      {tag}
                    </span>
                  ))}
                </div>

                <label className="sb-detail__note-label" htmlFor="sb-note">
                  メモ
                </label>
                <textarea
                  id="sb-note"
                  className="sb-detail__note"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  onBlur={handleSaveNote}
                  placeholder="任意のメモを記入..."
                  rows={5}
                />

                <div className="sb-detail__actions">
                  <button
                    type="button"
                    className="sb-detail__jump-btn"
                    onClick={handleJump}
                    disabled={isStale}
                  >
                    この地点へ移動
                  </button>
                  <button
                    type="button"
                    className="sb-detail__delete-btn"
                    onClick={() =>
                      selectedPointer && handleDeleteMark(selectedPointer)
                    }
                  >
                    削除
                  </button>
                </div>
              </div>
            ) : (
              <div className="sb-modal__empty">マークを選択してください</div>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="sb-modal__footer">
          <span className="sb-modal__footer-hint">
            {"↑↓ / j/k: 選択移動  Enter: 移動  Esc: 閉じる"}
          </span>
        </footer>
      </div>
    </Modal>
  );
}

export default SecondBrainModal;
