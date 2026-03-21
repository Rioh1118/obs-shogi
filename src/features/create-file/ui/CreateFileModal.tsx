import Modal from "@/shared/ui/Modal";
import FileCreateForm from "@/features/create-file/ui/FileCreateForm";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useFileTree } from "@/entities/file-tree/model/useFileTree";
import { useMemo, useState } from "react";
import KifuImportForm from "./KifuImportForm";
import "./CreateFileModal.scss";

type TabKey = "create" | "import";

function CreateFileModal() {
  const { params, closeModal } = useURLParams();
  const { fileTree } = useFileTree();
  const initialTab = useMemo<TabKey>(() => {
    const t = params.tab;
    return t === "import" ? "import" : "create";
  }, [params.tab]);
  const isOpen = params.modal === "create-file";
  const hasSfen = !!params.sfen;

  const [tab, setTab] = useState<TabKey>(initialTab);

  // dir が指定されていなければ root を使う
  const dirPath = params.dir || fileTree?.path || "";

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
        {/* SFEN指定時（課題局面から）はタブを隠す */}
        {!hasSfen && (
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
        )}

        <div className="create-file-modal__body">
          {tab === "create" || hasSfen ? (
            <FileCreateForm
              toggleModal={() => closeModal()}
              dirPath={dirPath}
              initialSfen={params.sfen}
            />
          ) : (
            <KifuImportForm
              toggleModal={() => closeModal()}
              dirPath={dirPath}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

export default CreateFileModal;
