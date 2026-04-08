# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2024-04-08

### Added

#### Core Emulator
- **Visual Layout Editor**: Drag-and-drop SVG canvas with 20+ component types across 5 categories (sensors, actuators, logic, process, indicators)
- **PLC Core System**: Full ladder logic engine with XIC, XIO, OTE, OTL, OTU, TON, CTU instructions
- **Auto-Sync Ladder Logic**: Automatic generation of ladder rungs from visual layout wiring
- **Scan Cycle Debugger**: Canvas-based timeline with per-µs phase timing and per-rung execution analysis

#### Physics Simulation
- **High-fidelity component models**: Motor (5-phase state machine), Solenoid Valve, Pneumatic Cylinder, Pump, Heater, Conveyor, Tank
- **Signal propagation**: Wires connect component ports with automatic signal routing
- **Real-time tick**: Continuous simulation loop at 60 Hz

#### Failure & Attack
- **Failure Injection Engine**: 12 realistic industrial failure modes (sensor drift, valve stuck, motor overheating, etc.)
- **Attack Simulation Lab**: 10 ICS/SCADA attack types (DoS, MITM, Modbus injection, etc.)
- **Real-time packet analysis**: Simulated Modbus/TCP traffic with log visualization

#### ML & Analytics
- **LSTM Autoencoder**: Deep learning anomaly detection trained on synthetic PLC telemetry
- **Jupyter Notebook**: Full ML pipeline walkthrough with ROC curves and evaluation
- **Station Abstraction**: Auto-detected stations with KPI tracking, OEE calculation, and fault aggregation

#### Training & UI
- **Training Scenario Engine**: 8 guided challenges across 5 categories with scoring and hints
- **Training Scenarios**: Ladder logic diagnosis, failure troubleshooting, cyber attack detection, timing optimization
- **Live displays**: I/O panel, anomaly score gauge, score history chart, feature error breakdown

#### Backend & Deployment
- **FastAPI Backend**: REST API for anomaly scoring, signal ingestion, event storage
- **PostgreSQL**: Persistent telemetry storage with event history
- **Docker Compose**: Full stack deployment (frontend, backend, postgres, security monitor)
- **Grafana/Prometheus**: Optional monitoring overlay

### Changed

- **Container-first workflow**: Docker Compose is now the primary way to run the emulator
- **Frontend containerization**: Nginx-based frontend container served on port 8080
- **Security monitor sidecar**: Continuous security signal simulation in containerized deployment
- **Telemetry client**: Dynamic backend URL resolution for containerized environments

### Fixed

- **Training scenario start**: Fixed ladder renderer API call in training engine setup
- **Ladder editor integration**: Real ladder editor behavior with full UI wiring

### Removed

- **Legacy simulation**: `factory-simulation.js` moved to `legacy/` directory (standalone, not integrated)

---

## [0.9.0] - 2024-02-15

### Added

- Initial PLC emulator core with basic ladder logic
- Component registry with sensors and actuators
- Basic simulation engine with signal propagation

### Known Issues

- Training scenarios require full backend stack
- Anomaly detection metrics are evaluated on synthetic data only
