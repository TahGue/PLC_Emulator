// Station Manager - Groups components into named stations with KPIs and fault aggregation
class StationManager {
    constructor() {
        this.stations = new Map(); // stationId -> Station
        this.tickCount = 0;
        this.onUpdate = null; // callback(stations[])
    }

    // ── Station Auto-Detection ───────────────────────────────────
    // Analyzes component layout to identify stations by:
    // 1. Named hints in component labels (fill, cap, sort, mix, etc.)
    // 2. Spatial clustering of connected components
    // 3. Wiring connectivity analysis
    autoDetect(engine) {
        this.stations.clear();
        const allComps = engine.getAllComponents();
        const wires = engine.wires;
        if (allComps.length === 0) return;

        // Build adjacency from wires
        const adj = new Map(); // compId -> Set(compId)
        for (const comp of allComps) adj.set(comp.id, new Set());
        for (const w of wires) {
            if (adj.has(w.fromComp) && adj.has(w.toComp)) {
                adj.get(w.fromComp).add(w.toComp);
                adj.get(w.toComp).add(w.fromComp);
            }
        }

        // Identify station seeds: actuators + process elements with meaningful labels
        const stationSeeds = [];
        const usedComps = new Set();

        // Strategy 1: Named station groups from label keywords
        const stationKeywords = [
            { pattern: /fill/i, type: 'fill_station', name: 'Fill Station', icon: '🫗' },
            { pattern: /cap/i, type: 'cap_station', name: 'Cap Station', icon: '🔩' },
            { pattern: /sort|divert|path/i, type: 'sort_station', name: 'Sorting Station', icon: '🔀' },
            { pattern: /mix/i, type: 'mix_station', name: 'Mix Station', icon: '🌀' },
            { pattern: /heat|htr/i, type: 'heat_station', name: 'Heating Station', icon: '🔥' },
            { pattern: /drain/i, type: 'drain_station', name: 'Drain Station', icon: '🚰' },
            { pattern: /wash|rinse|cip|clean/i, type: 'wash_station', name: 'Wash Station', icon: '🧼' },
            { pattern: /qual|inspect|check/i, type: 'quality_station', name: 'Quality Check', icon: '✅' },
            { pattern: /reject/i, type: 'reject_station', name: 'Reject Station', icon: '❌' },
            { pattern: /conv|belt|infeed|outfeed|merge/i, type: 'conveyor_station', name: 'Conveyor', icon: '➡️' },
            { pattern: /tank/i, type: 'tank_station', name: 'Tank', icon: '🛢️' },
            { pattern: /pump/i, type: 'pump_station', name: 'Pump Station', icon: '🔄' },
        ];

        // Gather actuators and process elements as station anchors
        const anchors = allComps.filter(c => {
            const def = engine.registry.get(c.type);
            return def && (def.category === 'actuators' || def.category === 'process');
        });

        // Group anchors by spatial proximity + label matching
        const spatialGroups = this._spatialCluster(anchors, 200);

        let stationIdx = 0;
        for (const group of spatialGroups) {
            // Find a keyword match for this group
            let stationType = 'work_station';
            let stationName = 'Station ' + (stationIdx + 1);
            let stationIcon = '⚙️';

            for (const comp of group) {
                const label = comp.props?.label || comp.id || '';
                for (const kw of stationKeywords) {
                    if (kw.pattern.test(label)) {
                        stationType = kw.type;
                        stationName = kw.name;
                        stationIcon = kw.icon;
                        break;
                    }
                }
                if (stationType !== 'work_station') break;
            }

            // Expand group by including directly-connected components (sensors, logic, indicators)
            const expandedIds = new Set(group.map(c => c.id));
            for (const comp of group) {
                const neighbors = adj.get(comp.id) || new Set();
                for (const nId of neighbors) {
                    if (!usedComps.has(nId)) expandedIds.add(nId);
                }
            }

            // Don't re-use components in multiple stations
            const finalIds = new Set();
            for (const id of expandedIds) {
                if (!usedComps.has(id)) {
                    finalIds.add(id);
                    usedComps.add(id);
                }
            }

            if (finalIds.size < 2) continue; // Skip trivial groups

            // Determine station I/O boundaries
            const inputs = [];
            const outputs = [];
            for (const w of wires) {
                if (finalIds.has(w.toComp) && !finalIds.has(w.fromComp)) {
                    inputs.push({ wireId: w.id, fromComp: w.fromComp, fromPort: w.fromPort, toComp: w.toComp, toPort: w.toPort });
                }
                if (finalIds.has(w.fromComp) && !finalIds.has(w.toComp)) {
                    outputs.push({ wireId: w.id, fromComp: w.fromComp, fromPort: w.fromPort, toComp: w.toComp, toPort: w.toPort });
                }
            }

            // Calculate center position
            const compsInStation = Array.from(finalIds).map(id => engine.components.get(id)).filter(Boolean);
            const cx = compsInStation.reduce((s, c) => s + c.x, 0) / compsInStation.length;
            const cy = compsInStation.reduce((s, c) => s + c.y, 0) / compsInStation.length;

            const stationId = `station_${stationIdx}`;
            this.stations.set(stationId, {
                id: stationId,
                name: stationName,
                type: stationType,
                icon: stationIcon,
                componentIds: finalIds,
                inputs,
                outputs,
                center: { x: cx, y: cy },
                timing: { cycleTarget: 5000, tolerance: 1000 },
                metrics: {
                    cyclesCompleted: 0,
                    avgCycleTime: 0,
                    lastCycleTime: 0,
                    cycleStartTime: 0,
                    efficiency: 100,
                    uptime: 100,
                    uptimeStart: Date.now(),
                    faultTime: 0,
                },
                status: 'idle', // idle, running, faulted, maintenance
                faults: [],
            });

            stationIdx++;
        }

        // Create a "Control" station for remaining switches/logic not assigned
        const controlIds = new Set();
        for (const comp of allComps) {
            if (!usedComps.has(comp.id)) {
                const def = engine.registry.get(comp.type);
                if (def && (def.category === 'sensors' || def.category === 'logic' || def.category === 'indicators')) {
                    controlIds.add(comp.id);
                    usedComps.add(comp.id);
                }
            }
        }
        if (controlIds.size >= 2) {
            const controlComps = Array.from(controlIds).map(id => engine.components.get(id)).filter(Boolean);
            const cx = controlComps.reduce((s, c) => s + c.x, 0) / controlComps.length;
            const cy = controlComps.reduce((s, c) => s + c.y, 0) / controlComps.length;
            this.stations.set('station_control', {
                id: 'station_control',
                name: 'Control Logic',
                type: 'control',
                icon: '🎛️',
                componentIds: controlIds,
                inputs: [],
                outputs: [],
                center: { x: cx, y: cy },
                timing: { cycleTarget: 0, tolerance: 0 },
                metrics: {
                    cyclesCompleted: 0, avgCycleTime: 0, lastCycleTime: 0,
                    cycleStartTime: 0, efficiency: 100, uptime: 100,
                    uptimeStart: Date.now(), faultTime: 0,
                },
                status: 'idle',
                faults: [],
            });
        }

        console.log(`[Station] Auto-detected ${this.stations.size} stations`);
        return this.stations;
    }

