// Main Application Controller - Customizable PLC Factory Emulator
class PLCEmulatorApp {
    constructor() {
        try {
            console.log('[PLC] Initializing registry...');
            this.registry = new ComponentRegistry();
            console.log('[PLC] Registry: ' + this.registry.components.size + ' components');

            this.engine = new SimulationEngine(this.registry);
            console.log('[PLC] Initializing editor...');
            this.editor = new LayoutEditor('editor-canvas', this.registry, this.engine);

            this.plc = new PLCCore();
            this.ladderRenderer = new LadderLogicRenderer('ladder-canvas');
            this.ladderProgram = new LadderProgram();
            this.alarms = new AlarmManager();
            this.telemetry = new TelemetryClient();
            this.attackSim = new AttackSimulator();

            this.mode = 'edit';
            this.isRunning = false;
            this.updateInterval = null;
            this.syncInterval = null;
            this.telemetryInterval = null;
            this.backendHealthInterval = null;
            this.backendOnline = false;
            this.pendingAnalyzeRequest = false;
            this.latestAnalysis = this.buildDefaultAnalysis();
            this.detectionFeed = [];
            this.analysisStats = { totalRuns: 0, anomalyRuns: 0, latencySamples: [] };
            this.scenarios = this.buildScenarioProfiles();
            this.activeScenarioKey = 'normal';
            this.eventStreamConnected = false;
            this.lastStreamEventId = 0;
            this.consecutiveFailures = 0;
            this.maxBackoffMs = 8000;
            this.impactBuffer = [];

            this.initPalette();
            this.initEditorCallbacks();
            this.initEventListeners();
            this.initAttackPanel();
            this.initPLCCallbacks();
            this.buildIODisplays();
            this.updateStatusBar();

            this.startBackendHealthChecks();
            this.startTelemetryLoop();
            this.connectEventStream();

            // Initial render - auto-load bottle factory preset to show demo
            this.loadPreset('bottle_factory');
            this.syncLadderFromLayout();
            console.log('[PLC] Initialization complete - bottle factory preset loaded');
        } catch (err) {
            console.error('[PLC] INIT ERROR:', err);
        }
    }

    // ── Palette ──────────────────────────────────────────────────
    initPalette() {
        const container = document.getElementById('palette-categories');
        if (!container) return;

        for (const cat of this.registry.categories) {
            const items = this.registry.getByCategory(cat.id);
            if (items.length === 0) continue;

            const catDiv = document.createElement('div');
            catDiv.className = 'palette-category';

            const header = document.createElement('div');
            header.className = 'palette-cat-header';
            header.innerHTML = `<span class="arrow">▼</span> ${cat.icon} ${cat.label}`;
            header.addEventListener('click', () => header.classList.toggle('collapsed'));
            catDiv.appendChild(header);

            const itemsDiv = document.createElement('div');
            itemsDiv.className = 'palette-cat-items';

            for (const comp of items) {
                const item = document.createElement('div');
                item.className = 'palette-item';
                item.draggable = true;
                item.innerHTML = `<span class="palette-item-icon">${comp.icon}</span><span class="palette-item-label">${comp.label}</span>`;
                item.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', comp.type);
                    e.dataTransfer.effectAllowed = 'copy';
                });
                itemsDiv.appendChild(item);
            }

