# Contributing

## Prerequisites

- Python 3.11+
- Node.js 18+ (for Playwright frontend tests)
- Docker + Docker Compose (for backend services)
- PyTorch 2.x (for ML model training — CPU-only is fine)
- Jupyter (optional, for running the ML notebook)

## Local Setup

```bash
# Clone
git clone https://github.com/TahGue/PLC_Emulator.git
cd PLC_Emulator

# Install Python deps (use a virtualenv)
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r backend/requirements.txt

# (Optional) Start Postgres + Analyzer
docker compose up --build -d

# Serve frontend
python -m http.server 8000
```

## Running Tests

```bash
# Backend unit tests
cd PLC_Emulator
PYTHONPATH=backend python -m pytest backend/tests/ -v
```

On Windows PowerShell:

```powershell
$env:PYTHONPATH='backend'; python -m pytest backend/tests/ -v
```

Frontend tests use Playwright:

```bash
npm install playwright
npx playwright install chromium
node tests/test-attack-sim.mjs
```

## Architecture Overview

```
index.html ──loads──> plc-core.js          (PLC engine + ladder instructions)
                      component-registry.js (component type definitions)
                      simulation-engine.js  (signal propagation + PLC bridge)
                      layout-editor.js      (SVG canvas editor)
                      ladder-logic.js       (ladder canvas renderer)
                      attack-simulator.js   (ICS/SCADA attack types)
                      telemetry-client.js   (backend API + SSE client)
                      app.js                (main controller, wires everything)

backend/app/
  main.py              ─── FastAPI (analyze, signals, anomaly endpoints)
  ml/
    model.py           ─── MVTec image feature model (sklearn)
    torch_autoencoder.py ─ Conv autoencoder for vision (PyTorch)
    lstm_autoencoder.py  ─ LSTM autoencoder for time-series anomaly detection (PyTorch)
```

Key data flows:
- **Layout wiring → syncLadderFromLayout() → LadderProgram → PLCCore.executeLadderLogic()**
- **Simulation tick → collectAnomalyTelemetry() → POST /anomaly/score → renderAnomalyPanel()**

## Code Style

- Python: follow existing patterns, no additional linting enforced yet
- JavaScript: vanilla ES6, no build step, no bundler
- Keep imports at the top of files
- Don't add comments unless they clarify non-obvious logic

## Adding a New Component Type

1. Open `component-registry.js`
2. Add a new `this.register({...})` call in `registerAll()` with:
   - `type`: unique snake_case identifier
   - `category`: one of `sensors`, `actuators`, `logic`, `process`, `indicators`
   - `ports`: array of `{ id, type: 'input'|'output', side, offset, label, dataType }`
   - `defaultProps`: default property values (must include `address` and `label`)
   - `renderSVG(w, h, state)`: returns SVG markup string
   - `simulate(inputs, props, dt, state)`: returns `{ outputs: {...}, state: {...} }`
3. The component will auto-appear in the palette under its category
4. If it has an `address` prop, it auto-maps to PLC I/O via `rebuildAddressMaps()`
5. When wired to other components, `syncLadderFromLayout()` auto-generates ladder rungs
6. Update `README.md` Component Types section

## Adding a New Attack Type

1. Open `attack-simulator.js`
2. Add a new entry in `defineAttacks()` Map with:
   - `id`: unique snake_case identifier
   - `name`, `icon`, `category` (network/protocol/process/physical), `severity`, `description`
   - `effects`: object with `packetRateMultiplier`, `burstRatio`, `unauthorizedRatio`, `maliciousRatio`
   - `componentEffects`: array of `{ type, target, severity }` where type is one of:
     `sensor_corrupted`, `actuator_overridden`, `setpoint_drift`, `comm_loss`, `logic_corrupted`, `scan_overrun`
3. The attack auto-appears in the Attack Simulation Lab UI
4. Update the attack table in `README.md`

## Adding a New Preset Template

1. Open `app.js`, find `getPresets()`
2. Add a new key with `{ version: 1, components: [...], wires: [...] }`
3. Each component needs: `id`, `type`, `x`, `y`, `props` (with `address` and `label`)
4. Each wire needs: `fromComp`, `fromPort`, `toComp`, `toPort`
5. Wire sensors to actuators so `syncLadderFromLayout()` generates meaningful ladder rungs
6. Add a button or dropdown option in `index.html` to load the preset
7. Update `README.md` Preset Templates section

## Adding a New Script

1. Create the script in `backend/scripts/`
2. Add CLI args with `argparse`
3. Add unit tests in `backend/tests/test_<name>.py`
4. Document usage in `backend/scripts/README.md`
5. Add to the file tree in `README.md`

## Adding a New API Endpoint

1. Add the route in `backend/app/main.py`
2. Add integration tests in `backend/tests/test_api_integration.py`
3. Document in the Analyzer API section of `README.md`
4. If it exposes metrics, wire counters in the `/metrics` endpoint

## Working with the ML Pipeline

### Retraining the LSTM Anomaly Detector

```bash
cd backend
python3 scripts/train_lstm_anomaly.py \
  --output models/lstm_anomaly_detector.pt \
  --epochs 50 --samples 8000
```

The trained artifact is saved to `backend/models/lstm_anomaly_detector.pt` and auto-loaded by the backend on startup via the `LSTM_MODEL_PATH` environment variable.

### Adding a New Attack Type to the Synthetic Data Generator

1. Open `backend/app/ml/lstm_autoencoder.py`
2. Add a new `elif attack_type == "your_attack":` block in `generate_attack_data()`
3. Modify the baseline `normal_data` array to simulate your attack's telemetry signature
4. Add the attack name to `ATTACK_TYPES` in `backend/scripts/train_lstm_anomaly.py`
5. Retrain the model and verify detection rate

### Adding a New Feature to the Telemetry Vector

1. Add the feature name to `FEATURE_NAMES` in `backend/app/ml/lstm_autoencoder.py`
2. Update `telemetry_to_vector()` to extract the new value
3. Update `generate_normal_data()` and `generate_attack_data()` to include synthetic values
4. Update `AnomalyTelemetryPayload` in `backend/app/main.py`
5. Update `collectAnomalyTelemetry()` in `app.js` to collect the new feature from the frontend
6. Retrain the model (old model artifacts will be incompatible)

### Running the Jupyter Notebook

```bash
cd notebooks
jupyter notebook lstm_anomaly_detection.ipynb
```

The notebook demonstrates the full pipeline with visualizations. Update it when changing the model architecture or evaluation methodology.

## Commit Messages

Use clear imperative messages:
- `Add <feature>`
- `Fix <bug description>`
- `Update <file> for <reason>`
