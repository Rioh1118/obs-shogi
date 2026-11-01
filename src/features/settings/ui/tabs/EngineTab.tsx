import { useMemo, useState } from "react";
import "./EngineTab.scss";

import { Plus, RefreshCcw } from "lucide-react";

import Button from "@/shared/ui/Button/Button";
import SSection from "../kit/SSection";

import EnginePresetEditDialogPanel from "../engine-preset-dialog/EnginePresetEditDialogPanel";
import PresetCard from "../engine-tab/PresetCard";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";
import type { EnginePreset, PresetId } from "@/entities/engine-presets/model/types";

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

  return (
    <div className="engineTab">
      <SSection
        title="検討プリセット"
        description="エンジンの起動設定・検討の基本設定をプリセットとして管理します。保存時に必要なら自動でエンジンが再起動されます。"
        actions={
          <div className="engineTab__actions">
            <Button size="sm" onClick={() => reload()} isLoading={state.status === "loading"}>
              <RefreshCcw size={16} style={{ marginRight: 6 }} />
              もう一度読み込む
            </Button>
            <Button
              tone="accent"
              size="sm"
              onClick={() => createPreset({ label: "新規プリセット" })}
              disabled={state.status === "loading" || readOnly}
            >
              <Plus size={16} style={{ marginRight: 6 }} />
              追加
            </Button>
          </div>
        }
      >
        {state.status === "error" && (
          <div className="engineTab__error" role="alert">
            {state.error}
          </div>
        )}

        {state.status === "loading" && presets.length === 0 ? (
          <div className="engineTab__loading">読み込み中…</div>
        ) : (
          <div className="engineTab__grid">
            {sorted.map((p) => (
              <PresetCard
                key={p.id}
                preset={p}
                isSelected={p.id === selectedId}
                canChange={!readOnly}
                canDelete={!readOnly && presets.length > 1}
                onSelect={() => selectPreset(p.id)}
                onEdit={() => setEditingId(p.id)}
                onDuplicate={() => duplicatePreset(p.id)}
                onDelete={() => handleDelete(p)}
              />
            ))}
          </div>
        )}
      </SSection>

      {editingId && (
        <EnginePresetEditDialogPanel
          presetId={editingId}
          open={true}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
