# PLC Factory Emulator (Open-Source MVP)

A complete, local, PC-based PLC factory emulator with:
- Customizable visual layout editor with drag-and-drop components (JavaScript)
- Real-time simulation engine with signal propagation
- **Real-time attack simulation lab** with 10 ICS/SCADA attack types and live packet analysis
- **LSTM Autoencoder anomaly detection** — deep learning pipeline trained on PLC telemetry (PyTorch)
- AI-style anomaly scoring + network security anomaly lane (Python/FastAPI)
- Persistent telemetry storage in PostgreSQL (Docker)
- Jupyter notebook with full ML pipeline walkthrough, ROC curves, and evaluation

All libraries used are free and open source.

## Features

### 🏭 Visual Layout Editor
- **Drag-and-drop**: Place sensors, actuators, logic gates, process equipment, and indicators on an SVG canvas
- **Component registry**: 20+ component types across 5 categories (sensors, actuators, logic, process, indicators)
- **Wiring**: Click-to-connect ports with automatic signal routing
- **Preset templates**: 5 fully-wired presets (Bottle Factory, Sorting Station, Mixing Process, Conveyor Merge, CIP Sequence)
- **Zoom/pan/grid**: Full canvas navigation with snap-to-grid support
- **Import/Export**: Save and load layouts as JSON

### 🧠 PLC Core System
- **Ladder Logic Engine**: Full implementation of PLC ladder logic programming
- **Auto-Sync Ladder Logic**: Ladder rungs are automatically generated from the visual layout wiring
- **I/O Management**: 16 digital inputs and 16 digital outputs
- **Scan Cycle**: Configurable PLC scan time (default 100ms)
- **Timer/Counter Support**: Built-in timer and counter instructions
- **Emergency Stop**: Safety-critical emergency stop functionality
- **Live Energized Display**: Ladder rungs light up green in real-time during simulation

### 🔄 Simulation Engine
- **Signal propagation**: Signals flow through wires between component ports
- **Component simulation**: Each component type has its own physics model
- **PLC bridge**: Sensors write to PLC inputs, PLC outputs drive actuators
- **Real-time tick**: Continuous simulation loop with configurable tick rate

### 🛡️ Attack Simulation Lab
Real-time ICS/SCADA attack simulation with 10 attack types:

| Category | Attack | Severity | Description |
|----------|--------|----------|-------------|
| Network | **DoS / Packet Flood** | Critical | Overwhelms PLC network with massive packet volume |
| Network | **Man-in-the-Middle** | Critical | Intercepts and modifies sensor readings in transit |
| Network | **ARP Spoofing** | Medium | Poisons ARP tables causing communication blackout |
| Protocol | **Modbus Command Injection** | Critical | Injects unauthorized Modbus write commands |
| Protocol | **PLC CPU Overload** | High | Rapid diagnostic requests overwhelm PLC CPU |
| Process | **False Data Injection** | High | Spoofs sensor readings to mask real conditions |
| Process | **Stuxnet-Style Attack** | Critical | Gradually drifts setpoints while reporting normal values |
| Process | **Firmware Manipulation** | Critical | Alters PLC logic execution subtly |
| Physical | **Sensor Jamming** | Medium | EMI interference causes incorrect field readings |
| Network | **Replay Attack** | High | Replays captured valid commands out of sequence |

Each attack features:
- **Toggle activation** with per-attack intensity slider (10-100%)
- **Real-time packet generation** with simulated Modbus/TCP traffic
- **Direct component effects**: sensor corruption, actuator override, setpoint drift, comm loss, logic corruption
- **Category filtering**: filter by network / protocol / process / physical
- **One-click reset** to deactivate all attacks

### 📊 Real-Time Monitoring
- **Process Score**: 0-100 anomaly score based on component state analysis
- **Network Score**: 0-100 risk score based on packet rate, burst ratio, unauthorized attempts
- **Risk Gauge**: Visual gauge with LOW / MEDIUM / HIGH / CRITICAL levels
- **Packet Monitor**: Live packet rate, burst ratio, malicious ratio with animated bars
- **Packet Log**: Scrolling log of individual Modbus/TCP packets with type coloring
- **Component Impact Feed**: Real-time feed showing which components are affected and how
- **Score Breakdowns**: Per-factor contribution bars for process and network scores
- **Detection Feed**: Chronological anomaly and security events
- **Alarm System**: Active alarm management with severity levels

