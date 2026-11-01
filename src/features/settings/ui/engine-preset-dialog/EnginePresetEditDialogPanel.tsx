import type { PresetId } from "@/entities/engine-presets/model/types";
import { multiPvMax } from "@/features/settings/lib/presetOptionValues";
import { useAiRootIndex } from "@/features/settings/model/useAiRootIndex";
import { usePresetDialog } from "@/features/settings/model/usePresetDialog";
import { SField, SInput, SSection } from "@/features/settings/ui/kit";
import Modal from "@/shared/ui/Modal";
import PresetDialogFooter from "./PresetDialogFooter";
import PresetDialogHeader from "./PresetDialogHeader";
import AnalysisSection from "./sections/AnalysisSection";
import EngineSettingsSection from "./sections/EngineSettingsSection";
import UsedFilesSection from "./sections/UsedFilesSection";
import "./EnginePresetEditDialogPanel.scss";

type Props = {
  presetId: PresetId;
  onClose: () => void;
};

/** プリセットを1枚で編集する別窓。開いている間だけ描く。 */
export default function EnginePresetEditDialogPanel({ presetId, onClose }: Props) {
  const library = useAiRootIndex();
  const dialog = usePresetDialog({ presetId, index: library.index, onClose });
  const { draft, errors, probing } = dialog;

  if (!draft) return null;

  const title = draft.label.trim() || "プリセット編集";

  return (
    <Modal
      onClose={onClose}
      label={title}
      size="lg"
      variant="dialog"
      scroll="none"
      closeOnEsc={true}
      closeOnOverlay={true}
      showCloseButton={true}
    >
      <div className="presetDialog">
        <PresetDialogHeader title={title} />

        <div className="presetDialog__body">
          <SSection title="名前">
            <SField error={errors.label}>
              <SInput
                value={draft.label}
                aria-label="プリセットの名前"
                placeholder="例: 研究用 / 速い検討 / 定跡整備"
                onChange={(e) => dialog.setLabel(e.target.value)}
                invalid={!!errors.label}
              />
            </SField>
          </SSection>

          {library.scan.status === "error" && (
            <div className="presetDialog__hintWarn">{library.scan.error}</div>
          )}

          <UsedFilesSection
            draft={draft}
            enginePathError={errors.enginePath}
            library={library}
            onEngineChosen={dialog.chooseEngine}
            onEvalChosen={dialog.chooseEval}
            onBookChosen={dialog.chooseBook}
            onRetry={dialog.retryProbe}
            onStop={dialog.stopProbe}
            probing={probing}
            probeFailure={dialog.probeFailure}
          />

          <AnalysisSection
            draft={draft}
            setAnalysis={dialog.setAnalysis}
            setOption={dialog.setOption}
            multiPvMax={multiPvMax(draft)}
          />

          <EngineSettingsSection
            draft={draft}
            setOption={dialog.setOption}
            clearOptions={dialog.clearOptions}
            probing={probing}
            fitNote={dialog.fitNote}
          />
        </div>

        <PresetDialogFooter onClose={onClose} onSave={dialog.save} saveDisabled={probing} />
      </div>
    </Modal>
  );
}
