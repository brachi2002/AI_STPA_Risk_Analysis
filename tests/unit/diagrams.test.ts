import { buildControlStructureMermaid, buildImpactGraphMermaid } from '../../src/diagrams';
import { parseStep2ControlStructure } from '../../src/csExtract';
import type { StpaResult } from '../../src/types';

describe('buildControlStructureMermaid', () => {
  test('renders sensors, control actions, and feedback from Step 2 data', () => {
    const step2Text = [
      '=== CONTROLLERS ===',
      'C1: Nurse (type: human) - initiates medication orders.',
      'C2: Cart Control Software (type: software) - coordinates actuation.',
      '',
      '=== CONTROLLED_PROCESSES ===',
      'P1: Medication Dispensing Process - delivers doses safely.',
      '',
      '=== ACTUATORS ===',
      'A1: Drawer Lock Motor (affects: P1) - opens/locks medication drawer.',
      '',
      '=== SENSORS ===',
      'S1: Barcode Scanner (measures: P1) - verifies patient/medication.',
      'S2: Drawer-Open Sensor (measures: P1) - observes drawer state.',
      '',
      '=== EXTERNAL_SYSTEMS ===',
      'X1: Hospital Wi-Fi Network - exchanges orders with backend.',
      '',
      '=== CONTROL_ACTIONS ===',
      'CA1: C1 -> Issue dispense order.',
      'CA2: C1 -> Confirm patient identity.',
      'CA3: C2 -> Unlock drawer.',
      'CA4: C2 -> Reject mismatched barcode.',
      '',
      '=== FEEDBACK ===',
      'F1: S1 -> C1 : barcode match status.',
      'F2: S2 -> C2 : drawer state update.',
      '',
      '=== CONTROL_LOOPS ===',
      'LOOP1: controller=C1; controlled_process=P1; actuators=[A1]; control_actions=[CA1, CA2]; feedback=[F1]',
      'LOOP2: controller=C2; controlled_process=P1; actuators=[A1]; control_actions=[CA3, CA4]; feedback=[F2]',
    ].join('\n');

    const cs = parseStep2ControlStructure(step2Text);
    const mermaid = buildControlStructureMermaid(cs);

    expect(mermaid).toContain('```mermaid');
    expect(mermaid).toContain('graph TD');
    expect(mermaid).toContain('S1[');
    expect(mermaid).toContain('S2[');
    expect(mermaid).toContain('C2 -->|CA1: Issue dispense order.\\nCA2: Confirm patient identity.| A1');
    expect(mermaid).toContain('C2 -->|CA3: Unlock drawer.\\nCA4: Reject mismatched barcode.| A1');
    expect(mermaid).toContain('S1 -->|F1: barcode match status.| C1');
    expect(mermaid).toContain('S2 -->|F2: drawer state update.| C2');
    expect(mermaid).not.toContain('|commands|');
  });

  test('routes human-controlled actuators through the software controller when one exists', () => {
    const step2Text = [
      '=== CONTROLLERS ===',
      'C1: Operator (type: human) - issues manual inputs.',
      'C2: Automation logic (type: software) - supervises actuation.',
      '',
      '=== CONTROLLED_PROCESSES ===',
      'P1: Hydraulic actuator - manages pump pressure.',
      '',
      '=== ACTUATORS ===',
      'A1: Pump motor (affects: P1) - delivers fluid.',
      '',
      '=== SENSORS ===',
      'S1: Flow feedback (measures: P1) - returns rate.',
      '',
      '=== CONTROL_ACTIONS ===',
      'CA1: C1 -> Request increase in flow.',
      '',
      '=== FEEDBACK ===',
      'F1: S1 -> C1 : flow status update.',
      '',
      '=== CONTROL_LOOPS ===',
      'LOOP1: controller=C1; controlled_process=P1; actuators=[A1]; control_actions=[CA1]; feedback=[F1]',
    ].join('\n');

    const cs = parseStep2ControlStructure(step2Text);
    const mermaid = buildControlStructureMermaid(cs);

    expect(mermaid).toContain('C2 -->|CA1: Request increase in flow.| A1');
  });
});

describe('buildImpactGraphMermaid', () => {
  test('renders UCA → Hazard → Loss edges with short labels', () => {
    const stpa: StpaResult = {
      losses: ['L1: Loss one'],
      hazards: ['H1: Hazard one. (leads_to: L1)'],
      ucas: ['UCA1: Unsafe action. (control loop: LOOP1; related: H1) (leads_to: H1)'],
      raw: '',
    };

    const mermaid = buildImpactGraphMermaid(stpa);

    expect(mermaid).toContain('```mermaid');
    expect(mermaid).toContain('graph LR');
    expect(mermaid).toContain('UCA1[UCA1]');
    expect(mermaid).toContain('H1[H1]');
    expect(mermaid).toContain('L1[L1]');
    expect(mermaid).toContain('UCA1 --> H1');
    expect(mermaid).toContain('H1 --> L1');
    expect(mermaid).toContain('classDef uca');
    expect(mermaid).toContain('classDef haz');
    expect(mermaid).toContain('classDef loss');
    expect(mermaid).not.toContain('related:');
  });

  test('renders edges when leads_to uses semicolons and extra spacing', () => {
    const stpa: StpaResult = {
      losses: ['L1: Loss one'],
      hazards: [
        'H1: Hazard alpha. (leads_to: L1)',
        'H6: Hazard zeta. (leads_to: L1)',
      ],
      ucas: ['UCA1: Unsafe action. (leads_to: H1; H6)  '],
      raw: '',
    };

    const mermaid = buildImpactGraphMermaid(stpa);

    expect(mermaid).toContain('UCA1 --> H1');
    expect(mermaid).toContain('UCA1 --> H6');
    expect(mermaid).toContain('H1 --> L1');
    expect(mermaid).toContain('H6 --> L1');
  });

  test('throws when no UCA -> Hazard edges can be derived', () => {
    const stpa: StpaResult = {
      losses: ['L1: Loss one'],
      hazards: ['H1: Hazard alpha. (leads_to: L1)'],
      ucas: ['UCA1: Unsafe action. (control loop: LOOP1)'],
      raw: '',
    };

    expect(() => buildImpactGraphMermaid(stpa)).toThrow('UCA -> Hazard edge derived from Step 3');
  });

  test('throws when no Hazard -> Loss edges can be derived', () => {
    const stpa: StpaResult = {
      losses: ['L1: Loss one'],
      hazards: ['H1: Hazard alpha. (leads_to: L99)'],
      ucas: ['UCA1: Unsafe action. (control loop: LOOP1; related: H1) (leads_to: H1)'],
      raw: '',
    };

    expect(() => buildImpactGraphMermaid(stpa)).toThrow('Hazard -> Loss edge derived from Step 1');
  });
});
