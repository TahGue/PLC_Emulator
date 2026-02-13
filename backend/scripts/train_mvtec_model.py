from __future__ import annotations

import argparse
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.ml import save_artifact, train_mvtec_feature_model


def _collect_good_images(dataset_root: Path, category: str) -> list[str]:
    train_good_dir = dataset_root / category / "train" / "good"
    if not train_good_dir.exists():
        raise FileNotFoundError(f"Could not find expected directory: {train_good_dir}")

    image_paths: list[str] = []
    for extension in ("*.png", "*.jpg", "*.jpeg", "*.bmp", "*.webp"):
        image_paths.extend(str(path) for path in train_good_dir.rglob(extension))

    image_paths = sorted(set(image_paths))
    if not image_paths:
        raise ValueError(f"No training images found under: {train_good_dir}")

    return image_paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train lightweight MVTec feature anomaly model")
    parser.add_argument("--dataset-root", required=True, help="Path to MVTec AD dataset root")
    parser.add_argument("--category", default="bottle", help="MVTec category folder (default: bottle)")
    parser.add_argument(
        "--artifact-path",
        default="./models/mvtec_feature_model.pkl",
        help="Output path for serialized model artifact",
    )
    parser.add_argument("--model-version", default="mvtec-feature-ocsvm-v1")
    parser.add_argument("--max-samples", type=int, default=0, help="Limit number of good images (0 = all)")
    parser.add_argument("--nu", type=float, default=0.05)
    parser.add_argument("--gamma", default="scale")
    parser.add_argument("--threshold-quantile", type=float, default=0.98)
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    dataset_root = Path(args.dataset_root)
    if not dataset_root.exists():
        raise FileNotFoundError(f"Dataset root does not exist: {dataset_root}")

    image_paths = _collect_good_images(dataset_root, args.category)
    if args.max_samples > 0:
        image_paths = image_paths[: args.max_samples]

    artifact = train_mvtec_feature_model(
        image_paths,
        model_version=args.model_version,
        nu=args.nu,
        gamma=args.gamma,
        threshold_quantile=args.threshold_quantile,
    )

    save_artifact(artifact, args.artifact_path)

    metadata = artifact.get("metadata", {})
    print("Training complete")
    print(f"  Samples: {len(image_paths)}")
    print(f"  Artifact: {Path(args.artifact_path).resolve()}")
    print(f"  Model version: {metadata.get('model_version')}")
    print(f"  Threshold: {metadata.get('threshold')}")
    print(f"  Feature dim: {metadata.get('feature_dim')}")


if __name__ == "__main__":
    main()