### 🧠 LSTM Anomaly Detection (Deep Learning)
Real-time anomaly detection using an LSTM Autoencoder trained on PLC telemetry:

- **14-feature time-series input**: conveyor state, production rate, reject rate, sensor states, PLC I/O counts, network packet rate, burst ratio, scan time
- **LSTM Encoder-Decoder architecture**: 2-layer LSTM encoder → 16-dim latent space → 2-layer LSTM decoder
- **Sliding window** (30 timesteps) with min-max normalization
- **96.1% average detection rate** across 8 ICS attack types with 6.6% FPR
- **Real-time inference** at ~3-15ms per window via FastAPI backend
- **Attack classification**: heuristic classifier estimates attack type from per-feature reconstruction errors
- **Live dashboard panel**: anomaly score gauge, score history chart, feature error breakdown, attack probability bars

| Attack Type | Detection Rate | AUC |
|-------------|---------------|-----|
| DoS / Packet Flood | 100% | ~1.0 |
| Man-in-the-Middle | 100% | ~1.0 |
| False Data Injection | 100% | ~1.0 |
| Modbus Injection | 100% | ~1.0 |
| Replay Attack | 100% | ~1.0 |
| Combined Attack | 100% | ~1.0 |
| Sensor Jamming | 96.2% | ~0.99 |
| Stuxnet-Style (subtle) | 72.4% | ~0.93 |

### 🤖 AI + Security Lane (Backend)
- **Process anomaly lane** wired to `I:0/8`
- **Network security lane** wired to `I:0/9`
- **Security lockout output** on `O:0/8`
- **Scoring backend** (FastAPI): rule-based checks + model-backed vision signals + fallback drift lane
- **Signal ingest APIs** for external camera and network-monitor sidecars
- **Event persistence** in PostgreSQL for replay/debug analysis

### 🪜 Ladder Logic Auto-Sync
The ladder program is automatically generated from the visual layout:
- **Wire-based generation**: Sensor→actuator wires become XIC/OTE rungs
- **Logic chain support**: Sensor→logic gate→actuator paths are traced
- **Address matching fallback**: Unwired actuators matched to sensors by I/O address
- **Security lockout rung**: Always-present rung for `I:0/8` → `O:0/8`
- **Auto re-sync**: Updates on preset load and layout changes
- **Rung comments**: Each rung shows component labels (e.g., "Filler Sensor → Fill Valve")
- **Live rendering**: Energized rungs glow green at 5 Hz refresh during simulation

### 🎛️ Control Interface
- **Edit / Simulate modes**: Switch between layout editing and live simulation
- **Start/Stop/Reset Controls**: Full system control
- **Emergency Stop Button**: Safety-critical stop functionality
- **Ladder Logic Display**: Auto-synced ladder rungs with live energized state
- **Single Scan Mode**: Execute individual PLC scans for debugging
- **Keyboard Shortcuts**: Quick access to common functions

## How It Works

### Architecture

```
                    ┌─────────────────────────────────────────┐
                    │           Browser (localhost:8000)        │
                    │                                           │
                    │  ┌──────────┐  ┌───────────────────────┐ │
                    │  │  Layout   │  │   Attack Simulator    │ │
                    │  │  Editor   │  │  (10 ICS/SCADA types) │ │
                    │  └────┬─────┘  └───────────┬───────────┘ │
                    │       │                     │             │
                    │  ┌────▼─────────────────────▼───────────┐ │
                    │  │       Simulation Engine               │ │
                    │  │  (signal propagation + component sim) │ │
                    │  └────┬─────────────────────┬───────────┘ │
                    │       │                     │             │
                    │  ┌────▼─────┐  ┌────────────▼──────────┐ │
                    │  │ PLC Core │  │  Real-Time Analysis    │ │
                    │  │ (ladder) │  │  (process + network)   │ │
                    │  └──────────┘  └────────────────────────┘ │
                    └──────────────────┬────────────────────────┘
                                       │ (optional)
                    ┌──────────────────▼────────────────────────┐
                    │       Backend (localhost:8001)             │
                    │  FastAPI + PostgreSQL + ML models          │
                    └───────────────────────────────────────────┘
```

### Simulation Flow
1. **Layout**: Place components on the canvas in Edit mode
2. **Wire**: Connect component ports to create signal paths
3. **Ladder Sync**: Ladder rungs auto-generate from wiring (sensor→actuator connections)
4. **Simulate**: Switch to Simulate mode and click Start
5. **Attack**: Toggle attacks in the Attack Simulation Lab
6. **Monitor**: Watch real-time effects on components, scores, packets, and ladder state

