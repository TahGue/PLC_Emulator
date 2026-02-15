// Training Scenario Engine — guided challenges with scoring and hints
class TrainingEngine {
    constructor() {
        this.scenarios = this.defineScenarios();
        this.activeScenario = null;   // current running scenario
        this.state = 'idle';          // idle | running | completed | failed
        this.startTime = 0;
        this.elapsedMs = 0;
        this.timerHandle = null;
        this.score = 0;
        this.maxScore = 100;
        this.hintsUsed = 0;
        this.objectiveResults = [];   // [{id, text, completed, timestamp}]
        this.hintPenalty = 5;         // points deducted per hint
        this.onStateChange = null;    // callback(state)
        this.onObjectiveUpdate = null;// callback(objectives[])
        this.onComplete = null;       // callback({score, time, objectives})
    }

    defineScenarios() {
        return new Map([
            // ── Category 1: Diagnose Broken Ladder Logic ─────────
            ['broken_rung', {
                id: 'broken_rung',
                title: 'Broken Conveyor Logic',
                category: 'ladder',
                difficulty: 1,
                icon: '🔧',
                description: 'The conveyor motor won\'t start even though START is pressed and STOP is not active. Find and fix the broken rung in the ladder logic.',
                objectives: [
                    { id: 'find_fault', text: 'Identify the broken rung', points: 30 },
                    { id: 'fix_logic', text: 'Fix the ladder logic so the conveyor runs', points: 50 },
                    { id: 'verify', text: 'Verify the system runs correctly for 5 seconds', points: 20 },
                ],
                hints: [
                    'Check which rungs are energized (green) in the Scan Debugger',
                    'Look at Rung 0 — is the System Ready output being set?',
                    'The XIC/XIO instruction operands may be swapped. The STOP button should use XIO (normally closed)',
                ],
                timeLimit: 180000, // 3 minutes
                setup: (app) => {
                    app.loadPreset('bottle_factory');
                    // Break the logic: swap XIC and XIO on rung 0 so system ready never sets
                    const program = app.plc.ladderProgram;
                    if (program && program.rungs.length > 0) {
                        const rung0 = program.rungs[0];
                        // Swap: make STOP use XIC instead of XIO (system can never be ready)
                        for (const instr of rung0.instructions) {
                            if (instr.type === 'XIO' && instr.operands[0] === 'I:0/0') {
                                instr.type = 'XIC'; // broken: now requires STOP to be pressed
                                break;
                            }
                        }
                    }
                    app.ladderRenderer.render(app.plc.ladderProgram.rungs, app.plc);
                },
                check: (app) => {
                    const results = [];
                    const program = app.plc.ladderProgram;
                    // Check if rung 0 has XIO on I:0/0 (fixed)
                    let rung0Fixed = false;
                    if (program && program.rungs.length > 0) {
                        const rung0 = program.rungs[0];
                        rung0Fixed = rung0.instructions.some(i => i.type === 'XIO' && i.operands[0] === 'I:0/0');
                    }
                    results.push({ id: 'find_fault', completed: rung0Fixed });
                    results.push({ id: 'fix_logic', completed: rung0Fixed && app.plc.getOutput('O:0/7') });

                    // Verify system runs for 5s: check conveyor motor output
                    const motorRunning = app.plc.getOutput('O:0/0');
                    const systemReady = app.plc.getOutput('O:0/7');
                    results.push({ id: 'verify', completed: rung0Fixed && systemReady && motorRunning });

                    return results;
                },
                teardown: (app) => {
                    // Reload clean preset
                    app.loadPreset('bottle_factory');
                },
            }],

            ['missing_interlock', {
                id: 'missing_interlock',
                title: 'Missing Safety Interlock',
                category: 'ladder',
                difficulty: 2,
                icon: '🛡️',
                description: 'The fill valve operates even when the conveyor is stopped, causing overflow. Add a safety interlock so the fill valve only opens when the conveyor motor is running.',
                objectives: [
                    { id: 'identify', text: 'Identify that the fill valve lacks a conveyor interlock', points: 20 },
                    { id: 'add_interlock', text: 'Add XIC O:0/0 (conveyor running) to the fill rung', points: 50 },
                    { id: 'test_safe', text: 'Verify fill valve stays closed when conveyor is off', points: 30 },
                ],
                hints: [
                    'Look at which rung controls the fill valve (O:0/1)',
                    'The fill rung should require the conveyor motor output (O:0/0) to be ON',
                    'Add an XIC instruction checking O:0/0 before the fill valve OTE',
                ],
                timeLimit: 180000,
                setup: (app) => {
                    app.loadPreset('bottle_factory');
                    // Remove the conveyor interlock from the fill rung
                    const program = app.plc.ladderProgram;
                    if (program) {
                        for (const rung of program.rungs) {
                            const hasOTE_Fill = rung.instructions.some(i => i.type === 'OTE' && i.operands[0] === 'O:0/1');
                            if (hasOTE_Fill) {
                                // Remove any XIC checking O:0/0 or O:0/7
                                rung.instructions = rung.instructions.filter(i =>
                                    !(i.type === 'XIC' && (i.operands[0] === 'O:0/0' || i.operands[0] === 'O:0/7'))
                                );
                                break;
                            }
                        }
                    }
                    app.ladderRenderer.render(app.plc.ladderProgram.rungs, app.plc);
                },
                check: (app) => {
                    const results = [];
                    const program = app.plc.ladderProgram;
                    let fillHasInterlock = false;
                    if (program) {
                        for (const rung of program.rungs) {
                            const hasOTE_Fill = rung.instructions.some(i => i.type === 'OTE' && i.operands[0] === 'O:0/1');
                            if (hasOTE_Fill) {
                                fillHasInterlock = rung.instructions.some(i =>
                                    i.type === 'XIC' && (i.operands[0] === 'O:0/0' || i.operands[0] === 'O:0/7')
                                );
                                break;
                            }
                        }
                    }
                    results.push({ id: 'identify', completed: fillHasInterlock });
                    results.push({ id: 'add_interlock', completed: fillHasInterlock });
                    // Test: if conveyor off, fill should be off
                    const convOff = !app.plc.getOutput('O:0/0');
                    const fillOff = !app.plc.getOutput('O:0/1');
                    results.push({ id: 'test_safe', completed: fillHasInterlock && (convOff ? fillOff : true) });
                    return results;
                },
                teardown: (app) => { app.loadPreset('bottle_factory'); },
            }],

            // ── Category 2: Sensor Failure Mystery ───────────────
            ['sensor_mystery_drift', {
                id: 'sensor_mystery_drift',
                title: 'The Drifting Sensor',
                category: 'failure',
                difficulty: 2,
                icon: '🔍',
                description: 'Production quality has dropped. A sensor somewhere in the line is drifting. Use the monitoring tools to identify which sensor is affected and what type of failure it is.',
                objectives: [
                    { id: 'notice', text: 'Observe abnormal behavior in the production line', points: 10 },
                    { id: 'identify_type', text: 'Identify the failure type as "sensor_drift"', points: 40 },
                    { id: 'fix', text: 'Deactivate the sensor drift failure', points: 50 },
                ],
                hints: [
                    'Check the Failure Injection panel — is anything suspiciously active?',
                    'Look at sensor output values in the I/O Status section for unusual readings',
                    'The failure type is "sensor_drift" — find it in the Failure panel and toggle it off',
                ],
                timeLimit: 120000,
                setup: (app) => {
                    app.loadPreset('bottle_factory');
                    // Inject hidden sensor drift
                    app.failureEngine.activateFailure('sensor_drift', 0.6);
                    // Hide the UI indicator (student must discover it)
                    const items = document.querySelectorAll('.failure-item[data-failure-id="sensor_drift"]');
                    items.forEach(el => {
                        el.querySelector('.failure-toggle')?.classList.remove('on');
                        el.classList.remove('active');
                    });
                },
                check: (app) => {
                    const results = [];
                    const driftActive = app.failureEngine.isActive('sensor_drift');
                    results.push({ id: 'notice', completed: true }); // auto-pass after scenario starts
                    results.push({ id: 'identify_type', completed: !driftActive });
                    results.push({ id: 'fix', completed: !driftActive });
                    return results;
                },
                teardown: (app) => {
                    app.failureEngine.reset();
                    app.loadPreset('bottle_factory');
                },
            }],

            ['sensor_mystery_stuck', {
                id: 'sensor_mystery_stuck',
                title: 'The Blind Sensor',
                category: 'failure',
                difficulty: 3,
                icon: '🕵️',
                description: 'A critical sensor has gone blind — it\'s stuck at a fixed value and no longer responding to real conditions. Production is stalling. Find it and fix it.',
                objectives: [
                    { id: 'detect_stall', text: 'Notice the production line is stalling', points: 10 },
                    { id: 'identify', text: 'Identify the failure as "sensor_blind"', points: 40 },
                    { id: 'resolve', text: 'Deactivate the sensor blind failure', points: 50 },
                ],
                hints: [
                    'A sensor that never changes could be stuck — check the I/O panel',
                    'Look in the Failure panel for sensor-category failures',
                    'Toggle off "Sensor Blind/Stuck" in the failure injection panel',
                ],
                timeLimit: 120000,
                setup: (app) => {
                    app.loadPreset('bottle_factory');
                    app.failureEngine.activateFailure('sensor_blind', 0.8);
                    const items = document.querySelectorAll('.failure-item[data-failure-id="sensor_blind"]');
                    items.forEach(el => {
                        el.querySelector('.failure-toggle')?.classList.remove('on');
                        el.classList.remove('active');
                    });
                },
                check: (app) => {
                    const active = app.failureEngine.isActive('sensor_blind');
                    return [
                        { id: 'detect_stall', completed: true },
                        { id: 'identify', completed: !active },
                        { id: 'resolve', completed: !active },
                    ];
                },
                teardown: (app) => {
                    app.failureEngine.reset();
                    app.loadPreset('bottle_factory');
                },
            }],

            // ── Category 3: Cyber Attack Detection ───────────────
            ['detect_mitm', {
                id: 'detect_mitm',
                title: 'Man-in-the-Middle Attack',
                category: 'cyber',
                difficulty: 3,
                icon: '🕶️',
                description: 'Network monitoring shows unusual patterns. A man-in-the-middle attack may be altering sensor data in transit. Use the Attack Simulation Lab and packet analysis to identify and stop it.',
                objectives: [
                    { id: 'spot_anomaly', text: 'Notice anomalous packet patterns', points: 15 },
                    { id: 'identify_attack', text: 'Identify the attack type as MITM', points: 35 },
                    { id: 'stop_attack', text: 'Deactivate the MITM attack', points: 50 },
                ],
                hints: [
                    'Check the Attack Simulation Lab panel — look at the packet analysis',
                    'A MITM attack modifies packets in transit — look for "mitm_intercept" in the attack list',
                    'Toggle off the "MITM / Data Intercept" attack in the attack panel',
                ],
                timeLimit: 150000,
                setup: (app) => {
                    app.loadPreset('bottle_factory');
                    app.attackSim.activateAttack('mitm_intercept', 0.7);
                    // Hide UI indicator
                    const items = document.querySelectorAll('.attack-item[data-attack-id="mitm_intercept"]');
                    items.forEach(el => {
                        el.querySelector('.attack-toggle')?.classList.remove('on');
                        el.classList.remove('active');
                    });
                },
                check: (app) => {
                    const active = app.attackSim.isActive('mitm_intercept');
                    return [
                        { id: 'spot_anomaly', completed: true },
                        { id: 'identify_attack', completed: !active },
                        { id: 'stop_attack', completed: !active },
                    ];
                },
                teardown: (app) => {
                    app.attackSim.reset();
                    app.loadPreset('bottle_factory');
                },
            }],

            ['detect_dos', {
                id: 'detect_dos',
                title: 'DoS Flood Attack',
                category: 'cyber',
                difficulty: 2,
                icon: '🌊',
                description: 'The PLC scan time has spiked dramatically and the network is overwhelmed. A denial-of-service attack is flooding the communication channel. Find and neutralize it.',
                objectives: [
                    { id: 'notice_slow', text: 'Notice the scan time increase', points: 15 },
                    { id: 'find_dos', text: 'Identify the DoS flood attack', points: 35 },
                    { id: 'stop_dos', text: 'Deactivate the DoS attack', points: 50 },
                ],
                hints: [
                    'Check the Scan Cycle Debugger — scan times should be much higher than normal',
                    'Look at the Attack panel packet rate — it should be abnormally high',
                    'Find "DoS / Packet Flood" in the attack list and toggle it off',
                ],
                timeLimit: 120000,
                setup: (app) => {
                    app.loadPreset('bottle_factory');
                    app.attackSim.activateAttack('dos_flood', 0.8);
                    const items = document.querySelectorAll('.attack-item[data-attack-id="dos_flood"]');
                    items.forEach(el => {
                        el.querySelector('.attack-toggle')?.classList.remove('on');
                        el.classList.remove('active');
                    });
                },
                check: (app) => {
                    const active = app.attackSim.isActive('dos_flood');
                    return [
                        { id: 'notice_slow', completed: true },
                        { id: 'find_dos', completed: !active },
                        { id: 'stop_dos', completed: !active },
                    ];
                },
                teardown: (app) => {
                    app.attackSim.reset();
                    app.loadPreset('bottle_factory');
                },
            }],

            // ── Category 4: Timing Tuning Challenge ──────────────
            ['timing_fill', {
                id: 'timing_fill',
                title: 'Optimize Fill Station Timing',
                category: 'timing',
                difficulty: 2,
                icon: '⏱️',
                description: 'The fill station cycle time is too slow, reducing throughput. Tune the system to achieve faster cycle times while maintaining quality. Target: get 3+ station cycles in 30 seconds.',
                objectives: [
                    { id: 'start_sim', text: 'Start the simulation', points: 10 },
                    { id: 'observe', text: 'Observe initial station cycle times', points: 20 },
                    { id: 'optimize', text: 'Achieve 3+ station cycles in the Station Overview', points: 70 },
                ],
                hints: [
                    'Check the Station Overview panel for cycle counts and times',
                    'The PLC scan time affects how fast signals propagate — a faster scan helps',
                    'Try adjusting the simulation speed or ensuring all interlocks respond quickly',
                ],
                timeLimit: 60000,
                setup: (app) => {
                    app.loadPreset('bottle_factory');
                    // Slow down scan time to make it challenging
                    app.plc.cycleTime = 200;
                },
                check: (app) => {
                    const stats = app.stationManager.getStats();
                    const results = [
                        { id: 'start_sim', completed: app.isRunning },
                        { id: 'observe', completed: app.isRunning },
                        { id: 'optimize', completed: stats.totalCycles >= 3 },
                    ];
                    return results;
                },
                teardown: (app) => {
                    app.plc.cycleTime = 100;
                    app.loadPreset('bottle_factory');
                },
            }],

            // ── Category 5: Combined Challenge ───────────────────
            ['combined_chaos', {
                id: 'combined_chaos',
                title: 'Factory Under Siege',
                category: 'combined',
                difficulty: 4,
                icon: '💥',
                description: 'Multiple problems have hit the factory simultaneously: a cyber attack is active, a sensor has failed, AND there\'s a mechanical failure. Diagnose and fix all three to restore production.',
                objectives: [
                    { id: 'fix_attack', text: 'Stop the active cyber attack', points: 30 },
                    { id: 'fix_sensor', text: 'Fix the sensor failure', points: 30 },
                    { id: 'fix_mechanical', text: 'Fix the mechanical failure', points: 30 },
                    { id: 'restore', text: 'Confirm production is restored', points: 10 },
                ],
                hints: [
                    'There are 3 separate problems — check Attacks, Failures, and Station panels',
                    'The cyber attack is a replay attack — find "Replay Attack" in the Attack panel',
                    'Sensor noise + conveyor slip are the two physical failures',
                ],
                timeLimit: 240000,
                setup: (app) => {
                    app.loadPreset('bottle_factory');
                    app.attackSim.activateAttack('replay', 0.6);
                    app.failureEngine.activateFailure('sensor_noise', 0.7);
                    app.failureEngine.activateFailure('conveyor_slip', 0.8);
                    // Hide UI indicators
                    document.querySelectorAll('.attack-item .attack-toggle').forEach(el => el.classList.remove('on'));
                    document.querySelectorAll('.attack-item').forEach(el => el.classList.remove('active'));
                    document.querySelectorAll('.failure-item .failure-toggle').forEach(el => el.classList.remove('on'));
                    document.querySelectorAll('.failure-item').forEach(el => el.classList.remove('active'));
                },
                check: (app) => {
                    const attackOff = !app.attackSim.isActive('replay');
                    const noiseOff = !app.failureEngine.isActive('sensor_noise');
                    const slipOff = !app.failureEngine.isActive('conveyor_slip');
                    return [
                        { id: 'fix_attack', completed: attackOff },
                        { id: 'fix_sensor', completed: noiseOff },
                        { id: 'fix_mechanical', completed: slipOff },
                        { id: 'restore', completed: attackOff && noiseOff && slipOff },
                    ];
                },
                teardown: (app) => {
                    app.attackSim.reset();
                    app.failureEngine.reset();
                    app.loadPreset('bottle_factory');
                },
            }],
        ]);
    }

