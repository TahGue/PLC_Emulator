from __future__ import annotations

import argparse
import itertools
import random
import time
from datetime import datetime, timezone
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import requests

from app.ml import load_artifact, load_torch_artifact, score_image, score_torch_image


SUPPORTED_EXTENSIONS = ("*.png", "*.jpg", "*.jpeg", "*.bmp", "*.webp")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Send vision anomaly signals to analyzer API")
    parser.add_argument("--api-base-url", default="http://localhost:8001")
    parser.add_argument("--artifact-path", default="./models/mvtec_feature_model.pkl")
    parser.add_argument("--dataset-root", required=True, help="Path to MVTec AD dataset root")
    parser.add_argument("--category", default="bottle", help="MVTec category folder (default: bottle)")
    parser.add_argument("--split", default="test", choices=["train", "test"])
    parser.add_argument("--include-good", action="store_true", help="Include good images in sequence")
    parser.add_argument("--shuffle", action="store_true")
    parser.add_argument("--loop", action="store_true")
    parser.add_argument("--interval-seconds", type=float, default=1.0)
    parser.add_argument("--max-images", type=int, default=0, help="Limit images to send (0 = all)")
    parser.add_argument("--timeout-seconds", type=float, default=3.0)
    parser.add_argument("--device", default="auto", help="Torch device (auto/cpu/cuda) for autoencoder artifacts")
    return parser.parse_args()


def _collect_image_paths(dataset_root: Path, category: str, split: str, include_good: bool) -> list[Path]:
    split_root = dataset_root / category / split
    if not split_root.exists():
        raise FileNotFoundError(f"Split directory not found: {split_root}")

    candidates: list[Path] = []
    for child in sorted(split_root.iterdir()):
        if not child.is_dir():
            continue
        if not include_good and child.name == "good":
            continue
        for extension in SUPPORTED_EXTENSIONS:
            candidates.extend(child.rglob(extension))

    unique_candidates = sorted(set(candidates))
    if not unique_candidates:
        raise ValueError(f"No images found under {split_root} with include_good={include_good}")

    return unique_candidates


def _confidence_from_score(anomaly_score: float) -> float:
    return max(5.0, min(99.0, 100.0 - abs(50.0 - anomaly_score)))


def _post_vision_signal(
    session: requests.Session,
    *,
    api_base_url: str,
    timeout_seconds: float,
    anomaly_score: float,
    defect_flag: bool,
    model_version: str,
    inference_ms: float,
    image_path: Path,
) -> None:
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "anomaly_score": round(anomaly_score, 3),
        "defect_flag": bool(defect_flag),
        "model_version": model_version,
        "confidence": round(_confidence_from_score(anomaly_score), 2),
        "inference_ms": round(inference_ms, 3),
        "source": "mvtec-camera-simulator",
        "image_path": str(image_path),
    }

    response = session.post(
        f"{api_base_url.rstrip('/')}/signals/vision",
        json=payload,
        timeout=timeout_seconds,
    )
    response.raise_for_status()


def main() -> None:
    args = parse_args()

    artifact_path_obj = Path(args.artifact_path)
    is_torch = artifact_path_obj.suffix.lower() in {".pt", ".pth"}

    if is_torch:
        loaded = load_torch_artifact(args.artifact_path, device=args.device)
        model_version = str(loaded.get("metadata", {}).get("model_version", "mvtec-torch-autoencoder-v1"))
        _score_fn = lambda path: score_torch_image(loaded, str(path))
    else:
        artifact = load_artifact(args.artifact_path)
        model_version = str(artifact.get("metadata", {}).get("model_version", "mvtec-feature-ocsvm-v1"))
        _score_fn = lambda path: score_image(artifact, str(path))

    image_paths = _collect_image_paths(
        dataset_root=Path(args.dataset_root),
        category=args.category,
        split=args.split,
        include_good=args.include_good,
    )

    if args.shuffle:
        random.shuffle(image_paths)

    if args.max_images > 0:
        image_paths = image_paths[: args.max_images]

    sequence = itertools.cycle(image_paths) if args.loop else iter(image_paths)
    sent_count = 0

    with requests.Session() as session:
        for image_path in sequence:
            started = time.perf_counter()
            score = _score_fn(image_path)
            inference_ms = (time.perf_counter() - started) * 1000.0

            _post_vision_signal(
                session,
                api_base_url=args.api_base_url,
                timeout_seconds=args.timeout_seconds,
                anomaly_score=float(score["anomaly_score"]),
                defect_flag=bool(score["defect_flag"]),
                model_version=model_version,
                inference_ms=inference_ms,
                image_path=image_path,
            )

            sent_count += 1
            print(
                f"[{sent_count}] Sent {image_path.name} | score={score['anomaly_score']:.2f} | "
                f"defect={bool(score['defect_flag'])}"
            )

            if not args.loop and sent_count >= len(image_paths):
                break

            if args.max_images > 0 and sent_count >= args.max_images:
                break

            time.sleep(max(args.interval_seconds, 0.0))


if __name__ == "__main__":
    main()
