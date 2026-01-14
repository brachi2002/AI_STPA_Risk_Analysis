import { buildStep1Prompt, buildStep2Prompt, buildStep3Prompt, buildStep4Prompt } from '../../src/extension';

describe('prompt builders', () => {
  test('buildStep1Prompt includes required headers and system text', () => {
    const prompt = buildStep1Prompt('System text here', 'generic');
    expect(prompt).toContain('=== LOSSES ===');
    expect(prompt).toContain('=== HAZARDS ===');
    expect(prompt).toContain('--- SYSTEM TEXT START ---');
    expect(prompt).toContain('System text here');
  });

  test('buildStep1Prompt reiterates the forbidden hazard wording list', () => {
    const prompt = buildStep1Prompt('System text here', 'generic');
    expect(prompt).toContain('failure / fails / failed / failing');
    expect(prompt).toContain(
      'sensor / camera / radar / lidar / software / algorithm / controller / network / communication / EHR'
    );
  });

  test('buildStep1Prompt documents the hazard sentence template', () => {
    const prompt = buildStep1Prompt('System text here', 'generic');
    expect(prompt).toContain('The controlled process <unsafe_state_phrase> while <operational context>. (leads_to: L#, L#)');
  });

  test('buildStep1Prompt reminds about rewriting component failures into controlled-process states', () => {
    const prompt = buildStep1Prompt('System text here', 'generic');
    expect(prompt).toContain('rewrite it as an unsafe controlled-process state observable in the environment');
  });

  test('buildStep2Prompt references Step 1 and includes summary table', () => {
    const prompt = buildStep2Prompt('System text', 'generic', 'STEP1 OUTPUT');
    expect(prompt).toContain('--- STEP 1 START ---');
    expect(prompt).toContain('STEP1 OUTPUT');
    expect(prompt).toContain('=== SUMMARY TABLE ===');
  });

  test('buildStep3Prompt references Step 1 and Step 2 inputs', () => {
    const prompt = buildStep3Prompt('System text', 'generic', 'STEP1', 'STEP2');
    expect(prompt).toContain('--- STEP 1 START ---');
    expect(prompt).toContain('--- STEP 2 START ---');
    expect(prompt).toContain('=== UCAS ===');
  });

  test('buildStep4Prompt references Step 1-3 inputs', () => {
    const prompt = buildStep4Prompt('System text', 'generic', 'STEP1', 'STEP2', 'STEP3');
    expect(prompt).toContain('--- STEP 3 START ---');
    expect(prompt).toContain('=== LOSS SCENARIOS ===');
  });
});
