import Modal from "@/shared/ui/Modal";
import FileCreateForm from "@/components/FileTree/FileCreateForm";
import { useURLParams } from "@/hooks/useURLParams";
import { useMemo, useState } from "react";
import KifuImportForm from "./FileTree/KifuImportForm";
import "./CreateFileModal.scss";

type TabKey = "create" | "import";

function CreateFileModal() {
  const { params, closeModal } = useURLParams();
  const initialTab = useMemo<TabKey>(() => {
    const t = params.tab;
    return t === "import" ? "import" : "create";
  }, [params.tab]);
  const isOpen = params.modal === "create-file";

  const [tab, setTab] = useState<TabKey>(initialTab);

  if (!isOpen) return null;

  return (
    <Modal
      onClose={() => closeModal()}
      theme="light"
      variant="dialog"
      size="md"
      scroll="card"
    >
      <div className="create-file-modal">
        <div
          className="create-file-modal__tabs"
          role="tablist"
          aria-label="ファイル作成"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "create"}
            className={`create-file-modal__tab ${tab === "create" ? "is-active" : ""}`}
            onClick={() => setTab("create")}
          >
            新規作成
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "import"}
            className={`create-file-modal__tab ${tab === "import" ? "is-active" : ""}`}
            onClick={() => setTab("import")}
          >
            インポート
          </button>
        </div>

        <div className="create-file-modal__body">
          {tab === "create" ? (
            <FileCreateForm
              toggleModal={() => closeModal()}
              dirPath={params.dir || ""}
            />
          ) : (
            <KifuImportForm
              toggleModal={() => closeModal()}
              dirPath={params.dir || ""}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

export default CreateFileModal;
