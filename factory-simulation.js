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
        this.bottles.forEach(bottle => {
            if (!bottle.rejected) {
                // Simple movement logic - bottles move based on time
                const movement = deltaTime / this.conveyorSpeed;
                bottle.position += movement * 0.1; // Adjust speed as needed
                
                // Wrap around or remove bottles that reach the end
                if (bottle.position > 6) {
                    if (bottle.qualityChecked && !bottle.rejected) {
                        this.completedBottles++;
                        this.recordProduction();
                    } else if (bottle.rejected) {
                        this.rejectedBottles++;
                    }
                    
                    // Remove completed bottle
                    const index = this.bottles.indexOf(bottle);
                    this.bottles.splice(index, 1);
                }
            }
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
    
    updateVisualization() {
        // Update conveyor belt animation
        const conveyorElement = document.querySelector('.conveyor-belt');
        if (conveyorElement) {
            if (this.conveyorRunning) {
                conveyorElement.classList.add('conveyor-running');
            } else {
                conveyorElement.classList.remove('conveyor-running');
            }
        }
        
        // Update station indicators
        this.updateStationIndicator('filler-status', this.stations.filler.processing);
        this.updateStationIndicator('capper-status', this.stations.capper.processing);
        this.updateStationIndicator('quality-status', this.stations.quality.processing);
        
        // Update bottle positions
        this.updateBottleVisuals();
        
        // Update completed bottles display
        this.updateCompletedBottles();
    }
    
    updateStationIndicator(elementId, isActive) {
        const element = document.getElementById(elementId);
        if (element) {
            if (isActive) {
                element.classList.add('active');
            } else {
                element.classList.remove('active');
            }
        }
    }
    
    updateBottleVisuals() {
        // Update filler station bottle
        const fillerBottle = this.getBottleAtStation('filler');
        this.updateBottleSlot('filler-bottle', fillerBottle);
        
        // Update capper station bottle
        const capperBottle = this.getBottleAtStation('capper');
        this.updateBottleSlot('capper-bottle', capperBottle);
        
        // Update quality station bottle
        const qualityBottle = this.getBottleAtStation('quality');
        this.updateBottleSlot('quality-bottle', qualityBottle);
    }
    
    updateBottleSlot(slotId, bottle) {
        const slot = document.getElementById(slotId);
        if (slot) {
            slot.innerHTML = '';
            if (bottle) {
                const bottleElement = document.createElement('div');
                bottleElement.className = 'bottle';
                
                if (bottle.filled) {
                    bottleElement.classList.add('filled');
                }
                
                if (bottle.capped) {
                    bottleElement.classList.add('capped');
                }
                
                slot.appendChild(bottleElement);
            }
        }
    }
    
    updateCompletedBottles() {
        const completedElement = document.getElementById('completed-bottles');
        if (completedElement) {
            completedElement.innerHTML = '';
            
            // Show last 5 completed bottles
            const displayCount = Math.min(5, this.completedBottles);
            for (let i = 0; i < displayCount; i++) {
                const bottleElement = document.createElement('div');
                bottleElement.className = 'bottle filled capped';
                bottleElement.style.opacity = 0.3 + (i * 0.15);
                completedElement.appendChild(bottleElement);
            }
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
