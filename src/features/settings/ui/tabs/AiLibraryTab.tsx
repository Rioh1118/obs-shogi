import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./AiLibraryTab.scss";

import { FolderOpen, Copy, Sparkles } from "lucide-react";

import { SButton, SField, SInput, SSection } from "../kit";
import { useAppConfig } from "@/entities/app-config";

import {
  scanAiRoot,
  ensureEnginesDir,
  type AiRootIndex,
  type FsKind,
  type ProfileCandidate,
} from "@/entities/engine/api/aiLibrary";

import { revealInFileManager } from "@/shared/api/shell/revealInFileManager";
import { copyText } from "@/shared/api/clipboard/copyText";
import SetupGuide, {
  type SetupGuideProfile,
} from "../ai-library-tab/SetupGuide";
import { createDir } from "@/entities/file-tree/api/service";

function normalizePath(p: string) {
  return (p ?? "").replace(/\\/g, "/");
}

function isDir(kind: FsKind) {
  return kind === "dir";
}

function profileHealth(p: ProfileCandidate) {
  const okEval = p.has_eval_dir && p.eval_files.length > 0;
  const okBook = p.has_book_dir && p.book_db_files.length > 0;
  return { okEval, okBook };
}

type ScanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: AiRootIndex; at: number }
  | { status: "error"; error: string };

