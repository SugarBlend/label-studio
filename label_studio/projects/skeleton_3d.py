"""Pure, bounded multi-view geometry. No image, URL or filesystem access.

Coordinates use calibration pixels and world units supplied by calibration.
Fit3D T denotes the world camera center, not the world-to-camera translation.
"""
from copy import deepcopy

import numpy as np


def default_skeleton_3d_config():
    return {'enabled': False, 'cameras': [], 'floor_up': [0, 0, 1]}


def _array(value, shape, name):
    try:
        a = np.asarray(value, dtype=float)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f'{name} must contain finite numbers') from exc
    if a.shape != shape or not np.isfinite(a).all():
        raise ValueError(f'{name} must have shape {shape} and finite values')
    return a


def _vector(value, length, name):
    """Accept flat, row and column vectors, as exported by Fit3D/OpenCV."""
    try:
        a = np.asarray(value, dtype=float)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f'{name} must contain finite numbers') from exc
    if a.shape not in ((length,), (1, length), (length, 1)):
        raise ValueError(f'{name} must be a vector of length {length}')
    return _array(a.reshape(length), (length,), name)


def _unit(value, name):
    value = _array(value, (3,), name)
    scale = np.max(np.abs(value))
    if scale == 0:
        raise ValueError(f'{name} must be nonzero')
    scaled = value / scale
    return scaled / np.linalg.norm(scaled)


def camera_parameters(camera):
    calibration = camera.get('calibration')
    if not isinstance(calibration, dict):
        raise ValueError('calibration must be a JSON object')
    if 'intrinsics_w_distortion' in calibration:
        intr = calibration['intrinsics_w_distortion']
        extr = calibration.get('extrinsics', {})
        if not isinstance(intr, dict) or not isinstance(extr, dict):
            raise ValueError('Fit3D intrinsics and extrinsics must be objects')
        f = _vector(intr.get('f'), 2, 'f')
        c = _vector(intr.get('c'), 2, 'c')
        K = np.array([[f[0], 0, c[0]], [0, f[1], c[1]], [0, 0, 1]])
        R = _array(extr.get('R'), (3, 3), 'R')
        center = _vector(extr.get('T'), 3, 'T')
        t = -R @ center
        k = _vector(intr.get('k', [0, 0, 0]), 3, 'k')
        p = _vector(intr.get('p', [0, 0]), 2, 'p')
        kr = _vector(intr.get('k_rational', [0, 0, 0]), 3, 'k_rational')
        distortion = calibration.get('distortion_opencv', intr.get(
            'distortion_opencv', [k[0], k[1], p[0], p[1], k[2], *kr]))
    else:
        K = _array(calibration.get('K'), (3, 3), 'K')
        R = _array(calibration.get('R'), (3, 3), 'R')
        t = _vector(calibration.get('t'), 3, 't')
        distortion = calibration.get('dist', [])
    if not np.allclose(R @ R.T, np.eye(3), atol=1e-5) or not np.isclose(np.linalg.det(R), 1, atol=1e-5):
        raise ValueError('R must be a proper orthonormal rotation (determinant +1)')
    if K[0, 0] <= 0 or K[1, 1] <= 0 or not np.allclose(K[2], [0, 0, 1]) or abs(K[1, 0]) > 1e-8:
        raise ValueError('K must have positive focal lengths and standard pinhole last row')
    if not (0 <= K[0, 2] <= camera['image_width'] and 0 <= K[1, 2] <= camera['image_height']):
        raise ValueError('Principal point must lie within image bounds')
    if not np.isfinite(t).all():
        raise ValueError('Camera translation must be finite')
    try:
        coefficients = np.asarray(distortion, dtype=float)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError('distortion must contain finite numbers') from exc
    count = coefficients.size
    if count not in (0, 4, 5, 8):
        raise ValueError('dist/distortion_opencv must have 0, 4, 5 or 8 OpenCV coefficients')
    d = np.zeros(8)
    d[:count] = _vector(coefficients, count, 'distortion')
    return K, R, t, d


