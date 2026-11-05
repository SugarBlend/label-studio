import { useEffect, useMemo, useState } from "react";
import { useAPI } from "../../providers/ApiProvider";
import { useProject } from "../../providers/ProjectProvider";
import "./Skeleton3DSettings.scss";

const positions = ["Top left", "Top right", "Bottom left", "Bottom right"];
const rowsFromConfig = (config) => positions.map((_, slot) => {
  const camera = config?.cameras?.find((camera) => camera.slot === slot);
  return {
    slot,
    name: camera?.name ?? `camera_${slot}`,
    image_width: camera?.image_width ?? 1920,
    image_height: camera?.image_height ?? 1080,
    json: camera?.calibration ? JSON.stringify(camera.calibration, null, 2) : "",
    filename: "",
  };
});

const cameraStatus = (camera) => {
  if (!camera.json.trim()) return "missing";
  try {
    const data = JSON.parse(camera.json);
    return data && !Array.isArray(data) && typeof data === "object" ? "ready" : "invalid";
  } catch {
    return "invalid";
  }
};

export const Skeleton3DSettings = () => {
  const { project, fetchProject } = useProject();
  const api = useAPI();
  const [enabled, setEnabled] = useState(false);
  const [cameras, setCameras] = useState(() => rowsFromConfig(null));
  const [floorUp, setFloorUp] = useState("0, 0, 1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const config = project?.skeleton_3d_config;
    setEnabled(config?.enabled ?? false);
    setCameras(rowsFromConfig(config));
    setFloorUp((config?.floor_up ?? [0, 0, 1]).join(", "));
    setError("");
    setSaved(false);
    setDirty(false);
  }, [project?.id, project?.skeleton_3d_config]);

  const statuses = useMemo(() => cameras.map(cameraStatus), [cameras]);
  const readyCount = statuses.filter((status) => status === "ready").length;
  const invalidCount = statuses.filter((status) => status === "invalid").length;

  const markChanged = () => {
    setDirty(true);
    setSaved(false);
    setError("");
  };

  const changeCamera = (slot, patch) => {
    setCameras((rows) => rows.map((row) => row.slot === slot ? { ...row, ...patch } : row));
    markChanged();
  };

  const loadFile = async (slot, file) => {
    if (!file) return;
    setError("");
    try {
      if (file.size > 128 * 1024) throw new Error("Calibration JSON must be smaller than 128 KiB.");
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || Array.isArray(data) || typeof data !== "object") throw new Error("Expected a JSON object.");
      // A filename never determines the mosaic slot: the user assigns it explicitly.
      const match = file.name.match(/camera[_-]?(\d+)/i);
      changeCamera(slot, {
        json: JSON.stringify(data, null, 2), filename: file.name,
        ...(match ? { name: `camera_${match[1]}` } : {}),
      });
    } catch (err) {
      setError(`Camera ${slot}: ${err.message}`);
    }
  };

  const save = async (event) => {
    event.preventDefault();
    setError("");
    setSaved(false);
    setBusy(true);
    try {
      const up = floorUp.trim().split(/[\s,;]+/).map(Number);
      if (up.length !== 3 || !up.every(Number.isFinite) || Math.hypot(...up) < 1e-8) {
        throw new Error("Floor normal must contain three finite numbers and must not be zero.");
      }
      const configured = cameras.filter((row) => row.json.trim()).map((row) => {
        const width = Number(row.image_width);
        const height = Number(row.image_height);
        if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
          throw new Error(`Camera ${row.slot}: enter the calibration image width and height in pixels.`);
        }
        try {
          return { slot: row.slot, name: row.name.trim(), image_width: width, image_height: height, calibration: JSON.parse(row.json) };
        } catch {
          throw new Error(`Camera ${row.slot}: invalid JSON.`);
        }
      });
      if (configured.some((row) => !row.name || !row.name.trim())) {
        throw new Error("Every configured camera must have a name.");
      }
      if ((enabled && configured.length !== 4) || (configured.length !== 0 && configured.length !== 4)) {
        throw new Error("Assign all four camera calibrations before saving, or clear all four and disable 3D.");
      }
      const result = await api.callApi("updateProject", {
        params: { pk: project.id },
        body: { skeleton_3d_config: { enabled, cameras: configured, floor_up: up } },
      });
      if (!result?.$meta?.ok) {
        throw new Error(JSON.stringify(result?.validation_errors ?? result?.detail ?? result?.skeleton_3d_config ?? "Unable to save calibration. Check the JSON and your project permissions."));
      }
      await fetchProject(project.id, true);
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="skeleton-3d-settings">
      <header className="skeleton-3d-settings__header">
        <div className="skeleton-3d-settings__eyebrow">Project settings / Multiview</div>
        <h1>3D skeleton</h1>
        <p>Configure a single 2×2 camera mosaic for live 3D reconstruction while annotating.</p>
      </header>
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <section className="skeleton-3d-settings__overview" aria-labelledby="s3d-live-title">
            <div>
              <h2 id="s3d-live-title">Live reconstruction</h2>
              <p>Display the reconstructed skeleton alongside the editable camera views. Changes apply to every task in this project.</p>
            </div>
            <label className="skeleton-3d-settings__switch">
              <input type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); markChanged(); }} />
              <span className="skeleton-3d-settings__switch-track" aria-hidden="true" />
              <span>{enabled ? "Enabled" : "Disabled"}</span>
            </label>
          </section>

          <section className="skeleton-3d-settings__section" aria-labelledby="s3d-cameras-title">
            <div className="skeleton-3d-settings__section-header">
              <div>
                <h2 id="s3d-cameras-title">Camera calibration</h2>
                <p>Each card matches a position in the mosaic; physical camera names can differ from slot numbers.</p>
              </div>
              <span className={"skeleton-3d-settings__counter" + (invalidCount ? " skeleton-3d-settings__counter--error" : "")}>
                {readyCount} / 4 configured
              </span>
            </div>
            <div className="skeleton-3d-settings__mosaic" aria-label="2 by 2 camera positions">
              {cameras.map((camera) => {
                const status = statuses[camera.slot];
                return (
                  <section key={camera.slot} className="skeleton-3d-settings__camera" aria-labelledby={"camera-" + camera.slot + "-title"}>
                    <header className="skeleton-3d-settings__camera-header">
                      <div className="skeleton-3d-settings__slot">
                        <span className="skeleton-3d-settings__slot-number">{camera.slot + 1}</span>
                        <div>
                          <div className="skeleton-3d-settings__slot-position">{positions[camera.slot]}</div>
                          <h3 id={"camera-" + camera.slot + "-title"}>Slot {camera.slot}</h3>
                        </div>
                      </div>
                      <span className={"skeleton-3d-settings__status skeleton-3d-settings__status--" + status}>
                        {status === "ready" ? "Configured" : status === "invalid" ? "Invalid JSON" : "Not configured"}
                      </span>
                    </header>
                    <div className="skeleton-3d-settings__camera-body">
                      <label className="skeleton-3d-settings__field">
                        <span>Camera name</span>
                        <input type="text" maxLength={64} value={camera.name} placeholder="camera_0"
                          onChange={(event) => changeCamera(camera.slot, { name: event.target.value })} />
                      </label>
                      <div className="skeleton-3d-settings__dimensions">
                        <label className="skeleton-3d-settings__field">
                          <span>Width, px</span>
                          <input type="number" min="1" max="100000" required value={camera.image_width}
                            onChange={(event) => changeCamera(camera.slot, { image_width: event.target.value })} />
                        </label>
                        <span className="skeleton-3d-settings__dimension-symbol" aria-hidden="true">×</span>
                        <label className="skeleton-3d-settings__field">
                          <span>Height, px</span>
                          <input type="number" min="1" max="100000" required value={camera.image_height}
                            onChange={(event) => changeCamera(camera.slot, { image_height: event.target.value })} />
                        </label>
                      </div>
                      <div className="skeleton-3d-settings__upload-row">
                        <label className="skeleton-3d-settings__upload">
                          <input type="file" accept=".json,application/json" aria-label={"Upload calibration for slot " + camera.slot}
                            onChange={(event) => {
                              loadFile(camera.slot, event.target.files?.[0]);
                              event.target.value = "";
                            }} />
                          <span aria-hidden="true">↑</span>{camera.json.trim() ? "Replace JSON" : "Upload JSON"}
                        </label>
                        <span className="skeleton-3d-settings__filename" title={camera.filename || (status === "ready" ? "Calibration stored in project" : "No calibration uploaded")}>
                          {camera.filename || (status === "ready" ? "Stored in project" : "No file selected")}
                        </span>
                      </div>
                      <details className="skeleton-3d-settings__json-details">
                        <summary>View or edit JSON</summary>
                        <label className="skeleton-3d-settings__field">
                          <span>Calibration data</span>
                          <textarea rows={8} spellCheck={false} value={camera.json} placeholder="Upload or paste camera calibration JSON"
                            onChange={(event) => changeCamera(camera.slot, { json: event.target.value, filename: "" })} />
                        </label>
                      </details>
                    </div>
                  </section>
                );
              })}
            </div>
            <div className="skeleton-3d-settings__notice">
              <strong>Coordinate mapping</strong>
              <p>Upload files to their positions in the image, not numeric camera order. Use the calibration resolution of each camera, not the resolution of the whole mosaic.</p>
              <details>
                <summary>Example: Foots recording (3840×2160)</summary>
                <p>Top left: camera_0 · Top right: camera_2 · Bottom left: camera_3 · Bottom right: camera_1. Each tile uses 1920×1080.</p>
              </details>
            </div>
          </section>

          <section className="skeleton-3d-settings__section skeleton-3d-settings__geometry" aria-labelledby="s3d-world-title">
            <div className="skeleton-3d-settings__section-header">
              <div>
                <h2 id="s3d-world-title">World coordinates</h2>
                <p>Specify the up direction shared by all four cameras.</p>
              </div>
            </div>
            <label className="skeleton-3d-settings__field skeleton-3d-settings__normal">
              <span>Floor normal (x, y, z)</span>
              <input type="text" value={floorUp} placeholder="0, 0, 1"
                onChange={(event) => { setFloorUp(event.target.value); markChanged(); }} />
              <small>For Z-up use <code>0, 0, 1</code>. This is a reference direction; the floor is not estimated automatically.</small>
            </label>
            <details className="skeleton-3d-settings__technical">
              <summary>Calibration formats and coordinate conventions</summary>
              <p>Supported: Fit3D intrinsics/extrinsics (T is camera centre), or OpenCV K, R, t, dist (t is world-to-camera translation). All cameras must share world coordinates and units. Reconstruction expects original distorted pixels.</p>
            </details>
          </section>

          <div className="skeleton-3d-settings__actions">
            <div className="skeleton-3d-settings__save-state" aria-live="polite">
              {dirty ? "Unsaved changes" : saved ? "Settings saved. Reopen the editor to apply changes." : "Project calibration settings"}
            </div>
            <button className="skeleton-3d-settings__save" type="submit" disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </fieldset>
        {error && <div role="alert" className="skeleton-3d-settings__error">{error}</div>}
      </form>
    </div>
  );
};

Skeleton3DSettings.title = "3D skeleton";
Skeleton3DSettings.path = "/skeleton-3d";
