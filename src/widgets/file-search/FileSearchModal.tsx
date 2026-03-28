import { useState, useMemo } from "react";
import Modal from "@/shared/ui/Modal";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import "./FileSearchModal.scss";

//File 検索のところ
//cssは、設定を参考
//UIは保留中...

type Props = {
  files: string[];
  onSelect: (file: string) => void;
};

type View = "search" | "feature1" | "feature2";

const SEARCH_TABS = [
  { key: "search", label: "検索", desc: "ファイル検索等" },
  { key: "feature1", label: "機能1", desc: "追加機能1" },
  { key: "feature2", label: "機能2", desc: "追加機能2" },
] as const;

export default function FileSearchModal({ files, onSelect }: Props) {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "file-search";
  const [view, setView] = useState<View>("search");

  const [query, setQuery] = useState("");

  const filteredFiles = useMemo(() => {
    return files.filter((f) => f.toLowerCase().includes(query.toLowerCase()));
  }, [files, query]);

  if (!isOpen) return null;
  const activeTab = SEARCH_TABS.find((t) => t.key === view)!;

  return (
    <Modal onClose={closeModal} padding="none">
      <div className="settings">
        <header className="settings__header">
          <div className="settings__title">
            <div className="settings__titleMain">{activeTab.label}</div>
            <div className="settings__titleSub">{activeTab.desc}</div>
          </div>
        </header>

        <div className="settings__body">
          <nav className="settings__nav">
            <div className="settings__navGroup">
              {SEARCH_TABS.map((tab) => {
                const isActive = view === tab.key;

                return (
                  <button
                    key={tab.key}
                    className={`settings__navItem ${isActive ? "active" : ""}`}
                    onClick={() => setView(tab.key)}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </nav>

          <main className="settings__main">
            <section className="settings__content">
              {view === "search" && (
                <>
                  <input
                    autoFocus
                    placeholder="ファイルを検索..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="settings__input"
                  />

                  {filteredFiles.map((file) => (
                    <div
                      key={file}
                      className="settings__card"
                      onClick={() => {
                        onSelect(file);
                        closeModal();
                      }}
                    >
                      {file}
                    </div>
                  ))}

                  {filteredFiles.length === 0 && (
                    <div className="settings__empty">ファイルが見つかりません</div>
                  )}
                </>
              )}

              {view === "feature1" && <div className="settings__panel">機能1のUI</div>}

              {view === "feature2" && <div className="settings__panel">機能2のUI</div>}
            </section>
          </main>
        </div>
      </div>
    </Modal>
  );
}
