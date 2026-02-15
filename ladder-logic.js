class LadderLogicRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.scale = 20; // pixels per grid unit
        this.rungHeight = 60;
        this.rungSpacing = 20;
        this.currentRung = 0;
        
        // Colors
        this.colors = {
            background: '#f8f9fa',
            grid: '#dee2e6',
            wire: '#212529',
            wireEnergized: '#28a745',
            contact: '#495057',
            contactOpen: '#dc3545',
            coil: '#007bff',
            text: '#212529'
        };
        
        this.setupCanvas();
    }
    
    setupCanvas() {
        // Set canvas size
        this.canvas.width = 400;
        this.canvas.height = 600;
        
        // Enable text rendering
        this.ctx.font = '10px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
    }
    
    clear() {
        this.ctx.fillStyle = this.colors.background;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    drawGrid() {
        this.ctx.strokeStyle = this.colors.grid;
        this.ctx.lineWidth = 0.5;
        
        // Vertical lines
        for (let x = 0; x <= this.canvas.width; x += this.scale) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }
        
        // Horizontal lines
        for (let y = 0; y <= this.canvas.height; y += this.scale) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }
    }
    
    drawRung(rungNumber, instructions, energized = false) {
        const startY = 30 + rungNumber * (this.rungHeight + this.rungSpacing);
        const endY = startY + this.rungHeight;
        
        // Draw rung number
        this.ctx.fillStyle = this.colors.text;
        this.ctx.font = 'bold 12px monospace';
        this.ctx.fillText(`R${rungNumber + 1}`, 10, startY + this.rungHeight / 2);
        
        // Draw left power rail
        this.drawWire(30, startY, 30, endY, energized);
        
        // Draw right power rail
        this.drawWire(370, startY, 370, endY, energized);
        
        // Draw horizontal rung line
        this.drawWire(30, startY + this.rungHeight / 2, 370, startY + this.rungHeight / 2, energized);
        
        // Draw instructions
        let xPos = 50;
        const yPos = startY + this.rungHeight / 2;
        
        instructions.forEach((instruction, index) => {
            const result = this.drawInstruction(instruction, xPos, yPos, energized);
            xPos += result.width;
        });
    }
    
    drawInstruction(instruction, x, y, energized) {
        const wireColor = energized ? this.colors.wireEnergized : this.colors.wire;
        
        switch (instruction.type) {
            case 'XIC': // Examine If Closed (normally open contact)
                return this.drawContact(x, y, false, instruction.operands[0], energized);
                
            case 'XIO': // Examine If Open (normally closed contact)
                return this.drawContact(x, y, true, instruction.operands[0], energized);
                
            case 'OTE': // Output Energize
                return this.drawCoil(x, y, instruction.operands[0], energized);
                
            case 'OTL': // Output Latch
                return this.drawCoil(x, y, instruction.operands[0], energized, true);
                
            case 'OTU': // Output Unlatch
                return this.drawCoil(x, y, instruction.operands[0], false, false, true);
                
            case 'TON': // Timer On-Delay
                return this.drawTimer(x, y, instruction.operands[0], energized);
                
            case 'CTU': // Count Up
                return this.drawCounter(x, y, instruction.operands[0], energized);
                
            default:
                return { width: 40 };
        }
    }
    
    drawContact(x, y, normallyClosed, address, energized) {
        const wireColor = energized ? this.colors.wireEnergized : this.colors.wire;
        const contactColor = normallyClosed ? this.colors.contactOpen : this.colors.contact;
        
        // Draw connecting wires
        this.drawWire(x - 10, y, x, y, energized);
        this.drawWire(x + 30, y, x + 40, y, energized);
        
        // Draw contact symbol
        this.ctx.strokeStyle = contactColor;
        this.ctx.lineWidth = 2;
        
        if (normallyClosed) {
            // Normally closed contact - draw line with break
            this.ctx.beginPath();
            this.ctx.moveTo(x, y - 10);
            this.ctx.lineTo(x + 15, y - 5);
            this.ctx.moveTo(x + 15, y + 5);
            this.ctx.lineTo(x + 30, y - 10);
            this.ctx.stroke();
            
            // Draw vertical lines
            this.ctx.beginPath();
            this.ctx.moveTo(x, y - 10);
            this.ctx.lineTo(x, y + 10);
            this.ctx.moveTo(x + 30, y - 10);
            this.ctx.lineTo(x + 30, y + 10);
            this.ctx.stroke();
        } else {
            // Normally open contact - draw with gap
            this.ctx.beginPath();
            this.ctx.moveTo(x, y - 10);
            this.ctx.lineTo(x, y + 10);
            this.ctx.moveTo(x + 30, y - 10);
            this.ctx.lineTo(x + 30, y + 10);
            this.ctx.stroke();
            
            // Draw diagonal contact line
            this.ctx.beginPath();
            this.ctx.moveTo(x + 5, y);
            this.ctx.lineTo(x + 25, y);
            this.ctx.stroke();
        }
        
        // Draw address label
        this.ctx.fillStyle = this.colors.text;
        this.ctx.font = '8px monospace';
        this.ctx.fillText(address, x + 15, y + 20);
        
        return { width: 40 };
    }
    
    drawCoil(x, y, address, energized, isLatch = false, isUnlatch = false) {
        const wireColor = energized ? this.colors.wireEnergized : this.colors.wire;
        const coilColor = energized ? this.colors.coil : this.colors.contact;
        
        // Draw connecting wires
        this.drawWire(x - 10, y, x, y, energized);
        this.drawWire(x + 30, y, x + 40, y, energized);
        
        // Draw coil symbol
        this.ctx.strokeStyle = coilColor;
        this.ctx.lineWidth = 2;
        
        // Draw circle
        this.ctx.beginPath();
        this.ctx.arc(x + 15, y, 12, 0, 2 * Math.PI);
        this.ctx.stroke();
        
        // Draw latch/unlatch symbols if needed
        if (isLatch) {
            // Draw L for latch
            this.ctx.fillStyle = coilColor;
            this.ctx.font = 'bold 10px monospace';
            this.ctx.fillText('L', x + 15, y);
        } else if (isUnlatch) {
            // Draw U for unlatch
            this.ctx.fillStyle = coilColor;
            this.ctx.font = 'bold 10px monospace';
            this.ctx.fillText('U', x + 15, y);
        }
        
        // Draw address label
        this.ctx.fillStyle = this.colors.text;
        this.ctx.font = '8px monospace';
        this.ctx.fillText(address, x + 15, y + 25);
        
        return { width: 40 };
    }
    
    drawTimer(x, y, address, energized) {
        const wireColor = energized ? this.colors.wireEnergized : this.colors.wire;
        const timerColor = energized ? this.colors.coil : this.colors.contact;
        
        // Draw connecting wires
        this.drawWire(x - 10, y, x, y, energized);
        this.drawWire(x + 30, y, x + 40, y, energized);
        
        // Draw timer symbol (rectangle)
        this.ctx.strokeStyle = timerColor;
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x + 5, y - 10, 20, 20);
        
        // Draw T for timer
        this.ctx.fillStyle = timerColor;
        this.ctx.font = 'bold 10px monospace';
        this.ctx.fillText('T', x + 15, y);
        
        // Draw address label
        this.ctx.fillStyle = this.colors.text;
        this.ctx.font = '8px monospace';
        this.ctx.fillText(address, x + 15, y + 25);
        
        return { width: 40 };
    }
    
    drawCounter(x, y, address, energized) {
        const wireColor = energized ? this.colors.wireEnergized : this.colors.wire;
        const counterColor = energized ? this.colors.coil : this.colors.contact;
        
        // Draw connecting wires
        this.drawWire(x - 10, y, x, y, energized);
        this.drawWire(x + 30, y, x + 40, y, energized);
        
        // Draw counter symbol (rectangle)
        this.ctx.strokeStyle = counterColor;
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x + 5, y - 10, 20, 20);
        
        // Draw C for counter
        this.ctx.fillStyle = counterColor;
        this.ctx.font = 'bold 10px monospace';
        this.ctx.fillText('C', x + 15, y);
        
        // Draw address label
        this.ctx.fillStyle = this.colors.text;
        this.ctx.font = '8px monospace';
        this.ctx.fillText(address, x + 15, y + 25);
        
        return { width: 40 };
    }
    
    drawWire(x1, y1, x2, y2, energized) {
        this.ctx.strokeStyle = energized ? this.colors.wireEnergized : this.colors.wire;
        this.ctx.lineWidth = energized ? 2 : 1;
        
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
        this.ctx.stroke();
    }
    
    render(ladderProgram, plcState) {
        // Auto-size canvas to fit all rungs
        const neededHeight = 30 + ladderProgram.rungs.length * (this.rungHeight + this.rungSpacing) + 20;
        if (this.canvas.height < neededHeight) {
            this.canvas.height = Math.max(600, neededHeight);
            this.ctx.font = '10px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
        }

        this.clear();
        this.drawGrid();
        
        // Render each rung
        ladderProgram.rungs.forEach((rung, index) => {
            const rungEnergized = this.isRungEnergized(rung, plcState);
            this.drawRung(index, rung.instructions, rungEnergized);
            // Draw comment if present
            if (rung.comment) {
                const y = 30 + index * (this.rungHeight + this.rungSpacing);
                this.ctx.fillStyle = '#6b7280';
                this.ctx.font = '8px sans-serif';
                this.ctx.textAlign = 'left';
                this.ctx.fillText(rung.comment, 40, y + 8);
                this.ctx.textAlign = 'center';
                this.ctx.font = '10px monospace';
            }
        });
    }
    
    isRungEnergized(rung, plcState) {
        // Use the stored energized state from last execution if available
        if (rung.energized !== undefined) return rung.energized;

        // Fallback: evaluate conditions from I/O state
        let result = true;
        for (const inst of rung.instructions) {
            if (!inst.type.startsWith('X')) continue;
            const address = inst.operands[0];
            const index = this.parseAddress(address);
            if (index < 0) continue;
            const isOutput = address.startsWith('O:');
            const val = isOutput ? plcState.outputs[index] : plcState.inputs[index];
            if (inst.type === 'XIC') result = result && val;
            else if (inst.type === 'XIO') result = result && !val;
        }
        return result;
    }
    
    parseAddress(address) {
        const match = address.match(/([IO]):(\d+)\/(\d+)/);
        if (match) {
            return parseInt(match[3]);
        }
        return -1;
    }
    
    // Animation support
    animateRung(rungNumber, instructions, duration = 500) {
        const startTime = Date.now();
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Clear and redraw
            this.clear();
            this.drawGrid();
            
            // Draw all rungs
            instructions.forEach((rung, index) => {
                const energized = index === rungNumber ? progress > 0.5 : false;
                this.drawRung(index, rung.instructions, energized);
            });
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        
        animate();
    }
}

