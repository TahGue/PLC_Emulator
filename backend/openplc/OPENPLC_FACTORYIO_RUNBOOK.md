# OpenPLC + Factory I/O + Beremiz Integration Runbook

This runbook connects the AI/security analyzer lanes to OpenPLC and gives a repeatable validation workflow.

## 1) Prerequisites

- OpenPLC Runtime running on host or VM (`Modbus TCP` enabled, default port `502`).
- Factory I/O scene configured (if using 3D simulation).
- Beremiz installed for stepping/watch operations (optional but recommended).
- Analyzer stack running (`docker compose up --build`) and sidecars available.

## 2) Recommended tag/address mapping

Use `backend/openplc/tag_mapping.example.json` as your starting point.

Recommended address set (0-based):

- `coil 8` -> AI process anomaly flag (equivalent to `I:0/8`)
- `coil 9` -> security flag (equivalent to `I:0/9`)
- `holding register 100` -> process score (`0..100`)
- `holding register 101` -> security score (`0..100`)
- `coil 8` (output side in your PLC program) -> security lockout output (`O:0/8`)

> If your OpenPLC/driver UI is one-based, set `--address-base 1` in scripts.

## 3) Start analyzer + sidecars

From project root:

```bash
docker compose up --build
```

Optional sidecars:

```bash
python backend/scripts/vision_camera_simulator.py --dataset-root <MVTecRoot> --category bottle --artifact-path backend/models/mvtec_feature_model.pkl --include-good --loop
python backend/scripts/network_security_monitor.py --mode simulate --loop
```

## 4) Bridge analyzer lanes into OpenPLC via Modbus

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

Dry-run check (no writes):

```bash
python backend/scripts/openplc_modbus_bridge.py --dry-run --max-cycles 5
```

## 5) Factory I/O hookup (Modbus TCP)

In Factory I/O driver settings:

- Driver: **Modbus TCP/IP Client**
- Server: OpenPLC runtime host/port
- Unit ID: match `--unit-id` (default `1`)
- Map scene tags to your OpenPLC addresses (start from `tag_mapping.example.json`)

Suggested behavior:

- When AI flag (`coil 8`) is true, line stops/rejects according to your PLC logic.
- When security flag (`coil 9`) is true, emergency/security lockout path triggers.

## 6) Beremiz debugging workflow

- Attach/load PLC program in Beremiz.
- Watch these tags live:
  - process anomaly input (`I:0/8` equivalent)
  - security flag input (`I:0/9` equivalent)
  - lockout output (`O:0/8` equivalent)
- Step scan cycles while toggling scenarios from sidecars.
- Force inputs only in controlled tests; clear forced values before normal run.

## 7) Validate lockout logic automatically

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

This executes four cases (`baseline`, `process_only`, `security_only`, `combined`) and exits non-zero on failure.

## 8) Troubleshooting

- **Connection refused/timeouts**: verify OpenPLC runtime is reachable and Modbus port is open.
- **No tag updates**: check address base mismatch (`0` vs `1`).
- **Writes succeed but PLC does not react**: confirm PLC program maps addresses to expected inputs.
- **Factory I/O mismatches**: verify driver unit-id and exact register/coil offsets.
- **Beremiz shows stale values**: ensure no forced tags are latched from previous debug sessions.
