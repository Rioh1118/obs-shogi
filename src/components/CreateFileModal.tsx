import Modal from "@/components/Modal";
import FileCreateForm from "@/components/FileTree/FileCreateForm";
import { useURLParams } from "@/hooks/useURLParams";

function CreateFileModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "create-file";

  if (!isOpen) return null;

  return (
    <Modal
      onClose={() => closeModal()}
      theme="light"
      variant="dialog"
      size="md"
    >
      <FileCreateForm
        toggleModal={() => closeModal()}
        dirPath={params.dir || ""}
      />
    </Modal>
  );
}

export default CreateFileModal;
