class FactorySimulation {
    constructor() {
        this.conveyorSpeed = 1000; // ms per segment
        this.bottles = [];
        this.stations = {
            filler: { position: 1, processing: false, processTime: 2000 },
            capper: { position: 3, processing: false, processTime: 1500 },
            quality: { position: 5, processing: false, processTime: 1000 }
        };
        this.completedBottles = 0;
        this.rejectedBottles = 0;
        this.conveyorRunning = false;
        this.lastUpdateTime = Date.now();
        
        // Production metrics
        this.productionStartTime = null;
        this.totalProductionTime = 0;
        this.productionHistory = [];
        
        // Initialize bottle positions
        this.initializeBottles();
    }
    
    initializeBottles() {
        // Create initial bottles at various positions
        this.bottles = [
            { id: 1, position: 0, filled: false, capped: false, qualityChecked: false, rejected: false },
            { id: 2, position: 2, filled: false, capped: false, qualityChecked: false, rejected: false },
            { id: 3, position: 4, filled: false, capped: false, qualityChecked: false, rejected: false }
        ];
    }
    
    start() {
        this.conveyorRunning = true;
        this.productionStartTime = Date.now();
        this.runSimulation();
    }
    
    stop() {
        this.conveyorRunning = false;
        if (this.productionStartTime) {
            this.totalProductionTime += Date.now() - this.productionStartTime;
            this.productionStartTime = null;
        }
    }
    
    reset() {
        this.stop();
        this.bottles = [];
        this.completedBottles = 0;
        this.rejectedBottles = 0;
        this.totalProductionTime = 0;
        this.productionHistory = [];
        this.stations.filler.processing = false;
        this.stations.capper.processing = false;
        this.stations.quality.processing = false;
        this.initializeBottles();
    }
    
    runSimulation() {
        if (!this.conveyorRunning) return;
        
        const currentTime = Date.now();
        const deltaTime = currentTime - this.lastUpdateTime;
        this.lastUpdateTime = currentTime;
        
        // Update conveyor movement
        this.updateConveyor(deltaTime);
        
        // Update station processing
        this.updateStations(deltaTime);
        
        // Add new bottles periodically
        this.addNewBottle();
        
        // Update visual representation
        this.updateVisualization();
        
        // Continue simulation
        requestAnimationFrame(() => this.runSimulation());
    }
    
    updateConveyor(deltaTime) {
        // Move bottles along conveyor
        const toRemove = [];
        this.bottles.forEach(bottle => {
            // Simple movement logic - bottles move based on time
            const movement = deltaTime / this.conveyorSpeed;
            bottle.position += movement * 0.1; // Adjust speed as needed
            
            // Remove bottles that reach the end
            if (bottle.position > 6) {
                if (bottle.rejected) {
                    this.rejectedBottles++;
                } else if (bottle.qualityChecked) {
                    this.completedBottles++;
                    this.recordProduction();
                }
                toRemove.push(bottle);
            }
        });
        // Remove completed/rejected bottles (iterate backwards to avoid index issues)
        toRemove.forEach(bottle => {
            const index = this.bottles.indexOf(bottle);
            if (index !== -1) this.bottles.splice(index, 1);
        });
    }
    
    updateStations(deltaTime) {
        // Update filler station
        const fillerBottle = this.getBottleAtStation('filler');
        if (fillerBottle && !this.stations.filler.processing) {
            this.stations.filler.processing = true;
            setTimeout(() => {
                fillerBottle.filled = true;
                this.stations.filler.processing = false;
            }, this.stations.filler.processTime);
        }
        
        // Update capper station
        const capperBottle = this.getBottleAtStation('capper');
        if (capperBottle && capperBottle.filled && !this.stations.capper.processing) {
            this.stations.capper.processing = true;
            setTimeout(() => {
                capperBottle.capped = true;
                this.stations.capper.processing = false;
            }, this.stations.capper.processTime);
        }
        
        // Update quality station
        const qualityBottle = this.getBottleAtStation('quality');
        if (qualityBottle && qualityBottle.capped && !this.stations.quality.processing) {
            this.stations.quality.processing = true;
            setTimeout(() => {
                qualityBottle.qualityChecked = true;
                // Random quality check - 10% chance of rejection
                qualityBottle.rejected = Math.random() < 0.1;
                this.stations.quality.processing = false;
            }, this.stations.quality.processTime);
        }
    }
    
