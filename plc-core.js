class PLCCore {
    constructor() {
        this.inputs = new Array(16).fill(false);  // I:0/0 to I:0/15
        this.outputs = new Array(16).fill(false); // O:0/0 to O:0/15
        this.runMode = false;
        this.cycleTime = 100; // ms
        this.scanCount = 0;
        this.errorState = false;
        this.emergencyStopActive = false;
        
        // Timer and counter arrays
        this.timers = [];
        this.counters = [];
        this.timerMap = new Map();
        this.counterMap = new Map();
        
        // Data tables
        this.dataRegisters = new Array(100).fill(0);
        
        // Event callbacks
        this.onInputChange = [];
        this.onOutputChange = [];
        this.onScanComplete = [];

        // Scan debugger instrumentation
        this.scanHistory = [];       // last N scan records
        this.maxScanHistory = 50;
        this.lastScanRecord = null;  // most recent scan detail
    }
    
    // Input/Output operations
    setInput(address, value) {
        const index = this.parseAddress(address);
        if (index >= 0 && index < this.inputs.length) {
            const oldValue = this.inputs[index];
            this.inputs[index] = value;
            
            if (oldValue !== value) {
                this.notifyInputChange(address, value);
            }
        }
    }

    getInput(address) {
        const index = this.parseAddress(address);
        if (index >= 0 && index < this.inputs.length) {
            return this.inputs[index];
        }
        return false;
    }
    
    getOutput(address) {
        const index = this.parseAddress(address);
        if (index >= 0 && index < this.outputs.length) {
            return this.outputs[index];
        }
        return false;
    }
    
    setOutput(address, value) {
        const index = this.parseAddress(address);
        if (index >= 0 && index < this.outputs.length) {
            const oldValue = this.outputs[index];
            this.outputs[index] = value;
            
            if (oldValue !== value) {
                this.notifyOutputChange(address, value);
            }
        }
    }
    
    parseAddress(address) {
        // Parse addresses like "I:0/0" or "O:0/7"
        const match = address.match(/([IO]):(\d+)\/(\d+)/);
        if (match) {
            return parseInt(match[3]);
        }
        return -1;
    }
    
    // Control operations
    start() {
        if (!this.emergencyStopActive && !this.errorState) {
            this.runMode = true;
            this.runScanning();
        }
    }
    
    stop() {
        this.runMode = false;
    }
    
    triggerEmergencyStop() {
        this.emergencyStopActive = true;
        this.runMode = false;
        this.outputs.fill(false);
        this.notifyAllOutputsChanged();
    }
    
    reset() {
        this.emergencyStopActive = false;
        this.errorState = false;
        this.scanCount = 0;
        this.outputs.fill(false);
        this.timers = [];
        this.counters = [];
        this.timerMap.clear();
        this.counterMap.clear();
        this.notifyAllOutputsChanged();
    }
    
    // Attach a LadderProgram to drive execution
    setLadderProgram(program) {
        this.ladderProgram = program;
    }

    // Main scan cycle
    runScanning() {
        if (!this.runMode) return;
        
        const startTime = Date.now();
        const scanRecord = {
            scanNumber: this.scanCount,
            timestamp: startTime,
            phases: { input: 0, logic: 0, output: 0 },
            totalUs: 0,
            rungResults: [],
            inputSnapshot: [...this.inputs],
            outputBefore: [...this.outputs],
            outputAfter: null,
            error: null,
        };
        
        try {
            // Phase 1: Read inputs
            const t0 = performance.now();
            this.readInputs();
            const t1 = performance.now();
            scanRecord.phases.input = (t1 - t0) * 1000; // microseconds
            
            // Phase 2: Execute ladder logic (with per-rung timing)
            this._currentRungResults = [];
            this.executeLadderLogic();
            const t2 = performance.now();
            scanRecord.phases.logic = (t2 - t1) * 1000;
            scanRecord.rungResults = this._currentRungResults;
            
            // Phase 3: Update outputs
            this.updateOutputs();
            const t3 = performance.now();
            scanRecord.phases.output = (t3 - t2) * 1000;
            
            scanRecord.totalUs = (t3 - t0) * 1000;
            scanRecord.outputAfter = [...this.outputs];
            
            this.scanCount++;
            this.lastScanRecord = scanRecord;
            this.scanHistory.push(scanRecord);
            if (this.scanHistory.length > this.maxScanHistory) {
                this.scanHistory.shift();
            }
            
            this.notifyScanComplete();
            
        } catch (error) {
            scanRecord.error = error.message;
            this.errorState = true;
            this.runMode = false;
            console.error('PLC Scan Error:', error);
        }
        
        // Calculate next scan time
        const elapsed = Date.now() - startTime;
        const nextScan = Math.max(0, this.cycleTime - elapsed);
        
        if (this.runMode) {
            setTimeout(() => this.runScanning(), nextScan);
        }
    }
    
    readInputs() {
        // Simulate reading physical inputs
        // In a real PLC, this would read from hardware
    }
    
    executeLadderLogic() {
        // Built-in security lockout (always runs)
        const processAnomaly = this.inputs[8];
        const networkAlert = this.inputs[9];
        const securityLockout = processAnomaly || networkAlert;
        this.setOutput('O:0/8', securityLockout);

        // Execute the attached ladder program
        if (this.ladderProgram) {
            this.ladderProgram.execute(this);
        }
    }
    
    updateOutputs() {
        // Simulate writing to physical outputs
        // In a real PLC, this would write to hardware
    }

    getOrCreateTimer(tag, preset = 1000) {
        const key = String(tag || `T:${this.timers.length}`).trim();
        const parsedPreset = Number(preset);
        const safePreset = Number.isFinite(parsedPreset) && parsedPreset > 0 ? parsedPreset : 1000;

        let timer = this.timerMap.get(key);
        if (!timer) {
            timer = {
                id: key,
                preset: safePreset,
                accumulated: 0,
                enabled: false,
                done: false,
                type: 'TON'
            };
            this.timerMap.set(key, timer);
            this.timers.push(timer);
        } else {
            timer.preset = safePreset;
        }

        return timer;
    }

    getOrCreateCounter(tag, preset = 1) {
        const key = String(tag || `C:${this.counters.length}`).trim();
        const parsedPreset = Number(preset);
        const safePreset = Number.isFinite(parsedPreset) && parsedPreset > 0 ? parsedPreset : 1;

        let counter = this.counterMap.get(key);
        if (!counter) {
            counter = {
                id: key,
                preset: safePreset,
                accumulated: 0,
                enabled: false,
                done: false,
                prevEnabled: false,
                type: 'CTU'
            };
            this.counterMap.set(key, counter);
            this.counters.push(counter);
        } else {
            counter.preset = safePreset;
        }

        return counter;
    }

    executeTON(timerTag, preset, enabled) {
        const timer = this.getOrCreateTimer(timerTag, preset);
        timer.enabled = Boolean(enabled);

        if (timer.enabled) {
            timer.accumulated = Math.min(timer.accumulated + this.cycleTime, timer.preset);
            timer.done = timer.accumulated >= timer.preset;
        } else {
            timer.accumulated = 0;
            timer.done = false;
        }

        return timer.done;
    }

    executeCTU(counterTag, preset, enabled) {
        const counter = this.getOrCreateCounter(counterTag, preset);
        const isEnabled = Boolean(enabled);
        const risingEdge = isEnabled && !counter.prevEnabled;

        if (risingEdge) {
            counter.accumulated += 1;
            if (counter.accumulated >= counter.preset) {
                counter.done = true;
            }
        }

        counter.enabled = isEnabled;
        counter.prevEnabled = isEnabled;
        return counter.done;
    }

    getTimerBit(address) {
        const [tag, rawBit] = String(address).split('/');
        const bit = (rawBit || 'DN').toUpperCase();
        const timer = this.timerMap.get(tag);
        if (!timer) return false;

        if (bit === 'EN') return timer.enabled;
        if (bit === 'TT') return timer.enabled && !timer.done;
        return timer.done;
    }

    getCounterBit(address) {
        const [tag, rawBit] = String(address).split('/');
        const bit = (rawBit || 'DN').toUpperCase();
        const counter = this.counterMap.get(tag);
        if (!counter) return false;

        if (bit === 'EN') return counter.enabled;
        return counter.done;
    }
    
    // Timer operations
    createTimer(preset, type = 'TON') {
        const timer = {
            id: this.timers.length,
            preset: preset,
            accumulated: 0,
            enabled: false,
            done: false,
            type: type // TON (On-delay), TOF (Off-delay), RTO (Retentive)
        };
        this.timers.push(timer);
        return timer.id;
    }
    
    updateTimers() {
        this.timers.forEach(timer => {
            if (timer.enabled && !timer.done) {
                timer.accumulated += this.cycleTime;
                if (timer.accumulated >= timer.preset) {
                    timer.done = true;
                }
            } else if (!timer.enabled && timer.type === 'TOF') {
                timer.accumulated -= this.cycleTime;
                if (timer.accumulated <= 0) {
                    timer.accumulated = 0;
                    timer.done = false;
                }
            }
        });
    }
    
    // Counter operations
    createCounter(preset, type = 'CTU') {
        const counter = {
            id: this.counters.length,
            preset: preset,
            accumulated: 0,
            enabled: false,
            done: false,
            type: type // CTU (Count Up), CTD (Count Down)
        };
        this.counters.push(counter);
        return counter.id;
    }
    
    incrementCounter(id) {
        const counter = this.counters[id];
        if (counter && counter.type === 'CTU') {
            counter.accumulated++;
            if (counter.accumulated >= counter.preset) {
                counter.done = true;
            }
        }
    }
    
    // Event notification methods
    notifyInputChange(address, value) {
        this.onInputChange.forEach(callback => callback(address, value));
    }
    
    notifyOutputChange(address, value) {
        this.onOutputChange.forEach(callback => callback(address, value));
    }
    
    notifyAllOutputsChanged() {
        for (let i = 0; i < this.outputs.length; i++) {
            this.notifyOutputChange(`O:0/${i}`, this.outputs[i]);
        }
    }
    
    notifyScanComplete() {
        this.onScanComplete.forEach(callback => callback(this.scanCount));
    }
    
    // Utility methods
    getStatus() {
        return {
            runMode: this.runMode,
            errorState: this.errorState,
            emergencyStop: this.emergencyStopActive,
            scanCount: this.scanCount,
            cycleTime: this.cycleTime
        };
    }
    
    getIOState() {
        return {
            inputs: [...this.inputs],
            outputs: [...this.outputs]
        };
    }
}

