import { Position } from 'vscode';
import {
  buildAddGroundingContext,
  endPositionFromText,
  ensureSectionExistsInsideStep,
  findGuidedStepBodyRange,
  findInsertLineInSection,
  findSectionRangeByHeading,
  KIND_META,
  normalizeStep1Text,
  normalizeStep2Text,
  normalizeUcaText,
  validateAddGrounding,
  validateGeneratedLines,
  validateStep1Plan,
  validateStep2Plan,
} from '../../src/aiEdit';

type HeadingStyle = 'underscore' | 'space';

const headingLabel = (tag: string, style: HeadingStyle): string =>
  style === 'underscore' ? tag : tag.replace(/_/g, ' ');

const headingLine = (tag: string, style: HeadingStyle): string =>
  `=== ${headingLabel(tag, style)} ===`;

function buildGuidedDoc(style: HeadingStyle): string {
  const lines = [
    '# STPA Guided Analysis',
    '',
    '## Step 1',
    headingLine('LOSSES', style),
    'L2: Loss two.',
    headingLine('HAZARDS', style),
    'H3: Hazard three. (leads_to: L2)',
    headingLine('SAFETY_CONSTRAINTS', style),
    'SC4: Constraint four. (addresses: H3)',
    headingLine('REFINED_HAZARDS', style),
    'H3 refinement: Context three.',
    '',
    '## Step 2',
    headingLine('CONTROLLERS', style),
    'C2: Controller two.',
    headingLine('CONTROLLED_PROCESSES', style),
    'P4: Process four.',
    headingLine('ACTUATORS', style),
    'A3: Actuator three.',
    headingLine('SENSORS', style),
    'S5: Sensor five.',
    headingLine('EXTERNAL_SYSTEMS', style),
    'X2: External system two.',
    headingLine('CONTROL_ACTIONS', style),
    'CA2: Action two.',
    'CA7: Action seven.',
    headingLine('FEEDBACK', style),
    'F9: Feedback nine.',
    headingLine('CONTROL_LOOPS', style),
    'LOOP3: C2 P4 CA2 F9.',
    '',
    '## Step 3',
    headingLine('UCAS', style),
    'UCA2: Example. (control loop: LOOP3; related: H3)',
    '',
    '## Step 4',
    headingLine('LOSS_SCENARIOS', style),
    'LS2: Scenario two.',
  ];

  return lines.join('\n');
}

describe('endPositionFromText', () => {
  test('single-line insert advances character', () => {
    const start = new Position(3, 5);
    const end = endPositionFromText(start, 'abc');
    expect(end.line).toBe(3);
    expect(end.character).toBe(8);
  });

  test('multi-line insert advances line and character', () => {
    const start = new Position(1, 2);
    const end = endPositionFromText(start, 'a\nbc');
    expect(end.line).toBe(2);
    expect(end.character).toBe(2);
  });
});

