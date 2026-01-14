function sectionLines(text: string, heading: string): string[] {
  const rx = new RegExp(`===\\s*${heading}\\s*===\\s*([\\s\\S]*?)(?:\\n===|$)`, 'i');
  const match = text.match(rx);
  if (!match) return [];
  return match[1].split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

function collectIds(lines: string[], prefix: string): Set<string> {
  const ids = new Set<string>();
  const rx = new RegExp(`^${prefix}(\\d+)\\b`, 'i');
  for (const line of lines) {
    const match = line.match(rx);
    if (match) {
      ids.add(`${prefix.toUpperCase()}${match[1]}`);
    }
  }
  return ids;
}

function extractIdList(text: string): string[] {
  return text
    .split(/[,;]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function assertIdsExist(refs: string[], valid: Set<string>) {
  for (const ref of refs) {
    expect(valid.has(ref)).toBe(true);
  }
}

export function assertStep1Consistency(step1Text: string) {
  const losses = sectionLines(step1Text, 'LOSSES');
  const hazards = sectionLines(step1Text, 'HAZARDS');
  const constraints = sectionLines(step1Text, 'SAFETY CONSTRAINTS');
  const refined = sectionLines(step1Text, 'REFINED HAZARDS');
  const tableA = sectionLines(step1Text, 'TABLE A: LOSS TO HAZARDS');
  const tableB = sectionLines(step1Text, 'TABLE B: HAZARD TO SAFETY CONSTRAINTS');

  const lossIds = collectIds(losses, 'L');
  const hazardIds = collectIds(hazards, 'H');
  const constraintIds = collectIds(constraints, 'SC');

  expect(lossIds.size).toBeGreaterThan(0);
  expect(hazardIds.size).toBeGreaterThan(0);
  expect(constraintIds.size).toBeGreaterThan(0);

  for (const line of hazards) {
    const match = line.match(/\(.*leads_to\s*:\s*([^)]+)\)/i);
    expect(match).not.toBeNull();
    const refs = extractIdList(match?.[1] || '').map((id) => id.toUpperCase());
    assertIdsExist(refs, lossIds);
  }

  for (const line of constraints) {
    const match = line.match(/\(.*addresses\s*:\s*([^)]+)\)/i);
    expect(match).not.toBeNull();
    const refs = extractIdList(match?.[1] || '').map((id) => id.toUpperCase());
    assertIdsExist(refs, hazardIds);
  }

  for (const line of refined) {
    const match = line.match(/^(H\d+)\s+refinement/i);
    if (match) {
      expect(hazardIds.has(match[1].toUpperCase())).toBe(true);
    }
  }

  const tableARows = tableA.filter((line) => line.startsWith('|'));
  for (const row of tableARows) {
    const cells = row.split('|').map((cell) => cell.trim()).filter((cell) => cell.length > 0);
    const lossId = cells[0]?.toUpperCase();
    if (lossId === 'LOSS' || lossId === '---') {
      continue;
    }
    expect(lossIds.has(lossId)).toBe(true);
    const hazardRefs = extractIdList(cells[1] || '').map((id) => id.toUpperCase());
    if (hazardRefs.length) {
      assertIdsExist(hazardRefs, hazardIds);
    }
  }

  const tableBRows = tableB.filter((line) => line.startsWith('|'));
  for (const row of tableBRows) {
    const cells = row.split('|').map((cell) => cell.trim()).filter((cell) => cell.length > 0);
    const hazardId = cells[0]?.toUpperCase();
    if (hazardId === 'HAZARD' || hazardId === '---') {
      continue;
    }
    expect(hazardIds.has(hazardId)).toBe(true);
    const constraintRefs = extractIdList(cells[1] || '').map((id) => id.toUpperCase());
    if (constraintRefs.length) {
      assertIdsExist(constraintRefs, constraintIds);
    }
  }

  return { lossIds, hazardIds, constraintIds };
}

export function assertStep2Consistency(step2Text: string) {
  const controllers = sectionLines(step2Text, 'CONTROLLERS');
  const processes = sectionLines(step2Text, 'CONTROLLED_PROCESSES');
  const actuators = sectionLines(step2Text, 'ACTUATORS');
  const sensors = sectionLines(step2Text, 'SENSORS');
  const controlActions = sectionLines(step2Text, 'CONTROL_ACTIONS');
  const feedback = sectionLines(step2Text, 'FEEDBACK');
  const loops = sectionLines(step2Text, 'CONTROL_LOOPS');
  const summary = sectionLines(step2Text, 'SUMMARY TABLE');

  const controllerIds = collectIds(controllers, 'C');
  const processIds = collectIds(processes, 'P');
  const actuatorIds = collectIds(actuators, 'A');
  const sensorIds = collectIds(sensors, 'S');
  const controlActionIds = collectIds(controlActions, 'CA');
  const feedbackIds = collectIds(feedback, 'F');

  expect(controllerIds.size).toBeGreaterThan(0);
  expect(processIds.size).toBeGreaterThan(0);
  expect(controlActionIds.size).toBeGreaterThan(0);
  expect(loops.length).toBeGreaterThan(0);

  const tableLines = summary.filter((line) => line.startsWith('|'));
  const header = tableLines[0] || '';
  expect(header).toContain('Loop');
  expect(header).toContain('Controller');
  expect(header).toContain('Control Actions');

  return {
    controllerIds,
    processIds,
    actuatorIds,
    sensorIds,
    controlActionIds,
    feedbackIds,
  };
}

export function assertStep3Consistency(step3Text: string, hazardIds: Set<string>, controlActionIds: Set<string>) {
  const ucaLines = sectionLines(step3Text, 'UCAS');
  const ucaIds = collectIds(ucaLines, 'UCA');
  expect(ucaIds.size).toBeGreaterThan(0);

  for (const line of ucaLines) {
    const hazardMatch = line.match(/leads_to\s*:\s*([^)]+)\)/i);
    if (hazardMatch) {
      const refs = extractIdList(hazardMatch[1]).map((id) => id.toUpperCase());
      assertIdsExist(refs, hazardIds);
    }
    const actionMatch = line.match(/\(control_action:\s*(CA\d+)\)/i);
    if (actionMatch) {
      expect(controlActionIds.has(actionMatch[1].toUpperCase())).toBe(true);
    }
  }

  return { ucaIds };
}

