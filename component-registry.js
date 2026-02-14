// Component Registry - Defines all available PLC components for the visual editor
class ComponentRegistry {
    constructor() {
        this.components = new Map();
        this.categories = [
            { id: 'sensors', label: 'Sensors', icon: '📡' },
            { id: 'actuators', label: 'Actuators', icon: '⚡' },
            { id: 'process', label: 'Process', icon: '🏭' },
            { id: 'logic', label: 'Logic', icon: '🔀' },
            { id: 'indicators', label: 'Indicators', icon: '💡' }
        ];
        this.registerAll();
    }

    register(def) {
        this.components.set(def.type, def);
    }

    get(type) {
        return this.components.get(type);
    }

    getAll() {
        return Array.from(this.components.values());
    }

    getByCategory(catId) {
        return Array.from(this.components.values()).filter(c => c.category === catId);
    }

    registerAll() {
        // ── SENSORS ──────────────────────────────────────────────
        this.register({
            type: 'proximity_sensor',
            category: 'sensors',
            label: 'Proximity Sensor',
            icon: '📡',
            w: 64, h: 52,
            ports: [
                { id: 'out', type: 'output', side: 'right', offset: 0.5, label: 'OUT', dataType: 'digital' }
            ],
            defaultProps: { address: '', label: 'PX', detectRange: 10 },
            color: '#3b82f6',
            renderSVG(w, h, s) {
                const c = s.active ? '#22c55e' : '#3b82f6';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="13" text-anchor="middle" fill="${c}" font-size="8" font-weight="bold">PROX</text>
                    <circle cx="${w/2}" cy="${h/2+5}" r="10" fill="none" stroke="${s.active?'#22c55e':'#475569'}" stroke-width="1.5" stroke-dasharray="3 2"/>
                    <circle cx="${w/2}" cy="${h/2+5}" r="4" fill="${s.active?'#22c55e':'#475569'}"/>`;
            },
            simulate(ins, props, dt, st) {
                return { outputs: { out: st.forced || false }, state: st };
            }
        });

        this.register({
            type: 'photo_sensor',
            category: 'sensors',
            label: 'Photoelectric Sensor',
            icon: '🔦',
            w: 64, h: 52,
            ports: [
                { id: 'out', type: 'output', side: 'right', offset: 0.5, label: 'OUT', dataType: 'digital' }
            ],
            defaultProps: { address: '', label: 'PE', beamType: 'through' },
            color: '#8b5cf6',
            renderSVG(w, h, s) {
                const c = s.active ? '#22c55e' : '#8b5cf6';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="13" text-anchor="middle" fill="${c}" font-size="8" font-weight="bold">PHOTO</text>
                    <line x1="14" y1="${h/2+5}" x2="${w-14}" y2="${h/2+5}" stroke="${s.active?'#22c55e':'#6d28d9'}" stroke-width="2" stroke-dasharray="4 3"/>
                    <circle cx="12" cy="${h/2+5}" r="4" fill="${s.active?'#22c55e':'#6d28d9'}"/>
                    <polygon points="${w-12},${h/2+1} ${w-12},${h/2+9} ${w-6},${h/2+5}" fill="${s.active?'#22c55e':'#6d28d9'}"/>`;
            },
            simulate(ins, props, dt, st) {
                return { outputs: { out: st.forced || false }, state: st };
            }
        });

        this.register({
            type: 'temp_sensor',
            category: 'sensors',
            label: 'Temperature Sensor',
            icon: '🌡️',
            w: 64, h: 52,
            ports: [
                { id: 'out', type: 'output', side: 'right', offset: 0.5, label: 'TEMP', dataType: 'analog' }
            ],
            defaultProps: { address: '', label: 'TE', unit: '°C', min: 0, max: 200 },
            color: '#ef4444',
            renderSVG(w, h, s) {
                const v = s.value || 0;
                const pct = Math.min(1, Math.max(0, v / 200));
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="#ef4444" stroke-width="2"/>
                    <text x="${w/2}" y="13" text-anchor="middle" fill="#f87171" font-size="8" font-weight="bold">TEMP</text>
                    <rect x="12" y="20" width="8" height="24" rx="4" fill="#292524" stroke="#78716c" stroke-width="1"/>
                    <rect x="13" y="${20+24*(1-pct)}" width="6" height="${24*pct}" rx="3" fill="#ef4444"/>
                    <text x="38" y="36" text-anchor="middle" fill="#fca5a5" font-size="10" font-weight="bold">${Math.round(v)}°</text>`;
            },
            simulate(ins, props, dt, st) {
                const v = st.value !== undefined ? st.value : 25;
                return { outputs: { out: v }, state: { ...st, value: v } };
            }
        });

        this.register({
            type: 'pressure_sensor',
            category: 'sensors',
            label: 'Pressure Sensor',
            icon: '🔴',
            w: 64, h: 52,
            ports: [
                { id: 'out', type: 'output', side: 'right', offset: 0.5, label: 'PSI', dataType: 'analog' }
            ],
            defaultProps: { address: '', label: 'PT', unit: 'bar', min: 0, max: 10 },
            color: '#f59e0b',
            renderSVG(w, h, s) {
                const v = s.value || 0;
                const angle = -120 + (v / 10) * 240;
                const rad = angle * Math.PI / 180;
                const cx = w/2, cy = h/2 + 6, r = 14;
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="#f59e0b" stroke-width="2"/>
                    <text x="${w/2}" y="13" text-anchor="middle" fill="#fbbf24" font-size="8" font-weight="bold">PRESS</text>
                    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#0f172a" stroke="#475569" stroke-width="1.5"/>
                    <line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(rad)*10}" y2="${cy + Math.sin(rad)*10}" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/>
                    <circle cx="${cx}" cy="${cy}" r="2" fill="#f59e0b"/>`;
            },
            simulate(ins, props, dt, st) {
                const v = st.value !== undefined ? st.value : 0;
                return { outputs: { out: v }, state: { ...st, value: v } };
            }
        });

        this.register({
            type: 'level_sensor',
            category: 'sensors',
            label: 'Level Sensor',
            icon: '🔵',
            w: 64, h: 52,
            ports: [
                { id: 'out', type: 'output', side: 'right', offset: 0.5, label: 'LVL', dataType: 'analog' }
            ],
            defaultProps: { address: '', label: 'LT', unit: '%', min: 0, max: 100 },
            color: '#06b6d4',
            renderSVG(w, h, s) {
                const v = s.value || 0;
                const pct = Math.min(1, Math.max(0, v / 100));
                const barH = 24;
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="#06b6d4" stroke-width="2"/>
                    <text x="${w/2}" y="13" text-anchor="middle" fill="#22d3ee" font-size="8" font-weight="bold">LEVEL</text>
                    <rect x="14" y="18" width="16" height="${barH}" rx="3" fill="#0c4a6e" stroke="#0e7490" stroke-width="1"/>
                    <rect x="15" y="${18+barH*(1-pct)}" width="14" height="${barH*pct}" rx="2" fill="#06b6d4" opacity="0.8"/>
                    <text x="46" y="34" text-anchor="middle" fill="#67e8f9" font-size="9" font-weight="bold">${Math.round(v)}%</text>`;
            },
            simulate(ins, props, dt, st) {
                const v = st.value !== undefined ? st.value : 50;
                return { outputs: { out: v }, state: { ...st, value: v } };
            }
        });

        this.register({
            type: 'limit_switch',
            category: 'sensors',
            label: 'Limit Switch',
            icon: '🔲',
            w: 64, h: 48,
            ports: [
                { id: 'out', type: 'output', side: 'right', offset: 0.5, label: 'SW', dataType: 'digital' }
            ],
            defaultProps: { address: '', label: 'LS', normallyOpen: true },
            color: '#64748b',
            renderSVG(w, h, s) {
                const c = s.active ? '#22c55e' : '#64748b';
                const armY = s.active ? 4 : 0;
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="13" text-anchor="middle" fill="${c}" font-size="8" font-weight="bold">LIMIT</text>
                    <rect x="18" y="${24+armY}" width="28" height="4" rx="2" fill="${c}"/>
                    <circle cx="18" cy="${26+armY}" r="3" fill="${c}" opacity="0.6"/>
                    <rect x="22" y="30" width="20" height="6" rx="1" fill="#334155" stroke="#475569" stroke-width="1"/>`;
            },
            simulate(ins, props, dt, st) {
                return { outputs: { out: st.forced || false }, state: st };
            }
        });

        this.register({
            type: 'flow_sensor',
            category: 'sensors',
            label: 'Flow Sensor',
            icon: '💧',
            w: 64, h: 52,
            ports: [
                { id: 'out', type: 'output', side: 'right', offset: 0.5, label: 'FLOW', dataType: 'analog' }
            ],
            defaultProps: { address: '', label: 'FT', unit: 'L/min', min: 0, max: 100 },
            color: '#0ea5e9',
            renderSVG(w, h, s) {
                const v = s.value || 0;
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="#0ea5e9" stroke-width="2"/>
                    <text x="${w/2}" y="13" text-anchor="middle" fill="#38bdf8" font-size="8" font-weight="bold">FLOW</text>
                    <path d="M16,30 Q24,22 32,30 Q40,38 48,30" fill="none" stroke="${v>0?'#0ea5e9':'#475569'}" stroke-width="2"/>
                    <text x="${w/2}" y="46" text-anchor="middle" fill="#7dd3fc" font-size="8">${Math.round(v)} L/m</text>`;
            },
            simulate(ins, props, dt, st) {
                const v = st.value !== undefined ? st.value : 0;
                return { outputs: { out: v }, state: { ...st, value: v } };
            }
        });

        // ── ACTUATORS ────────────────────────────────────────────
        this.register({
            type: 'motor',
            category: 'actuators',
            label: 'Electric Motor',
            icon: '⚙️',
            w: 68, h: 56,
            ports: [
                { id: 'run', type: 'input', side: 'left', offset: 0.35, label: 'RUN', dataType: 'digital' },
                { id: 'speed', type: 'input', side: 'left', offset: 0.65, label: 'SPD', dataType: 'analog' },
                { id: 'running', type: 'output', side: 'right', offset: 0.5, label: 'FB', dataType: 'digital' }
            ],
            defaultProps: { address: '', label: 'M', ratedRPM: 1800 },
            color: '#22c55e',
            renderSVG(w, h, s) {
                const on = s.inputs && s.inputs.run;
                const c = on ? '#22c55e' : '#64748b';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="13" text-anchor="middle" fill="${c}" font-size="8" font-weight="bold">MOTOR</text>
                    <circle cx="${w/2}" cy="${h/2+5}" r="14" fill="#0f172a" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="${h/2+9}" text-anchor="middle" fill="${c}" font-size="12" font-weight="bold">M</text>
                    ${on ? `<circle cx="${w/2}" cy="${h/2+5}" r="14" fill="none" stroke="${c}" stroke-width="1" stroke-dasharray="4 4"><animateTransform attributeName="transform" type="rotate" from="0 ${w/2} ${h/2+5}" to="360 ${w/2} ${h/2+5}" dur="1s" repeatCount="indefinite"/></circle>` : ''}`;
            },
            simulate(ins, props, dt, st) {
                const on = ins.run || false;
                return { outputs: { running: on }, state: { ...st, running: on } };
            }
        });

        this.register({
            type: 'solenoid_valve',
            category: 'actuators',
            label: 'Solenoid Valve',
            icon: '🔧',
            w: 64, h: 52,
            ports: [
                { id: 'cmd', type: 'input', side: 'left', offset: 0.5, label: 'CMD', dataType: 'digital' },
                { id: 'state', type: 'output', side: 'right', offset: 0.5, label: 'ST', dataType: 'digital' }
            ],
            defaultProps: { address: '', label: 'SV', type: '2-way' },
            color: '#a855f7',
            renderSVG(w, h, s) {
                const on = s.inputs && s.inputs.cmd;
                const c = on ? '#22c55e' : '#a855f7';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="13" text-anchor="middle" fill="${c}" font-size="8" font-weight="bold">VALVE</text>
                    <rect x="14" y="20" width="36" height="20" rx="3" fill="#0f172a" stroke="${c}" stroke-width="1.5"/>
                    <line x1="${on?14:50}" y1="24" x2="${on?50:14}" y2="36" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="47" text-anchor="middle" fill="${c}" font-size="7" font-weight="bold">${on?'OPEN':'SHUT'}</text>`;
            },
            simulate(ins, props, dt, st) {
                const on = ins.cmd || false;
                return { outputs: { state: on }, state: { ...st, open: on } };
            }
        });

        this.register({
            type: 'pneumatic_cyl',
            category: 'actuators',
            label: 'Pneumatic Cylinder',
            icon: '🔩',
            w: 80, h: 48,
            ports: [
                { id: 'extend', type: 'input', side: 'left', offset: 0.35, label: 'EXT', dataType: 'digital' },
                { id: 'retract', type: 'input', side: 'left', offset: 0.65, label: 'RET', dataType: 'digital' },
                { id: 'ext_fb', type: 'output', side: 'right', offset: 0.35, label: 'EXT', dataType: 'digital' },
                { id: 'ret_fb', type: 'output', side: 'right', offset: 0.65, label: 'RET', dataType: 'digital' }
            ],
            defaultProps: { address: '', label: 'CYL', stroke: 100 },
            color: '#78716c',
            renderSVG(w, h, s) {
                const ext = s.inputs && s.inputs.extend;
                const pos = ext ? 20 : 0;
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="#78716c" stroke-width="2"/>
                    <text x="${w/2}" y="12" text-anchor="middle" fill="#a8a29e" font-size="7" font-weight="bold">CYLINDER</text>
                    <rect x="10" y="18" width="40" height="18" rx="3" fill="#292524" stroke="#57534e" stroke-width="1.5"/>
                    <rect x="${28+pos}" y="20" width="26" height="14" rx="2" fill="#78716c" stroke="#a8a29e" stroke-width="1"/>
                    <line x1="${42+pos}" y1="22" x2="${42+pos}" y2="32" stroke="#d6d3d1" stroke-width="1.5"/>`;
            },
            simulate(ins, props, dt, st) {
                const extended = ins.extend && !ins.retract;
                const retracted = ins.retract && !ins.extend;
                return { outputs: { ext_fb: extended, ret_fb: retracted || (!extended) }, state: { ...st, extended } };
            }
        });

        this.register({
            type: 'pump',
            category: 'actuators',
            label: 'Pump',
            icon: '🔄',
            w: 64, h: 56,
            ports: [
                { id: 'run', type: 'input', side: 'left', offset: 0.5, label: 'RUN', dataType: 'digital' },
                { id: 'running', type: 'output', side: 'right', offset: 0.5, label: 'FB', dataType: 'digital' }
            ],
            defaultProps: { address: '', label: 'P', flowRate: 50 },
            color: '#0ea5e9',
            renderSVG(w, h, s) {
                const on = s.inputs && s.inputs.run;
                const c = on ? '#22c55e' : '#0ea5e9';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="13" text-anchor="middle" fill="${c}" font-size="8" font-weight="bold">PUMP</text>
                    <circle cx="${w/2}" cy="${h/2+5}" r="12" fill="#0f172a" stroke="${c}" stroke-width="2"/>
                    <path d="M${w/2-6},${h/2+5} L${w/2+6},${h/2+5} M${w/2},${h/2-1} L${w/2},${h/2+11}" stroke="${c}" stroke-width="2" stroke-linecap="round"/>
                    ${on?`<circle cx="${w/2}" cy="${h/2+5}" r="12" fill="none" stroke="${c}" stroke-width="1" opacity="0.5" stroke-dasharray="3 3"><animateTransform attributeName="transform" type="rotate" from="0 ${w/2} ${h/2+5}" to="360 ${w/2} ${h/2+5}" dur="0.8s" repeatCount="indefinite"/></circle>`:''}`;
            },
            simulate(ins, props, dt, st) {
                const on = ins.run || false;
                return { outputs: { running: on }, state: { ...st, running: on } };
            }
        });

        this.register({
            type: 'heater',
            category: 'actuators',
            label: 'Heater',
            icon: '🔥',
            w: 64, h: 52,
            ports: [
                { id: 'cmd', type: 'input', side: 'left', offset: 0.5, label: 'ON', dataType: 'digital' },
                { id: 'active', type: 'output', side: 'right', offset: 0.5, label: 'FB', dataType: 'digital' }
            ],
            defaultProps: { address: '', label: 'HTR', power: 1000 },
            color: '#ef4444',
            renderSVG(w, h, s) {
                const on = s.inputs && s.inputs.cmd;
                const c = on ? '#ef4444' : '#64748b';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="13" text-anchor="middle" fill="${c}" font-size="8" font-weight="bold">HEATER</text>
                    <path d="M18,26 Q24,20 24,28 Q24,36 30,30 Q36,24 36,32 Q36,40 42,34 Q48,28 48,36" fill="none" stroke="${on?'#ef4444':'#475569'}" stroke-width="2" stroke-linecap="round"/>
                    ${on?'<rect x="14" y="40" width="36" height="4" rx="2" fill="#ef4444" opacity="0.6"><animate attributeName="opacity" values="0.3;0.8;0.3" dur="1s" repeatCount="indefinite"/></rect>':''}`;
            },
            simulate(ins, props, dt, st) {
                const on = ins.cmd || false;
                return { outputs: { active: on }, state: { ...st, active: on } };
            }
        });

        // ── PROCESS ELEMENTS ─────────────────────────────────────
        this.register({
            type: 'conveyor',
            category: 'process',
            label: 'Conveyor Belt',
            icon: '➡️',
            w: 120, h: 44,
            ports: [
                { id: 'motor', type: 'input', side: 'left', offset: 0.3, label: 'MTR', dataType: 'digital' },
                { id: 'item_in', type: 'input', side: 'left', offset: 0.7, label: 'IN', dataType: 'digital' },
                { id: 'item_out', type: 'output', side: 'right', offset: 0.5, label: 'OUT', dataType: 'digital' }
            ],
            defaultProps: { address: '', label: 'CONV', speed: 1.0, length: 3 },
            color: '#64748b',
            renderSVG(w, h, s) {
                const on = s.inputs && s.inputs.motor;
                const c = on ? '#22c55e' : '#64748b';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${c}" stroke-width="2"/>
                    <rect x="8" y="16" width="${w-16}" height="12" rx="3" fill="#334155" stroke="#475569" stroke-width="1"/>
                    ${on?`<rect x="8" y="16" width="${w-16}" height="12" rx="3" fill="url(#conveyorStripe)" opacity="0.3"><animateTransform attributeName="transform" type="translate" from="0 0" to="12 0" dur="0.5s" repeatCount="indefinite"/></rect>`:''}
                    <circle cx="14" cy="34" r="4" fill="${c}"/>
                    <circle cx="${w-14}" cy="34" r="4" fill="${c}"/>
                    <text x="${w/2}" y="12" text-anchor="middle" fill="${c}" font-size="7" font-weight="bold">CONVEYOR</text>`;
            },
            simulate(ins, props, dt, st) {
                const on = ins.motor || false;
                let timer = st.timer || 0;
                let itemOut = false;
                if (on && ins.item_in) {
                    timer += dt;
                    if (timer > (props.length || 3) * 1000) {
                        itemOut = true;
                        timer = 0;
                    }
                } else if (!on) {
                    timer = 0;
                }
                return { outputs: { item_out: itemOut }, state: { ...st, timer, running: on } };
            }
        });

        this.register({
            type: 'tank',
            category: 'process',
            label: 'Storage Tank',
            icon: '🛢️',
            w: 72, h: 80,
            ports: [
                { id: 'inlet', type: 'input', side: 'top', offset: 0.5, label: 'IN', dataType: 'digital' },
                { id: 'outlet', type: 'input', side: 'bottom', offset: 0.3, label: 'DRAIN', dataType: 'digital' },
                { id: 'level', type: 'output', side: 'right', offset: 0.3, label: 'LVL', dataType: 'analog' },
                { id: 'full', type: 'output', side: 'right', offset: 0.6, label: 'FULL', dataType: 'digital' },
                { id: 'empty', type: 'output', side: 'right', offset: 0.85, label: 'EMPTY', dataType: 'digital' }
            ],
            defaultProps: { address: '', label: 'TK', capacity: 100, fillRate: 10, drainRate: 8 },
            color: '#06b6d4',
            renderSVG(w, h, s) {
                const level = (s.level || 0);
                const pct = Math.min(1, Math.max(0, level / 100));
                const tankH = 46;
                const tankY = 20;
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="#06b6d4" stroke-width="2"/>
                    <text x="${w/2}" y="14" text-anchor="middle" fill="#22d3ee" font-size="8" font-weight="bold">TANK</text>
                    <rect x="10" y="${tankY}" width="${w-20}" height="${tankH}" rx="4" fill="#0c4a6e" stroke="#0e7490" stroke-width="1.5"/>
                    <rect x="12" y="${tankY + tankH*(1-pct)}" width="${w-24}" height="${tankH*pct}" rx="3" fill="#06b6d4" opacity="0.7"/>
                    <text x="${w/2}" y="74" text-anchor="middle" fill="#67e8f9" font-size="9" font-weight="bold">${Math.round(level)}%</text>`;
            },
            simulate(ins, props, dt, st) {
                let level = st.level !== undefined ? st.level : 50;
                const dtSec = dt / 1000;
                if (ins.inlet) level += (props.fillRate || 10) * dtSec;
                if (ins.outlet) level -= (props.drainRate || 8) * dtSec;
                level = Math.min(props.capacity || 100, Math.max(0, level));
                const full = level >= (props.capacity || 100) * 0.95;
                const empty = level <= (props.capacity || 100) * 0.05;
                return { outputs: { level, full, empty }, state: { ...st, level } };
            }
        });

        this.register({
            type: 'mixer',
            category: 'process',
            label: 'Mixer',
            icon: '🔄',
            w: 72, h: 64,
            ports: [
                { id: 'motor', type: 'input', side: 'left', offset: 0.5, label: 'RUN', dataType: 'digital' },
                { id: 'running', type: 'output', side: 'right', offset: 0.5, label: 'FB', dataType: 'digital' }
            ],
            defaultProps: { address: '', label: 'MIX', speed: 60 },
            color: '#8b5cf6',
            renderSVG(w, h, s) {
                const on = s.inputs && s.inputs.motor;
                const c = on ? '#22c55e' : '#8b5cf6';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="13" text-anchor="middle" fill="${c}" font-size="8" font-weight="bold">MIXER</text>
                    <rect x="14" y="20" width="${w-28}" height="30" rx="4" fill="#0f172a" stroke="#475569" stroke-width="1.5"/>
                    <line x1="${w/2}" y1="18" x2="${w/2}" y2="35" stroke="${c}" stroke-width="2"/>
                    ${on?`<g><line x1="${w/2-8}" y1="35" x2="${w/2+8}" y2="35" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><animateTransform attributeName="transform" type="rotate" from="0 ${w/2} 35" to="360 ${w/2} 35" dur="0.6s" repeatCount="indefinite"/></g>`
                        :`<line x1="${w/2-8}" y1="35" x2="${w/2+8}" y2="35" stroke="#475569" stroke-width="2.5" stroke-linecap="round"/>`}
                    <text x="${w/2}" y="58" text-anchor="middle" fill="${c}" font-size="7">${on?'RUNNING':'IDLE'}</text>`;
            },
            simulate(ins, props, dt, st) {
                const on = ins.motor || false;
                return { outputs: { running: on }, state: { ...st, running: on } };
            }
        });

        this.register({
            type: 'pipe',
            category: 'process',
            label: 'Pipe Section',
            icon: '🔗',
            w: 80, h: 32,
            ports: [
                { id: 'in', type: 'input', side: 'left', offset: 0.5, label: 'IN', dataType: 'digital' },
                { id: 'out', type: 'output', side: 'right', offset: 0.5, label: 'OUT', dataType: 'digital' }
            ],
            defaultProps: { label: 'PIPE', diameter: 2 },
            color: '#475569',
            renderSVG(w, h, s) {
                const flow = s.inputs && s.inputs.in;
                const c = flow ? '#0ea5e9' : '#475569';
                return `<rect width="${w}" height="${h}" rx="4" fill="#1e293b" stroke="${c}" stroke-width="1.5"/>
                    <rect x="4" y="10" width="${w-8}" height="12" rx="6" fill="${flow?'#0c4a6e':'#1e293b'}" stroke="${c}" stroke-width="1.5"/>
                    ${flow?`<rect x="6" y="12" width="${w-12}" height="8" rx="4" fill="#0ea5e9" opacity="0.4"><animate attributeName="opacity" values="0.2;0.6;0.2" dur="0.8s" repeatCount="indefinite"/></rect>`:''}`;
            },
            simulate(ins, props, dt, st) {
                return { outputs: { out: ins.in || false }, state: st };
            }
        });

        // ── LOGIC ELEMENTS ───────────────────────────────────────
        this.register({
            type: 'and_gate',
            category: 'logic',
            label: 'AND Gate',
            icon: '&',
            w: 60, h: 48,
            ports: [
                { id: 'a', type: 'input', side: 'left', offset: 0.3, label: 'A', dataType: 'digital' },
                { id: 'b', type: 'input', side: 'left', offset: 0.7, label: 'B', dataType: 'digital' },
                { id: 'out', type: 'output', side: 'right', offset: 0.5, label: 'Q', dataType: 'digital' }
            ],
            defaultProps: { label: 'AND' },
            color: '#f59e0b',
            renderSVG(w, h, s) {
                const out = s.outputs && s.outputs.out;
                const c = out ? '#22c55e' : '#f59e0b';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="${h/2+4}" text-anchor="middle" fill="${c}" font-size="14" font-weight="bold">&amp;</text>
                    <text x="${w/2}" y="12" text-anchor="middle" fill="${c}" font-size="7" font-weight="bold">AND</text>`;
            },
            simulate(ins, props, dt, st) {
                const out = (ins.a || false) && (ins.b || false);
                return { outputs: { out }, state: st };
            }
        });

        this.register({
            type: 'or_gate',
            category: 'logic',
            label: 'OR Gate',
            icon: '|',
            w: 60, h: 48,
            ports: [
                { id: 'a', type: 'input', side: 'left', offset: 0.3, label: 'A', dataType: 'digital' },
                { id: 'b', type: 'input', side: 'left', offset: 0.7, label: 'B', dataType: 'digital' },
                { id: 'out', type: 'output', side: 'right', offset: 0.5, label: 'Q', dataType: 'digital' }
            ],
            defaultProps: { label: 'OR' },
            color: '#3b82f6',
            renderSVG(w, h, s) {
                const out = s.outputs && s.outputs.out;
                const c = out ? '#22c55e' : '#3b82f6';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="${h/2+4}" text-anchor="middle" fill="${c}" font-size="14" font-weight="bold">≥1</text>
                    <text x="${w/2}" y="12" text-anchor="middle" fill="${c}" font-size="7" font-weight="bold">OR</text>`;
            },
            simulate(ins, props, dt, st) {
                const out = (ins.a || false) || (ins.b || false);
                return { outputs: { out }, state: st };
            }
        });

        this.register({
            type: 'not_gate',
            category: 'logic',
            label: 'NOT Gate',
            icon: '!',
            w: 56, h: 44,
            ports: [
                { id: 'a', type: 'input', side: 'left', offset: 0.5, label: 'IN', dataType: 'digital' },
                { id: 'out', type: 'output', side: 'right', offset: 0.5, label: 'Q', dataType: 'digital' }
            ],
            defaultProps: { label: 'NOT' },
            color: '#ef4444',
            renderSVG(w, h, s) {
                const out = s.outputs && s.outputs.out;
                const c = out ? '#22c55e' : '#ef4444';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="${h/2+3}" text-anchor="middle" fill="${c}" font-size="12" font-weight="bold">!</text>
                    <text x="${w/2}" y="12" text-anchor="middle" fill="${c}" font-size="7" font-weight="bold">NOT</text>
                    <circle cx="${w-8}" cy="${h/2}" r="3" fill="none" stroke="${c}" stroke-width="1.5"/>`;
            },
            simulate(ins, props, dt, st) {
                const out = !(ins.a || false);
                return { outputs: { out }, state: st };
            }
        });

        this.register({
            type: 'timer_ton',
            category: 'logic',
            label: 'Timer ON-Delay',
            icon: '⏱️',
            w: 68, h: 56,
            ports: [
                { id: 'enable', type: 'input', side: 'left', offset: 0.3, label: 'EN', dataType: 'digital' },
                { id: 'reset', type: 'input', side: 'left', offset: 0.7, label: 'RST', dataType: 'digital' },
                { id: 'done', type: 'output', side: 'right', offset: 0.35, label: 'DN', dataType: 'digital' },
                { id: 'elapsed', type: 'output', side: 'right', offset: 0.7, label: 'ET', dataType: 'analog' }
            ],
            defaultProps: { label: 'TON', preset: 5000 },
            color: '#f59e0b',
            renderSVG(w, h, s) {
                const done = s.outputs && s.outputs.done;
                const elapsed = s.elapsed || 0;
                const preset = s.preset || 5000;
                const pct = Math.min(1, elapsed / preset);
                const c = done ? '#22c55e' : '#f59e0b';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="13" text-anchor="middle" fill="${c}" font-size="8" font-weight="bold">TON</text>
                    <rect x="10" y="20" width="${w-20}" height="8" rx="3" fill="#292524"/>
                    <rect x="10" y="20" width="${(w-20)*pct}" height="8" rx="3" fill="${c}"/>
                    <text x="${w/2}" y="42" text-anchor="middle" fill="#d4d4d8" font-size="8">${(elapsed/1000).toFixed(1)}s/${(preset/1000).toFixed(1)}s</text>`;
            },
            simulate(ins, props, dt, st) {
                let elapsed = st.elapsed || 0;
                const preset = props.preset || 5000;
                if (ins.reset) {
                    elapsed = 0;
                } else if (ins.enable) {
                    elapsed = Math.min(preset, elapsed + dt);
                } else {
                    elapsed = 0;
                }
                const done = elapsed >= preset;
                return { outputs: { done, elapsed }, state: { ...st, elapsed, preset } };
            }
        });

        this.register({
            type: 'counter_ctu',
            category: 'logic',
            label: 'Counter Up',
            icon: '#️⃣',
            w: 68, h: 56,
            ports: [
                { id: 'count', type: 'input', side: 'left', offset: 0.3, label: 'CU', dataType: 'digital' },
                { id: 'reset', type: 'input', side: 'left', offset: 0.7, label: 'RST', dataType: 'digital' },
                { id: 'done', type: 'output', side: 'right', offset: 0.35, label: 'DN', dataType: 'digital' },
                { id: 'value', type: 'output', side: 'right', offset: 0.7, label: 'CV', dataType: 'analog' }
            ],
            defaultProps: { label: 'CTU', preset: 10 },
            color: '#14b8a6',
            renderSVG(w, h, s) {
                const count = s.count || 0;
                const preset = s.preset || 10;
                const done = count >= preset;
                const c = done ? '#22c55e' : '#14b8a6';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="13" text-anchor="middle" fill="${c}" font-size="8" font-weight="bold">CTU</text>
                    <text x="${w/2}" y="34" text-anchor="middle" fill="#d4d4d8" font-size="14" font-weight="bold">${count}</text>
                    <text x="${w/2}" y="48" text-anchor="middle" fill="#71717a" font-size="8">/ ${preset}</text>`;
            },
            simulate(ins, props, dt, st) {
                let count = st.count || 0;
                const preset = props.preset || 10;
                const prevCount = st.prevCountInput || false;
                if (ins.reset) {
                    count = 0;
                } else if (ins.count && !prevCount) {
                    count++;
                }
                const done = count >= preset;
                return { outputs: { done, value: count }, state: { ...st, count, preset, prevCountInput: ins.count || false } };
            }
        });

        this.register({
            type: 'sr_latch',
            category: 'logic',
            label: 'SR Latch',
            icon: '🔒',
            w: 60, h: 48,
            ports: [
                { id: 'set', type: 'input', side: 'left', offset: 0.3, label: 'S', dataType: 'digital' },
                { id: 'reset', type: 'input', side: 'left', offset: 0.7, label: 'R', dataType: 'digital' },
                { id: 'q', type: 'output', side: 'right', offset: 0.5, label: 'Q', dataType: 'digital' }
            ],
            defaultProps: { label: 'SR' },
            color: '#6366f1',
            renderSVG(w, h, s) {
                const q = s.outputs && s.outputs.q;
                const c = q ? '#22c55e' : '#6366f1';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="12" text-anchor="middle" fill="${c}" font-size="7" font-weight="bold">SR LATCH</text>
                    <text x="${w/2}" y="${h/2+6}" text-anchor="middle" fill="${c}" font-size="14" font-weight="bold">${q?'1':'0'}</text>`;
            },
            simulate(ins, props, dt, st) {
                let q = st.q || false;
                if (ins.set) q = true;
                if (ins.reset) q = false;
                return { outputs: { q }, state: { ...st, q } };
            }
        });

        // ── INDICATORS ───────────────────────────────────────────
        this.register({
            type: 'indicator_light',
            category: 'indicators',
            label: 'Indicator Light',
            icon: '💡',
            w: 52, h: 52,
            ports: [
                { id: 'cmd', type: 'input', side: 'left', offset: 0.5, label: 'IN', dataType: 'digital' }
            ],
            defaultProps: { address: '', label: 'PL', color: 'green' },
            color: '#22c55e',
            renderSVG(w, h, s) {
                const on = s.inputs && s.inputs.cmd;
                const lc = s.props?.color || 'green';
                const colors = { green: '#22c55e', red: '#ef4444', yellow: '#eab308', blue: '#3b82f6', white: '#f1f5f9' };
                const fill = on ? (colors[lc] || colors.green) : '#374151';
                const glow = on ? `filter="url(#glow)"` : '';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="#475569" stroke-width="2"/>
                    <text x="${w/2}" y="13" text-anchor="middle" fill="#94a3b8" font-size="7" font-weight="bold">LIGHT</text>
                    <circle cx="${w/2}" cy="${h/2+5}" r="12" fill="${fill}" ${glow} stroke="#475569" stroke-width="1.5"/>
                    ${on?`<circle cx="${w/2}" cy="${h/2+5}" r="12" fill="${fill}" opacity="0.3"><animate attributeName="r" values="12;16;12" dur="1.5s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.3;0;0.3" dur="1.5s" repeatCount="indefinite"/></circle>`:''}`;
            },
            simulate(ins, props, dt, st) {
                return { outputs: {}, state: { ...st, on: ins.cmd || false } };
            }
        });

        this.register({
            type: 'buzzer',
            category: 'indicators',
            label: 'Buzzer / Horn',
            icon: '🔔',
            w: 56, h: 48,
            ports: [
                { id: 'cmd', type: 'input', side: 'left', offset: 0.5, label: 'IN', dataType: 'digital' }
            ],
            defaultProps: { address: '', label: 'BZ' },
            color: '#f59e0b',
            renderSVG(w, h, s) {
                const on = s.inputs && s.inputs.cmd;
                const c = on ? '#f59e0b' : '#64748b';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${c}" stroke-width="2"/>
                    <text x="${w/2}" y="12" text-anchor="middle" fill="${c}" font-size="7" font-weight="bold">BUZZER</text>
                    <circle cx="${w/2}" cy="${h/2+4}" r="8" fill="${on?'#fbbf24':'#1e293b'}" stroke="${c}" stroke-width="1.5"/>
                    ${on?`<path d="M${w/2+12},${h/2} Q${w/2+18},${h/2+4} ${w/2+12},${h/2+8}" fill="none" stroke="#fbbf24" stroke-width="1.5" opacity="0.7"><animate attributeName="opacity" values="0;1;0" dur="0.4s" repeatCount="indefinite"/></path>
                    <path d="M${w/2+15},${h/2-3} Q${w/2+22},${h/2+4} ${w/2+15},${h/2+11}" fill="none" stroke="#fbbf24" stroke-width="1" opacity="0.5"><animate attributeName="opacity" values="0;0.7;0" dur="0.4s" repeatCount="indefinite" begin="0.1s"/></path>`:''}`;
            },
            simulate(ins, props, dt, st) {
                return { outputs: {}, state: { ...st, on: ins.cmd || false } };
            }
        });

        this.register({
            type: 'gauge',
            category: 'indicators',
            label: 'Analog Gauge',
            icon: '🔘',
            w: 64, h: 60,
            ports: [
                { id: 'value', type: 'input', side: 'left', offset: 0.5, label: 'IN', dataType: 'analog' }
            ],
            defaultProps: { label: 'GAUGE', min: 0, max: 100, unit: '%' },
            color: '#06b6d4',
            renderSVG(w, h, s) {
                const v = (s.inputs && s.inputs.value) || 0;
                const min = s.props?.min || 0;
                const max = s.props?.max || 100;
                const pct = Math.min(1, Math.max(0, (v - min) / (max - min)));
                const angle = -120 + pct * 240;
                const rad = angle * Math.PI / 180;
                const cx = w/2, cy = h/2 + 6, r = 16;
                const color = pct > 0.8 ? '#ef4444' : pct > 0.6 ? '#f59e0b' : '#22c55e';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="#06b6d4" stroke-width="2"/>
                    <text x="${w/2}" y="12" text-anchor="middle" fill="#22d3ee" font-size="7" font-weight="bold">GAUGE</text>
                    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#0f172a" stroke="#334155" stroke-width="1.5"/>
                    <path d="M${cx + Math.cos(-210*Math.PI/180)*r},${cy + Math.sin(-210*Math.PI/180)*r} A${r},${r} 0 1,1 ${cx + Math.cos(30*Math.PI/180)*r},${cy + Math.sin(30*Math.PI/180)*r}" fill="none" stroke="#334155" stroke-width="3" stroke-linecap="round"/>
                    <line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(rad)*12}" y2="${cy + Math.sin(rad)*12}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
                    <circle cx="${cx}" cy="${cy}" r="2" fill="${color}"/>
                    <text x="${w/2}" y="${h-4}" text-anchor="middle" fill="#d4d4d8" font-size="8" font-weight="bold">${typeof v === 'number' ? v.toFixed(0) : '0'}</text>`;
            },
            simulate(ins, props, dt, st) {
                return { outputs: {}, state: { ...st, value: ins.value || 0 } };
            }
        });

        this.register({
            type: 'display_7seg',
            category: 'indicators',
            label: '7-Segment Display',
            icon: '🔢',
            w: 60, h: 48,
            ports: [
                { id: 'value', type: 'input', side: 'left', offset: 0.5, label: 'VAL', dataType: 'analog' }
            ],
            defaultProps: { label: 'DSP', digits: 3 },
            color: '#ef4444',
            renderSVG(w, h, s) {
                const v = (s.inputs && s.inputs.value) || 0;
                const digits = s.props?.digits || 3;
                const text = typeof v === 'number' ? v.toFixed(0).padStart(digits, '0').slice(-digits) : '000';
                return `<rect width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="#ef4444" stroke-width="2"/>
                    <text x="${w/2}" y="12" text-anchor="middle" fill="#fca5a5" font-size="7" font-weight="bold">DISPLAY</text>
                    <rect x="8" y="18" width="${w-16}" height="22" rx="3" fill="#0f0f0f" stroke="#333" stroke-width="1"/>
                    <text x="${w/2}" y="35" text-anchor="middle" fill="#ef4444" font-size="16" font-family="monospace" font-weight="bold">${text}</text>`;
            },
            simulate(ins, props, dt, st) {
                return { outputs: {}, state: { ...st, value: ins.value || 0 } };
            }
        });
    }

    // Get port position in world coordinates given component placement
    getPortPosition(componentDef, port, compX, compY) {
        const w = componentDef.w;
        const h = componentDef.h;
        let x, y;
        switch (port.side) {
            case 'left':   x = compX;     y = compY + h * port.offset; break;
            case 'right':  x = compX + w; y = compY + h * port.offset; break;
            case 'top':    x = compX + w * port.offset; y = compY; break;
            case 'bottom': x = compX + w * port.offset; y = compY + h; break;
            default:       x = compX;     y = compY; break;
        }
        return { x, y };
    }
}