describe('guided section helpers', () => {
  test('findGuidedStepBodyRange returns correct bounds', () => {
    const doc = buildGuidedDoc('underscore');
    const lines = doc.split('\n');
    const step2Head = lines.indexOf('## Step 2');
    const step3Head = lines.indexOf('## Step 3');

    const range = findGuidedStepBodyRange(lines, 2);
    expect(range).not.toBeNull();
    expect(range).toEqual({ start: step2Head + 1, end: step3Head });
  });

  test('findSectionRangeByHeading matches underscore and space headings', () => {
    const underscore = buildGuidedDoc('underscore').split('\n');
    const space = buildGuidedDoc('space').split('\n');

    const rangeUnderscore = findSectionRangeByHeading(underscore, KIND_META.control_action.headingRx);
    const rangeSpace = findSectionRangeByHeading(space, KIND_META.control_action.headingRx);

    expect(rangeUnderscore).not.toBeNull();
    expect(rangeSpace).not.toBeNull();
    expect(underscore[rangeUnderscore!.start]).toBe('=== CONTROL_ACTIONS ===');
    expect(space[rangeSpace!.start]).toBe('=== CONTROL ACTIONS ===');
  });

  test('findSectionRangeByHeading matches bracketed headings', () => {
    const lines = [
      '## Step 2',
      '[CONTROL_ACTIONS]',
      'CA1: Action one.',
      '## Step 3',
    ];
    const range = findSectionRangeByHeading(lines, KIND_META.control_action.headingRx);
    expect(range).not.toBeNull();
    expect(range).toEqual({ start: 1, end: 3 });
  });

  test('ensureSectionExistsInsideStep inserts heading using step style', () => {
    const lines = buildGuidedDoc('space').split('\n').filter((line) =>
      line !== '=== CONTROL LOOPS ===' && !line.startsWith('LOOP')
    );
    const insertAt = ensureSectionExistsInsideStep(lines, 'CONTROL_LOOPS');

    expect(lines[insertAt - 1]).toBe('=== CONTROL LOOPS ===');
    expect(lines.indexOf('## Step 3')).toBeGreaterThan(insertAt);
  });

  test('ensureSectionExistsInsideStep inserts underscore heading when step uses underscores', () => {
    const lines = buildGuidedDoc('underscore').split('\n').filter((line) =>
      line !== '=== CONTROL_ACTIONS ===' && !line.startsWith('CA')
    );
    const insertAt = ensureSectionExistsInsideStep(lines, 'CONTROL_ACTIONS');

    expect(lines[insertAt - 1]).toBe('=== CONTROL_ACTIONS ===');
    expect(lines.indexOf('## Step 3')).toBeGreaterThan(insertAt);
  });

  test('findInsertLineInSection returns after last item', () => {
    const lines = buildGuidedDoc('underscore').split('\n');
    const insertAt = findInsertLineInSection(lines, KIND_META.control_action);
    const lastItem = lines.indexOf('CA7: Action seven.');
    expect(insertAt).toBe(lastItem + 1);
  });

  test('findInsertLineInSection creates missing section inside step', () => {
    const lines = buildGuidedDoc('underscore').split('\n').filter((line) =>
      line !== '=== UCAS ===' && !line.startsWith('UCA')
    );
    const insertAt = findInsertLineInSection(lines, KIND_META.uca);

    expect(lines[insertAt - 1]).toBe('=== UCAS ===');
    expect(lines.indexOf('## Step 4')).toBeGreaterThan(insertAt);
  });
});