    _spatialCluster(components, radius) {
        const clusters = [];
        const used = new Set();

        for (const comp of components) {
            if (used.has(comp.id)) continue;
            const cluster = [comp];
            used.add(comp.id);

            // Find all components within radius
            for (const other of components) {
                if (used.has(other.id)) continue;
                const dx = comp.x - other.x;
                const dy = comp.y - other.y;
                if (Math.sqrt(dx * dx + dy * dy) < radius) {
                    cluster.push(other);
                    used.add(other.id);
                }
            }
            clusters.push(cluster);
        }
        return clusters;
    }

    // ── Tick — Update station metrics and status ─────────────────
    tick(engine, dt) {
        this.tickCount++;
        const now = Date.now();

        for (const [stationId, station] of this.stations) {
            // Check component states for fault aggregation
            let anyFault = false;
            let anyRunning = false;
            const faults = [];

            for (const compId of station.componentIds) {
                const comp = engine.components.get(compId);
                if (!comp) continue;
                const def = engine.registry.get(comp.type);
                if (!def) continue;

                // Detect faults
                if (comp.state.fault || comp.outputValues.fault) {
                    anyFault = true;
                    faults.push({ compId, compLabel: comp.props?.label || comp.type, fault: 'component_fault' });
                }

                // Detect running actuators/process
                if (def.category === 'actuators' || def.category === 'process') {
                    if (comp.state.running || comp.state.speedPct > 1 || comp.state.heating ||
                        comp.state.cylPhase === 'extending' || comp.state.cylPhase === 'retracting' ||
                        comp.state.valvePhase === 'opening' || comp.state.valvePhase === 'open') {
                        anyRunning = true;
                    }
                }
            }

            // Update status
            const prevStatus = station.status;
            if (anyFault) {
                station.status = 'faulted';
                station.faults = faults;
                station.metrics.faultTime += dt;
            } else if (anyRunning) {
                station.status = 'running';
                station.faults = [];
            } else {
                station.status = 'idle';
                station.faults = [];
            }

            // Cycle detection: running→idle transition = cycle complete
            if (prevStatus === 'running' && station.status === 'idle' && station.type !== 'control') {
                const cycleTime = now - (station.metrics.cycleStartTime || now);
                if (station.metrics.cycleStartTime > 0 && cycleTime > 500 && cycleTime < 60000) {
                    station.metrics.cyclesCompleted++;
                    station.metrics.lastCycleTime = cycleTime;
                    // Rolling average
                    const n = station.metrics.cyclesCompleted;
                    station.metrics.avgCycleTime =
                        station.metrics.avgCycleTime * ((n - 1) / n) + cycleTime / n;
                }
            }
            if (prevStatus !== 'running' && station.status === 'running') {
                station.metrics.cycleStartTime = now;
            }

            // Efficiency: based on cycle time vs target
            if (station.timing.cycleTarget > 0 && station.metrics.avgCycleTime > 0) {
                station.metrics.efficiency = Math.min(100, Math.max(0,
                    (station.timing.cycleTarget / station.metrics.avgCycleTime) * 100
                ));
            }

            // Uptime: time not faulted / total time
            const totalTime = now - station.metrics.uptimeStart;
            if (totalTime > 0) {
                station.metrics.uptime = Math.max(0,
                    ((totalTime - station.metrics.faultTime) / totalTime) * 100
                );
            }
        }

        if (this.onUpdate) this.onUpdate(this.getAll());
    }