### PLC Scan Cycle
The PLC operates on a continuous scan cycle:
1. Read sensor outputs into PLC inputs
2. Execute auto-synced ladder program (XIC/XIO contacts → OTE coils)
3. Built-in security lockout: `I:0/8 OR I:0/9` → `O:0/8`
4. Write PLC outputs to actuator inputs
5. Attack simulator modifies component states (if attacks active)
6. Real-time analysis generates process/network scores
7. Ladder display updates energized states (green = active)
8. Repeat (default 100ms cycle time)

## File Structure

```
PLC_Emulator/
├── index.html               # Main application interface
├── styles.css               # Styling (editor, attack panel, monitoring)
├── plc-core.js              # PLC engine, ladder instructions, LadderProgram execution
├── component-registry.js    # 20+ component type definitions with SVG rendering
├── simulation-engine.js     # Signal propagation, PLC bridge, serialize/deserialize
├── layout-editor.js         # SVG canvas editor with drag/drop/wire/zoom/pan
├── ladder-logic.js          # Ladder logic canvas renderer with live energized display
├── attack-simulator.js      # 10 ICS/SCADA attack types + real-time packet analysis
├── telemetry-client.js      # Frontend client for backend API + SSE
├── app.js                   # Main application controller + syncLadderFromLayout()
├── factory-simulation.js    # Legacy bottle factory simulation (standalone)
├── docker-compose.yml       # PostgreSQL + analyzer API (Docker)
├── docker-compose.grafana.yml
├── DEMO_GUIDE.md
├── CONTRIBUTING.md
├── README.md
├── notebooks/
│   └── lstm_anomaly_detection.ipynb  # Full ML pipeline notebook (train + eval + viz)
└── backend/
    ├── Dockerfile
    ├── requirements.txt
    ├── app/main.py              # FastAPI anomaly + security analyzer + /anomaly/* endpoints
    ├── app/ml/model.py          # MVTec feature-model helpers
    ├── app/ml/torch_autoencoder.py  # PyTorch conv-autoencoder (vision)
    ├── app/ml/lstm_autoencoder.py   # LSTM Autoencoder for time-series anomaly detection
    ├── models/
    │   └── lstm_anomaly_detector.pt  # Pre-trained LSTM model artifact
    ├── scripts/
    │   ├── train_lstm_anomaly.py     # Train LSTM anomaly detector
    │   ├── train_mvtec_model.py
    │   ├── evaluate_mvtec_model.py
    │   ├── vision_camera_simulator.py
    │   ├── network_security_monitor.py
    │   ├── network_attack_injector.py
    │   ├── replay_analysis_events.py
    │   ├── openplc_modbus_bridge.py
    │   ├── openplc_runtime_validator.py
    │   ├── e2e_scenario_validator.py
    │   └── README.md
    ├── dashboard/live_events_dashboard.html
    └── openplc/
        ├── tag_mapping.example.json
        └── OPENPLC_FACTORYIO_RUNBOOK.md
```

## Getting Started

### 1) Serve frontend (no backend needed for attack simulation)

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/index.html`

### 2) Use the emulator

1. The **Bottle Factory** preset loads automatically
2. Click **Simulate** mode, then **Start**
3. Scroll down to the **Attack Simulation Lab**
4. Toggle attacks on/off and observe real-time effects
5. Adjust intensity sliders to vary attack severity
6. Watch the **Packet Monitor**, **Risk Gauge**, and **Component Impact Feed**

### 3) (Optional) Start backend services

For persistent event storage and ML-backed analysis:

```bash
docker compose up --build
```

This starts:
- Postgres on `localhost:5432`
- Analyzer API on `localhost:8001`

### 4) (Optional) Run vision + security sidecars

```bash
# Train model (good images only)
python backend/scripts/train_mvtec_model.py --dataset-root <MVTecRoot> --category bottle --artifact-path backend/models/mvtec_feature_model.pkl

# Train torch autoencoder (GPU-accelerated)
python backend/scripts/train_mvtec_model.py --dataset-root <MVTecRoot> --category bottle --model-type torch-autoencoder --artifact-path backend/models/mvtec_torch_autoencoder.pt --epochs 8 --device auto

# Evaluate on test split
python backend/scripts/evaluate_mvtec_model.py --dataset-root <MVTecRoot> --category bottle --artifact-path backend/models/mvtec_feature_model.pkl

