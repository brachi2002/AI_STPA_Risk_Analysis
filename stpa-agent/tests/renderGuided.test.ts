import {
  safeJsonParse,
  renderStep1Markdown,
  renderStep2Markdown,
  renderStep3Markdown,
  renderStep4Markdown,
} from '../src/renderGuided';

describe('safeJsonParse', () => {
  test('parses valid JSON', () => {
    const parsed = safeJsonParse<{ ok: boolean }>('{ "ok": true }');
    expect(parsed).toEqual({ ok: true });
  });

  test('returns null for invalid JSON', () => {
    const parsed = safeJsonParse('{ bad json');
    expect(parsed).toBeNull();
  });

  test('returns null for empty string', () => {
    const parsed = safeJsonParse('');
    expect(parsed).toBeNull();
  });
});

describe('renderStepXMarkdown', () => {
  test('renderStep1Markdown includes expected sections', () => {
    const md = renderStep1Markdown({
      reference: 'Ref-1',
      losses: [{ id: 'L1', description: 'Loss' }],
      hazards: [{ id: 'H1', description: 'Hazard', leads_to: ['L1'] }],
      safety_constraints: [{ id: 'SC1', description: 'Constraint', addresses: ['H1'] }],
    });
    expect(md).toContain('### Losses');
    expect(md).toContain('### System-level Hazards');
    expect(md).toContain('### System-level Safety Constraints');
    expect(md).toContain('L1');
  });

  test('renderStep2Markdown includes control structure sections', () => {
    const md = renderStep2Markdown({
      control_structure: {
        controllers: [{ id: 'C1', name: 'Controller' }],
        control_actions: [{ id: 'CA1', controller: 'C1', action: 'Do thing' }],
        feedback: [{ id: 'F1', from: 'S1', to: 'C1', signal: 'Status' }],
      },
    });
    expect(md).toContain('### Controllers');
    expect(md).toContain('### Control Actions');
    expect(md).toContain('### Feedback');
  });

  test('renderStep3Markdown includes UCAs and summary table', () => {
    const md = renderStep3Markdown({
      unsafe_control_actions: [
        {
          id: 'UCA1',
          uca: 'Unsafe action',
          control_action_id: 'CA1',
          controller_id: 'C1',
          type: 'provides',
          context: 'Context',
          leads_to_hazards: ['H1'],
        },
      ],
      summary_table: {
        columns: ['ID', 'Type'],
        rows: [['UCA1', 'provides']],
      },
    });
    expect(md).toContain('### Unsafe Control Actions (UCAs)');
    expect(md).toContain('### Summary Table');
    expect(md).toContain('| ID | Type |');
  });

  test('renderStep4Markdown includes loss scenarios', () => {
    const md = renderStep4Markdown({
      loss_scenarios: [
        {
          id: 'LS1',
          scenario: 'Scenario',
          linked_ucas: ['UCA1'],
          linked_hazards: ['H1'],
          causal_factors: ['Factor'],
        },
      ],
    });
    expect(md).toContain('### Loss Scenarios');
    expect(md).toContain('LS1');
  });
});
