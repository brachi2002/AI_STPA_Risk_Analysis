import { validateInput } from '../src/validator';

describe('validateInput', () => {
  test('flags missing significant parts for step1', () => {
    const text = 'Quick note about a thing.';
    const result = validateInput(text, { stage: 'step1' });
    const ids = result.issues.map((i) => i.id);
    expect(ids).toContain('MISSING_SYSTEM_CONTEXT');
    expect(ids).toContain('MISSING_OBJECTIVES');
    expect(ids).toContain('TOO_SHORT');
  });

  test('accepts a detailed step1 description', () => {
    const text =
      'System overview: The infusion pump system delivers medication in hospital wards. ' +
      'Objectives: ensure correct dosage, prevent harm, and support clinical workflows. ' +
      'Operating environment includes indoor hospital rooms, day and night operation, and varied staffing. ' +
      'Actors include nurse operators, technicians, and supervising clinicians. ' +
      'Scope boundary: in-scope are pump hardware and UI; out-of-scope are pharmacy fulfillment systems. ' +
      'Assumptions: stable power supply, trained staff, and verified prescriptions are available. ' +
      'Additional context describes reliability targets, maintenance intervals, and expected usage patterns. ' +
      'This paragraph exists to ensure sufficient length and coverage of all required elements.';
    const result = validateInput(text, { stage: 'step1' });
    const ids = result.issues.map((i) => i.id);
    expect(ids).not.toContain('MISSING_SYSTEM_CONTEXT');
    expect(ids).not.toContain('MISSING_OBJECTIVES');
    expect(result.score).toBeGreaterThanOrEqual(80);
  });
});