// Ladder Logic Instruction Set
class LadderInstruction {
    constructor(type, operands) {
        this.type = type;
        this.operands = operands;
    }
    
    readBit(plc, address) {
        if (address.startsWith('T:')) return plc.getTimerBit(address);
        if (address.startsWith('C:')) return plc.getCounterBit(address);
        if (address.startsWith('O:')) return plc.getOutput(address);
        return plc.getInput(address);
    }

    execute(plc, rungCondition = true) {
        switch (this.type) {
            case 'XIC': // Examine If Closed
                return this.readBit(plc, this.operands[0]);
                
            case 'XIO': // Examine If Open
                return !this.readBit(plc, this.operands[0]);
                
            case 'OTE': // Output Energize
                plc.setOutput(this.operands[0], true);
                return true;
                
            case 'OTL': // Output Latch
                plc.setOutput(this.operands[0], true);
                return true;
                
            case 'OTU': // Output Unlatch
                plc.setOutput(this.operands[0], false);
                return true;
                
            case 'TON': // Timer On-Delay
                return plc.executeTON(this.operands[0], this.operands[1], rungCondition);
                
            case 'CTU': // Count Up
                return plc.executeCTU(this.operands[0], this.operands[1], rungCondition);
                
            default:
                return false;
        }
    }
}