# Feed camera/model outputs to backend
python backend/scripts/vision_camera_simulator.py --dataset-root <MVTecRoot> --category bottle --artifact-path backend/models/mvtec_feature_model.pkl --include-good --loop

# Feed security lane (simulate mode)
python backend/scripts/network_security_monitor.py --mode simulate --loop

# Inject attack traffic
python backend/scripts/network_attack_injector.py --target-host 127.0.0.1 --target-port 502 --duration-seconds 8 --burst-rate 120 --payload-mode modbus-illegal-function --check-analyzer --require-security-flag --report-json backend/logs/network_attack_report.json

# Validate E2E scenarios
python backend/scripts/e2e_scenario_validator.py --api-base-url http://localhost:8001 --report-json backend/logs/e2e_scenario_report.json
```

## Attack Simulation Guide

### Quick Start
1. Start the simulation (Simulate mode + Start)
2. Scroll to **Attack Simulation Lab**
3. Click the **toggle switch** on any attack to activate it
4. Adjust the **intensity slider** (appears when active)
5. Watch effects in real-time across all monitoring panels

### Attack Effects on Components

| Effect | Affected Components | What Happens |
|--------|-------------------|-------------|
| `sensor_corrupted` | Sensors | Output values randomized or noisy |
| `actuator_overridden` | Actuators | Input values forced by attacker |
| `setpoint_drift` | Process equipment | Values slowly drift from setpoints |
| `comm_loss` | All | I/O zeroed (simulates network blackout) |
| `logic_corrupted` | Logic gates | Output values inverted |
| `scan_overrun` | PLC Core | Cycle time inflated up to 500ms |

### Monitoring Panels

- **Packet Stats**: Rate, burst ratio, unauthorized attempts, malicious ratio
- **Packet Bars**: Animated bars showing normal/burst/malicious traffic proportions
- **Packet Log**: Scrolling monospace log of individual Modbus/TCP packets
- **Risk Gauge**: Horizontal gauge that fills and changes color by risk level
- **Score Breakdowns**: Per-factor bars for process and network anomaly scores
- **Impact Feed**: Latest component-level impacts from active attacks
- **Alarms**: Triggered automatically when scores exceed thresholds

## Controls

### Main Controls
- **Edit / Simulate**: Toggle between layout editing and live simulation
- **START**: Begins the simulation and PLC scan cycle
- **STOP**: Stops the simulation
- **RESET**: Resets the entire system including attack states
- **EMERGENCY STOP**: Immediate safety stop

### Keyboard Shortcuts
- **Ctrl/Cmd + S**: Start/Stop toggle
- **Ctrl/Cmd + R**: Reset system
- **Ctrl/Cmd + E**: Emergency stop
- **Delete**: Remove selected component (Edit mode)

### Layout Editor Controls
- **Mouse wheel**: Zoom in/out
- **Right-click drag**: Pan canvas
- **Click port**: Start wiring
- **Drag from palette**: Add component

## I/O Mapping

### Inputs (I:0/x)
- **I:0/0 - I:0/7**: Mapped to sensor component addresses
- **I:0/8**: AI Process Anomaly Flag (from backend or local analysis)
- **I:0/9**: Network Security Alert Flag (from backend or local analysis)

### Outputs (O:0/x)
- **O:0/0 - O:0/7**: Mapped to actuator component addresses
- **O:0/8**: Security Lockout

## Analyzer API

- `GET /health` - backend + DB health
- `POST /signals/vision` - ingest vision anomaly signal
- `POST /signals/security` - ingest network monitor signal
- `GET /signals` - inspect cached vision/security lanes
- `POST /analyze` - analyze one telemetry sample
- `GET /events?limit=20` - recent persisted analysis events
- `GET /events/stream` - Server-Sent Events feed for live dashboards
- `GET /metrics` - Prometheus text exposition format

### Anomaly Detection API

- `POST /anomaly/score` - ingest telemetry sample + return LSTM anomaly score, feature errors, attack classification
- `POST /anomaly/ingest` - buffer telemetry sample only (no scoring)
- `GET /anomaly/status` - model loaded status, buffer fill, last score, feature names
- `GET /anomaly/history` - rolling anomaly score history (last 300 ticks)

## Component Types

### Sensors
`proximity_sensor`, `photoelectric_sensor`, `temperature_sensor`, `pressure_sensor`, `level_sensor`, `flow_sensor`, `encoder`

### Actuators
`motor`, `solenoid_valve`, `pneumatic_cylinder`, `heater`, `pump`, `conveyor`

### Logic
`and_gate`, `or_gate`, `not_gate`, `timer_on`, `counter`, `comparator`, `sr_latch`

### Process
`tank`, `pipe`, `mixer`, `heat_exchanger`

### Indicators
`indicator_light`, `gauge`, `seven_segment`, `alarm_beacon`

## Preset Templates

All presets are fully wired (wire count ≥ component count) with auto-generated ladder logic.

| Preset | Components | Wires | Description |
|--------|-----------|-------|-------------|
| **Bottle Factory** | 25 | 25 | Conveyor line with fill, cap, quality stations, logic gates, tank monitoring |
| **Sorting Station** | 20 | 21 | Dual-path sorting with A/B diverters, logic gates, counters, bin conveyors |
| **Mixing Process** | 22 | 22 | Feed/mix tanks, pump, heater, mixer, drain loop, alarm logic, gauges |
| **Conveyor Merge** | 22 | 25 | Two infeed conveyors merging into one outfeed with priority logic |
| **CIP Sequence** | 20 | 22 | Clean-in-place system with water/chemical valves, phases, drain, tank |

## Browser Compatibility

Recommended browsers:
- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## ML / Deep Learning Pipeline

### Training the LSTM Anomaly Detector

```bash
cd backend
python3 scripts/train_lstm_anomaly.py \
  --output models/lstm_anomaly_detector.pt \
  --epochs 50 --samples 8000 --seq-len 30 \
  --hidden-dim 64 --latent-dim 16