    // ── Scenario Lifecycle ───────────────────────────────────────
    startScenario(scenarioId, app) {
        const scenario = this.scenarios.get(scenarioId);
        if (!scenario) return false;

        // Teardown previous if any
        if (this.activeScenario) this.stopScenario(app);

        this.activeScenario = scenario;
        this.state = 'running';
        this.startTime = Date.now();
        this.elapsedMs = 0;
        this.score = 0;
        this.hintsUsed = 0;
        this.objectiveResults = scenario.objectives.map(o => ({
            id: o.id, text: o.text, points: o.points, completed: false, timestamp: null,
        }));

        // Run setup
        scenario.setup(app);

        // Start simulation if not running
        if (!app.isRunning) {
            app.mode = 'simulate';
            app.start();
        }

        // Start timer
        this.timerHandle = setInterval(() => {
            this.elapsedMs = Date.now() - this.startTime;

            // Check time limit
            if (scenario.timeLimit && this.elapsedMs >= scenario.timeLimit) {
                this._complete('failed', app);
            }

            // Check objectives
            const results = scenario.check(app);
            let allComplete = true;
            for (const r of results) {
                const obj = this.objectiveResults.find(o => o.id === r.id);
                if (obj && !obj.completed && r.completed) {
                    obj.completed = true;
                    obj.timestamp = Date.now();
                }
                if (obj && !obj.completed) allComplete = false;
            }

            if (this.onObjectiveUpdate) this.onObjectiveUpdate(this.objectiveResults);

            if (allComplete) {
                this._complete('completed', app);
            }
        }, 500);

        if (this.onStateChange) this.onStateChange(this.state);
        return true;
    }

