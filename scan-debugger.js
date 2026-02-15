// Scan Cycle Visual Debugger — canvas-based timeline + rung analysis
class ScanDebugger {
    constructor(timelineCanvasId, rungCanvasId) {
        this.timelineCanvas = document.getElementById(timelineCanvasId);
        this.rungCanvas = document.getElementById(rungCanvasId);
        this.timelineCtx = this.timelineCanvas ? this.timelineCanvas.getContext('2d') : null;
        this.rungCtx = this.rungCanvas ? this.rungCanvas.getContext('2d') : null;

        this.scanBuffer = [];       // last N scan records for timeline
        this.maxBuffer = 40;
        this.selectedScan = null;   // scan record currently inspected
        this.paused = false;
        this.dpr = window.devicePixelRatio || 1;

        // Stats
        this.stats = {
            avgTotalUs: 0,
            maxTotalUs: 0,
            avgLogicUs: 0,
            scanRate: 0,
            samples: 0,
        };

        this._initCanvases();
        this._bindEvents();
    }

    _initCanvases() {
        if (this.timelineCanvas) this._scaleCanvas(this.timelineCanvas, this.timelineCtx);
        if (this.rungCanvas) this._scaleCanvas(this.rungCanvas, this.rungCtx);
    }

    _scaleCanvas(canvas, ctx) {
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * this.dpr;
        canvas.height = rect.height * this.dpr;
        ctx.scale(this.dpr, this.dpr);
    }

    _bindEvents() {
        if (!this.timelineCanvas) return;
        this.timelineCanvas.addEventListener('click', (e) => {
            if (this.scanBuffer.length === 0) return;
            const rect = this.timelineCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const barW = rect.width / this.maxBuffer;
            const idx = Math.floor(x / barW);
            if (idx >= 0 && idx < this.scanBuffer.length) {
                this.selectedScan = this.scanBuffer[idx];
                this.renderRungDetail();
                this._highlightSelected(idx);
            }
        });
    }

    // ── Feed new scan data ───────────────────────────────────────
    pushScan(scanRecord) {
        if (this.paused) return;
        this.scanBuffer.push(scanRecord);
        if (this.scanBuffer.length > this.maxBuffer) this.scanBuffer.shift();

        // Update rolling stats
        this.stats.samples++;
        const n = Math.min(this.stats.samples, this.maxBuffer);
        this.stats.avgTotalUs = this.stats.avgTotalUs * ((n - 1) / n) + scanRecord.totalUs / n;
        this.stats.avgLogicUs = this.stats.avgLogicUs * ((n - 1) / n) + scanRecord.phases.logic / n;
        if (scanRecord.totalUs > this.stats.maxTotalUs) this.stats.maxTotalUs = scanRecord.totalUs;
        this.stats.scanRate = this.scanBuffer.length > 1
            ? 1000 / ((this.scanBuffer[this.scanBuffer.length - 1].timestamp - this.scanBuffer[0].timestamp) / (this.scanBuffer.length - 1))
            : 0;

        // Auto-select latest if nothing selected
        if (!this.selectedScan) this.selectedScan = scanRecord;
    }

