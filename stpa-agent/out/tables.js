"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseLossRow = parseLossRow;
exports.parseHazardRow = parseHazardRow;
exports.parseUcaRow = parseUcaRow;
exports.buildMarkdownTables = buildMarkdownTables;
function sanitizeCell(s) {
    return s.replace(/\|/g, '\\|').trim();
}
function mdTable(headers, rows) {
    const head = `| ${headers.map(sanitizeCell).join(' | ')} |`;
    const sep = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = rows.map((r) => `| ${r.map((c) => sanitizeCell(c)).join(' | ')} |`).join('\n');
    return [head, sep, body].join('\n');
}
function parseLossRow(line) {
    const m = line.match(/^L(\d+)\s*:\s*(.+)$/i);
    if (m)
        return { id: `L${m[1]}`, text: m[2].trim() };
    return { id: '', text: line.trim() };
}
function parseHazardRow(line) {
    const idm = line.match(/^H(\d+)\s*:\s*(.+)$/i);
    const id = idm ? `H${idm[1]}` : '';
    const meta = (line.match(/\(([^)]*)\)/) || [])[1] || '';
    const rel = (meta.match(/related\s*:\s*([^)]+)/i) || [])[1] || '';
    const relatedLosses = rel.split(',').map((s) => s.trim()).filter(Boolean);
    const text = line.replace(/\([^)]*\)/g, '').replace(/^H\d+\s*:\s*/i, '').trim();
    return { id, text, relatedLosses };
}
function parseUcaRow(line) {
    const idm = line.match(/^UCA(\d+)\s*:\s*(.+)$/i);
    const id = idm ? `UCA${idm[1]}` : '';
    const meta = (line.match(/\(([^)]*)\)/) || [])[1] || '';
    const cl = (meta.match(/control\s*loop\s*:\s*([^;)\]]+)/i) || [])[1];
    const rel = (meta.match(/related\s*:\s*([^)]+)/i) || [])[1] || '';
    const relatedHazards = rel.split(',').map((s) => s.trim()).filter(Boolean);
    const text = line.replace(/\([^)]*\)/g, '').replace(/^UCA\d+\s*:\s*/i, '').trim();
    return { id, text, controlLoop: cl?.trim(), relatedHazards };
}
function buildMarkdownTables(result) {
    const lossRows = result.losses.map(parseLossRow);
    const hazRows = result.hazards.map(parseHazardRow);
    const ucaRows = result.ucas.map(parseUcaRow);
    const lossesTbl = mdTable(['ID', 'Loss Description'], lossRows.map((r) => [r.id || '-', r.text || '-']));
    const hazardsTbl = mdTable(['ID', 'Hazard Description', 'Related Losses'], hazRows.map((r) => [r.id || '-', r.text || '-', r.relatedLosses.join(', ') || '-']));
    const ucasTbl = mdTable(['ID', 'UCA Description', 'Control Loop', 'Related Hazards'], ucaRows.map((r) => [r.id || '-', r.text || '-', r.controlLoop || '-', r.relatedHazards.join(', ') || '-']));
    return ['## Losses', lossesTbl, '', '## Hazards', hazardsTbl, '', '## UCAs', ucasTbl, ''].join('\n');
}
//# sourceMappingURL=tables.js.map