// Ladder Logic Editor (simplified)
class LadderLogicEditor {
    constructor(renderer) {
        this.renderer = renderer;
        this.program = null;
        this.editMode = false;
        this.selectedInstruction = null;
        this.currentRung = 0;
        this.supportedInstructions = {
            XIC: 1,
            XIO: 1,
            OTE: 1,
            OTL: 1,
            OTU: 1,
            TON: 2,
            CTU: 2,
        };
    }

    setProgram(program) {
        this.program = program;
    }

    getInstructionTypes() {
        return Object.keys(this.supportedInstructions);
    }

    getRungs() {
        return this.program?.rungs || [];
    }

    _ensureProgram() {
        if (!this.program) {
            return { ok: false, error: 'No ladder program loaded.' };
        }
        return { ok: true };
    }

    _normalizeType(instructionType) {
        return String(instructionType || '').trim().toUpperCase();
    }

    _coerceRungIndex(rungIndex) {
        const idx = Number(rungIndex);
        if (!Number.isInteger(idx) || idx < 0 || idx >= this.getRungs().length) {
            return -1;
        }
        return idx;
    }

    _coerceInstructionIndex(rung, instructionIndex) {
        const idx = Number(instructionIndex);
        if (!Number.isInteger(idx) || idx < 0 || idx >= rung.instructions.length) {
            return -1;
        }
        return idx;
    }