            catDiv.appendChild(itemsDiv);
            container.appendChild(catDiv);
        }

        // Search filter
        const searchInput = document.getElementById('palette-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const q = searchInput.value.toLowerCase();
                container.querySelectorAll('.palette-item').forEach(item => {
                    const label = item.querySelector('.palette-item-label').textContent.toLowerCase();
                    item.style.display = label.includes(q) ? '' : 'none';
                });
            });
        }
    }

    // ── Editor Callbacks ─────────────────────────────────────────
    initEditorCallbacks() {
        this.editor.onSelectionChange = (compId) => this.renderPropertyPanel(compId);
        this.editor.onLayoutChange = () => {
            this.updateStatusBar();
            this.buildIODisplays();
            const hint = document.getElementById('canvas-hint');
            if (hint && this.engine.getAllComponents().length > 0) {
                hint.style.display = 'none';
            }
        };
    }

    // ── Event Listeners ──────────────────────────────────────────
    initEventListeners() {
        // Mode toggle
        document.getElementById('mode-edit-btn').addEventListener('click', () => this.setMode('edit'));
        document.getElementById('mode-sim-btn').addEventListener('click', () => this.setMode('simulate'));

        // Toolbar
        document.getElementById('zoom-in-btn').addEventListener('click', () => this.editor.zoomIn());
        document.getElementById('zoom-out-btn').addEventListener('click', () => this.editor.zoomOut());
        document.getElementById('zoom-fit-btn').addEventListener('click', () => this.editor.zoomFit());

        document.getElementById('toggle-grid-btn').addEventListener('click', (e) => {
            this.editor.toggleGrid();
            e.currentTarget.classList.toggle('active');
        });
        document.getElementById('toggle-snap-btn').addEventListener('click', (e) => {
            this.editor.toggleSnap();
            e.currentTarget.classList.toggle('active');
        });

        // Presets
        document.getElementById('load-preset-btn').addEventListener('click', () => {
            const preset = document.getElementById('preset-select').value;
            if (preset) this.loadPreset(preset);
        });

        // Save / Load / Clear
        document.getElementById('save-layout-btn').addEventListener('click', () => this.saveLayout());
        document.getElementById('load-layout-btn').addEventListener('click', () => {
            document.getElementById('layout-file-input').click();
        });
        document.getElementById('layout-file-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                this.editor.importLayout(ev.target.result);
                this.buildIODisplays();
                this.updateStatusBar();
            };
            reader.readAsText(file);
            e.target.value = '';
        });
        document.getElementById('clear-layout-btn').addEventListener('click', () => {
            if (confirm('Clear all components and wires?')) {
                this.engine.reset();
                this.engine.components.clear();
                this.engine.wires = [];
                this.editor.nextCompId = 1;
                this.editor.render();
                this.buildIODisplays();
                this.updateStatusBar();
                this.renderPropertyPanel(null);
                const hint = document.getElementById('canvas-hint');
                if (hint) hint.style.display = '';
            }
        });

        // Simulation controls
        document.getElementById('start-btn').addEventListener('click', () => this.start());
        document.getElementById('stop-btn').addEventListener('click', () => this.stop());
        document.getElementById('reset-btn').addEventListener('click', () => this.reset());
        document.getElementById('emergency-btn').addEventListener('click', () => this.emergencyStop());

        // Ladder controls
        document.getElementById('edit-ladder-btn').addEventListener('click', () => this.toggleLadderEditor());
        document.getElementById('run-scan-btn').addEventListener('click', () => this.runSingleScan());

        // ML controls
        this.initMLShowcaseControls();
    }

    initMLShowcaseControls() {
        document.querySelectorAll('.scenario-btn').forEach(btn => {
            btn.addEventListener('click', () => this.setScenario(btn.dataset.scenario || 'normal'));
        });
        const exportBtn = document.getElementById('export-report-btn');
        if (exportBtn) exportBtn.addEventListener('click', () => this.exportDemoReport());
    }

    // ── Attack Panel ──────────────────────────────────────────────
    initAttackPanel() {
        const listEl = document.getElementById('attack-list');
        if (!listEl) return;

        // Build attack items
        for (const [id, def] of this.attackSim.attacks) {
            const item = document.createElement('div');
            item.className = 'attack-item';
            item.dataset.attackId = id;
            item.dataset.category = def.category;
            item.innerHTML = `
                <div class="attack-item-header">
                    <span class="attack-item-name">${def.icon} ${def.name}</span>
                    <button class="attack-toggle" data-attack-id="${id}"></button>
                </div>
                <div class="attack-item-meta">
                    <span class="attack-cat-badge">${def.category}</span>
                    <span class="attack-severity severity-${def.severity}">${def.severity}</span>
                </div>
                <div class="attack-item-desc">${def.description}</div>
                <div class="attack-intensity">
                    <label>Intensity</label>
                    <input type="range" min="10" max="100" value="100" data-attack-id="${id}">
                    <span class="attack-intensity-val">100%</span>
                </div>`;
            listEl.appendChild(item);
        }

        // Toggle attack on/off
        listEl.addEventListener('click', (e) => {
            const toggleBtn = e.target.closest('.attack-toggle');
            if (!toggleBtn) return;
            const attackId = toggleBtn.dataset.attackId;
            const item = toggleBtn.closest('.attack-item');
            if (this.attackSim.isActive(attackId)) {
                this.attackSim.deactivateAttack(attackId);
                toggleBtn.classList.remove('on');
                item.classList.remove('active');
            } else {
                const slider = item.querySelector('input[type="range"]');
                const intensity = slider ? parseInt(slider.value) / 100 : 1.0;
                this.attackSim.activateAttack(attackId, intensity);
                toggleBtn.classList.add('on');
                item.classList.add('active');
            }
            this.updateAttackStatus();
        });

        // Intensity slider
        listEl.addEventListener('input', (e) => {
            if (e.target.type !== 'range') return;
            const attackId = e.target.dataset.attackId;
            const val = parseInt(e.target.value);
            const label = e.target.parentElement.querySelector('.attack-intensity-val');
            if (label) label.textContent = val + '%';
            if (this.attackSim.isActive(attackId)) {
                this.attackSim.activeAttacks.get(attackId).intensity = val / 100;
            }
        });

        // Category filter
        document.querySelectorAll('.attack-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.attack-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const filter = btn.dataset.filter;
                listEl.querySelectorAll('.attack-item').forEach(item => {
                    item.style.display = (filter === 'all' || item.dataset.category === filter) ? '' : 'none';
                });
            });
        });

        // Reset all attacks
        const resetBtn = document.getElementById('attack-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.attackSim.reset();
                listEl.querySelectorAll('.attack-item').forEach(item => {
                    item.classList.remove('active');
                    item.querySelector('.attack-toggle').classList.remove('on');
                    const slider = item.querySelector('input[type="range"]');
                    if (slider) { slider.value = 100; }
                    const label = item.querySelector('.attack-intensity-val');
                    if (label) label.textContent = '100%';
                });
                this.plc.cycleTime = 100;
                this.updateAttackStatus();
                this.updateAttackUI(null);
            });
        }

        // Wire attack simulator callbacks
        this.attackSim.onAnalysis = (analysis) => this.handleRealtimeAnalysis(analysis);
        this.attackSim.onComponentImpact = (impacts) => {
            this.impactBuffer = impacts.slice(-20).concat(this.impactBuffer).slice(0, 40);
            this.updateImpactFeed();
        };
    }

    updateAttackStatus() {
        const el = document.getElementById('attack-status');
        if (!el) return;
        const count = this.attackSim.activeAttacks.size;
        if (count === 0) {
            el.textContent = 'No attacks active';
            el.classList.remove('active');
        } else {
            el.textContent = `${count} attack${count > 1 ? 's' : ''} active`;
            el.classList.add('active');
        }
        const countEl = document.getElementById('active-attack-count');
        if (countEl) countEl.textContent = count;
    }

    handleRealtimeAnalysis(analysis) {
        if (!analysis) return;
        // Update monitoring metrics
        const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setT('anomaly-score', Math.round(analysis.processScore));
        setT('network-risk', Math.round(analysis.networkScore));
        setT('model-confidence', analysis.modelConfidence);
        setT('packet-rate-live', analysis.packetRate);
        setT('cycle-time', Math.round(this.plc.cycleTime) + 'ms');

        // Packet stats
        setT('pkt-rate', analysis.packetRate);
        setT('pkt-burst', analysis.burstRatio);
        setT('pkt-unauth', analysis.unauthorizedAttempts);
        const malPct = this.attackSim.activeAttacks.size > 0 ? Math.round(analysis.burstRatio * 40) : 0;
        setT('pkt-malicious', malPct + '%');

        // Packet bars
        const total = Math.max(1, analysis.packetRate);
        const normalPct = Math.max(0, 100 - analysis.burstRatio * 100 - malPct);
        const setBar = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = Math.min(100, pct) + '%'; };
        setBar('bar-normal', normalPct);
        setBar('bar-burst', analysis.burstRatio * 100);
        setBar('bar-malicious', malPct);

        // Risk gauge
        const maxScore = Math.max(analysis.processScore, analysis.networkScore);
        const gaugeFill = document.getElementById('risk-gauge-fill');
        const gaugeLabel = document.getElementById('risk-gauge-label');
        if (gaugeFill) {
            gaugeFill.style.width = maxScore + '%';
            gaugeFill.style.background = analysis.riskColor;
        }
        if (gaugeLabel) gaugeLabel.textContent = analysis.riskLevel.toUpperCase();

        // Risk pill
        const riskEl = document.getElementById('risk-level');
        if (riskEl) {
            riskEl.textContent = analysis.riskLevel.toUpperCase();
            riskEl.className = 'risk-pill risk-' + analysis.riskLevel;
        }

        // Security flag
        const sfEl = document.getElementById('security-flag');
        if (sfEl) {
            sfEl.textContent = analysis.securityFlag ? 'ALERT' : 'CLEAR';
            sfEl.style.color = analysis.securityFlag ? '#ef4444' : '#22c55e';
        }

        // Recommended action
        setT('recommended-action', analysis.recommendedAction);

        // Component breakdowns
        this.renderScoreComponents('process-components', analysis.processComponents);
        this.renderScoreComponents('network-components', analysis.networkComponents);

        // Push to detection feed if anomalous
        if (analysis.processAnomaly || analysis.networkAlert) {
            this.pushDetectionEvent({
                processAnomaly: analysis.processAnomaly,
                networkAlert: analysis.networkAlert,
                processScore: analysis.processScore,
                networkScore: analysis.networkScore,
                riskLevel: analysis.riskLevel,
                reasons: analysis.reasons
            });
            if (analysis.processAnomaly) this.alarms.addAlarm('PROCESS_ANOMALY', 'Real-time: process anomaly detected', 'critical');
            if (analysis.networkAlert) this.alarms.addAlarm('NETWORK_ALERT', 'Real-time: network anomaly detected', 'critical');
        } else {
            this.alarms.clearAlarm('PROCESS_ANOMALY');
            this.alarms.clearAlarm('NETWORK_ALERT');
        }

        // Stats
        this.recordAnalysisStats(0, analysis.processAnomaly || analysis.networkAlert);
    }

    renderScoreComponents(containerId, components) {
        const el = document.getElementById(containerId);
        if (!el) return;
        const entries = Object.entries(components || {});
        if (entries.length === 0) {
            el.innerHTML = '<div style="opacity:0.5;font-size:0.7rem;">—</div>';
            return;
        }
        el.innerHTML = entries.map(([name, score]) => {
            const pct = Math.min(100, Math.max(0, score));
            const color = pct > 60 ? '#ef4444' : pct > 30 ? '#f59e0b' : '#22c55e';
            return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;font-size:0.7rem;">
                <span style="color:#94a3b8">${name}</span>
                <div style="display:flex;align-items:center;gap:6px;">
                    <div style="width:60px;height:4px;background:#1e293b;border-radius:2px;overflow:hidden;">
                        <div style="width:${pct}%;height:100%;background:${color};border-radius:2px;"></div>
                    </div>
                    <span style="color:${color};font-weight:600;min-width:28px;text-align:right;">${Math.round(score)}</span>
                </div>
            </div>`;
        }).join('');
    }

    updateImpactFeed() {
        const el = document.getElementById('impact-feed');
        if (!el) return;
        if (this.impactBuffer.length === 0) {
            el.innerHTML = '<div class="no-alarms">No component impacts</div>';
            return;
        }
        el.innerHTML = this.impactBuffer.slice(0, 15).map(imp => {
            const attackDef = this.attackSim.attacks.get(imp.attackId);
            const name = attackDef ? attackDef.name : imp.attackId;
            return `<div class="impact-item">
                <span class="impact-comp">${imp.compId} (${imp.compType})</span>
                <span class="impact-effect">${imp.effect}</span>
                <span style="color:#64748b;font-size:0.6rem;">${name}</span>
            </div>`;
        }).join('');
    }

    updateAttackUI(analysis) {
        if (!analysis) {
            // Reset all UI to baseline
            const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
            setT('anomaly-score', '0');
            setT('network-risk', '0');
            setT('model-confidence', '100');
            setT('packet-rate-live', '130');
            setT('pkt-rate', '130');
            setT('pkt-burst', '0.15');
            setT('pkt-unauth', '0');
            setT('pkt-malicious', '0%');
            const setBar = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = pct + '%'; };
            setBar('bar-normal', 100);
            setBar('bar-burst', 0);
            setBar('bar-malicious', 0);
            const gf = document.getElementById('risk-gauge-fill');
            if (gf) { gf.style.width = '0%'; gf.style.background = '#22c55e'; }
            const gl = document.getElementById('risk-gauge-label');
            if (gl) gl.textContent = 'LOW';
            this.impactBuffer = [];
            this.updateImpactFeed();
        }
    }

    updatePacketLog(packets) {
        const logEl = document.getElementById('packet-log');
        if (!logEl) return;
        // Keep header, remove old rows
        const rows = logEl.querySelectorAll('.packet-log-row');
        if (rows.length > 30) {
            for (let i = 0; i < rows.length - 30; i++) rows[i].remove();
        }
        for (const pkt of packets.slice(-5)) {
            const row = document.createElement('div');
            row.className = 'packet-log-row ' + pkt.type;
            const ts = new Date(pkt.timestamp).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
            row.innerHTML = `<span>${ts}</span><span>${pkt.srcIP}</span><span>${pkt.dstIP}:${pkt.dstPort}</span><span>${pkt.protocol}</span><span>${pkt.length}</span><span>${pkt.type}</span>`;
            logEl.appendChild(row);
            // Auto-scroll
            logEl.scrollTop = logEl.scrollHeight;
        }
    }

    // ── PLC Callbacks ────────────────────────────────────────────
    initPLCCallbacks() {
        this.plc.onInputChange.push((addr, val) => this.updateSingleIO('I', addr, val));
        this.plc.onOutputChange.push((addr, val) => this.updateSingleIO('O', addr, val));
        this.plc.onScanComplete.push(() => {});
    }

    // ── Mode Management ──────────────────────────────────────────
    setMode(mode) {
        if (this.mode === mode) return;

        // Stop simulation when switching to edit
        if (mode === 'edit' && this.isRunning) this.stop();

        this.mode = mode;
        this.editor.setMode(mode);

        document.getElementById('mode-edit-btn').classList.toggle('active', mode === 'edit');
        document.getElementById('mode-sim-btn').classList.toggle('active', mode === 'simulate');
        document.getElementById('mode-status').textContent = mode === 'edit' ? 'EDIT' : 'SIM';
        document.getElementById('sim-controls').style.display = mode === 'simulate' ? 'flex' : 'none';

        // In simulate mode, hide palette and property panel for more canvas space (optional)
        // Or keep them visible for interaction
    }

    // ── Simulation Controls ──────────────────────────────────────
    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.plc.start();
        this.engine.start();

        this.engine.onTick = (dt) => {
            // Sync: sensors → PLC inputs, PLC outputs → actuators
            this.engine.readSensorsToPLC(this.plc);
            this.engine.writePLCToActuators(this.plc);

            // Real-time attack simulation + packet analysis
            const analysis = this.attackSim.tick(this.engine, this.plc, dt);
            this.updatePacketLog(this.attackSim.packetLog.slice(-5));

            // Reset PLC cycle time when no attacks manipulate it
            if (!this.attackSim.activeAttacks.size) this.plc.cycleTime = 100;

            this.editor.render();
        };

        this.startUIUpdates();
        this.updatePLCStatus();
        this.alarms.clearAlarm('SYSTEM_STOPPED');
    }

    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.plc.stop();
        this.engine.stop();
        this.stopUIUpdates();
        this.updatePLCStatus();
        this.alarms.addAlarm('SYSTEM_STOPPED', 'System stopped by operator');
    }

    reset() {
        this.stop();
        this.plc.reset();
        this.engine.reset();
        this.alarms.clearAllAlarms();
        for (let i = 0; i < 16; i++) this.plc.setInput(`I:0/${i}`, false);
        this.latestAnalysis = this.buildDefaultAnalysis();
        this.detectionFeed = [];
        this.analysisStats = { totalRuns: 0, anomalyRuns: 0, latencySamples: [] };
        this.lastStreamEventId = 0;
        this.disconnectEventStream();
        this.connectEventStream();
        this.setScenario('normal');
        this.updatePLCStatus();
        this.updateIODisplayValues();
        this.updateMonitoringDisplays();
        this.editor.render();
    }

    emergencyStop() {
        this.isRunning = false;
        this.plc.setInput('I:0/0', true);
        this.plc.triggerEmergencyStop();
        this.engine.stop();
        this.stopUIUpdates();
        this.alarms.addAlarm('EMERGENCY_STOP', 'Emergency stop activated!', 'critical');
        this.updatePLCStatus();
        this.updateIODisplayValues();
        this.editor.render();
    }

    // ── UI Updates ───────────────────────────────────────────────
    startUIUpdates() {
        if (this.updateInterval) clearInterval(this.updateInterval);
        this.updateInterval = setInterval(() => {
            this.updateIODisplayValues();
            this.updateMonitoringDisplays();
            this.updateStatusBar();
            this.ladderRenderer.render(this.ladderProgram, this.plc.getIOState());
        }, 200);
    }

    stopUIUpdates() {
        if (this.updateInterval) { clearInterval(this.updateInterval); this.updateInterval = null; }
    }

    updatePLCStatus() {
        const status = this.plc.getStatus();
        const el = document.getElementById('plc-status');
        if (!el) return;

        if (status.emergencyStop) {
            el.textContent = 'E-STOP'; el.className = 'status-value plc-error';
        } else if (status.errorState) {
            el.textContent = 'ERROR'; el.className = 'status-value plc-error';
        } else if (status.runMode) {
            el.textContent = 'RUNNING'; el.className = 'status-value plc-running';
        } else {
            el.textContent = 'STOPPED'; el.className = 'status-value plc-stopped';
        }

        const ctEl = document.getElementById('cycle-time');
        if (ctEl) ctEl.textContent = `${status.cycleTime}ms`;
    }

    updateStatusBar() {
        const metrics = this.engine.getProductionMetrics();
        const compEl = document.getElementById('comp-count');
        const wireEl = document.getElementById('wire-count');
        if (compEl) compEl.textContent = metrics.totalComponents;
        if (wireEl) wireEl.textContent = metrics.wires;
    }

    // ── I/O Display ──────────────────────────────────────────────
    buildIODisplays() {
        const inputList = document.getElementById('io-inputs-list');
        const outputList = document.getElementById('io-outputs-list');
        if (!inputList || !outputList) return;

        // Build input list
        inputList.innerHTML = '';
        for (let i = 0; i < 16; i++) {
            const addr = `I:0/${i}`;
            const desc = this.getAddressDescription(addr);
            inputList.innerHTML += `<div class="io-item">
                <span class="io-address">${addr}</span>
                <span class="io-description">${desc}</span>
                <span class="io-status OFF" id="IO_I_${i}">OFF</span>
            </div>`;
        }

        // Build output list
        outputList.innerHTML = '';
        for (let i = 0; i < 16; i++) {
            const addr = `O:0/${i}`;
            const desc = this.getAddressDescription(addr);
            outputList.innerHTML += `<div class="io-item">
                <span class="io-address">${addr}</span>
                <span class="io-description">${desc}</span>
                <span class="io-status OFF" id="IO_O_${i}">OFF</span>
            </div>`;
        }
    }

    getAddressDescription(address) {
        // Look up which component is mapped to this address
        for (const comp of this.engine.getAllComponents()) {
            if (comp.props.address === address) {
                const def = this.registry.get(comp.type);
                return `${comp.props.label || def?.label || comp.type}`;
            }
        }
        return '—';
    }

    updateIODisplayValues() {
        const io = this.plc.getIOState();
        for (let i = 0; i < 16; i++) {
            const inEl = document.getElementById(`IO_I_${i}`);
            if (inEl) {
                inEl.textContent = io.inputs[i] ? 'ON' : 'OFF';
                inEl.className = io.inputs[i] ? 'io-status ON' : 'io-status OFF';
            }
            const outEl = document.getElementById(`IO_O_${i}`);
            if (outEl) {
                outEl.textContent = io.outputs[i] ? 'ON' : 'OFF';
                outEl.className = io.outputs[i] ? 'io-status ON' : 'io-status OFF';
            }
        }
    }

    updateSingleIO(type, address, value) {
        const match = address.match(/([IO]):(\d+)\/(\d+)/);
        if (!match) return;
        const idx = parseInt(match[3]);
        const el = document.getElementById(`IO_${type === 'I' ? 'I' : 'O'}_${idx}`);
        if (el) {
            el.textContent = value ? 'ON' : 'OFF';
            el.className = value ? 'io-status ON' : 'io-status OFF';
        }
    }

    // ── Property Panel ───────────────────────────────────────────
    renderPropertyPanel(compId) {
        const container = document.getElementById('prop-content');
        if (!container) return;

        if (!compId) {
            container.innerHTML = '<div class="prop-placeholder">Select a component to edit its properties</div>';
            return;
        }

        const comp = this.engine.getComponent(compId);
        if (!comp) { container.innerHTML = ''; return; }
        const def = this.registry.get(comp.type);
        if (!def) return;

        let html = '';

        // Component info
        html += `<div class="prop-group">
            <div class="prop-group-title">${def.icon} ${def.label}</div>
            <div class="prop-row"><span class="prop-label">ID</span><span style="font-size:0.72rem;color:#64748b;font-family:monospace">${comp.id}</span></div>
            <div class="prop-row"><span class="prop-label">Type</span><span style="font-size:0.72rem;color:#64748b">${comp.type}</span></div>
        </div>`;

        // Editable properties
        html += `<div class="prop-group"><div class="prop-group-title">Configuration</div>`;

        // Label
        html += `<div class="prop-row"><span class="prop-label">Label</span>
            <input class="prop-input" id="prop-label" value="${comp.props.label || ''}" /></div>`;

        // PLC Address (for sensors/actuators/indicators)
        if (def.category === 'sensors' || def.category === 'actuators' || def.category === 'indicators') {
            const addrType = def.category === 'sensors' ? 'I' : 'O';
            html += `<div class="prop-row"><span class="prop-label">PLC Address</span>
                <select class="prop-select" id="prop-address">
                    <option value="">None</option>`;
            for (let i = 0; i < 16; i++) {
                const a = `${addrType}:0/${i}`;
                const sel = comp.props.address === a ? 'selected' : '';
                html += `<option value="${a}" ${sel}>${a}</option>`;
            }
            html += `</select></div>`;
        }

        // Numeric properties
        for (const [key, val] of Object.entries(comp.props)) {
            if (key === 'label' || key === 'address') continue;
            if (typeof val === 'number') {
                html += `<div class="prop-row"><span class="prop-label">${key}</span>
                    <input class="prop-input" type="number" id="prop-${key}" value="${val}" /></div>`;
            } else if (typeof val === 'string' && key !== 'label') {
                html += `<div class="prop-row"><span class="prop-label">${key}</span>
                    <input class="prop-input" id="prop-${key}" value="${val}" /></div>`;
            } else if (typeof val === 'boolean') {
                html += `<div class="prop-row"><span class="prop-label">${key}</span>
                    <button class="prop-btn-toggle ${val?'on':'off'}" id="prop-${key}">${val?'ON':'OFF'}</button></div>`;
            }
        }
        html += `</div>`;

        // Sensor force toggle (in simulate mode)
        if (def.category === 'sensors' && this.mode === 'simulate') {
            const forced = comp.state.forced || false;
            html += `<div class="prop-group"><div class="prop-group-title">Simulation</div>`;
            const outPort = def.ports.find(p => p.type === 'output');
            if (outPort && outPort.dataType === 'digital') {
                html += `<div class="prop-row"><span class="prop-label">Force State</span>
                    <button class="prop-btn-toggle ${forced?'on':'off'}" id="prop-force">${forced?'ON':'OFF'}</button></div>`;
            }
            if (outPort && outPort.dataType === 'analog') {
                const val = comp.state.value !== undefined ? comp.state.value : 0;
                html += `<div class="prop-row"><span class="prop-label">Value</span>
                    <input class="prop-slider" type="range" id="prop-analog-value" min="0" max="100" value="${val}" />
                    <span style="font-size:0.72rem;min-width:30px;text-align:right" id="prop-analog-display">${Math.round(val)}</span></div>`;
            }
            html += `</div>`;
        }

        // Ports info
        html += `<div class="prop-group"><div class="prop-group-title">Ports</div>`;
        for (const port of def.ports) {
            const connected = this.editor.isPortConnected(compId, port.id);
            html += `<div class="prop-row">
                <span class="prop-label" style="color:${port.type==='input'?'#3b82f6':'#f59e0b'}">${port.type==='input'?'→':'←'} ${port.label}</span>
                <span style="font-size:0.7rem;color:${connected?'#22c55e':'#475569'}">${connected?'Connected':'—'}</span>
            </div>`;
        }
        html += `</div>`;

        // Delete button
        html += `<button class="prop-btn prop-btn-danger" id="prop-delete">🗑️ Delete Component</button>`;

        container.innerHTML = html;

        // Bind property change events
        this.bindPropertyEvents(compId);
    }

    bindPropertyEvents(compId) {
        const comp = this.engine.getComponent(compId);
        if (!comp) return;

        // Label
        const labelEl = document.getElementById('prop-label');
        if (labelEl) {
            labelEl.addEventListener('change', () => {
                this.engine.updateComponentProps(compId, { label: labelEl.value });
                this.editor.render();
                this.buildIODisplays();
            });
        }

        // Address
        const addrEl = document.getElementById('prop-address');
        if (addrEl) {
            addrEl.addEventListener('change', () => {
                this.engine.updateComponentProps(compId, { address: addrEl.value });
                this.editor.render();
                this.buildIODisplays();
            });
        }

        // Numeric/string properties
        for (const [key, val] of Object.entries(comp.props)) {
            if (key === 'label' || key === 'address') continue;
            const el = document.getElementById(`prop-${key}`);
            if (!el) continue;

            if (typeof val === 'number') {
                el.addEventListener('change', () => {
                    const update = {};
                    update[key] = parseFloat(el.value) || 0;
                    this.engine.updateComponentProps(compId, update);
                });
            } else if (typeof val === 'string') {
                el.addEventListener('change', () => {
                    const update = {};
                    update[key] = el.value;
                    this.engine.updateComponentProps(compId, update);
                });
            } else if (typeof val === 'boolean') {
                el.addEventListener('click', () => {
                    const newVal = !comp.props[key];
                    const update = {};
                    update[key] = newVal;
                    this.engine.updateComponentProps(compId, update);
                    el.textContent = newVal ? 'ON' : 'OFF';
                    el.className = `prop-btn-toggle ${newVal?'on':'off'}`;
                });
            }
        }

        // Force toggle
        const forceEl = document.getElementById('prop-force');
        if (forceEl) {
            forceEl.addEventListener('click', () => {
                const newVal = !comp.state.forced;
                this.engine.forceDigitalSensor(compId, newVal);
                forceEl.textContent = newVal ? 'ON' : 'OFF';
                forceEl.className = `prop-btn-toggle ${newVal?'on':'off'}`;
                this.editor.render();
            });
        }

        // Analog slider
        const analogEl = document.getElementById('prop-analog-value');
        const analogDisplay = document.getElementById('prop-analog-display');
        if (analogEl) {
            analogEl.addEventListener('input', () => {
                const val = parseFloat(analogEl.value);
                this.engine.setAnalogSensorValue(compId, val);
                if (analogDisplay) analogDisplay.textContent = Math.round(val);
                this.editor.render();
            });
        }

        // Delete
        const deleteEl = document.getElementById('prop-delete');
        if (deleteEl) {
            deleteEl.addEventListener('click', () => {
                this.editor.deleteSelected();
                this.buildIODisplays();
                this.updateStatusBar();
            });
        }
    }

    // ── Monitoring ───────────────────────────────────────────────
    updateMonitoringDisplays() {
        const metrics = this.engine.getProductionMetrics();
        const setTextSafe = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

        setTextSafe('metric-components', metrics.totalComponents);
        setTextSafe('metric-sensors', metrics.activeSensors);
        setTextSafe('metric-actuators', metrics.activeActuators);
        setTextSafe('anomaly-score', Math.round(this.latestAnalysis.processScore));
        setTextSafe('network-risk', Math.round(this.latestAnalysis.networkScore));
        setTextSafe('model-confidence', Math.round(this.latestAnalysis.modelConfidence));

        this.updateAlarmsDisplay();
        this.updateDetectionFeed();
        this.updateExplainabilityPanel();
        this.updateSessionKpis();
    }

    // ── Ladder Logic ─────────────────────────────────────────────
    syncLadderFromLayout() {
        // Auto-generate ladder program from the layout's component I/O addresses and wires
        const program = new LadderProgram();
        program.rungs = []; // clear default

        const allComps = this.engine.getAllComponents();
        const allWires = this.engine.getAllWires();

        // Collect sensor (input) and actuator (output) addresses
        const sensors = [];  // { compId, address, label, type }
        const actuators = []; // { compId, address, label, type }

        for (const comp of allComps) {
            const def = this.registry.get(comp.type);
            if (!def) continue;
            const addr = comp.props.address;
            if (!addr) continue;
            const label = comp.props.label || comp.type;

            if (def.category === 'sensors') {
                sensors.push({ compId: comp.id, address: addr, label, type: comp.type });
            } else if (def.category === 'actuators' || def.category === 'indicators') {
                actuators.push({ compId: comp.id, address: addr, label, type: comp.type });
            }
        }

        // Build a wire map: which sensor compId connects to which actuator compId
        const sensorToActuator = new Map(); // sensorCompId -> Set<actuatorCompId>
        for (const wire of allWires) {
            const fromComp = this.engine.components.get(wire.fromComp);
            const toComp = this.engine.components.get(wire.toComp);
            if (!fromComp || !toComp) continue;

            const fromDef = this.registry.get(fromComp.type);
            const toDef = this.registry.get(toComp.type);
            if (!fromDef || !toDef) continue;

            // Direct sensor -> actuator wiring
            if (fromDef.category === 'sensors' && (toDef.category === 'actuators' || toDef.category === 'indicators')) {
                if (!sensorToActuator.has(wire.fromComp)) sensorToActuator.set(wire.fromComp, new Set());
                sensorToActuator.get(wire.fromComp).add(wire.toComp);
            }
            // Also handle sensor -> logic -> actuator chains
            if (fromDef.category === 'sensors' && toDef.category === 'logic') {
                // Find what the logic gate outputs to
                for (const w2 of allWires) {
                    if (w2.fromComp === wire.toComp) {
                        const outComp = this.engine.components.get(w2.toComp);
                        if (outComp) {
                            const outDef = this.registry.get(outComp.type);
                            if (outDef && (outDef.category === 'actuators' || outDef.category === 'indicators')) {
                                if (!sensorToActuator.has(wire.fromComp)) sensorToActuator.set(wire.fromComp, new Set());
                                sensorToActuator.get(wire.fromComp).add(w2.toComp);
                            }
                        }
                    }
                }
            }
        }

        // Rung 0: Security lockout
        program.addRung(new LadderRung([
            new LadderInstruction('XIC', ['I:0/8']),
            new LadderInstruction('OTE', ['O:0/8'])
        ]));
        program.rungs[0].comment = 'Security Lockout (AI anomaly OR network alert)';

        // Generate rungs from wired sensor->actuator pairs
        const generatedOutputs = new Set();
        for (const [sensorCompId, actuatorSet] of sensorToActuator) {
            const sensorComp = allComps.find(c => c.id === sensorCompId);
            if (!sensorComp || !sensorComp.props.address) continue;

            for (const actCompId of actuatorSet) {
                const actComp = allComps.find(c => c.id === actCompId);
                if (!actComp || !actComp.props.address) continue;
                if (generatedOutputs.has(actComp.props.address)) continue;

                const instructions = [
                    new LadderInstruction('XIC', [sensorComp.props.address])
                ];

                // Check if multiple sensors feed same actuator
                for (const [otherSensor, otherActSet] of sensorToActuator) {
                    if (otherSensor === sensorCompId) continue;
                    if (!otherActSet.has(actCompId)) continue;
                    const otherComp = allComps.find(c => c.id === otherSensor);
                    if (otherComp && otherComp.props.address) {
                        instructions.push(new LadderInstruction('XIC', [otherComp.props.address]));
                    }
                }

                instructions.push(new LadderInstruction('OTE', [actComp.props.address]));
                const rung = new LadderRung(instructions);
                rung.comment = `${sensorComp.props.label || sensorComp.type} -> ${actComp.props.label || actComp.type}`;
                program.addRung(rung);
                generatedOutputs.add(actComp.props.address);
            }
        }

        // Generate standalone actuator rungs (no wired sensor, just direct PLC control)
        for (const act of actuators) {
            if (generatedOutputs.has(act.address)) continue;
            // Find any sensor that could logically feed this actuator by address proximity
            const sensorAddr = sensors.find(s => {
                const sIdx = parseInt(s.address.match(/\d+$/)?.[0] || '-1');
                const aIdx = parseInt(act.address.match(/\d+$/)?.[0] || '-1');
                return sIdx >= 0 && aIdx >= 0 && sIdx === aIdx;
            });
            if (sensorAddr) {
                program.addRung(new LadderRung([
                    new LadderInstruction('XIC', [sensorAddr.address]),
                    new LadderInstruction('OTE', [act.address])
                ]));
            } else {
                // Direct enable rung (always on when system runs)
                program.addRung(new LadderRung([
                    new LadderInstruction('XIO', ['I:0/0']),
                    new LadderInstruction('OTE', [act.address])
                ]));
            }
            generatedOutputs.add(act.address);
        }

        this.ladderProgram = program;
        this.plc.setLadderProgram(program);
        this.ladderRenderer.render(this.ladderProgram, this.plc.getIOState());
        console.log('[PLC] Ladder synced:', program.rungs.length, 'rungs from', sensors.length, 'sensors +', actuators.length, 'actuators');
    }

    toggleLadderEditor() {
        const btn = document.getElementById('edit-ladder-btn');
        const isEdit = btn.textContent === 'Edit Logic';
        btn.textContent = isEdit ? 'Save Logic' : 'Edit Logic';
    }

    runSingleScan() {
        this.plc.executeLadderLogic();
        this.updateIODisplayValues();
        this.ladderRenderer.render(this.ladderProgram, this.plc.getIOState());
        const btn = document.getElementById('run-scan-btn');
        btn.style.background = '#16a34a';
        setTimeout(() => { btn.style.background = ''; }, 200);
    }

    // ── Presets ──────────────────────────────────────────────────
    loadPreset(name) {
        try {
            console.log('[PLC] Loading preset:', name);
            const presets = this.getPresets();
            const data = presets[name];
            if (!data) { console.warn('[PLC] Preset not found:', name); return; }
            this.engine.deserialize(data);
            const comps = this.engine.getAllComponents();
            console.log('[PLC] Loaded', comps.length, 'components,', this.engine.getAllWires().length, 'wires');
            let maxId = 0;
            for (const c of comps) {
                const n = parseInt(c.id.replace('comp_', ''));
                if (!isNaN(n) && n > maxId) maxId = n;
            }
            this.editor.nextCompId = maxId + 1;
            this.editor.render();
            this.buildIODisplays();
            this.updateStatusBar();
            this.renderPropertyPanel(null);
            const hint = document.getElementById('canvas-hint');
            if (hint) hint.style.display = 'none';
            this.syncLadderFromLayout();
            console.log('[PLC] Preset rendered successfully');
        } catch (err) {
            console.error('[PLC] loadPreset error:', err);
        }
    }

    getPresets() {
        return {
            bottle_factory: {
                version: 1,
                components: [
                    { id: 'comp_1', type: 'conveyor', x: 200, y: 300, props: { address: '', label: 'Main Conv', speed: 1, length: 3 } },
                    { id: 'comp_2', type: 'motor', x: 60, y: 290, props: { address: 'O:0/0', label: 'Conv Motor', ratedRPM: 1800 } },
                    { id: 'comp_3', type: 'proximity_sensor', x: 340, y: 200, props: { address: 'I:0/3', label: 'Filler Sensor', detectRange: 10 } },
                    { id: 'comp_4', type: 'solenoid_valve', x: 340, y: 100, props: { address: 'O:0/1', label: 'Fill Valve', type: '2-way' } },
                    { id: 'comp_5', type: 'proximity_sensor', x: 500, y: 200, props: { address: 'I:0/4', label: 'Capper Sensor', detectRange: 10 } },
                    { id: 'comp_6', type: 'motor', x: 500, y: 100, props: { address: 'O:0/2', label: 'Capper Motor', ratedRPM: 900 } },
                    { id: 'comp_7', type: 'photo_sensor', x: 660, y: 200, props: { address: 'I:0/5', label: 'Quality Sensor', beamType: 'through' } },
                    { id: 'comp_8', type: 'indicator_light', x: 660, y: 100, props: { address: 'O:0/3', label: 'Quality Light', color: 'green' } },
                    { id: 'comp_9', type: 'solenoid_valve', x: 760, y: 200, props: { address: 'O:0/4', label: 'Reject Gate', type: '2-way' } },
                    { id: 'comp_10', type: 'limit_switch', x: 60, y: 200, props: { address: 'I:0/1', label: 'Start SW' } },
                    { id: 'comp_11', type: 'buzzer', x: 820, y: 100, props: { address: 'O:0/5', label: 'Alarm Horn' } },
                    { id: 'comp_12', type: 'indicator_light', x: 820, y: 200, props: { address: 'O:0/7', label: 'Run Light', color: 'green' } },
                    { id: 'comp_13', type: 'level_sensor', x: 200, y: 100, props: { address: 'I:0/6', label: 'Tank Level' } },
                ],
                wires: [
                    { fromComp: 'comp_2', fromPort: 'running', toComp: 'comp_1', toPort: 'motor' },
                    { fromComp: 'comp_10', fromPort: 'out', toComp: 'comp_2', toPort: 'run' },
                    { fromComp: 'comp_3', fromPort: 'out', toComp: 'comp_4', toPort: 'cmd' },
                    { fromComp: 'comp_5', fromPort: 'out', toComp: 'comp_6', toPort: 'run' },
                    { fromComp: 'comp_7', fromPort: 'out', toComp: 'comp_8', toPort: 'cmd' }
                ]
            },
            sorting_station: {
                version: 1,
                components: [
                    { id: 'comp_1', type: 'conveyor', x: 100, y: 280, props: { address: '', label: 'Infeed Conv', speed: 1, length: 2 } },
                    { id: 'comp_2', type: 'motor', x: 20, y: 270, props: { address: 'O:0/0', label: 'Infeed Motor' } },
                    { id: 'comp_3', type: 'photo_sensor', x: 260, y: 200, props: { address: 'I:0/3', label: 'Color Sensor' } },
                    { id: 'comp_4', type: 'pneumatic_cyl', x: 380, y: 200, props: { address: 'O:0/1', label: 'Diverter A' } },
                    { id: 'comp_5', type: 'pneumatic_cyl', x: 520, y: 200, props: { address: 'O:0/2', label: 'Diverter B' } },
                    { id: 'comp_6', type: 'conveyor', x: 380, y: 380, props: { address: '', label: 'Bin A Conv', speed: 1, length: 2 } },
                    { id: 'comp_7', type: 'conveyor', x: 520, y: 380, props: { address: '', label: 'Bin B Conv', speed: 1, length: 2 } },
                    { id: 'comp_8', type: 'counter_ctu', x: 700, y: 200, props: { label: 'Sort Count', preset: 100 } },
                    { id: 'comp_9', type: 'indicator_light', x: 700, y: 300, props: { address: 'O:0/7', label: 'Status', color: 'green' } },
                    { id: 'comp_10', type: 'limit_switch', x: 20, y: 180, props: { address: 'I:0/1', label: 'Start' } },
                ],
                wires: [
                    { fromComp: 'comp_2', fromPort: 'running', toComp: 'comp_1', toPort: 'motor' },
                    { fromComp: 'comp_10', fromPort: 'out', toComp: 'comp_2', toPort: 'run' },
                    { fromComp: 'comp_3', fromPort: 'out', toComp: 'comp_4', toPort: 'extend' },
                    { fromComp: 'comp_3', fromPort: 'out', toComp: 'comp_8', toPort: 'count' }
                ]
            },
            mixing_process: {
                version: 1,
                components: [
                    { id: 'comp_1', type: 'tank', x: 100, y: 100, props: { address: '', label: 'Feed Tank', capacity: 100, fillRate: 10, drainRate: 8 } },
                    { id: 'comp_2', type: 'pump', x: 100, y: 320, props: { address: 'O:0/0', label: 'Feed Pump' } },
                    { id: 'comp_3', type: 'solenoid_valve', x: 260, y: 120, props: { address: 'O:0/1', label: 'Inlet Valve' } },
                    { id: 'comp_4', type: 'tank', x: 400, y: 100, props: { address: '', label: 'Mix Tank', capacity: 200, fillRate: 8, drainRate: 6 } },
                    { id: 'comp_5', type: 'mixer', x: 400, y: 320, props: { address: 'O:0/2', label: 'Agitator' } },
                    { id: 'comp_6', type: 'temp_sensor', x: 540, y: 120, props: { address: 'I:0/3', label: 'Temp' } },
                    { id: 'comp_7', type: 'heater', x: 540, y: 240, props: { address: 'O:0/3', label: 'Heater' } },
                    { id: 'comp_8', type: 'solenoid_valve', x: 540, y: 340, props: { address: 'O:0/4', label: 'Outlet Valve' } },
                    { id: 'comp_9', type: 'level_sensor', x: 260, y: 240, props: { address: 'I:0/4', label: 'Feed Level' } },
                    { id: 'comp_10', type: 'level_sensor', x: 660, y: 120, props: { address: 'I:0/5', label: 'Mix Level' } },
                    { id: 'comp_11', type: 'gauge', x: 660, y: 240, props: { label: 'Temp Gauge', min: 0, max: 200, unit: '°C' } },
                    { id: 'comp_12', type: 'indicator_light', x: 660, y: 340, props: { address: 'O:0/7', label: 'Ready', color: 'green' } },
                    { id: 'comp_13', type: 'gauge', x: 200, y: 320, props: { label: 'Feed Lvl', min: 0, max: 100, unit: '%' } },
                    { id: 'comp_14', type: 'gauge', x: 500, y: 320, props: { label: 'Mix Lvl', min: 0, max: 200, unit: '%' } },
                ],
                wires: [
                    { fromComp: 'comp_1', fromPort: 'level', toComp: 'comp_13', toPort: 'value' },
                    { fromComp: 'comp_3', fromPort: 'state', toComp: 'comp_4', toPort: 'inlet' },
                    { fromComp: 'comp_4', fromPort: 'level', toComp: 'comp_14', toPort: 'value' },
                    { fromComp: 'comp_6', fromPort: 'out', toComp: 'comp_11', toPort: 'value' }
                ]
            }
        };
    }

    // ── Save / Load ──────────────────────────────────────────────
    saveLayout() {
        const json = this.editor.exportLayout();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `plc-layout-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    // ── Alarms Display ───────────────────────────────────────────
    updateAlarmsDisplay() {
        const list = document.getElementById('alarms-list');
        if (!list) return;
        const active = this.alarms.getActiveAlarms();
        if (active.length === 0) {
            list.innerHTML = '<div class="no-alarms">No active alarms</div>';
        } else {
            list.innerHTML = active.map(a => `
                <div class="alarm-item">
                    <span class="alarm-time">${new Date(a.timestamp).toLocaleTimeString()}</span>
                    <span class="alarm-message">${a.message}</span>
                    <button class="alarm-clear" onclick="app.clearAlarm('${a.id}')">Clear</button>
                </div>`).join('');
        }
    }

    clearAlarm(id) { this.alarms.clearAlarm(id); this.updateAlarmsDisplay(); }

    // ── Backend / Telemetry (preserved from original) ────────────
    buildDefaultAnalysis() {
        return {
            processAnomaly: false, networkAlert: false,
            processScore: 0, networkScore: 0, modelConfidence: 100,
            processComponents: {}, networkComponents: {},
            riskLevel: 'low', recommendedAction: 'Continue baseline monitoring.',
            modelVersion: 'hybrid-vision-signal-v2',
            processSource: 'telemetry', networkSource: 'telemetry',
            securityFlag: false, visionAnomalyScore: 0, visionDefectFlag: false,
            visionInferenceMs: 0, scanTimeMs: 0, reasons: []
        };
    }

    buildScenarioProfiles() {
        return {
            normal: { label: 'Normal Baseline', productionRateFactor: 1, rejectRateOffset: 0, minInflightBottles: 0, networkPacketRate: 130, networkBurstRatio: 0.2, unauthorizedAttempts: 0 },
            process_drift: { label: 'Process Drift', productionRateFactor: 0.45, rejectRateOffset: 14, minInflightBottles: 8, networkPacketRate: 136, networkBurstRatio: 0.35, unauthorizedAttempts: 0 },
            network_attack: { label: 'Network Attack', productionRateFactor: 0.95, rejectRateOffset: 1.5, minInflightBottles: 2, networkPacketRate: 235, networkBurstRatio: 0.94, unauthorizedAttempts: 2 },
            combined: { label: 'Combined Incident', productionRateFactor: 0.4, rejectRateOffset: 18, minInflightBottles: 10, networkPacketRate: 245, networkBurstRatio: 0.97, unauthorizedAttempts: 3 }
        };
    }

    connectEventStream() {
        this.telemetry.connectEventStream(
            (event) => this.handleStreamEvent(event),
            () => this.handleStreamError()
        );
        this.eventStreamConnected = true;
        this.updateStreamStatus(true);
    }

    disconnectEventStream() {
        this.telemetry.disconnectEventStream();
        this.eventStreamConnected = false;
        this.updateStreamStatus(false);
    }

    handleStreamEvent(event) {
        if (!event || typeof event.id === 'undefined') return;
        const eventId = Number(event.id);
        if (eventId > this.lastStreamEventId) this.lastStreamEventId = eventId;
        this.updateStreamStatus(true);
        if (Boolean(event.process_anomaly) || Boolean(event.network_alert)) {
            this.pushDetectionEvent({
                processAnomaly: Boolean(event.process_anomaly),
                networkAlert: Boolean(event.network_alert),
                processScore: Number(event.process_score || 0),
                networkScore: Number(event.network_score || 0),
                riskLevel: String(event.risk_level || 'low'),
                reasons: Array.isArray(event.reasons) ? event.reasons : []
            });
        }
    }

    handleStreamError() { this.updateStreamStatus(false); }

    updateStreamStatus(connected) {
        const el = document.getElementById('stream-status');
        if (!el) return;
        el.textContent = connected ? 'LIVE' : 'OFF';
        el.className = connected ? 'status-value backend-online' : 'status-value backend-offline';
    }

    startBackendHealthChecks() {
        const check = async () => {
            const health = await this.telemetry.checkHealth();
            this.updateBackendStatus(health.ok);
            if (health.ok && !this.backendOnline) this.consecutiveFailures = 0;
        };
        check();
        this.backendHealthInterval = setInterval(check, 4000);
    }

    startTelemetryLoop() {
        const schedule = () => {
            const backoffMs = Math.min(1000 * Math.pow(1.5, this.consecutiveFailures), this.maxBackoffMs);
            const intervalMs = this.consecutiveFailures > 0 ? backoffMs : 1000;
            this.telemetryInterval = setTimeout(async () => { await this.runTelemetryCycle(); schedule(); }, intervalMs);
        };
        this.runTelemetryCycle().then(() => schedule());
    }

    async runTelemetryCycle() {
        if (!this.isRunning || this.pendingAnalyzeRequest) return;
        this.pendingAnalyzeRequest = true;
        try {
            const startedAt = performance.now();
            const payload = this.buildAnalysisPayload();
            const analysis = await this.telemetry.analyze(payload);
            const latencyMs = Math.round(performance.now() - startedAt);

            this.latestAnalysis = {
                processAnomaly: Boolean(analysis.process_anomaly),
                networkAlert: Boolean(analysis.network_alert),
                processScore: Number(analysis.process_score || 0),
                networkScore: Number(analysis.network_score || 0),
                modelConfidence: Number(analysis.model_confidence || 0),
                processComponents: analysis.process_components || {},
                networkComponents: analysis.network_components || {},
                riskLevel: String(analysis.risk_level || 'low'),
                recommendedAction: String(analysis.recommended_action || 'Continue baseline monitoring.'),
                modelVersion: String(analysis.model_version || 'hybrid-vision-signal-v2'),
                processSource: String(analysis.process_source || 'telemetry'),
                networkSource: String(analysis.network_source || 'telemetry'),
                securityFlag: Boolean(analysis.security_flag),
                visionAnomalyScore: Number(analysis.vision_anomaly_score || 0),
                visionDefectFlag: Boolean(analysis.vision_defect_flag),
                visionInferenceMs: Number(analysis.vision_inference_ms || 0),
                scanTimeMs: Number(analysis.scan_time_ms || 0),
                reasons: Array.isArray(analysis.reasons) ? analysis.reasons : []
            };
            this.consecutiveFailures = 0;
            this.recordAnalysisStats(latencyMs, this.latestAnalysis.processAnomaly || this.latestAnalysis.networkAlert);
            if (this.latestAnalysis.processAnomaly) this.alarms.addAlarm('PROCESS_ANOMALY', 'AI detected process anomaly', 'critical');
            else this.alarms.clearAlarm('PROCESS_ANOMALY');
            if (this.latestAnalysis.networkAlert) this.alarms.addAlarm('NETWORK_ALERT', 'Network anomaly detected', 'critical');
            else this.alarms.clearAlarm('NETWORK_ALERT');
            this.pushDetectionEvent(this.latestAnalysis);
            this.updateBackendStatus(true);
        } catch (error) {
            this.consecutiveFailures += 1;
            this.updateBackendStatus(false);
        } finally {
            this.pendingAnalyzeRequest = false;
        }
    }

    buildAnalysisPayload() {
        const io = this.plc.getIOState();
        const metrics = this.engine.getProductionMetrics();
        const scenario = this.scenarios[this.activeScenarioKey] || this.scenarios.normal;
        return {
            timestamp: new Date().toISOString(),
            production_count: 0, production_rate: 0, reject_rate: 0,
            conveyor_running: io.outputs[0],
            bottle_at_filler: io.inputs[3], bottle_at_capper: io.inputs[4], bottle_at_quality: io.inputs[5],
            in_flight_bottles: Math.max(metrics.activeSensors, scenario.minInflightBottles),
            output_alarm_horn: io.outputs[5], output_reject_gate: io.outputs[4],
            scan_time_ms: this.plc.cycleTime,
            network_packet_rate: scenario.networkPacketRate + (Math.random() * 8 - 4),
            network_burst_ratio: Math.min(1, Math.max(0, scenario.networkBurstRatio + (Math.random() * 0.04 - 0.02))),
            network_unauthorized_attempts: Math.max(0, scenario.unauthorizedAttempts + (Math.random() < 0.25 ? 1 : 0))
        };
    }

    setScenario(key) {
        if (!this.scenarios[key]) return;
        this.activeScenarioKey = key;
        const el = document.getElementById('active-scenario');
        if (el) el.textContent = this.scenarios[key].label;
        document.querySelectorAll('.scenario-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.scenario === key);
        });
    }

    recordAnalysisStats(latencyMs, hasAlert) {
        this.analysisStats.totalRuns += 1;
        if (hasAlert) this.analysisStats.anomalyRuns += 1;
        this.analysisStats.latencySamples.push(latencyMs);
        if (this.analysisStats.latencySamples.length > 120) this.analysisStats.latencySamples.shift();
    }

    updateSessionKpis() {
        const total = this.analysisStats.totalRuns;
        const hitRate = total > 0 ? Math.round((this.analysisStats.anomalyRuns / total) * 100) : 0;
        const latencyAvg = this.analysisStats.latencySamples.length > 0
            ? Math.round(this.analysisStats.latencySamples.reduce((s, v) => s + v, 0) / this.analysisStats.latencySamples.length) : 0;
        const setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        setT('analysis-count', String(total));
        setT('anomaly-hit-rate', `${hitRate}%`);
        setT('avg-inference-latency', `${latencyAvg} ms`);
    }

    updateExplainabilityPanel() {
        const setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        setT('model-version', this.latestAnalysis.modelVersion);
        const riskEl = document.getElementById('risk-level');
        if (riskEl) { const l = String(this.latestAnalysis.riskLevel || 'low').toLowerCase(); riskEl.textContent = l.toUpperCase(); riskEl.className = `risk-pill risk-${l}`; }
        setT('recommended-action', this.latestAnalysis.recommendedAction);
        setT('process-source', this.latestAnalysis.processSource);
        setT('network-source', this.latestAnalysis.networkSource);
        setT('vision-inference-ms', `${Math.round(this.latestAnalysis.visionInferenceMs || 0)} ms`);
        setT('security-flag', this.latestAnalysis.securityFlag ? 'TRIGGERED' : 'CLEAR');
        this.renderComponents('process-components', this.latestAnalysis.processComponents);
        this.renderComponents('network-components', this.latestAnalysis.networkComponents);
    }

    renderComponents(containerId, components = {}) {
        const c = document.getElementById(containerId);
        if (!c) return;
        const entries = Object.entries(components || {});
        if (entries.length === 0) { c.innerHTML = '<div class="component-empty">No active contributors</div>'; return; }
        c.innerHTML = entries.sort((a, b) => Number(b[1]) - Number(a[1])).map(([label, value]) => {
            const v = Math.max(0, Math.min(100, Number(value) || 0));
            return `<div class="component-item"><div class="component-label-row"><span>${label}</span><strong>${v.toFixed(1)}</strong></div><div class="component-track"><div class="component-fill" style="width:${v}%"></div></div></div>`;
        }).join('');
    }

    updateBackendStatus(isOnline) {
        this.backendOnline = isOnline;
        const el = document.getElementById('backend-status');
        if (!el) return;
        el.textContent = isOnline ? 'ONLINE' : 'OFFLINE';
        el.className = isOnline ? 'status-value backend-online' : 'status-value backend-offline';
    }

    pushDetectionEvent(analysis) {
        if (!analysis.processAnomaly && !analysis.networkAlert) return;
        this.detectionFeed.unshift({
            timestamp: Date.now(),
            processAnomaly: analysis.processAnomaly, networkAlert: analysis.networkAlert,
            processScore: analysis.processScore, networkScore: analysis.networkScore,
            riskLevel: analysis.riskLevel,
            scenario: this.scenarios[this.activeScenarioKey]?.label || 'Normal Baseline',
            reason: (analysis.reasons || []).length ? analysis.reasons.join(' | ') : 'No reason provided'
        });
        if (this.detectionFeed.length > 20) this.detectionFeed.length = 20;
    }

    updateDetectionFeed() {
        const feed = document.getElementById('detection-feed');
        if (!feed) return;
        if (this.detectionFeed.length === 0) {
            feed.innerHTML = '<div class="no-alarms">No anomaly or security events</div>';
            return;
        }
        feed.innerHTML = this.detectionFeed.map(entry => {
            const tags = [];
            if (entry.processAnomaly) tags.push('PROCESS');
            if (entry.networkAlert) tags.push('NETWORK');
            return `<div class="feed-item">
                <span class="alarm-time">${new Date(entry.timestamp).toLocaleTimeString()}</span>
                <span class="feed-tags">${tags.join('+')}</span>
                <span class="feed-message">[${String(entry.riskLevel || 'low').toUpperCase()}] ${entry.scenario} | P:${Math.round(entry.processScore)} N:${Math.round(entry.networkScore)} - ${entry.reason}</span>
            </div>`;
        }).join('');
    }

    exportDemoReport() {
        const report = {
            exported_at: new Date().toISOString(),
            scenario: this.scenarios[this.activeScenarioKey]?.label || 'Normal Baseline',
            layout: this.engine.serialize(),
            kpis: {
                total_analyses: this.analysisStats.totalRuns,
                anomaly_runs: this.analysisStats.anomalyRuns,
                anomaly_hit_rate_percent: this.analysisStats.totalRuns ? Number(((this.analysisStats.anomalyRuns / this.analysisStats.totalRuns) * 100).toFixed(2)) : 0,
                avg_inference_latency_ms: this.analysisStats.latencySamples.length ? Number((this.analysisStats.latencySamples.reduce((s, v) => s + v, 0) / this.analysisStats.latencySamples.length).toFixed(2)) : 0
            },
            latest_analysis: this.latestAnalysis,
            recent_detection_events: this.detectionFeed.slice(0, 10)
        };
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `plc-emulator-report-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }
}

// Alarm Management System (unchanged)
class AlarmManager {
    constructor() { this.alarms = new Map(); this.alarmHistory = []; }
    addAlarm(id, message, severity = 'warning') {
        const alarm = { id, message, severity, timestamp: Date.now(), acknowledged: false };
        this.alarms.set(id, alarm);
        this.alarmHistory.push(alarm);
        if (severity !== 'critical') setTimeout(() => this.acknowledgeAlarm(id), 10000);
    }
    clearAlarm(id) { this.alarms.delete(id); }
    acknowledgeAlarm(id) { const a = this.alarms.get(id); if (a) a.acknowledged = true; }
    clearAllAlarms() { this.alarms.clear(); }
    getActiveAlarms() { return Array.from(this.alarms.values()); }
    getAlarmHistory() { return this.alarmHistory; }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    window.app = new PLCEmulatorApp();

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 's': e.preventDefault(); if (window.app.isRunning) window.app.stop(); else window.app.start(); break;
                case 'r': e.preventDefault(); window.app.reset(); break;
                case 'e': e.preventDefault(); window.app.emergencyStop(); break;
            }
        }
    });

    console.log('PLC Factory Emulator initialized');
    console.log('Drag components from palette → drop on canvas → connect ports → switch to Simulate mode');
});