export function assertStep4Consistency(step4Text: string, ucaIds: Set<string>, hazardIds: Set<string>, lossIds: Set<string>) {
  const scenarios = sectionLines(step4Text, 'LOSS SCENARIOS');
  const summary = sectionLines(step4Text, 'SUMMARY TABLE');
  const summaryTableLines = summary.filter((line) => line.startsWith('|'));
  const nonTable = summary.filter((line) => !line.startsWith('|') && line.length > 0);

  expect(scenarios.length).toBeGreaterThanOrEqual(10);
  expect(nonTable.length).toBe(0);
  expect(summaryTableLines.length).toBeGreaterThan(2);

  for (const line of scenarios) {
    const ucaMatch = line.match(/linked_ucas\s*:\s*([^)]+)\)/i);
    const hazardMatch = line.match(/linked_hazards\s*:\s*([^)]+)\)/i);
    const lossMatch = line.match(/linked_losses\s*:\s*([^)]+)\)/i);
    if (ucaMatch) {
      const refs = extractIdList(ucaMatch[1]).map((id) => id.toUpperCase());
      assertIdsExist(refs, ucaIds);
    }
    if (hazardMatch) {
      const refs = extractIdList(hazardMatch[1]).map((id) => id.toUpperCase());
      assertIdsExist(refs, hazardIds);
    }
    if (lossMatch) {
      const refs = extractIdList(lossMatch[1]).map((id) => id.toUpperCase());
      assertIdsExist(refs, lossIds);
    }
  }
}
