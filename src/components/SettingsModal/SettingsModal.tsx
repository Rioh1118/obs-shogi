import Modal from "@/components/Modal";
import { useURLParams } from "@/hooks/useURLParams";
import SettingsPanel from "./SettingsPanel";

export default function SettingsModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "settings";

  if (!isOpen) return null;

  return (
    <Modal
      onClose={() => closeModal()}
      theme="dark"
      size="xl"
      padding="none"
      variant="dialog"
    >
      <SettingsPanel />
    </Modal>
  );
}
