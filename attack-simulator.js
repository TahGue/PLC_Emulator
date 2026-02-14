// Attack Simulator - Real-time ICS/SCADA attack simulation with packet analysis
class AttackSimulator {
    constructor() {
        this.attacks = this.defineAttacks();
        this.activeAttacks = new Map(); // attackId -> { startedAt, intensity, ... }
        this.packetLog = [];            // rolling window of simulated packets
        this.maxPacketLog = 200;
        this.analysisHistory = [];      // rolling analysis results
        this.maxAnalysisHistory = 120;
        this.tickCount = 0;
        this.baselinePacketRate = 130;  // packets/sec normal
        this.onAnalysis = null;         // callback(analysisResult)
        this.onPacket = null;           // callback(packet)
        this.onComponentImpact = null;  // callback(impacts[])
    }

    defineAttacks() {
        return new Map([
            ['dos_flood', {
                id: 'dos_flood',
                name: 'DoS / Packet Flood',
                category: 'network',
                icon: '🌊',
                severity: 'critical',
                description: 'Overwhelms the PLC network with massive packet volume, causing communication delays and potential watchdog timeouts.',
                effects: {
                    packetRateMultiplier: 4.5,
                    burstRatio: 0.92,
                    scanTimeMultiplier: 3.0,
                    componentEffects: [
                        { target: 'all', effect: 'comm_delay', magnitude: 0.7 },
                        { target: 'sensors', effect: 'reading_stale', magnitude: 0.5 }
                    ]
                }
            }],
            ['mitm', {
                id: 'mitm',
                name: 'Man-in-the-Middle',
                category: 'network',
                icon: '🕵️',
                severity: 'critical',
                description: 'Intercepts communication between HMI and PLC, can modify sensor readings and actuator commands in transit.',
                effects: {
                    packetRateMultiplier: 1.3,
                    burstRatio: 0.45,
                    sensorCorruption: 0.4,
                    actuatorOverride: 0.2,
                    componentEffects: [
                        { target: 'sensors', effect: 'value_manipulation', magnitude: 0.6 },
                        { target: 'actuators', effect: 'command_injection', magnitude: 0.3 }
                    ]
                }
            }],
            ['replay', {
                id: 'replay',
                name: 'Replay Attack',
                category: 'network',
                icon: '🔁',
                severity: 'high',
                description: 'Captures and replays valid Modbus/TCP commands, causing repeated or out-of-sequence operations.',
                effects: {
                    packetRateMultiplier: 1.8,
                    burstRatio: 0.65,
                    replayDelay: 2000,
                    componentEffects: [
                        { target: 'actuators', effect: 'repeated_commands', magnitude: 0.5 },
                        { target: 'process', effect: 'sequence_disruption', magnitude: 0.4 }
                    ]
                }
            }],
            ['modbus_injection', {
                id: 'modbus_injection',
                name: 'Modbus Command Injection',
                category: 'protocol',
                icon: '💉',
                severity: 'critical',
                description: 'Injects unauthorized Modbus write commands to directly control actuators, bypassing normal PLC logic.',
                effects: {
                    packetRateMultiplier: 1.15,
                    burstRatio: 0.38,
                    unauthorizedAttempts: 4,
                    actuatorOverride: 0.7,
                    componentEffects: [
                        { target: 'actuators', effect: 'forced_state', magnitude: 0.8 },
                        { target: 'indicators', effect: 'false_status', magnitude: 0.5 }
                    ]
                }
            }],
            ['false_data_injection', {
                id: 'false_data_injection',
                name: 'False Data Injection',
                category: 'process',
                icon: '📊',
                severity: 'high',
                description: 'Manipulates sensor readings sent to the PLC, making the system believe conditions are normal while they are not.',
                effects: {
                    packetRateMultiplier: 1.05,
                    burstRatio: 0.22,
                    sensorCorruption: 0.8,
                    componentEffects: [
                        { target: 'sensors', effect: 'value_spoofing', magnitude: 0.9 },
                        { target: 'logic', effect: 'wrong_decisions', magnitude: 0.6 }
                    ]
                }
            }],
            ['stuxnet_like', {
                id: 'stuxnet_like',
                name: 'Stuxnet-Style Attack',
                category: 'process',
                icon: '🐛',
                severity: 'critical',
                description: 'Gradually modifies PLC setpoints while reporting normal values to HMI. Damage accumulates over time.',
                effects: {
                    packetRateMultiplier: 1.02,
                    burstRatio: 0.2,
                    setpointDrift: true,
                    driftRate: 0.005,
                    componentEffects: [
                        { target: 'process', effect: 'setpoint_drift', magnitude: 0.3 },
                        { target: 'sensors', effect: 'masked_readings', magnitude: 0.7 }
                    ]
                }
            }],
            ['plc_dos', {
                id: 'plc_dos',
                name: 'PLC CPU Overload',
                category: 'protocol',
                icon: '⚡',
                severity: 'high',
                description: 'Sends rapid diagnostic/config requests to overwhelm PLC CPU, increasing scan time and causing watchdog faults.',
                effects: {
                    packetRateMultiplier: 2.2,
                    burstRatio: 0.78,
                    scanTimeMultiplier: 5.0,
                    componentEffects: [
                        { target: 'all', effect: 'slow_response', magnitude: 0.6 },
                        { target: 'logic', effect: 'scan_overrun', magnitude: 0.8 }
                    ]
                }
            }],
            ['arp_spoof', {
                id: 'arp_spoof',
                name: 'ARP Spoofing',
                category: 'network',
                icon: '🔀',
                severity: 'medium',
                description: 'Redirects network traffic by poisoning ARP tables, enabling traffic interception or communication blackout.',
                effects: {
                    packetRateMultiplier: 0.3,
                    burstRatio: 0.1,
                    commLoss: 0.6,
                    componentEffects: [
                        { target: 'all', effect: 'comm_loss', magnitude: 0.6 },
                        { target: 'sensors', effect: 'reading_timeout', magnitude: 0.7 }
                    ]
                }
            }],
            ['firmware_tamper', {
                id: 'firmware_tamper',
                name: 'Firmware Manipulation',
                category: 'process',
                icon: '🔧',
                severity: 'critical',
                description: 'Alters PLC firmware behavior, changing logic execution subtly. Very hard to detect without integrity checks.',
                effects: {
                    packetRateMultiplier: 1.0,
                    burstRatio: 0.2,
                    logicCorruption: 0.5,
                    componentEffects: [
                        { target: 'logic', effect: 'corrupted_logic', magnitude: 0.7 },
                        { target: 'actuators', effect: 'erratic_behavior', magnitude: 0.4 }
                    ]
                }
            }],
            ['sensor_jamming', {
                id: 'sensor_jamming',
                name: 'Sensor Jamming / Spoofing',
                category: 'physical',
                icon: '📡',
                severity: 'medium',
                description: 'Physically jams or spoofs sensor signals (e.g., EMI interference), causing incorrect readings at the field level.',
                effects: {
                    packetRateMultiplier: 1.0,
                    burstRatio: 0.2,
                    sensorCorruption: 0.6,
                    sensorNoise: 0.8,
                    componentEffects: [
                        { target: 'sensors', effect: 'noisy_signal', magnitude: 0.8 },
                        { target: 'process', effect: 'erratic_process', magnitude: 0.4 }
                    ]
                }
            }]
        ]);
    }

