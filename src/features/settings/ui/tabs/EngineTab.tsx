import { useEffect, useMemo, useState } from "react";
import "./EngineTab.scss";

import {
  Plus,
  Pencil,
  Copy,
  Trash2,
  RefreshCcw,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

import SButton from "../kit/SButton";
import SSection from "../kit/SSection";

import EnginePresetEditDialogPanel from "../engine-preset-dialog/EnginePresetEditDialogPanel";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";
import {
  isPresetConfigured,
  type PresetId,
} from "@/entities/engine-presets/model/types";
import { DEFAULT_USI_OPTIONS } from "@/entities/engine-presets/model/defaultOptions";

const cx = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(" ");

function basename(p: string) {
  const s = (p ?? "").replace(/\\/g, "/");
  const last = s.split("/").filter(Boolean).pop();
  return last || (p ?? "");
}

function optionNum(
  options: Record<string, string> | undefined,
  key: string,
  fallback: string,
) {
  const raw = options?.[key] ?? fallback;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : Number.parseInt(fallback, 10);
}

export default function EngineTab() {
  const {
    state,
    reload,
    selectPreset,
    createPreset,
    duplicatePreset,
    deletePreset,
  } = useEnginePresets();

  const [editingId, setEditingId] = useState<PresetId | null>(null);

  const selectedId = state.selectedPresetId;
  const presets = state.presets;

  const sorted = useMemo(() => {
    const xs = [...presets];
    xs.sort((a, b) => {
      if (a.id === selectedId) return -1;
      if (b.id === selectedId) return 1;
      return a.label.localeCompare(b.label);
    });
    return xs;
  }, [presets, selectedId]);

  useEffect(() => {
    console.log(selectedId);
  }, [selectedId]);

  const onAdd = async () => {
    await createPreset({ label: "新規プリセット" });
  };

  const onDup = async (id: PresetId) => {
    // duplicatePreset は今の実装だと「新しいid」を返さないので、ここでは作るだけにする
    await duplicatePreset(id);
  };

  const onDelete = async (id: PresetId) => {
    const p = state.presets.find((x) => x.id === id);
    const name = p?.label?.trim() || "このプリセット";
    if (!window.confirm(`${name} を削除します。よろしいですか？`)) return;
    await deletePreset(id);
  };

  return (
    <div className="engineTab">
      <SSection
        title="解析プリセット"
        description="エンジンの起動設定・解析の基本設定をプリセットとして管理します。保存時に必要なら自動でエンジンが再起動されます。"
        actions={
          <div className="engineTab__actions">
            <SButton
              variant="ghost"
              size="sm"
              onClick={() => reload()}
              isLoading={state.status === "loading"}
            >
              <RefreshCcw size={16} style={{ marginRight: 6 }} />
              再読み込み
            </SButton>
            <SButton
              variant="primary"
              size="sm"
              onClick={onAdd}
              disabled={state.status === "loading"}
            >
              <Plus size={16} style={{ marginRight: 6 }} />
              追加
            </SButton>
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
            {sorted.map((p) => {
              const configured = isPresetConfigured(p);
              const isSelected = p.id === selectedId;

              const multiPv = optionNum(
                p.options,
                "MultiPV",
                DEFAULT_USI_OPTIONS.MultiPV,
              );
              const threads = optionNum(
                p.options,
                "Threads",
                DEFAULT_USI_OPTIONS.Threads,
              );
              const hash = optionNum(
                p.options,
                "USI_Hash",
                DEFAULT_USI_OPTIONS.USI_Hash,
              );

              const multiPvWarn = multiPv >= 2; // 研究用途ではOKだが注意
              const title = p.label?.trim() || "（無名プリセット）";

              return (
                <article
                  key={p.id}
                  className={cx("engineTab__card", isSelected && "is-selected")}
                  onClick={() => selectPreset(p.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectPreset(p.id);
                    }
                  }}
                >
                  <header className="engineTab__cardHead">
                    <div className="engineTab__cardTitleRow">
                      <div className="engineTab__cardTitle" title={title}>
                        {title}
                      </div>

                      <div className="engineTab__badges">
                        {isSelected && (
                          <span className="engineTab__badge engineTab__badge--active">
                            適用中
                          </span>
                        )}
                        {!configured && (
                          <span className="engineTab__badge engineTab__badge--warn">
                            <AlertTriangle
                              size={14}
                              style={{ marginRight: 4 }}
                            />
                            要設定
                          </span>
                        )}
                        {configured && (
                          <span className="engineTab__badge engineTab__badge--ok">
                            <CheckCircle2
                              size={14}
                              style={{ marginRight: 4 }}
                            />
                            設定済み
                          </span>
                        )}
                      </div>
                    </div>

                    <div
                      className="engineTab__cardActions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <SButton
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(p.id)}
                        aria-label="編集"
                        title="編集"
                      >
                        <Pencil size={16} />
                      </SButton>

                      <SButton
                        variant="ghost"
                        size="sm"
                        onClick={() => onDup(p.id)}
                        aria-label="複製"
                        title="複製"
                      >
                        <Copy size={16} />
                      </SButton>

                      <SButton
                        variant="danger"
                        size="sm"
                        onClick={() => onDelete(p.id)}
                        aria-label="削除"
                        title="削除"
                        disabled={presets.length <= 1}
                      >
                        <Trash2 size={16} />
                      </SButton>
                    </div>
                  </header>

                  <div className="engineTab__cardBody">
                    <div className="engineTab__row">
                      <div className="engineTab__k">AI名</div>
                      <div className="engineTab__v">
                        {p.aiName?.trim() || (
                          <span className="engineTab__muted">未設定</span>
                        )}
                      </div>
                    </div>

                    <div className="engineTab__row">
                      <div className="engineTab__k">エンジン</div>
                      <div className="engineTab__v" title={p.enginePath || ""}>
                        {p.enginePath ? (
                          basename(p.enginePath)
                        ) : (
                          <span className="engineTab__muted">未設定</span>
                        )}
                      </div>
                    </div>

                    <div className="engineTab__row">
                      <div className="engineTab__k">評価関数</div>
                      <div
                        className="engineTab__v"
                        title={p.evalFilePath || ""}
                      >
                        {p.evalFilePath ? (
                          basename(p.evalFilePath)
                        ) : (
                          <span className="engineTab__muted">未設定</span>
                        )}
                      </div>
                    </div>

                    <div className="engineTab__divider" />

                    <div className="engineTab__miniGrid">
                      <div className="engineTab__mini">
                        <div className="engineTab__miniK">MultiPV</div>
                        <div
                          className={cx(
                            "engineTab__miniV",
                            multiPvWarn && "is-warn",
                          )}
                        >
                          {multiPv}
                        </div>
                      </div>
                      <div className="engineTab__mini">
                        <div className="engineTab__miniK">Threads</div>
                        <div className="engineTab__miniV">{threads}</div>
                      </div>
                      <div className="engineTab__mini">
                        <div className="engineTab__miniK">Hash</div>
                        <div className="engineTab__miniV">{hash}MB</div>
                      </div>
                      <div className="engineTab__mini">
                        <div className="engineTab__miniK">Book</div>
                        <div className="engineTab__miniV">
                          {p.bookEnabled ? "ON" : "OFF"}
                        </div>
                      </div>
                    </div>

                    {multiPvWarn && (
                      <div className="engineTab__note">
                        MultiPV を増やすと
                        1手あたりの読みが浅くなります（研究向けの “幅 vs 深さ”
                        トレードオフ）。
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
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
