from __future__ import annotations

import pickle
from pathlib import Path
from typing import Any


def load_artifact_metadata(artifact_path: str | None) -> dict[str, Any] | None:
    """Load lightweight metadata from a serialized MVTec artifact.

    This helper is intentionally dependency-light so the API can boot even when
    optional ML stack dependencies are unavailable.
    """

    if not artifact_path:
        return None

    path = Path(artifact_path)
    if not path.exists() or not path.is_file():
        return None

    try:
        with path.open("rb") as handle:
            artifact = pickle.load(handle)
    except Exception:
        return None

    metadata = artifact.get("metadata", {}) if isinstance(artifact, dict) else {}
    if not isinstance(metadata, dict):
        return None

    return {
        "model_version": str(metadata.get("model_version", "mvtec-feature-ocsvm-v1")),
        "threshold": float(metadata.get("threshold", 0.0)),
        "feature_dim": int(metadata.get("feature_dim", 0)),
        "trained_samples": int(metadata.get("trained_samples", 0)),
    }


def extract_image_features(image_path: str) -> list[float]:
    """Extract compact handcrafted image features for lightweight anomaly models."""

    import cv2
    import numpy as np

    image = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Unable to read image at path: {image_path}")

    resized = cv2.resize(image, (96, 96))
    hsv_image = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)
    gray_image = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)

    features: list[float] = []

    for channel in cv2.split(hsv_image):
        histogram = cv2.calcHist([channel], [0], None, [16], [0, 256]).flatten()
        histogram = histogram / (histogram.sum() + 1e-6)
        features.extend(float(value) for value in histogram)

    mean_intensity = float(np.mean(gray_image)) / 255.0
    std_intensity = float(np.std(gray_image)) / 255.0
    sobel_x = cv2.Sobel(gray_image, cv2.CV_32F, 1, 0)
    sobel_y = cv2.Sobel(gray_image, cv2.CV_32F, 0, 1)
    gradient_magnitude = np.sqrt((sobel_x**2) + (sobel_y**2))
    edge_strength = float(np.mean(gradient_magnitude)) / 255.0

    features.extend([mean_intensity, std_intensity, edge_strength])
    return features


def train_mvtec_feature_model(
    good_image_paths: list[str],
    *,
    model_version: str = "mvtec-feature-ocsvm-v1",
    nu: float = 0.05,
    gamma: str = "scale",
    threshold_quantile: float = 0.98,
) -> dict[str, Any]:
    """Train a One-Class SVM artifact from normal/good images only."""

    import numpy as np
    from sklearn.preprocessing import StandardScaler
    from sklearn.svm import OneClassSVM

    if not good_image_paths:
        raise ValueError("No training images were provided.")

    feature_matrix = np.asarray(
        [extract_image_features(path) for path in good_image_paths],
        dtype=np.float32,
    )

    scaler = StandardScaler()
    normalized_features = scaler.fit_transform(feature_matrix)

    estimator = OneClassSVM(kernel="rbf", nu=nu, gamma=gamma)
    estimator.fit(normalized_features)

    raw_scores = -estimator.decision_function(normalized_features)
    threshold = float(np.quantile(raw_scores, threshold_quantile))
    score_scale = max(threshold * 1.8, 1e-3)

    return {
        "scaler": scaler,
        "estimator": estimator,
        "metadata": {
            "model_version": model_version,
            "threshold": threshold,
            "score_scale": score_scale,
            "nu": nu,
            "gamma": gamma,
            "feature_dim": int(feature_matrix.shape[1]),
            "trained_samples": int(feature_matrix.shape[0]),
            "threshold_quantile": threshold_quantile,
        },
    }


def save_artifact(artifact: dict[str, Any], artifact_path: str) -> None:
    path = Path(artifact_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        pickle.dump(artifact, handle)


def load_artifact(artifact_path: str) -> dict[str, Any]:
    path = Path(artifact_path)
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"Artifact not found: {artifact_path}")

    with path.open("rb") as handle:
        artifact = pickle.load(handle)

    if not isinstance(artifact, dict):
        raise ValueError("Artifact payload is invalid.")

    if "scaler" not in artifact or "estimator" not in artifact:
        raise ValueError("Artifact is missing required model keys.")

    if "metadata" not in artifact or not isinstance(artifact["metadata"], dict):
        artifact["metadata"] = {}

    return artifact


def score_features(artifact: dict[str, Any], features: list[float]) -> dict[str, float | bool]:
    import numpy as np

    scaler = artifact["scaler"]
    estimator = artifact["estimator"]
    metadata = artifact.get("metadata", {})

    threshold = float(metadata.get("threshold", 0.0))
    score_scale = float(metadata.get("score_scale", max(threshold * 1.8, 1e-3)))

    matrix = np.asarray([features], dtype=np.float32)
    normalized = scaler.transform(matrix)
    raw_score = float(-estimator.decision_function(normalized)[0])

    anomaly_score = max(0.0, min(100.0, (raw_score / score_scale) * 100.0))
    defect_flag = raw_score >= threshold

    return {
        "raw_score": raw_score,
        "anomaly_score": anomaly_score,
        "defect_flag": defect_flag,
    }


def score_image(artifact: dict[str, Any], image_path: str) -> dict[str, float | bool]:
    features = extract_image_features(image_path)
    scored = score_features(artifact, features)

    metadata = artifact.get("metadata", {})
    scored["threshold"] = float(metadata.get("threshold", 0.0))
    scored["model_version"] = str(metadata.get("model_version", "mvtec-feature-ocsvm-v1"))
    return scored
