import OpenAI from 'openai';

type ChatRequest = {
  model: string;
  temperature?: number;
  messages: { role: string; content: string }[];
};

type ChatResponse = { content: string };

function slugify(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'fixture';
}

function extractSystemText(prompt: string): string {
  const match = prompt.match(/--- SYSTEM TEXT START ---([\s\S]*?)--- SYSTEM TEXT END ---/i);
  if (match) {
    return match[1].trim();
  }
  return prompt.trim();
}

function extractTag(prompt: string): string {
  const text = extractSystemText(prompt);
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || 'fixture';
  return slugify(firstLine).slice(0, 28);
}

function buildStep1Output(tag: string): string {
  return [
    '=== LOSSES ===',
    `L1: ${tag} loss of mission outcome.`,
    `L2: ${tag} injury to user.`,
    `L3: ${tag} damage to equipment.`,
    `L4: ${tag} loss of data integrity.`,
    `L5: ${tag} regulatory breach.`,
    '',
    '=== HAZARDS ===',
    `H1: The controlled process enters an unsafe state while normal operation. (leads_to: L1, L2)`,
    `H2: The controlled process deviates from safe limits during peak load. (leads_to: L2)`,
    `H3: The controlled process exceeds safe energy exposure during use. (leads_to: L3)`,
    `H4: The controlled process operates with incorrect routing or targeting. (leads_to: L4)`,
    `H5: The controlled process remains uncontrolled in degraded conditions. (leads_to: L5)`,
    `H6: The controlled process continues unsafe operation without warning. (leads_to: L1)`,
    '',
    '=== SAFETY CONSTRAINTS ===',
    'SC1: The system shall keep the controlled process within safe limits. (addresses: H1)',
    'SC2: The system shall not allow unsafe peak-load operation. (addresses: H2)',
    'SC3: The system shall prevent unsafe energy exposure. (addresses: H3)',
    'SC4: The system shall ensure correct routing or targeting. (addresses: H4)',
    'SC5: The system shall enter a safe mode in degraded conditions. (addresses: H5)',
    'SC6: The system shall provide timely warnings for unsafe operation. (addresses: H6)',
    'SC7: The system shall constrain operation to safe envelopes. (addresses: H1)',
    'SC8: The system shall block hazardous transitions. (addresses: H2)',
    '',
    '=== REFINED HAZARDS ===',
    'H1 refinement: Normal operation with nominal load and typical environment.',
    'H2 refinement: Peak load, high workload, or maximum throughput conditions.',
    'H3 refinement: High energy demand or limited dissipation conditions.',
    'H4 refinement: Conflicting objectives or ambiguous operating context.',
    'H5 refinement: Partial capability loss or degraded sensing conditions.',
    'H6 refinement: High noise, low visibility, or delayed feedback.',
    '',
    '=== MISSING INFORMATION ===',
    '- None',
    '',
    '=== TABLE A: LOSS TO HAZARDS ===',
    '| Loss | Hazards |',
    '| --- | --- |',
    '| L1 | H1; H6 |',
    '| L2 | H1; H2 |',
    '| L3 | H3 |',
    '| L4 | H4 |',
    '| L5 | H5 |',
    '',
    '=== TABLE B: HAZARD TO SAFETY CONSTRAINTS ===',
    '| Hazard | Safety Constraints |',
    '| --- | --- |',
    '| H1 | SC1; SC7 |',
    '| H2 | SC2; SC8 |',
    '| H3 | SC3 |',
    '| H4 | SC4 |',
    '| H5 | SC5 |',
    '| H6 | SC6 |',
  ].join('\n');
}