```

The script generates synthetic normal-operation telemetry, trains the LSTM autoencoder, evaluates on 8 attack types, and saves the model artifact.

### Jupyter Notebook

A complete ML pipeline walkthrough is available in `notebooks/lstm_anomaly_detection.ipynb`:

1. **Data Generation** — synthetic normal + 8 attack type telemetry
2. **Feature Exploration** — distribution plots for Normal vs DoS vs MITM
3. **Model Training** — LSTM Autoencoder with loss curve visualization
4. **ROC Curves** — per-attack ROC with AUC scores
5. **Feature Importance** — heatmap of per-feature reconstruction error by attack type
6. **Confusion Matrix** — binary classification (Normal vs Anomaly)
7. **Architecture Summary** — parameter counts and hyperparameters

```bash
cd notebooks
jupyter notebook lstm_anomaly_detection.ipynb
```

### Model Architecture

```
LSTMAutoencoder(
  (encoder): LSTMEncoder(
    (lstm): LSTM(14, 64, num_layers=2, batch_first=True, dropout=0.1)
    (fc): Linear(64, 16)
  )
  (decoder): LSTMDecoder(
    (fc): Linear(16, 64)
    (lstm): LSTM(64, 64, num_layers=2, batch_first=True, dropout=0.1)
    (output_fc): Linear(64, 14)
  )
)
```

## Open-Source Stack

- **Frontend**: vanilla HTML/CSS/JavaScript + SVG + SSE EventSource
- **API**: FastAPI + Uvicorn
- **Database**: PostgreSQL (psycopg3)
- **ML**: PyTorch (LSTM Autoencoder + Conv Autoencoder) + scikit-learn (One-Class SVM) + OpenCV
- **OT Protocols**: Modbus TCP (pymodbus), Scapy packet capture
- **Notebooks**: Jupyter for ML pipeline walkthrough
- **Monitoring** (optional): Grafana + Prometheus (`docker-compose.grafana.yml`)
- **Runtime**: Docker Compose

## Troubleshooting

### Common Issues
1. **Components not rendering**: Ensure browser supports SVG + ES6; check console (F12) for errors
2. **Attacks have no effect**: Simulation must be running (Simulate mode + Start)
3. **Backend shows OFFLINE**: Run `docker compose up --build` and verify `http://localhost:8001/health` (backend is optional for attack simulation)
4. **Anomaly panel shows "not loaded"**: Backend must be running with the LSTM model at the `LSTM_MODEL_PATH` location
5. **Performance Issues**: Close other browser tabs; reduce number of active attacks
6. **Layout not saving**: Use Export Layout button to save as JSON file

### Debug Information
Open the browser console (F12) to see:
- `[PLC]` prefixed initialization and runtime messages
- Component rendering and wire connection logs
- Attack simulation and analysis events
- Backend connection status

---

**Enjoy learning about industrial automation and ICS security with this interactive PLC emulator!** 🏭🛡️