// Ladder Rung Class
class LadderRung {
    constructor(instructions = []) {
        this.instructions = instructions;
    }
    
    execute(plc) {
        const rungStart = performance.now();
        let result = true;
        const instrResults = [];
        
        for (let instruction of this.instructions) {
            if (instruction.type.startsWith('X')) {
                // Input instruction - evaluate condition
                const condition = instruction.execute(plc);
                instrResults.push({ type: instruction.type, addr: instruction.operands[0], passed: condition });
                result = result && condition;
            } else if (instruction.type.startsWith('T') || instruction.type.startsWith('C')) {
                // Timer/counter instructions execute with rung condition and can gate downstream logic
                const condition = instruction.execute(plc, result);
                instrResults.push({ type: instruction.type, addr: instruction.operands[0], passed: condition });
                result = result && condition;
            } else if (instruction.type.startsWith('O')) {
                // Output instruction - energize or de-energize based on conditions
                if (result) {
                    instruction.execute(plc);
                } else if (instruction.type === 'OTE') {
                    plc.setOutput(instruction.operands[0], false);
                }
                instrResults.push({ type: instruction.type, addr: instruction.operands[0], passed: result });
            }
        }
        
        this.energized = result;
        const rungEnd = performance.now();
        const rungUs = (rungEnd - rungStart) * 1000;

        // Record to PLC scan if instrumented
        if (plc._currentRungResults) {
            const outputChanged = instrResults.some(i =>
                (i.type === 'OTE' || i.type === 'OTL' || i.type === 'OTU') && i.passed !== undefined
            );
            plc._currentRungResults.push({
                energized: result,
                timeUs: rungUs,
                instructions: instrResults,
                outputChanged,
            });
        }

        return result;
    }
    
