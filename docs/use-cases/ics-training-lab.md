# ICS Training Lab Playbook

This playbook provides a 60-90 minute instructor-led lab using the PLC Emulator to teach PLC scan logic, failure diagnosis, and cyber-physical incident response.

## Audience

- OT engineers and controls technicians
- ICS cybersecurity analysts
- Students learning PLC basics

## Learning Goals

1. Understand the PLC scan loop (inputs -> logic -> outputs).
2. Diagnose physical faults from process behavior and I/O signals.
3. Detect cyber attacks using packet and anomaly panels.
4. Restore operations under a timed training scenario.

## Lab Setup (10 minutes)

1. Start frontend:
   ```bash
   python3 -m http.server 8000
   ```
2. Open `http://localhost:8000/index.html`.
3. Load **Bottle Factory** preset.
4. Switch to **Simulate** mode and click **START**.
5. Confirm the following panels are visible:
   - I/O Status
   - Station Overview
   - Scan Cycle Debugger
   - Failure Injection
   - Attack Simulation Lab
   - Training Scenarios

## Exercise 1 — Baseline Behavior (10 minutes)

1. Observe normal operation for 2-3 minutes.
2. Record baseline values:
   - scan average (µs)
   - station efficiency
   - alarm state
3. In Scan Cycle Debugger, click a scan bar and review rung execution detail.

**Expected:** stable scan timings, low alarm activity, normal KPI movement.

## Exercise 2 — Physical Failure Diagnosis (15 minutes)

1. Enable **Sensor Drift** at ~60% intensity.
2. Observe I/O mismatch and station KPI degradation.
3. Ask trainees to identify:
   - which station is most affected
   - which symptom appears first (I/O, station KPI, or alarm)
4. Disable the failure and verify recovery.

**Expected:** drift causes subtle but persistent behavior changes; trainees link symptoms to root cause.

## Exercise 3 — Cyber Attack Detection (15 minutes)

1. Enable **DoS / Packet Flood**.
2. Watch packet monitor and risk gauge.
3. Open Scan Cycle Debugger and compare baseline vs attack timing.
4. Deactivate attack and confirm recovery.

**Expected:** packet/burst metrics rise, risk score increases, scan timings degrade, then normalize after mitigation.

## Exercise 4 — Guided Incident Response (20 minutes)

1. Open **Training Scenarios**.
2. Run **DoS Flood Attack** scenario.
3. Require trainees to complete objectives without hints first.
4. Run **Factory Under Siege** for advanced groups.

**Scoring suggestion:**
- 90-100: excellent diagnosis and mitigation
- 70-89: competent with minor misses
- <70: repeat with hints and debrief

## Debrief (10 minutes)

- Which signals were most reliable under stress?
- Did process symptoms appear before alarms?
- How would this map to your real OT environment?
- What lockout/interlock logic should be added in production?

## Instructor Notes

- Keep this in simulation mode only; no live PLC production systems.
- Encourage evidence-based diagnosis (I/O + scan + station + packet views).
- Save screenshots of key moments for post-lab discussion.