    // ── Attack Control ──────────────────────────────────────────
    activateAttack(attackId, intensity = 1.0) {
        const def = this.attacks.get(attackId);
        if (!def) return false;
        this.activeAttacks.set(attackId, {
            startedAt: Date.now(),
            intensity: Math.max(0.1, Math.min(1.0, intensity)),
            ticksActive: 0,
            driftAccumulator: 0
        });
        return true;
    }

    deactivateAttack(attackId) {
        return this.activeAttacks.delete(attackId);
    }

    isActive(attackId) {
        return this.activeAttacks.has(attackId);
    }

    getActiveAttacks() {
        const result = [];
        for (const [id, state] of this.activeAttacks) {
            const def = this.attacks.get(id);
            result.push({ ...def, state });
        }
        return result;
    }

    // ── Real-Time Analysis Tick ─────────────────────────────────
    tick(engine, plc, dt) {
        this.tickCount++;
        const now = Date.now();

        // Generate packets for this tick
        const packets = this.generatePackets(dt);
        for (const pkt of packets) {
            this.packetLog.push(pkt);
            if (this.onPacket) this.onPacket(pkt);
        }
        while (this.packetLog.length > this.maxPacketLog) this.packetLog.shift();

        // Apply attack effects to engine components
        const impacts = this.applyEffects(engine, plc, dt);

        // Run real-time analysis
        const analysis = this.analyze(engine, plc, dt);
        this.analysisHistory.push(analysis);
        while (this.analysisHistory.length > this.maxAnalysisHistory) this.analysisHistory.shift();

        if (this.onAnalysis) this.onAnalysis(analysis);
        if (this.onComponentImpact && impacts.length > 0) this.onComponentImpact(impacts);

        // Advance attack tick counters
        for (const [id, state] of this.activeAttacks) {
            state.ticksActive++;
        }

        return analysis;
    }

