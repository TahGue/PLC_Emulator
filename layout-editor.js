// Layout Editor - Drag-and-drop SVG canvas for placing and connecting PLC components
class LayoutEditor {
    constructor(canvasId, registry, engine) {
        this.canvas = document.getElementById(canvasId);
        this.registry = registry;
        this.engine = engine;

        this.svgNS = 'http://www.w3.org/2000/svg';
        this.gridSize = 20;
        this.showGrid = true;
        this.snapToGrid = true;
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;

        // Interaction state
        this.mode = 'edit'; // 'edit' | 'simulate'
        this.selectedCompId = null;
        this.draggingComp = null;
        this.dragOffset = { x: 0, y: 0 };
        this.wiringFrom = null; // { compId, portId, portDef, x, y }
        this.tempWirePath = null;
        this.isPanning = false;
        this.panStart = { x: 0, y: 0 };
        this.nextCompId = 1;

        // Callbacks
        this.onSelectionChange = null;
        this.onLayoutChange = null;

        // SVG layers
        this.defsLayer = null;
        this.gridLayer = null;
        this.wireLayer = null;
        this.compLayer = null;
        this.portLayer = null;
        this.overlayLayer = null;

        this.initCanvas();
        this.initEvents();
    }

    initCanvas() {
        while (this.canvas.firstChild) this.canvas.removeChild(this.canvas.firstChild);
        this.canvas.setAttribute('viewBox', '0 0 1200 700');
        this.canvas.setAttribute('preserveAspectRatio', 'xMidYMid meet');

        // Defs - use DOMParser for reliable SVG namespace handling
        this.defsLayer = this.createSVGElement('defs');
        const defsSVG = `
            <pattern id="editorGrid" width="${this.gridSize}" height="${this.gridSize}" patternUnits="userSpaceOnUse">
                <circle cx="${this.gridSize/2}" cy="${this.gridSize/2}" r="0.5" fill="rgba(255,255,255,0.1)"/>
            </pattern>
            <pattern id="conveyorStripe" width="12" height="12" patternUnits="userSpaceOnUse">
                <rect width="6" height="12" fill="rgba(255,255,255,0.08)"/>
            </pattern>
            <filter id="glow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <filter id="selectedGlow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <marker id="wireArrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                <path d="M0,0 L6,2 L0,4" fill="#64748b"/>
            </marker>
            <marker id="wireArrowActive" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                <path d="M0,0 L6,2 L0,4" fill="#22c55e"/>
            </marker>`;
        const defsFrag = this.parseSVGContent(defsSVG);
        if (defsFrag) this.defsLayer.appendChild(defsFrag);
        this.canvas.appendChild(this.defsLayer);

        // Grid background
        this.gridLayer = this.createSVGElement('rect', {
            width: '100%', height: '100%',
            fill: 'url(#editorGrid)'
        });
        this.canvas.appendChild(this.gridLayer);

        // Wire layer
        this.wireLayer = this.createSVGElement('g', { id: 'wire-layer' });
        this.canvas.appendChild(this.wireLayer);

        // Component layer
        this.compLayer = this.createSVGElement('g', { id: 'comp-layer' });
        this.canvas.appendChild(this.compLayer);

        // Port layer (on top for click targets)
        this.portLayer = this.createSVGElement('g', { id: 'port-layer' });
        this.canvas.appendChild(this.portLayer);

        // Overlay layer (temp wire, selection box, etc.)
        this.overlayLayer = this.createSVGElement('g', { id: 'overlay-layer' });
        this.canvas.appendChild(this.overlayLayer);
    }

