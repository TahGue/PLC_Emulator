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
