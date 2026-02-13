// Main Application Controller
class BottleFactoryPLC {
    constructor() {
        this.plc = new PLCCore();
        this.factory = new FactorySimulation();
        this.ladderRenderer = new LadderLogicRenderer('ladder-canvas');
        this.ladderProgram = new LadderProgram();
        this.alarms = new AlarmManager();
        this.telemetry = new TelemetryClient();
        
        this.isRunning = false;
        this.updateInterval = null;
        this.syncInterval = null;
        this.telemetryInterval = null;
        this.backendHealthInterval = null;
        this.backendOnline = false;
        this.pendingAnalyzeRequest = false;
        this.latestAnalysis = this.buildDefaultAnalysis();
        this.detectionFeed = [];
        this.analysisStats = {
            totalRuns: 0,
            anomalyRuns: 0,
            latencySamples: []
        };
        this.scenarios = this.buildScenarioProfiles();
        this.activeScenarioKey = 'normal';
        
        this.initializeEventListeners();
        this.initializePLCIntegration();
        this.initializeUI();
    }
    
    initializeEventListeners() {
        // Control buttons
        document.getElementById('start-btn').addEventListener('click', () => this.start());
        document.getElementById('stop-btn').addEventListener('click', () => this.stop());
        document.getElementById('reset-btn').addEventListener('click', () => this.reset());
        document.getElementById('emergency-btn').addEventListener('click', () => this.emergencyStop());
        
        // Ladder logic controls
        document.getElementById('edit-ladder-btn').addEventListener('click', () => this.toggleLadderEditor());
        document.getElementById('run-scan-btn').addEventListener('click', () => this.runSingleScan());
        
        // PLC event listeners
        this.plc.onInputChange.push((address, value) => this.onInputChange(address, value));
        this.plc.onOutputChange.push((address, value) => this.onOutputChange(address, value));
        this.plc.onScanComplete.push((scanCount) => this.onScanComplete(scanCount));

        this.initializeMLShowcaseControls();
    }

    initializeMLShowcaseControls() {
        const scenarioButtons = document.querySelectorAll('.scenario-btn');
        scenarioButtons.forEach((button) => {
            button.addEventListener('click', () => {
                this.setScenario(button.dataset.scenario || 'normal');
            });
        });

        const exportButton = document.getElementById('export-report-btn');
        if (exportButton) {
            exportButton.addEventListener('click', () => this.exportDemoReport());
        }
    }
    
    initializePLCIntegration() {
        // Set up periodic I/O synchronization
        this.syncInterval = setInterval(() => {
            if (this.isRunning) {
                this.syncPLCWithFactory();
            }
        }, 100);

        this.startBackendHealthChecks();
        this.startTelemetryLoop();
    }
    
    initializeUI() {
        // Initialize UI displays
        this.updatePLCStatus();
        this.updateIODisplays();
        this.updateMonitoringDisplays();
        this.ladderRenderer.render(this.ladderProgram, this.plc.getIOState());
    }
    
    syncPLCWithFactory() {
        // Update PLC inputs from factory sensors
        const sensorStates = this.factory.getSensorStates();
        
        this.plc.setInput('I:0/0', false); // Emergency stop (normally closed)
        this.plc.setInput('I:0/1', this.isRunning); // Start button
        this.plc.setInput('I:0/2', false); // Stop button (normally closed)
        this.plc.setInput('I:0/3', sensorStates.bottleAtFiller);
        this.plc.setInput('I:0/4', sensorStates.bottleAtCapper);
        this.plc.setInput('I:0/5', sensorStates.bottleAtQuality);
        this.plc.setInput('I:0/6', sensorStates.levelSensorReady);
        this.plc.setInput('I:0/7', sensorStates.capAvailable);
        this.plc.setInput('I:0/8', this.latestAnalysis.processAnomaly);
        this.plc.setInput('I:0/9', this.latestAnalysis.networkAlert);
        
        // Update factory actuators from PLC outputs
        const actuators = {
            conveyorMotor: this.plc.getOutput('O:0/0'),
            fillValve: this.plc.getOutput('O:0/1'),
            capperMotor: this.plc.getOutput('O:0/2'),
            qualityLight: this.plc.getOutput('O:0/3'),
            rejectGate: this.plc.getOutput('O:0/4'),
            alarmHorn: this.plc.getOutput('O:0/5'),
            runningLight: this.plc.getOutput('O:0/6'),
            systemReady: this.plc.getOutput('O:0/7')
        };
        
        this.factory.setActuatorStates(actuators);
    }
    
    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.plc.start();
            this.factory.start();
            