    initEvents() {
        // Canvas mouse events
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this.onWheel(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this.selectedCompId && this.mode === 'edit') {
                    this.deleteSelected();
                }
            }
            if (e.key === 'Escape') {
                this.cancelWiring();
                this.deselect();
            }
        });

        // Handle component drops from palette
        this.canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        this.canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const type = e.dataTransfer.getData('text/plain');
            if (type) {
                const pt = this.screenToSVG(e.clientX, e.clientY);
                this.addComponentAt(type, pt.x, pt.y);
            }
        });
    }

    // ── SVG Helpers ──────────────────────────────────────────────
    createSVGElement(tag, attrs = {}) {
        const el = document.createElementNS(this.svgNS, tag);
        for (const [k, v] of Object.entries(attrs)) {
            el.setAttribute(k, v);
        }
        return el;
    }

    parseSVGContent(svgString) {
        // Method 1: DOMParser (strict XML parsing - preserves SVG namespace)
        try {
            const doc = new DOMParser().parseFromString(
                `<svg xmlns="http://www.w3.org/2000/svg">${svgString}</svg>`,
                'image/svg+xml'
            );
            const hasError = doc.documentElement.nodeName === 'parsererror' ||
                doc.getElementsByTagName('parsererror').length > 0;
            if (!hasError) {
                const frag = document.createDocumentFragment();
                // importNode clones without removing from source — iterate a snapshot
                for (const child of Array.from(doc.documentElement.childNodes)) {
                    frag.appendChild(document.importNode(child, true));
                }
                return frag;
            }
            console.warn('SVG DOMParser error, trying innerHTML fallback');
        } catch (e) { /* fall through */ }

        // Method 2: innerHTML on a temp SVG element (more lenient HTML5 parsing)
        try {
            const tmp = document.createElementNS(this.svgNS, 'svg');
            tmp.innerHTML = svgString;
            const frag = document.createDocumentFragment();
            // appendChild moves the node out of tmp, so while-loop is safe here
            while (tmp.firstChild) {
                frag.appendChild(tmp.firstChild);
            }
            return frag;
        } catch (e) {
            console.warn('SVG innerHTML fallback also failed:', e);
            return null;
        }
    }

    screenToSVG(clientX, clientY) {
        const ctm = this.canvas.getScreenCTM();
        if (!ctm) return { x: clientX, y: clientY };
        const pt = this.canvas.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const svgPt = pt.matrixTransform(ctm.inverse());
        return { x: svgPt.x, y: svgPt.y };
    }

    snapPos(x, y) {
        if (!this.snapToGrid) return { x, y };
        return {
            x: Math.round(x / this.gridSize) * this.gridSize,
            y: Math.round(y / this.gridSize) * this.gridSize
        };
    }

    // ── Component Management ─────────────────────────────────────
    addComponentAt(type, x, y) {
        const pos = this.snapPos(x, y);
        const id = `comp_${this.nextCompId++}`;
        const comp = this.engine.addComponent(id, type, pos.x, pos.y);
        if (comp) {
            this.render();
            this.selectComponent(id);
            if (this.onLayoutChange) this.onLayoutChange();
        }
        return id;
    }

    deleteSelected() {
        if (!this.selectedCompId) return;
        this.engine.removeComponent(this.selectedCompId);
        this.selectedCompId = null;
        this.render();
        if (this.onSelectionChange) this.onSelectionChange(null);
        if (this.onLayoutChange) this.onLayoutChange();
    }

    selectComponent(id) {
        this.selectedCompId = id;
        this.render();
        if (this.onSelectionChange) this.onSelectionChange(id);
    }

    deselect() {
        this.selectedCompId = null;
        this.render();
        if (this.onSelectionChange) this.onSelectionChange(null);
    }

    // ── Mouse Handlers ───────────────────────────────────────────
    onMouseDown(e) {
        const pt = this.screenToSVG(e.clientX, e.clientY);
        const target = e.target;

        // Check if clicking a port
        if (target.dataset.portComp && target.dataset.portId) {
            if (this.mode === 'edit') {
                this.startWiring(target.dataset.portComp, target.dataset.portId, pt);
            } else if (this.mode === 'simulate') {
                // In simulate mode, clicking a sensor port toggles it
                this.toggleSensorPort(target.dataset.portComp);
            }
            return;
        }

        // Check if clicking a component
        const compGroup = target.closest('[data-comp-id]');
        if (compGroup) {
            const compId = compGroup.dataset.compId;
            if (this.mode === 'simulate') {
                this.toggleSensorPort(compId);
                return;
            }
            this.selectComponent(compId);
            const comp = this.engine.getComponent(compId);
            if (comp) {
                this.draggingComp = compId;
                this.dragOffset = { x: pt.x - comp.x, y: pt.y - comp.y };
            }
            return;
        }

        // Check if clicking a wire
        if (target.dataset.wireId && this.mode === 'edit') {
            const wireId = parseInt(target.dataset.wireId);
            this.engine.removeWire(wireId);
            this.render();
            if (this.onLayoutChange) this.onLayoutChange();
            return;
        }

        // Click on empty space
        if (e.button === 0) {
            this.deselect();
        }
        if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
            this.isPanning = true;
            this.panStart = { x: e.clientX, y: e.clientY };
        }
    }

    onMouseMove(e) {
        const pt = this.screenToSVG(e.clientX, e.clientY);

        if (this.draggingComp && this.mode === 'edit') {
            const pos = this.snapPos(pt.x - this.dragOffset.x, pt.y - this.dragOffset.y);
            this.engine.moveComponent(this.draggingComp, pos.x, pos.y);
            this.render();
            return;
        }

        if (this.wiringFrom) {
            this.drawTempWire(this.wiringFrom.x, this.wiringFrom.y, pt.x, pt.y);
            return;
        }

        if (this.isPanning) {
            const dx = e.clientX - this.panStart.x;
            const dy = e.clientY - this.panStart.y;
            this.panX += dx / this.zoom;
            this.panY += dy / this.zoom;
            this.panStart = { x: e.clientX, y: e.clientY };
            this.updateViewBox();
        }
    }

    onMouseUp(e) {
        const pt = this.screenToSVG(e.clientX, e.clientY);

        if (this.draggingComp) {
            this.draggingComp = null;
            if (this.onLayoutChange) this.onLayoutChange();
        }

        if (this.wiringFrom) {
            // Check if dropped on a port
            const target = e.target;
            if (target.dataset.portComp && target.dataset.portId) {
                this.completeWiring(target.dataset.portComp, target.dataset.portId);
            } else {
                this.cancelWiring();
            }
        }

        this.isPanning = false;
    }

    onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        this.zoom = Math.max(0.3, Math.min(3, this.zoom * delta));
        this.updateViewBox();
    }

    updateViewBox() {
        const w = 1200 / this.zoom;
        const h = 700 / this.zoom;
        this.canvas.setAttribute('viewBox', `${-this.panX} ${-this.panY} ${w} ${h}`);
    }

    // ── Wiring ───────────────────────────────────────────────────
    startWiring(compId, portId, pt) {
        const comp = this.engine.getComponent(compId);
        if (!comp) return;
        const def = this.registry.get(comp.type);
        if (!def) return;
        const portDef = def.ports.find(p => p.id === portId);
        if (!portDef) return;

        const portPos = this.registry.getPortPosition(def, portDef, comp.x, comp.y);
        this.wiringFrom = { compId, portId, portDef, x: portPos.x, y: portPos.y };
    }

    completeWiring(toCompId, toPortId) {
        if (!this.wiringFrom) return;

        const toComp = this.engine.getComponent(toCompId);
        if (!toComp) { this.cancelWiring(); return; }
        const toDef = this.registry.get(toComp.type);
        if (!toDef) { this.cancelWiring(); return; }
        const toPortDef = toDef.ports.find(p => p.id === toPortId);
        if (!toPortDef) { this.cancelWiring(); return; }

        // Validate: must connect output→input or input→output
        const fromType = this.wiringFrom.portDef.type;
        const toType = toPortDef.type;

        let fromComp, fromPort, destComp, destPort;
        if (fromType === 'output' && toType === 'input') {
            fromComp = this.wiringFrom.compId;
            fromPort = this.wiringFrom.portId;
            destComp = toCompId;
            destPort = toPortId;
        } else if (fromType === 'input' && toType === 'output') {
            fromComp = toCompId;
            fromPort = toPortId;
            destComp = this.wiringFrom.compId;
            destPort = this.wiringFrom.portId;
        } else {
            this.cancelWiring();
            return;
        }

        // Can't wire to self
        if (fromComp === destComp) { this.cancelWiring(); return; }

        this.engine.addWire(fromComp, fromPort, destComp, destPort);
        this.cancelWiring();
        this.render();
        if (this.onLayoutChange) this.onLayoutChange();
    }

    cancelWiring() {
        this.wiringFrom = null;
        if (this.tempWirePath) {
            this.tempWirePath.remove();
            this.tempWirePath = null;
        }
    }

    drawTempWire(x1, y1, x2, y2) {
        if (!this.tempWirePath) {
            this.tempWirePath = this.createSVGElement('path', {
                fill: 'none', stroke: '#60a5fa', 'stroke-width': '2',
                'stroke-dasharray': '6 4', opacity: '0.7'
            });
            this.overlayLayer.appendChild(this.tempWirePath);
        }
        const dx = (x2 - x1) * 0.4;
        this.tempWirePath.setAttribute('d', `M${x1},${y1} C${x1+dx},${y1} ${x2-dx},${y2} ${x2},${y2}`);
    }

    toggleSensorPort(compId) {
        const comp = this.engine.getComponent(compId);
        if (!comp) return;
        const def = this.registry.get(comp.type);
        if (!def) return;

        if (def.category === 'sensors') {
            const outPort = def.ports.find(p => p.type === 'output');
            if (outPort && outPort.dataType === 'digital') {
                comp.state.forced = !comp.state.forced;
                this.render();
            }
        }
    }

    // ── Rendering ────────────────────────────────────────────────
    render() {
        this.renderWires();
        this.renderComponents();
    }

    renderComponents() {
        while (this.compLayer.firstChild) this.compLayer.removeChild(this.compLayer.firstChild);
        while (this.portLayer.firstChild) this.portLayer.removeChild(this.portLayer.firstChild);

        for (const comp of this.engine.getAllComponents()) {
            const def = this.registry.get(comp.type);
            if (!def) continue;

            const isSelected = comp.id === this.selectedCompId;
            const visualState = this.engine.getComponentVisualState(comp.id);

            // Component group
            const g = this.createSVGElement('g', {
                'data-comp-id': comp.id,
                transform: `translate(${comp.x}, ${comp.y})`,
                cursor: this.mode === 'edit' ? 'move' : 'pointer',
                class: 'editor-component'
            });

            // Selection highlight
            if (isSelected) {
                const sel = this.createSVGElement('rect', {
                    x: '-4', y: '-4',
                    width: def.w + 8, height: def.h + 8,
                    rx: '10', fill: 'none',
                    stroke: '#60a5fa', 'stroke-width': '2',
                    'stroke-dasharray': '6 3',
                    filter: 'url(#selectedGlow)'
                });
                g.appendChild(sel);
            }

            // Component SVG content - use DOMParser for reliable rendering
            const content = this.createSVGElement('g');
            try {
                const svgStr = def.renderSVG(def.w, def.h, visualState);
                const frag = this.parseSVGContent(svgStr);
                if (frag) {
                    content.appendChild(frag);
                } else {
                    // Fallback: simple colored rect
                    const fb = this.createSVGElement('rect', {
                        width: def.w, height: def.h, rx: '6',
                        fill: '#1e293b', stroke: def.color || '#64748b', 'stroke-width': '2'
                    });
                    content.appendChild(fb);
                    const fbTxt = this.createSVGElement('text', {
                        x: def.w/2, y: def.h/2 + 4, 'text-anchor': 'middle',
                        fill: '#94a3b8', 'font-size': '8'
                    });
                    fbTxt.textContent = def.label;
                    content.appendChild(fbTxt);
                }
            } catch (err) {
                console.error('Component render error:', comp.id, comp.type, err);
                const fb = this.createSVGElement('rect', {
                    width: def.w, height: def.h, rx: '6',
                    fill: '#1e293b', stroke: '#ef4444', 'stroke-width': '2'
                });
                content.appendChild(fb);
            }
            g.appendChild(content);

            // Label below
            const label = comp.props.label || def.label;
            const labelEl = this.createSVGElement('text', {
                x: def.w / 2, y: def.h + 12,
                'text-anchor': 'middle',
                fill: '#94a3b8', 'font-size': '8', 'font-weight': '600'
            });
            labelEl.textContent = label;
            if (comp.props.address) {
                labelEl.textContent += ` [${comp.props.address}]`;
            }
            g.appendChild(labelEl);

            this.compLayer.appendChild(g);

            // Render ports
            this.renderPorts(comp, def, isSelected);
        }
    }

    renderPorts(comp, def, isSelected) {
        for (const port of def.ports) {
            const pos = this.registry.getPortPosition(def, port, comp.x, comp.y);

            // Port background circle (larger click target)
            const hitArea = this.createSVGElement('circle', {
                cx: pos.x, cy: pos.y, r: '8',
                fill: 'transparent', cursor: 'crosshair',
                'data-port-comp': comp.id, 'data-port-id': port.id
            });
            this.portLayer.appendChild(hitArea);

            // Visual port circle
            const isConnected = this.isPortConnected(comp.id, port.id);
            const isActive = this.getPortSignalActive(comp, port);
            const portColor = isActive ? '#22c55e' : (isConnected ? '#60a5fa' : '#475569');

            const circle = this.createSVGElement('circle', {
                cx: pos.x, cy: pos.y,
                r: isSelected || this.mode === 'edit' ? '5' : '3',
                fill: '#0f172a', stroke: portColor,
                'stroke-width': isSelected ? '2' : '1.5',
                'pointer-events': 'none'
            });
            this.portLayer.appendChild(circle);

            // Port type indicator (small arrow)
            if (isSelected || this.mode === 'edit') {
                const innerR = isActive ? 3 : 2;
                const inner = this.createSVGElement('circle', {
                    cx: pos.x, cy: pos.y, r: innerR,
                    fill: isActive ? '#22c55e' : (port.type === 'output' ? '#f59e0b' : '#3b82f6'),
                    'pointer-events': 'none'
                });
                this.portLayer.appendChild(inner);

                // Port label
                const labelX = port.side === 'left' ? pos.x - 10 : (port.side === 'right' ? pos.x + 10 : pos.x);
                const labelY = port.side === 'top' ? pos.y - 8 : (port.side === 'bottom' ? pos.y + 12 : pos.y + 3);
                const anchor = port.side === 'left' ? 'end' : (port.side === 'right' ? 'start' : 'middle');
                const lbl = this.createSVGElement('text', {
                    x: labelX, y: labelY,
                    'text-anchor': anchor,
                    fill: '#64748b', 'font-size': '6', 'pointer-events': 'none'
                });
                lbl.textContent = port.label;
                this.portLayer.appendChild(lbl);
            }
        }
    }

    isPortConnected(compId, portId) {
        return this.engine.getAllWires().some(w =>
            (w.fromComp === compId && w.fromPort === portId) ||
            (w.toComp === compId && w.toPort === portId)
        );
    }

    getPortSignalActive(comp, port) {
        if (port.type === 'output') {
            const val = comp.outputValues[port.id];
            return val === true || (typeof val === 'number' && val > 0);
        } else {
            const val = comp.inputValues[port.id];
            return val === true || (typeof val === 'number' && val > 0);
        }
    }

    renderWires() {
        while (this.wireLayer.firstChild) this.wireLayer.removeChild(this.wireLayer.firstChild);

        for (const wire of this.engine.getAllWires()) {
            const fromComp = this.engine.getComponent(wire.fromComp);
            const toComp = this.engine.getComponent(wire.toComp);
            if (!fromComp || !toComp) continue;

            const fromDef = this.registry.get(fromComp.type);
            const toDef = this.registry.get(toComp.type);
            if (!fromDef || !toDef) continue;

            const fromPort = fromDef.ports.find(p => p.id === wire.fromPort);
            const toPort = toDef.ports.find(p => p.id === wire.toPort);
            if (!fromPort || !toPort) continue;

            const p1 = this.registry.getPortPosition(fromDef, fromPort, fromComp.x, fromComp.y);
            const p2 = this.registry.getPortPosition(toDef, toPort, toComp.x, toComp.y);

            const wireState = this.engine.getWireState(wire);
            const color = wireState.active ? '#22c55e' : '#475569';
            const width = wireState.active ? 2.5 : 1.5;
            const marker = wireState.active ? 'url(#wireArrowActive)' : 'url(#wireArrow)';

            // Bezier curve
            const dx = Math.abs(p2.x - p1.x) * 0.5;
            const cpx1 = p1.x + (fromPort.side === 'right' ? dx : (fromPort.side === 'left' ? -dx : 0));
            const cpy1 = p1.y + (fromPort.side === 'bottom' ? dx : (fromPort.side === 'top' ? -dx : 0));
            const cpx2 = p2.x + (toPort.side === 'left' ? -dx : (toPort.side === 'right' ? dx : 0));
            const cpy2 = p2.y + (toPort.side === 'top' ? -dx : (toPort.side === 'bottom' ? dx : 0));

            const path = this.createSVGElement('path', {
                d: `M${p1.x},${p1.y} C${cpx1},${cpy1} ${cpx2},${cpy2} ${p2.x},${p2.y}`,
                fill: 'none', stroke: color, 'stroke-width': width,
                'marker-end': marker, cursor: 'pointer',
                'data-wire-id': wire.id
            });

            if (wireState.active) {
                path.setAttribute('filter', 'url(#glow)');
            }

            // Hit area for easier clicking
            const hitPath = this.createSVGElement('path', {
                d: `M${p1.x},${p1.y} C${cpx1},${cpy1} ${cpx2},${cpy2} ${p2.x},${p2.y}`,
                fill: 'none', stroke: 'transparent', 'stroke-width': '10',
                cursor: 'pointer', 'data-wire-id': wire.id
            });

            this.wireLayer.appendChild(hitPath);
            this.wireLayer.appendChild(path);
        }
    }

    // ── Mode Switching ───────────────────────────────────────────
    setMode(mode) {
        this.mode = mode;
        this.cancelWiring();
        this.deselect();
        this.render();
    }

    // ── Zoom Controls ────────────────────────────────────────────
    zoomIn() {
        this.zoom = Math.min(3, this.zoom * 1.2);
        this.updateViewBox();
    }

    zoomOut() {
        this.zoom = Math.max(0.3, this.zoom / 1.2);
        this.updateViewBox();
    }

    zoomFit() {
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.updateViewBox();
    }

    toggleGrid() {
        this.showGrid = !this.showGrid;
        this.gridLayer.setAttribute('fill', this.showGrid ? 'url(#editorGrid)' : '#0f172a');
    }

    toggleSnap() {
        this.snapToGrid = !this.snapToGrid;
    }

    // ── Layout Serialization ─────────────────────────────────────
    exportLayout() {
        return JSON.stringify(this.engine.serialize(), null, 2);
    }

    importLayout(json) {
        try {
            const data = JSON.parse(json);
            this.engine.deserialize(data);
            // Update nextCompId to avoid collisions
            let maxId = 0;
            for (const comp of this.engine.getAllComponents()) {
                const num = parseInt(comp.id.replace('comp_', ''));
                if (!isNaN(num) && num > maxId) maxId = num;
            }
            this.nextCompId = maxId + 1;
            this.render();
            if (this.onLayoutChange) this.onLayoutChange();
        } catch (e) {
            console.error('Failed to import layout:', e);
        }
    }
}
