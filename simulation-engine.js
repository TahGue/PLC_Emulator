// Simulation Engine - Generic signal propagation for custom PLC layouts
class SimulationEngine {
    constructor(registry) {
        this.registry = registry;
        this.components = new Map();   // id -> { type, x, y, props, state, inputValues, outputValues }
        this.wires = [];               // [{ id, fromComp, fromPort, toComp, toPort }]
        this.running = false;
        this.lastTick = 0;
        this.tickRate = 50;            // ms between simulation ticks
        this.tickTimer = null;
        this.onTick = null;            // callback after each tick
        this.plcInputMap = new Map();  // address -> { compId, portId }
        this.plcOutputMap = new Map(); // address -> { compId, portId }
        this.nextWireId = 1;
    }

    // ── Layout Management ────────────────────────────────────────
    addComponent(id, type, x, y, props = {}) {
        const def = this.registry.get(type);
        if (!def) return null;
        const mergedProps = { ...def.defaultProps, ...props };
        const comp = {
            id, type, x, y,
            props: mergedProps,
            state: {},
            inputValues: {},
            outputValues: {}
        };
        this.components.set(id, comp);
        this.rebuildAddressMaps();
        return comp;
    }

    removeComponent(id) {
        this.components.delete(id);
        this.wires = this.wires.filter(w => w.fromComp !== id && w.toComp !== id);
        this.rebuildAddressMaps();
    }

    moveComponent(id, x, y) {
        const comp = this.components.get(id);
        if (comp) { comp.x = x; comp.y = y; }
    }

    updateComponentProps(id, props) {
        const comp = this.components.get(id);
        if (comp) {
            comp.props = { ...comp.props, ...props };
            this.rebuildAddressMaps();
        }
    }

    addWire(fromComp, fromPort, toComp, toPort) {
        // Prevent duplicate wires
        const exists = this.wires.some(w =>
            w.fromComp === fromComp && w.fromPort === fromPort &&
            w.toComp === toComp && w.toPort === toPort
        );
        if (exists) return null;

        // Prevent connecting to already-connected input
        const inputTaken = this.wires.some(w => w.toComp === toComp && w.toPort === toPort);
        if (inputTaken) return null;

        const wire = { id: this.nextWireId++, fromComp, fromPort, toComp, toPort };
        this.wires.push(wire);
        return wire;
    }

    removeWire(wireId) {
        this.wires = this.wires.filter(w => w.id !== wireId);
    }

    getComponent(id) {
        return this.components.get(id);
    }

    getAllComponents() {
        return Array.from(this.components.values());
    }

    getAllWires() {
        return this.wires;
    }

    // ── PLC Address Mapping ──────────────────────────────────────
    rebuildAddressMaps() {
        this.plcInputMap.clear();
        this.plcOutputMap.clear();

        for (const [id, comp] of this.components) {
            const addr = comp.props.address;
            if (!addr) continue;

            const def = this.registry.get(comp.type);
            if (!def) continue;

            // Sensors with output ports map to PLC inputs
            if (def.category === 'sensors') {
                const outPort = def.ports.find(p => p.type === 'output');
                if (outPort) {
                    this.plcInputMap.set(addr, { compId: id, portId: outPort.id });
                }
            }

            // Actuators with input ports map to PLC outputs
            if (def.category === 'actuators' || def.category === 'indicators') {
                const inPort = def.ports.find(p => p.type === 'input');
                if (inPort) {
                    this.plcOutputMap.set(addr, { compId: id, portId: inPort.id });
                }
            }
        }
    }

    // Read sensor outputs → PLC inputs
    readSensorsToPLC(plc) {
        for (const [address, mapping] of this.plcInputMap) {
            const comp = this.components.get(mapping.compId);
            if (!comp) continue;
            const value = comp.outputValues[mapping.portId];
            const index = this.parseAddress(address);
            if (index >= 0) {
                // Digital: set boolean; Analog: set data register
                if (typeof value === 'boolean') {
                    plc.setInput(address, value);
                } else if (typeof value === 'number') {
                    plc.setInput(address, value > 0);
                    // Also store analog value in data register
                    if (index < plc.dataRegisters.length) {
                        plc.dataRegisters[index] = value;
                    }
                }
            }
        }
    }

    // Write PLC outputs → actuator inputs
    writePLCToActuators(plc) {
        for (const [address, mapping] of this.plcOutputMap) {
            const comp = this.components.get(mapping.compId);
            if (!comp) continue;
            const value = plc.getOutput(address);
            comp.inputValues[mapping.portId] = value;
        }
    }

    parseAddress(address) {
        const match = address.match(/([IO]):(\d+)\/(\d+)/);
        if (match) return parseInt(match[3]);
        return -1;
    }

    // ── Simulation Loop ──────────────────────────────────────────
    start() {
        if (this.running) return;
        this.running = true;
        this.lastTick = performance.now();
        this.tick();
    }