            // Set start button input
            this.plc.setInput('I:0/1', true);
            
            // Start UI updates
            this.startUIUpdates();
            
            // Update status
            this.updatePLCStatus();
            this.alarms.clearAlarm('SYSTEM_STOPPED');
            
            console.log('Bottle Factory PLC Started');
        }
    }

    buildDefaultAnalysis() {
        return {
            processAnomaly: false,
            networkAlert: false,
            processScore: 0,
            networkScore: 0,
            modelConfidence: 100,
            processComponents: {},
            networkComponents: {},
            riskLevel: 'low',
            recommendedAction: 'Continue baseline monitoring.',
            modelVersion: 'hybrid-rule-zscore-v1.1',
            reasons: []
        };
    }

    buildScenarioProfiles() {
        return {
            normal: {
                label: 'Normal Baseline',
                productionRateFactor: 1,
                rejectRateOffset: 0,
                minInflightBottles: 0,
                networkPacketRate: 130,
                networkBurstRatio: 0.2,
                unauthorizedAttempts: 0
            },
            process_drift: {
                label: 'Process Drift',
                productionRateFactor: 0.45,
                rejectRateOffset: 14,
                minInflightBottles: 8,
                networkPacketRate: 136,
                networkBurstRatio: 0.35,
                unauthorizedAttempts: 0
            },
            network_attack: {
                label: 'Network Attack',
                productionRateFactor: 0.95,
                rejectRateOffset: 1.5,
                minInflightBottles: 2,
                networkPacketRate: 235,
                networkBurstRatio: 0.94,
                unauthorizedAttempts: 2
            },
            combined: {
                label: 'Combined Incident',
                productionRateFactor: 0.4,
                rejectRateOffset: 18,
                minInflightBottles: 10,
                networkPacketRate: 245,
                networkBurstRatio: 0.97,
                unauthorizedAttempts: 3
            }
        };
    }
    
    stop() {
        if (this.isRunning) {
            this.isRunning = false;
            this.plc.stop();
            this.factory.stop();
            
            // Clear start button input
            this.plc.setInput('I:0/1', false);
            
            // Stop UI updates
            this.stopUIUpdates();
            
            // Update status
            this.updatePLCStatus();
            this.alarms.addAlarm('SYSTEM_STOPPED', 'System stopped by operator');
            
            console.log('Bottle Factory PLC Stopped');
        }
    }
    
    reset() {
        // Stop system first
        this.stop();
        
        // Reset components
        this.plc.reset();
        this.factory.reset();
        this.alarms.clearAllAlarms();
        
        // Clear all inputs
        for (let i = 0; i < 10; i++) {
            this.plc.setInput(`I:0/${i}`, false);
        }

        this.latestAnalysis = this.buildDefaultAnalysis();
        this.detectionFeed = [];
        this.analysisStats = {
            totalRuns: 0,
            anomalyRuns: 0,
            latencySamples: []
        };
        this.setScenario('normal');
        
        // Update displays
        this.updatePLCStatus();
        this.updateIODisplays();
        this.updateMonitoringDisplays();
        
        console.log('Bottle Factory PLC Reset');
    }
    
    emergencyStop() {
        // Immediate stop
        this.isRunning = false;
        
        // Set emergency stop input
        this.plc.setInput('I:0/0', true);
        
        // Emergency stop both systems
        this.plc.triggerEmergencyStop();
        this.factory.emergencyStop();
        
        // Stop UI updates
        this.stopUIUpdates();
        
        // Add alarm
        this.alarms.addAlarm('EMERGENCY_STOP', 'Emergency stop activated!', 'critical');
        
        // Update displays
        this.updatePLCStatus();
        this.updateIODisplays();
        
        console.log('Emergency Stop Activated');
    }
    
    startUIUpdates() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        
        this.updateInterval = setInterval(() => {
            this.updateIODisplays();
            this.updateMonitoringDisplays();
            this.updateLadderDisplay();
        }, 200); // Update every 200ms
    }
    
    stopUIUpdates() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }
    
    updatePLCStatus() {
        const status = this.plc.getStatus();
        const statusElement = document.getElementById('plc-status');
        const cycleTimeElement = document.getElementById('cycle-time');
        const productionCountElement = document.getElementById('production-count');
        
        // Update PLC status
        if (status.emergencyStop) {
            statusElement.textContent = 'EMERGENCY STOP';
            statusElement.className = 'status-value plc-error';
        } else if (status.errorState) {
            statusElement.textContent = 'ERROR';
            statusElement.className = 'status-value plc-error';
        } else if (status.runMode) {
            statusElement.textContent = 'RUNNING';
            statusElement.className = 'status-value plc-running';
        } else {
            statusElement.textContent = 'STOPPED';
            statusElement.className = 'status-value plc-stopped';
        }
        
        // Update cycle time
        cycleTimeElement.textContent = `${status.cycleTime}ms`;
        
        // Update production count
        const metrics = this.factory.getProductionMetrics();
        productionCountElement.textContent = metrics.productionCount;
    }
    
    updateIODisplays() {
        const ioState = this.plc.getIOState();
        
        // Update input displays
        for (let i = 0; i < 10; i++) {
            const inputElement = document.getElementById(`I0_${i}`);
            if (inputElement) {
                inputElement.textContent = ioState.inputs[i] ? 'ON' : 'OFF';
                inputElement.className = ioState.inputs[i] ? 'io-status ON' : 'io-status OFF';
            }
        }
        
        // Update output displays
        for (let i = 0; i < 9; i++) {
            const outputElement = document.getElementById(`O0_${i}`);
            if (outputElement) {
                outputElement.textContent = ioState.outputs[i] ? 'ON' : 'OFF';
                outputElement.className = ioState.outputs[i] ? 'io-status ON' : 'io-status OFF';
            }
        }
    }
    
    updateMonitoringDisplays() {
        const metrics = this.factory.getProductionMetrics();
        
        // Update production metrics
        document.getElementById('production-rate').textContent = metrics.productionRate;
        document.getElementById('efficiency').textContent = metrics.efficiency;
        document.getElementById('reject-rate').textContent = metrics.rejectRate;
        document.getElementById('uptime').textContent = metrics.uptime;
        document.getElementById('anomaly-score').textContent = Math.round(this.latestAnalysis.processScore);
        document.getElementById('network-risk').textContent = Math.round(this.latestAnalysis.networkScore);
        document.getElementById('model-confidence').textContent = Math.round(this.latestAnalysis.modelConfidence);
        
        // Update alarms display
        this.updateAlarmsDisplay();
        this.updateDetectionFeed();
        this.updateExplainabilityPanel();
        this.updateSessionKpis();
    }
    
    updateLadderDisplay() {
        this.ladderRenderer.render(this.ladderProgram, this.plc.getIOState());
    }
    
    updateAlarmsDisplay() {
        const alarmsList = document.getElementById('alarms-list');
        const activeAlarms = this.alarms.getActiveAlarms();
        
        if (activeAlarms.length === 0) {
            alarmsList.innerHTML = '<div class="no-alarms">No active alarms</div>';
        } else {
            alarmsList.innerHTML = activeAlarms.map(alarm => `
                <div class="alarm-item">
                    <span class="alarm-time">${new Date(alarm.timestamp).toLocaleTimeString()}</span>
                    <span class="alarm-message">${alarm.message}</span>
                    <button class="alarm-clear" onclick="app.clearAlarm('${alarm.id}')">Clear</button>
                </div>
            `).join('');
        }
    }
    
    toggleLadderEditor() {
        const editButton = document.getElementById('edit-ladder-btn');
        const isEditMode = editButton.textContent === 'Edit Logic';
        
        if (isEditMode) {
            editButton.textContent = 'Save Logic';
            // Enable ladder editing mode
            console.log('Ladder editor mode enabled');
        } else {
            editButton.textContent = 'Edit Logic';
            // Save and disable ladder editing mode
            console.log('Ladder editor mode disabled');
        }
    }
    
    runSingleScan() {
        // Execute a single PLC scan
        this.plc.executeLadderLogic();
        this.updateIODisplays();
        this.updateLadderDisplay();
        
        // Visual feedback
        const scanButton = document.getElementById('run-scan-btn');
        scanButton.style.background = '#28a745';
        setTimeout(() => {
            scanButton.style.background = '';
        }, 200);
    }
    
    clearAlarm(alarmId) {
        this.alarms.clearAlarm(alarmId);
        this.updateAlarmsDisplay();
    }

    startBackendHealthChecks() {
        const check = async () => {
            const health = await this.telemetry.checkHealth();
            this.updateBackendStatus(health.ok);
        };

        check();
        this.backendHealthInterval = setInterval(check, 4000);
    }

    startTelemetryLoop() {
        const cycle = async () => {
            await this.runTelemetryCycle();
        };

        cycle();
        this.telemetryInterval = setInterval(cycle, 1000);
    }

    async runTelemetryCycle() {
        if (!this.isRunning || this.pendingAnalyzeRequest) {
            return;
        }

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
                modelVersion: String(analysis.model_version || 'hybrid-rule-zscore-v1.1'),
                reasons: Array.isArray(analysis.reasons) ? analysis.reasons : []
            };

            this.recordAnalysisStats(latencyMs, this.latestAnalysis.processAnomaly || this.latestAnalysis.networkAlert);

            if (this.latestAnalysis.processAnomaly) {
                this.alarms.addAlarm('PROCESS_ANOMALY', 'AI detected process anomaly', 'critical');
            } else {
                this.alarms.clearAlarm('PROCESS_ANOMALY');
            }

            if (this.latestAnalysis.networkAlert) {
                this.alarms.addAlarm('NETWORK_ALERT', 'Network lane anomaly detected', 'critical');
            } else {
                this.alarms.clearAlarm('NETWORK_ALERT');
            }

            this.pushDetectionEvent(this.latestAnalysis);
            this.updateBackendStatus(true);
        } catch (error) {
            this.updateBackendStatus(false);
            console.warn('Telemetry cycle failed:', error.message);
        } finally {
            this.pendingAnalyzeRequest = false;
        }
    }

    buildAnalysisPayload() {
        const metrics = this.factory.getProductionMetrics();
        const sensors = this.factory.getSensorStates();
        const system = this.factory.getSystemState();
        const io = this.plc.getIOState();

        const basePayload = {
            timestamp: new Date().toISOString(),
            production_count: metrics.productionCount,
            production_rate: metrics.productionRate,
            reject_rate: metrics.rejectRate,
            conveyor_running: sensors.conveyorRunning,
            bottle_at_filler: sensors.bottleAtFiller,
            bottle_at_capper: sensors.bottleAtCapper,
            bottle_at_quality: sensors.bottleAtQuality,
            in_flight_bottles: system.bottles.length,
            output_alarm_horn: io.outputs[5],
            output_reject_gate: io.outputs[4],
            network_packet_rate: 120 + Math.random() * 30,
            network_burst_ratio: Math.random(),
            network_unauthorized_attempts: Math.random() < 0.03 ? 1 : 0
        };

        return this.applyScenarioToPayload(basePayload);
    }

    applyScenarioToPayload(payload) {
        const scenario = this.scenarios[this.activeScenarioKey] || this.scenarios.normal;
        const adjustedProductionRate = Number(payload.production_rate) * scenario.productionRateFactor;

        return {
            ...payload,
            production_rate: Math.max(0, Number(adjustedProductionRate.toFixed(2))),
            reject_rate: Number((payload.reject_rate + scenario.rejectRateOffset).toFixed(2)),
            in_flight_bottles: Math.max(payload.in_flight_bottles, scenario.minInflightBottles),
            network_packet_rate: scenario.networkPacketRate + (Math.random() * 8 - 4),
            network_burst_ratio: Math.min(1, Math.max(0, scenario.networkBurstRatio + (Math.random() * 0.04 - 0.02))),
            network_unauthorized_attempts: Math.max(0, scenario.unauthorizedAttempts + (Math.random() < 0.25 ? 1 : 0))
        };
    }

    setScenario(scenarioKey) {
        if (!this.scenarios[scenarioKey]) {
            return;
        }

        this.activeScenarioKey = scenarioKey;
        const scenarioLabel = this.scenarios[scenarioKey].label;

        const activeScenario = document.getElementById('active-scenario');
        if (activeScenario) {
            activeScenario.textContent = scenarioLabel;
        }

        const buttons = document.querySelectorAll('.scenario-btn');
        buttons.forEach((button) => {
            button.classList.toggle('active', button.dataset.scenario === scenarioKey);
        });
    }

    recordAnalysisStats(latencyMs, hasAlert) {
        this.analysisStats.totalRuns += 1;
        if (hasAlert) {
            this.analysisStats.anomalyRuns += 1;
        }

        this.analysisStats.latencySamples.push(latencyMs);
        if (this.analysisStats.latencySamples.length > 120) {
            this.analysisStats.latencySamples.shift();
        }
    }

    updateSessionKpis() {
        const analysisCount = document.getElementById('analysis-count');
        const anomalyHitRate = document.getElementById('anomaly-hit-rate');
        const avgLatency = document.getElementById('avg-inference-latency');

        const total = this.analysisStats.totalRuns;
        const hitRate = total > 0 ? Math.round((this.analysisStats.anomalyRuns / total) * 100) : 0;
        const latencyCount = this.analysisStats.latencySamples.length;
        const latencyAvg = latencyCount > 0
            ? Math.round(this.analysisStats.latencySamples.reduce((sum, value) => sum + value, 0) / latencyCount)
            : 0;

        if (analysisCount) {
            analysisCount.textContent = String(total);
        }
        if (anomalyHitRate) {
            anomalyHitRate.textContent = `${hitRate}%`;
        }
        if (avgLatency) {
            avgLatency.textContent = `${latencyAvg} ms`;
        }
    }

    updateExplainabilityPanel() {
        const modelVersion = document.getElementById('model-version');
        const riskLevel = document.getElementById('risk-level');
        const recommendedAction = document.getElementById('recommended-action');

        if (modelVersion) {
            modelVersion.textContent = this.latestAnalysis.modelVersion;
        }

        if (riskLevel) {
            const level = String(this.latestAnalysis.riskLevel || 'low').toLowerCase();
            riskLevel.textContent = level.toUpperCase();
            riskLevel.className = `risk-pill risk-${level}`;
        }

        if (recommendedAction) {
            recommendedAction.textContent = this.latestAnalysis.recommendedAction;
        }

        this.renderComponents('process-components', this.latestAnalysis.processComponents);
        this.renderComponents('network-components', this.latestAnalysis.networkComponents);
    }

    renderComponents(containerId, components = {}) {
        const container = document.getElementById(containerId);
        if (!container) {
            return;
        }

        const entries = Object.entries(components || {});
        if (entries.length === 0) {
            container.innerHTML = '<div class="component-empty">No active contributors</div>';
            return;
        }

        container.innerHTML = entries
            .sort((a, b) => Number(b[1]) - Number(a[1]))
            .map(([label, value]) => {
                const numericValue = Math.max(0, Math.min(100, Number(value) || 0));
                return `
                    <div class="component-item">
                        <div class="component-label-row">
                            <span>${label}</span>
                            <strong>${numericValue.toFixed(1)}</strong>
                        </div>
                        <div class="component-track">
                            <div class="component-fill" style="width: ${numericValue}%;"></div>
                        </div>
                    </div>
                `;
            })
            .join('');
    }

    exportDemoReport() {
        const report = {
            exported_at: new Date().toISOString(),
            scenario: this.scenarios[this.activeScenarioKey]?.label || 'Normal Baseline',
            kpis: {
                total_analyses: this.analysisStats.totalRuns,
                anomaly_runs: this.analysisStats.anomalyRuns,
                anomaly_hit_rate_percent: this.analysisStats.totalRuns
                    ? Number(((this.analysisStats.anomalyRuns / this.analysisStats.totalRuns) * 100).toFixed(2))
                    : 0,
                avg_inference_latency_ms: this.analysisStats.latencySamples.length
                    ? Number((
                        this.analysisStats.latencySamples.reduce((sum, value) => sum + value, 0)
                        / this.analysisStats.latencySamples.length
                    ).toFixed(2))
                    : 0
            },
            latest_analysis: this.latestAnalysis,
            recent_detection_events: this.detectionFeed.slice(0, 10)
        };

        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `bottle-factory-ml-report-${Date.now()}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    updateBackendStatus(isOnline) {
        this.backendOnline = isOnline;
        const element = document.getElementById('backend-status');

        if (!element) {
            return;
        }

        if (isOnline) {
            element.textContent = 'ONLINE';
            element.className = 'status-value backend-online';
        } else {
            element.textContent = 'OFFLINE';
            element.className = 'status-value backend-offline';
        }
    }

    pushDetectionEvent(analysis) {
        if (!analysis.processAnomaly && !analysis.networkAlert) {
            return;
        }

        const reasonText = analysis.reasons.length ? analysis.reasons.join(' | ') : 'No reason provided';

        this.detectionFeed.unshift({
            timestamp: Date.now(),
            processAnomaly: analysis.processAnomaly,
            networkAlert: analysis.networkAlert,
            processScore: analysis.processScore,
            networkScore: analysis.networkScore,
            riskLevel: analysis.riskLevel,
            scenario: this.scenarios[this.activeScenarioKey]?.label || 'Normal Baseline',
            reason: reasonText
        });

        if (this.detectionFeed.length > 20) {
            this.detectionFeed.length = 20;
        }
    }

    updateDetectionFeed() {
        const feed = document.getElementById('detection-feed');
        if (!feed) {
            return;
        }

        if (this.detectionFeed.length === 0) {
            feed.innerHTML = '<div class="no-alarms">No anomaly or security events</div>';
            return;
        }

        feed.innerHTML = this.detectionFeed.map((entry) => {
            const tags = [];
            if (entry.processAnomaly) {
                tags.push('PROCESS');
            }
            if (entry.networkAlert) {
                tags.push('NETWORK');
            }

            return `
                <div class="feed-item">
                    <span class="alarm-time">${new Date(entry.timestamp).toLocaleTimeString()}</span>
                    <span class="feed-tags">${tags.join('+')}</span>
                    <span class="feed-message">[${String(entry.riskLevel || 'low').toUpperCase()}] ${entry.scenario} | P:${Math.round(entry.processScore)} N:${Math.round(entry.networkScore)} - ${entry.reason}</span>
                </div>
            `;
        }).join('');
    }
    
    // PLC Event Handlers
    onInputChange(address, value) {
        console.log(`Input ${address} changed to ${value}`);
    }
    
    onOutputChange(address, value) {
        console.log(`Output ${address} changed to ${value}`);
        
        // Update visual indicators for specific outputs
        if (address === 'O:0/0') {
            // Conveyor motor
            const conveyorElement = document.querySelector('.conveyor-belt');
            if (conveyorElement) {
                if (value) {
                    conveyorElement.classList.add('conveyor-running');
                } else {
                    conveyorElement.classList.remove('conveyor-running');
                }
            }
        }
    }
    
    onScanComplete(scanCount) {
        // Update scan count display if needed
        // console.log(`PLC scan ${scanCount} completed`);
    }
}

// Alarm Management System
class AlarmManager {
    constructor() {
        this.alarms = new Map();
        this.alarmHistory = [];
    }
    
    addAlarm(id, message, severity = 'warning') {
        const alarm = {
            id: id,
            message: message,
            severity: severity,
            timestamp: Date.now(),
            acknowledged: false
        };
        
        this.alarms.set(id, alarm);
        this.alarmHistory.push(alarm);
        
        console.warn(`ALARM: ${message}`);
        
        // Auto-acknowledge non-critical alarms after 10 seconds
        if (severity !== 'critical') {
            setTimeout(() => {
                this.acknowledgeAlarm(id);
            }, 10000);
        }
    }
    
    clearAlarm(id) {
        const alarm = this.alarms.get(id);
        if (alarm) {
            alarm.cleared = true;
            alarm.clearedAt = Date.now();
            this.alarms.delete(id);
        }
    }
    
    acknowledgeAlarm(id) {
        const alarm = this.alarms.get(id);
        if (alarm) {
            alarm.acknowledged = true;
        }
    }
    
    clearAllAlarms() {
        this.alarms.clear();
    }
    
    getActiveAlarms() {
        return Array.from(this.alarms.values());
    }
    
    getAlarmHistory() {
        return this.alarmHistory;
    }
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new BottleFactoryPLC();
    
    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 's':
                    e.preventDefault();
                    if (window.app.isRunning) {
                        window.app.stop();
                    } else {
                        window.app.start();
                    }
                    break;
                case 'r':
                    e.preventDefault();
                    window.app.reset();
                    break;
                case 'e':
                    e.preventDefault();
                    window.app.emergencyStop();
                    break;
            }
        }
    });
    
    console.log('Bottle Factory PLC Emulator initialized');
    console.log('Keyboard shortcuts:');
    console.log('  Ctrl/Cmd + S: Start/Stop');
    console.log('  Ctrl/Cmd + R: Reset');
    console.log('  Ctrl/Cmd + E: Emergency Stop');
});