def validate_config(value):
    if not isinstance(value, dict):
        raise ValueError('Skeleton 3D config must be an object')
    if set(value) - {'enabled', 'cameras', 'floor_up'}:
        raise ValueError('Unknown Skeleton 3D config fields')
    result = default_skeleton_3d_config()
    result.update(deepcopy(value))
    if type(result['enabled']) is not bool:
        raise ValueError('enabled must be a boolean')
    _unit(result['floor_up'], 'floor_up')
    cameras = result['cameras']
    if not isinstance(cameras, list) or len(cameras) not in (0, 4) or (result['enabled'] and len(cameras) != 4):
        raise ValueError('Provide exactly four cameras (or none while disabled)')
    slots = set()
    for camera in cameras:
        if not isinstance(camera, dict) or set(camera) - {'slot', 'image_width', 'image_height', 'calibration'}:
            raise ValueError('Each camera requires slot, image_width, image_height, calibration')
        slot = camera.get('slot')
        if type(slot) is not int or slot not in range(4) or slot in slots:
            raise ValueError('Camera slots must be unique integers 0..3 in row-major mosaic order')
        slots.add(slot)
        for name in ('image_width', 'image_height'):
            if type(camera.get(name)) is not int or not 1 <= camera[name] <= 100000:
                raise ValueError(f'{name} must be an integer in 1..100000')
        camera_parameters(camera)
    return result


def distort(point, d):
    x, y = point
    k1, k2, p1, p2, k3, k4, k5, k6 = d
    r2 = x*x + y*y
    denominator = 1 + r2*(k4 + r2*(k5 + r2*k6))
    if not np.isfinite(denominator) or abs(denominator) < 1e-14:
        raise ValueError('Singular distortion')
    radial = (1 + r2*(k1 + r2*(k2 + r2*k3))) / denominator
    return np.array([x*radial + 2*p1*x*y + p2*(r2 + 2*x*x),
                     y*radial + p1*(r2 + 2*y*y) + 2*p2*x*y])


def undistort(pixel, K, d):
    target = (np.linalg.inv(K) @ np.array([*pixel, 1]))[:2]
    point = target.copy()
    for _ in range(30):
        residual = distort(point, d) - target
        if np.linalg.norm(residual) < 1e-10:
            return point
        eps = 1e-6
        jacobian = np.column_stack([(distort(point + delta, d) - distort(point - delta, d))/(2*eps)
                                    for delta in (np.array([eps, 0]), np.array([0, eps]))])
        point -= np.linalg.solve(jacobian, residual)
        if not np.isfinite(point).all() or np.linalg.norm(point) > 1e6:
            break
    raise ValueError('Distortion inversion did not converge')


