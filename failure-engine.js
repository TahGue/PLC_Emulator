// Failure Injection Engine - Physical failure simulation for industrial components
class FailureEngine {
    constructor() {
        this.failures = this.defineFailures();
        this.activeFailures = new Map(); // failureId -> { startedAt, severity, ticksActive, accumulators }
        this.impactLog = [];
        this.maxImpactLog = 100;
        this.tickCount = 0;
        this.onImpact = null; // callback(impacts[])
    }

    defineFailures() {
        return new Map([
            ['sensor_drift', {
                id: 'sensor_drift',
                name: 'Sensor Drift',
                category: 'sensor',
                icon: '📉',
                severity: 'medium',
                description: 'Gradual offset that grows over time, simulating calibration loss or aging. Analog outputs drift from true value.',
                targets: ['sensors'],
                apply(comp, compDef, dt, severity, acc) {
                    if (compDef.category !== 'sensors') return null;
                    acc.drift = (acc.drift || 0) + severity * 0.002 * (dt / 1000);
                    const maxDrift = severity * 50;
                    acc.drift = Math.min(acc.drift, maxDrift);
                    for (const port of compDef.ports) {
                        if (port.type === 'output' && port.dataType === 'analog') {
                            const original = comp.outputValues[port.id] || 0;
                            comp.outputValues[port.id] = original + acc.drift;
                        }
                    }
                    return { effect: 'drift', drift: acc.drift.toFixed(2) };
                }
            }],
            ['sensor_noise', {
                id: 'sensor_noise',
                name: 'Sensor Noise',
                category: 'sensor',
                icon: '📶',
                severity: 'low',
                description: 'Random noise injected into sensor readings, simulating EMI interference or degraded wiring.',
                targets: ['sensors'],
                apply(comp, compDef, dt, severity, acc) {
                    if (compDef.category !== 'sensors') return null;
                    for (const port of compDef.ports) {
                        if (port.type === 'output') {
                            if (port.dataType === 'analog') {
                                const noise = (Math.random() - 0.5) * severity * 30;
                                comp.outputValues[port.id] = Math.max(0, (comp.outputValues[port.id] || 0) + noise);
                            } else if (port.dataType === 'digital' && Math.random() < severity * 0.05) {
                                comp.outputValues[port.id] = !comp.outputValues[port.id];
                            }
                        }
                    }
                    return { effect: 'noise', magnitude: (severity * 30).toFixed(0) };
                }
            }],
            ['sensor_blind', {
                id: 'sensor_blind',
                name: 'Sensor Blind / Stuck',
                category: 'sensor',
                icon: '🚫',
                severity: 'high',
                description: 'Sensor stuck at one value or intermittently blind, simulating dirty lens, blocked proximity, or broken element.',
                targets: ['sensors'],
                apply(comp, compDef, dt, severity, acc) {
                    if (compDef.category !== 'sensors') return null;
                    if (!acc.stuckValues) {
                        acc.stuckValues = {};
                        for (const port of compDef.ports) {
                            if (port.type === 'output') {
                                acc.stuckValues[port.id] = comp.outputValues[port.id];
                            }
                        }
                    }
                    // Intermittent: higher severity = more stuck
                    const isStuck = Math.random() < (0.3 + severity * 0.7);
                    if (isStuck) {
                        for (const port of compDef.ports) {
                            if (port.type === 'output') {
                                comp.outputValues[port.id] = acc.stuckValues[port.id];
                            }
                        }
                        return { effect: 'stuck', stuck: true };
                    }
                    return null;
                }
            }],
            ['valve_stuck_open', {
                id: 'valve_stuck_open',
                name: 'Valve Stuck Open',
                category: 'actuator',
                icon: '🔓',
                severity: 'high',
                description: 'Solenoid valve fails open — ignores close commands. Simulates mechanical jam or spring failure.',
                targets: ['solenoid_valve'],
                apply(comp, compDef, dt, severity, acc) {
                    if (comp.type !== 'solenoid_valve') return null;
                    comp.state.valvePos = 100;
                    comp.state.valvePhase = 'open';
                    comp.outputValues.state = true;
                    comp.outputValues.position = 100;
                    return { effect: 'stuck_open' };
                }
            }],
            ['valve_stuck_closed', {
                id: 'valve_stuck_closed',
                name: 'Valve Stuck Closed',
                category: 'actuator',
                icon: '🔒',
                severity: 'high',
                description: 'Solenoid valve fails closed — ignores open commands. Simulates seized mechanism or power loss.',
                targets: ['solenoid_valve'],
                apply(comp, compDef, dt, severity, acc) {
                    if (comp.type !== 'solenoid_valve') return null;
                    comp.state.valvePos = 0;
                    comp.state.valvePhase = 'closed';
                    comp.outputValues.state = false;
                    comp.outputValues.position = 0;
                    return { effect: 'stuck_closed' };
                }
            }],
            ['valve_leaking', {
                id: 'valve_leaking',
                name: 'Valve Leaking',
                category: 'actuator',
                icon: '💧',
                severity: 'medium',
                description: 'Valve does not fully close — partial pass-through when commanded shut. Simulates worn seat or debris.',
                targets: ['solenoid_valve'],
                apply(comp, compDef, dt, severity, acc) {
                    if (comp.type !== 'solenoid_valve') return null;
                    const leakPct = severity * 25; // up to 25% leak
                    if (comp.state.valvePos < leakPct) {
                        comp.state.valvePos = leakPct;
                        comp.outputValues.position = leakPct;
                        if (leakPct > 50) comp.outputValues.state = true;
                    }
                    return { effect: 'leaking', leak: leakPct.toFixed(0) + '%' };
                }
            }],
            ['conveyor_slip', {
                id: 'conveyor_slip',
                name: 'Conveyor Belt Slip',
                category: 'mechanical',
                icon: '⚡',
                severity: 'medium',
                description: 'Belt slippage reduces effective speed. Items take longer to traverse. Simulates worn belt or loose tensioner.',
                targets: ['conveyor'],
                apply(comp, compDef, dt, severity, acc) {
                    if (comp.type !== 'conveyor') return null;
                    const slipFactor = severity * 0.5; // up to 50% speed loss
                    if (comp.state.beltSpeed) {
                        comp.state.beltSpeed *= (1 - slipFactor);
                        comp.outputValues.speed_pct = (comp.outputValues.speed_pct || 0) * (1 - slipFactor);
                    }
                    return { effect: 'slip', reduction: Math.round(slipFactor * 100) + '%' };
                }
            }],
            ['motor_overheating', {
                id: 'motor_overheating',
                name: 'Motor Overheating',
                category: 'mechanical',
                icon: '🌡️',
                severity: 'high',
                description: 'Gradual current rise simulating bearing degradation or ventilation blockage, leading to overload trip.',
                targets: ['motor', 'pump'],
                apply(comp, compDef, dt, severity, acc) {
                    if (comp.type !== 'motor' && comp.type !== 'pump') return null;
                    if (!comp.state.running) return null;
                    // Inflate current draw toward overload threshold
                    const ratedCurrent = comp.props?.ratedCurrent || 5.0;
                    const ovThreshold = comp.props?.overloadThreshold || 1.5;
                    const extraCurrent = ratedCurrent * ovThreshold * severity * 0.6;
                    comp.state.currentDraw = (comp.state.currentDraw || 0) + extraCurrent;
                    comp.outputValues.current = comp.state.currentDraw;
                    return { effect: 'overheating', current: comp.state.currentDraw.toFixed(1) + 'A' };
                }
            }],
            ['motor_bearing_wear', {
                id: 'motor_bearing_wear',
                name: 'Motor Bearing Wear',
                category: 'mechanical',
                icon: '🔩',
                severity: 'medium',
                description: 'Increasing vibration and efficiency loss. Speed fluctuates and current draw creeps up over time.',
                targets: ['motor', 'pump'],
                apply(comp, compDef, dt, severity, acc) {
                    if (comp.type !== 'motor' && comp.type !== 'pump') return null;
                    if (!comp.state.running) return null;
                    acc.wearAccum = (acc.wearAccum || 0) + severity * 0.001 * (dt / 1000);
                    // Speed jitter
                    const jitter = (Math.random() - 0.5) * severity * 8;
                    comp.state.speedPct = Math.max(0, Math.min(100, (comp.state.speedPct || 0) + jitter));
                    comp.outputValues.speed_fb = comp.state.speedPct;
                    // Efficiency loss → slight current increase
                    const extraCurrent = (comp.state.currentDraw || 0) * acc.wearAccum * 0.1;
                    comp.state.currentDraw = (comp.state.currentDraw || 0) + extraCurrent;
                    comp.outputValues.current = comp.state.currentDraw;
                    return { effect: 'bearing_wear', vibration: (severity * 100).toFixed(0) + '%' };
                }
            }],
            ['pneumatic_leak', {
                id: 'pneumatic_leak',
                name: 'Pneumatic Air Leak',
                category: 'mechanical',
                icon: '💨',
                severity: 'medium',
                description: 'Air leak causes slower cylinder travel and position drift. Simulates worn seals or loose fittings.',
                targets: ['pneumatic_cyl'],
                apply(comp, compDef, dt, severity, acc) {
                    if (comp.type !== 'pneumatic_cyl') return null;
                    // Reduce effective position progress (simulate slow travel)
                    if (comp.state.cylPhase === 'extending' || comp.state.cylPhase === 'retracting') {
                        const drift = severity * 5 * (dt / 1000);
                        if (comp.state.cylPhase === 'extending') {
                            comp.state.cylPos = Math.max(0, (comp.state.cylPos || 0) - drift);
                        } else {
                            comp.state.cylPos = Math.min(100, (comp.state.cylPos || 0) + drift);
                        }
                        comp.outputValues.position = comp.state.cylPos;
                    }
                    // Random position drift even when held
                    if (Math.random() < severity * 0.1) {
                        const smallDrift = (Math.random() - 0.5) * severity * 3;
                        comp.state.cylPos = Math.max(0, Math.min(100, (comp.state.cylPos || 0) + smallDrift));
                        comp.outputValues.position = comp.state.cylPos;
                    }
                    return { effect: 'air_leak', pos: Math.round(comp.state.cylPos || 0) + '%' };
                }
            }],
            ['pipe_blockage', {
                id: 'pipe_blockage',
                name: 'Pipe Blockage',
                category: 'process',
                icon: '🚰',
                severity: 'high',
                description: 'Flow restriction in piping reduces pump output and tank fill rates. Simulates debris or scaling.',
                targets: ['pump', 'tank'],
                apply(comp, compDef, dt, severity, acc) {
                    if (comp.type === 'pump') {
                        const reduction = severity * 0.7;
                        if (comp.state.flowOutput !== undefined) {
                            comp.state.flowOutput *= (1 - reduction);
                            comp.outputValues.flow = comp.state.flowOutput;
                        }
                        // Back-pressure increases current
                        const extraCurrent = (comp.state.currentDraw || 0) * severity * 0.3;
                        comp.state.currentDraw = (comp.state.currentDraw || 0) + extraCurrent;
                        comp.outputValues.current = comp.state.currentDraw;
                        return { effect: 'blockage', flowReduction: Math.round(reduction * 100) + '%' };
                    }
                    if (comp.type === 'tank') {
                        // Slow fill rate
                        const level = comp.outputValues?.level;
                        if (level !== undefined && comp.inputValues?.inlet) {
                            const reduction = severity * 0.6;
                            const reducedLevel = level - reduction * (dt / 1000) * 2;
                            comp.outputValues.level = Math.max(0, reducedLevel);
                        }
                        return { effect: 'blockage', target: 'tank' };
                    }
                    return null;
                }
            }],
            ['wiring_fault', {
                id: 'wiring_fault',
                name: 'Wiring Fault',
                category: 'electrical',
                icon: '🔌',
                severity: 'high',
                description: 'Intermittent signal loss on random wires. Simulates loose terminals, rodent damage, or corroded connections.',
                targets: ['any'],
                apply(comp, compDef, dt, severity, acc) {
                    // Intermittently zero out inputs
                    const dropChance = severity * 0.15;
                    let dropped = false;
                    for (const port of compDef.ports) {
                        if (port.type === 'input' && Math.random() < dropChance) {
                            comp.inputValues[port.id] = port.dataType === 'digital' ? false : 0;
                            dropped = true;
                        }
                    }
                    if (dropped) return { effect: 'signal_loss' };
                    return null;
                }
            }]
        ]);
    }

