// src/components/PositionNavigationModal/InfoBar.tsx
import React from "react";
import type { NavigationState, PreviewData } from "@/types/branchNav";

type Props = {
  navigationState: NavigationState;
  previewData: PreviewData | null;
};

const InfoBar: React.FC<Props> = ({ navigationState, previewData }) => {
  const { preview, selectedFork } = navigationState;
  const tesuu = previewData?.tesuu ?? preview.tesuu;

  return (
    <div className="position-navigation-modal__info-bar">
      <span>手数: {tesuu}</span>
      <span>選択中変化: {selectedFork}</span>
    </div>
  );
};

export default InfoBar;
