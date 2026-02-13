# Bottle Factory PLC Emulator (Open-Source MVP)

A complete, local, PC-based PLC factory emulator with:
- Browser PLC + production line simulation (JavaScript)
- AI-style anomaly scoring + network security anomaly lane (Python/FastAPI)
- Persistent telemetry storage in PostgreSQL (Docker)

All libraries used are free and open source.

## Features

### 🏭 Factory Simulation
- **Conveyor Belt System**: Animated bottle transport with variable speed control
- **Processing Stations**: Filler, Capper, and Quality Check stations
- **Real-time Production**: Bottles move through the production line with realistic timing
- **Quality Control**: Random quality checks with reject/reject gate functionality

### 🧠 PLC Core System
- **Ladder Logic Engine**: Full implementation of PLC ladder logic programming
- **I/O Management**: 10 digital inputs and 9 digital outputs
- **Scan Cycle**: Configurable PLC scan time (default 100ms)
- **Timer/Counter Support**: Built-in timer and counter instructions
- **Emergency Stop**: Safety-critical emergency stop functionality

### 🤖 AI + Security Lane
- **Process anomaly lane** wired to `I:0/8`
- **Network security lane** wired to `I:0/9`
- **Security lockout output** on `O:0/8`
- **Scoring backend** (FastAPI): combines rule-based checks with model-backed vision signals + fallback drift lane
- **Signal ingest APIs** for external camera and network-monitor sidecars (`/signals/vision`, `/signals/security`)
- **Event persistence** in PostgreSQL for replay/debug analysis

### 📊 Visualization & Monitoring
- **Ladder Logic Display**: Real-time visualization of ladder logic execution
- **I/O Status Panel**: Live monitoring of all inputs and outputs
- **Production Metrics**: Production rate, efficiency, reject rate, and uptime tracking
- **AI/Security Metrics**: anomaly score, network risk, model confidence
- **Detection Feed**: chronological anomaly and security events
- **Alarm System**: Active alarm management with severity levels
- **Factory Floor Animation**: Visual representation of the production process

### 🚀 Recruiter-Ready ML Showcase
- **Scenario Lab**: switch between baseline, process drift, network attack, and combined incident
- **Explainability Panel**: process/network feature contributions with visual bars
- **Decision Intelligence**: risk level + recommended operational action
- **Session ML KPIs**: analyses run, anomaly hit rate, average inference latency
- **Demo Report Export**: one-click JSON export for portfolio evidence

### 🎛️ Control Interface
- **Start/Stop/Reset Controls**: Full system control
- **Emergency Stop Button**: Safety-critical stop functionality
- **Ladder Logic Editor**: View and edit ladder logic programs
- **Single Scan Mode**: Execute individual PLC scans for debugging
- **Keyboard Shortcuts**: Quick access to common functions

## How It Works

### PLC Operation
The emulator simulates a real PLC system with:
- **Input Scan**: Reads sensor states from the factory simulation
- **Logic Execution**: Runs ladder logic program to determine outputs
- **Output Update**: Controls actuators in the factory simulation
- **Continuous Scanning**: Repeats the cycle at configurable intervals

### Factory Process
1. **Bottle Entry**: New bottles enter at the conveyor start
2. **Filler Station**: Bottles are filled when positioned correctly
3. **Capper Station**: Filled bottles receive caps
4. **Quality Check**: Final inspection with random rejection
5. **Output**: Completed bottles are counted and displayed

### Ladder Logic
The system includes 8 pre-programmed ladder logic rungs:
- System control and safety interlocks
- Conveyor motor control
- Filler valve control
- Capper motor control
- Quality check activation
- Reject gate control
- Alarm horn control
- Running light indication

## File Structure

```
bottle-factory-plc/
├── docker-compose.yml       # PostgreSQL + analyzer API (Docker)
├── RECRUITER_DEMO.md        # 3-5 minute recruiter presentation script
├── telemetry-client.js      # Frontend client for analyzer API
├── index.html              # Main application interface
├── styles.css              # Styling and animations
├── plc-core.js             # PLC engine and ladder logic
├── ladder-logic.js         # Ladder logic visualization
├── factory-simulation.js   # Factory process simulation
├── app.js                  # Main application controller
└── backend/
    ├── Dockerfile
    ├── requirements.txt
    ├── app/main.py         # FastAPI anomaly + security analyzer
    ├── app/ml/model.py     # Lightweight MVTec feature-model helpers
    ├── scripts/train_mvtec_model.py
    ├── scripts/evaluate_mvtec_model.py
    ├── scripts/vision_camera_simulator.py
    ├── scripts/network_security_monitor.py
    ├── scripts/replay_analysis_events.py
    ├── scripts/openplc_modbus_bridge.py
    └── scripts/README.md
```

## Getting Started (Full MVP)

### 1) Start backend services (PostgreSQL + Analyzer API)

```bash
docker compose up --build
```

This starts:
- Postgres on `localhost:5432`
- Analyzer API on `localhost:8001`

### 2) Serve frontend

From project root:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/index.html
```

### 3) Run factory simulation

1. Click **START**
2. Watch conveyor/filler/capper/quality stations
3. Observe AI + network scores and I/O points (`I:0/8`, `I:0/9`, `O:0/8`)
4. Trigger stop/reset/emergency to test lockouts and alarm behavior

### 4) (Optional) Run vision + security sidecars

Use these once you have a trained model artifact and MVTec dataset downloaded.

```bash
# Train model (good images only)
python backend/scripts/train_mvtec_model.py --dataset-root <MVTecRoot> --category bottle --artifact-path backend/models/mvtec_feature_model.pkl

# Evaluate on test split
python backend/scripts/evaluate_mvtec_model.py --dataset-root <MVTecRoot> --category bottle --artifact-path backend/models/mvtec_feature_model.pkl