    _buildInstruction(instructionType, operandA, operandB) {
        const type = this._normalizeType(instructionType);
        const operandCount = this.supportedInstructions[type];
        if (!operandCount) {
            return { ok: false, error: `Unsupported instruction type: ${type || 'EMPTY'}` };
        }

        const opA = String(operandA || '').trim();
        if (!opA) {
            return { ok: false, error: 'Operand A is required.' };
        }

        const operands = [opA];
        if (operandCount === 2) {
            const preset = Number(operandB);
            if (!Number.isFinite(preset) || preset <= 0) {
                return { ok: false, error: 'Operand B must be a positive number.' };
            }
            operands.push(preset);
        }

        return {
            ok: true,
            instruction: new LadderInstruction(type, operands)
        };
    }
    
    toggleEditMode() {
        this.editMode = !this.editMode;
        return this.editMode;
    }

    addRung(insertAfterIndex = null) {
        const ready = this._ensureProgram();
        if (!ready.ok) return ready;

        const rung = new LadderRung([
            new LadderInstruction('XIC', ['I:0/1']),
            new LadderInstruction('OTE', ['O:0/0'])
        ]);

        if (this.program.rungs.length === 0) {
            this.program.rungs.push(rung);
            return { ok: true, rungIndex: 0 };
        }

        if (insertAfterIndex === null || insertAfterIndex === undefined) {
            this.program.rungs.push(rung);
            return { ok: true, rungIndex: this.program.rungs.length - 1 };
        }

        const at = Number(insertAfterIndex);
        if (!Number.isInteger(at) || at < -1 || at >= this.program.rungs.length) {
            return { ok: false, error: 'Invalid rung insertion index.' };
        }

        const insertAt = at + 1;
        this.program.rungs.splice(insertAt, 0, rung);
        return { ok: true, rungIndex: insertAt };
    }