export default function AiLibraryTab() {
  const { config, chooseAiRoot } = useAppConfig();

  const aiRoot = config?.ai_root ?? "";
  const [localAiRoot, setLocalAiRoot] = useState(aiRoot);

  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const didInitRef = useRef(false);

  useEffect(() => {
    setLocalAiRoot(aiRoot);
  }, [aiRoot]);

  const canOperate = localAiRoot.trim().length > 0;

  const scanNow = useCallback(async (root: string) => {
    const r = root.trim();
    if (!r) {
      setScan({ status: "idle" });
      return;
    }

    setScan({ status: "loading" });

    try {
      const data = await scanAiRoot(r);
      setScan({ status: "ready", data, at: Date.now() });
    } catch (e) {
      setScan({
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  const onCreateAiFolder = useCallback(
    async (aiName: string) => {
      const root = localAiRoot.trim();
      const name = aiName.trim();

      if (!root || !name) return;

      const profileRes = await createDir(root, name);
      if (!profileRes.success) {
        setScan({
          status: "error",
          error: String(profileRes.error),
        });
        return;
      }

      const profilePath = profileRes.data;

      const evalRes = await createDir(profilePath, "eval");
      if (!evalRes.success) {
        setScan({
          status: "error",
          error: `「${name}」フォルダは作成できましたが、eval/ の作成に失敗しました: ${String(evalRes.error)}`,
        });
        await scanNow(root);
        return;
      }

      const bookRes = await createDir(profilePath, "book");
      if (!bookRes.success) {
        setScan({
          status: "error",
          error: `「${name}」フォルダと eval/ は作成できましたが、book/ の作成に失敗しました: ${String(bookRes.error)}`,
        });
        await scanNow(root);
        return;
      }

      await scanNow(root);
    },
    [localAiRoot, scanNow],
  );

  const refresh = useCallback(async () => {
    await scanNow(localAiRoot);
  }, [localAiRoot, scanNow]);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    if (localAiRoot.trim()) {
      void refresh();
    }
  }, [localAiRoot, refresh]);

  const data = scan.status === "ready" ? scan.data : null;

  const warnings = useMemo(() => {
    if (!data) return [] as string[];

    const ws: string[] = [];

    if (!data.engines_dir.exists || !isDir(data.engines_dir.kind)) {
      ws.push("engines/ が見つかりません。『engines/ を作成』で生成できます。");
    }

    if ((data.engines?.length ?? 0) === 0) {
      ws.push(
        "engine ファイルが未検出です。engines/ 配下に YaneuraOu を置いてください。",
      );
    }

    for (const p of data.profiles ?? []) {
      const { okEval, okBook } = profileHealth(p);

      if (!okEval) {
        ws.push(
          `「${p.name}」: eval が未検出です（<AI名>/eval に nn.bin など）。`,
        );
      }

      if (!okBook) {
        ws.push(
          `「${p.name}」: book は未設定でも構いませんが、使うなら <AI名>/book に .db を置きます。`,
        );
      }
    }

    return ws;
  }, [data]);

  const enginesCount = data?.engines?.length ?? 0;

  const guideProfiles = useMemo<SetupGuideProfile[]>(() => {
    return (
      data?.profiles.map((p) => ({
        name: p.name,
        path: p.path,
        hasEvalDir: p.has_eval_dir,
        hasBookDir: p.has_book_dir,
        evalCount: p.eval_files.length,
        bookCount: p.book_db_files.length,
      })) ?? []
    );
  }, [data]);

  const badge = useMemo(() => {
    if (!canOperate) return { tone: "warn" as const, text: "未設定" };
    if (scan.status === "loading") {
      return { tone: "muted" as const, text: "診断中…" };
    }
    if (scan.status === "error") {
      return { tone: "danger" as const, text: "エラー" };
    }
    if (scan.status === "ready") {
      return warnings.length > 0
        ? { tone: "warn" as const, text: "注意あり" }
        : { tone: "accent" as const, text: "OK" };
    }
    return { tone: "muted" as const, text: "—" };
  }, [canOperate, scan.status, warnings.length]);

  const onPick = useCallback(async () => {
    const picked = await chooseAiRoot?.({ force: true });
    if (!picked) return;

    setLocalAiRoot(picked);
    await scanNow(picked);
  }, [chooseAiRoot, scanNow]);

  const onEnsureEngines = useCallback(async () => {
    const root = localAiRoot.trim();
    if (!root) return;

    setScan({ status: "loading" });

    try {
      await ensureEnginesDir(root);
      await scanNow(root);
    } catch (e) {
      setScan({
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, [localAiRoot, scanNow]);

  const onOpenAiRoot = useCallback(() => {
    if (!localAiRoot.trim()) return;
    void revealInFileManager(localAiRoot);
  }, [localAiRoot]);

  const enginesDirPath = useMemo(() => {
    return (
      data?.engines_dir?.path ||
      (localAiRoot ? `${normalizePath(localAiRoot)}/engines` : "")
    );
  }, [data?.engines_dir?.path, localAiRoot]);

  const onOpenEnginesDir = useCallback(() => {
    if (!enginesDirPath.trim()) return;
    void revealInFileManager(enginesDirPath);
  }, [enginesDirPath]);

  const enginesDirOk = !!(
    data?.engines_dir?.exists && isDir(data.engines_dir.kind)
  );

  const scanStatusForGuide = useMemo<
    "idle" | "loading" | "ok" | "error"
  >(() => {
    switch (scan.status) {
      case "idle":
        return "idle";
      case "loading":
        return "loading";
      case "ready":
        return "ok";
      case "error":
        return "error";
    }
  }, [scan.status]);

  const scanError = scan.status === "error" ? scan.error : null;

  return (
    <div className="aiLibraryTab">
      <div className="aiLibraryTab__grid">
        <div className="aiLibraryTab__mainCol">
          <SSection
            title="AIライブラリ"
            description="engine・評価関数・定跡をまとめて管理する場所です。まずは置き場フォルダを1つ決めるのがおすすめです。"
            actions={
              <div className="aiLibraryTab__badge" data-tone={badge.tone}>
                {badge.text}
              </div>
            }
          >
            <SField
              label="AIの置き場フォルダ"
              description="このアプリでは、決めた構造で置くことで自動検出しやすくしています。"
              right={
                <div className="aiLibraryTab__fieldActions">
                  <SButton variant="primary" size="sm" onClick={onPick}>
                    <FolderOpen size={16} style={{ marginRight: 6 }} />
                    選択…
                  </SButton>

                  <SButton
                    variant="ghost"
                    size="sm"
                    onClick={onOpenAiRoot}
                    disabled={!canOperate}
                    title="Finder / Explorer で開く"
                  >
                    開く
                  </SButton>

                  <SButton
                    variant="ghost"
                    size="sm"
                    onClick={() => void copyText(localAiRoot)}
                    disabled={!canOperate}
                    title="場所をコピー"
                  >
                    <Copy size={16} />
                  </SButton>
                </div>
              }
            >
              <SInput
                value={localAiRoot}
                placeholder="未設定（まずは『選択…』からフォルダを選んでください）"
                readOnly
              />
            </SField>

            <div className="aiLibraryTab__rowActions">
              {!enginesDirOk && (
                <SButton
                  variant="subtle"
                  size="sm"
                  onClick={() => void onEnsureEngines()}
                  disabled={!canOperate || scan.status === "loading"}
                  isLoading={scan.status === "loading"}
                >
                  <Sparkles size={16} style={{ marginRight: 6 }} />
                  engines/ を作成
                </SButton>
              )}

              <SButton
                variant="ghost"
                size="sm"
                onClick={onOpenEnginesDir}
                disabled={!canOperate}
                title="engines/ を開く"
              >
                engines/ を開く
              </SButton>

              <SButton
                variant="ghost"
                size="sm"
                onClick={() => void refresh()}
                disabled={!canOperate || scan.status === "loading"}
                isLoading={scan.status === "loading"}
              >
                再スキャン
              </SButton>
            </div>

            {scan.status === "error" && (
              <div className="aiLibraryTab__error" role="alert">
                {scan.error}
              </div>
            )}
          </SSection>
        </div>

        <SetupGuide
          aiRootPath={localAiRoot || null}
          scanStatus={scanStatusForGuide}
          scanError={scanError}
          enginesDirExists={enginesDirOk}
          enginesDirPath={enginesDirPath}
          enginesCount={enginesCount}
          profiles={guideProfiles}
          warnings={warnings}
          onChooseAiRoot={onPick}
          onRescan={() => void refresh()}
          onCreateEnginesDir={() => void onEnsureEngines()}
          onOpenAiRoot={onOpenAiRoot}
          onOpenEnginesDir={onOpenEnginesDir}
          onCreateAiFolder={onCreateAiFolder}
        />
      </div>
    </div>
  );
}
