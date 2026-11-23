import { useMemo, useRef, useState } from "react";
import "./EngineTab.scss";

import { Plus, RefreshCcw } from "lucide-react";

import Button from "@/shared/ui/Button/Button";
import SSection from "../kit/SSection";

import EnginePresetEditDialogPanel from "../engine-preset-dialog/EnginePresetEditDialogPanel";
import MateSearchSection from "../engine-tab/MateSearchSection";
import PresetRow, { type RowMoveKey } from "../engine-tab/PresetRow";
import {
  type EnginePreset,
  MULTIPV_OPTION,
  type PresetId,
  useEnginePresets,
} from "@/entities/engine-presets";
import { savedInt } from "@/features/settings/lib/presetOptionValues";
import { useScrollMore } from "@/shared/lib/useScrollMore";

/** 適用中を先頭にして、残りは名前順に並べる */
function sortForList(presets: EnginePreset[], selectedId: PresetId | null) {
  return [...presets].sort((a, b) => {
    if (a.id === selectedId) return -1;
    if (b.id === selectedId) return 1;
    return a.label.localeCompare(b.label);
  });
}

export default function EngineTab() {
  const { state, reload, selectPreset, createPreset, duplicatePreset, deletePreset } =
    useEnginePresets();

  const [editingId, setEditingId] = useState<PresetId | null>(null);

  const selectedId = state.selectedPresetId;
  const presets = state.presets;

  const sorted = useMemo(() => sortForList(presets, selectedId), [presets, selectedId]);

  // 書けないファイル（新しい版、読めない、移せなかった）では変更の操作を押せなくする。
  // 理由は帯が出す（`PresetsFileBridge`）
  const readOnly = !state.writable;

  const handleDelete = async (preset: EnginePreset) => {
    const name = preset.label.trim() || "このプリセット";
    if (!window.confirm(`${name} を削除します。よろしいですか？`)) return;
    await deletePreset(preset.id);
  };

  const listRef = useScrollMore<HTMLDivElement>();

  // 表（grid）には Tab で1度だけ入り、行の間は矢印で動く。止まるのは最後に触れた行で、
  // まだどの行にも触れていなければ先頭（適用中）。全部の行を Tab の順に並べると、grid を名乗る意味が無い
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [focusId, setFocusId] = useState<PresetId | null>(null);
  const tabStopId = sorted.some((p) => p.id === focusId) ? focusId : (sorted[0]?.id ?? null);
  const moveFocus = (from: PresetId, key: RowMoveKey) => {
    const at = sorted.findIndex((p) => p.id === from);
    const last = sorted.length - 1;
    const step = key === "ArrowDown" ? 1 : -1;
    const next = key === "Home" ? 0 : key === "End" ? last : Math.min(last, Math.max(0, at + step));
    const id = sorted[next]?.id;
    if (id === undefined) return;
    setFocusId(id);
    const rows = tableRef.current?.querySelectorAll<HTMLElement>("[data-preset-id]") ?? [];
    [...rows].find((el) => el.dataset.presetId === id)?.focus();
  };

  const hasMany = presets.some((p) => (savedInt(p.options, MULTIPV_OPTION) ?? 1) >= 2);

  return (
    <div className="engineTab">
      {/* 数の決まった設定を上、増える一覧を下に置く。一覧だけが送られ、上は動かない */}
      <MateSearchSection presets={presets} />

      <SSection
        title="検討プリセット"
        count={presets.length}
        description="エンジンの起動設定・検討の基本設定をプリセットとして管理します。保存時に必要なら自動でエンジンが再起動されます。"
        actions={
          <>
            <Button size="sm" onClick={() => reload()} isLoading={state.status === "loading"}>
              <RefreshCcw size={13} aria-hidden="true" />
              もう一度読み込む
            </Button>
            <Button
              tone="accent"
              size="sm"
              onClick={() => createPreset({ label: "新規プリセット" })}
              disabled={state.status === "loading" || readOnly}
            >
              <Plus size={13} aria-hidden="true" />
              追加
            </Button>
          </>
        }
      >
        {state.status === "error" && (
          <p className="engineTab__error" role="alert">
            {state.error}
          </p>
        )}

        {state.status === "loading" && presets.length === 0 ? (
          <p className="engineTab__loading">読み込み中…</p>
        ) : (
          <div className="presetList" ref={listRef}>
            <div
              className="presetList__table"
              role="grid"
              aria-label="検討プリセット"
              ref={tableRef}
            >
              <div className="presetList__head" role="row">
                <span role="columnheader">名前</span>
                <span role="columnheader">エンジン</span>
                <span className="presetList__evalHead" role="columnheader">
                  評価関数
                </span>
                <span role="columnheader">定跡</span>
                <span className="presetList__numHead" role="columnheader">
                  候補手の数
                </span>
                <span className="presetList__numHead" role="columnheader">
                  Threads
                </span>
                <span className="presetList__numHead" role="columnheader">
                  Hash
                </span>
                <span role="columnheader" aria-label="操作" />
              </div>

              {sorted.map((p) => (
                <PresetRow
                  key={p.id}
                  preset={p}
                  isSelected={p.id === selectedId}
                  isTabStop={p.id === tabStopId}
                  onMove={(key) => moveFocus(p.id, key)}
                  onFocusRow={() => setFocusId(p.id)}
                  canChange={!readOnly}
                  canDelete={!readOnly && presets.length > 1}
                  onSelect={() => selectPreset(p.id)}
                  onEdit={() => setEditingId(p.id)}
                  onDuplicate={() => duplicatePreset(p.id)}
                  onDelete={() => handleDelete(p)}
                />
              ))}
            </div>

            {hasMany && (
              <p className="engineTab__note">
                候補手の数を増やすと 1手あたりの読みが浅くなります（研究向けの “幅 vs 深さ”
                トレードオフ）。
              </p>
            )}
          </div>
        )}
      </SSection>

      {editingId && (
        <EnginePresetEditDialogPanel presetId={editingId} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}
