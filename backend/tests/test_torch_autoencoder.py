from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import numpy as np
import torch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.ml.torch_autoencoder import (
    ConvAutoencoder,
    _load_image_tensor,
    _reconstruction_error,
    _resolve_device,
    load_torch_artifact,
    load_torch_artifact_metadata,
    save_torch_artifact,
    score_torch_image,
)


def test_conv_autoencoder_forward_shape() -> None:
    model = ConvAutoencoder()
    dummy = torch.randn(2, 3, 128, 128)
    output = model(dummy)
    assert output.shape == dummy.shape


def test_resolve_device_returns_cpu() -> None:
    device = _resolve_device("cpu")
    assert device == torch.device("cpu")


def test_resolve_device_auto_returns_device() -> None:
    device = _resolve_device("auto")
    assert isinstance(device, torch.device)


def test_reconstruction_error_returns_float() -> None:
    model = ConvAutoencoder()
    model.eval()
    dummy = torch.randn(3, 128, 128)
    error = _reconstruction_error(model, dummy, torch.device("cpu"))
    assert isinstance(error, float)
    assert error >= 0.0


def test_save_and_load_torch_artifact_roundtrip() -> None:
    model = ConvAutoencoder()
    model.eval()

    artifact = {
        "type": "torch_autoencoder",
        "state_dict": model.state_dict(),
        "metadata": {
            "model_version": "test-v1",
            "threshold": 0.05,
            "score_scale": 0.10,
            "image_size": 128,
            "trained_samples": 10,
        },
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        artifact_path = str(Path(tmpdir) / "test_model.pt")
        save_torch_artifact(artifact, artifact_path)

        metadata = load_torch_artifact_metadata(artifact_path)
        assert metadata is not None
        assert metadata["model_version"] == "test-v1"
        assert metadata["threshold"] == 0.05
        assert metadata["image_size"] == 128
        assert metadata["trained_samples"] == 10

        loaded = load_torch_artifact(artifact_path, device="cpu")
        assert "model" in loaded
        assert "metadata" in loaded
        assert loaded["metadata"]["model_version"] == "test-v1"


def test_load_torch_artifact_metadata_returns_none_for_missing() -> None:
    assert load_torch_artifact_metadata(None) is None
    assert load_torch_artifact_metadata("/nonexistent/path.pt") is None


def test_score_torch_image_with_synthetic_image() -> None:
    import cv2

    model = ConvAutoencoder()
    model.eval()

    loaded = {
        "model": model,
        "metadata": {
            "model_version": "test-v1",
            "threshold": 0.05,
            "score_scale": 0.10,
            "image_size": 128,
        },
        "device": torch.device("cpu"),
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        img = np.random.randint(0, 255, (128, 128, 3), dtype=np.uint8)
        img_path = str(Path(tmpdir) / "test.png")
        cv2.imwrite(img_path, img)

        result = score_torch_image(loaded, img_path)
        assert "raw_score" in result
        assert "anomaly_score" in result
        assert "defect_flag" in result
        assert "threshold" in result
        assert "model_version" in result
        assert isinstance(result["anomaly_score"], float)
        assert 0.0 <= result["anomaly_score"] <= 100.0
