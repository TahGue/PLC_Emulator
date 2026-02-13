# Recruiter Demo Script (3-5 min)

Use this flow to present your project as a machine learning engineering portfolio piece.

## 1) 30-second intro

"This is a PLC bottle-factory emulator with a hybrid ML anomaly detection backend. It combines rule-based monitoring, online z-score drift detection, and a network security anomaly lane."

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

## 4) Show engineering maturity (45 sec)

Call out:
- FastAPI + PostgreSQL event persistence
- `/analyze`, `/health`, `/events` APIs
- Session KPIs: analyses run, anomaly hit-rate, inference latency
- Exporting a JSON demo report with one click

## 5) Close strong (30 sec)

"This project demonstrates the full ML lifecycle in a practical industrial setting: telemetry ingestion, online scoring, explainability, alerting, and operational decision support. My next step is replacing synthetic telemetry with real packet capture and adding model evaluation tests."

## Suggested recruiter talking points

- You can bridge software engineering + ML + operations.
- You understand explainability and actionability, not just model output.
- You can build end-to-end systems, not only notebooks.
