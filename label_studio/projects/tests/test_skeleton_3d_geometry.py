"""Run without Django: python -m unittest discover -s label_studio/projects/tests -p test_skeleton_3d_geometry.py."""
import importlib.util
import json
from copy import deepcopy
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location('skeleton_geometry', Path(__file__).parents[1] / 'skeleton_3d.py')
geometry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geometry)


def configuration():
    return {'enabled': True, 'cameras': [
        {'slot': slot, 'image_width': 1000, 'image_height': 1000,
         'calibration': {'K': [[500, 0, 500], [0, 500, 500], [0, 0, 1]],
                         'R': np.eye(3).tolist(), 't': [-x, -y, 0]}}
        for slot, (x, y) in enumerate([(-1, 0), (1, 0), (0, -1), (0, 1)])]}


def observations(config, point=(0.2, 0.3, 5), joint='nose'):
    result = []
    for camera in config['cameras']:
        K, R, t, d = geometry.camera_parameters(camera)
        q = R @ point + t
        pixel = K @ np.r_[geometry.distort(q[:2] / q[2], d), 1]
        result.append({'slot': camera['slot'], 'joint': joint, 'x': float(pixel[0]), 'y': float(pixel[1])})
    return result


class GeometryTests(unittest.TestCase):
    def test_actual_fit3d_samples_against_opencv(self):
        try:
            import cv2
        except ImportError:
            self.skipTest('Optional OpenCV is required for independent projection parity')
        config = {'enabled': True, 'cameras': []}
        for slot in range(4):
            path = Path(__file__).parent / 'fixtures' / 'fit3d' / f'camera_{slot}.json'
            config['cameras'].append({'slot': slot, 'image_width': 1280, 'image_height': 720,
                                      'calibration': json.loads(path.read_text())})
        geometry.validate_config(config)
        for point in ([0., 0., 100.], [20., -10., 80.], [-15., 25., 120.]):
            obs = []
            for camera in config['cameras']:
                K, R, t, d = geometry.camera_parameters(camera)
                np.testing.assert_allclose(d, camera['calibration']['distortion_opencv'])
                projected, _ = cv2.projectPoints(np.array([point]), cv2.Rodrigues(R)[0], t, K, d)
                x, y = projected.reshape(2)
                obs.append({'slot': camera['slot'], 'joint': 'nose', 'x': float(x), 'y': float(y)})
            result = geometry.reconstruct(config, obs)
            self.assertFalse(result['rejected'])
            np.testing.assert_allclose(result['joints'][0]['position'], point, atol=1e-6)
            self.assertLess(result['joints'][0]['rms_reprojection_error_px'], 1e-6)
            self.assertTrue(result['warnings'])  # new_matrix is not the raw distorted image
        fallback = deepcopy(config['cameras'][0])
        del fallback['calibration']['distortion_opencv']
        np.testing.assert_allclose(geometry.camera_parameters(fallback)[3], d)

    def test_nested_vectors_and_root_distortion_override(self):
        camera = configuration()['cameras'][0]
        camera['calibration'] = {'intrinsics_w_distortion': {
            'f': [[500], [500]], 'c': [[500, 500]], 'k': [[0, 0, 0]], 'p': [[0], [0]],
            'k_rational': [[0, 0, 0]]},
            'extrinsics': {'R': np.eye(3).tolist(), 'T': [[1], [2], [3]]},
            'distortion_opencv': [0.1, 0.2, 0, 0, 0.3, 0.4, 0.5, 0.6]}
        _, _, t, d = geometry.camera_parameters(camera)
        np.testing.assert_allclose(t, [-1, -2, -3])
        np.testing.assert_allclose(d, camera['calibration']['distortion_opencv'])

    def test_bounded_input_and_defaults(self):
        a = geometry.default_skeleton_3d_config()
        a['cameras'].append({})
        self.assertEqual(geometry.default_skeleton_3d_config()['cameras'], [])
        self.assertFalse(geometry.validate_config({})['enabled'])
        with self.assertRaises(ValueError):
            geometry.reconstruct({}, [])
        config = configuration()
        for bad in (None, {}, [None], [{}], observations(config) * 251,
                    [{'slot': 0, 'joint': 'x', 'x': True, 'y': 1}],
                    [{'slot': 0, 'joint': 'x', 'x': '2', 'y': 1}]):
            with self.subTest(bad=str(bad)[:100]), self.assertRaises(ValueError):
                geometry.reconstruct(config, bad)
        config['floor_up'] = [0, 0, 1e308]
        self.assertEqual(geometry.reconstruct(config, [])['floor_up'], [0, 0, 1])

    def test_signed_tilt_negative_flat_and_forward_component(self):
        self.assertAlmostEqual(geometry.signed_transverse_foot_tilt([1, 2, 0], [-1, 2, 0], [0, 0, 0]), 0)
        self.assertAlmostEqual(geometry.signed_transverse_foot_tilt([1, 3, -1], [-1, 1, 0], [0, 0, 0]),
                               -np.degrees(np.arctan2(1, 2)))

    def test_noisy_observations_warn_without_discarding(self):
        config = configuration()
        obs = observations(config)
        obs[0]['y'] += 80
        result = geometry.reconstruct(config, obs)
        self.assertEqual(len(result['joints']), 1)
        self.assertTrue(result['warnings'])
        self.assertGreater(result['joints'][0]['rms_reprojection_error_px'], 10)

    def test_triangulation_and_two_view_minimum(self):
        config = configuration()
        result = geometry.reconstruct(config, observations(config))
        np.testing.assert_allclose(result['joints'][0]['position'], [0.2, 0.3, 5], atol=1e-10)
        self.assertLess(result['joints'][0]['rms_reprojection_error_px'], 1e-9)
        self.assertEqual(result['floor_up'], [0, 0, 1])
        self.assertFalse(geometry.reconstruct(config, observations(config)[:1])['joints'])
        self.assertEqual(len(geometry.reconstruct(config, observations(config)[:2])['joints']), 1)

    def test_fit3d_camera_center(self):
        camera = configuration()['cameras'][0]
        camera['calibration'] = {'intrinsics_w_distortion': {'f': [500, 500], 'c': [500, 500],
                                                          'k': [0, 0, 0], 'p': [0, 0]},
                                 'extrinsics': {'R': [[0, -1, 0], [1, 0, 0], [0, 0, 1]], 'T': [1, 2, 3]}}
        _, R, t, _ = geometry.camera_parameters(camera)
        np.testing.assert_allclose(t, -R @ [1, 2, 3])

    def test_analytic_undistortion_matches_independent_finite_difference_reference(self):
        # Keep the previous implementation as a test oracle; do not use it in
        # production. This covers radial, tangential and rational distortion.
        K = np.array([[1100., 0., 960.], [0., 1060., 540.], [0., 0., 1.]])
        inverse_K = np.linalg.inv(K)
        samples = np.random.default_rng(15).uniform([0, 0], [1920, 1080], (32, 2))
        distortions = [
            np.zeros(8),
            np.array([-0.13, 0.07, 0.0005, -0.0003, -0.014, 0, 0, 0]),
            np.array([0.1, -0.03, 0.002, -0.001, 0.001, 0.01, 0.004, -0.002]),
        ]

        def reference(pixel, distortion):
            target = (inverse_K @ np.array([*pixel, 1]))[:2]
            point = target.copy()
            for _ in range(30):
                residual = geometry.distort(point, distortion) - target
                if np.linalg.norm(residual) < 1e-10:
                    return point
                eps = 1e-6
                jacobian = np.column_stack([
                    (geometry.distort(point + d, distortion) -
                     geometry.distort(point - d, distortion)) / (2*eps)
                    for d in (np.array([eps, 0]), np.array([0, eps]))
                ])
                point -= np.linalg.solve(jacobian, residual)
            raise AssertionError('Reference failed to converge')

        for distortion in distortions:
            for pixel in samples:
                with self.subTest(distortion=distortion.tolist(), pixel=pixel.tolist()):
                    expected = reference(pixel, distortion)
                    direct = geometry.undistort(pixel, K, distortion)
                    cached_inverse = geometry.undistort(pixel, K, distortion, inverse_K)
                    np.testing.assert_allclose(direct, expected, atol=1e-9, rtol=1e-9)
                    np.testing.assert_allclose(cached_inverse, expected, atol=1e-9, rtol=1e-9)

    def test_distorted_reconstruction(self):
        config = configuration()
        for camera in config['cameras']:
            camera['calibration']['dist'] = [0.1, -0.03, 0.002, -0.001, 0.001, 0.01, 0, 0]
        result = geometry.reconstruct(config, observations(config))
        np.testing.assert_allclose(result['joints'][0]['position'], [0.2, 0.3, 5], atol=1e-7)

    def test_invalid_configuration(self):
        cases = []
        for field, value in [('R', [[-1, 0, 0], [0, 1, 0], [0, 0, 1]]),
                             ('R', [[2, 0, 0], [0, 1, 0], [0, 0, 1]]),
                             ('t', [float('nan'), 0, 0]), ('K', [[0, 0, 500], [0, 500, 500], [0, 0, 1]]),
                             ('dist', [1, 2, 3])]:
            config = configuration()
            config['cameras'][0]['calibration'][field] = value
            cases.append(config)
        config = configuration()
        config['cameras'][0]['slot'] = 1
        cases.append(config)
        config = configuration()
        config['floor_up'] = [0, 0, 0]
        cases.append(config)
        for config in cases:
            with self.subTest(config=config), self.assertRaises(ValueError):
                geometry.validate_config(config)

    def test_observation_bounds_duplicates_nonfinite(self):
        config = configuration()
        obs = observations(config)
        for bad in ([*obs, obs[0]], [{**obs[0], 'x': -1}], [{**obs[0], 'y': float('inf')}],
                    [{**obs[0], 'slot': True}]):
            with self.assertRaises(ValueError):
                geometry.reconstruct(config, bad)

    def test_degenerate_and_behind_cameras(self):
        config = configuration()
        obs = [{'slot': slot, 'joint': 'nose', 'x': 500, 'y': 500} for slot in range(4)]
        self.assertTrue(geometry.reconstruct(config, obs)['rejected'])
        self.assertTrue(geometry.reconstruct(config, observations(config, point=(0, 0, -5)))['rejected'])
        for camera in config['cameras']:
            camera['calibration']['t'] = [0, 0, 0]
        self.assertTrue(geometry.reconstruct(config, observations(config))['rejected'])

    def test_foot_tilt_both_sides_and_rotation(self):
        for big, small in [([1, 2, 1], [-1, 2, 0]), ([-1, 2, 1], [1, 2, 0])]:
            angle = geometry.signed_transverse_foot_tilt(big, small, [0, 0, 0])
            self.assertAlmostEqual(angle, np.degrees(np.arctan2(1, 2)))
            R = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]])
            self.assertAlmostEqual(angle, geometry.signed_transverse_foot_tilt(R @ big, R @ small, [0, 0, 0], R @ [0, 0, 1]))
        with self.assertRaises(ValueError):
            geometry.signed_transverse_foot_tilt([0, 0, 1], [0, 0, 0], [0, 0, -1])

    def test_foot_response_aliases(self):
        config = configuration()
        obs = []
        for joint, point in [('l_big_toe', [0.1, 0.3, 5.1]), ('l_small_toe', [-0.1, 0.3, 5]),
                             ('l_heel', [0, 0, 5])]:
            obs.extend(observations(config, point, joint))
        result = geometry.reconstruct(config, obs)
        self.assertGreater(result['foot_tilt']['left'], 0)
        self.assertIsNone(result['foot_tilt']['right'])


if __name__ == '__main__':
    unittest.main()