    // ── Packet Generation ───────────────────────────────────────
    generatePackets(dt) {
        const packets = [];
        const now = Date.now();
        const dtSec = dt / 1000;

        // Baseline legitimate traffic
        let effectiveRate = this.baselinePacketRate;
        let burstRatio = 0.15 + Math.random() * 0.05;
        let unauthorizedCount = 0;
        let maliciousTypes = [];

        // Apply attack effects on packet generation
        for (const [id, state] of this.activeAttacks) {
            const def = this.attacks.get(id);
            const eff = def.effects;
            const intensity = state.intensity;

            effectiveRate *= (1 + (eff.packetRateMultiplier - 1) * intensity);
            burstRatio = Math.max(burstRatio, eff.burstRatio * intensity);
            if (eff.unauthorizedAttempts) {
                unauthorizedCount += Math.round(eff.unauthorizedAttempts * intensity);
            }
            maliciousTypes.push(def.category);
        }

        const packetsThisTick = Math.round(effectiveRate * dtSec);
        const burstCount = Math.round(packetsThisTick * burstRatio);

        // Generate individual packet entries (summarized)
        for (let i = 0; i < Math.min(packetsThisTick, 10); i++) {
            const isBurst = i < burstCount / (packetsThisTick / Math.min(packetsThisTick, 10));
            const isMalicious = this.activeAttacks.size > 0 && Math.random() < 0.3;
            const isUnauthorized = i < unauthorizedCount;

            packets.push({
                timestamp: now + i,
                srcIP: isMalicious ? this.randomAttackerIP() : '192.168.1.10',
                dstIP: '192.168.1.1',
                srcPort: isMalicious ? (10000 + Math.floor(Math.random() * 50000)) : 502,
                dstPort: 502,
                protocol: 'Modbus/TCP',
                length: isBurst ? (256 + Math.floor(Math.random() * 512)) : (64 + Math.floor(Math.random() * 128)),
                flags: isBurst ? 'PSH,ACK' : (isUnauthorized ? 'SYN' : 'ACK'),
                type: isUnauthorized ? 'unauthorized' : (isMalicious ? 'malicious' : (isBurst ? 'burst' : 'normal')),
                attackSource: isMalicious ? Array.from(this.activeAttacks.keys())[0] : null
            });
        }

        // Store aggregate stats
        this._lastTickStats = {
            packetRate: effectiveRate,
            burstRatio,
            unauthorizedCount,
            totalPackets: packetsThisTick,
            maliciousRatio: this.activeAttacks.size > 0 ? 0.3 : 0
        };

        return packets;
    }

    randomAttackerIP() {
        const attackerNets = ['10.99.', '172.16.99.', '192.168.99.'];
        return attackerNets[Math.floor(Math.random() * attackerNets.length)] + Math.floor(Math.random() * 254 + 1);
    }

