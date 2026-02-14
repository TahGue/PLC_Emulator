"""LSTM Autoencoder for ICS time-series anomaly detection.

Architecture:
    Encoder: LSTM layers compress a window of multivariate telemetry into a
             fixed-size latent vector.
    Decoder: LSTM layers reconstruct the original window from the latent vector.

Anomaly scoring:
    Reconstruction error (MSE per window) is compared against a threshold
    learned from normal-operation training data. High error = anomaly.

Feature vector (14 dimensions per timestep):
    0  conveyor_running       (bool→float)
    1  production_rate         (float, bottles/min)
    2  reject_rate             (float, %)
    3  in_flight_bottles       (int→float)
    4  bottle_at_filler        (bool→float)
    5  bottle_at_capper        (bool→float)
    6  bottle_at_quality       (bool→float)
    7  output_alarm_horn       (bool→float)
    8  output_reject_gate      (bool→float)
    9  network_packet_rate     (float, pkt/s)
    10 network_burst_ratio     (float, 0-1)
    11 scan_time_ms            (float, ms)
    12 io_input_sum            (int→float, sum of active inputs)
    13 io_output_sum           (int→float, sum of active outputs)
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn


# ── Feature extraction ────────────────────────────────────────────────

FEATURE_NAMES: list[str] = [
    "conveyor_running",
    "production_rate",
    "reject_rate",
    "in_flight_bottles",
    "bottle_at_filler",
    "bottle_at_capper",
    "bottle_at_quality",
    "output_alarm_horn",
    "output_reject_gate",
    "network_packet_rate",
    "network_burst_ratio",
    "scan_time_ms",
    "io_input_sum",
    "io_output_sum",
]

N_FEATURES = len(FEATURE_NAMES)


def telemetry_to_vector(payload: dict[str, Any]) -> list[float]:
    """Convert a raw telemetry dict into a fixed-size numeric vector."""
    return [
        float(payload.get("conveyor_running", False)),
        float(payload.get("production_rate", 0)),
        float(payload.get("reject_rate", 0)),
        float(payload.get("in_flight_bottles", 0)),
        float(payload.get("bottle_at_filler", False)),
        float(payload.get("bottle_at_capper", False)),
        float(payload.get("bottle_at_quality", False)),
        float(payload.get("output_alarm_horn", False)),
        float(payload.get("output_reject_gate", False)),
        float(payload.get("network_packet_rate", 0)),
        float(payload.get("network_burst_ratio", 0)),
        float(payload.get("scan_time_ms", 0)),
        float(payload.get("io_input_sum", 0)),
        float(payload.get("io_output_sum", 0)),
    ]


# ── Synthetic data generation ─────────────────────────────────────────

def generate_normal_data(n_samples: int = 5000, seed: int = 42) -> np.ndarray:
    """Generate synthetic 'normal operation' telemetry for training.

    Returns array of shape (n_samples, N_FEATURES).
    """
    rng = np.random.RandomState(seed)
    data = np.zeros((n_samples, N_FEATURES), dtype=np.float32)

    for i in range(n_samples):
        t = i / n_samples
        # Simulate shift patterns (day/night cycle)
        shift_factor = 0.8 + 0.2 * np.sin(2 * np.pi * t * 3)

        data[i, 0] = 1.0  # conveyor_running
        data[i, 1] = np.clip(8.0 * shift_factor + rng.normal(0, 0.5), 2, 15)  # production_rate
        data[i, 2] = np.clip(rng.exponential(1.5), 0, 10)  # reject_rate
        data[i, 3] = np.clip(rng.poisson(2), 0, 6)  # in_flight_bottles
        data[i, 4] = float(rng.random() < 0.3)  # bottle_at_filler
        data[i, 5] = float(rng.random() < 0.25)  # bottle_at_capper
        data[i, 6] = float(rng.random() < 0.2)  # bottle_at_quality
        data[i, 7] = 0.0  # alarm_horn (off in normal)
        data[i, 8] = float(rng.random() < 0.05)  # reject_gate (rare)
        data[i, 9] = np.clip(130 + rng.normal(0, 8), 90, 170)  # packet_rate
        data[i, 10] = np.clip(rng.beta(2, 8), 0, 0.6)  # burst_ratio
        data[i, 11] = np.clip(100 + rng.normal(0, 10), 60, 160)  # scan_time_ms
        data[i, 12] = np.clip(rng.poisson(3), 0, 8)  # io_input_sum
        data[i, 13] = np.clip(rng.poisson(4), 0, 10)  # io_output_sum

    return data


def generate_attack_data(
    n_samples: int = 1000,
    attack_type: str = "dos_flood",
    seed: int = 99,
) -> np.ndarray:
    """Generate synthetic attack telemetry for evaluation.

    Supported types: dos_flood, mitm, false_data_injection, modbus_injection,
                     stuxnet_like, sensor_jamming, replay, combined
    """
    rng = np.random.RandomState(seed)
    # Start from normal baseline
    base = generate_normal_data(n_samples, seed=seed + 1)

    if attack_type == "dos_flood":
        base[:, 9] *= rng.uniform(3.0, 6.0, n_samples)  # packet_rate spike
        base[:, 10] = np.clip(base[:, 10] + rng.uniform(0.3, 0.5, n_samples), 0, 1)
        base[:, 11] *= rng.uniform(2.0, 4.0, n_samples)  # scan time spike
        base[:, 1] *= rng.uniform(0.2, 0.6, n_samples)  # production drops

    elif attack_type == "mitm":
        base[:, 1] += rng.normal(0, 3, n_samples)  # noisy production_rate
        base[:, 2] += rng.uniform(5, 15, n_samples)  # reject_rate spike
        base[:, 4] = np.clip(base[:, 4] + rng.normal(0.3, 0.2, n_samples), 0, 1)
        base[:, 10] += rng.uniform(0.1, 0.3, n_samples)

    elif attack_type == "false_data_injection":
        base[:, 1] = rng.uniform(12, 20, n_samples)  # unrealistic high rate
        base[:, 2] = np.clip(rng.uniform(-2, 0, n_samples), 0, 100)  # near-zero rejects
        base[:, 3] = 0.0  # no in-flight (fake)
        base[:, 12] = rng.uniform(6, 10, n_samples)  # abnormal I/O

    elif attack_type == "modbus_injection":
        base[:, 7] = 1.0  # alarm horn always on
        base[:, 8] = 1.0  # reject gate always on
        base[:, 13] = rng.uniform(8, 14, n_samples)  # high output sum
        base[:, 9] += rng.uniform(10, 30, n_samples)

    elif attack_type == "stuxnet_like":
        # Subtle: looks normal but scan time drifts and outputs slowly change
        drift = np.linspace(0, 1, n_samples)
        base[:, 11] += drift * 80  # gradual scan time increase
        base[:, 13] += drift * 4  # gradual output increase
        base[:, 1] -= drift * 3  # gradual production decline

    elif attack_type == "sensor_jamming":
        # Sensors stuck at constant values
        base[:, 4] = 1.0  # stuck filler sensor
        base[:, 5] = 1.0  # stuck capper sensor
        base[:, 6] = 0.0  # stuck quality sensor
        base[:, 2] += rng.uniform(3, 8, n_samples)

    elif attack_type == "replay":
        # Repeated patterns (low entropy)
        pattern = base[:10].copy()
        for j in range(0, n_samples, 10):
            end = min(j + 10, n_samples)
            base[j:end] = pattern[: end - j]
        base[:, 9] *= 1.5

    elif attack_type == "combined":
        # Multiple simultaneous attacks
        base[:, 9] *= rng.uniform(2.0, 4.0, n_samples)
        base[:, 7] = 1.0
        base[:, 1] += rng.normal(0, 5, n_samples)
        base[:, 11] *= rng.uniform(1.5, 3.0, n_samples)
        base[:, 2] += rng.uniform(5, 15, n_samples)

    return np.clip(base, 0, None).astype(np.float32)


# ── LSTM Autoencoder Model ────────────────────────────────────────────

class LSTMEncoder(nn.Module):
    def __init__(self, input_dim: int, hidden_dim: int, latent_dim: int, n_layers: int = 2):
        super().__init__()
        self.lstm = nn.LSTM(input_dim, hidden_dim, n_layers, batch_first=True, dropout=0.1)
        self.fc = nn.Linear(hidden_dim, latent_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        _, (h_n, _) = self.lstm(x)
        # Use last layer hidden state
        latent = self.fc(h_n[-1])
        return latent


class LSTMDecoder(nn.Module):
    def __init__(self, latent_dim: int, hidden_dim: int, output_dim: int, seq_len: int, n_layers: int = 2):
        super().__init__()
        self.seq_len = seq_len
        self.fc = nn.Linear(latent_dim, hidden_dim)
        self.lstm = nn.LSTM(hidden_dim, hidden_dim, n_layers, batch_first=True, dropout=0.1)
        self.output_fc = nn.Linear(hidden_dim, output_dim)

    def forward(self, z: torch.Tensor) -> torch.Tensor:
        h = self.fc(z)
        # Repeat latent vector for each timestep
        h = h.unsqueeze(1).repeat(1, self.seq_len, 1)
        out, _ = self.lstm(h)
        return self.output_fc(out)


class LSTMAutoencoder(nn.Module):
    """LSTM-based autoencoder for multivariate time-series anomaly detection."""

    def __init__(
        self,
        input_dim: int = N_FEATURES,
        hidden_dim: int = 64,
        latent_dim: int = 16,
        seq_len: int = 30,
        n_layers: int = 2,
    ):
        super().__init__()
        self.encoder = LSTMEncoder(input_dim, hidden_dim, latent_dim, n_layers)
        self.decoder = LSTMDecoder(latent_dim, hidden_dim, input_dim, seq_len, n_layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        z = self.encoder(x)
        return self.decoder(z)


# ── Normalization ─────────────────────────────────────────────────────

@dataclass
class FeatureScaler:
    """Min-max scaler learned from training data."""
    min_vals: np.ndarray = field(default_factory=lambda: np.zeros(N_FEATURES))
    max_vals: np.ndarray = field(default_factory=lambda: np.ones(N_FEATURES))

    def fit(self, data: np.ndarray) -> "FeatureScaler":
        self.min_vals = data.min(axis=0)
        self.max_vals = data.max(axis=0)
        # Avoid division by zero
        diff = self.max_vals - self.min_vals
        diff[diff < 1e-8] = 1.0
        self.max_vals = self.min_vals + diff
        return self

    def transform(self, data: np.ndarray) -> np.ndarray:
        return (data - self.min_vals) / (self.max_vals - self.min_vals)

    def to_dict(self) -> dict:
        return {"min_vals": self.min_vals.tolist(), "max_vals": self.max_vals.tolist()}

    @classmethod
    def from_dict(cls, d: dict) -> "FeatureScaler":
        scaler = cls()
        scaler.min_vals = np.array(d["min_vals"], dtype=np.float32)
        scaler.max_vals = np.array(d["max_vals"], dtype=np.float32)
        return scaler


# ── Windowing ─────────────────────────────────────────────────────────

def create_sequences(data: np.ndarray, seq_len: int = 30) -> np.ndarray:
    """Slide a window of seq_len over the data to create overlapping sequences."""
    sequences = []
    for i in range(len(data) - seq_len + 1):
        sequences.append(data[i : i + seq_len])
    return np.array(sequences, dtype=np.float32)


# ── Training ──────────────────────────────────────────────────────────

def train_lstm_autoencoder(
    normal_data: np.ndarray,
    *,
    seq_len: int = 30,
    hidden_dim: int = 64,
    latent_dim: int = 16,
    n_layers: int = 2,
    epochs: int = 50,
    batch_size: int = 64,
    learning_rate: float = 1e-3,
    threshold_quantile: float = 0.98,
    device: str = "auto",
    verbose: bool = True,
) -> dict[str, Any]:
    """Train an LSTM autoencoder on normal-operation telemetry.

    Returns a serializable artifact dict containing model weights, scaler,
    metadata, and the anomaly threshold.
    """
    dev = torch.device("cuda" if device == "auto" and torch.cuda.is_available() else "cpu")

    # Fit scaler
    scaler = FeatureScaler().fit(normal_data)
    scaled = scaler.transform(normal_data)

    # Create sequences
    sequences = create_sequences(scaled, seq_len)
    if verbose:
        print(f"Training data: {normal_data.shape[0]} samples → {sequences.shape[0]} windows of {seq_len}")

    dataset = torch.utils.data.TensorDataset(torch.from_numpy(sequences))
    loader = torch.utils.data.DataLoader(dataset, batch_size=batch_size, shuffle=True, drop_last=False)

    # Model
    model = LSTMAutoencoder(
        input_dim=N_FEATURES,
        hidden_dim=hidden_dim,
        latent_dim=latent_dim,
        seq_len=seq_len,
        n_layers=n_layers,
    ).to(dev)

    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=5, factor=0.5)
    criterion = nn.MSELoss()

    epoch_losses = []
    t0 = time.time()

    model.train()
    for epoch in range(epochs):
        total_loss = 0.0
        n_batches = 0
        for (batch,) in loader:
            batch = batch.to(dev)
            optimizer.zero_grad(set_to_none=True)
            recon = model(batch)
            loss = criterion(recon, batch)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total_loss += loss.item()
            n_batches += 1

        avg_loss = total_loss / max(n_batches, 1)
        epoch_losses.append(avg_loss)
        scheduler.step(avg_loss)

        if verbose and (epoch + 1) % 10 == 0:
            print(f"  Epoch {epoch+1:3d}/{epochs} — loss: {avg_loss:.6f}")

    train_time = time.time() - t0
    if verbose:
        print(f"Training complete in {train_time:.1f}s — final loss: {epoch_losses[-1]:.6f}")

    # Compute threshold from training reconstruction errors
    model.eval()
    all_errors = []
    with torch.no_grad():
        for (batch,) in loader:
            batch = batch.to(dev)
            recon = model(batch)
            errors = torch.mean((recon - batch) ** 2, dim=(1, 2))
            all_errors.extend(errors.cpu().numpy().tolist())

    threshold = float(np.quantile(all_errors, threshold_quantile))
    score_scale = max(threshold * 2.5, 1e-8)

    if verbose:
        print(f"Threshold (p{threshold_quantile*100:.0f}): {threshold:.6f}  scale: {score_scale:.6f}")
        print(f"Training error stats — mean: {np.mean(all_errors):.6f}  std: {np.std(all_errors):.6f}  max: {np.max(all_errors):.6f}")

    metadata = {
        "model_version": "lstm-autoencoder-v1",
        "model_type": "lstm_autoencoder",
        "n_features": N_FEATURES,
        "feature_names": FEATURE_NAMES,
        "seq_len": seq_len,
        "hidden_dim": hidden_dim,
        "latent_dim": latent_dim,
        "n_layers": n_layers,
        "epochs": epochs,
        "batch_size": batch_size,
        "learning_rate": learning_rate,
        "threshold": threshold,
        "threshold_quantile": threshold_quantile,
        "score_scale": score_scale,
        "trained_samples": int(normal_data.shape[0]),
        "final_train_loss": float(epoch_losses[-1]),
        "train_time_seconds": round(train_time, 2),
        "device": str(dev),
        "train_error_mean": float(np.mean(all_errors)),
        "train_error_std": float(np.std(all_errors)),
    }

    return {
        "type": "lstm_autoencoder",
        "state_dict": model.state_dict(),
        "scaler": scaler.to_dict(),
        "metadata": metadata,
        "epoch_losses": epoch_losses,
    }


# ── Save / Load ───────────────────────────────────────────────────────

def save_lstm_artifact(artifact: dict[str, Any], path: str) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    torch.save(artifact, p)


def load_lstm_artifact(path: str, *, device: str = "auto") -> dict[str, Any]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"LSTM artifact not found: {path}")

    artifact = torch.load(p, map_location="cpu", weights_only=False)
    if not isinstance(artifact, dict) or artifact.get("type") != "lstm_autoencoder":
        raise ValueError("Invalid LSTM autoencoder artifact")

    metadata = artifact["metadata"]
    dev = torch.device("cuda" if device == "auto" and torch.cuda.is_available() else "cpu")

    model = LSTMAutoencoder(
        input_dim=metadata["n_features"],
        hidden_dim=metadata["hidden_dim"],
        latent_dim=metadata["latent_dim"],
        seq_len=metadata["seq_len"],
        n_layers=metadata["n_layers"],
    ).to(dev)
    model.load_state_dict(artifact["state_dict"])
    model.eval()

    scaler = FeatureScaler.from_dict(artifact["scaler"])

    return {
        "model": model,
        "scaler": scaler,
        "metadata": metadata,
        "device": dev,
    }


# ── Real-time Scoring ─────────────────────────────────────────────────

@dataclass
class AnomalyDetector:
    """Stateful real-time anomaly detector that buffers telemetry and scores windows."""

    loaded: dict[str, Any] | None = None
    buffer: deque = field(default_factory=lambda: deque(maxlen=60))
    seq_len: int = 30
    score_history: deque = field(default_factory=lambda: deque(maxlen=300))
    last_score: float = 0.0
    last_anomaly: bool = False
    last_attack_probs: dict[str, float] = field(default_factory=dict)
    inference_ms: float = 0.0

    def load(self, artifact_path: str, device: str = "auto") -> bool:
        try:
            self.loaded = load_lstm_artifact(artifact_path, device=device)
            self.seq_len = self.loaded["metadata"]["seq_len"]
            self.buffer = deque(maxlen=self.seq_len * 2)
            return True
        except Exception as e:
            print(f"[AnomalyDetector] Failed to load model: {e}")
            return False

    def is_ready(self) -> bool:
        return self.loaded is not None and len(self.buffer) >= self.seq_len

    def ingest(self, telemetry: dict[str, Any]) -> None:
        vec = telemetry_to_vector(telemetry)
        self.buffer.append(vec)

    def score(self) -> dict[str, Any]:
        if not self.loaded or len(self.buffer) < self.seq_len:
            return {
                "anomaly_score": 0.0,
                "is_anomaly": False,
                "reconstruction_error": 0.0,
                "threshold": 0.0,
                "feature_errors": {},
                "attack_probabilities": {},
                "inference_ms": 0.0,
                "buffer_fill": len(self.buffer) / self.seq_len if self.loaded else 0.0,
                "model_version": "not_loaded",
            }

        t0 = time.time()
        model = self.loaded["model"]
        scaler = self.loaded["scaler"]
        metadata = self.loaded["metadata"]
        dev = self.loaded["device"]

        # Get latest window
        window = np.array(list(self.buffer)[-self.seq_len:], dtype=np.float32)
        scaled = scaler.transform(window)
        tensor = torch.from_numpy(scaled).unsqueeze(0).to(dev)

        with torch.no_grad():
            recon = model(tensor)
            error_per_feature = torch.mean((recon - tensor) ** 2, dim=1).squeeze(0).cpu().numpy()
            total_error = float(torch.mean((recon - tensor) ** 2).item())

        threshold = metadata["threshold"]
        score_scale = metadata["score_scale"]
        anomaly_score = max(0.0, min(100.0, (total_error / score_scale) * 100.0))
        is_anomaly = total_error >= threshold

        # Per-feature error breakdown
        feature_errors = {
            FEATURE_NAMES[i]: round(float(error_per_feature[i]), 6)
            for i in range(N_FEATURES)
        }

        # Attack type probability estimation based on feature error patterns
        attack_probs = self._estimate_attack_type(feature_errors, anomaly_score)

        self.inference_ms = (time.time() - t0) * 1000
        self.last_score = anomaly_score
        self.last_anomaly = is_anomaly
        self.last_attack_probs = attack_probs
        self.score_history.append(anomaly_score)

        return {
            "anomaly_score": round(anomaly_score, 2),
            "is_anomaly": is_anomaly,
            "reconstruction_error": round(total_error, 6),
            "threshold": round(threshold, 6),
            "feature_errors": feature_errors,
            "attack_probabilities": attack_probs,
            "inference_ms": round(self.inference_ms, 2),
            "buffer_fill": 1.0,
            "model_version": metadata.get("model_version", "lstm-autoencoder-v1"),
            "score_history": list(self.score_history)[-60:],
        }

    def _estimate_attack_type(self, feature_errors: dict[str, float], anomaly_score: float) -> dict[str, float]:
        """Heuristic attack-type classifier based on which features have highest error."""
        if anomaly_score < 15:
            return {}

        net_err = feature_errors.get("network_packet_rate", 0) + feature_errors.get("network_burst_ratio", 0)
        scan_err = feature_errors.get("scan_time_ms", 0)
        prod_err = feature_errors.get("production_rate", 0)
        reject_err = feature_errors.get("reject_rate", 0)
        sensor_err = sum(feature_errors.get(k, 0) for k in [
            "bottle_at_filler", "bottle_at_capper", "bottle_at_quality"
        ])
        output_err = feature_errors.get("io_output_sum", 0) + feature_errors.get("output_alarm_horn", 0)
        input_err = feature_errors.get("io_input_sum", 0)

        total = max(net_err + scan_err + prod_err + reject_err + sensor_err + output_err + input_err, 1e-8)

        probs = {
            "dos_flood": min(1.0, (net_err * 2 + scan_err) / total),
            "mitm": min(1.0, (reject_err + sensor_err * 0.5 + net_err * 0.3) / total),
            "false_data_injection": min(1.0, (prod_err + input_err + sensor_err) / total),
            "modbus_injection": min(1.0, (output_err * 2 + net_err * 0.5) / total),
            "stuxnet_like": min(1.0, (scan_err + prod_err * 0.5 + output_err * 0.5) / total),
            "sensor_jamming": min(1.0, (sensor_err * 2 + reject_err * 0.5) / total),
        }

        # Normalize to sum to ~1
        total_prob = sum(probs.values())
        if total_prob > 0:
            probs = {k: round(v / total_prob, 3) for k, v in probs.items()}

        return dict(sorted(probs.items(), key=lambda x: -x[1]))