    removeRung(rungIndex) {
        const ready = this._ensureProgram();
        if (!ready.ok) return ready;

        const idx = this._coerceRungIndex(rungIndex);
        if (idx < 0) {
            return { ok: false, error: 'Invalid rung index.' };
        }

        this.program.rungs.splice(idx, 1);
        return { ok: true, rungIndex: Math.max(0, idx - 1) };
    }
    
    addInstruction(rungIndex, instructionType, operandA, operandB = '') {
        const ready = this._ensureProgram();
        if (!ready.ok) return ready;

        const idx = this._coerceRungIndex(rungIndex);
        if (idx < 0) {
            return { ok: false, error: 'Invalid rung index.' };
        }

        const built = this._buildInstruction(instructionType, operandA, operandB);
        if (!built.ok) return built;

        const rung = this.program.rungs[idx];
        rung.instructions.push(built.instruction);
        return { ok: true, rungIndex: idx, instructionIndex: rung.instructions.length - 1 };
    }
    
    removeInstruction(rungIndex, instructionIndex) {
        const ready = this._ensureProgram();
        if (!ready.ok) return ready;

        const idx = this._coerceRungIndex(rungIndex);
        if (idx < 0) {
            return { ok: false, error: 'Invalid rung index.' };
        }

        const rung = this.program.rungs[idx];
        const instIdx = this._coerceInstructionIndex(rung, instructionIndex);
        if (instIdx < 0) {
            return { ok: false, error: 'Invalid instruction index.' };
        }

        rung.instructions.splice(instIdx, 1);
        return { ok: true, rungIndex: idx, instructionIndex: Math.max(0, instIdx - 1) };
    }
    
    editInstruction(rungIndex, instructionIndex, instructionType, operandA, operandB = '') {
        const ready = this._ensureProgram();
        if (!ready.ok) return ready;

        const idx = this._coerceRungIndex(rungIndex);
        if (idx < 0) {
            return { ok: false, error: 'Invalid rung index.' };
        }

        const rung = this.program.rungs[idx];
        const instIdx = this._coerceInstructionIndex(rung, instructionIndex);
        if (instIdx < 0) {
            return { ok: false, error: 'Invalid instruction index.' };
        }

        const built = this._buildInstruction(instructionType, operandA, operandB);
        if (!built.ok) return built;

        rung.instructions[instIdx] = built.instruction;
        return { ok: true, rungIndex: idx, instructionIndex: instIdx };
    }
}
