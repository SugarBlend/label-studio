# 3D skeleton — integrated multi-camera labeling view

The existing Label Studio editor is reused: **3D on the left**, the **editable 2×2 camera mosaic on the right**. The 3D geometry is reconstructed by the existing Django API. No Tampermonkey, new viewer app, or direct changes to saved annotations are needed.

## The supplied Foots dataset

The supplied COCO export contains 200 images of **3840×2160**, each made from **four 1920×1080 views**. A test on the first image, checking all 24 possible camera assignments, found the following ordering (row-major):

| Mosaic slot | Source calibration file |
| --- | --- |
| 0 — top left | camera_0.json |
| 1 — top right | camera_2.json |
| 2 — bottom left | camera_3.json |
| 3 — bottom right | camera_1.json |

With this assignment and the original distorted intrinsics, the first image's 26-point skeleton had a **median reprojection error of about 1.05 px**. This is evidence for the assignment **for this recording**, not for all projects.

**Important:** The calibration JSONs contain `projection_matrix_built_with: "new_matrix"`. The reconstruction endpoint currently expects original distorted image pixels. The supplied sample fits those coordinates well, but if the actual mosaic has been undistorted/rectified, choose a matching calibration and image coordinate model before relying on the 3D angles. Never silently mix `intrinsics_wo_distortion` with raw pixel coordinates.

Do not upload this dataset or the Windows `viewer.exe` into the public GitHub repository.

## Setup

1. Build your Label Studio image **from this branch**, not from the previous deployed image.
2. Open Project → Settings → **3D skeleton**.
3. Upload all four camera calibration JSONs into the slots shown above. Check that each camera name matches the physical source.
4. Enter **1920×1080** for each camera of this recording; use actual calibration resolution for other recordings.
5. Set the physical floor-up normal in the calibration coordinate system (the provided recording appears to use Z up).
6. Enable reconstruction, save, and reopen the labeling task.

## Controls

- Left mouse drag in 3D: orbit around the pose
- Shift + left drag or right drag: pan
- Mouse wheel: zoom
- Double click or **R**: reset view
- **+** / **-** when the canvas has focus: zoom
- **Colour**: blue left / orange right or neutral
- **Size**: change joint and bone thickness
- **Labels**, **Cameras**, **Rays**, **Shadow**, **Trail**, **Path**, **Soles**: independent visual layers
- **Joint names**: label individual reconstructed joints
- A small XYZ triad shows 3D orientation

Trail and Path accumulate the latest 90 successful reconstructed poses **during the current task**, e.g. while editing. They are *not yet* a player for all 200 frames. Existing Label Studio task/image navigation is unchanged.

The viewer's **appearance and pointer interaction** target the provided screenshot of the desktop Qt application. They are not a binary-accurate port of `viewer.exe`, which is a compiled Windows executable.

## Verification

- Geometry mapping for the first COCO image was evaluated separately against all four supplied calibrations.
- This PR is a **draft**: an end-to-end browser run on a real project, webpack production build, and comparison with the Qt app's actual camera motions are still outstanding.
- Keep the original `skeleton-lines-stable` branch untouched until smoke testing passes.