describe('validateGeneratedLines', () => {
  test('hazard: valid line passes', () => {
    const err = validateGeneratedLines('hazard', ['H1: System state is unsafe. (leads_to: L1)']);
    expect(err).toBeNull();
  });

  test('hazard: invalid line fails', () => {
    const err = validateGeneratedLines('hazard', ['H1: Missing mapping.']);
    expect(err).not.toBeNull();
  });

  test('loss: valid line passes', () => {
    const err = validateGeneratedLines('loss', ['L2: Injury to operator.']);
    expect(err).toBeNull();
  });

  test('loss: invalid line fails', () => {
    const err = validateGeneratedLines('loss', ['L2: Injury (leads_to: L1)']);
    expect(err).not.toBeNull();
  });

  test('safety_constraint: valid line passes', () => {
    const err = validateGeneratedLines('safety_constraint', [
      'SC1: The system shall prevent over-speed. (addresses: H1)',
    ]);
    expect(err).toBeNull();
  });

  test('safety_constraint: invalid line fails', () => {
    const err = validateGeneratedLines('safety_constraint', ['SC1: Bad format. (leads_to: L1)']);
    expect(err).not.toBeNull();
  });

  test('refined_hazard: valid line passes', () => {
    const err = validateGeneratedLines('refined_hazard', ['H2 refinement: Applies during takeoff.']);
    expect(err).toBeNull();
  });

  test('refined_hazard: invalid line fails', () => {
    const err = validateGeneratedLines('refined_hazard', ['H2: Not a refinement.']);
    expect(err).not.toBeNull();
  });

  test('uca: valid line passes', () => {
    const err = validateGeneratedLines('uca', [
      'UCA1: Controller C1 provides CA1 in wrong context. (control loop: LOOP1; related: H2)',
    ]);
    expect(err).toBeNull();
  });

  test('uca: invalid line fails', () => {
    const err = validateGeneratedLines('uca', ['UCA1: Missing related hazards. (control loop: LOOP1)']);
    expect(err).not.toBeNull();
  });

  test('controller: valid line passes', () => {
    const err = validateGeneratedLines('controller', ['C1: Controller one.']);
    expect(err).toBeNull();
  });

  test('controller: invalid line fails on wrong prefix', () => {
    const err = validateGeneratedLines('controller', ['H1: Not a controller.']);
    expect(err).not.toBeNull();
  });

  test('controlled_process: valid line passes', () => {
    const err = validateGeneratedLines('controlled_process', ['P1: Process one.']);
    expect(err).toBeNull();
  });

  test('controlled_process: invalid line fails on wrong prefix', () => {
    const err = validateGeneratedLines('controlled_process', ['C1: Not a process.']);
    expect(err).not.toBeNull();
  });

  test('actuator: valid line passes', () => {
    const err = validateGeneratedLines('actuator', ['A1: Actuator one.']);
    expect(err).toBeNull();
  });

  test('actuator: invalid line fails on wrong prefix', () => {
    const err = validateGeneratedLines('actuator', ['P1: Not an actuator.']);
    expect(err).not.toBeNull();
  });

  test('sensor: valid line passes', () => {
    const err = validateGeneratedLines('sensor', ['S1: Sensor one.']);
    expect(err).toBeNull();
  });

  test('sensor: invalid line fails on wrong prefix', () => {
    const err = validateGeneratedLines('sensor', ['A1: Not a sensor.']);
    expect(err).not.toBeNull();
  });

  test('external_system: valid line passes', () => {
    const err = validateGeneratedLines('external_system', ['X1: External system.']);
    expect(err).toBeNull();
  });

  test('external_system: invalid line fails on wrong prefix', () => {
    const err = validateGeneratedLines('external_system', ['S1: Not an external system.']);
    expect(err).not.toBeNull();
  });

  test('control_action: valid line passes', () => {
    const err = validateGeneratedLines('control_action', ['CA1: Action one.']);
    expect(err).toBeNull();
  });

  test('control_action: invalid line fails on wrong prefix', () => {
    const err = validateGeneratedLines('control_action', ['F1: Not a control action.']);
    expect(err).not.toBeNull();
  });

  test('feedback: valid line passes', () => {
    const err = validateGeneratedLines('feedback', ['F1: Feedback one.']);
    expect(err).toBeNull();
  });

  test('feedback: invalid line fails on wrong prefix', () => {
    const err = validateGeneratedLines('feedback', ['CA1: Not feedback.']);
    expect(err).not.toBeNull();
  });

  test('control_loop: valid line passes', () => {
    const err = validateGeneratedLines('control_loop', ['LOOP1: C1 P1 CA1 F1.']);
    expect(err).toBeNull();
  });

  test('control_loop: invalid line fails when missing required tokens', () => {
    const err = validateGeneratedLines('control_loop', ['LOOP1: C1 P1 F1.']);
    expect(err).not.toBeNull();
  });

  test('loss_scenario: valid line passes', () => {
    const err = validateGeneratedLines('loss_scenario', ['LS1: Scenario one.']);
    expect(err).toBeNull();
  });

  test('loss_scenario: invalid line fails on wrong prefix', () => {
    const err = validateGeneratedLines('loss_scenario', ['L1: Not a loss scenario.']);
    expect(err).not.toBeNull();
  });

  test('loss_scenario: invalid line fails on forbidden mapping', () => {
    const err = validateGeneratedLines('loss_scenario', ['LS1: Scenario one. (leads_to: L1)']);
    expect(err).not.toBeNull();
  });
});

describe('validateAddGrounding', () => {
  test('passes when line shares keywords with system description', () => {
    const systemContext = [
      '=== SYSTEM DESCRIPTION ===',
      'The system is a medication delivery platform with an infusion pump and patient ID scanner.',
      'A nurse uses the infusion pump to administer medication.',
    ].join('\n');
    const currentSection = [
      '=== LOSSES ===',
      'L1: Injury due to incorrect infusion.',
    ].join('\n');
    const err = validateAddGrounding(
      ['L6: Patient injury due to incorrect infusion rate.'],
      systemContext,
      currentSection
    );
    expect(err).toBeNull();
  });

  test('fails when line is not grounded in context', () => {
    const systemContext = [
      '=== SYSTEM DESCRIPTION ===',
      'The system is a medication delivery platform with an infusion pump and patient ID scanner.',
    ].join('\n');
    const currentSection = [
      '=== LOSSES ===',
      'L1: Injury due to incorrect infusion.',
    ].join('\n');
    const err = validateAddGrounding(
      ['L6: Satellite loses orbital alignment due to thruster failure.'],
      systemContext,
      currentSection
    );
    expect(err).not.toBeNull();
  });
});