function buildStep2Output(tag: string): string {
  return [
    '=== CONTROL_STRUCTURE_TEXT ===',
    `${tag} control structure with two controllers and a single controlled process.`,
    '',
    '=== CONTROLLERS ===',
    'C1: Primary controller (type: software) - issues commands.',
    'C2: Secondary controller (type: human) - supervises operation.',
    '',
    '=== CONTROLLED_PROCESSES ===',
    'P1: Controlled process - core system dynamics.',
    '',
    '=== ACTUATORS ===',
    'A1: Primary actuator (affects: P1) - executes commands.',
    '',
    '=== SENSORS ===',
    'S1: Primary sensor (measures: P1) - reports state.',
    'S2: Secondary sensor (measures: P1) - reports limits.',
    '',
    '=== EXTERNAL_SYSTEMS ===',
    'X1: External dependency - provides reference data.',
    '',
    '=== CONTROL_ACTIONS ===',
    'CA1: C1 -> Issue command A.',
    'CA2: C1 -> Issue command B.',
    'CA3: C2 -> Approve or override.',
    'CA4: C2 -> Escalate to safe mode.',
    '',
    '=== FEEDBACK ===',
    'F1: S1 -> C1 : state estimate - core feedback.',
    'F2: S2 -> C2 : limit status - safety feedback.',
    '',
    '=== CONTROL_LOOPS ===',
    'LOOP1: controller=C1; controlled_process=P1; actuators=[A1]; control_actions=[CA1, CA2]; feedback=[F1]',
    'LOOP2: controller=C2; controlled_process=P1; actuators=[A1]; control_actions=[CA3, CA4]; feedback=[F2]',
    '',
    '=== MISSING INFORMATION ===',
    '- None',
    '',
    '=== SUMMARY TABLE ===',
    '| Loop | Controller | Control Actions | Actuators | Controlled Process | Feedback |',
    '| --- | --- | --- | --- | --- | --- |',
    '| LOOP1 | C1 | CA1; CA2 | A1 | P1 | F1 |',
    '| LOOP2 | C2 | CA3; CA4 | A1 | P1 | F2 |',
  ].join('\n');
}

function buildStep3Output(): string {
  return [
    '=== UCAS ===',
    'UCA1: (type: omission) (controller: C1) (control_action: CA1) Action not issued under high load. (leads_to: H1; H2)',
    'UCA2: (type: commission) (controller: C1) (control_action: CA2) Action issued in unsafe context. (leads_to: H3)',
    'UCA3: (type: timing) (controller: C2) (control_action: CA3) Override issued too late. (leads_to: H4)',
    'UCA4: (type: duration) (controller: C2) (control_action: CA4) Safe mode ended too soon. (leads_to: H5)',
    '',
    '=== MISSING INFORMATION ===',
    '- None',
    '',
    '=== SUMMARY TABLE ===',
    '| UCA | Type | Controller | Control Action | Hazards |',
    '| --- | --- | --- | --- | --- |',
    '| UCA1 | omission | C1 | CA1 | H1; H2 |',
    '| UCA2 | commission | C1 | CA2 | H3 |',
    '| UCA3 | timing | C2 | CA3 | H4 |',
    '| UCA4 | duration | C2 | CA4 | H5 |',
  ].join('\n');
}

