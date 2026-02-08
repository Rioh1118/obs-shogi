import Modal from "@/components/Modal";
import { useURLParams } from "@/hooks/useURLParams";
import SettingsPanel from "./SettingsPanel";

export default function SettingsModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "settings";

  if (!isOpen) return null;

  return (
    <Modal onToggle={() => closeModal()} theme="dark">
      <SettingsPanel />
    </Modal>
  );
}
