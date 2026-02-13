# Demo Guide

Step-by-step walkthrough for testing the Bottle Factory PLC Emulator.

## 1) Start the backend

```bash
docker compose up --build -d
```

Verify: `http://localhost:8001/health` should return `{"ok": true, "db": true, ...}`

## 2) Serve the frontend

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/index.html`

## 3) Run the factory

1. Click **START**
2. Observe:
   - PLC I/O panel updating (`I:0/8`, `I:0/9`, `O:0/8`)
   - Backend status shows **ONLINE**, Stream shows **LIVE**
   - Production metrics counting up

## 4) Test scenarios

Use the **Scenario Lab** buttons to switch between:

| Scenario | What happens |
|----------|-------------|
| **Normal Baseline** | Low scores, no alerts |
| **Process Drift** | Production rate drops, reject rate rises → process anomaly fires |
| **Network Attack** | High packet rate + burst ratio → network alert fires |
| **Combined Incident** | Both lanes fire → security lockout on `O:0/8` |

For each scenario, check:
- Process score and network score in the metrics panel
- Risk level and recommended action in the explainability panel
- Feature contribution bars (which inputs drove the score)
- Detection feed entries at the bottom

## 5) Export a report

Click **Export Demo Report** to download a JSON snapshot of the current session (KPIs, latest analysis, recent events).

## 6) Optional: vision + security sidecars

If you have the MVTec AD dataset:

```bash
# Train a model
python backend/scripts/train_mvtec_model.py --dataset-root <MVTecRoot> --category bottle

# Feed vision signals to the analyzer
python backend/scripts/vision_camera_simulator.py --dataset-root <MVTecRoot> --category bottle --include-good --loop

# Feed security signals
python backend/scripts/network_security_monitor.py --mode simulate --loop
```

## 7) Optional: attack simulation

```bash
python backend/scripts/network_attack_injector.py \
  --target-host 127.0.0.1 --target-port 502 \
  --duration-seconds 8 --burst-rate 120 \
  --payload-mode modbus-illegal-function \
  --check-analyzer --require-security-flag
```

## 8) Optional: OpenPLC integration

If OpenPLC runtime is running:

```bash
# Bridge analyzer flags to PLC coils
python backend/scripts/openplc_modbus_bridge.py \
  --openplc-host 127.0.0.1 --openplc-port 502 \
  --process-flag-coil 8 --security-flag-coil 9

# Validate lockout behavior
python backend/scripts/openplc_runtime_validator.py \
  --openplc-host 127.0.0.1 --openplc-port 502 \
  --report-json backend/logs/openplc_validation_report.json
```

## 9) Optional: monitoring dashboard

```bash
# Grafana + Prometheus
docker compose -f docker-compose.yml -f docker-compose.grafana.yml up --build

# Or lightweight SSE dashboard
python -m http.server 8090 --directory backend/dashboard
# Open http://localhost:8090/live_events_dashboard.html
```

## 10) Run tests

```bash
cd backend
PYTHONPATH=. python -m pytest tests/ -v
```

## 11) Full-stack smoke test

With Docker Compose running:

```bash
python scripts/smoke_test.py
```

This hits every API endpoint and verifies the full stack (Postgres + Analyzer) is working end-to-end.
