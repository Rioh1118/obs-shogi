import { useSearchParams, useNavigate } from "react-router";
import { useCallback } from "react";

export interface URLParams {
  tesuu?: number;
  branch?: string;
  modal?: 'navigation' | 'analysis' | 'settings';
}

export function useURLParams() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // 現在のURLパラメータを取得
  const params: URLParams = {
    tesuu: searchParams.get('tesuu') ? Number(searchParams.get('tesuu')) : undefined,
    branch: searchParams.get('branch') || undefined,
    modal: searchParams.get('modal') as URLParams['modal'] || undefined,
  };

  // URLパラメータを更新
  const updateParams = useCallback((newParams: Partial<URLParams>) => {
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
    navigate(`?${currentParams.toString()}`, { replace: true });
  }, [searchParams, navigate]);

  // モーダルを開く
  const openModal = useCallback((modalType: URLParams['modal']) => {
    updateParams({ modal: modalType });
  }, [updateParams]);

  // モーダルを閉じる
  const closeModal = useCallback(() => {
    updateParams({ modal: undefined });
  }, [updateParams]);

  // 局面移動
  const navigateToPosition = useCallback((tesuu: number, branch?: string) => {
    updateParams({ tesuu, branch, modal: undefined });
  }, [updateParams]);

  return {
    params,
    updateParams,
    openModal,
    closeModal,
    navigateToPosition,
  };
}