    // ── Apply Effects to Components ─────────────────────────────
    applyEffects(engine, plc, dt) {
        const impacts = [];
        if (this.activeAttacks.size === 0) return impacts;

        const allComps = engine.getAllComponents();

        for (const [attackId, state] of this.activeAttacks) {
            const def = this.attacks.get(attackId);
            const eff = def.effects;
            const intensity = state.intensity;

            // Scan time manipulation
            if (eff.scanTimeMultiplier) {
                const newCycleTime = 100 * eff.scanTimeMultiplier * intensity;
                plc.cycleTime = Math.max(plc.cycleTime, newCycleTime);
            }

            // Sensor corruption
            if (eff.sensorCorruption) {
                for (const comp of allComps) {
                    const compDef = engine.registry.get(comp.type);
                    if (!compDef || compDef.category !== 'sensors') continue;

                    if (Math.random() < eff.sensorCorruption * intensity * 0.3) {
                        // Corrupt output values
                        for (const port of compDef.ports) {
                            if (port.type === 'output') {
                                if (port.dataType === 'digital') {
                                    comp.outputValues[port.id] = Math.random() > 0.5;
                                } else {
                                    const original = comp.outputValues[port.id] || 0;
                                    const noise = eff.sensorNoise ? (Math.random() - 0.5) * eff.sensorNoise * 100 : 0;
                                    comp.outputValues[port.id] = Math.max(0, original + noise * intensity);
                                }
                                impacts.push({
                                    attackId,
                                    compId: comp.id,
                                    compType: comp.type,
                                    effect: 'sensor_corrupted',
                                    port: port.id,
                                    severity: intensity
                                });
                            }
                        }
                    }
                }
            }

            // Actuator override
            if (eff.actuatorOverride) {
                for (const comp of allComps) {
                    const compDef = engine.registry.get(comp.type);
                    if (!compDef || compDef.category !== 'actuators') continue;

                    if (Math.random() < eff.actuatorOverride * intensity * 0.2) {
                        for (const port of compDef.ports) {
                            if (port.type === 'input') {
                                comp.inputValues[port.id] = Math.random() > 0.5;
                                impacts.push({
                                    attackId,
                                    compId: comp.id,
                                    compType: comp.type,
                                    effect: 'actuator_overridden',
                                    port: port.id,
                                    severity: intensity
                                });
                            }
                        }
                    }
                }
            }

            // Stuxnet-like setpoint drift
            if (eff.setpointDrift) {
                state.driftAccumulator += eff.driftRate * intensity * (dt / 1000);
                for (const comp of allComps) {
                    const compDef = engine.registry.get(comp.type);
                    if (!compDef || compDef.category !== 'process') continue;
                    for (const port of compDef.ports) {
                        if (port.type === 'output' && port.dataType === 'analog') {
                            const original = comp.outputValues[port.id] || 0;
                            comp.outputValues[port.id] = original * (1 + state.driftAccumulator);
                            impacts.push({
                                attackId,
                                compId: comp.id,
                                compType: comp.type,
                                effect: 'setpoint_drift',
                                drift: state.driftAccumulator,
                                severity: Math.min(1, state.driftAccumulator * 10)
                            });
                        }
                    }
                }
            }

            // Communication loss (ARP spoof)
            if (eff.commLoss) {
                for (const comp of allComps) {
                    if (Math.random() < eff.commLoss * intensity * 0.15) {
                        // Zero out all I/O to simulate comm loss
                        for (const key of Object.keys(comp.inputValues)) {
                            comp.inputValues[key] = false;
                        }
                        impacts.push({
                            attackId,
                            compId: comp.id,
                            compType: comp.type,
                            effect: 'comm_loss',
                            severity: intensity
                        });
                    }
                }
            }

            // Logic corruption
            if (eff.logicCorruption) {
                for (const comp of allComps) {
                    const compDef = engine.registry.get(comp.type);
                    if (!compDef || compDef.category !== 'logic') continue;
                    if (Math.random() < eff.logicCorruption * intensity * 0.1) {
                        for (const port of compDef.ports) {
                            if (port.type === 'output') {
                                comp.outputValues[port.id] = !comp.outputValues[port.id];
                                impacts.push({
                                    attackId,
                                    compId: comp.id,
                                    compType: comp.type,
                                    effect: 'logic_corrupted',
                                    severity: intensity
                                });
                            }
                        }
                    }
                }
            }
        }

        return impacts;
    }

