import { validateInput } from '../../src/validator';

describe('validateInput edge cases', () => {
  test('empty input returns issues', () => {
    const result = validateInput('');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(50);
  });

  test('whitespace input returns issues', () => {
    const result = validateInput('   \n\t  ');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(50);
  });

  test('very short description returns issues', () => {
    const result = validateInput('Short system blurb.');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(80);
  });

  test('repeated junk tokens return issues', () => {
    const junk = 'system system system system system system';
    const result = validateInput(junk);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('descriptive paragraph can pass without issues', () => {
    const text =
      'System overview: The infusion pump system delivers medication to patients in hospital wards. ' +
      'A nurse operator configures dosage, monitors alarms, and confirms the patient identity. ' +
      'The operating environment includes indoor clinical rooms, shift changes, and varying workloads. ' +
      'The system interacts with patients, clinicians, and maintenance staff while maintaining safe dosing. ' +
      'Assumptions include trained staff and stable power during normal operation.';
    const result = validateInput(text);
    expect(result.issues.length).toBe(0);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });
});
