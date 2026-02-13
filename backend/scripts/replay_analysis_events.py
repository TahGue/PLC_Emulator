from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import pandas as pd
import requests


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Replay prior analyzer CSV logs through /analyze")
    parser.add_argument("--csv-path", required=True, help="Path to analysis CSV created by backend")
    parser.add_argument("--api-base-url", default="http://localhost:8001")
    parser.add_argument("--interval-seconds", type=float, default=0.2)
    parser.add_argument("--limit", type=int, default=0, help="Replay first N rows (0 = all)")
    parser.add_argument("--timeout-seconds", type=float, default=3.0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    csv_path = Path(args.csv_path)
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV log not found: {csv_path}")

    frame = pd.read_csv(csv_path)
    if frame.empty:
        raise ValueError("CSV file has no rows to replay")

    if "payload_json" not in frame.columns:
        raise ValueError("CSV must include 'payload_json' column")

    if args.limit > 0:
        frame = frame.head(args.limit)

    with requests.Session() as session:
        for index, row in frame.iterrows():
            payload = json.loads(row["payload_json"])
            response = session.post(
                f"{args.api_base_url.rstrip('/')}/analyze",
                json=payload,
                timeout=args.timeout_seconds,
            )
            response.raise_for_status()

            result = response.json()
            print(
                f"[{index}] replayed | process={result.get('process_score')} | "
                f"network={result.get('network_score')} | alerts="
                f"{result.get('process_anomaly')}/{result.get('network_alert')}"
            )

            time.sleep(max(args.interval_seconds, 0.0))


if __name__ == "__main__":
    main()