    getBottleAtStation(stationName) {
        const station = this.stations[stationName];
        return this.bottles.find(bottle => 
            Math.abs(bottle.position - station.position) < 0.5
        );
    }
    
    addNewBottle() {
        // Add new bottle at the start if there's space
        const hasSpace = !this.bottles.some(bottle => bottle.position < 0.5);
        
        if (hasSpace && Math.random() < 0.02) { // 2% chance per update
            const newBottle = {
                id: Date.now(),
                position: 0,
                filled: false,
                capped: false,
                qualityChecked: false,
                rejected: false
            };
            this.bottles.push(newBottle);
        }
    }
    
    // SVG coordinate mapping: bottle position 0-7 maps to X 70-840 on the belt
    positionToX(position) {
        return 70 + (position / 7) * 770;
    }

    updateVisualization() {
        const svg = document.getElementById('factory-svg');
        if (!svg) return;

        // Update conveyor belt animation
        const conveyorGroup = document.getElementById('conveyor-group');
        if (conveyorGroup) {
            if (this.conveyorRunning) {
                svg.classList.add('belt-running');
            } else {
                svg.classList.remove('belt-running');
            }
        }

        // Update station visuals
        this.updateStationSVG('filler');
        this.updateStationSVG('capper');
        this.updateStationSVG('quality');

        // Update bottles on SVG
        this.updateBottleSVGs();

        // Update output/reject counters
        this.updateCounterSVGs();

        // Update sensor badges
        this.updateSensorBadges();
    }

    updateStationSVG(stationName) {
        const station = this.stations[stationName];
        const stationGroup = document.getElementById(`station-${stationName}`);
        if (!stationGroup) return;

        const glowEl = document.getElementById(`${stationName}-glow`);

        if (stationName === 'filler') {
            const flow = document.getElementById('filler-flow');
            const valveText = document.getElementById('fill-valve-text');
            const valveIndicator = document.getElementById('fill-valve-indicator');
            if (station.processing) {
                if (flow) flow.classList.remove('hidden');
                if (valveText) valveText.textContent = 'OPEN';
                if (valveIndicator) valveIndicator.querySelector('rect').setAttribute('stroke', '#3b82f6');
                if (glowEl) { glowEl.setAttribute('stroke', '#3b82f6'); glowEl.classList.add('station-processing'); }
            } else {
                if (flow) flow.classList.add('hidden');
                if (valveText) valveText.textContent = 'SHUT';
                if (valveIndicator) valveIndicator.querySelector('rect').setAttribute('stroke', '#64748b');
                if (glowEl) { glowEl.setAttribute('stroke', 'transparent'); glowEl.classList.remove('station-processing'); }
            }
        }

        if (stationName === 'capper') {
            if (station.processing) {
                stationGroup.classList.add('capper-active');
                if (glowEl) { glowEl.setAttribute('stroke', '#f59e0b'); glowEl.classList.add('station-processing'); }
            } else {
                stationGroup.classList.remove('capper-active');
                if (glowEl) { glowEl.setAttribute('stroke', 'transparent'); glowEl.classList.remove('station-processing'); }
            }
        }

        if (stationName === 'quality') {
            if (station.processing) {
                stationGroup.classList.add('quality-scanning');
                if (glowEl) { glowEl.setAttribute('stroke', '#10b981'); glowEl.classList.add('station-processing'); }
            } else {
                stationGroup.classList.remove('quality-scanning');
                if (glowEl) { glowEl.setAttribute('stroke', 'transparent'); glowEl.classList.remove('station-processing'); }
            }
        }
    }

