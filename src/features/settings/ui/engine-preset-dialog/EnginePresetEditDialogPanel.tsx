import type { PresetId } from "@/entities/engine-presets";
import { evalOptionsFor } from "@/features/settings/lib/evalOptions";
import { multiPvMax } from "@/features/settings/lib/presetOptionValues";
import { useAiRootIndex } from "@/features/settings/model/useAiRootIndex";
import { usePresetDialog } from "@/features/settings/model/usePresetDialog";
import { SField, SInput, SSection } from "@/features/settings/ui/kit";
import Button from "@/shared/ui/Button/Button";
import Modal from "@/shared/ui/Modal";
import ModalFoot from "@/shared/ui/ModalFoot";
import ModalHead from "@/shared/ui/ModalHead";
import AnalysisSection from "./sections/AnalysisSection";
import EngineSettingsSection from "./sections/EngineSettingsSection";
import UsedFilesSection from "./sections/UsedFilesSection";
import "./EnginePresetEditDialogPanel.scss";

type Props = {
  presetId: PresetId;
  onClose: () => void;
};

/** プリセットを1枚で編集する別のモーダル。開いている間だけ描く。 */
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
        <ModalHead
          title={title}
          description="保存時にプリセットが更新され、必要なら自動でエンジンが再起動されます。"
          closable
        />

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
            fixed={evalOptionsFor(library.index?.profiles ?? [], draft.evalFilePath)}
          />
        </div>

        <ModalFoot start="※ 編集中は保存されません。保存で確定します。">
          <Button onClick={onClose}>キャンセル</Button>
          <Button tone="primary" onClick={dialog.save} disabled={probing}>
            保存
          </Button>
        </ModalFoot>
      </div>
    </Modal>
  );
}
