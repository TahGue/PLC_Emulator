# Recruiter Demo Script (5-7 min)

Use this flow to present your project as a machine learning + industrial automation engineering portfolio piece.

## 1) 30-second intro

"This is a PLC bottle-factory emulator with a hybrid ML anomaly backend. It combines rule-based monitoring, a PyTorch vision anomaly model, and a network security anomaly lane — all wired into real PLC I/O through Modbus TCP."

## 2) Start and baseline (60 sec)

1. Start backend: `docker compose up --build -d`
2. Serve frontend: `python3 -m http.server 8000`
3. Open: `http://localhost:8000/index.html`
4. Click **START**
5. Show:
   - PLC I/O panel (`I:0/8`, `I:0/9`, `O:0/8`)
   - Backend ONLINE status
   - Production metrics updating live

## 3) Show ML value (90 sec)

Use **Scenario Lab** and switch in this order:
1. **Normal Baseline**
2. **Process Drift**
3. **Network Attack**
4. **Combined Incident**

For each scenario, explain:
- Process score and network score
- Risk level
- Recommended action
- Explainability bars (which features contributed most)

## 4) Show engineering maturity (90 sec)

Call out:
- **Two model architectures**: lightweight One-Class SVM (CPU) and PyTorch convolutional autoencoder (GPU-accelerated) — both trainable from the same CLI
- **FastAPI + PostgreSQL** event persistence with JSONB fields
- **Six API endpoints**: `/analyze`, `/health`, `/events`, `/events/stream`, `/signals/vision`, `/signals/security`
- **SSE live dashboard**: open `backend/dashboard/live_events_dashboard.html` to show real-time event streaming
- **Network attack injector**: demonstrate malformed Modbus packet injection and show the security lane flagging it
- **OpenPLC Modbus bridge**: analyzer signals written to real PLC coils via Modbus TCP
- **E2E scenario validator**: automated test harness covering baseline, defect, attack, and combined scenarios with JSON reports
- Session KPIs: analyses run, anomaly hit-rate, inference latency
- Exporting a JSON demo report with one click

## 5) Show OT integration depth (45 sec)

If OpenPLC runtime is available:
- Show the Modbus bridge writing process/security flags to coils
- Show the runtime validator confirming lockout behavior
- Reference the tag mapping and runbook in `backend/openplc/`

Otherwise, describe the architecture:
- "The analyzer bridges to OpenPLC via Modbus TCP. Process anomaly and network alert flags are written to coils mapped to `I:0/8` and `I:0/9`. When both fire, the PLC ladder logic triggers security lockout on `O:0/8`."

## 6) Close strong (30 sec)

"This project demonstrates the full ML + OT lifecycle: model training with MVTec AD, online inference, explainability, network security monitoring, attack simulation, PLC integration via Modbus, and automated end-to-end validation. Everything runs locally with open-source tools."

## Suggested recruiter talking points

- You can bridge software engineering + ML + industrial operations.
- You understand explainability and actionability, not just model output.
- You can build end-to-end systems, not only notebooks.
- You integrate ML into real OT protocols (Modbus TCP) and PLC runtimes.
- You write automated validation harnesses, not just manual demos.