    // ── Render timeline (all buffered scans as stacked bars) ─────
    renderTimeline() {
        if (!this.timelineCtx || this.scanBuffer.length === 0) return;
        const ctx = this.timelineCtx;
        const canvas = this.timelineCanvas;
        const W = canvas.getBoundingClientRect().width;
        const H = canvas.getBoundingClientRect().height;

        ctx.clearRect(0, 0, W, H);

        // Find max total for scaling
        let maxUs = 1;
        for (const s of this.scanBuffer) {
            if (s.totalUs > maxUs) maxUs = s.totalUs;
        }
        maxUs = Math.max(maxUs, 10); // min 10µs to avoid div/0

        const barW = W / this.maxBuffer;
        const pad = Math.max(1, barW * 0.1);
        const bottomY = H - 16; // leave room for scan numbers

        const colors = {
            input: '#38bdf8',   // sky blue
            logic: '#a78bfa',   // purple
            output: '#34d399',  // green
        };

        for (let i = 0; i < this.scanBuffer.length; i++) {
            const s = this.scanBuffer[i];
            const x = i * barW + pad;
            const bw = barW - pad * 2;
            const totalH = (s.totalUs / maxUs) * (bottomY - 4);

            // Stacked: input (bottom), logic (middle), output (top)
            const inputH = s.totalUs > 0 ? (s.phases.input / s.totalUs) * totalH : 0;
            const logicH = s.totalUs > 0 ? (s.phases.logic / s.totalUs) * totalH : 0;
            const outputH = s.totalUs > 0 ? (s.phases.output / s.totalUs) * totalH : 0;

            let y = bottomY;

            // Input phase
            ctx.fillStyle = colors.input;
            ctx.fillRect(x, y - inputH, bw, inputH);
            y -= inputH;

            // Logic phase
            ctx.fillStyle = colors.logic;
            ctx.fillRect(x, y - logicH, bw, logicH);
            y -= logicH;

            // Output phase
            ctx.fillStyle = colors.output;
            ctx.fillRect(x, y - outputH, bw, outputH);

            // Error indicator
            if (s.error) {
                ctx.fillStyle = '#ef4444';
                ctx.fillRect(x, bottomY - totalH - 3, bw, 3);
            }

            // Scan number label (every 5th)
            if (i % 5 === 0 || i === this.scanBuffer.length - 1) {
                ctx.fillStyle = '#475569';
                ctx.font = '9px monospace';
                ctx.textAlign = 'center';
                ctx.fillText('#' + s.scanNumber, x + bw / 2, H - 2);
            }
        }

        // Legend
        ctx.font = '9px sans-serif';
        const legendY = 10;
        const labels = [
            { label: 'Input', color: colors.input },
            { label: 'Logic', color: colors.logic },
            { label: 'Output', color: colors.output },
        ];
        let lx = W - 160;
        for (const l of labels) {
            ctx.fillStyle = l.color;
            ctx.fillRect(lx, legendY - 6, 8, 8);
            ctx.fillStyle = '#94a3b8';
            ctx.textAlign = 'left';
            ctx.fillText(l.label, lx + 11, legendY + 1);
            lx += 50;
        }

        // Scale label
        ctx.fillStyle = '#64748b';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('max: ' + maxUs.toFixed(0) + 'µs', 4, legendY + 1);

        // Selected indicator
        if (this.selectedScan) {
            const idx = this.scanBuffer.indexOf(this.selectedScan);
            if (idx >= 0) this._highlightSelected(idx);
        }
    }

