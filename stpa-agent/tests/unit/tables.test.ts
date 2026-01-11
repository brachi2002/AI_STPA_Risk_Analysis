import { buildMarkdownTables, parseHazardRow, parseLossRow, parseUcaRow } from '../../src/tables';

describe('tables parsing helpers', () => {
  test('parseLossRow extracts id and text', () => {
    expect(parseLossRow('L3: Loss text')).toEqual({ id: 'L3', text: 'Loss text' });
  });

  test('parseHazardRow extracts id and leads_to losses', () => {
    const row = parseHazardRow('H2: Hazard detail. (leads_to: L1, L3)');
    expect(row.id).toBe('H2');
    expect(row.leadsToLosses).toEqual(['L1', 'L3']);
  });

  test('parseUcaRow extracts id, control loop, and hazards', () => {
    const row = parseUcaRow('UCA1: Example. (control loop: LOOP1; related: H2) (leads_to: H2, H3)');
    expect(row.id).toBe('UCA1');
    expect(row.controlLoop).toBe('LOOP1');
    expect(row.leadsToHazards).toEqual(['H2', 'H3']);
  });
});

describe('buildMarkdownTables', () => {
  test('builds loss->hazard and hazard->UCA tables', () => {
    const md = buildMarkdownTables({
      losses: ['L1: Loss one'],
      hazards: ['H1: Hazard one. (leads_to: L1)'],
      ucas: ['UCA1: UCA. (control loop: LOOP1; related: H1) (leads_to: H1)'],
      raw: '',
    });
    expect(md).toContain('## Loss');
    expect(md).toContain('| L1 | H1 |');
    expect(md).toContain('## Hazard');
    expect(md).toContain('| H1 | UCA1 |');
  });
});
