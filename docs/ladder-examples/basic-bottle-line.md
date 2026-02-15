# Ladder Example: Basic Bottle Line (Canonical)

This is a reference ladder example for the Bottle Factory workflow, designed for training and regression validation.

## Purpose

- Show a minimal but realistic rung set.
- Provide expected I/O behavior for quick verification.
- Give instructors and contributors a shared baseline.

## Address Map (example)

### Inputs
- `I:0/0` STOP (normally closed logic in ladder)
- `I:0/1` START
- `I:0/3` Bottle at filler
- `I:0/4` Bottle at capper
- `I:0/5` Bottle at quality
- `I:0/8` Process anomaly flag
- `I:0/9` Security flag

### Outputs
- `O:0/0` Conveyor motor
- `O:0/1` Fill valve
- `O:0/2` Capper motor
- `O:0/3` Quality light
- `O:0/7` Run light
- `O:0/8` Security lockout

## Example Rungs

### Rung 0 — Security Lockout
`XIC I:0/8 -> OTE O:0/8`

Intent: if process anomaly is true, energize lockout output.

### Rung 1 — System Ready / Run Light
`XIC I:0/1, XIO I:0/0 -> OTE O:0/7`

Intent: START pressed while STOP path is healthy -> run light ON.

### Rung 2 — Conveyor Drive
`XIC O:0/7, XIO O:0/1, XIO O:0/2 -> OTE O:0/0`

Intent: conveyor runs when system is ready and not currently filling/capping.

### Rung 3 — Fill Station
`XIC O:0/7, XIC I:0/3 -> OTE O:0/1`

Intent: when system is ready and bottle reaches filler sensor, open fill valve.

### Rung 4 — Cap Station
`XIC O:0/7, XIC I:0/4 -> OTE O:0/2`

Intent: when system is ready and bottle reaches capper sensor, run capper motor.

### Rung 5 — Quality Indicator
`XIC I:0/5 -> OTE O:0/3`

Intent: light quality indicator when bottle reaches quality sensor.

## Expected I/O Trace (happy path)

1. START pressed (`I:0/1=1`, `I:0/0=0`) -> `O:0/7=1`
2. Conveyor allowed -> `O:0/0=1`
3. Bottle at filler (`I:0/3=1`) -> `O:0/1=1` and conveyor pauses by rung condition
4. Bottle at capper (`I:0/4=1`) -> `O:0/2=1`
5. Bottle at quality (`I:0/5=1`) -> `O:0/3=1`

## Fault/Attack Validation Checks

- If `I:0/8` or `I:0/9` is driven true by analyzer/bridge logic, verify lockout path behavior via `O:0/8`.
- Under DoS attack, verify scan-time increase in Scan Cycle Debugger.
- Under Sensor Drift, verify downstream station KPI degradation.

## How to Use in Regression

1. Load `bottle_factory` preset.
2. Run simulation for 30-60 seconds baseline.
3. Confirm rung energization order roughly matches the sequence above.
4. Save screenshots/log snippets when behavior diverges.

## Related Docs

- `README.md` (quick start + architecture)
- `DEMO_GUIDE.md` (step-by-step walkthrough)
- `docs/use-cases/ics-training-lab.md`
- `docs/use-cases/pentest-playbook.md`