describe('buildAddGroundingContext', () => {
  test('uses fallback context when no system description heading exists', () => {
    const lines: string[] = [];
    for (let i = 0; i < 400; i++) {
      lines.push(`LINE ${i}`);
    }
    lines.push('=== LOSSES ===');
    lines.push('L1: Loss one.');
    lines.push('L2: Loss two.');

    const doc = lines.join('\n');
    const context = buildAddGroundingContext(doc, KIND_META.loss.headingRx);

    expect(context.systemContext).toContain('LINE 0');
    expect(context.systemContext).toContain('LINE 300');
    expect(context.systemContext).toContain('=== LOSSES ===');
    expect(context.systemContext).toContain('L1: Loss one.');
    expect(context.systemContext).not.toContain('LINE 260');
  });
});

describe('normalizeStep1Text', () => {
  test('renumbers and removes dangling refs while preserving trailing newline', () => {
    const input = [
      '=== LOSSES ===',
      'L1: Loss one.',
      'L3: Loss three.',
      '',
      '=== HAZARDS ===',
      'H2: Hazard text. (leads_to: L3, L9)',
      '',
      '=== SAFETY CONSTRAINTS ===',
      'SC2: Constraint text. (addresses: H2, H9)',
      '',
    ].join('\n');

    const out = normalizeStep1Text(input, { renumber: true });
    expect(out.changed).toBe(true);
    expect(out.text.endsWith('\n')).toBe(true);

    const lines = out.text.trim().split('\n');
    expect(lines).toContain('L1: Loss one.');
    expect(lines).toContain('L2: Loss three.');
    expect(lines).toContain('H1: Hazard text. (leads_to: L2)');
    expect(lines).toContain('SC1: Constraint text. (addresses: H1)');
  });

  test('preserves no trailing newline', () => {
    const input = [
      '=== LOSSES ===',
      'L1: Loss one.',
      '',
      '=== HAZARDS ===',
      'H1: Hazard text. (leads_to: L1)',
      '',
      '=== SAFETY CONSTRAINTS ===',
      'SC1: Constraint text. (addresses: H1)',
    ].join('\n');

    const out = normalizeStep1Text(input, { renumber: true });
    expect(out.text.endsWith('\n')).toBe(false);
  });

  test('renumbers losses/hazards/constraints and remaps references', () => {
    const input = [
      '=== LOSSES ===',
      'L2: Loss two.',
      'L5: Loss five.',
      '',
      '=== HAZARDS ===',
      'H3: Hazard three. (leads_to: L5, L2)',
      'H9: Hazard nine. (leads_to: L2)',
      '',
      '=== SAFETY CONSTRAINTS ===',
      'SC4: Constraint four. (addresses: H9, H3)',
      '',
      '=== REFINED HAZARDS ===',
      'H3 refinement: Context three.',
      'H9 refinement: Context nine.',
    ].join('\n');

    const out = normalizeStep1Text(input, { renumber: true });
    const lines = out.text.split('\n');

    expect(lines).toContain('L1: Loss two.');
    expect(lines).toContain('L2: Loss five.');
    expect(lines).toContain('H1: Hazard three. (leads_to: L2, L1)');
    expect(lines).toContain('H2: Hazard nine. (leads_to: L1)');
    expect(lines).toContain('SC1: Constraint four. (addresses: H2, H1)');
    expect(lines).toContain('H1 refinement: Context three.');
    expect(lines).toContain('H2 refinement: Context nine.');
  });
});