    _highlightSelected(idx) {
        if (!this.timelineCtx) return;
        const ctx = this.timelineCtx;
        const W = this.timelineCanvas.getBoundingClientRect().width;
        const H = this.timelineCanvas.getBoundingClientRect().height;
        const barW = W / this.maxBuffer;
        const x = idx * barW;

        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, 0, barW - 2, H - 16);
    }

    // ── Render rung detail for selected scan ─────────────────────
    renderRungDetail() {
        if (!this.rungCtx || !this.selectedScan) return;
        const ctx = this.rungCtx;
        const canvas = this.rungCanvas;
        const W = canvas.getBoundingClientRect().width;
        const H = canvas.getBoundingClientRect().height;

        ctx.clearRect(0, 0, W, H);

        const scan = this.selectedScan;
        const rungs = scan.rungResults;
        if (!rungs || rungs.length === 0) {
            ctx.fillStyle = '#64748b';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No rung data for this scan', W / 2, H / 2);
            return;
        }

        // Find slowest rung
        let maxRungUs = 0;
        let slowestIdx = 0;
        for (let i = 0; i < rungs.length; i++) {
            if (rungs[i].timeUs > maxRungUs) {
                maxRungUs = rungs[i].timeUs;
                slowestIdx = i;
            }
        }

        const rowH = Math.min(28, (H - 20) / rungs.length);
        const leftMargin = 52;
        const rightMargin = 70;
        const barArea = W - leftMargin - rightMargin;
        const maxBarUs = Math.max(maxRungUs, 1);

        for (let i = 0; i < rungs.length; i++) {
            const r = rungs[i];
            const y = 10 + i * rowH;

            // Rung label
            ctx.fillStyle = '#94a3b8';
            ctx.font = '10px monospace';
            ctx.textAlign = 'right';
            ctx.fillText('R' + i, leftMargin - 6, y + rowH / 2 + 3);

            // Bar
            const barW = Math.max(2, (r.timeUs / maxBarUs) * barArea);
            let barColor;
            if (r.energized) {
                barColor = i === slowestIdx ? '#fbbf24' : '#34d399'; // yellow if slowest, green if pass
            } else {
                barColor = '#ef4444'; // red if blocked
            }
            ctx.fillStyle = barColor;
            const barH = rowH * 0.6;
            ctx.fillRect(leftMargin, y + (rowH - barH) / 2, barW, barH);

            // Instruction chain overlay
            const instrs = r.instructions || [];
            const instrText = instrs.map(ins => {
                const symbol = ins.passed ? '●' : '○';
                return symbol + ins.type;
            }).join(' ');
            ctx.fillStyle = '#e2e8f0';
            ctx.font = '8px monospace';
            ctx.textAlign = 'left';
            const textY = y + (rowH - barH) / 2 + barH / 2 + 3;
            if (barW > 40) {
                ctx.fillText(instrText, leftMargin + 3, textY);
            }

            // Time label
            ctx.fillStyle = i === slowestIdx ? '#fbbf24' : '#94a3b8';
            ctx.font = '9px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(r.timeUs.toFixed(1) + 'µs', leftMargin + barArea + 4, y + rowH / 2 + 3);

            // Output-changed marker
            if (r.outputChanged) {
                ctx.fillStyle = '#38bdf8';
                ctx.font = '10px sans-serif';
                ctx.fillText('⚡', leftMargin + barArea + rightMargin - 14, y + rowH / 2 + 4);
            }
        }

        // Header
        ctx.fillStyle = '#64748b';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`Scan #${scan.scanNumber} — ${rungs.length} rungs — total: ${scan.totalUs.toFixed(1)}µs`, 4, 8);
    }

    // ── Phase breakdown bar (horizontal for the selected scan) ───
    renderPhaseBar(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !this.selectedScan) return;
        const ctx = canvas.getContext('2d');
        this._scaleCanvas(canvas, ctx);
        const W = canvas.getBoundingClientRect().width;
        const H = canvas.getBoundingClientRect().height;

        ctx.clearRect(0, 0, W, H);
        const s = this.selectedScan;
        const total = s.totalUs || 1;

        const phases = [
            { name: 'INPUT READ', us: s.phases.input, color: '#38bdf8' },
            { name: 'LOGIC EXEC', us: s.phases.logic, color: '#a78bfa' },
            { name: 'OUTPUT UPD', us: s.phases.output, color: '#34d399' },
        ];

        let x = 0;
        const barH = H * 0.5;
        const barY = (H - barH) / 2;

        for (const p of phases) {
            const w = (p.us / total) * W;
            ctx.fillStyle = p.color;
            ctx.fillRect(x, barY, Math.max(w, 2), barH);

            // Label inside if wide enough
            if (w > 60) {
                ctx.fillStyle = '#0f172a';
                ctx.font = 'bold 9px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(p.name, x + w / 2, barY + barH / 2 + 1);
                ctx.font = '8px monospace';
                ctx.fillText(p.us.toFixed(1) + 'µs', x + w / 2, barY + barH / 2 + 11);
            }

            x += w;
        }

        // Border
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, barY, W, barH);
    }

    // ── Master render ────────────────────────────────────────────
    render() {
        this.renderTimeline();
        this.renderRungDetail();
        this.renderPhaseBar('scan-phase-bar');
    }

    togglePause() {
        this.paused = !this.paused;
        return this.paused;
    }

    clear() {
        this.scanBuffer = [];
        this.selectedScan = null;
        this.stats = { avgTotalUs: 0, maxTotalUs: 0, avgLogicUs: 0, scanRate: 0, samples: 0 };
    }

    getStats() {
        return { ...this.stats };
    }
}
