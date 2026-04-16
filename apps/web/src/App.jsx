import { useEffect, useState } from "react";

const buildFileUrl = (relativePath) =>
  `/api/file?path=${encodeURIComponent(relativePath)}`;

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value < 10 && unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Breadcrumbs({ currentPath, onNavigate }) {
  const parts = currentPath ? currentPath.split("/").filter(Boolean) : [];
  const crumbs = [{ label: "Root", value: "" }];

  let runningPath = "";
  for (const part of parts) {
    runningPath = runningPath ? `${runningPath}/${part}` : part;
    crumbs.push({ label: part, value: runningPath });
  }

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {crumbs.map((crumb) => (
        <button
          key={crumb.value || "root"}
          className="breadcrumb"
          onClick={() => onNavigate(crumb.value)}
        >
          {crumb.label}
        </button>
      ))}
    </nav>
  );
}

function ImageModal({ item, onClose }) {
  if (!item) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>{item.name}</h3>
            <p>
              {formatBytes(item.size)} • {formatDate(item.modifiedAt)}
            </p>
          </div>
          <button className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        <img
          className="modal-image"
          src={buildFileUrl(item.path)}
          alt={item.name}
        />
      </div>
    </div>
  );
}

function FileCard({ item, onOpen }) {
  return (
    <button
      className={`card ${item.kind}`}
      onClick={() => onOpen(item)}
      title={item.name}
    >
      <div className="thumb">
        {item.kind === "directory" ? (
          <div className="emoji-thumb" aria-hidden="true">
            📁
          </div>
        ) : item.isImage ? (
          <img loading="lazy" src={buildFileUrl(item.path)} alt={item.name} />
        ) : (
          <div className="emoji-thumb" aria-hidden="true">
            📄
          </div>
        )}
      </div>

      <div className="card-body">
        <h2>{item.name}</h2>
        <p>
          {item.kind === "directory"
            ? "Folder"
            : `${item.mimeType || "File"} • ${formatBytes(item.size)}`}
        </p>
        <span>{formatDate(item.modifiedAt)}</span>
      </div>
    </button>
  );
}

export default function App() {
  const [directory, setDirectory] = useState({
    rootName: "Media",
    currentPath: "",
    parentPath: null,
    items: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedImage, setSelectedImage] = useState(null);

  async function loadDirectory(nextPath = "") {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/files?path=${encodeURIComponent(nextPath)}`,
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load directory");
      }

      setDirectory(data);
      setSelectedImage(null);
    } catch (err) {
      setError(err.message || "Failed to load directory");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDirectory("");
  }, []);

  function handleOpen(item) {
    if (item.kind === "directory") {
      loadDirectory(item.path);
      return;
    }

    if (item.isImage) {
      setSelectedImage(item);
      return;
    }

    window.open(buildFileUrl(item.path), "_blank", "noopener,noreferrer");
  }

  const folderCount = directory.items.filter(
    (item) => item.kind === "directory",
  ).length;
  const fileCount = directory.items.length - folderCount;

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <span className="eyebrow">Remote Media Server</span>
          <h1>{directory.rootName}</h1>
          <p>Phase 1 local browser for one secure media root.</p>
        </div>

        <button
          className="ghost-button"
          onClick={() => loadDirectory(directory.currentPath)}
        >
          Refresh
        </button>
      </header>

      <section className="toolbar">
        <Breadcrumbs
          currentPath={directory.currentPath}
          onNavigate={loadDirectory}
        />

        <div className="meta-row">
          {directory.parentPath !== null ? (
            <button
              className="ghost-button"
              onClick={() => loadDirectory(directory.parentPath || "")}
            >
              Up one level
            </button>
          ) : (
            <span className="muted">At root</span>
          )}

          <span className="muted">
            {directory.items.length} items • {folderCount} folders • {fileCount}{" "}
            files
          </span>
        </div>
      </section>

      {loading ? (
        <div className="status">Loading...</div>
      ) : error ? (
        <div className="status error">{error}</div>
      ) : directory.items.length === 0 ? (
        <div className="status">This folder is empty.</div>
      ) : (
        <section className="grid">
          {directory.items.map((item) => (
            <FileCard
              key={`${item.kind}-${item.path}`}
              item={item}
              onOpen={handleOpen}
            />
          ))}
        </section>
      )}

      <ImageModal item={selectedImage} onClose={() => setSelectedImage(null)} />
    </div>
  );
}
