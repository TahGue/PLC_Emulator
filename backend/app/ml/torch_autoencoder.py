from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset


class _ImagePathDataset(Dataset):
    def __init__(self, image_paths: list[str], image_size: int) -> None:
        self.image_paths = image_paths
        self.image_size = image_size

    def __len__(self) -> int:
        return len(self.image_paths)

    def __getitem__(self, index: int) -> torch.Tensor:
        return _load_image_tensor(self.image_paths[index], self.image_size)


class ConvAutoencoder(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Conv2d(3, 16, kernel_size=3, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(16, 32, kernel_size=3, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(32, 64, kernel_size=3, stride=2, padding=1),
            nn.ReLU(inplace=True),
        )

        self.decoder = nn.Sequential(
            nn.ConvTranspose2d(64, 32, kernel_size=4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(32, 16, kernel_size=4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(16, 3, kernel_size=4, stride=2, padding=1),
            nn.Sigmoid(),
        )

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.decoder(self.encoder(inputs))


def _resolve_device(device: str | None = "auto") -> torch.device:
    if device and device not in {"auto", ""}:
        return torch.device(device)
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _load_image_tensor(image_path: str, image_size: int) -> torch.Tensor:
    image = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Unable to read image at path: {image_path}")

    rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    resized = cv2.resize(rgb_image, (image_size, image_size), interpolation=cv2.INTER_AREA)

    tensor = torch.from_numpy(resized).float() / 255.0
    return tensor.permute(2, 0, 1)


def _reconstruction_error(model: nn.Module, tensor: torch.Tensor, device: torch.device) -> float:
    with torch.no_grad():
        batch = tensor.unsqueeze(0).to(device)
        reconstructed = model(batch)
        return float(torch.mean((reconstructed - batch) ** 2).item())


def train_torch_autoencoder(
    good_image_paths: list[str],
    *,
    model_version: str = "mvtec-torch-autoencoder-v1",
    image_size: int = 128,
    epochs: int = 8,
    batch_size: int = 16,
    learning_rate: float = 1e-3,
    threshold_quantile: float = 0.98,
    device: str | None = "auto",
) -> dict[str, Any]:
    if not good_image_paths:
        raise ValueError("No training images were provided.")

    resolved_device = _resolve_device(device)

    model = ConvAutoencoder().to(resolved_device)
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)
    criterion = nn.MSELoss()

    dataset = _ImagePathDataset(good_image_paths, image_size)
    loader = DataLoader(
        dataset,
        batch_size=max(batch_size, 1),
        shuffle=True,
        drop_last=False,
        num_workers=0,
    )

    epoch_losses: list[float] = []

    model.train()
    for _ in range(max(epochs, 1)):
        epoch_loss_sum = 0.0
        sample_count = 0

        for batch in loader:
            batch = batch.to(resolved_device)

            optimizer.zero_grad(set_to_none=True)
            reconstructed = model(batch)
            loss = criterion(reconstructed, batch)
            loss.backward()
            optimizer.step()

            batch_size_actual = int(batch.size(0))
            epoch_loss_sum += float(loss.item()) * batch_size_actual
            sample_count += batch_size_actual

        epoch_losses.append(epoch_loss_sum / max(sample_count, 1))

    model.eval()
    raw_scores = [
        _reconstruction_error(model, _load_image_tensor(path, image_size), resolved_device)
        for path in good_image_paths
    ]

    threshold = float(np.quantile(raw_scores, threshold_quantile))
    score_scale = max(threshold * 2.0, 1e-8)

    metadata = {
        "model_version": model_version,
        "threshold": threshold,
        "score_scale": score_scale,
        "threshold_quantile": threshold_quantile,
        "image_size": int(image_size),
        "trained_samples": int(len(good_image_paths)),
        "epochs": int(max(epochs, 1)),
        "batch_size": int(max(batch_size, 1)),
        "learning_rate": float(learning_rate),
        "device": str(resolved_device),
        "final_train_loss": float(epoch_losses[-1] if epoch_losses else 0.0),
    }

    return {
        "type": "torch_autoencoder",
        "state_dict": model.state_dict(),
        "metadata": metadata,
    }


def save_torch_artifact(artifact: dict[str, Any], artifact_path: str) -> None:
    path = Path(artifact_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(artifact, path)


def load_torch_artifact_metadata(artifact_path: str | None) -> dict[str, Any] | None:
    if not artifact_path:
        return None

    path = Path(artifact_path)
    if not path.exists() or not path.is_file():
        return None

    try:
        artifact = torch.load(path, map_location="cpu")
    except Exception:
        return None

    if not isinstance(artifact, dict):
        return None

    metadata = artifact.get("metadata", {})
    if not isinstance(metadata, dict):
        return None

    return {
        "model_version": str(metadata.get("model_version", "mvtec-torch-autoencoder-v1")),
        "threshold": float(metadata.get("threshold", 0.0)),
        "image_size": int(metadata.get("image_size", 128)),
        "trained_samples": int(metadata.get("trained_samples", 0)),
    }


def load_torch_artifact(artifact_path: str, *, device: str | None = "auto") -> dict[str, Any]:
    path = Path(artifact_path)
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"Artifact not found: {artifact_path}")

    artifact = torch.load(path, map_location="cpu")
    if not isinstance(artifact, dict):
        raise ValueError("Torch artifact payload is invalid.")

    state_dict = artifact.get("state_dict")
    if not isinstance(state_dict, dict):
        raise ValueError("Torch artifact missing state_dict.")

    metadata = artifact.get("metadata", {})
    if not isinstance(metadata, dict):
        metadata = {}

    resolved_device = _resolve_device(device)
    model = ConvAutoencoder().to(resolved_device)
    model.load_state_dict(state_dict)
    model.eval()

    return {
        "model": model,
        "metadata": metadata,
        "device": resolved_device,
    }


def score_torch_image(loaded_artifact: dict[str, Any], image_path: str) -> dict[str, float | bool | str]:
    model = loaded_artifact["model"]
    metadata = loaded_artifact.get("metadata", {})
    device = loaded_artifact["device"]

    image_size = int(metadata.get("image_size", 128))
    tensor = _load_image_tensor(image_path, image_size)

    raw_score = _reconstruction_error(model, tensor, device)

    threshold = float(metadata.get("threshold", 0.0))
    score_scale = float(metadata.get("score_scale", max(threshold * 2.0, 1e-8)))

    anomaly_score = max(0.0, min(100.0, (raw_score / score_scale) * 100.0))
    defect_flag = raw_score >= threshold

    return {
        "raw_score": raw_score,
        "anomaly_score": anomaly_score,
        "defect_flag": defect_flag,
        "threshold": threshold,
        "model_version": str(metadata.get("model_version", "mvtec-torch-autoencoder-v1")),
    }
