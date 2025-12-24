// src/aiEdit.ts
// English-only code & UI strings (per project convention).

import * as vscode from 'vscode';
import OpenAI from 'openai';

/** Which STPA item type is being edited */
export type EditKind = 'hazard' | 'loss' | 'uca';

/** Edit operation inferred from the user's instruction */
type EditOp = 'add' | 'update' | 'delete';

/** Step 1 sections we may patch for consistency */
export type Step1Section = 'LOSSES' | 'HAZARDS' | 'SAFETY_CONSTRAINTS' | 'REFINED_HAZARDS';

export type SmartEditPlanAction =
  | {
    op: 'add';
    section: Step1Section;
    /** One or more full lines to insert */
    lines: string[];
    note?: string;
  }
  | {
    op: 'replace';
    section: Step1Section;
    /** Exact line to match (case-sensitive) */
    match: string;
    /** Full replacement line */
    replacement: string;
    note?: string;
  }
  | {
    op: 'delete';
    section: Step1Section;
    /** Exact line to match (case-sensitive) */
    match: string;
    note?: string;
  };

export type SmartEditPlan = {
  id: string;
  title: string;
  summary: string;
  actions: SmartEditPlanAction[];
};

export type SmartEditResult = {
  applied: string[];
  preview: string[];
  ranges: vscode.Range[];
  /** Optional Step 1 repair plan (requires user approval) */
  plan?: SmartEditPlan;
};