    updateBottleSVGs() {
        const bottleLayer = document.getElementById('bottle-layer');
        if (!bottleLayer) return;

        // Build a set of current bottle ids
        const currentIds = new Set(this.bottles.map(b => `svg-bottle-${b.id}`));

        // Remove stale SVG bottles
        Array.from(bottleLayer.children).forEach(child => {
            if (!currentIds.has(child.id)) {
                bottleLayer.removeChild(child);
            }
        });

        // Create or update SVG bottles
        this.bottles.forEach(bottle => {
            const svgId = `svg-bottle-${bottle.id}`;
            let group = document.getElementById(svgId);
            const x = this.positionToX(bottle.position);
            const y = 170; // sit on top of belt

            if (!group) {
                group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                group.id = svgId;
                group.setAttribute('transform', `translate(${x}, ${y})`);

                // Bottle body
                const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                body.setAttribute('x', '-8');
                body.setAttribute('y', '0');
                body.setAttribute('width', '16');
                body.setAttribute('height', '24');
                body.setAttribute('rx', '3');
                body.setAttribute('fill', '#93c5fd');
                body.setAttribute('stroke', '#60a5fa');
                body.setAttribute('stroke-width', '1');
                body.classList.add('svg-bottle-body');
                group.appendChild(body);

                // Bottle neck
                const neck = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                neck.setAttribute('x', '-4');
                neck.setAttribute('y', '-6');
                neck.setAttribute('width', '8');
                neck.setAttribute('height', '8');
                neck.setAttribute('rx', '1');
                neck.setAttribute('fill', '#bfdbfe');
                neck.setAttribute('stroke', '#60a5fa');
                neck.setAttribute('stroke-width', '0.5');
                group.appendChild(neck);

                // Cap (hidden initially)
                const cap = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                cap.setAttribute('x', '-5');
                cap.setAttribute('y', '-10');
                cap.setAttribute('width', '10');
                cap.setAttribute('height', '5');
                cap.setAttribute('rx', '1.5');
                cap.setAttribute('fill', '#ef4444');
                cap.setAttribute('stroke', '#dc2626');
                cap.setAttribute('stroke-width', '0.5');
                cap.setAttribute('opacity', '0');
                cap.classList.add('svg-bottle-cap');
                group.appendChild(cap);

                // Liquid fill indicator
                const liquid = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                liquid.setAttribute('x', '-6');
                liquid.setAttribute('y', '12');
                liquid.setAttribute('width', '12');
                liquid.setAttribute('height', '0');
                liquid.setAttribute('rx', '1');
                liquid.setAttribute('fill', '#2563eb');
                liquid.setAttribute('opacity', '0.7');
                liquid.classList.add('svg-bottle-liquid');
                group.appendChild(liquid);

                bottleLayer.appendChild(group);
            }

            // Update position
            group.setAttribute('transform', `translate(${x}, ${y})`);

            // Update fill state
            const body = group.querySelector('.svg-bottle-body');
            const liquidEl = group.querySelector('.svg-bottle-liquid');
            const capEl = group.querySelector('.svg-bottle-cap');

            if (bottle.filled) {
                body.setAttribute('fill', '#3b82f6');
                body.setAttribute('stroke', '#2563eb');
                liquidEl.setAttribute('height', '10');
                liquidEl.setAttribute('y', '12');
            } else {
                body.setAttribute('fill', '#93c5fd');
                body.setAttribute('stroke', '#60a5fa');
                liquidEl.setAttribute('height', '0');
            }

            if (bottle.capped) {
                capEl.setAttribute('opacity', '1');
            } else {
                capEl.setAttribute('opacity', '0');
            }

            if (bottle.rejected) {
                body.setAttribute('fill', '#991b1b');
                body.setAttribute('stroke', '#ef4444');
            }
        });
    }

    updateCounterSVGs() {
        const outputCount = document.getElementById('output-count-svg');
        const rejectCount = document.getElementById('reject-count-svg');
        if (outputCount) outputCount.textContent = this.completedBottles;
        if (rejectCount) rejectCount.textContent = this.rejectedBottles;
    }

