"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildControlStructureMermaid = buildControlStructureMermaid;
exports.buildImpactGraphMermaid = buildImpactGraphMermaid;
const tables_1 = require("./tables");
function esc(s) { return s.replace(/[{}\[\]()|]/g, ' '); }
function nodeId(prefix, i) { return `${prefix}${i}`; }
function buildControlStructureMermaid(cs) {
    const lines = [];
    lines.push('```mermaid');
    lines.push('graph TD');
    const add = (arr, pref, shape = '[]') => {
        (arr || []).forEach((n, i) => {
            const id = nodeId(pref, i);
            const label = esc(n);
            if (shape === '()')
                lines.push(`${id}((${label}))`);
            else
                lines.push(`${id}[${label}]`);
        });
    };
    add(cs.actors, 'Actor');
    add(cs.controllers, 'Ctrl');
    add(cs.sensors, 'Sens');
    add(cs.actuators, 'Act');
    add(cs.process, 'Proc');
    add(cs.environment, 'Env', '()');
    // Links
    (cs.actors || []).forEach((_, ai) => (cs.controllers || []).forEach((__, ci) => lines.push(`Actor${ai} -->|commands| Ctrl${ci}`)));
    (cs.sensors || []).forEach((_, si) => (cs.controllers || []).forEach((__, ci) => lines.push(`Sens${si} -->|measurements| Ctrl${ci}`)));
    (cs.controllers || []).forEach((_, ci) => (cs.actuators || []).forEach((__, ai) => lines.push(`Ctrl${ci} -->|setpoints| Act${ai}`)));
    const targets = (cs.process && cs.process.length ? cs.process.map((_, i) => `Proc${i}`) : (cs.environment || []).map((_, i) => `Env${i}`));
    (cs.actuators || []).forEach((_, ai) => targets.forEach((t) => lines.push(`Act${ai} --> ${t}`)));
    lines.push('```');
    return lines.join('\n');
}
function buildImpactGraphMermaid(stpa) {
    const lines = [];
    lines.push('```mermaid');
    lines.push('graph LR');
    // Nodes
    stpa.ucas.forEach((u) => lines.push(`${idOf(u)}[${esc(u)}]:::uca`));
    stpa.hazards.forEach((h) => lines.push(`${idOf(h)}[${esc(h)}]:::haz`));
    stpa.losses.forEach((l) => lines.push(`${idOf(l)}[${esc(l)}]:::loss`));
    // Edges UCA -> H (from related)
    stpa.ucas.forEach((u) => {
        const uid = idOf(u);
        const meta = (0, tables_1.parseUcaRow)(u);
        meta.relatedHazards.forEach((hid) => { if (uid && hid)
            lines.push(`${uid} --> ${hid}`); });
    });
    // Edges H -> L
    stpa.hazards.forEach((h) => {
        const hid = idOf(h);
        const meta = (0, tables_1.parseHazardRow)(h);
        meta.relatedLosses.forEach((lid) => { if (hid && lid)
            lines.push(`${hid} --> ${lid}`); });
    });
    // Styles
    lines.push('classDef uca fill:#E6F7FF,stroke:#06c;');
    lines.push('classDef haz fill:#FFF4E6,stroke:#c60;');
    lines.push('classDef loss fill:#FDECEC,stroke:#c00;');
    lines.push('```');
    return lines.join('\n');
}
function idOf(line) {
    const u = line.match(/^UCA(\d+)/i);
    if (u)
        return `UCA${u[1]}`;
    const h = line.match(/^H(\d+)/i);
    if (h)
        return `H${h[1]}`;
    const l = line.match(/^L(\d+)/i);
    if (l)
        return `L${l[1]}`;
    return 'N' + Math.random().toString(36).slice(2, 7);
}
//# sourceMappingURL=diagrams.js.map