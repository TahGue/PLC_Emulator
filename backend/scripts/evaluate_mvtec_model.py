from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score

from app.ml import load_artifact, score_image


SUPPORTED_EXTENSIONS = ("*.png", "*.jpg", "*.jpeg", "*.bmp", "*.webp")


def _collect_images(directory: Path) -> list[Path]:
    files: list[Path] = []
    for extension in SUPPORTED_EXTENSIONS:
        files.extend(directory.rglob(extension))
    return sorted(set(files))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate lightweight MVTec model artifact")
    parser.add_argument("--dataset-root", required=True, help="Path to MVTec AD dataset root")
    parser.add_argument("--category", default="bottle", help="MVTec category folder (default: bottle)")
    parser.add_argument(
        "--artifact-path",
        default="./models/mvtec_feature_model.pkl",
        help="Path to serialized model artifact",
    )
    parser.add_argument(
        "--report-path",
        default="",
        help="Optional JSON output path for metrics report",
    )
    parser.add_argument("--max-good", type=int, default=0, help="Limit good test samples (0 = all)")
    parser.add_argument("--max-defect", type=int, default=0, help="Limit defect test samples (0 = all)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    dataset_root = Path(args.dataset_root)
    test_root = dataset_root / args.category / "test"
    if not test_root.exists():
        raise FileNotFoundError(f"Could not find expected test directory: {test_root}")

    artifact = load_artifact(args.artifact_path)
    metadata = artifact.get("metadata", {})

    good_paths = _collect_images(test_root / "good")
    defect_paths: list[Path] = []

    for child in sorted(test_root.iterdir()):
        if not child.is_dir() or child.name == "good":
            continue
        defect_paths.extend(_collect_images(child))

    if args.max_good > 0:
        good_paths = good_paths[: args.max_good]
    if args.max_defect > 0:
        defect_paths = defect_paths[: args.max_defect]

    if not good_paths:
        raise ValueError("No good test images found.")
    if not defect_paths:
        raise ValueError("No defect test images found.")

    y_true: list[int] = []
    y_pred: list[int] = []

    for path in good_paths:
        score = score_image(artifact, str(path))
        y_true.append(0)
        y_pred.append(1 if bool(score["defect_flag"]) else 0)

    for path in defect_paths:
        score = score_image(artifact, str(path))
        y_true.append(1)
        y_pred.append(1 if bool(score["defect_flag"]) else 0)

    metrics = {
        "model_version": metadata.get("model_version", "unknown"),
        "threshold": metadata.get("threshold"),
        "samples_good": len(good_paths),
        "samples_defect": len(defect_paths),
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
    }

    print(json.dumps(metrics, indent=2))

    if args.report_path:
        report_path = Path(args.report_path)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
        print(f"Saved report: {report_path.resolve()}")


if __name__ == "__main__":
    main()
