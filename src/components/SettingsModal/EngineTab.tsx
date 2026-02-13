import "./EngineTab.scss";
import type { EngineCandidate } from "@/commands/ai_library";
import { SButton, SSection } from "@/components/SettingsModal/ui";

type Props = {
  engines: EngineCandidate[];
  selected: string | null | undefined;
  onSelect: (entry: string | null) => void;
  enginesDir: string | null;
};

export default function EngineTab({
  engines,
  selected,
  onSelect,
  enginesDir,
}: Props) {
  const hasEngines = engines.length > 0;

  return (
    <div className="st-engine">
      <SSection
        title="エンジン"
        description={
          enginesDir ? (
            <>
              <code>{enginesDir}</code> 配下の候補から選びます。
            </>
          ) : (
            <>ai_root/engines 配下の候補から選びます。</>
          )
        }
        actions={
          <div className="st-engine__topActions">
            <span className="st-engine__selected">
              選択中: <code>{selected ?? "(未選択)"}</code>
            </span>
            <SButton
              variant="ghost"
              onClick={() => onSelect(null)}
              disabled={!selected}
            >
              解除
            </SButton>
          </div>
        }
      >
        {!hasEngines ? (
          <div className="st-engine__empty">
            engines/ の中に候補がありません（空です）。
          </div>
        ) : (
          <div className="st-engine__list" role="list">
            {engines.map((e) => {
              const isSelected = e.entry === selected;
              return (
                <button
                  key={e.entry}
                  type="button"
                  role="listitem"
                  className="st-engine__item"
                  data-selected={isSelected ? "true" : "false"}
                  onClick={() => onSelect(e.entry)}
                >
                  <div className="st-engine__itemTop">
                    <strong className="st-engine__itemName">{e.entry}</strong>
                    <span className="st-engine__itemKind">{e.kind}</span>
                  </div>
                  <div className="st-engine__itemPath">
                    <code>{e.path}</code>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="st-engine__note">
          ※ 候補一覧は <code>scanAiRoot</code> の結果です。最終的な起動可否は{" "}
          <code>checkEngineSetup</code> が決めます。
        </div>
      </SSection>
    </div>
  );
}