    addInstruction(instruction) {
        this.instructions.push(instruction);
    }
}

// Ladder Program Class
class LadderProgram {
    constructor() {
        this.rungs = [];
        this.createDefaultProgram();
    }
    
    createDefaultProgram() {
        // Rung 1: System control
        this.rungs.push(new LadderRung([
            new LadderInstruction('XIO', ['I:0/0']), // Emergency Stop (normally closed)
            new LadderInstruction('XIC', ['I:0/1']), // Start Button
            new LadderInstruction('OTE', ['O:0/6'])  // System Ready Light
        ]));
        
        // Rung 2: Conveyor control
        this.rungs.push(new LadderRung([
            new LadderInstruction('XIC', ['O:0/6']), // System Ready
            new LadderInstruction('XIO', ['I:0/2']), // Stop Button (normally closed)
            new LadderInstruction('OTE', ['O:0/0'])  // Conveyor Motor
        ]));
        
        // Rung 3: Filler control
        this.rungs.push(new LadderRung([
            new LadderInstruction('XIC', ['O:0/0']), // Conveyor Running
            new LadderInstruction('XIC', ['I:0/3']), // Bottle at Filler
            new LadderInstruction('XIC', ['I:0/6']), // Level Sensor Ready
            new LadderInstruction('OTE', ['O:0/1'])  // Fill Valve
        ]));
        
        // Rung 4: Capper control
        this.rungs.push(new LadderRung([
            new LadderInstruction('XIC', ['O:0/0']), // Conveyor Running
            new LadderInstruction('XIC', ['I:0/4']), // Bottle at Capper
            new LadderInstruction('XIC', ['I:0/7']), // Cap Available
            new LadderInstruction('OTE', ['O:0/2'])  // Capper Motor
        ]));
        
        // Rung 5: Quality check
        this.rungs.push(new LadderRung([
            new LadderInstruction('XIC', ['O:0/0']), // Conveyor Running
            new LadderInstruction('XIC', ['I:0/5']), // Bottle at Quality
            new LadderInstruction('OTE', ['O:0/3'])  // Quality Light
        ]));
        
        // Rung 6: Reject gate
        this.rungs.push(new LadderRung([
            new LadderInstruction('XIC', ['O:0/3']), // Quality Check Active
            // Additional logic for reject condition would go here
            new LadderInstruction('OTE', ['O:0/4'])  // Reject Gate
        ]));
        
        // Rung 7: Alarm control
        this.rungs.push(new LadderRung([
            new LadderInstruction('XIC', ['I:0/0']), // Emergency Stop
            new LadderInstruction('OTE', ['O:0/5'])  // Alarm Horn
        ]));
        
        // Rung 8: Running light
        this.rungs.push(new LadderRung([
            new LadderInstruction('XIC', ['O:0/0']), // Conveyor Running
            new LadderInstruction('OTE', ['O:0/7'])  // Running Light
        ]));
    }
    
    execute(plc) {
        this.rungs.forEach(rung => rung.execute(plc));
    }
    
    addRung(rung) {
        this.rungs.push(rung);
    }
}
