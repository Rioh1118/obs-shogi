import { useAppConfig } from "../contexts/AppConfigContext";

const AppLayout = () => {
  const { config, error } = useAppConfig();

  return (
    <div style={{ padding: "1rem" }}>
      <h1>App Layout</h1>
      {error && <p style={{ color: "red" }}>❌ {error}</p>}
      {!error && (
        <p>
          📂 Root Directory:{" "}
          {config?.root_dir ? (
            <strong>{config.root_dir}</strong>
          ) : (
            <em>未設定</em>
          )}
        </p>
      )}
    </div>
  );
};

export default AppLayout;
