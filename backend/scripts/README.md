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

### Manual packet-injection attack simulation

```bash
python backend/scripts/network_attack_injector.py \
  --target-host 127.0.0.1 \
  --target-port 502 \
  --duration-seconds 8 \
  --burst-rate 120 \
  --payload-mode modbus-illegal-function \
  --check-analyzer \
  --require-security-flag \
  --report-json backend/logs/network_attack_report.json
```

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

## 7) Validate OpenPLC lockout runtime behavior

```bash
python backend/scripts/openplc_runtime_validator.py \
  --openplc-host 127.0.0.1 \
  --openplc-port 502 \
  --process-flag-address 8 \
  --security-flag-address 9 \
  --lockout-address 8 \
  --address-base 0 \
  --report-json backend/logs/openplc_validation_report.json
```

This runs baseline/process/security/combined scenarios and verifies that lockout output follows expected behavior.

Example tag map reference:

```text
backend/openplc/tag_mapping.example.json
```

## 8) Validate full E2E scenarios (baseline/defect/attack/combined)

Analyzer-only verification:

```bash
python backend/scripts/e2e_scenario_validator.py \
  --api-base-url http://localhost:8001 \
  --report-json backend/logs/e2e_scenario_report.json
```

Analyzer + OpenPLC lockout verification:

```bash
python backend/scripts/e2e_scenario_validator.py \
  --api-base-url http://localhost:8001 \
  --check-openplc \
  --openplc-host 127.0.0.1 \
  --openplc-port 502 \
  --openplc-lockout-coil-address 8 \
  --address-base 0 \
  --report-json backend/logs/e2e_scenario_report.json
```

## 9) Optional live dashboard (SSE stream)

Serve the static dashboard page:

```bash
python -m http.server 8090 --directory backend/dashboard
```

Open:

```text
http://localhost:8090/live_events_dashboard.html
```

The dashboard consumes:

```text
GET /events/stream
```
