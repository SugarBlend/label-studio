import { useEffect, useState } from "react";
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
    image_height: camera?.image_height ?? 720,
    json: camera?.calibration ? JSON.stringify(camera.calibration, null, 2) : "",
    filename: "",
  };
});

export const Skeleton3DSettings = () => {
  const { project, fetchProject } = useProject();
  const api = useAPI();
  const [enabled, setEnabled] = useState(false);
  const [cameras, setCameras] = useState(() => rowsFromConfig(null));
  const [floorUp, setFloorUp] = useState("0, 0, 1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const config = project?.skeleton_3d_config;
    setEnabled(config?.enabled ?? false);
    setCameras(rowsFromConfig(config));
    setFloorUp((config?.floor_up ?? [0, 0, 1]).join(", "));
    setError("");
    setSaved(false);
  }, [project?.id, project?.skeleton_3d_config]);

  const changeCamera = (slot, patch) => {
    setCameras((rows) => rows.map((row) => row.slot === slot ? { ...row, ...patch } : row));
    setSaved(false);
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
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="skeleton-3d-settings">
      <h1>3D skeleton / Camera calibration</h1>
      <p>Live, read-only reconstruction beside a single 2×2 mosaic. Changes apply to every task in this project.</p>
      <p>Assign files to image positions explicitly. File names and upload order do not determine the camera order.</p>
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <label className="skeleton-3d-settings__enable">
            <input type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); setSaved(false); }} />
            Enable live 3D quality check
          </label>
          <div className="skeleton-3d-settings__cameras">
            {cameras.map((camera) => (
              <section key={camera.slot} aria-labelledby={`camera-${camera.slot}-title`}>
                <h2 id={`camera-${camera.slot}-title`}>Camera {camera.slot} — {positions[camera.slot]}</h2>
                <label>Camera name
                  <input type="text" maxLength={64} value={camera.name} onChange={(event) => changeCamera(camera.slot, { name: event.target.value })} />
                </label>
                <label>Calibration JSON
                  <input type="file" accept=".json,application/json" onChange={(event) => {
                    loadFile(camera.slot, event.target.files?.[0]);
                    event.target.value = "";
                  }} />
                </label>
                {camera.filename && <p>Assigned file: {camera.filename}</p>}
                <div className="skeleton-3d-settings__dimensions">
                  <label>Calibration width (px)
                    <input type="number" min="1" max="32768" required value={camera.image_width} onChange={(event) => changeCamera(camera.slot, { image_width: event.target.value })} />
                  </label>
                  <label>Calibration height (px)
                    <input type="number" min="1" max="32768" required value={camera.image_height} onChange={(event) => changeCamera(camera.slot, { image_height: event.target.value })} />
                  </label>
                </div>
                <label>JSON contents
                  <textarea rows={7} spellCheck={false} value={camera.json} placeholder="Upload or paste camera calibration JSON" onChange={(event) => changeCamera(camera.slot, { json: event.target.value, filename: "" })} />
                </label>
              </section>
            ))}
          </div>
          <p>Use each camera's calibration resolution, not the size of the whole mosaic or browser preview. The suggested 1920×1080 is for the supplied 3840×2160 mosaic and must be verified for other recordings.</p>
          <p>For the supplied Foots sequence: top left = camera_0, top right = camera_2, bottom left = camera_3, bottom right = camera_1. Uploading a camera_N.json file automatically fills its label; verify the slot before saving.</p>
          <label>Floor normal in calibration world coordinates (x, y, z)
            <input type="text" value={floorUp} onChange={(event) => { setFloorUp(event.target.value); setSaved(false); }} />
          </label>
          <p>The normal determines the foot-angle reference. All cameras must share the same world coordinate system and units. This setting does not estimate or verify the floor.</p>
          <p>Supported: Fit3D-style intrinsics/extrinsics JSON (T is the camera centre), or OpenCV K, R, t, dist (t is world-to-camera translation). Raw, distorted mosaic images are expected.</p>
          <button type="submit">{busy ? "Saving…" : "Save 3D settings"}</button>
        </fieldset>
        {error && <p role="alert" className="skeleton-3d-settings__error">{error}</p>}
        {saved && <p role="status">Saved. Reopen the labeling editor to load the new calibration.</p>}
      </form>
    </div>
  );
};

Skeleton3DSettings.title = "3D skeleton";
Skeleton3DSettings.path = "/skeleton-3d";