    // ── Accessors ────────────────────────────────────────────────
    get(stationId) {
        return this.stations.get(stationId);
    }

    getAll() {
        return Array.from(this.stations.values());
    }

    getByComponent(compId) {
        for (const station of this.stations.values()) {
            if (station.componentIds.has(compId)) return station;
        }
        return null;
    }

    getOEE() {
        // Overall Equipment Effectiveness across all non-control stations
        const workStations = this.getAll().filter(s => s.type !== 'control');
        if (workStations.length === 0) return { availability: 100, performance: 100, quality: 100, oee: 100 };

        const avgUptime = workStations.reduce((s, st) => s + st.metrics.uptime, 0) / workStations.length;
        const avgEfficiency = workStations.reduce((s, st) => s + st.metrics.efficiency, 0) / workStations.length;
        // Quality is assumed 100% for now (no reject tracking per station yet)
        const quality = 100;

        return {
            availability: Math.round(avgUptime * 10) / 10,
            performance: Math.round(avgEfficiency * 10) / 10,
            quality,
            oee: Math.round((avgUptime / 100) * (avgEfficiency / 100) * (quality / 100) * 1000) / 10
        };
    }

    getStats() {
        const all = this.getAll();
        return {
            total: all.length,
            running: all.filter(s => s.status === 'running').length,
            faulted: all.filter(s => s.status === 'faulted').length,
            idle: all.filter(s => s.status === 'idle').length,
            totalCycles: all.reduce((s, st) => s + st.metrics.cyclesCompleted, 0),
        };
    }

    reset() {
        this.stations.clear();
        this.tickCount = 0;
    }
}
