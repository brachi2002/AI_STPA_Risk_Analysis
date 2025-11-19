// src/diagrams.ts
import type { ControlStructInput, StpaResult } from './types';
import { parseHazardRow, parseUcaRow } from './tables';

function esc(s: string) { return s.replace(/[{}\[\]()|]/g, ' '); }
function nodeId(prefix: string, i: number) { return `${prefix}${i}`; }

export function buildControlStructureMermaid(cs: ControlStructInput): string {
    const lines: string[] = [];
    lines.push('```mermaid');
    lines.push('graph TD');

    const add = (arr: string[] | undefined, pref: string, shape: '[]' | '()' = '[]') => {
        (arr || []).forEach((n, i) => {
            const id = nodeId(pref, i);
            const label = esc(n);
            if (shape === '()') {
                lines.push(`${id}((${label}))`);
            } else {
                lines.push(`${id}[${label}]`);
            }
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

export function buildImpactGraphMermaid(stpa: StpaResult): string {
    const lines: string[] = [];
    lines.push('```mermaid');
    lines.push('graph LR');

    // Nodes
    stpa.ucas.forEach((u) => lines.push(`${idOf(u)}[${esc(u)}]:::uca`));
    stpa.hazards.forEach((h) => lines.push(`${idOf(h)}[${esc(h)}]:::haz`));
    stpa.losses.forEach((l) => lines.push(`${idOf(l)}[${esc(l)}]:::loss`));

    // Edges UCA -> H (from related)
    stpa.ucas.forEach((u) => {
        const uid = idOf(u);
        const meta = parseUcaRow(u);
        meta.relatedHazards.forEach((hid) => { if (uid && hid) { lines.push(`${uid} --> ${hid}`); } });
    });

    // Edges H -> L
    stpa.hazards.forEach((h) => {
        const hid = idOf(h);
        const meta = parseHazardRow(h);
        meta.relatedLosses.forEach((lid) => { if (hid && lid) { lines.push(`${hid} --> ${lid}`); } });
    });

    // Styles
    lines.push('classDef uca fill:#E6F7FF,stroke:#06c;');
    lines.push('classDef haz fill:#FFF4E6,stroke:#c60;');
    lines.push('classDef loss fill:#FDECEC,stroke:#c00;');
    lines.push('```');
    return lines.join('\n');
}

function idOf(line: string): string {
    const u = line.match(/^UCA(\d+)/i);
    if (u) { return `UCA${u[1]}`; }
    const h = line.match(/^H(\d+)/i);
    if (h) { return `H${h[1]}`; }
    const l = line.match(/^L(\d+)/i);
    if (l) { return `L${l[1]}`; }
    return 'N' + Math.random().toString(36).slice(2, 7);
}
