// src/tables.ts
import type { StpaResult } from './types';

type LossRow = { id: string; text: string };
type HazardRow = { id: string; text: string; leadsToLosses: string[] };
type UcaRow = { id: string; text: string; controlLoop?: string; leadsToHazards: string[] };

function sanitizeCell(s: string): string {
    return s.replace(/\|/g, '\\|').trim();
}
function mdTable(headers: string[], rows: string[][]): string {
    const head = `| ${headers.map(sanitizeCell).join(' | ')} |`;
    const sep = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = rows.map((r) => `| ${r.map((c) => sanitizeCell(c)).join(' | ')} |`).join('\n');
    return [head, sep, body].join('\n');
}

export function parseLossRow(line: string): LossRow {
    const m = line.match(/^L(\d+)\s*:\s*(.+)$/i);
    if (m) return { id: `L${m[1]}`, text: m[2].trim() };
    return { id: '', text: line.trim() };
}

export function parseHazardRow(line: string): HazardRow {
    const idm = line.match(/^H(\d+)\s*:\s*(.+)$/i);
    const id = idm ? `H${idm[1]}` : '';
    const meta = (line.match(/\(([^)]*)\)/) || [])[1] || '';
    // Expected format from your prompts: (leads_to: L1, L2, ...)
    const leads = (meta.match(/leads_to\s*:\s*([^)]+)/i) || [])[1] || '';
    const leadsToLosses = leads
        .split(',')
        .map((s) => s.trim())
        .filter((x) => /^L\d+$/i.test(x));
    const text = line.replace(/\([^)]*\)/g, '').replace(/^H\d+\s*:\s*/i, '').trim();
    return { id, text, leadsToLosses };
}

export function parseUcaRow(line: string): UcaRow {
    const idm = line.match(/^UCA(\d+)\s*:\s*(.+)$/i);
    const id = idm ? `UCA${idm[1]}` : '';
    const meta = (line.match(/\(([^)]*)\)/) || [])[1] || '';
    const cl = (meta.match(/control\s*loop\s*:\s*([^;)\]]+)/i) || [])[1];
    // Expected format from your Step 3 prompt: (leads_to: H1, H2)
    const leads = (line.match(/\s*leads_to\s*:\s*([^)]+)/i) || [])[1] || '';
    const leadsToHazards = leads
        .split(',')
        .map((s) => s.trim())
        .filter((x) => /^H\d+$/i.test(x));
    const text = line.replace(/\([^)]*\)/g, '').replace(/^UCA\d+\s*:\s*/i, '').trim();
    return { id, text, controlLoop: cl?.trim(), leadsToHazards };
}

export function buildMarkdownTables(result: StpaResult): string {
    const lossRows: LossRow[] = result.losses.map(parseLossRow);
    const hazRows: HazardRow[] = result.hazards.map(parseHazardRow);
    const ucaRows: UcaRow[] = result.ucas.map(parseUcaRow);

    // 1) Build Loss -> Hazards index from hazards' (leads_to: L#...)
    const lossToHazards = new Map<string, string[]>();
    for (const h of hazRows) {
        if (!h.id) continue;
        for (const l of h.leadsToLosses) {
            const arr = lossToHazards.get(l) ?? [];
            if (!arr.includes(h.id)) arr.push(h.id);
            lossToHazards.set(l, arr);
        }
    }

    // 2) Build Hazard -> UCAs index from UCAs' (leads_to: H#...)
    const hazardToUcas = new Map<string, string[]>();
    for (const u of ucaRows) {
        if (!u.id) continue;
        for (const h of u.leadsToHazards) {
            const arr = hazardToUcas.get(h) ?? [];
            if (!arr.includes(u.id)) arr.push(u.id);
            hazardToUcas.set(h, arr);
        }
    }

    const lossToHazTbl = mdTable(
        ['Loss', 'Hazards (→ Loss)'],
        lossRows.map((l) => {
            const hazards = lossToHazards.get(l.id) ?? [];
            return [l.id || '-', hazards.length ? hazards.join('; ') : '-'];
        })
    );

    const hazardToUcaTbl = mdTable(
        ['Hazard', 'UCAs (→ Hazard)'],
        hazRows
            .filter((h) => !!h.id)
            .map((h) => {
                const ucas = hazardToUcas.get(h.id) ?? [];
                return [h.id || '-', ucas.length ? ucas.join('; ') : '-'];
            })
    );

    return [
        '## Loss → Hazards',
        lossToHazTbl,
        '',
        '## Hazard → UCAs',
        hazardToUcaTbl,
        '',
    ].join('\n');
}
