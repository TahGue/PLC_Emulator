#!/usr/bin/env python3
"""Train the LSTM Autoencoder for ICS anomaly detection.

Usage:
    python scripts/train_lstm_anomaly.py [--output models/lstm_anomaly_detector.pt]

This script:
1. Generates synthetic normal-operation telemetry
2. Trains an LSTM autoencoder to learn the normal baseline
3. Evaluates detection accuracy on 8 attack types
4. Saves the model artifact for real-time inference
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow running from project root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from app.ml.lstm_autoencoder import (
    FEATURE_NAMES,
    generate_attack_data,
    generate_normal_data,
    save_lstm_artifact,
    train_lstm_autoencoder,
    create_sequences,
    FeatureScaler,
    LSTMAutoencoder,
)


def evaluate_model(artifact: dict, attack_types: list[str]) -> dict[str, dict]:
    """Evaluate the trained model on each attack type."""
    import torch

    metadata = artifact["metadata"]
    scaler = FeatureScaler.from_dict(artifact["scaler"])
    seq_len = metadata["seq_len"]
    threshold = metadata["threshold"]
    dev = torch.device("cpu")

    model = LSTMAutoencoder(
        input_dim=metadata["n_features"],
        hidden_dim=metadata["hidden_dim"],
        latent_dim=metadata["latent_dim"],
        seq_len=seq_len,
        n_layers=metadata["n_layers"],
    ).to(dev)
    model.load_state_dict(artifact["state_dict"])
    model.eval()

    results = {}

    for attack in attack_types:
        attack_data = generate_attack_data(n_samples=500, attack_type=attack, seed=200)
        scaled = scaler.transform(attack_data)
        sequences = create_sequences(scaled, seq_len)
        tensor = torch.from_numpy(sequences).to(dev)

        with torch.no_grad():
            recon = model(tensor)
            errors = torch.mean((recon - tensor) ** 2, dim=(1, 2)).cpu().numpy()

        detected = (errors >= threshold).sum()
        total = len(errors)
        detection_rate = detected / total * 100
        mean_error = float(np.mean(errors))
        max_error = float(np.max(errors))

        results[attack] = {
            "detection_rate": round(detection_rate, 1),
            "detected": int(detected),
            "total": int(total),
            "mean_error": round(mean_error, 6),
            "max_error": round(max_error, 6),
            "threshold": round(threshold, 6),
        }

    return results


def main():
    parser = argparse.ArgumentParser(description="Train LSTM anomaly detector")
    parser.add_argument("--output", default="models/lstm_anomaly_detector.pt", help="Output path")
    parser.add_argument("--samples", type=int, default=8000, help="Normal training samples")
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs")
    parser.add_argument("--seq-len", type=int, default=30, help="Sequence window length")
    parser.add_argument("--hidden-dim", type=int, default=64, help="LSTM hidden dimension")
    parser.add_argument("--latent-dim", type=int, default=16, help="Latent space dimension")
    parser.add_argument("--batch-size", type=int, default=64, help="Batch size")
    parser.add_argument("--lr", type=float, default=1e-3, help="Learning rate")
    args = parser.parse_args()

    print("=" * 60)
    print("LSTM Autoencoder — ICS Anomaly Detection Training")
    print("=" * 60)

    # 1. Generate training data
    print(f"\n[1/4] Generating {args.samples} normal-operation samples...")
    print(f"       Features ({len(FEATURE_NAMES)}): {', '.join(FEATURE_NAMES[:5])}...")
    normal_data = generate_normal_data(n_samples=args.samples)
    print(f"       Data shape: {normal_data.shape}")
    print(f"       Sample means: {np.mean(normal_data, axis=0)[:5].round(2)}")

    # 2. Train
    print(f"\n[2/4] Training LSTM Autoencoder...")
    print(f"       seq_len={args.seq_len}  hidden={args.hidden_dim}  latent={args.latent_dim}")
    print(f"       epochs={args.epochs}  batch={args.batch_size}  lr={args.lr}")

    artifact = train_lstm_autoencoder(
        normal_data,
        seq_len=args.seq_len,
        hidden_dim=args.hidden_dim,
        latent_dim=args.latent_dim,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        verbose=True,
    )

    # 3. Evaluate on attack types
    print(f"\n[3/4] Evaluating on attack scenarios...")
    attack_types = [
        "dos_flood", "mitm", "false_data_injection", "modbus_injection",
        "stuxnet_like", "sensor_jamming", "replay", "combined",
    ]

    eval_results = evaluate_model(artifact, attack_types)

    print(f"\n{'Attack Type':<25} {'Detection':>10} {'Mean Err':>10} {'Max Err':>10}")
    print("-" * 60)
    for attack, r in eval_results.items():
        bar = "█" * int(r["detection_rate"] / 5) + "░" * (20 - int(r["detection_rate"] / 5))
        print(f"  {attack:<23} {r['detection_rate']:>8.1f}%  {r['mean_error']:>10.6f} {r['max_error']:>10.6f}")
    print("-" * 60)

    avg_detection = np.mean([r["detection_rate"] for r in eval_results.values()])
    print(f"  Average detection rate: {avg_detection:.1f}%")

    # Also evaluate on normal data (should have low false positive rate)
    normal_eval = evaluate_model(artifact, ["dos_flood"])  # reuse function structure
    # Actually compute FPR on normal data
    import torch
    metadata = artifact["metadata"]
    scaler = FeatureScaler.from_dict(artifact["scaler"])
    test_normal = generate_normal_data(n_samples=1000, seed=999)
    scaled = scaler.transform(test_normal)
    sequences = create_sequences(scaled, args.seq_len)
    tensor = torch.from_numpy(sequences)
    model_eval = LSTMAutoencoder(
        input_dim=metadata["n_features"], hidden_dim=metadata["hidden_dim"],
        latent_dim=metadata["latent_dim"], seq_len=args.seq_len, n_layers=metadata["n_layers"],
    )
    model_eval.load_state_dict(artifact["state_dict"])
    model_eval.eval()
    with torch.no_grad():
        recon = model_eval(tensor)
        errors = torch.mean((recon - tensor) ** 2, dim=(1, 2)).cpu().numpy()
    fp_rate = (errors >= metadata["threshold"]).sum() / len(errors) * 100
    print(f"  False positive rate (normal data): {fp_rate:.1f}%")

    # Store eval in artifact
    artifact["evaluation"] = {
        "attack_results": eval_results,
        "average_detection_rate": round(avg_detection, 1),
        "false_positive_rate": round(fp_rate, 1),
    }

    # 4. Save
    print(f"\n[4/4] Saving artifact to {args.output}...")
    save_lstm_artifact(artifact, args.output)
    file_size = Path(args.output).stat().st_size / 1024
    print(f"       Saved ({file_size:.0f} KB)")

    print(f"\n{'=' * 60}")
    print(f"Training complete!")
    print(f"  Model: {metadata['model_version']}")
    print(f"  Threshold: {metadata['threshold']:.6f}")
    print(f"  Avg detection: {avg_detection:.1f}%  |  FPR: {fp_rate:.1f}%")
    print(f"  Artifact: {args.output}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
