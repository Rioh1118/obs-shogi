import { useSearchParams, useNavigate } from "react-router";
import { useCallback, useMemo } from "react";

export type ModalType = "navigation" | "analysis" | "settings" | "create-file";

export interface URLParams {
  modal?: ModalType;
  tesuu?: number;
  branch?: string;
  dir?: string;
  tab?: string;
}

type UpdateOptions = { replace?: boolean };

export function useURLParams() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // 現在のURLパラメータを取得
  const params: URLParams = useMemo(() => {
    return {
      tesuu: searchParams.get("tesuu")
        ? Number(searchParams.get("tesuu"))
        : undefined,
      branch: searchParams.get("branch") || undefined,
      modal: (searchParams.get("modal") as URLParams["modal"]) || undefined,
      dir: searchParams.get("dir") || undefined,
      tab: searchParams.get("tab") || undefined,
    };
  }, [searchParams]);

  // URLパラメータを更新
  const updateParams = useCallback(
    (
      newParams: Partial<URLParams>,
      opts: UpdateOptions = { replace: true },
    ) => {
      const currentParams = new URLSearchParams(searchParams);

      // 新しいパラメータを設定
      Object.entries(newParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          currentParams.set(key, String(value));
        } else {
          currentParams.delete(key);
        }
      });

      // URLを更新
      navigate(`?${currentParams.toString()}`, {
        replace: opts.replace ?? true,
      });
    },
    [searchParams, navigate],
  );

  // モーダルを開く
  const openModal = useCallback(
    (
      modalType: URLParams["modal"],
      extra?: Partial<URLParams>,
      opts?: UpdateOptions,
    ) => {
      updateParams(
        {
          ...extra,
          modal: modalType,
        },
        { replace: opts?.replace ?? false },
      );
    },
    [updateParams],
  );

  // モーダルを閉じる
  const closeModal = useCallback(() => {
    updateParams({ modal: undefined, dir: undefined, tab: undefined });
  }, [updateParams]);

  // 局面移動
  const navigateToPosition = useCallback(
    (tesuu: number, branch?: string) => {
      updateParams({ tesuu, branch, modal: undefined });
    },
    [updateParams],
  );

  return {
    params,
    updateParams,
    openModal,
    closeModal,
    navigateToPosition,
  };
}
