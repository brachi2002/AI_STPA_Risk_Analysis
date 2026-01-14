// src/tables.ts
import type { StpaResult } from './types';

/**
 * Helpers for parsing STPA rows and building MD tables for losses, hazards, and UCAs.
 */
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

function collectIds(raw: string, pattern: RegExp): string[] {
    return raw
        .split(/[;,]/)
        .map((part) => part.trim())
        .map((part) => part.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
        .filter((part) => pattern.test(part));
}

function extractTargets(line: string, keys: string[], pattern: RegExp): string[] {
    for (const key of keys) {
        const rx = new RegExp(`${key}\\s*:\\s*([^\\)]+)`, 'i');
        const match = line.match(rx);
        if (match && match[1]) {
            return collectIds(match[1], pattern);
        }
    }
    return [];
}

/**
 * Extract the Loss ID and text from a markdown line.
 */
export function parseLossRow(line: string): LossRow {
    const m = line.match(/^L(\d+)\s*:\s*(.+)$/i);
    if (m) return { id: `L${m[1]}`, text: m[2].trim() };
    return { id: '', text: line.trim() };
}

/**
 * Extract hazard metadata, including the Loss targets it references.
 */
export function parseHazardRow(line: string): HazardRow {
    const idm = line.match(/^H(\d+)\s*:\s*(.+)$/i);
    const id = idm ? `H${idm[1]}` : '';
    const text = line.replace(/\([^)]*\)/g, '').replace(/^H\d+\s*:\s*/i, '').trim();
    const leadsToLosses = extractTargets(line, ['leads_to', 'related'], /^L\d+$/i);
    return { id, text, leadsToLosses };
}

/**
 * Parse a UCA line to capture its id, control loop, and related hazards.
 */
export function parseUcaRow(line: string): UcaRow {
    const idm = line.match(/^UCA(\d+)\s*:\s*(.+)$/i);
    const id = idm ? `UCA${idm[1]}` : '';
    const meta = (line.match(/\(([^)]*)\)/) || [])[1] || '';
    const cl = (meta.match(/control\s*loop\s*:\s*([^;)\]]+)/i) || [])[1];
    const text = line.replace(/\([^)]*\)/g, '').replace(/^UCA\d+\s*:\s*/i, '').trim();
    const leadsToHazards = extractTargets(line, ['leads_to', 'related'], /^H\d+$/i);
    return { id, text, controlLoop: cl?.trim(), leadsToHazards };
}

/**
 * Render markdown tables that connect losses→hazards and hazards→UCAs for output.
 */
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
