# Demo Guide

Step-by-step walkthrough for the PLC Factory Emulator — layout editor, attack simulation, ladder logic, and real-time monitoring.

---

## Quick Start (no backend required)

### 1) Serve the frontend

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/index.html`

### 2) Explore the layout

The **Bottle Factory** preset loads automatically. You will see:
- **SVG canvas** with sensors, actuators, conveyors, and indicator lights
- **Wires** connecting component ports (sensor OUT → actuator CMD)
- **Component palette** on the left with 5 categories
- **Property panel** on the right (click any component to inspect)

### 3) Check the ladder logic

Scroll down to the **Ladder Logic** panel. You should see auto-generated rungs:

| Rung | Logic | Description |
|------|-------|-------------|
| R0 | `XIC I:0/8 → OTE O:0/8` | Security Lockout |
| R1 | `XIC I:0/1 → OTE O:0/0` | Start SW → Conv Motor |
| R2 | `XIC I:0/3 → OTE O:0/1` | Filler Sensor → Fill Valve |
| R3 | `XIC I:0/4 → OTE O:0/2` | Capper Sensor → Capper Motor |
| R4 | `XIC I:0/5 → OTE O:0/3` | Quality Sensor → Quality Light |
| ... | ... | Remaining actuator rungs |

These rungs were **auto-generated** from the layout wiring by `syncLadderFromLayout()`.

### 4) Start the simulation

1. Click **Simulate** mode (top toolbar)
2. Click **START**
3. Observe:
   - PLC I/O panel updating in real-time
   - Ladder rungs lighting up **green** when energized
   - Component animations on the canvas
   - Monitoring metrics updating

### 5) Run an attack

1. Scroll to the **Attack Simulation Lab** panel
2. Toggle on **DoS / Packet Flood**
3. Watch in real-time:
   - **Packet Monitor**: packet rate spikes, burst ratio climbs
   - **Risk Gauge**: fills and changes color to HIGH / CRITICAL
   - **Component Impact Feed**: shows affected components
   - **PLC cycle time**: inflated (visible in status bar)
4. Adjust the **intensity slider** (10-100%) to vary severity

### 6) Combine multiple attacks

1. Keep DoS active, then also toggle on **Man-in-the-Middle**
2. Toggle on **Stuxnet-Style Attack**
3. Observe combined effects:
   - Network score climbs past 70 → security flag fires
   - Process score climbs as sensor values drift
   - `O:0/8` Security Lockout activates in the I/O panel
   - Alarm events appear in the detection feed

### 7) Reset attacks

Click **Reset All Attacks** to deactivate everything. Scores return to baseline.

### 8) Try category filters

Use the filter buttons (All / Network / Protocol / Process / Physical) above the attack list to show only specific attack categories.

### 9) Switch presets

1. Click **STOP** to pause the simulation
2. Use the **Preset** dropdown to load **Sorting Station** or **Mixing Process**
3. Notice the ladder logic **automatically re-syncs** with new rungs matching the new layout
4. Click **START** again to simulate the new layout

### 10) Export a report

Click **Export Demo Report** to download a JSON snapshot of the current session (KPIs, latest analysis, recent events).

---

## Full Stack (with backend)

### 11) Start backend services

```bash
docker compose up --build -d
```

Verify: `http://localhost:8001/health` should return `{"ok": true, "db": true, ...}`

With the backend running, the frontend shows:
- Backend status: **ONLINE**
- Stream status: **LIVE**
- Analysis events persisted to PostgreSQL

### 12) Optional: vision + security sidecars

```bash
# Train a model
python backend/scripts/train_mvtec_model.py --dataset-root <MVTecRoot> --category bottle

# Feed vision signals
python backend/scripts/vision_camera_simulator.py --dataset-root <MVTecRoot> --category bottle --include-good --loop

# Feed security signals
python backend/scripts/network_security_monitor.py --mode simulate --loop
```

### 13) Optional: backend attack injection

```bash
python backend/scripts/network_attack_injector.py \
  --target-host 127.0.0.1 --target-port 502 \
  --duration-seconds 8 --burst-rate 120 \
  --payload-mode modbus-illegal-function \
  --check-analyzer --require-security-flag
```

### 14) Optional: OpenPLC integration

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

### 15) Optional: monitoring dashboard

```bash
# Grafana + Prometheus
docker compose -f docker-compose.yml -f docker-compose.grafana.yml up --build

# Or lightweight SSE dashboard
python -m http.server 8090 --directory backend/dashboard
# Open http://localhost:8090/live_events_dashboard.html
```

---

## What to Look For

| Panel | What to observe |
|-------|----------------|
| **I/O Status** | Input/output bits toggling as simulation runs and attacks fire |
| **Ladder Logic** | Rungs lighting green when their conditions are met |
| **Packet Monitor** | Packet rate, burst ratio, and malicious ratio bars |
| **Risk Gauge** | Horizontal gauge filling from LOW → CRITICAL |
| **Component Impact Feed** | Real-time log of attack effects on components |
| **Detection Feed** | Chronological anomaly and security events |
| **Alarms** | Active alarms triggered by threshold crossings |
| **Session KPIs** | Analyses run, anomaly hit rate, average inference latency |

---

## Run Tests

```bash
# Backend tests
cd backend
PYTHONPATH=. python -m pytest tests/ -v

# Full-stack smoke test (with Docker Compose running)
python scripts/smoke_test.py
```
