import React, { useState, useCallback } from "react";
import EngineAPI, { type EngineInfo } from "@/commands/engine";
import "./EngineSetup.scss";

interface EngineSetupProps {
  onEngineReady: (engineInfo: EngineInfo | null) => void;
  onError: (error: string) => void;
}

export const EngineSetup: React.FC<EngineSetupProps> = ({
  onEngineReady,
  onError,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [isReady, setIsReady] = useState(false);

  const setupEngine = useCallback(async () => {
    setIsLoading(true);
    try {
      const info = await EngineAPI.setupYaneuraOuEngine();
      setEngineInfo(info);
      setIsReady(true);
      onEngineReady(info);
      console.log("✅ Engine setup completed:", info?.name);
    } catch (err) {
      const errorMsg = `Engine setup failed: ${err}`;
      onError(errorMsg);
      setIsReady(false);
    } finally {
      setIsLoading(false);
    }
  }, [onEngineReady, onError]);

  const shutdownEngine = useCallback(async () => {
    try {
      await EngineAPI.shutdownEngine();
      setEngineInfo(null);
      setIsReady(false);
      console.log("🛑 Engine shutdown completed");
    } catch (err) {
      onError(`Engine shutdown failed: ${err}`);
    }
  }, [onError]);

  return (
    <div className="engine-setup">
      <h3 className="engine-setup__title">Engine Setup</h3>

      <div className="engine-setup__status">
        <div
          className={`engine-setup__indicator ${isReady ? "ready" : "not-ready"}`}
        />
        <span className="engine-setup__status-text">
          {isReady ? "Engine Ready" : "Engine Not Ready"}
        </span>
      </div>

      {engineInfo && (
        <div className="engine-setup__info">
          <p>
            <strong>Engine:</strong> {engineInfo.name}
          </p>
          <p>
            <strong>Author:</strong> {engineInfo.author}
          </p>
          <p>
            <strong>Options:</strong> {engineInfo.options.length} available
          </p>
        </div>
      )}

      <div className="engine-setup__controls">
        <button
          onClick={setupEngine}
          disabled={isLoading || isReady}
          className="engine-setup__button engine-setup__button--setup"
        >
          {isLoading ? "Setting up..." : "Setup Engine"}
        </button>

        <button
          onClick={shutdownEngine}
          disabled={!isReady}
          className="engine-setup__button engine-setup__button--shutdown"
        >
          Shutdown
        </button>
      </div>

      {isLoading && (
        <div className="engine-setup__loading">
          <div className="engine-setup__spinner" />
          <span>Initializing YaneuraOu with recommended settings...</span>
        </div>
      )}
    </div>
  );
};