# Feed camera/model outputs to backend
python backend/scripts/vision_camera_simulator.py --dataset-root <MVTecRoot> --category bottle --artifact-path backend/models/mvtec_feature_model.pkl --include-good --loop

# Feed security lane (use --mode simulate if packet capture permissions are unavailable)
python backend/scripts/network_security_monitor.py --mode simulate --loop

# Bridge analyzer vision/security lanes to OpenPLC via Modbus TCP
python backend/scripts/openplc_modbus_bridge.py --openplc-host 127.0.0.1 --openplc-port 502 --process-flag-coil 8 --security-flag-coil 9 --address-base 0
```

> The bridge polls `GET /signals` and writes process/security flags to OpenPLC coils, so you can map them to PLC logic equivalent to `I:0/8` and `I:0/9`.

## Controls

### Main Controls
- **START**: Begins the production process
- **STOP**: Stops the production process
- **RESET**: Resets the entire system
- **EMERGENCY STOP**: Immediate safety stop

### Keyboard Shortcuts
- **Ctrl/Cmd + S**: Start/Stop toggle
- **Ctrl/Cmd + R**: Reset system
- **Ctrl/Cmd + E**: Emergency stop

### Ladder Logic Controls
- **Edit Logic**: Toggle ladder logic editor mode
- **Run Scan**: Execute a single PLC scan

## I/O Mapping

### Inputs (I:0/x)
- **I:0/0**: Emergency Stop (normally closed)
- **I:0/1**: Start Button
- **I:0/2**: Stop Button (normally closed)
- **I:0/3**: Bottle at Filler Sensor
- **I:0/4**: Bottle at Capper Sensor
- **I:0/5**: Bottle at Quality Sensor
- **I:0/6**: Level Sensor (fill level ready)
- **I:0/7**: Cap Available Sensor
- **I:0/8**: AI Process Anomaly Flag (from backend)
- **I:0/9**: Network Security Alert Flag (from backend)

### Outputs (O:0/x)
- **O:0/0**: Conveyor Motor
- **O:0/1**: Fill Valve
- **O:0/2**: Capper Motor
- **O:0/3**: Quality Check Light
- **O:0/4**: Reject Gate
- **O:0/5**: Alarm Horn
- **O:0/6**: Running Light
- **O:0/7**: System Ready Light
- **O:0/8**: Security Lockout

## Analyzer API

- `GET /health` - backend + DB health
- `POST /signals/vision` - ingest latest model/camera anomaly signal
- `POST /signals/security` - ingest latest network monitor signal
- `GET /signals` - inspect latest cached vision/security lanes
- `POST /analyze` - analyze one telemetry sample
- `GET /events?limit=20` - recent persisted analysis events

`POST /analyze` response includes recruiter-friendly ML metadata:
- `process_components`
- `network_components`
- `risk_level`
- `recommended_action`
- `model_version`
- `vision_anomaly_score`
- `vision_defect_flag`
- `security_flag`
- `process_source` / `network_source`

The analyzer writes each event into `analysis_events` table in PostgreSQL.

When CSV logging is enabled (`ENABLE_CSV_LOGGING=true`), the backend appends replayable events to:

```text
backend/logs/analysis_events.csv
```

Replay utility:

```bash
python backend/scripts/replay_analysis_events.py --csv-path backend/logs/analysis_events.csv --limit 50
```

Script details and flags are documented in:

```text
backend/scripts/README.md
```

## Recruiter Demo

Use @`RECRUITER_DEMO.md` for a concise 3-5 minute walkthrough focused on ML value and engineering depth.

## Technical Details

### PLC Scan Cycle
The PLC operates on a continuous scan cycle:
1. Read all input states
2. Execute ladder logic program
3. Update all output states
4. Repeat (default 100ms cycle time)

### Ladder Logic Instructions
- **XIC**: Examine If Closed (normally open contact)
- **XIO**: Examine If Open (normally closed contact)
- **OTE**: Output Energize
- **OTL**: Output Latch
- **OTU**: Output Unlatch
- **TON**: Timer On-Delay
- **CTU**: Count Up

### Production Metrics
- **Production Rate**: Bottles per minute
- **Efficiency**: System efficiency percentage
- **Reject Rate**: Percentage of rejected bottles
- **Uptime**: Total system running time

## Browser Compatibility

This emulator works best in modern browsers that support:
- HTML5 Canvas (for ladder logic visualization)
- CSS3 Animations (for factory floor animations)
- ES6 JavaScript (for modern JavaScript features)

Recommended browsers:
- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## Educational Value

This emulator is designed for:
- **PLC Programming**: Learn ladder logic programming concepts
- **Industrial Automation**: Understand factory automation principles
- **System Integration**: See how PLCs control physical processes
- **Safety Systems**: Learn about emergency stops and safety interlocks
- **Process Control**: Understand feedback control systems

## Open-Source Stack

- Frontend: vanilla HTML/CSS/JavaScript
- API: FastAPI + Uvicorn
- Database: PostgreSQL
- Driver: psycopg3
- Runtime: Docker Compose

## Troubleshooting

### Common Issues
1. **Animation Not Working**: Check browser compatibility and enable JavaScript
2. **Ladder Logic Not Displaying**: Ensure HTML5 Canvas is supported
3. **Performance Issues**: Close other browser tabs to improve performance
4. **Backend shows OFFLINE**: run `docker compose up --build` and verify `http://localhost:8001/health`
5. **Controls Not Responding**: Refresh the page and try again

### Debug Information
Open the browser console (F12) to see:
- PLC scan cycle information
- Input/output state changes
- Alarm notifications
- System status messages

---

**Enjoy learning about industrial automation with this interactive PLC emulator!** 🏭🤖
