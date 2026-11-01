import type { KeyboardEvent, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Copy, Pencil, Trash2 } from "lucide-react";

import Button from "@/shared/ui/Button/Button";

import {
  bookInUse,
  isPresetConfigured,
  type EnginePreset,
} from "@/entities/engine-presets/model/types";
import { MULTIPV_OPTION } from "@/entities/engine-presets/model/multiPv";
import { cx } from "@/features/settings/lib/cx";
import { fileLabel } from "@/features/settings/lib/fileChoices";
import { getBaseName } from "@/shared/lib/path";
import {
  engineDefaultLabel,
  engineDefaultOf,
  savedInt,
} from "@/features/settings/lib/presetOptionValues";

type Props = {
  preset: EnginePreset;
  isSelected: boolean;
  /** 編集と複製を押せるか */
  canChange: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

function PresetStat({
  label,
  warn,
  children,
}: {
  label: string;
  warn?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="engineTab__mini">
      <div className="engineTab__miniK">{label}</div>
      <div className={cx("engineTab__miniV", warn && "is-warn")}>{children}</div>
    </div>
  );
}

/** エンジン管理の1枚。押すと適用し、中のボタンで編集、複製、削除へ渡す */
export default function PresetCard({
  preset,
  isSelected,
  canChange,
  canDelete,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
}: Props) {
  const configured = isPresetConfigured(preset);

  const multiPv = savedInt(preset.options, MULTIPV_OPTION);
  const threads = savedInt(preset.options, "Threads");
  const hash = savedInt(preset.options, "USI_Hash");

  const multiPvWarn = multiPv != null && multiPv >= 2;
  const title = preset.label.trim() || "（無名プリセット）";

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // 中のボタンのキーも上がってくる。ここで受けるとボタンが押されなくなる
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  };

  return (
    <article
      className={cx("engineTab__card", isSelected && "is-selected")}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <header className="engineTab__cardHead">
        <div className="engineTab__cardTitleRow">
          <div className="engineTab__cardTitle" title={title}>
            {title}
          </div>

          <div className="engineTab__badges">
            {isSelected && (
              <span className="engineTab__badge engineTab__badge--active">適用中</span>
            )}
            {!configured && (
              <span className="engineTab__badge engineTab__badge--warn">
                <AlertTriangle size={14} style={{ marginRight: 4 }} />
                要設定
              </span>
            )}
            {configured && (
              <span className="engineTab__badge engineTab__badge--ok">
                <CheckCircle2 size={14} style={{ marginRight: 4 }} />
                設定済み
              </span>
            )}
          </div>
        </div>

        <div className="engineTab__cardActions" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" onClick={onEdit} aria-label="編集" title="編集" disabled={!canChange}>
            <Pencil size={16} />
          </Button>

          <Button
            size="sm"
            onClick={onDuplicate}
            aria-label="複製"
            title="複製"
            disabled={!canChange}
          >
            <Copy size={16} />
          </Button>

          <Button
            tone="danger"
            size="sm"
            onClick={onDelete}
            aria-label="削除"
            title="削除"
            disabled={!canDelete}
          >
            <Trash2 size={16} />
          </Button>
        </div>
      </header>

      <div className="engineTab__cardBody">
        <div className="engineTab__row">
          <div className="engineTab__k">エンジン</div>
          <div className="engineTab__v" title={preset.enginePath || ""}>
            {preset.enginePath ? (
              getBaseName(preset.enginePath)
            ) : (
              <span className="engineTab__muted">未設定</span>
            )}
          </div>
        </div>

        <div className="engineTab__row">
          <div className="engineTab__k">評価関数</div>
          <div className="engineTab__v" title={preset.evalFilePath || ""}>
            {preset.evalFilePath ? (
              fileLabel(preset.evalFilePath)
            ) : (
              <span className="engineTab__muted">指定しない</span>
            )}
          </div>
        </div>

        <div className="engineTab__divider" />

        <div className="engineTab__miniGrid">
          <PresetStat label="候補手の数" warn={multiPvWarn}>
            {multiPv ?? engineDefaultLabel(engineDefaultOf(preset, MULTIPV_OPTION))}
          </PresetStat>
          <PresetStat label="Threads">
            {threads ?? engineDefaultLabel(engineDefaultOf(preset, "Threads"))}
          </PresetStat>
          <PresetStat label="Hash">
            {hash == null
              ? engineDefaultLabel(engineDefaultOf(preset, "USI_Hash"), "MB")
              : `${hash}MB`}
          </PresetStat>
          <PresetStat label="定跡">{bookInUse(preset) ? "ON" : "OFF"}</PresetStat>
        </div>

        {multiPvWarn && (
          <div className="engineTab__note">
            候補手の数を増やすと 1手あたりの読みが浅くなります（研究向けの “幅 vs 深さ”
            トレードオフ）。
          </div>
        )}
      </div>
    </article>
  );
}
