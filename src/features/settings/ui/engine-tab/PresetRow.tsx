import type { KeyboardEvent, ReactNode } from "react";
import { AlertTriangle, Copy, Pencil, Trash2 } from "lucide-react";

import IconButton from "@/shared/ui/IconButton";
import SoftBreakText from "@/shared/ui/SoftBreakText";

import {
  bookInUse,
  type EnginePreset,
  isPresetConfigured,
  MULTIPV_OPTION,
} from "@/entities/engine-presets";
import { cx } from "@/features/settings/lib/cx";
import { fileLabel } from "@/features/settings/lib/fileChoices";
import { getBaseName } from "@/shared/lib/path";
import { engineDefaultOf, savedInt } from "@/features/settings/lib/presetOptionValues";

/** 行の間を動くキー。表（grid）を名乗るので、行の間は矢印で動く */
export type RowMoveKey = "ArrowUp" | "ArrowDown" | "Home" | "End";

const MOVE_KEYS: readonly string[] = ["ArrowUp", "ArrowDown", "Home", "End"] satisfies RowMoveKey[];
const isMoveKey = (key: string): key is RowMoveKey => MOVE_KEYS.includes(key);

type Props = {
  preset: EnginePreset;
  isSelected: boolean;
  /** Tab で止まる行か。表に止まるのは1行だけで、ほかの行へは矢印で動く */
  isTabStop: boolean;
  onMove: (key: RowMoveKey) => void;
  onFocusRow: () => void;
  /** 編集と複製を押せるか */
  canChange: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

function formatNumber(value: string | number, unit: string): string {
  const n = Number(value);
  const digits = Number.isFinite(n) ? n.toLocaleString("en-US") : String(value);
  return unit ? `${digits} ${unit}` : digits;
}

/** 数の欄。保存した値は太字、エンジンの初期値のままなら値の下に「初期値」と書く */
function NumberCell({
  preset,
  option,
  unit = "",
}: {
  preset: EnginePreset;
  option: string;
  unit?: string;
}) {
  const saved = savedInt(preset.options, option);
  if (saved !== null) {
    return (
      <span className="presetRow__num" role="cell">
        {formatNumber(saved, unit)}
      </span>
    );
  }

  const byEngine = engineDefaultOf(preset, option);
  return (
    <span className="presetRow__num presetRow__num--default" role="cell">
      {byEngine !== null && <span>{formatNumber(byEngine, unit)}</span>}
      <span className={byEngine === null ? undefined : "presetRow__defaultNote"}>初期値</span>
    </span>
  );
}

function FileCell({
  path,
  label,
  none,
  className,
}: {
  path: string;
  label: string;
  none: string;
  className: string;
}): ReactNode {
  return (
    <span className={cx("presetRow__file", className)} role="cell" title={path || undefined}>
      {path ? <SoftBreakText text={label} /> : none}
    </span>
  );
}

/** エンジン管理の1行。押すと適用し、中のボタンで編集、複製、削除へ渡す */
export default function PresetRow({
  preset,
  isSelected,
  isTabStop,
  onMove,
  onFocusRow,
  canChange,
  canDelete,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
}: Props) {
  const title = preset.label.trim() || "（無名プリセット）";

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // 中のボタンのキーも上がってくる。ここで受けるとボタンが押されなくなる
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
      return;
    }
    if (isMoveKey(e.key)) {
      e.preventDefault();
      onMove(e.key);
    }
  };

  return (
    <div
      className={cx("presetRow", isSelected && "is-selected")}
      role="row"
      aria-selected={isSelected}
      tabIndex={isTabStop ? 0 : -1}
      data-preset-id={preset.id}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocusRow();
      }}
    >
      <span className="presetRow__name" role="cell">
        <span className="presetRow__label">{title}</span>
        {isSelected && <span className="presetRow__now">適用中</span>}
        {!isPresetConfigured(preset) && (
          <span className="presetRow__needs">
            <AlertTriangle size={12} aria-hidden="true" />
            要設定
          </span>
        )}
      </span>

      <FileCell
        className="presetRow__engine"
        path={preset.enginePath}
        label={getBaseName(preset.enginePath)}
        none="未設定"
      />
      <FileCell
        className="presetRow__eval"
        path={preset.evalFilePath}
        label={fileLabel(preset.evalFilePath)}
        none="指定しない"
      />

      <span className="presetRow__book" role="cell" title={preset.bookFilePath ?? undefined}>
        {bookInUse(preset) ? "ON" : "OFF"}
      </span>

      <NumberCell preset={preset} option={MULTIPV_OPTION} />
      <NumberCell preset={preset} option="Threads" />
      <NumberCell preset={preset} option="USI_Hash" unit="MB" />

      <span className="presetRow__actions" role="cell" onClick={(e) => e.stopPropagation()}>
        <IconButton onClick={onEdit} ariaLabel="編集" title="編集" disabled={!canChange}>
          <Pencil size={15} />
        </IconButton>
        <IconButton onClick={onDuplicate} ariaLabel="複製" title="複製" disabled={!canChange}>
          <Copy size={15} />
        </IconButton>
        <IconButton
          className="presetRow__delete"
          onClick={onDelete}
          ariaLabel="削除"
          title="削除"
          disabled={!canDelete}
        >
          <Trash2 size={15} />
        </IconButton>
      </span>
    </div>
  );
}