def reconstruct(config, observations):
    config = validate_config(config)
    if not config['enabled']:
        raise ValueError('Skeleton 3D is disabled for this project')
    if not isinstance(observations, list) or len(observations) > 1000:
        raise ValueError('observations must be a list of at most 1000 items')
    cameras = {c['slot']: c for c in config['cameras']}
    parameters = {slot: camera_parameters(c) for slot, c in cameras.items()}
    groups = {}
    for observation in observations:
        if not isinstance(observation, dict) or set(observation) != {'slot', 'joint', 'x', 'y'}:
            raise ValueError('Each observation requires only slot, joint, x, y')
        slot, joint = observation['slot'], observation['joint']
        if type(slot) is not int or slot not in cameras:
            raise ValueError('Observation slot must be 0..3')
        if not isinstance(joint, str) or not joint.strip() or len(joint) > 128:
            raise ValueError('joint must be a nonempty string of at most 128 characters')
        if any(type(observation[key]) not in (int, float) for key in ('x', 'y')):
            raise ValueError('Observation coordinates must be numbers')
        pixel = _array([observation['x'], observation['y']], (2,), 'pixel')
        if not (0 <= pixel[0] <= cameras[slot]['image_width'] and 0 <= pixel[1] <= cameras[slot]['image_height']):
            raise ValueError('Observation outside calibration image bounds')
        group = groups.setdefault(joint, {})
        if slot in group:
            raise ValueError('Duplicate joint observation in the same camera slot')
        group[slot] = pixel
    joints, rejected, warnings = [], [], []
    if any('projection_matrix_built_with' in c['calibration'] for c in cameras.values()):
        warnings.append('Observations must use original distorted calibration pixels, not a rectified/new-matrix image.')
    for joint, group in groups.items():
        try:
            if len(group) < 2:
                raise ValueError('At least two views required')
            rows, rays = [], []
            for slot, pixel in group.items():
                K, R, t, d = parameters[slot]
                x, y = undistort(pixel, K, d)
                P = np.column_stack([R, t])
                rows.extend([x*P[2] - P[0], y*P[2] - P[1]])
                ray = R.T @ np.array([x, y, 1])
                rays.append(ray / np.linalg.norm(ray))
            if max(np.linalg.norm(np.cross(a, b)) for a in rays for b in rays) < 1e-5:
                raise ValueError('Degenerate viewing rays')
            _, singular, vh = np.linalg.svd(rows)
            if singular[-2] < 1e-10 or abs(vh[-1, 3]) < 1e-12:
                raise ValueError('Degenerate triangulation')
            position = vh[-1, :3] / vh[-1, 3]
            errors = []
            for slot, pixel in group.items():
                K, R, t, d = parameters[slot]
                q = R @ position + t
                if q[2] <= 1e-10:
                    raise ValueError('Point is behind a camera')
                predicted = K @ np.array([*distort(q[:2]/q[2], d), 1])
                error = float(np.linalg.norm(predicted[:2] - pixel))
                errors.append({'slot': slot, 'error_px': error})
            if not np.isfinite(position).all() or not all(np.isfinite(e['error_px']) for e in errors):
                raise ValueError('Nonfinite reconstruction')
            joints.append({'joint': joint, 'position': position.tolist(), 'views': list(group),
                           'reprojection_errors': errors,
                           'rms_reprojection_error_px': float(np.hypot.reduce([e['error_px'] for e in errors]) / np.sqrt(len(errors)))})
            if joints[-1]['rms_reprojection_error_px'] > 10:
                warnings.append(f'{joint}: RMS reprojection error exceeds 10 px; check observations and calibration.')
        except (ValueError, np.linalg.LinAlgError, FloatingPointError, OverflowError) as exc:
            rejected.append({'joint': joint, 'reason': str(exc)})
    up = _unit(config['floor_up'], 'floor_up')
    positions = {item['joint'].lower(): item['position'] for item in joints}
    foot_tilt = {'left': None, 'right': None}
    for side, short in (('left', 'l'), ('right', 'r')):
        points = [next((positions[name] for name in (f'{short}_{part}', f'{side}_{part}') if name in positions), None)
                  for part in ('big_toe', 'small_toe', 'heel')]
        if all(point is not None for point in points):
            try:
                foot_tilt[side] = signed_transverse_foot_tilt(*points, up=up)
            except ValueError as exc:
                warnings.append(f'{side} foot tilt unavailable: {exc}')
    return {'joints': joints, 'rejected': rejected, 'floor_up': up.tolist(),
            'foot_tilt': foot_tilt, 'warnings': warnings}


def signed_transverse_foot_tilt(big, small, heel, up=(0, 0, 1)):
    """Geometric degrees, positive when big toe is higher; not a clinical assessment."""
    big, small, heel, up = [_array(v, (3,), 'foot vector') for v in (big, small, heel, up)]
    up = _unit(up, 'up')
    forward = (big + small)/2 - heel
    forward -= np.dot(forward, up)*up
    if np.linalg.norm(forward) < 1e-12:
        raise ValueError('Degenerate foot forward direction')
    transverse = np.cross(up, forward/np.linalg.norm(forward))
    width = big - small
    vertical, horizontal = np.dot(width, up), abs(np.dot(width, transverse))
    if np.hypot(vertical, horizontal) < 1e-12:
        raise ValueError('Degenerate toe separation')
    return float(np.degrees(np.arctan2(vertical, horizontal)))