    stop() {
        this.running = false;
        if (this.tickTimer) {
            clearTimeout(this.tickTimer);
            this.tickTimer = null;
        }
    }

    reset() {
        this.stop();
        for (const comp of this.components.values()) {
            comp.state = {};
            comp.inputValues = {};
            comp.outputValues = {};
        }
    }

    tick() {
        if (!this.running) return;

        const now = performance.now();
        const dt = now - this.lastTick;
        this.lastTick = now;

        this.propagate(dt);

        if (this.onTick) this.onTick(dt);

        this.tickTimer = setTimeout(() => this.tick(), this.tickRate);
    }

    // Single propagation pass
    propagate(dt) {
        // 1. Propagate wire signals: copy output values to connected input values
        for (const wire of this.wires) {
            const fromComp = this.components.get(wire.fromComp);
            const toComp = this.components.get(wire.toComp);
            if (fromComp && toComp) {
                const val = fromComp.outputValues[wire.fromPort];
                toComp.inputValues[wire.toPort] = val !== undefined ? val : false;
            }
        }

        // 2. Evaluate each component in topological order
        const order = this.topologicalSort();
        for (const compId of order) {
            const comp = this.components.get(compId);
            if (!comp) continue;
            const def = this.registry.get(comp.type);
            if (!def || !def.simulate) continue;

            const result = def.simulate(
                comp.inputValues,
                comp.props,
                dt,
                comp.state
            );

            if (result.state) comp.state = result.state;
            if (result.outputs) comp.outputValues = result.outputs;
        }
    }

    // Topological sort of component graph for correct evaluation order
    topologicalSort() {
        const visited = new Set();
        const result = [];
        const visiting = new Set();

        const visit = (id) => {
            if (visited.has(id)) return;
            if (visiting.has(id)) return; // cycle
            visiting.add(id);

            // Visit all components that feed into this one
            for (const wire of this.wires) {
                if (wire.toComp === id) {
                    visit(wire.fromComp);
                }
            }

            visiting.delete(id);
            visited.add(id);
            result.push(id);
        };

        for (const id of this.components.keys()) {
            visit(id);
        }

        return result;
    }

    // ── Serialization ────────────────────────────────────────────
    serialize() {
        const comps = [];
        for (const [id, comp] of this.components) {
            comps.push({
                id, type: comp.type,
                x: comp.x, y: comp.y,
                props: { ...comp.props }
            });
        }
        return {
            version: 1,
            components: comps,
            wires: this.wires.map(w => ({
                fromComp: w.fromComp, fromPort: w.fromPort,
                toComp: w.toComp, toPort: w.toPort
            }))
        };
    }

    deserialize(data) {
        this.components.clear();
        this.wires = [];
        this.nextWireId = 1;

        if (!data || data.version !== 1) return;

        for (const c of data.components || []) {
            this.addComponent(c.id, c.type, c.x, c.y, c.props);
        }

        for (const w of data.wires || []) {
            this.addWire(w.fromComp, w.fromPort, w.toComp, w.toPort);
        }
    }

    // ── Component State Helpers (for UI interaction) ─────────────
    forceDigitalSensor(compId, value) {
        const comp = this.components.get(compId);
        if (!comp) return;
        comp.state.forced = value;
    }

    setAnalogSensorValue(compId, value) {
        const comp = this.components.get(compId);
        if (!comp) return;
        comp.state.value = value;
    }

    getComponentVisualState(compId) {
        const comp = this.components.get(compId);
        if (!comp) return {};
        return {
            active: comp.state.forced || comp.state.running || comp.state.on || false,
            inputs: comp.inputValues,
            outputs: comp.outputValues,
            value: comp.state.value,
            level: comp.state.level,
            elapsed: comp.state.elapsed,
            count: comp.state.count,
            preset: comp.props.preset,
            props: comp.props
        };
    }

    getWireState(wire) {
        const fromComp = this.components.get(wire.fromComp);
        if (!fromComp) return { active: false, value: false };
        const value = fromComp.outputValues[wire.fromPort];
        return {
            active: value === true || (typeof value === 'number' && value > 0),
            value: value
        };
    }

    // ── Production Metrics (generic) ─────────────────────────────
    getProductionMetrics() {
        let totalSensorsActive = 0;
        let totalActuatorsActive = 0;
        let totalComponents = this.components.size;

        for (const comp of this.components.values()) {
            const def = this.registry.get(comp.type);
            if (!def) continue;
            if (def.category === 'sensors' && (comp.state.forced || comp.outputValues.out)) {
                totalSensorsActive++;
            }
            if (def.category === 'actuators' && (comp.state.running || comp.state.open || comp.state.active)) {
                totalActuatorsActive++;
            }
        }

        return {
            totalComponents,
            activeSensors: totalSensorsActive,
            activeActuators: totalActuatorsActive,
            wires: this.wires.length,
            running: this.running
        };
    }
}
