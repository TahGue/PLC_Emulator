# Backend Script Quickstart

These scripts support the model + signal lanes used by the analyzer API.

## 1) Train a lightweight MVTec model artifact

```bash
python backend/scripts/train_mvtec_model.py \
  --dataset-root <MVTecRoot> \
  --category bottle \
  --artifact-path backend/models/mvtec_feature_model.pkl
```

## 2) Evaluate the artifact on MVTec test split

```bash
python backend/scripts/evaluate_mvtec_model.py \
  --dataset-root <MVTecRoot> \
  --category bottle \
  --artifact-path backend/models/mvtec_feature_model.pkl \
  --report-path backend/models/mvtec_eval_report.json
```

## 3) Send model outputs as vision lane signal

```bash
python backend/scripts/vision_camera_simulator.py \
  --dataset-root <MVTecRoot> \
  --category bottle \
  --artifact-path backend/models/mvtec_feature_model.pkl \
  --include-good \
  --loop
```

## 4) Send network lane signal

### Simulated mode (no capture privileges required)

```bash
python backend/scripts/network_security_monitor.py --mode simulate --loop
```

### Packet sniff mode

```bash
python backend/scripts/network_security_monitor.py --mode sniff --loop
```

> On Windows, sniff mode typically needs Npcap + elevated privileges.

## 5) Replay prior analyzer CSV events

```bash
python backend/scripts/replay_analysis_events.py \
  --csv-path backend/logs/analysis_events.csv \
  --limit 100
```

## 6) Bridge analyzer signals to OpenPLC via Modbus TCP

```bash
python backend/scripts/openplc_modbus_bridge.py \
  --analyzer-base-url http://localhost:8001 \
  --openplc-host 127.0.0.1 \
  --openplc-port 502 \
  --process-flag-coil 8 \
  --security-flag-coil 9 \
  --process-score-register 100 \
  --security-score-register 101 \
  --address-base 0
```

Useful flags:

- `--dry-run`: validate analyzer polling and flag derivation without Modbus writes.
- `--on-fetch-error clear`: clears outputs when analyzer is unreachable (default is `hold-last`).
- `--address-base 1`: use one-based Modbus addresses if your OpenPLC mapping UI is one-based.