function buildStep4Output(): string {
  const scenarios = [];
  for (let i = 1; i <= 10; i += 1) {
    scenarios.push(
      `LS${i}: (linked_ucas: UCA${((i - 1) % 4) + 1}) (linked_hazards: H${((i - 1) % 6) + 1}) (linked_losses: L${((i - 1) % 5) + 1}) (trace: C1/CA1/A1/P1; feedback: F1; sensors: S1) Scenario ${i} narrative. {factors: controller_process_model=assumption gap; feedback_and_sensing=stale value; actuator_and_control_path=limited authority; controlled_process_and_dynamics=delay; human_and_organization=handoff gap; communication_and_coordination=message loss; environment_and_disturbances=interference}`
    );
  }
  return [
    '=== LOSS SCENARIOS ===',
    ...scenarios,
    '',
    '=== MISSING INFORMATION ===',
    '- None',
    '',
    '=== SUMMARY TABLE ===',
    '| LS | UCAs | Hazards | Losses | Control loop | Key factors |',
    '| --- | --- | --- | --- | --- | --- |',
    '| LS1 | UCA1 | H1 | L1 | C1; CA1; A1; P1 | stale feedback; timing |',
    '| LS2 | UCA2 | H2 | L2 | C1; CA2; A1; P1 | authority limit; delay |',
    '| LS3 | UCA3 | H3 | L3 | C2; CA3; A1; P1 | handoff gap; noise |',
    '| LS4 | UCA4 | H4 | L4 | C2; CA4; A1; P1 | model mismatch; delay |',
    '| LS5 | UCA1 | H5 | L5 | C1; CA1; A1; P1 | stale feedback; load |',
    '| LS6 | UCA2 | H6 | L1 | C1; CA2; A1; P1 | authority limit; noise |',
    '| LS7 | UCA3 | H1 | L2 | C2; CA3; A1; P1 | handoff gap; delay |',
    '| LS8 | UCA4 | H2 | L3 | C2; CA4; A1; P1 | model mismatch; timing |',
    '| LS9 | UCA1 | H3 | L4 | C1; CA1; A1; P1 | stale feedback; load |',
    '| LS10 | UCA2 | H4 | L5 | C1; CA2; A1; P1 | authority limit; delay |',
  ].join('\n');
}

function buildClassicOutput(tag: string): string {
  return [
    '[LOSSES]',
    `L1: ${tag} loss one`,
    'L2: loss two',
    'L3: loss three',
    'L4: loss four',
    'L5: loss five',
    '',
    '[HAZARDS]',
    'H1: hazard one (related: L1, L2)',
    'H2: hazard two (related: L3)',
    'H3: hazard three (related: L4)',
    'H4: hazard four (related: L5)',
    'H5: hazard five (related: L1)',
    '',
    '[UCAS]',
    'UCA1: unsafe action (control loop: LOOP1; related: H1)',
    'UCA2: unsafe action (control loop: LOOP1; related: H2)',
    'UCA3: unsafe action (control loop: LOOP2; related: H3)',
    'UCA4: unsafe action (control loop: LOOP2; related: H4)',
    'UCA5: unsafe action (control loop: LOOP3; related: H5)',
    'UCA6: unsafe action (control loop: LOOP3; related: H1)',
    'UCA7: unsafe action (control loop: LOOP4; related: H2)',
    'UCA8: unsafe action (control loop: LOOP4; related: H3)',
  ].join('\n');
}

function defaultHandler(req: ChatRequest): ChatResponse {
  const prompt = req.messages?.[0]?.content || '';
  const tag = extractTag(prompt);

  if (/Perform STPA Step 1/i.test(prompt)) return { content: buildStep1Output(tag) };
  if (/Perform STPA Step 2/i.test(prompt)) return { content: buildStep2Output(tag) };
  if (/Perform STPA Step 3/i.test(prompt)) return { content: buildStep3Output() };
  if (/Perform STPA Step 4/i.test(prompt)) return { content: buildStep4Output() };
  if (/\[LOSSES\]/i.test(prompt) && /\[HAZARDS\]/i.test(prompt)) return { content: buildClassicOutput(tag) };
  if (/Continue the list with concise/i.test(prompt)) {
    return { content: '- item one\n- item two\n- item three' };
  }
  return { content: `MOCK: ${prompt.split(/\r?\n/)[0] || 'ok'}` };
}

export function useDefaultLlmMock() {
  (OpenAI as any).__setMockHandler(defaultHandler);
}

export function useInvalidLlmMock(content = 'INVALID LINE') {
  (OpenAI as any).__setMockHandler(async () => ({ content }));
}

export function useThrowingLlmMock(message = 'timeout') {
  (OpenAI as any).__setMockHandler(async () => {
    throw new Error(message);
  });
}

export function withMockHandler(next: (req: ChatRequest) => ChatResponse | Promise<ChatResponse>) {
  (OpenAI as any).__setMockHandler(next);
}

export async function mockChatCompletion(prompt: string) {
  const openai = new OpenAI({ apiKey: 'test-key' });
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
  });
  return resp.choices?.[0]?.message?.content || '';
}