describe('normalizeStep2Text', () => {
  test('renumbers step 2 sections independently', () => {
    const input = [
      '=== CONTROLLERS ===',
      'C2: Controller two.',
      'C5: Controller five.',
      '',
      '=== CONTROLLED_PROCESSES ===',
      'P3: Process three.',
      'P7: Process seven.',
      '',
      '=== ACTUATORS ===',
      'A4: Actuator four.',
      'A9: Actuator nine.',
      '',
      '=== SENSORS ===',
      'S6: Sensor six.',
      'S8: Sensor eight.',
      '',
      '=== EXTERNAL_SYSTEMS ===',
      'X2: External system two.',
      'X3: External system three.',
      '',
      '=== CONTROL_ACTIONS ===',
      'CA2: Action two.',
      'CA6: Action six.',
      '',
      '=== FEEDBACK ===',
      'F5: Feedback five.',
      'F9: Feedback nine.',
      '',
      '=== CONTROL_LOOPS ===',
      'LOOP3: C2 P3 CA2 F5.',
      'LOOP9: C5 P7 CA6 F9.',
    ].join('\n');

    const out = normalizeStep2Text(input, { renumber: true });
    const lines = out.text.split('\n');

    expect(lines).toContain('C1: Controller two.');
    expect(lines).toContain('C2: Controller five.');
    expect(lines).toContain('P1: Process three.');
    expect(lines).toContain('P2: Process seven.');
    expect(lines).toContain('A1: Actuator four.');
    expect(lines).toContain('A2: Actuator nine.');
    expect(lines).toContain('S1: Sensor six.');
    expect(lines).toContain('S2: Sensor eight.');
    expect(lines).toContain('X1: External system two.');
    expect(lines).toContain('X2: External system three.');
    expect(lines).toContain('CA1: Action two.');
    expect(lines).toContain('CA2: Action six.');
    expect(lines).toContain('F1: Feedback five.');
    expect(lines).toContain('F2: Feedback nine.');
    expect(lines).toContain('LOOP1: C2 P3 CA2 F5.');
    expect(lines).toContain('LOOP2: C5 P7 CA6 F9.');
  });
});

describe('normalizeUcaText', () => {
  test('renumbers UCA lines contiguously', () => {
    const input = [
      '=== UCAS ===',
      'UCA2: Example. (control loop: LOOP1; related: H1)',
      'UCA4: Example. (control loop: LOOP1; related: H2)',
    ].join('\n');

    const out = normalizeUcaText(input, { renumber: true });
    const lines = out.text.split('\n');

    expect(lines).toContain('UCA1: Example. (control loop: LOOP1; related: H1)');
    expect(lines).toContain('UCA2: Example. (control loop: LOOP1; related: H2)');
  });
});

describe('validateStep1Plan', () => {
  test('rejects non-add actions', () => {
    const err = validateStep1Plan({
      id: 'plan_1',
      title: 'x',
      summary: 'y',
      actions: [
        { op: 'replace', section: 'HAZARDS', match: 'H1: a', replacement: 'H1: b' },
      ],
    });
    expect(err).not.toBeNull();
  });

  test('accepts add-only hazard/constraint actions', () => {
    const err = validateStep1Plan({
      id: 'plan_2',
      title: 'x',
      summary: 'y',
      actions: [
        { op: 'add', section: 'HAZARDS', lines: ['H1: Hazard text. (leads_to: L1)'] },
        { op: 'add', section: 'SAFETY_CONSTRAINTS', lines: ['SC1: Constraint text. (addresses: H1)'] },
      ],
    });
    expect(err).toBeNull();
  });
});

describe('validateStep2Plan', () => {
  test('rejects non-add actions', () => {
    const err = validateStep2Plan({
      id: 'plan_step2_bad',
      title: 'x',
      summary: 'y',
      actions: [{ op: 'delete', section: 'UCAS', match: 'UCA1' }],
    });
    expect(err).not.toBeNull();
  });

  test('accepts add-only UCA actions', () => {
    const err = validateStep2Plan({
      id: 'plan_step2_ok',
      title: 'x',
      summary: 'y',
      actions: [
        {
          op: 'add',
          section: 'UCAS',
          lines: [
            'UCA1: (type: omission) (controller: C1) (control_action: CA1) Example. (control loop: LOOP1; related: H1)',
          ],
        },
      ],
    });
    expect(err).toBeNull();
  });
});