    _complete(result, app) {
        clearInterval(this.timerHandle);
        this.timerHandle = null;
        this.state = result; // 'completed' or 'failed'
        this.elapsedMs = Date.now() - this.startTime;

        // Calculate score
        let earned = 0;
        let possible = 0;
        for (const obj of this.objectiveResults) {
            possible += obj.points;
            if (obj.completed) earned += obj.points;
        }
        // Apply hint penalty
        earned = Math.max(0, earned - (this.hintsUsed * this.hintPenalty));
        // Time bonus: 10% extra if under 50% time
        if (this.activeScenario.timeLimit && this.elapsedMs < this.activeScenario.timeLimit * 0.5) {
            earned = Math.min(possible, earned + Math.round(possible * 0.1));
        }
        this.score = earned;
        this.maxScore = possible;

        if (this.onStateChange) this.onStateChange(this.state);
        if (this.onComplete) this.onComplete({
            scenario: this.activeScenario,
            score: this.score,
            maxScore: this.maxScore,
            time: this.elapsedMs,
            objectives: this.objectiveResults,
            hintsUsed: this.hintsUsed,
        });
    }

    stopScenario(app) {
        if (this.timerHandle) clearInterval(this.timerHandle);
        this.timerHandle = null;
        if (this.activeScenario) {
            this.activeScenario.teardown(app);
        }
        this.activeScenario = null;
        this.state = 'idle';
        if (this.onStateChange) this.onStateChange(this.state);
    }

    getHint() {
        if (!this.activeScenario) return null;
        const hints = this.activeScenario.hints || [];
        if (this.hintsUsed >= hints.length) return null;
        const hint = hints[this.hintsUsed];
        this.hintsUsed++;
        return hint;
    }

    getTimeRemaining() {
        if (!this.activeScenario || !this.activeScenario.timeLimit) return null;
        return Math.max(0, this.activeScenario.timeLimit - this.elapsedMs);
    }

    getProgress() {
        if (!this.objectiveResults.length) return 0;
        return this.objectiveResults.filter(o => o.completed).length / this.objectiveResults.length;
    }

    getAll() {
        return Array.from(this.scenarios.values());
    }
}
