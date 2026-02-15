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
            this.failureEngine = new FailureEngine();
            this.stationManager = new StationManager();
            this.scanDebugger = null; // initialized in initScanDebugger after DOM ready
            this.trainingEngine = new TrainingEngine();

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
            this.failureImpactBuffer = [];

            // LSTM anomaly detection state
            this.anomalyState = {
                modelLoaded: false, modelVersion: 'not_loaded',
                lastResult: null, scoreHistory: [],
                backendUrl: 'http://localhost:8001',
            };

            this.initPalette();
            this.initEditorCallbacks();
            this.initEventListeners();
            this.initAttackPanel();
            this.initFailurePanel();
            this.initStationPanel();
            this.initScanDebugger();
            this.initTrainingPanel();
            this.initPLCCallbacks();
            this.buildIODisplays();
            this.updateStatusBar();

            this.startBackendHealthChecks();
            this.startTelemetryLoop();
            this.connectEventStream();
            this.initAnomalyDetection();

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

    // ── Failure Injection Panel ─────────────────────────────────
    initFailurePanel() {
        const listEl = document.getElementById('failure-list');
        if (!listEl) return;

        for (const [id, def] of this.failureEngine.failures) {
            const item = document.createElement('div');
            item.className = 'failure-item';
            item.dataset.failureId = id;
            item.dataset.category = def.category;
            item.innerHTML = `
                <div class="failure-item-header">
                    <span class="failure-item-name">${def.icon} ${def.name}</span>
                    <button class="failure-toggle" data-failure-id="${id}"></button>
                </div>
                <div class="failure-item-meta">
                    <span class="failure-cat-badge">${def.category}</span>
                    <span class="failure-severity severity-${def.severity}">${def.severity}</span>
                </div>
                <div class="failure-item-desc">${def.description}</div>
                <div class="failure-severity-slider">
                    <label>Severity</label>
                    <input type="range" min="10" max="100" value="80" data-failure-id="${id}">
                    <span class="failure-severity-val">80%</span>
                </div>`;
            listEl.appendChild(item);
        }

        // Toggle failure on/off
        listEl.addEventListener('click', (e) => {
            const toggleBtn = e.target.closest('.failure-toggle');
            if (!toggleBtn) return;
            const failureId = toggleBtn.dataset.failureId;
            const item = toggleBtn.closest('.failure-item');
            if (this.failureEngine.isActive(failureId)) {
                this.failureEngine.deactivateFailure(failureId);
                toggleBtn.classList.remove('on');
                item.classList.remove('active');
            } else {
                const slider = item.querySelector('input[type="range"]');
                const severity = slider ? parseInt(slider.value) / 100 : 0.8;
                this.failureEngine.activateFailure(failureId, severity);
                toggleBtn.classList.add('on');
                item.classList.add('active');
            }
            this.updateFailureStatus();
        });

        // Severity slider
        listEl.addEventListener('input', (e) => {
            if (e.target.type !== 'range') return;
            const failureId = e.target.dataset.failureId;
            const val = parseInt(e.target.value);
            const label = e.target.parentElement.querySelector('.failure-severity-val');
            if (label) label.textContent = val + '%';
            if (this.failureEngine.isActive(failureId)) {
                this.failureEngine.activeFailures.get(failureId).severity = val / 100;
            }
        });

        // Category filter
        document.querySelectorAll('.failure-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.failure-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const filter = btn.dataset.filter;
                listEl.querySelectorAll('.failure-item').forEach(item => {
                    item.style.display = (filter === 'all' || item.dataset.category === filter) ? '' : 'none';
                });
            });
        });

        // Reset all failures
        const resetBtn = document.getElementById('failure-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.failureEngine.reset();
                listEl.querySelectorAll('.failure-item').forEach(item => {
                    item.classList.remove('active');
                    item.querySelector('.failure-toggle').classList.remove('on');
                    const slider = item.querySelector('input[type="range"]');
                    if (slider) { slider.value = 80; }
                    const label = item.querySelector('.failure-severity-val');
                    if (label) label.textContent = '80%';
                });
                this.failureImpactBuffer = [];
                this.updateFailureStatus();
                this.updateFailureImpactFeed();
            });
        }

        // Wire failure engine callback
        this.failureEngine.onImpact = (impacts) => {
            this.failureImpactBuffer = impacts.slice(-20).concat(this.failureImpactBuffer).slice(0, 40);
            this.updateFailureImpactFeed();
            this.updateFailureStatus();
        };
    }

    updateFailureStatus() {
        const el = document.getElementById('failure-status');
        if (!el) return;
        const count = this.failureEngine.activeFailures.size;
        if (count === 0) {
            el.textContent = 'No failures active';
            el.classList.remove('active');
        } else {
            el.textContent = `${count} failure${count > 1 ? 's' : ''} active`;
            el.classList.add('active');
        }
        const countEl = document.getElementById('failure-active-count');
        if (countEl) countEl.textContent = count;
        const impactEl = document.getElementById('failure-impact-count');
        if (impactEl) impactEl.textContent = this.failureEngine.impactLog.length;
        const compEl = document.getElementById('failure-comp-count');
        if (compEl) {
            const affectedComps = new Set(this.failureImpactBuffer.map(i => i.compId));
            compEl.textContent = affectedComps.size;
        }
    }

    updateFailureImpactFeed() {
        const el = document.getElementById('failure-impact-feed');
        if (!el) return;
        if (this.failureImpactBuffer.length === 0) {
            el.innerHTML = '<div class="no-alarms">No failure impacts</div>';
            return;
        }
        el.innerHTML = this.failureImpactBuffer.slice(0, 20).map(imp => {
            const effectStr = Object.entries(imp).filter(([k]) =>
                !['failureId','failureName','compId','compType','compLabel','severity','timestamp','effect'].includes(k)
            ).map(([k,v]) => `${k}:${v}`).join(' ');
            const time = new Date(imp.timestamp).toLocaleTimeString('en', {hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
            return `<div class="failure-impact-item">
                <span class="fi-comp">${imp.compLabel}</span>
                <span class="fi-failure">${imp.failureName}</span>
                <span class="fi-effect">${imp.effect}${effectStr ? ' ' + effectStr : ''}</span>
                <span class="fi-time">${time}</span>
            </div>`;
        }).join('');
    }

    // ── Station Panel ──────────────────────────────────────────
    initStationPanel() {
        // Wire station manager update callback for periodic UI refresh
        this.stationManager.onUpdate = (stations) => {
            // Throttle UI updates to every 10th tick
            if (this.stationManager.tickCount % 10 !== 0) return;
            this.updateStationUI();
        };
    }

    updateStationUI() {
        const stats = this.stationManager.getStats();
        const oee = this.stationManager.getOEE();

        const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setT('station-running-count', stats.running);
        setT('station-idle-count', stats.idle);
        setT('station-faulted-count', stats.faulted);
        setT('station-total-cycles', stats.totalCycles);
        setT('station-availability', oee.availability + '%');
        setT('station-performance', oee.performance + '%');

        const oeeBadge = document.getElementById('station-oee-badge');
        if (oeeBadge) oeeBadge.textContent = 'OEE: ' + oee.oee + '%';
        const countBadge = document.getElementById('station-count-badge');
        if (countBadge) countBadge.textContent = stats.total + ' station' + (stats.total !== 1 ? 's' : '');

        // Update individual station cards
        const stations = this.stationManager.getAll();
        for (const station of stations) {
            const card = document.getElementById('scard-' + station.id);
            if (!card) continue;

            // Update status class
            card.className = 'station-card ' + station.status;

            // Update status badge
            const statusEl = card.querySelector('.station-card-status');
            if (statusEl) {
                statusEl.textContent = station.status;
                statusEl.className = 'station-card-status ' + station.status;
            }

            // Update KPIs
            const kpiEls = card.querySelectorAll('.station-kpi-value');
            if (kpiEls.length >= 4) {
                kpiEls[0].textContent = station.metrics.cyclesCompleted;
                const avgCT = station.metrics.avgCycleTime;
                kpiEls[1].textContent = avgCT > 0 ? (avgCT / 1000).toFixed(1) + 's' : '—';
                const eff = Math.round(station.metrics.efficiency);
                kpiEls[2].textContent = eff + '%';
                kpiEls[2].className = 'station-kpi-value ' + (eff >= 90 ? 'good' : eff >= 70 ? 'warn' : 'bad');
                const up = Math.round(station.metrics.uptime * 10) / 10;
                kpiEls[3].textContent = up + '%';
                kpiEls[3].className = 'station-kpi-value ' + (up >= 95 ? 'good' : up >= 80 ? 'warn' : 'bad');
            }

            // Update faults
            const faultEl = card.querySelector('.station-card-faults');
            if (faultEl) {
                if (station.faults.length > 0) {
                    faultEl.style.display = '';
                    faultEl.innerHTML = station.faults.map(f =>
                        `<span>⚠ ${f.compLabel}: ${f.fault}</span>`
                    ).join('');
                } else {
                    faultEl.style.display = 'none';
                }
            }
        }
    }

    renderStationCards() {
        const container = document.getElementById('station-cards');
        if (!container) return;

        const stations = this.stationManager.getAll();
        if (stations.length === 0) {
            container.innerHTML = '<div class="no-alarms">No stations detected</div>';
            return;
        }

        container.innerHTML = stations.map(station => {
            const compCount = station.componentIds.size;
            const inCount = station.inputs.length;
            const outCount = station.outputs.length;
            return `<div class="station-card ${station.status}" id="scard-${station.id}">
                <div class="station-card-header">
                    <span class="station-card-name">${station.icon} ${station.name}</span>
                    <span class="station-card-status ${station.status}">${station.status}</span>
                </div>
                <div class="station-card-meta">
                    ${compCount} components · ${inCount} in · ${outCount} out
                </div>
                <div class="station-card-kpis">
                    <div class="station-kpi">
                        <span class="station-kpi-label">Cycles</span>
                        <span class="station-kpi-value">0</span>
                    </div>
                    <div class="station-kpi">
                        <span class="station-kpi-label">Avg Time</span>
                        <span class="station-kpi-value">—</span>
                    </div>
                    <div class="station-kpi">
                        <span class="station-kpi-label">Efficiency</span>
                        <span class="station-kpi-value good">100%</span>
                    </div>
                    <div class="station-kpi">
                        <span class="station-kpi-label">Uptime</span>
                        <span class="station-kpi-value good">100%</span>
                    </div>
                </div>
                <div class="station-card-faults" style="display:none"></div>
            </div>`;
        }).join('');

        // Update summary counts
        this.updateStationUI();
    }

    // ── Scan Cycle Debugger ─────────────────────────────────────
    initScanDebugger() {
        this.scanDebugger = new ScanDebugger('scan-timeline-canvas', 'scan-rung-canvas');

        // Wire PLC scan complete to push data into debugger
        this.plc.onScanComplete.push(() => {
            const rec = this.plc.lastScanRecord;
            if (!rec) return;
            this.scanDebugger.pushScan(rec);

            // Throttle rendering to every 5th scan
            if (rec.scanNumber % 5 === 0) {
                this.scanDebugger.render();
                this.updateScanStats();
            }
        });

        // Pause / Resume
        const pauseBtn = document.getElementById('scan-pause-btn');
        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => {
                const paused = this.scanDebugger.togglePause();
                pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause';
                pauseBtn.classList.toggle('active', paused);
            });
        }

        // Clear
        const clearBtn = document.getElementById('scan-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.scanDebugger.clear();
                this.scanDebugger.render();
                this.updateScanStats();
            });
        }
    }

    updateScanStats() {
        const stats = this.scanDebugger.getStats();
        const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setT('scan-rate-badge', stats.scanRate.toFixed(1) + ' scans/s');
        setT('scan-avg-badge', 'avg: ' + stats.avgTotalUs.toFixed(0) + 'µs');
        setT('scan-max-badge', 'max: ' + stats.maxTotalUs.toFixed(0) + 'µs');
    }

    // ── Training Scenario Panel ─────────────────────────────────
    initTrainingPanel() {
        const listEl = document.getElementById('training-scenario-list');
        if (!listEl) return;

        // Build scenario cards
        for (const [id, def] of this.trainingEngine.scenarios) {
            const stars = Array.from({ length: 5 }, (_, i) =>
                `<span class="star${i < def.difficulty ? '' : ' empty'}">${i < def.difficulty ? '★' : '☆'}</span>`
            ).join('');
            const timeMins = def.timeLimit ? Math.round(def.timeLimit / 60000) : '∞';

            const card = document.createElement('div');
            card.className = 'training-scenario-card';
            card.dataset.scenarioId = id;
            card.dataset.category = def.category;
            card.innerHTML = `
                <div class="training-scenario-card-header">
                    <span class="training-scenario-card-title">${def.icon} ${def.title}</span>
                    <div class="training-difficulty">${stars}</div>
                </div>
                <div class="training-scenario-card-meta">
                    <span class="training-cat-badge">${def.category}</span>
                    <span class="training-time-badge">${timeMins} min</span>
                    <span class="training-time-badge">${def.objectives.length} objectives</span>
                </div>
                <div class="training-scenario-card-desc">${def.description}</div>
                <button class="training-scenario-card-start" data-scenario-id="${id}">▶ Start Challenge</button>`;
            listEl.appendChild(card);
        }

        // Start scenario
        listEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.training-scenario-card-start');
            if (!btn) return;
            const scenarioId = btn.dataset.scenarioId;
            this._startTrainingScenario(scenarioId);
        });

        // Category filter
        document.querySelectorAll('.training-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.training-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const filter = btn.dataset.filter;
                listEl.querySelectorAll('.training-scenario-card').forEach(card => {
                    card.style.display = (filter === 'all' || card.dataset.category === filter) ? '' : 'none';
                });
            });
        });

        // Stop button
        const stopBtn = document.getElementById('training-stop-btn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                this.trainingEngine.stopScenario(this);
                this._showTrainingSelector();
            });
        }

        // Hint button
        const hintBtn = document.getElementById('training-hint-btn');
        if (hintBtn) {
            hintBtn.addEventListener('click', () => {
                const hint = this.trainingEngine.getHint();
                const display = document.getElementById('training-hint-display');
                const countEl = document.getElementById('training-hint-count');
                if (hint && display) {
                    display.style.display = '';
                    display.textContent = hint;
                }
                if (countEl) {
                    const remaining = (this.trainingEngine.activeScenario?.hints?.length || 0) - this.trainingEngine.hintsUsed;
                    countEl.textContent = remaining > 0 ? `${remaining} hint${remaining > 1 ? 's' : ''} left (-${this.trainingEngine.hintPenalty}pts each)` : 'No hints left';
                }
            });
        }

        // Back to scenarios button
        const backBtn = document.getElementById('training-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => this._showTrainingSelector());
        }

        // Wire engine callbacks
        this.trainingEngine.onStateChange = (state) => this._updateTrainingStatus(state);
        this.trainingEngine.onObjectiveUpdate = (objs) => this._renderTrainingObjectives(objs);
        this.trainingEngine.onComplete = (result) => this._showTrainingSummary(result);

        // Timer update interval
        this._trainingTimerHandle = setInterval(() => {
            if (this.trainingEngine.state !== 'running') return;
            const remaining = this.trainingEngine.getTimeRemaining();
            const timerEl = document.getElementById('training-timer');
            if (timerEl && remaining !== null) {
                const secs = Math.ceil(remaining / 1000);
                const m = Math.floor(secs / 60);
                const s = secs % 60;
                timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
                timerEl.classList.toggle('urgent', secs < 30);
            }
        }, 250);
    }

    _startTrainingScenario(scenarioId) {
        this.trainingEngine.startScenario(scenarioId, this);

        // Show overlay, hide selector and summary
        const selector = document.getElementById('training-selector');
        const overlay = document.getElementById('training-overlay');
        const summary = document.getElementById('training-summary');
        const stopBtn = document.getElementById('training-stop-btn');
        if (selector) selector.style.display = 'none';
        if (overlay) overlay.style.display = '';
        if (summary) summary.style.display = 'none';
        if (stopBtn) stopBtn.style.display = '';

        // Set title
        const titleEl = document.getElementById('training-active-title');
        if (titleEl) {
            const def = this.trainingEngine.activeScenario;
            titleEl.textContent = `${def.icon} ${def.title}`;
        }

        // Reset hint display
        const hintDisplay = document.getElementById('training-hint-display');
        if (hintDisplay) hintDisplay.style.display = 'none';
        const hintCount = document.getElementById('training-hint-count');
        if (hintCount) {
            const total = this.trainingEngine.activeScenario?.hints?.length || 0;
            hintCount.textContent = `${total} hint${total > 1 ? 's' : ''} available (-${this.trainingEngine.hintPenalty}pts each)`;
        }

        // Render initial objectives
        this._renderTrainingObjectives(this.trainingEngine.objectiveResults);
    }

    _renderTrainingObjectives(objectives) {
        const container = document.getElementById('training-objectives');
        if (!container) return;
        container.innerHTML = objectives.map(obj =>
            `<div class="training-objective${obj.completed ? ' completed' : ''}">
                <div class="training-obj-check">${obj.completed ? '✓' : ''}</div>
                <span class="training-obj-text">${obj.text}</span>
                <span class="training-obj-points">${obj.points}pts</span>
            </div>`
        ).join('');
    }

    _updateTrainingStatus(state) {
        const badge = document.getElementById('training-status-badge');
        if (!badge) return;
        badge.className = 'training-status-badge';
        if (state === 'running') {
            badge.textContent = 'Challenge Active';
            badge.classList.add('active');
        } else if (state === 'completed') {
            badge.textContent = 'Completed!';
            badge.classList.add('completed');
        } else if (state === 'failed') {
            badge.textContent = 'Time\'s Up!';
            badge.classList.add('failed');
        } else {
            badge.textContent = 'Select a scenario';
        }
    }

    _showTrainingSummary(result) {
        const overlay = document.getElementById('training-overlay');
        const summary = document.getElementById('training-summary');
        const stopBtn = document.getElementById('training-stop-btn');
        if (overlay) overlay.style.display = 'none';
        if (summary) summary.style.display = '';
        if (stopBtn) stopBtn.style.display = 'none';

        const headerEl = document.getElementById('training-summary-header');
        const scoreEl = document.getElementById('training-summary-score');
        const objEl = document.getElementById('training-summary-objectives');
        const detailsEl = document.getElementById('training-summary-details');

        const passed = result.score >= result.maxScore * 0.5;
        if (headerEl) {
            headerEl.textContent = passed ? '🎉 Challenge Complete!' : '💔 Challenge Failed';
            headerEl.className = 'training-summary-header ' + (passed ? 'completed' : 'failed');
        }
        if (scoreEl) scoreEl.textContent = `${result.score} / ${result.maxScore}`;
        if (objEl) {
            objEl.innerHTML = result.objectives.map(obj =>
                `<div class="training-summary-obj ${obj.completed ? 'done' : 'missed'}">
                    ${obj.completed ? '✅' : '❌'} ${obj.text} (${obj.points}pts)
                </div>`
            ).join('');
        }
        if (detailsEl) {
            const secs = Math.round(result.time / 1000);
            detailsEl.textContent = `Time: ${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')} · Hints used: ${result.hintsUsed}`;
        }
    }

    _showTrainingSelector() {
        const selector = document.getElementById('training-selector');
        const overlay = document.getElementById('training-overlay');
        const summary = document.getElementById('training-summary');
        const stopBtn = document.getElementById('training-stop-btn');
        if (selector) selector.style.display = '';
        if (overlay) overlay.style.display = 'none';
        if (summary) summary.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'none';
        this._updateTrainingStatus('idle');
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
        this.plc.onScanComplete.push(() => { });
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

        // Auto-force START switches so presets work immediately
        for (const comp of this.engine.getAllComponents()) {
            const def = this.registry.get(comp.type);
            if (!def || def.category !== 'sensors') continue;
            const label = (comp.props.label || '').toLowerCase();
            if (label.includes('start') || label === 'system start') {
                comp.state.forced = true;
            }
        }

        this.engine.onTick = (dt) => {
            // Sync: sensors → PLC inputs, PLC outputs → actuators
            this.engine.readSensorsToPLC(this.plc);
            this.engine.writePLCToActuators(this.plc);

            // Real-time attack simulation + packet analysis
            const analysis = this.attackSim.tick(this.engine, this.plc, dt);
            this.updatePacketLog(this.attackSim.packetLog.slice(-5));

            // Failure injection engine
            this.failureEngine.tick(this.engine, dt);

            // Station manager tick
            this.stationManager.tick(this.engine, dt);

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
        // Clear all forced sensor states
        for (const comp of this.engine.getAllComponents()) {
            if (comp.state) comp.state.forced = false;
        }
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
                    <button class="prop-btn-toggle ${val ? 'on' : 'off'}" id="prop-${key}">${val ? 'ON' : 'OFF'}</button></div>`;
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
                    <button class="prop-btn-toggle ${forced ? 'on' : 'off'}" id="prop-force">${forced ? 'ON' : 'OFF'}</button></div>`;
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
                <span class="prop-label" style="color:${port.type === 'input' ? '#3b82f6' : '#f59e0b'}">${port.type === 'input' ? '→' : '←'} ${port.label}</span>
                <span style="font-size:0.7rem;color:${connected ? '#22c55e' : '#475569'}">${connected ? 'Connected' : '—'}</span>
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
                    el.className = `prop-btn-toggle ${newVal ? 'on' : 'off'}`;
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
                forceEl.className = `prop-btn-toggle ${newVal ? 'on' : 'off'}`;
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

    // ── LSTM Anomaly Detection ─────────────────────────────────────
    initAnomalyDetection() {
        // Check backend anomaly status
        this.checkAnomalyModel();
        // Start anomaly scoring loop (every 500ms when simulation running)
        this.anomalyInterval = setInterval(() => {
            if (this.isRunning) this.sendAnomalyTelemetry();
        }, 500);
    }

    async checkAnomalyModel() {
        try {
            const resp = await fetch(`${this.anomalyState.backendUrl}/anomaly/status`, { signal: AbortSignal.timeout(2000) });
            if (!resp.ok) return;
            const data = await resp.json();
            this.anomalyState.modelLoaded = data.model_loaded;
            this.anomalyState.modelVersion = data.model_version || 'not_loaded';
            const badge = document.getElementById('anomaly-model-badge');
            if (badge) badge.textContent = data.model_loaded ? `Model: ${data.model_version}` : 'Model: not loaded';
        } catch { /* backend not running */ }
    }

    collectAnomalyTelemetry() {
        const io = this.plc.getIOState();
        const metrics = this.engine.getProductionMetrics();
        const analysis = this.latestAnalysis || {};
        return {
            conveyor_running: io.outputs[0] || false,
            production_rate: metrics.productionRate || 0,
            reject_rate: metrics.rejectRate || 0,
            in_flight_bottles: metrics.inFlightBottles || 0,
            bottle_at_filler: io.inputs[3] || false,
            bottle_at_capper: io.inputs[4] || false,
            bottle_at_quality: io.inputs[5] || false,
            output_alarm_horn: io.outputs[5] || false,
            output_reject_gate: io.outputs[4] || false,
            network_packet_rate: analysis.packetRate || 130,
            network_burst_ratio: analysis.burstRatio || 0,
            scan_time_ms: this.plc.cycleTime || 100,
            io_input_sum: io.inputs.filter(Boolean).length,
            io_output_sum: io.outputs.filter(Boolean).length,
        };
    }

    async sendAnomalyTelemetry() {
        const payload = this.collectAnomalyTelemetry();
        try {
            const resp = await fetch(`${this.anomalyState.backendUrl}/anomaly/score`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(2000),
            });
            if (!resp.ok) return;
            const result = await resp.json();
            this.anomalyState.lastResult = result;
            if (result.score_history) this.anomalyState.scoreHistory = result.score_history;
            this.renderAnomalyPanel(result);
        } catch { /* backend unavailable — render offline state */ }
    }

    renderAnomalyPanel(result) {
        const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

        // Score value + color
        const scoreEl = document.getElementById('anomaly-score-value');
        if (scoreEl) {
            scoreEl.textContent = result.anomaly_score.toFixed(1);
            scoreEl.className = 'anomaly-score-value ' +
                (result.anomaly_score >= 60 ? 'high' : result.anomaly_score >= 30 ? 'medium' : 'low');
        }

        // Stats
        setEl('anomaly-threshold', result.threshold ? result.threshold.toFixed(4) : '—');
        setEl('anomaly-inference-ms', `${result.inference_ms.toFixed(1)} ms`);
        setEl('anomaly-buffer-fill', `${Math.round(result.buffer_fill * 100)}%`);

        // Status badge
        const statusBadge = document.getElementById('anomaly-status-badge');
        if (statusBadge) {
            if (result.is_anomaly) {
                statusBadge.textContent = 'ANOMALY';
                statusBadge.className = 'anomaly-status-badge anomaly';
            } else if (result.anomaly_score > 25) {
                statusBadge.textContent = 'Warning';
                statusBadge.className = 'anomaly-status-badge warning';
            } else {
                statusBadge.textContent = 'Normal';
                statusBadge.className = 'anomaly-status-badge normal';
            }
        }

        // Verdict
        const verdict = document.getElementById('anomaly-verdict');
        if (verdict) {
            if (result.buffer_fill < 1) {
                verdict.textContent = `Buffering... ${Math.round(result.buffer_fill * 100)}%`;
                verdict.className = 'anomaly-verdict';
            } else if (result.is_anomaly) {
                const topAttack = Object.keys(result.attack_probabilities || {})[0] || 'unknown';
                verdict.textContent = `ANOMALY DETECTED — likely: ${topAttack.replace(/_/g, ' ')}`;
                verdict.className = 'anomaly-verdict anomaly';
            } else {
                verdict.textContent = 'System operating within normal baseline';
                verdict.className = 'anomaly-verdict normal';
            }
        }

        // Gauge canvas
        this.renderAnomalyGauge(result.anomaly_score);

        // History chart
        this.renderAnomalyHistory(result.score_history || this.anomalyState.scoreHistory);

        // Feature error bars
        this.renderFeatureErrors(result.feature_errors || {});

        // Attack probabilities
        this.renderAttackProbs(result.attack_probabilities || {});
    }

    renderAnomalyGauge(score) {
        const canvas = document.getElementById('anomaly-gauge-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const cx = w / 2, cy = h - 10, r = 80;
        const startAngle = Math.PI, endAngle = 2 * Math.PI;
        const scoreAngle = startAngle + (score / 100) * Math.PI;

        // Background arc
        ctx.beginPath(); ctx.arc(cx, cy, r, startAngle, endAngle);
        ctx.lineWidth = 14; ctx.strokeStyle = '#1e293b'; ctx.lineCap = 'round'; ctx.stroke();

        // Score arc with gradient
        if (score > 0.5) {
            const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
            grad.addColorStop(0, '#22c55e');
            grad.addColorStop(0.4, '#eab308');
            grad.addColorStop(0.7, '#f97316');
            grad.addColorStop(1, '#ef4444');
            ctx.beginPath(); ctx.arc(cx, cy, r, startAngle, scoreAngle);
            ctx.lineWidth = 14; ctx.strokeStyle = grad; ctx.lineCap = 'round'; ctx.stroke();
        }

        // Threshold marker
        if (this.anomalyState.lastResult) {
            const threshPct = Math.min(100, (this.anomalyState.lastResult.threshold / (this.anomalyState.lastResult.threshold * 2.5)) * 100);
            const threshAngle = startAngle + (threshPct / 100) * Math.PI;
            const tx = cx + (r + 12) * Math.cos(threshAngle);
            const ty = cy + (r + 12) * Math.sin(threshAngle);
            ctx.beginPath(); ctx.arc(tx, ty, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#f87171'; ctx.fill();
        }
    }

    renderAnomalyHistory(scores) {
        const canvas = document.getElementById('anomaly-history-canvas');
        if (!canvas || !scores.length) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width = canvas.clientWidth;
        const h = canvas.height = 180;
        ctx.clearRect(0, 0, w, h);

        const maxScore = Math.max(100, ...scores);
        const step = w / Math.max(scores.length - 1, 1);

        // Grid lines
        ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1;
        for (let y = 0; y <= 100; y += 25) {
            const py = h - 20 - (y / maxScore) * (h - 30);
            ctx.beginPath(); ctx.moveTo(30, py); ctx.lineTo(w, py); ctx.stroke();
            ctx.fillStyle = '#475569'; ctx.font = '9px monospace';
            ctx.fillText(y.toString(), 4, py + 3);
        }

        // Threshold line
        if (this.anomalyState.lastResult) {
            const threshPct = Math.min(100, (this.anomalyState.lastResult.threshold / (this.anomalyState.lastResult.threshold * 2.5)) * 100);
            const ty = h - 20 - (threshPct / maxScore) * (h - 30);
            ctx.strokeStyle = '#ef444480'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(30, ty); ctx.lineTo(w, ty); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#ef4444'; ctx.font = '8px monospace'; ctx.fillText('threshold', w - 50, ty - 3);
        }

        // Score line
        ctx.beginPath();
        scores.forEach((s, i) => {
            const x = 30 + i * step;
            const y = h - 20 - (s / maxScore) * (h - 30);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 2; ctx.stroke();

        // Fill under curve
        const lastX = 30 + (scores.length - 1) * step;
        ctx.lineTo(lastX, h - 20); ctx.lineTo(30, h - 20); ctx.closePath();
        ctx.fillStyle = 'rgba(167,139,250,0.1)'; ctx.fill();

        // Anomaly points
        scores.forEach((s, i) => {
            if (s > 40) {
                const x = 30 + i * step;
                const y = h - 20 - (s / maxScore) * (h - 30);
                ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fillStyle = s >= 60 ? '#ef4444' : '#f59e0b'; ctx.fill();
            }
        });
    }

    renderFeatureErrors(featureErrors) {
        const container = document.getElementById('anomaly-feature-bars');
        if (!container) return;
        const entries = Object.entries(featureErrors);
        if (!entries.length) { container.innerHTML = '<div class="anomaly-no-data">Waiting for data...</div>'; return; }

        const maxErr = Math.max(...entries.map(e => e[1]), 0.001);
        container.innerHTML = entries.map(([name, val]) => {
            const pct = Math.min(100, (val / maxErr) * 100);
            const cls = pct > 70 ? 'high' : pct > 40 ? 'med' : '';
            const shortName = name.replace('network_', 'net_').replace('bottle_at_', '').replace('output_', 'out_');
            return `<div class="anomaly-feat-row">
                <span class="anomaly-feat-name" title="${name}">${shortName}</span>
                <div class="anomaly-feat-bar-bg"><div class="anomaly-feat-bar ${cls}" style="width:${pct}%"></div></div>
                <span class="anomaly-feat-val">${val.toFixed(4)}</span>
            </div>`;
        }).join('');
    }

    renderAttackProbs(probs) {
        const container = document.getElementById('anomaly-attack-probs');
        if (!container) return;
        const entries = Object.entries(probs);
        if (!entries.length) { container.innerHTML = '<div class="anomaly-no-data">No attack detected</div>'; return; }

        container.innerHTML = entries.slice(0, 6).map(([name, prob]) => {
            const pct = Math.round(prob * 100);
            const label = name.replace(/_/g, ' ');
            return `<div class="anomaly-attack-row">
                <span class="anomaly-attack-name" title="${label}">${label}</span>
                <div class="anomaly-attack-bar-bg"><div class="anomaly-attack-bar" style="width:${pct}%"></div></div>
                <span class="anomaly-attack-pct">${pct}%</span>
            </div>`;
        }).join('');
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

            // 2. Load Ladder Logic (if defined), otherwise sync or default
            if (data.ladder) {
                console.log('[PLC] Loading custom ladder logic...');
                // Convert JSON definition to LadderProgram instances
                const program = new LadderProgram();
                program.rungs = [];

                data.ladder.forEach(rungDef => {
                    const instructions = rungDef.map(inst =>
                        new LadderInstruction(inst.type, inst.operands)
                    );
                    const rung = new LadderRung(instructions);
                    // Check if the rungDef itself has a comment property, or if the first instruction has one
                    if (rungDef.comment) rung.comment = rungDef.comment;
                    else if (rungDef.length > 0 && rungDef[0].comment) rung.comment = rungDef[0].comment;
                    program.addRung(rung);
                });

                this.ladderProgram = program; // Store the program
                this.plc.setLadderProgram(program);
            } else {
                console.log('[PLC] No custom ladder found, syncing from layout...');
                this.syncLadderFromLayout();
            }

            // 3. Update UI
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

            // 4. Force a UI refresh of the editor
            if (this.editor && this.editor.update) {
                this.editor.update();
            }
            console.log('[PLC] Preset rendered successfully');

            // Auto-detect stations from layout
            this.stationManager.autoDetect(this.engine);
            this.renderStationCards();

        } catch (err) {
            console.error('[PLC] loadPreset error:', err);
        }
    }

    getPresets() {
        return {
            bottle_factory: {
                version: 1,
                components: [
                    // Control Station
                    { id: 'sw_start', type: 'limit_switch', x: 40, y: 60, props: { address: 'I:0/1', label: 'START' } },
                    { id: 'sw_stop', type: 'limit_switch', x: 120, y: 60, props: { address: 'I:0/0', label: 'STOP' } },
                    { id: 'gate_not_stop', type: 'not_gate', x: 200, y: 50, props: { label: '!Stop' } },
                    { id: 'gate_sys', type: 'and_gate', x: 280, y: 50, props: { label: 'Sys Rdy' } },
                    // Conveyor Logic
                    { id: 'gate_not_fill', type: 'not_gate', x: 200, y: 130, props: { label: '!Fill' } },
                    { id: 'gate_not_cap', type: 'not_gate', x: 280, y: 130, props: { label: '!Cap' } },
                    { id: 'gate_conv1', type: 'and_gate', x: 370, y: 110, props: { label: 'Conv1' } },
                    { id: 'gate_conv2', type: 'and_gate', x: 460, y: 110, props: { label: 'Conv2' } },
                    // Conveyor + Motor
                    { id: 'motor_main', type: 'motor', x: 40, y: 280, props: { address: 'O:0/0', label: 'M_Conv', ratedRPM: 1800, startDelay: 250, accelTime: 1200, ratedCurrent: 4.5, overloadThreshold: 1.4, overloadDelay: 3000 } },
                    { id: 'conv_main', type: 'conveyor', x: 180, y: 290, props: { label: 'Main Conv', speed: 1.2, length: 3, accelTime: 600, slip: 0.02, maxItems: 6 } },
                    // Fill Station
                    { id: 'sens_fill', type: 'proximity_sensor', x: 360, y: 280, props: { address: 'I:0/3', label: 'PE_Fill', detectRange: 10 } },
                    { id: 'gate_fill', type: 'and_gate', x: 430, y: 200, props: { label: 'Fill En' } },
                    { id: 'val_fill', type: 'solenoid_valve', x: 520, y: 200, props: { address: 'O:0/1', label: 'V_Fill', type: '2-way', switchDelay: 60 } },
                    { id: 'pipe_fill', type: 'pipe', x: 520, y: 280, props: { label: 'Fill Pipe' } },
                    // Cap Station
                    { id: 'sens_cap', type: 'proximity_sensor', x: 620, y: 280, props: { address: 'I:0/4', label: 'PE_Cap', detectRange: 10 } },
                    { id: 'gate_cap', type: 'and_gate', x: 690, y: 200, props: { label: 'Cap En' } },
                    { id: 'motor_cap', type: 'motor', x: 780, y: 200, props: { address: 'O:0/2', label: 'M_Cap', ratedRPM: 900, startDelay: 150, accelTime: 800, ratedCurrent: 2.5, overloadThreshold: 1.6, overloadDelay: 2500 } },
                    // Quality + Reject
                    { id: 'sens_qual', type: 'photo_sensor', x: 860, y: 280, props: { address: 'I:0/5', label: 'PE_Qual', beamType: 'through' } },
                    { id: 'light_qual', type: 'indicator_light', x: 860, y: 200, props: { address: 'O:0/3', label: 'L_Qual', color: 'green' } },
                    { id: 'val_reject', type: 'solenoid_valve', x: 960, y: 200, props: { address: 'O:0/4', label: 'V_Reject', type: '2-way', switchDelay: 50 } },
                    { id: 'pipe_reject', type: 'pipe', x: 960, y: 280, props: { label: 'Reject' } },
                    // Tank + Monitoring
                    { id: 'sens_tank', type: 'level_sensor', x: 40, y: 400, props: { address: 'I:0/6', label: 'LT_Tank' } },
                    { id: 'gauge_tank', type: 'gauge', x: 120, y: 400, props: { label: 'Tank Lvl', unit: '%' } },
                    // Indicators
                    { id: 'horn_alarm', type: 'buzzer', x: 1060, y: 200, props: { address: 'O:0/5', label: 'Horn' } },
                    { id: 'light_run', type: 'indicator_light', x: 380, y: 50, props: { address: 'O:0/7', label: 'L_Run', color: 'green' } },
                ],
                wires: [
                    // Rung 0: System Ready = START AND NOT STOP
                    { fromComp: 'sw_stop', fromPort: 'out', toComp: 'gate_not_stop', toPort: 'a' },
                    { fromComp: 'sw_start', fromPort: 'out', toComp: 'gate_sys', toPort: 'a' },
                    { fromComp: 'gate_not_stop', fromPort: 'out', toComp: 'gate_sys', toPort: 'b' },
                    { fromComp: 'gate_sys', fromPort: 'out', toComp: 'light_run', toPort: 'cmd' },
                    // Rung 1: Conveyor = SysRdy AND NOT Filling AND NOT Capping
                    { fromComp: 'val_fill', fromPort: 'state', toComp: 'gate_not_fill', toPort: 'a' },
                    { fromComp: 'motor_cap', fromPort: 'running', toComp: 'gate_not_cap', toPort: 'a' },
                    { fromComp: 'gate_sys', fromPort: 'out', toComp: 'gate_conv1', toPort: 'a' },
                    { fromComp: 'gate_not_fill', fromPort: 'out', toComp: 'gate_conv1', toPort: 'b' },
                    { fromComp: 'gate_conv1', fromPort: 'out', toComp: 'gate_conv2', toPort: 'a' },
                    { fromComp: 'gate_not_cap', fromPort: 'out', toComp: 'gate_conv2', toPort: 'b' },
                    { fromComp: 'gate_conv2', fromPort: 'out', toComp: 'motor_main', toPort: 'run' },
                    { fromComp: 'motor_main', fromPort: 'running', toComp: 'conv_main', toPort: 'motor' },
                    // Rung 2: Fill = SysRdy AND Fill Sensor
                    { fromComp: 'gate_sys', fromPort: 'out', toComp: 'gate_fill', toPort: 'a' },
                    { fromComp: 'sens_fill', fromPort: 'out', toComp: 'gate_fill', toPort: 'b' },
                    { fromComp: 'gate_fill', fromPort: 'out', toComp: 'val_fill', toPort: 'cmd' },
                    { fromComp: 'val_fill', fromPort: 'state', toComp: 'pipe_fill', toPort: 'in' },
                    { fromComp: 'pipe_fill', fromPort: 'out', toComp: 'conv_main', toPort: 'item_in' },
                    // Rung 3: Cap = SysRdy AND Cap Sensor
                    { fromComp: 'gate_sys', fromPort: 'out', toComp: 'gate_cap', toPort: 'a' },
                    { fromComp: 'sens_cap', fromPort: 'out', toComp: 'gate_cap', toPort: 'b' },
                    { fromComp: 'gate_cap', fromPort: 'out', toComp: 'motor_cap', toPort: 'run' },
                    // Rung 4: Quality + Reject
                    { fromComp: 'sens_qual', fromPort: 'out', toComp: 'light_qual', toPort: 'cmd' },
                    { fromComp: 'sens_qual', fromPort: 'out', toComp: 'val_reject', toPort: 'cmd' },
                    { fromComp: 'val_reject', fromPort: 'state', toComp: 'pipe_reject', toPort: 'in' },
                    // Monitoring
                    { fromComp: 'sens_tank', fromPort: 'out', toComp: 'gauge_tank', toPort: 'value' },
                    { fromComp: 'pipe_reject', fromPort: 'out', toComp: 'horn_alarm', toPort: 'cmd' },
                ],
                ladder: [
                    [
                        { type: 'XIC', operands: ['I:0/1'] },
                        { type: 'XIO', operands: ['I:0/0'] },
                        { type: 'OTE', operands: ['O:0/7'] }
                    ],
                    [
                        { type: 'XIC', operands: ['O:0/7'] },
                        { type: 'XIO', operands: ['O:0/1'] },
                        { type: 'XIO', operands: ['O:0/2'] },
                        { type: 'OTE', operands: ['O:0/0'] }
                    ],
                    [
                        { type: 'XIC', operands: ['O:0/7'] },
                        { type: 'XIC', operands: ['I:0/3'] },
                        { type: 'OTE', operands: ['O:0/1'] }
                    ],
                    [
                        { type: 'XIC', operands: ['O:0/7'] },
                        { type: 'XIC', operands: ['I:0/4'] },
                        { type: 'OTE', operands: ['O:0/2'] }
                    ],
                    [
                        { type: 'XIC', operands: ['I:0/5'] },
                        { type: 'OTE', operands: ['O:0/3'] }
                    ]
                ]
            },
            sorting_station: {
                version: 1,
                components: [
                    // Control
                    { id: 'sw_start', type: 'limit_switch', x: 20, y: 60, props: { address: 'I:0/1', label: 'START' } },
                    { id: 'sw_stop', type: 'limit_switch', x: 100, y: 60, props: { address: 'I:0/0', label: 'STOP' } },
                    // Infeed
                    { id: 'motor_in', type: 'motor', x: 20, y: 200, props: { address: 'O:0/0', label: 'M_Infeed', ratedRPM: 1200, startDelay: 180, accelTime: 1000, ratedCurrent: 3.5 } },
                    { id: 'conv_in', type: 'conveyor', x: 140, y: 210, props: { label: 'Infeed Conv', speed: 0.8, length: 2, accelTime: 400, slip: 0.03 } },
                    // Detection
                    { id: 'sens_color', type: 'photo_sensor', x: 300, y: 210, props: { address: 'I:0/3', label: 'PE_Color' } },
                    // Path Logic
                    { id: 'gate_not_color', type: 'not_gate', x: 380, y: 140, props: { label: '!Color' } },
                    { id: 'gate_a', type: 'and_gate', x: 460, y: 100, props: { label: 'Path A' } },
                    { id: 'gate_b', type: 'and_gate', x: 460, y: 180, props: { label: 'Path B' } },
                    // Diverters
                    { id: 'div_a', type: 'pneumatic_cyl', x: 560, y: 100, props: { address: 'O:0/1', label: 'Div_A', stroke: 80, travelTime: 600, valveDelay: 40, cushionPct: 15 } },
                    { id: 'div_b', type: 'pneumatic_cyl', x: 560, y: 180, props: { address: 'O:0/2', label: 'Div_B', stroke: 80, travelTime: 600, valveDelay: 40, cushionPct: 15 } },
                    // Path A
                    { id: 'pipe_a', type: 'pipe', x: 660, y: 100, props: { label: 'Chute A' } },
                    { id: 'motor_a', type: 'motor', x: 760, y: 80, props: { label: 'M_BinA', ratedRPM: 900, startDelay: 120, accelTime: 600, ratedCurrent: 2.0 } },
                    { id: 'conv_a', type: 'conveyor', x: 840, y: 90, props: { label: 'Bin A Conv', speed: 0.6, length: 2, accelTime: 350 } },
                    // Path B
                    { id: 'pipe_b', type: 'pipe', x: 660, y: 200, props: { label: 'Chute B' } },
                    { id: 'motor_b', type: 'motor', x: 760, y: 180, props: { label: 'M_BinB', ratedRPM: 900, startDelay: 120, accelTime: 600, ratedCurrent: 2.0 } },
                    { id: 'conv_b', type: 'conveyor', x: 840, y: 190, props: { label: 'Bin B Conv', speed: 0.6, length: 2, accelTime: 350 } },
                    // Counter + Indicators
                    { id: 'counter_sort', type: 'counter_ctu', x: 300, y: 320, props: { label: 'Sorted', preset: 100 } },
                    { id: 'light_a', type: 'indicator_light', x: 960, y: 80, props: { label: 'Bin A', color: 'green' } },
                    { id: 'light_b', type: 'indicator_light', x: 960, y: 190, props: { label: 'Bin B', color: 'blue' } },
                    { id: 'light_status', type: 'indicator_light', x: 400, y: 320, props: { address: 'O:0/7', label: 'Done', color: 'yellow' } },
                ],
                wires: [
                    // Infeed: Start → Motor → Conveyor
                    { fromComp: 'sw_start', fromPort: 'out', toComp: 'motor_in', toPort: 'run' },
                    { fromComp: 'motor_in', fromPort: 'running', toComp: 'conv_in', toPort: 'motor' },
                    // Path selection logic
                    { fromComp: 'sens_color', fromPort: 'out', toComp: 'gate_a', toPort: 'a' },
                    { fromComp: 'sw_start', fromPort: 'out', toComp: 'gate_a', toPort: 'b' },
                    { fromComp: 'sens_color', fromPort: 'out', toComp: 'gate_not_color', toPort: 'a' },
                    { fromComp: 'gate_not_color', fromPort: 'out', toComp: 'gate_b', toPort: 'a' },
                    { fromComp: 'sw_start', fromPort: 'out', toComp: 'gate_b', toPort: 'b' },
                    // Diverters
                    { fromComp: 'gate_a', fromPort: 'out', toComp: 'div_a', toPort: 'extend' },
                    { fromComp: 'gate_b', fromPort: 'out', toComp: 'div_b', toPort: 'extend' },
                    // Path A flow: Diverter → Pipe → Motor → Conveyor
                    { fromComp: 'div_a', fromPort: 'ext_fb', toComp: 'pipe_a', toPort: 'in' },
                    { fromComp: 'gate_a', fromPort: 'out', toComp: 'motor_a', toPort: 'run' },
                    { fromComp: 'motor_a', fromPort: 'running', toComp: 'conv_a', toPort: 'motor' },
                    { fromComp: 'pipe_a', fromPort: 'out', toComp: 'conv_a', toPort: 'item_in' },
                    // Path B flow: Diverter → Pipe → Motor → Conveyor
                    { fromComp: 'div_b', fromPort: 'ext_fb', toComp: 'pipe_b', toPort: 'in' },
                    { fromComp: 'gate_b', fromPort: 'out', toComp: 'motor_b', toPort: 'run' },
                    { fromComp: 'motor_b', fromPort: 'running', toComp: 'conv_b', toPort: 'motor' },
                    { fromComp: 'pipe_b', fromPort: 'out', toComp: 'conv_b', toPort: 'item_in' },
                    // Counter + indicators
                    { fromComp: 'sens_color', fromPort: 'out', toComp: 'counter_sort', toPort: 'count' },
                    { fromComp: 'gate_a', fromPort: 'out', toComp: 'light_a', toPort: 'cmd' },
                    { fromComp: 'gate_b', fromPort: 'out', toComp: 'light_b', toPort: 'cmd' },
                    { fromComp: 'counter_sort', fromPort: 'done', toComp: 'light_status', toPort: 'cmd' },
                ],
                ladder: [
                    [
                        { type: 'XIC', operands: ['I:0/1'] },
                        { type: 'OTE', operands: ['O:0/0'] }
                    ],
                    [
                        { type: 'XIC', operands: ['I:0/3'] },
                        { type: 'OTE', operands: ['O:0/1'] }
                    ],
                    [
                        { type: 'XIC', operands: ['O:0/1'] },
                        { type: 'OTE', operands: ['O:0/7'] }
                    ]
                ]
            },
            mixing_process: {
                version: 1,
                components: [
                    // Control
                    { id: 'sw_start', type: 'limit_switch', x: 40, y: 250, props: { address: 'I:0/1', label: 'START' } },
                    { id: 'sw_heat', type: 'limit_switch', x: 40, y: 330, props: { address: 'I:0/2', label: 'Heat' } },
                    // Feed side
                    { id: 'tk_feed', type: 'tank', x: 120, y: 60, props: { label: 'Feed Tank', capacity: 100, fillRate: 12, drainRate: 8 } },
                    { id: 'pump_feed', type: 'pump', x: 120, y: 250, props: { address: 'O:0/0', label: 'P_Feed', flowRate: 40, startDelay: 200, accelTime: 1200, ratedCurrent: 3.5, overloadThreshold: 1.5, overloadDelay: 3000 } },
                    { id: 'pipe_feed', type: 'pipe', x: 240, y: 180, props: { label: 'Feed Pipe' } },
                    { id: 'val_in', type: 'solenoid_valve', x: 340, y: 120, props: { address: 'O:0/1', label: 'V_Inlet', switchDelay: 100 } },
                    { id: 'pipe_inlet', type: 'pipe', x: 340, y: 180, props: { label: 'Inlet' } },
                    // Mix side
                    { id: 'tk_mix', type: 'tank', x: 440, y: 60, props: { label: 'Mix Tank', capacity: 200, fillRate: 15, drainRate: 10 } },
                    { id: 'mixer_ag', type: 'mixer', x: 440, y: 250, props: { address: 'O:0/2', label: 'Agitator' } },
                    { id: 'heater_main', type: 'heater', x: 560, y: 180, props: { address: 'O:0/3', label: 'Heater', power: 2000, heatRate: 3.5, coolRate: 1.5, ambientTemp: 22, maxTemp: 120 } },
                    // Drain
                    { id: 'val_drain', type: 'solenoid_valve', x: 560, y: 250, props: { address: 'O:0/4', label: 'V_Drain', switchDelay: 120 } },
                    { id: 'pipe_drain', type: 'pipe', x: 560, y: 320, props: { label: 'Drain' } },
                    // Sensors
                    { id: 'temp_sens', type: 'temp_sensor', x: 560, y: 60, props: { address: 'I:0/3', label: 'Temp' } },
                    // Monitoring
                    { id: 'gauge_feed', type: 'gauge', x: 220, y: 60, props: { label: 'Feed Lvl', unit: '%' } },
                    { id: 'gauge_mix', type: 'gauge', x: 540, y: 60, props: { label: 'Mix Lvl', unit: '%' } },
                    { id: 'gauge_temp', type: 'gauge', x: 660, y: 60, props: { label: 'Temp', unit: '°C' } },
                    // Logic
                    { id: 'gate_alarm_or', type: 'or_gate', x: 660, y: 180, props: { label: 'Alarm' } },
                    { id: 'gate_process', type: 'and_gate', x: 660, y: 250, props: { label: 'Process' } },
                    // Indicators
                    { id: 'horn_alarm', type: 'buzzer', x: 760, y: 180, props: { address: 'O:0/5', label: 'Horn' } },
                    { id: 'light_heat', type: 'indicator_light', x: 660, y: 330, props: { label: 'Heat On', color: 'red' } },
                    { id: 'light_run', type: 'indicator_light', x: 760, y: 330, props: { address: 'O:0/7', label: 'Running', color: 'green' } },
                    { id: 'disp_status', type: 'display_7seg', x: 760, y: 250, props: { label: 'Status', digits: 3 } },
                ],
                wires: [
                    // Feed flow: Start → Pump → Pipe → Valve → Pipe → Mix Tank
                    { fromComp: 'sw_start', fromPort: 'out', toComp: 'pump_feed', toPort: 'run' },
                    { fromComp: 'pump_feed', fromPort: 'running', toComp: 'tk_feed', toPort: 'outlet' },
                    { fromComp: 'pump_feed', fromPort: 'running', toComp: 'pipe_feed', toPort: 'in' },
                    { fromComp: 'pipe_feed', fromPort: 'out', toComp: 'val_in', toPort: 'cmd' },
                    { fromComp: 'val_in', fromPort: 'state', toComp: 'pipe_inlet', toPort: 'in' },
                    { fromComp: 'pipe_inlet', fromPort: 'out', toComp: 'tk_mix', toPort: 'inlet' },
                    // Heat: Heat SW → Heater → Mixer + Indicator
                    { fromComp: 'sw_heat', fromPort: 'out', toComp: 'heater_main', toPort: 'cmd' },
                    { fromComp: 'heater_main', fromPort: 'active', toComp: 'mixer_ag', toPort: 'motor' },
                    { fromComp: 'heater_main', fromPort: 'active', toComp: 'light_heat', toPort: 'cmd' },
                    // Running indicator
                    { fromComp: 'sw_start', fromPort: 'out', toComp: 'light_run', toPort: 'cmd' },
                    // Monitoring gauges
                    { fromComp: 'tk_feed', fromPort: 'level', toComp: 'gauge_feed', toPort: 'value' },
                    { fromComp: 'tk_mix', fromPort: 'level', toComp: 'gauge_mix', toPort: 'value' },
                    { fromComp: 'temp_sens', fromPort: 'out', toComp: 'gauge_temp', toPort: 'value' },
                    // Drain: Mix full → Drain valve → Pipe → recirculate to Feed
                    { fromComp: 'tk_mix', fromPort: 'full', toComp: 'val_drain', toPort: 'cmd' },
                    { fromComp: 'val_drain', fromPort: 'state', toComp: 'pipe_drain', toPort: 'in' },
                    { fromComp: 'pipe_drain', fromPort: 'out', toComp: 'tk_feed', toPort: 'inlet' },
                    // Alarm logic: Feed empty OR Mix full → Horn
                    { fromComp: 'tk_feed', fromPort: 'empty', toComp: 'gate_alarm_or', toPort: 'a' },
                    { fromComp: 'tk_mix', fromPort: 'full', toComp: 'gate_alarm_or', toPort: 'b' },
                    { fromComp: 'gate_alarm_or', fromPort: 'out', toComp: 'horn_alarm', toPort: 'cmd' },
                    // Process status: Pump AND Heater → Display
                    { fromComp: 'pump_feed', fromPort: 'running', toComp: 'gate_process', toPort: 'a' },
                    { fromComp: 'heater_main', fromPort: 'active', toComp: 'gate_process', toPort: 'b' },
                    { fromComp: 'gate_process', fromPort: 'out', toComp: 'disp_status', toPort: 'value' },
                ],
                ladder: [
                    [
                        { type: 'XIC', operands: ['I:0/1'] },
                        { type: 'OTE', operands: ['O:0/7'] }
                    ],
                    [
                        { type: 'XIC', operands: ['I:0/1'] },
                        { type: 'OTE', operands: ['O:0/0'] }
                    ],
                    [
                        { type: 'XIC', operands: ['O:0/0'] },
                        { type: 'OTE', operands: ['O:0/1'] }
                    ],
                    [
                        { type: 'XIC', operands: ['I:0/2'] },
                        { type: 'OTE', operands: ['O:0/3'] }
                    ],
                    [
                        { type: 'XIC', operands: ['O:0/3'] },
                        { type: 'OTE', operands: ['O:0/2'] }
                    ]
                ]
            },
            conveyor_merge: {
                version: 1,
                components: [
                    // Physical System: Conveyors
                    { id: 'conv_main', type: 'conveyor', x: 380, y: 380, props: { label: 'Main Conv', length: 5, speed: 1.5, accelTime: 800, slip: 0.01, maxItems: 8 } },
                    { id: 'conv_a', type: 'conveyor', x: 200, y: 300, props: { label: 'Ln A Conv', length: 2, speed: 1.0, accelTime: 500, slip: 0.02 } },
                    { id: 'conv_b', type: 'conveyor', x: 560, y: 300, props: { label: 'Ln B Conv', length: 2, speed: 1.0, accelTime: 500, slip: 0.02 } },

                    { id: 'motor_main', type: 'motor', x: 380, y: 280, props: { label: 'Main Mtr', ratedRPM: 1800, startDelay: 300, accelTime: 1500, ratedCurrent: 5.5, overloadThreshold: 1.3 } },
                    { id: 'motor_a', type: 'motor', x: 200, y: 200, props: { label: 'Mtr A', ratedRPM: 1200, startDelay: 150, accelTime: 800, ratedCurrent: 3.0 } },
                    { id: 'motor_b', type: 'motor', x: 560, y: 200, props: { label: 'Mtr B', ratedRPM: 1200, startDelay: 150, accelTime: 800, ratedCurrent: 3.0 } },

                    // Logic: Sequencer
                    { id: 'sw_sys', type: 'limit_switch', x: 40, y: 60, props: { label: 'System Start', normallyOpen: true } },
                    { id: 'latch_run', type: 'sr_latch', x: 160, y: 60, props: { label: 'Auto Mode' } },

                    // Timers for sequencing (Traffic Light Logic)
                    // T1: Run Line A (Green)
                    // T2: Gap / Clearance (Yellow)
                    // T3: Run Line B (Red / Green B)
                    // T4: Gap / Clearance (Yellow)

                    { id: 'tmr_a', type: 'timer_ton', x: 300, y: 60, props: { label: 'Run A', preset: 4000 } },
                    { id: 'tmr_gap1', type: 'timer_ton', x: 440, y: 60, props: { label: 'Gap 1', preset: 1500 } },
                    { id: 'tmr_b', type: 'timer_ton', x: 580, y: 60, props: { label: 'Run B', preset: 4000 } },
                    { id: 'tmr_gap2', type: 'timer_ton', x: 720, y: 60, props: { label: 'Gap 2', preset: 1500 } },

                    // Logic Loop Control
                    { id: 'gate_loop_not', type: 'not_gate', x: 40, y: 160, props: { label: '!Loop' } },
                    { id: 'gate_loop_and', type: 'and_gate', x: 160, y: 160, props: { label: 'Loop En' } },

                    // Output Control Logic
                    // Line A active only during T1
                    { id: 'gate_run_a_not', type: 'not_gate', x: 300, y: 160, props: { label: '!Done' } },
                    { id: 'gate_run_a_and', type: 'and_gate', x: 300, y: 240, props: { label: 'Drive A' } },

                    // Line B active only during T3 (between Gap 1 Done and Run B Done)
                    { id: 'gate_run_b_not', type: 'not_gate', x: 580, y: 160, props: { label: '!Done' } },
                    { id: 'gate_run_b_and', type: 'and_gate', x: 580, y: 240, props: { label: 'Drive B' } },

                    // Indicators
                    { id: 'light_a', type: 'indicator_light', x: 260, y: 380, props: { label: 'Ln A Active', color: 'green' } },
                    { id: 'light_b', type: 'indicator_light', x: 620, y: 380, props: { label: 'Ln B Active', color: 'blue' } },
                    { id: 'light_warn', type: 'indicator_light', x: 440, y: 380, props: { label: 'Gap / Clear', color: 'yellow' } },

                    // Gap Logic (OR gate for warning light)
                    // Gap 1 running OR Gap 2 running
                    // Keep it simple: Warning light on when NEITHER A nor B is running?
                    // Actually, let's use the timer Done bits directly for the simple version.
                    // Warn = (T1.Done AND !T2.Done) OR (T3.Done AND !T4.Done)
                    // Implementation below simplifies: Warn on when A and B represent gaps. 
                    { id: 'gate_warn_or', type: 'or_gate', x: 440, y: 280, props: { label: 'Warn' } }

                ],
                wires: [
                    // System Start Latch
                    { fromComp: 'sw_sys', fromPort: 'out', toComp: 'latch_run', toPort: 'set' },

                    // Loop Sequence: Latch -> T1 -> T2 -> T3 -> T4 -> Loop
                    { fromComp: 'latch_run', fromPort: 'q', toComp: 'gate_loop_and', toPort: 'a' },
                    { fromComp: 'tmr_gap2', fromPort: 'done', toComp: 'gate_loop_not', toPort: 'a' },
                    { fromComp: 'gate_loop_not', fromPort: 'out', toComp: 'gate_loop_and', toPort: 'b' },

                    { fromComp: 'gate_loop_and', fromPort: 'out', toComp: 'tmr_a', toPort: 'enable' },
                    { fromComp: 'tmr_a', fromPort: 'done', toComp: 'tmr_gap1', toPort: 'enable' },
                    { fromComp: 'tmr_gap1', fromPort: 'done', toComp: 'tmr_b', toPort: 'enable' },
                    { fromComp: 'tmr_b', fromPort: 'done', toComp: 'tmr_gap2', toPort: 'enable' },

                    // Drive Logic Line A: (Loop Active) AND (!T1.Done)
                    { fromComp: 'gate_loop_and', fromPort: 'out', toComp: 'gate_run_a_and', toPort: 'a' },
                    { fromComp: 'tmr_a', fromPort: 'done', toComp: 'gate_run_a_not', toPort: 'a' },
                    { fromComp: 'gate_run_a_not', fromPort: 'out', toComp: 'gate_run_a_and', toPort: 'b' },
                    { fromComp: 'gate_run_a_and', fromPort: 'out', toComp: 'motor_a', toPort: 'run' },
                    { fromComp: 'gate_run_a_and', fromPort: 'out', toComp: 'light_a', toPort: 'cmd' },

                    // Drive Logic Line B: (T2.Done) AND (!T3.Done)
                    { fromComp: 'tmr_gap1', fromPort: 'done', toComp: 'gate_run_b_and', toPort: 'a' },
                    { fromComp: 'tmr_b', fromPort: 'done', toComp: 'gate_run_b_not', toPort: 'a' },
                    { fromComp: 'gate_run_b_not', fromPort: 'out', toComp: 'gate_run_b_and', toPort: 'b' },
                    { fromComp: 'gate_run_b_and', fromPort: 'out', toComp: 'motor_b', toPort: 'run' },
                    { fromComp: 'gate_run_b_and', fromPort: 'out', toComp: 'light_b', toPort: 'cmd' },

                    // Main Motor Always On when System Run
                    { fromComp: 'latch_run', fromPort: 'q', toComp: 'motor_main', toPort: 'run' },

                    // Conveyors driven by motors
                    { fromComp: 'motor_main', fromPort: 'running', toComp: 'conv_main', toPort: 'motor' },
                    { fromComp: 'motor_a', fromPort: 'running', toComp: 'conv_a', toPort: 'motor' },
                    { fromComp: 'motor_b', fromPort: 'running', toComp: 'conv_b', toPort: 'motor' },

                    // Warning Logic: (T1.Don AND !T2.Done) OR (T3.Done AND !T4.Done)
                    // ...Simpler: Warn is on during gaps. But let's simplify for the preset wires count.
                    // Just wire the gap timers 'elapsed' > 0 to light? No, simplistic.
                    // Let's wire T1.Done -> OR -> Light. T3.Done -> OR -> Light. 
                    // This lights up warning continuously after T1 finishes until end? 
                    // No, let's just make Warn light blink when NEITHER motor is running?
                    // Too complex for preset. Let's just wire T1.Done and T3.Done to OR for now to show transition.
                    { fromComp: 'tmr_a', fromPort: 'done', toComp: 'gate_warn_or', toPort: 'a' },
                    { fromComp: 'tmr_b', fromPort: 'done', toComp: 'gate_warn_or', toPort: 'b' },
                    { fromComp: 'gate_warn_or', fromPort: 'out', toComp: 'light_warn', toPort: 'cmd' }

                ]
            },
            cip_sequence: {
                version: 1,
                components: [
                    { id: 'tk_src', type: 'tank', x: 100, y: 50, props: { label: 'Water Tank', capacity: 200, fillRate: 20, drainRate: 15 } },
                    { id: 'tk_chem', type: 'tank', x: 250, y: 50, props: { label: 'Chem Tank', capacity: 100, fillRate: 8, drainRate: 6 } },
                    { id: 'v_water', type: 'solenoid_valve', x: 100, y: 150, props: { label: 'V_Wtr', switchDelay: 90 } },
                    { id: 'v_chem', type: 'solenoid_valve', x: 250, y: 150, props: { label: 'V_Chm', switchDelay: 70 } },
                    { id: 'pipe_mix', type: 'pipe', x: 180, y: 220, props: { label: 'Manifold' } },
                    { id: 'p_main', type: 'pump', x: 180, y: 280, props: { label: 'CIP Pump', flowRate: 60, startDelay: 180, accelTime: 1000, ratedCurrent: 4.0, overloadThreshold: 1.4 } },
                    { id: 'tk_dest', type: 'tank', x: 180, y: 400, props: { label: 'CIP Tank', capacity: 500, fillRate: 25, drainRate: 20 } },

                    { id: 'sw_start', type: 'limit_switch', x: 400, y: 50, props: { label: 'Start' } },
                    { id: 'latch_run', type: 'sr_latch', x: 520, y: 50, props: { label: 'Seq Run' } },

                    { id: 'tmr_rinse1', type: 'timer_ton', x: 400, y: 150, props: { label: 'Rinse 1', preset: 4000 } },
                    { id: 'tmr_wash', type: 'timer_ton', x: 540, y: 150, props: { label: 'Wash', preset: 4000 } },
                    { id: 'tmr_rinse2', type: 'timer_ton', x: 680, y: 150, props: { label: 'Rinse 2', preset: 4000 } },

                    { id: 'gate_rinse1_not', type: 'not_gate', x: 400, y: 250, props: { label: '!Done' } },

                    { id: 'gate_wash_not', type: 'not_gate', x: 540, y: 250, props: { label: '!Done' } },
                    { id: 'gate_chem_and', type: 'and_gate', x: 540, y: 350, props: { label: 'Chem Vlv' } },

                    { id: 'gate_rinse2_not', type: 'not_gate', x: 680, y: 250, props: { label: '!Done' } },

                    { id: 'gate_wtr_or', type: 'or_gate', x: 300, y: 350, props: { label: 'Wtr Vlv' } },
                    { id: 'gate_wtr_ph1', type: 'and_gate', x: 400, y: 350, props: { label: 'Ph 1' } },
                    { id: 'gate_wtr_ph3', type: 'and_gate', x: 680, y: 350, props: { label: 'Ph 3' } },
                    { id: 'gate_pipe_or', type: 'or_gate', x: 180, y: 350, props: { label: 'Pipe In' } }
                ],
                wires: [
                    { fromComp: 'sw_start', fromPort: 'out', toComp: 'latch_run', toPort: 'set' },
                    { fromComp: 'tmr_rinse2', fromPort: 'done', toComp: 'latch_run', toPort: 'reset' },

                    { fromComp: 'latch_run', fromPort: 'q', toComp: 'tmr_rinse1', toPort: 'enable' },
                    { fromComp: 'tmr_rinse1', fromPort: 'done', toComp: 'tmr_wash', toPort: 'enable' },
                    { fromComp: 'tmr_wash', fromPort: 'done', toComp: 'tmr_rinse2', toPort: 'enable' },

                    { fromComp: 'latch_run', fromPort: 'q', toComp: 'p_main', toPort: 'run' },

                    { fromComp: 'tmr_rinse1', fromPort: 'done', toComp: 'gate_chem_and', toPort: 'a' },
                    { fromComp: 'tmr_wash', fromPort: 'done', toComp: 'gate_wash_not', toPort: 'a' },
                    { fromComp: 'gate_wash_not', fromPort: 'out', toComp: 'gate_chem_and', toPort: 'b' },
                    { fromComp: 'gate_chem_and', fromPort: 'out', toComp: 'v_chem', toPort: 'cmd' },

                    { fromComp: 'latch_run', fromPort: 'q', toComp: 'gate_wtr_ph1', toPort: 'a' },
                    { fromComp: 'tmr_rinse1', fromPort: 'done', toComp: 'gate_rinse1_not', toPort: 'a' },
                    { fromComp: 'gate_rinse1_not', fromPort: 'out', toComp: 'gate_wtr_ph1', toPort: 'b' },

                    { fromComp: 'tmr_wash', fromPort: 'done', toComp: 'gate_wtr_ph3', toPort: 'a' },
                    { fromComp: 'tmr_rinse2', fromPort: 'done', toComp: 'gate_rinse2_not', toPort: 'a' },
                    { fromComp: 'gate_rinse2_not', fromPort: 'out', toComp: 'gate_wtr_ph3', toPort: 'b' },

                    { fromComp: 'gate_wtr_ph1', fromPort: 'out', toComp: 'gate_wtr_or', toPort: 'a' },
                    { fromComp: 'gate_wtr_ph3', fromPort: 'out', toComp: 'gate_wtr_or', toPort: 'b' },
                    { fromComp: 'gate_wtr_or', fromPort: 'out', toComp: 'v_water', toPort: 'cmd' },

                    { fromComp: 'v_water', fromPort: 'state', toComp: 'gate_pipe_or', toPort: 'a' },
                    { fromComp: 'v_chem', fromPort: 'state', toComp: 'gate_pipe_or', toPort: 'b' },
                    { fromComp: 'gate_pipe_or', fromPort: 'out', toComp: 'pipe_mix', toPort: 'in' }
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