    updateSensorBadges() {
        const fillerBottle = this.getBottleAtStation('filler');
        const capperBottle = this.getBottleAtStation('capper');
        const qualityBottle = this.getBottleAtStation('quality');

        this.setSensorState('sensor-filler', fillerBottle !== null);
        this.setSensorState('sensor-capper', capperBottle !== null);
        this.setSensorState('sensor-quality', qualityBottle !== null);
    }

    setSensorState(sensorId, active) {
        const el = document.getElementById(sensorId);
        if (!el) return;
        if (active) {
            el.setAttribute('fill', '#22c55e');
            el.setAttribute('filter', 'url(#glow)');
        } else {
            el.setAttribute('fill', '#64748b');
            el.removeAttribute('filter');
        }
    }
    
    recordProduction() {
        const now = Date.now();
        this.productionHistory.push({
            timestamp: now,
            completed: this.completedBottles,
            rejected: this.rejectedBottles
        });
        
        // Keep only last 100 records
        if (this.productionHistory.length > 100) {
            this.productionHistory.shift();
        }
    }
    
    // PLC integration methods
    getSensorStates() {
        return {
            bottleAtFiller: this.getBottleAtStation('filler') !== null,
            bottleAtCapper: this.getBottleAtStation('capper') !== null,
            bottleAtQuality: this.getBottleAtStation('quality') !== null,
            levelSensorReady: true, // Always ready for simulation
            capAvailable: true, // Always available for simulation
            conveyorRunning: this.conveyorRunning
        };
    }
    
    setActuatorStates(actuators) {
        // Update conveyor state
        if (actuators.conveyorMotor !== undefined) {
            this.conveyorRunning = actuators.conveyorMotor;
        }
        
        // Update station processing based on PLC outputs
        // In a real system, this would control physical hardware
        if (actuators.fillValve && this.getBottleAtStation('filler')) {
            // Filler is active
        }
        
        if (actuators.capperMotor && this.getBottleAtStation('capper')) {
            // Capper is active
        }
        
        if (actuators.qualityLight && this.getBottleAtStation('quality')) {
            // Quality check is active
        }
        
        if (actuators.rejectGate) {
            // Reject gate is active
            const qualityBottle = this.getBottleAtStation('quality');
            if (qualityBottle) {
                qualityBottle.rejected = true;
            }
        }
    }
    
    // Production metrics
    getProductionMetrics() {
        const currentTime = Date.now();
        const uptime = this.productionStartTime ? 
            this.totalProductionTime + (currentTime - this.productionStartTime) : 
            this.totalProductionTime;
            
        const productionRate = uptime > 0 ? 
            Math.round((this.completedBottles / uptime) * 60000) : 0; // bottles per minute
            
        const totalBottles = this.completedBottles + this.rejectedBottles;
        const rejectRate = totalBottles > 0 ? 
            Math.round((this.rejectedBottles / totalBottles) * 100) : 0;
            
        const efficiency = this.conveyorRunning ? 95 : 100; // Simplified efficiency
        
        return {
            productionCount: this.completedBottles,
            productionRate: productionRate,
            rejectRate: rejectRate,
            efficiency: efficiency,
            uptime: this.formatUptime(uptime)
        };
    }
    
    formatUptime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        const remainingMinutes = minutes % 60;
        const remainingSeconds = seconds % 60;
        
        return `${hours.toString().padStart(2, '0')}:${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    
    // Control methods
    emergencyStop() {
        this.stop();
        this.conveyorRunning = false;
        
        // Reset all station processing
        Object.keys(this.stations).forEach(station => {
            this.stations[station].processing = false;
        });
    }
    
    // Debug methods
    getSystemState() {
        return {
            bottles: this.bottles.map(b => ({ ...b })),
            stations: { ...this.stations },
            conveyorRunning: this.conveyorRunning,
            completedBottles: this.completedBottles,
            rejectedBottles: this.rejectedBottles
        };
    }
}
