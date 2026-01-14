import { validateStep1Tables } from '../../src/step1Validation';

describe('validateStep1Tables', () => {
  const commonTableB = [
    '=== SAFETY CONSTRAINTS ===',
    'SC1: System shall maintain safe pace. (addresses: H1)',
    '',
    '=== TABLE B: HAZARD TO SAFETY CONSTRAINTS ===',
    '| Hazard | Safety Constraints |',
    '| --- | --- |',
    '| H1 | SC1 |',
  ].join('\n');

  test('fails when Table A references a hazard that does not lead to the loss', () => {
    const text = [
      '=== LOSSES ===',
      'L1: Loss one',
      'L2: Loss two',
      '',
      '=== HAZARDS ===',
      'H1: Unsafe state. (leads_to: L2)',
      '',
      '=== TABLE A: LOSS TO HAZARDS ===',
      '| Loss | Hazards |',
      '| --- | --- |',
      '| L1 | H1 |',
      '',
      commonTableB,
    ].join('\n');

    const validation = validateStep1Tables(text);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((err) => err.includes('Table A row for L1 lists H1 but H1 does not lead to L1'))).toBe(true);
  });

  test('fails when a hazard leads_to an undefined loss', () => {
    const text = [
      '=== LOSSES ===',
      'L1: Loss one',
      '',
      '=== HAZARDS ===',
      'H1: Unsafe state. (leads_to: L99)',
      '',
      '=== TABLE A: LOSS TO HAZARDS ===',
      '| Loss | Hazards |',
      '| --- | --- |',
      '| L1 | H1 |',
      '',
      commonTableB,
    ].join('\n');

    const validation = validateStep1Tables(text);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((err) => err.includes('Hazard H1 references undefined loss L99'))).toBe(true);
  });
});