    // ── Real-Time Analysis ──────────────────────────────────────
    analyze(engine, plc, dt) {
        const stats = this._lastTickStats || {
            packetRate: this.baselinePacketRate,
            burstRatio: 0.15,
            unauthorizedCount: 0,
            totalPackets: 0,
            maliciousRatio: 0
        };

        const activeList = this.getActiveAttacks();
        const attackCount = activeList.length;

        // Network score
        const packetDelta = Math.abs(stats.packetRate - this.baselinePacketRate);
        const packetComponent = Math.min(35, packetDelta * 1.1);
        const burstComponent = stats.burstRatio > 0.5 ? (stats.burstRatio - 0.5) * 100 : 0;
        const unauthComponent = stats.unauthorizedCount > 0 ? 35 + stats.unauthorizedCount * 10 : 0;
        let networkScore = Math.min(100, packetComponent + burstComponent + unauthComponent);

        // Process score - check for anomalies in component states
        let processScore = 0;
        const processReasons = [];
        const allComps = engine.getAllComponents();

        // Check scan time
        if (plc.cycleTime > 200) {
            processScore += Math.min(30, (plc.cycleTime - 100) * 0.15);
            processReasons.push('PLC scan time elevated: ' + Math.round(plc.cycleTime) + 'ms');
        }

        // Check for sensor anomalies
        let corruptedSensors = 0;
        let overriddenActuators = 0;
        for (const comp of allComps) {
            const compDef = engine.registry.get(comp.type);
            if (!compDef) continue;
            if (compDef.category === 'sensors' && comp.state.forced) corruptedSensors++;
            if (compDef.category === 'actuators' && comp.state.running) overriddenActuators++;
        }

        // Attack-specific score contributions
        for (const attack of activeList) {
            const intensity = attack.state.intensity;
            switch (attack.category) {
                case 'process':
                    processScore += 25 * intensity;
                    processReasons.push(attack.name + ' active');
                    break;
                case 'protocol':
                    networkScore = Math.min(100, networkScore + 20 * intensity);
                    processScore += 15 * intensity;
                    processReasons.push(attack.name + ' protocol manipulation');
                    break;
                case 'physical':
                    processScore += 20 * intensity;
                    processReasons.push(attack.name + ' detected');
                    break;
            }
        }

        processScore = Math.min(100, processScore);

        // Security flag
        const securityFlag = networkScore > 55 || stats.unauthorizedCount > 0;

        // Risk level
        const maxScore = Math.max(processScore, networkScore);
        let riskLevel, riskColor;
        if (maxScore >= 80) { riskLevel = 'critical'; riskColor = '#ef4444'; }
        else if (maxScore >= 60) { riskLevel = 'high'; riskColor = '#f97316'; }
        else if (maxScore >= 35) { riskLevel = 'medium'; riskColor = '#eab308'; }
        else { riskLevel = 'low'; riskColor = '#22c55e'; }

        // Network breakdown
        const networkComponents = {};
        if (packetComponent > 0.5) networkComponents['Packet rate deviation'] = Math.round(packetComponent * 10) / 10;
        if (burstComponent > 0.5) networkComponents['Burst traffic anomaly'] = Math.round(burstComponent * 10) / 10;
        if (unauthComponent > 0) networkComponents['Unauthorized attempts'] = Math.round(unauthComponent * 10) / 10;

        // Process breakdown
        const processComponents = {};
        if (plc.cycleTime > 200) processComponents['Scan time anomaly'] = Math.round((plc.cycleTime - 100) * 0.15 * 10) / 10;
        for (const attack of activeList) {
            processComponents[attack.name] = Math.round(attack.state.intensity * 25 * 10) / 10;
        }

        const confidence = Math.max(5, Math.round(100 - maxScore * 0.7));

        return {
            timestamp: Date.now(),
            processScore: Math.round(processScore * 10) / 10,
            networkScore: Math.round(networkScore * 10) / 10,
            processAnomaly: processScore >= 60,
            networkAlert: networkScore >= 55 || securityFlag,
            modelConfidence: confidence,
            riskLevel,
            riskColor,
            securityFlag,
            activeAttacks: attackCount,
            packetRate: Math.round(stats.packetRate),
            burstRatio: Math.round(stats.burstRatio * 100) / 100,
            unauthorizedAttempts: stats.unauthorizedCount,
            processComponents,
            networkComponents,
            reasons: attackCount === 0
                ? ['System within baseline profile']
                : processReasons.concat(securityFlag ? ['Security monitor flagged suspicious activity'] : []),
            recommendedAction: this.getRecommendation(riskLevel, activeList)
        };
    }

    getRecommendation(riskLevel, activeAttacks) {
        if (activeAttacks.length === 0) return 'Continue baseline monitoring.';
        const categories = [...new Set(activeAttacks.map(a => a.category))];
        if (riskLevel === 'critical') {
            return 'IMMEDIATE: Trigger safety lockout, isolate control network, activate incident response.';
        } else if (riskLevel === 'high') {
            if (categories.includes('network')) return 'Segment PLC network, block suspicious IPs, increase monitoring.';
            if (categories.includes('process')) return 'Verify all sensor readings, check PLC program integrity.';
            return 'Escalate to security team, increase monitoring frequency.';
        } else if (riskLevel === 'medium') {
            return 'Increase monitoring, verify sensor calibration, review network logs.';
        }
        return 'Continue baseline monitoring with elevated awareness.';
    }

    // ── Packet Statistics ───────────────────────────────────────
    getPacketStats(windowMs = 5000) {
        const now = Date.now();
        const cutoff = now - windowMs;
        const recent = this.packetLog.filter(p => p.timestamp >= cutoff);

        const total = recent.length;
        const malicious = recent.filter(p => p.type === 'malicious' || p.type === 'unauthorized').length;
        const burst = recent.filter(p => p.type === 'burst').length;
        const normal = recent.filter(p => p.type === 'normal').length;

        const bySource = {};
        for (const p of recent) {
            bySource[p.srcIP] = (bySource[p.srcIP] || 0) + 1;
        }

        return { total, malicious, burst, normal, bySource, windowMs };
    }

    getLatestAnalysis() {
        return this.analysisHistory.length > 0
            ? this.analysisHistory[this.analysisHistory.length - 1]
            : null;
    }

    getAnalysisHistory() {
        return this.analysisHistory;
    }

    reset() {
        this.activeAttacks.clear();
        this.packetLog = [];
        this.analysisHistory = [];
        this.tickCount = 0;
    }
}