    // ── Failure Control ──────────────────────────────────────────
    activateFailure(failureId, severity = 1.0) {
        const def = this.failures.get(failureId);
        if (!def) return false;
        this.activeFailures.set(failureId, {
            startedAt: Date.now(),
            severity: Math.max(0.1, Math.min(1.0, severity)),
            ticksActive: 0,
            accumulators: {} // per-component accumulators keyed by compId
        });
        return true;
    }

    deactivateFailure(failureId) {
        return this.activeFailures.delete(failureId);
    }

    isActive(failureId) {
        return this.activeFailures.has(failureId);
    }

    getActiveFailures() {
        const result = [];
        for (const [id, state] of this.activeFailures) {
            const def = this.failures.get(id);
            result.push({ ...def, state });
        }
        return result;
    }

    // ── Tick — called each simulation frame ──────────────────────
    tick(engine, dt) {
        this.tickCount++;
        if (this.activeFailures.size === 0) return [];

        const impacts = [];
        const allComps = engine.getAllComponents();

        for (const [failureId, state] of this.activeFailures) {
            const def = this.failures.get(failureId);
            if (!def || !def.apply) continue;

            for (const comp of allComps) {
                const compDef = engine.registry.get(comp.type);
                if (!compDef) continue;

                // Check target compatibility
                if (!this._matchesTarget(comp, compDef, def.targets)) continue;

                // Get or create per-component accumulator
                if (!state.accumulators[comp.id]) {
                    state.accumulators[comp.id] = {};
                }

                const result = def.apply(comp, compDef, dt, state.severity, state.accumulators[comp.id]);
                if (result) {
                    const impact = {
                        failureId,
                        failureName: def.name,
                        compId: comp.id,
                        compType: comp.type,
                        compLabel: comp.props?.label || comp.type,
                        ...result,
                        severity: state.severity,
                        timestamp: Date.now()
                    };
                    impacts.push(impact);
                    this.impactLog.push(impact);
                }
            }

            state.ticksActive++;
        }

        while (this.impactLog.length > this.maxImpactLog) this.impactLog.shift();

        if (this.onImpact && impacts.length > 0) {
            this.onImpact(impacts);
        }

        return impacts;
    }

    _matchesTarget(comp, compDef, targets) {
        if (!targets || targets.length === 0) return true;
        for (const target of targets) {
            if (target === 'any') return true;
            if (target === comp.type) return true;
            if (target === compDef.category) return true;
        }
        return false;
    }

    // ── Stats ────────────────────────────────────────────────────
    getStats() {
        const active = this.activeFailures.size;
        const byCategory = {};
        for (const [id, state] of this.activeFailures) {
            const def = this.failures.get(id);
            if (def) {
                byCategory[def.category] = (byCategory[def.category] || 0) + 1;
            }
        }
        return { active, byCategory, totalImpacts: this.impactLog.length };
    }

    reset() {
        this.activeFailures.clear();
        this.impactLog = [];
        this.tickCount = 0;
    }
}