function makePlanId(): string {
  return `plan_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/** Computes the final Position after inserting text starting at `start`. */
function endPositionFromText(start: vscode.Position, insertedText: string): vscode.Position {
  const parts = insertedText.split(/\r?\n/);
  if (parts.length === 1) return start.translate(0, parts[0].length);
  const lastLine = parts[parts.length - 1];
  return new vscode.Position(start.line + (parts.length - 1), lastLine.length);
}

/* ==========================================================
   Instruction parsing
   ========================================================== */

/** Detects the item kind from the user's instruction (Hebrew+English). */
function detectKindFromInstruction(instr: string): EditKind | null {
  const t = instr.toLowerCase();
  if (/(hazard|hazards|h\s*\d+|סיכון|סיכונים|H\d+)/i.test(t)) return 'hazard';
  if (/(loss|losses|l\s*\d+|אובדן|אבדן|L\d+)/i.test(t)) return 'loss';
  if (/(uca|ucas|uca\s*\d+|בקרה\s*לא\s*בטוחה|UCA\d+)/i.test(t)) return 'uca';
  return null;
}

/** Detects edit operation: add / update / delete (Hebrew+English). */
function detectOpFromInstruction(instr: string): EditOp {
  const t = instr.toLowerCase();
  if (/(\bdelete\b|\bremove\b|\berase\b|\bdrop\b|\bdiscard\b|מחוק|למחוק|תמחק|להסיר|תסיר)/i.test(t)) {
    return 'delete';
  }
  if (
    /(\bupdate\b|\bedit\b|\bchange\b|\breplace\b|\bmodify\b|\brev(i|e)se\b|לעדכן|תעדכן|לשנות|תשנה|לתקן|תתקן)/i.test(
      t
    )
  ) {
    return 'update';
  }
  return 'add';
}

/** Extracts the first explicit ID (H#, L#, UCA#) from the instruction. */
function extractExplicitId(instr: string, kind: EditKind): string | null {
  const rx =
    kind === 'hazard'
      ? /\bH\s*(\d+)\b/i
      : kind === 'loss'
        ? /\bL\s*(\d+)\b/i
        : /\bUCA\s*(\d+)\b/i;

  const m = instr.match(rx);
  if (!m) return null;

  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;

  return kind === 'uca' ? `UCA${n}` : `${kind === 'hazard' ? 'H' : 'L'}${n}`;
}

/** Computes the next index based on the lines already in the document. */
function nextIndex(lines: string[], rx: RegExp): number {
  let max = 0;
  for (const ln of lines) {
    const m = ln.match(rx);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

/* ==========================================================
   Section finding for Markdown documents
   ========================================================== */

function isJsonDoc(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

type SectionRange = { start: number; end: number };

function findSectionRangeByHeading(lines: string[], headingRx: RegExp): SectionRange | null {
  const nextHeadRx = /^\s*(\[[^\]]+\]|===\s*.+\s*===)\s*$/;
  const start = lines.findIndex((l) => headingRx.test(l));
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (nextHeadRx.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function findStep1Range(lines: string[]): SectionRange | null {
  // Step 1 block: from LOSSES heading until next "Step" markdown heading, if present.
  const lossesHead = /^\s*(\[?\s*LOSSES\s*\]?|===\s*LOSSES\s*===)\s*$/i;
  const start = lines.findIndex((l) => lossesHead.test(l));
  if (start === -1) return null;

  const stepHead = /^\s*##\s*Step\s*\d+\b/i;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (stepHead.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function ensureSectionExists(lines: string[], section: Step1Section): number {
  const headingLine =
    section === 'LOSSES'
      ? '=== LOSSES ==='
      : section === 'HAZARDS'
        ? '=== HAZARDS ==='
        : section === 'SAFETY_CONSTRAINTS'
          ? '=== SAFETY CONSTRAINTS ==='
          : '=== REFINED HAZARDS ===';

  const step1 = findStep1Range(lines);
  const insertAt = step1 ? step1.end : lines.length;

  // Insert blank line + heading + blank line
  // and return line index just after heading.
  lines.splice(insertAt, 0, '', headingLine, '');
  return insertAt + 2;
}

function findInsertLineInStep1(lines: string[], section: Step1Section): number {
  const headingRx =
    section === 'LOSSES'
      ? /^\s*(\[?\s*LOSSES\s*\]?|===\s*LOSSES\s*===)\s*$/i
      : section === 'HAZARDS'
        ? /^\s*(\[?\s*HAZARDS\s*\]?|===\s*HAZARDS\s*===)\s*$/i
        : section === 'SAFETY_CONSTRAINTS'
          ? /^\s*(\[?\s*SAFETY\s+CONSTRAINTS\s*\]?|===\s*SAFETY\s+CONSTRAINTS\s*===|===\s*CONSTRAINTS\s*===)\s*$/i
          : /^\s*(\[?\s*REFINED\s+HAZARDS\s*\]?|===\s*REFINED\s+HAZARDS\s*===)\s*$/i;

  const range = findSectionRangeByHeading(lines, headingRx);
  if (!range) return ensureSectionExists(lines, section);

  const itemRx =
    section === 'LOSSES'
      ? /^L\d+\s*:/i
      : section === 'HAZARDS'
        ? /^H\d+\s*:/i
        : section === 'SAFETY_CONSTRAINTS'
          ? /^SC\d+\s*:/i
          : /^H\d+\s+refinement\s*:/i;

  let lastItemLine = range.start;
  for (let i = range.start + 1; i < range.end; i++) {
    if (itemRx.test(lines[i])) lastItemLine = i;
  }
  return lastItemLine + 1;
}

function findLineIndexById(lines: string[], id: string): number {
  const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`^\\s*${safe}\\s*:`, 'i');
  return lines.findIndex((l) => rx.test(l));
}

/* ==========================================================
   JSON document support (hazards/losses/ucas arrays)
   ========================================================== */

function targetJsonKey(kind: EditKind): string {
  return kind === 'hazard' ? 'hazards' : kind === 'loss' ? 'losses' : 'ucas';
}

/** Insert into hazards/losses/ucas arrays anywhere in the JSON tree (case-insensitive). */
function tryInsertIntoJsonArrayDeep(docText: string, kind: EditKind, toInsert: string[]): string | null {
  let parsed: any;
  try {
    parsed = JSON.parse(docText);
  } catch {
    return null;
  }

  const keyMatch = (k: string) => k.toLowerCase() === targetJsonKey(kind);
  let updated = false;

  const visit = (node: any) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;

    for (const key of Object.keys(node)) {
      const val = (node as any)[key];
      if (keyMatch(key) && Array.isArray(val)) {
        for (const line of toInsert) val.push(line);
        updated = true;
      } else {
        visit(val);
      }
    }
  };

  visit(parsed);
  if (!updated) return null;
  return JSON.stringify(parsed, null, 2) + (docText.endsWith('\n') ? '\n' : '');
}

function tryUpdateOrDeleteInJsonArrayDeep(
  docText: string,
  kind: EditKind,
  op: EditOp,
  id: string,
  replacement?: string
): string | null {
  let parsed: any;
  try {
    parsed = JSON.parse(docText);
  } catch {
    return null;
  }

  const keyMatch = (k: string) => k.toLowerCase() === targetJsonKey(kind);
  const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const idRx = new RegExp(`^\\s*${safe}\\s*:`, 'i');
  let updated = false;

  const visit = (node: any) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;

    for (const key of Object.keys(node)) {
      const val = (node as any)[key];
      if (keyMatch(key) && Array.isArray(val)) {
        const idx = val.findIndex((x: any) => typeof x === 'string' && idRx.test(x));
        if (idx !== -1) {
          if (op === 'delete') {
            val.splice(idx, 1);
            updated = true;
          } else if (op === 'update' && replacement) {
            val[idx] = replacement;
            updated = true;
          }
        }
      } else {
        visit(val);
      }
    }
  };

  visit(parsed);
  if (!updated) return null;
  return JSON.stringify(parsed, null, 2) + (docText.endsWith('\n') ? '\n' : '');
}

/* ==========================================================
   LLM line generation (add/update)
   ========================================================== */

function buildAddPrompt(kind: EditKind, userInstruction: string, docText: string): string {
  const section = kind === 'hazard' ? 'HAZARDS' : kind === 'loss' ? 'LOSSES' : 'UCAS';
  const example =
    kind === 'hazard'
      ? 'H7: The vehicle or system remains on a collision trajectory while approaching a stationary object. (leads_to: L1, L2)'
      : kind === 'loss'
        ? 'L6: Injury to cyclists due to a collision.'
        : 'UCA9: In dense urban traffic, controller C1 does not provide control action CA2 while pedestrians are present. (control loop: LOOP1; related: H2)';

  return [
    'You are assisting an STPA report editor.',
    `Generate ONLY new ${section} lines to insert into the document.`,
    'STRICT OUTPUT RULES:',
    '- Output plain text lines only (no commentary, no markdown fences).',
    '- One item per line.',
    '- If the user specified an explicit ID (e.g., "H7"), use it. Otherwise omit IDs; the client will number.',
    '- Preserve mapping syntax:',
    '  - Hazard lines MUST end with "(leads_to: Lx, Ly)".',
    '  - UCA lines MUST end with "(control loop: ... ; related: Hx)".',
    '- Do NOT output headings.',
    '',
    'User instruction:',
    userInstruction,
    '',
    'Current document (for context, do not copy):',
    '--- DOCUMENT START ---',
    docText,
    '--- DOCUMENT END ---',
    '',
    `Output format example (do not copy):\n${example}`,
  ].join('\n');
}

function buildUpdatePrompt(kind: EditKind, userInstruction: string, docText: string, id: string, existingLine: string): string {
  const section = kind === 'hazard' ? 'HAZARDS' : kind === 'loss' ? 'LOSSES' : 'UCAS';
  const idPrefix = `${id}:`;

  return [
    'You are assisting an STPA report editor.',
    `Task: UPDATE exactly one existing ${section} line while keeping the same ID.`,
    'STRICT OUTPUT RULES:',
    `- Output exactly ONE line that starts with "${idPrefix}".`,
    '- Output plain text only (no commentary, no markdown fences).',
    '- Keep mapping syntax consistent with the document style.',
    '- Do NOT invent new IDs.',
    '',
    'User instruction:',
    userInstruction,
    '',
    `Existing line to update (must be replaced):\n${existingLine}`,
    '',
    'Current document context (do not copy):',
    '--- DOCUMENT START ---',
    docText,
    '--- DOCUMENT END ---',
  ].join('\n');
}

function normalizeGeneratedLines(raw: string): string[] {
  return raw
    .replace(/```[\s\S]*?```/g, '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractFirstJsonObject(raw: string): any | null {
  const cleaned = raw.replace(/```[\s\S]*?```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  const candidate = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/* ==========================================================
   Step 1 consistency checks and repair plan proposal
   ========================================================== */

type Step1Parse = {
  losses: { id: string; line: string }[];
  hazards: { id: string; line: string; leadsTo: string[] }[];
  constraints: { id: string; line: string; addresses: string[] }[];
  refined: { hazardId: string; line: string }[];
  hasStep1: boolean;
};

function parseIdList(text: string): string[] {
  return text
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseStep1(docText: string): Step1Parse {
  const lines = docText.split(/\r?\n/);

  const lossesRange = findSectionRangeByHeading(lines, /^\s*(\[?\s*LOSSES\s*\]?|===\s*LOSSES\s*===)\s*$/i);
  const hazardsRange = findSectionRangeByHeading(lines, /^\s*(\[?\s*HAZARDS\s*\]?|===\s*HAZARDS\s*===)\s*$/i);
  const constraintsRange = findSectionRangeByHeading(
    lines,
    /^\s*(\[?\s*SAFETY\s+CONSTRAINTS\s*\]?|===\s*SAFETY\s+CONSTRAINTS\s*===|===\s*CONSTRAINTS\s*===)\s*$/i
  );
  const refinedRange = findSectionRangeByHeading(lines, /^\s*(\[?\s*REFINED\s+HAZARDS\s*\]?|===\s*REFINED\s+HAZARDS\s*===)\s*$/i);

  const losses: Step1Parse['losses'] = [];
  if (lossesRange) {
    for (let i = lossesRange.start + 1; i < lossesRange.end; i++) {
      const m = lines[i].match(/^\s*(L\d+)\s*:\s*(.+)\s*$/i);
      if (m) losses.push({ id: m[1].toUpperCase(), line: lines[i] });
    }
  }

  const hazards: Step1Parse['hazards'] = [];
  if (hazardsRange) {
    for (let i = hazardsRange.start + 1; i < hazardsRange.end; i++) {
      const m = lines[i].match(/^\s*(H\d+)\s*:\s*(.+?)\s*\(\s*leads_to\s*:\s*([^\)]+)\)\s*$/i);
      if (m) hazards.push({ id: m[1].toUpperCase(), line: lines[i], leadsTo: parseIdList(m[3]).map((x) => x.toUpperCase()) });
    }
  }

  const constraints: Step1Parse['constraints'] = [];
  if (constraintsRange) {
    for (let i = constraintsRange.start + 1; i < constraintsRange.end; i++) {
      const m = lines[i].match(/^\s*(SC\d+)\s*:\s*(.+?)\s*\(\s*addresses\s*:\s*([^\)]+)\)\s*$/i);
      if (m) constraints.push({ id: m[1].toUpperCase(), line: lines[i], addresses: parseIdList(m[3]).map((x) => x.toUpperCase()) });
    }
  }

  const refined: Step1Parse['refined'] = [];
  if (refinedRange) {
    for (let i = refinedRange.start + 1; i < refinedRange.end; i++) {
      const m = lines[i].match(/^\s*(H\d+)\s+refinement\s*:\s*(.+)\s*$/i);
      if (m) refined.push({ hazardId: m[1].toUpperCase(), line: lines[i] });
    }
  }

  const hasStep1 = Boolean(lossesRange && hazardsRange && constraintsRange);
  return { losses, hazards, constraints, refined, hasStep1 };
}

type Step1Issues = {
  danglingHazardLossRefs: Array<{ hazardId: string; missingLossIds: string[]; line: string }>;
  danglingConstraintHazardRefs: Array<{ constraintId: string; missingHazardIds: string[]; line: string }>;
  missingRefinementForHazards: string[];
  lossesNotReferencedByAnyHazard: string[];
};

function checkStep1Consistency(p: Step1Parse): Step1Issues {
  const lossSet = new Set(p.losses.map((x) => x.id));
  const hazardSet = new Set(p.hazards.map((x) => x.id));
  const refinedSet = new Set(p.refined.map((x) => x.hazardId));

  const danglingHazardLossRefs: Step1Issues['danglingHazardLossRefs'] = [];
  for (const h of p.hazards) {
    const missing = h.leadsTo.filter((l) => !lossSet.has(l));
    if (missing.length) danglingHazardLossRefs.push({ hazardId: h.id, missingLossIds: missing, line: h.line });
  }

  const danglingConstraintHazardRefs: Step1Issues['danglingConstraintHazardRefs'] = [];
  for (const sc of p.constraints) {
    const missing = sc.addresses.filter((h) => !hazardSet.has(h));
    if (missing.length) danglingConstraintHazardRefs.push({ constraintId: sc.id, missingHazardIds: missing, line: sc.line });
  }

  const missingRefinementForHazards = p.hazards.map((h) => h.id).filter((hid) => !refinedSet.has(hid));

  const lossToHaz = new Map<string, number>();
  for (const l of p.losses) lossToHaz.set(l.id, 0);
  for (const h of p.hazards) {
    for (const l of h.leadsTo) {
      if (lossToHaz.has(l)) lossToHaz.set(l, (lossToHaz.get(l) || 0) + 1);
    }
  }
  const lossesNotReferencedByAnyHazard = [...lossToHaz.entries()].filter(([, c]) => c === 0).map(([id]) => id);

  return { danglingHazardLossRefs, danglingConstraintHazardRefs, missingRefinementForHazards, lossesNotReferencedByAnyHazard };
}

function buildStep1RepairPrompt(docText: string, issues: Step1Issues): string {
  return [
    'You are an expert STPA editor.',
    'Task: propose a MINIMAL repair plan to keep STPA Step 1 internally consistent after an edit.',
    'You MUST follow these rules:',
    '- Do NOT rewrite the whole document.',
    '- Only propose line-level actions (add / replace / delete).',
    '- For replace/delete actions, you MUST provide the exact existing line in "match".',
    '- For add actions, provide full new lines in the correct house style.',
    '- Prefer fixing references (leads_to / addresses) over inventing new items, unless necessary.',
    '- If a Loss is not referenced by any hazard, you may propose ONE new hazard OR update ONE existing hazard to include it (choose minimal).',
    '- If a hazard is missing a refinement line, propose adding exactly one refinement line for it (minimal ODD / context only, no causes).',
    '',
    'Return ONLY valid JSON with this schema:',
    '{',
    '  "title": "...",',
    '  "summary": "...",',
    '  "actions": [',
    '    { "op": "add", "section": "LOSSES|HAZARDS|SAFETY_CONSTRAINTS|REFINED_HAZARDS", "lines": ["..."] },',
    '    { "op": "replace", "section": "...", "match": "<exact existing line>", "replacement": "<new line>" },',
    '    { "op": "delete", "section": "...", "match": "<exact existing line>" }',
    '  ]',
    '}',
    '',
    'Issues found:',
    JSON.stringify(issues, null, 2),
    '',
    'Current document:',
    '--- DOCUMENT START ---',
    docText,
    '--- DOCUMENT END ---',
  ].join('\n');
}

async function proposeStep1RepairPlan(openai: OpenAI, docText: string): Promise<SmartEditPlan | undefined> {
  const parsed = parseStep1(docText);
  if (!parsed.hasStep1) return undefined;

  const issues = checkStep1Consistency(parsed);
  const hasHard =
    issues.danglingHazardLossRefs.length > 0 || issues.danglingConstraintHazardRefs.length > 0 || issues.missingRefinementForHazards.length > 0;
  const hasSoft = issues.lossesNotReferencedByAnyHazard.length > 0;

  if (!hasHard && !hasSoft) return undefined;

  const prompt = buildStep1RepairPrompt(docText, issues);
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = resp.choices?.[0]?.message?.content?.trim() || '';
  const json = extractFirstJsonObject(raw);
  if (!json || typeof json !== 'object') return undefined;

  const title = typeof json.title === 'string' ? json.title : 'Step 1 consistency fixes';
  const summary = typeof json.summary === 'string' ? json.summary : 'Proposed minimal fixes to keep Step 1 consistent.';
  const actions = Array.isArray(json.actions) ? (json.actions as any[]) : [];

  const normalized: SmartEditPlanAction[] = [];
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;

    if (a.op === 'add' && typeof a.section === 'string' && Array.isArray(a.lines)) {
      const section = a.section as Step1Section;
      if (!['LOSSES', 'HAZARDS', 'SAFETY_CONSTRAINTS', 'REFINED_HAZARDS'].includes(section)) continue;
      const lines = a.lines.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim());
      if (!lines.length) continue;
      normalized.push({ op: 'add', section, lines, note: typeof a.note === 'string' ? a.note : undefined });
    } else if (a.op === 'replace' && typeof a.section === 'string' && typeof a.match === 'string' && typeof a.replacement === 'string') {
      const section = a.section as Step1Section;
      if (!['LOSSES', 'HAZARDS', 'SAFETY_CONSTRAINTS', 'REFINED_HAZARDS'].includes(section)) continue;
      normalized.push({ op: 'replace', section, match: a.match, replacement: a.replacement, note: typeof a.note === 'string' ? a.note : undefined });
    } else if (a.op === 'delete' && typeof a.section === 'string' && typeof a.match === 'string') {
      const section = a.section as Step1Section;
      if (!['LOSSES', 'HAZARDS', 'SAFETY_CONSTRAINTS', 'REFINED_HAZARDS'].includes(section)) continue;
      normalized.push({ op: 'delete', section, match: a.match, note: typeof a.note === 'string' ? a.note : undefined });
    }
  }

  if (!normalized.length) return undefined;
  return { id: makePlanId(), title, summary, actions: normalized };
}

/* ==========================================================
   Apply a pending plan (deterministic edits; no LLM)
   ========================================================== */

export async function applySmartEditPlan(plan: SmartEditPlan): Promise<{ applied: string[]; ranges: vscode.Range[] }> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error('No active editor to edit.');

  const before = editor.document.getText();
  const lines = before.split(/\r?\n/);

  const applied: string[] = [];
  const ranges: vscode.Range[] = [];

  // One atomic edit.
  await editor.edit((ed) => {
    for (const action of plan.actions) {
      if (action.op === 'add') {
        const insertAt = findInsertLineInStep1(lines, action.section);
        const pos = new vscode.Position(insertAt, 0);

        const text = action.lines.join('\n') + '\n';
        ed.insert(pos, text);

        // update local model so subsequent positions are correct
        lines.splice(insertAt, 0, ...action.lines);

        const endPos = endPositionFromText(pos, text);
        ranges.push(new vscode.Range(pos, endPos));
        applied.push(...action.lines);
        continue;
      }

      if (action.op === 'replace') {
        const idx = lines.findIndex((l) => l === action.match);
        if (idx === -1) continue;

        const start = new vscode.Position(idx, 0);
        const end = new vscode.Position(idx, lines[idx].length);
        ed.replace(new vscode.Range(start, end), action.replacement);

        lines[idx] = action.replacement;
        ranges.push(new vscode.Range(start, new vscode.Position(idx, action.replacement.length)));
        applied.push(action.replacement);
        continue;
      }

      if (action.op === 'delete') {
        const idx = lines.findIndex((l) => l === action.match);
        if (idx === -1) continue;

        // delete whole line including newline if possible
        const start = new vscode.Position(idx, 0);
        const end =
          idx < lines.length - 1 ? new vscode.Position(idx + 1, 0) : new vscode.Position(idx, lines[idx].length);

        ed.delete(new vscode.Range(start, end));

        const removed = lines[idx];
        lines.splice(idx, 1);
        applied.push(`Deleted: ${removed}`);
      }
    }
  });

  return { applied, ranges };
}

/* ==========================================================
   Public entry point from chat
   ========================================================== */

export async function smartEditFromChat(instruction: string, kindHint?: EditKind): Promise<SmartEditResult> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error('No active editor to edit.');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY.');

  const openai = new OpenAI({ apiKey });

  const docText = editor.document.getText();
  const lines = docText.split(/\r?\n/);

  const kind = kindHint || detectKindFromInstruction(instruction);
  if (!kind) {
    throw new Error('Could not infer what to edit (hazards / losses / UCAs). Mention it in your message.');
  }

  const op = detectOpFromInstruction(instruction);
  const explicitId = extractExplicitId(instruction, kind);

  // JSON documents: support add / update / delete inside hazards/losses/ucas arrays.
  if (isJsonDoc(docText) && explicitId) {
    if (op === 'delete') {
      const updated = tryUpdateOrDeleteInJsonArrayDeep(docText, kind, 'delete', explicitId);
      if (updated) {
        const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(editor.document.lineCount, 0));
        await editor.edit((ed) => ed.replace(fullRange, updated));
        return { applied: [`Deleted ${explicitId} from JSON array.`], preview: [], ranges: [] };
      }
    }

    if (op === 'update') {
      const existingLine =
        docText.split(/\r?\n/).find((l) => new RegExp(`^\\s*${explicitId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'i').test(l)) ||
        `${explicitId}: ...`;

      const prompt = buildUpdatePrompt(kind, instruction, docText, explicitId, existingLine);
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = resp.choices?.[0]?.message?.content?.trim() || '';
      const gen = normalizeGeneratedLines(raw)[0];
      if (!gen) throw new Error('Model returned no replacement line.');

      const replacement = gen.startsWith(`${explicitId}:`) ? gen : `${explicitId}: ${gen.replace(/^\w+\d+\s*:\s*/i, '')}`;
      const updated = tryUpdateOrDeleteInJsonArrayDeep(docText, kind, 'update', explicitId, replacement);

      if (updated) {
        const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(editor.document.lineCount, 0));
        await editor.edit((ed) => ed.replace(fullRange, updated));
        return { applied: [replacement], preview: [replacement], ranges: [] };
      }
    }
    // add is handled below via tryInsertIntoJsonArrayDeep
  }

  // Markdown/text documents
  if (op === 'delete') {
    if (!explicitId) throw new Error('To delete, please specify the exact ID (e.g., L3, H2, UCA5).');

    const idx = findLineIndexById(lines, explicitId);
    if (idx === -1) throw new Error(`Could not find ${explicitId} in the document.`);

    const delRange = editor.document.lineAt(idx).rangeIncludingLineBreak;
    await editor.edit((ed) => ed.delete(delRange));

    return { applied: [`Deleted: ${editor.document.lineAt(idx).text}`], preview: [], ranges: [] };
  }

  if (op === 'update') {
    if (!explicitId) throw new Error('To update, please specify the exact ID (e.g., L3, H2, UCA5).');

    const idx = findLineIndexById(lines, explicitId);
    if (idx === -1) throw new Error(`Could not find ${explicitId} in the document.`);

    const existingLine = editor.document.lineAt(idx).text;
    const prompt = buildUpdatePrompt(kind, instruction, docText, explicitId, existingLine);

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = resp.choices?.[0]?.message?.content?.trim() || '';
    const gen = normalizeGeneratedLines(raw)[0];
    if (!gen) throw new Error('Model returned no replacement line.');

    const replacement = gen.startsWith(`${explicitId}:`) ? gen : `${explicitId}: ${gen.replace(/^\w+\d+\s*:\s*/i, '')}`;

    const lineRange = new vscode.Range(new vscode.Position(idx, 0), new vscode.Position(idx, existingLine.length));
    await editor.edit((ed) => ed.replace(lineRange, replacement));

    const range = new vscode.Range(new vscode.Position(idx, 0), new vscode.Position(idx, replacement.length));

    const afterText = editor.document.getText();
    const plan = await proposeStep1RepairPlan(openai, afterText);

    return { applied: [replacement], preview: [replacement], ranges: [range], plan };
  }

  // op === 'add'
  const prompt = buildAddPrompt(kind, instruction, docText);
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = resp.choices?.[0]?.message?.content?.trim() || '';
  const genLines = normalizeGeneratedLines(raw);
  if (!genLines.length) throw new Error('Model returned no lines to insert.');

  const hasNumbers = genLines.some((l) =>
    kind === 'hazard' ? /^H\d+:/i.test(l) : kind === 'loss' ? /^L\d+:/i.test(l) : /^UCA\d+:/i.test(l)
  );

  let toInsert = genLines.slice();

  if (!hasNumbers) {
    const next =
      kind === 'hazard'
        ? nextIndex(lines, /^H(\d+)\s*:/i)
        : kind === 'loss'
          ? nextIndex(lines, /^L(\d+)\s*:/i)
          : nextIndex(lines, /^UCA(\d+)\s*:/i);

    toInsert = genLines.map((l, i) =>
      kind === 'hazard'
        ? `H${next + i}: ${l.replace(/^H\d+\s*:\s*/i, '')}`
        : kind === 'loss'
          ? `L${next + i}: ${l.replace(/^L\d+\s*:\s*/i, '')}`
          : `UCA${next + i}: ${l.replace(/^UCA\d+\s*:\s*/i, '')}`
    );
  }

  // JSON? Insert into arrays.
  if (isJsonDoc(docText)) {
    const updated = tryInsertIntoJsonArrayDeep(docText, kind, toInsert);
    if (updated) {
      const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(editor.document.lineCount, 0));
      await editor.edit((ed) => ed.replace(fullRange, updated));
      return { applied: toInsert, preview: genLines, ranges: [] };
    }
  }

  // Text/Markdown: insert inside the appropriate section.
  const insertAt =
    kind === 'hazard'
      ? findInsertLineInStep1(lines, 'HAZARDS')
      : kind === 'loss'
        ? findInsertLineInStep1(lines, 'LOSSES')
        : (() => {
          // UCAs can be in Step 3; fall back to a generic UCAS section at end.
          const ucasHead = /^\s*(\[?\s*UCAS\s*\]?|===\s*UCAS\s*===)\s*$/i;
          const range = findSectionRangeByHeading(lines, ucasHead);
          if (!range) {
            lines.push('', '=== UCAS ===', '');
            return lines.length; // insert after heading blank
          }
          let last = range.start;
          for (let i = range.start + 1; i < range.end; i++) if (/^UCA\d+\s*:/i.test(lines[i])) last = i;
          return last + 1;
        })();

  const pos = new vscode.Position(insertAt, 0);
  const insertedText = toInsert.join('\n') + '\n';

  await editor.edit((ed) => ed.insert(pos, insertedText));

  const endPos = endPositionFromText(pos, insertedText);
  const range = new vscode.Range(pos, endPos);

  const afterText = editor.document.getText();
  const plan = await proposeStep1RepairPlan(openai, afterText);

  return { applied: toInsert, preview: genLines, ranges: [range], plan };
}
