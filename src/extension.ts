// -------------------------------
// STPA Agent - VS Code Extension
// Main file (guided + classic flows)
// -------------------------------

import * as vscode from 'vscode';
import OpenAI from 'openai';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// UI
import { StpaChatViewProvider } from './chatView';

// internal
import { validateInput, formatIssuesTable, promptOnIssues } from './validator';
import { generateAndInsertMissingSections } from './aiQuickFix';
import { registerInlineCompletion } from './inlineCompletion';
import { applySmartEditPlan, smartEditFromChat, type SmartEditPlan, type EditScope } from './aiEdit';

// tables + diagrams + cs extract
import { buildMarkdownTables, parseHazardRow } from './tables';
import { buildControlStructureMermaid, buildImpactGraphMermaid } from './diagrams';
import { deriveControlStructFromText, parseStep2ControlStructure } from './csExtract';
import type { SystemType, StpaResult, ControlStructInput } from './types';
import { buildStagePayload, StageContext, UiStage } from './uiFlow';

/** -----------------------------------------------
 * ENV
 * ----------------------------------------------- */
function loadEnvFromExtension(extRoot: string) {
	try {
		const envPath = path.join(extRoot, '.env');
		if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
		else dotenv.config();
	} catch {
		/* noop */
	}
}

/** -----------------------------------------------
 * System type detection
 * ----------------------------------------------- */
function detectSystemType(text: string): SystemType {
	const lower = text.toLowerCase();
	if (/(patient|drug|dose|dosing|infusion|hospital|clinic|therapy|medical|device|monitoring)/.test(lower)) return 'medical';
	if (/(drone|uav|flight|gps|gnss|altitude|aircraft|autopilot|waypoint|gimbal)/.test(lower)) return 'drone';
	if (/(vehicle|car|brake|steer|steering|engine|automotive|airbag|lane|ecu|can bus|adas|aeb)/.test(lower)) return 'automotive';
	return 'generic';
}

/** -----------------------------------------------
 * Classic STPA prompt (for diagrams stage)
 * (Keep the same minimum requirements as before)
 * ----------------------------------------------- */
function buildStpaPrompt({ systemType = 'generic', text }: { systemType?: SystemType; text: string }): string {
	const systemHints: Record<SystemType, string> = {
		medical: '- Prioritize dosing risks, sensors, false alarms, thresholds, human-in-the-loop.',
		drone: '- Prioritize navigation/comm/obstacle detection/altitude control, GPS loss, wind/EMI.',
		automotive: '- Prioritize braking, steering, CAN bus, HMI, fail-safe modes, sensor fusion.',
		generic: '- Prioritize control loops, human operators, interfaces, dependencies, timing.',
	};

	return [
		'You are an expert STPA analyst. Perform a concise but complete STPA pass on the given system text.',
		systemHints[systemType],
		'',
		'Requirements:',
		'- Identify AT LEAST 5 distinct [LOSSES] (L1..).',
		'- Identify AT LEAST 5 distinct [HAZARDS] (H1..) and map them to relevant Losses.',
		'- Identify AT LEAST 8 distinct [UCAS] (UCA1..) tied to plausible control loops.',
		'- If information is insufficient for any item, write: INSUFFICIENT CONTEXT (but still list placeholders up to the minimum with brief assumptions).',
		'- Use ONLY the following sections and format. Do NOT add extra sections.',
		'',
		'[LOSSES]',
		'L1: ...',
		'L2: ...',
		'L3: ...',
		'L4: ...',
		'L5: ...',
		'',
		'[HAZARDS]',
		'H1: ... (related: L1, L2)',
		'H2: ... (related: L3)',
		'H3: ... (related: L1)',
		'H4: ... (related: L2, L5)',
		'H5: ... (related: L4)',
		'',
		'[UCAS]',
		'UCA1: ... (control loop: ... ; related: H1)',
		'UCA2: ... (control loop: ... ; related: H2)',
		'UCA3: ... (control loop: ... ; related: H3)',
		'UCA4: ... (control loop: ... ; related: H1, H4)',
		'UCA5: ... (control loop: ... ; related: H2)',
		'UCA6: ... (control loop: ... ; related: H5)',
		'UCA7: ... (control loop: ... ; related: H3)',
		'UCA8: ... (control loop: ... ; related: H4)',
		'',
		'--- SYSTEM TEXT START ---',
		text,
		'--- SYSTEM TEXT END ---',
	].join('\n');
}

/** -----------------------------------------------
 * Parse classic output
 * ----------------------------------------------- */
function parseStpaOutput(text: string): StpaResult {
	const grab = (section: string) => {
		const rx = new RegExp(`\\[${section}\\]([\\s\\S]*?)(\\n\\[|$)`, 'i');
		const m = text.match(rx);
		if (!m) return [];
		return m[1]
			.split(/\r?\n/)
			.map((s) => s.trim())
			.filter((s) => s && !/^\[.*\]$/.test(s));
	};

	return {
		losses: grab('LOSSES'),
		hazards: grab('HAZARDS'),
		ucas: grab('UCAS'),
		raw: text,
	};
}

/** -----------------------------------------------
 * Project helpers
 * ----------------------------------------------- */
type ProjectInfo = { dir: string; baseName: string };

function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9א-ת]+/gi, '-')
			.replace(/^-+|-+$/g, '') || 'stpa-project'
	);
}

async function prepareProjectFolder(suggested?: string): Promise<ProjectInfo | null> {
	const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!ws) {
		vscode.window.showErrorMessage('No workspace is open. Open a folder first.');
		return null;
	}

	const input = await vscode.window.showInputBox({
		title: 'STPA – Project name',
		prompt: 'איך לקרוא לניתוח / למערכת? (ישמש לתיקייה ולקבצים)',
		value: suggested || 'my-system',
		ignoreFocusOut: true,
	});

	if (!input) {
		vscode.window.showInformationMessage('Analysis canceled – no project name provided.');
		return null;
	}

	const baseName = slugify(input);
	const rootDir = path.join(ws, 'stpa_results');
	if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir, { recursive: true });

	const dir = path.join(rootDir, baseName);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

	return { dir, baseName };
}

function stripCodeFence(s?: string): string {
	if (!s) return '';
	return s.replace(/^\s*```mermaid\s*/i, '').replace(/\s*```$/i, '').trim();
}

/** -----------------------------------------------
 * Save utilities
 * ----------------------------------------------- */
async function saveResultAsJSON(result: StpaResult, project: ProjectInfo) {
	const file = path.join(project.dir, `${project.baseName}_stpa.json`);
	fs.writeFileSync(file, JSON.stringify({ losses: result.losses, hazards: result.hazards, ucas: result.ucas }, null, 2), 'utf-8');
}

async function saveMarkdownReport(md: string, project: ProjectInfo) {
	const file = path.join(project.dir, `${project.baseName}_report.md`);
	fs.writeFileSync(file, md, 'utf-8');
}

async function saveMermaidDiagrams(project: ProjectInfo, csMermaid?: string, impactMermaid?: string) {
	const csRaw = stripCodeFence(csMermaid);
	const impRaw = stripCodeFence(impactMermaid);

	if (csRaw) fs.writeFileSync(path.join(project.dir, `${project.baseName}_cs.mmd`), csRaw, 'utf-8');
	if (impRaw) fs.writeFileSync(path.join(project.dir, `${project.baseName}_impact.mmd`), impRaw, 'utf-8');
}

function printToOutput(result: StpaResult) {
	const out = vscode.window.createOutputChannel('STPA Agent');
	out.clear();
	out.appendLine('=== STPA (Markdown Tables) ===\n');
	out.appendLine(buildMarkdownTables(result));
	out.appendLine('\n=== End of Tables ===\n');
	out.show(true);
}

function buildMarkdownReport(ctx: {
	systemType: SystemType;
	result: StpaResult;
	csMermaid?: string;
	impactMermaid?: string;
}): string {
	const when = new Date().toISOString();
	const tables = buildMarkdownTables(ctx.result);

	return [
		`# STPA Report`,
		``,
		`- **Generated:** ${when}`,
		`- **Domain:** ${ctx.systemType}`,
		``,
		`---`,
		``,
		`## Analysis Tables`,
		tables,
		``,
		`---`,
		``,
		`## Diagrams`,
		``,
		`### Control Structure`,
		ctx.csMermaid || '_No control structure found._',
		``,
		`### UCA → Hazard → Loss`,
		ctx.impactMermaid || '_No relations found._',
		``,
		`---`,
		`## Raw STPA Output`,
		'```',
		ctx.result.raw.trim(),
		'```',
		'',
	].join('\n');
}

/** -----------------------------------------------
 * Model calls
 * ----------------------------------------------- */
async function runModel(apiKey: string, prompt: string): Promise<StpaResult> {
	const openai = new OpenAI({ apiKey });
	const resp = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		temperature: 0.2,
		messages: [{ role: 'user', content: prompt }],
	});

	const content = resp.choices?.[0]?.message?.content || 'No response.';
	return parseStpaOutput(content);
}

/** -----------------------------------------------
 * Guided prompts (Handbook-oriented)
 * NOTE: guided file uses headings so aiEdit can find sections.
 * ----------------------------------------------- */
// src/prompts.ts
// English-only prompt strings (per project convention).


/**
 * STEP 1 (10/10 target)
 * Key upgrades:
 * - Hazards are CONTROLLED-PROCESS unsafe states/conditions (not "late / fails / misjudges / detect").
 * - Constraints are observable system behaviors (shall/shall not), not "accuracy/performance".
 * - Adds a Controlled-Process anchor + required state variables for better hazard wording.
 * - Keeps your tables + traceability, but with stronger self-check language.
 */
export function buildStep1Prompt(systemText: string, systemType: SystemType): string {
	return [
		'You are an expert safety engineer performing Systems-Theoretic Process Analysis (STPA).',
		'',
		'Perform STPA Step 1: Define the purpose of the analysis.',
		'Reference: STPA Handbook (Nancy Leveson), Step 1 definitions.',
		'',
		`Domain / system type hint: ${systemType}.`,
		'',
		'PRIMARY GOAL:',
		'- Produce academically credible Step 1 artifacts that can drive Step 2-4 without rework.',
		'',
		'MANDATORY DEFINITIONS (use exactly):',
		'- Loss (L): an unacceptable outcome or harm to people, mission, property, environment, or public trust.',
		'- Hazard (H): a system state or set of conditions of the CONTROLLED PROCESS that, with worst-case environmental conditions, will lead to one or more losses.',
		'- Safety Constraint (SC): a system-level requirement or restriction on behavior that prevents or mitigates a hazard.',
		'- Hazard Refinement: operational context / ODD / worst-case assumptions ONLY (no causes).',
		'',
		'CONTROLLED PROCESS ANCHOR (MANDATORY):',
		'- Identify the controlled process implied by the system text (e.g., vehicle motion/spacing, medication delivery, industrial pressure/temperature, etc.).',
		'- Hazards MUST describe unsafe STATES/CONDITIONS of that controlled process in the environment.',
		'- Hazards must NOT describe actions, failures, or internal mechanisms.',
		'- If you catch yourself describing a component failure, rewrite it as an unsafe controlled-process state observable in the environment.',
		'',
		'HAZARDS (H#): 10/10 RULESET (HARD):',
		'1) Hazards must be EXTERNALLY OBSERVABLE unsafe states/conditions (WHAT is unsafe), not internal reasons (WHY).',
		'2) Hazards must clearly describe what the controlled process is doing when unsafe, not which component failed.',
		'3) Hazards must NOT be phrased as "the system fails", "does not", "too late", "misjudges" or "detects incorrectly".',
		'4) Hazards should reference controlled-process variables when applicable: speed, distance gap, time-to-collision, pressure, temperature, dosage, position, energy exposure, access state, etc.',
		'5) Hazards must be system-level, not component-level (no sensors/software/algorithms/networks).',
		'',
		'FORBIDDEN IN HAZARDS (rewrite until none appear):',
		'- failure / fails / failed / failing',
		'- does not / not apply / not provide / missing (when used as an action mistake)',
		'- late / delay / too early / too late (when describing timing errors)',
		'- logging / record / database / audit trail',
		'- sensor / camera / radar / lidar / software / algorithm / controller / network / communication / EHR',
		'- component-centric phrasing such as "drawer fails" or "scanner error"',
		'- causal wording: because / due to / caused by / results from',
		'',
		'MANDATORY HAZARD SENTENCE FORM:',
		'"The controlled process <UNSAFE_STATE_PHRASE> while <operational context>. (leads_to: L#, L#)"',
		'',
		'UNSAFE_STATE_PHRASE RULES:',
		'- 3-14 words, externally observable, state/condition only.',
		'- Mention the controlled process PLUS the unsafe state and the environment/context where it occurs.',
		'- Examples (adapt, do NOT copy blindly):',
		'  • "maintains unsafe separation distance to a person"',
		'  • "closes on an obstacle with insufficient deceleration"',
		'  • "operates with braking demand exceeding available traction"',
		'  • "releases hazardous energy beyond safe limits"',
		'  • "executes an irreversible action on the wrong target"',
		'  • "presents no effective warning when collision risk is imminent" (warning recorded as observable state)',
		'',
		'REFINED HAZARDS:',
		'- Exactly one refinement line per hazard.',
		'- Refinement adds context/ODD/worst-case assumptions (weather, visibility loss, degraded communications, workload spikes, power degradation, time pressure, degraded mode).',
		'- Do NOT repeat the hazard phrasing or write "under normal operational conditions".',
		'- No causes, no failures, no components.',
		'',
		'SAFETY CONSTRAINTS (SC#): 10/10 RULESET (HARD):',
		'1) Constraints must describe system-level, observable behavior with gating or conditional phrasing (e.g., shall permit/allow/issue/execute only when…, shall ensure/prevent… before/while…, shall provide warning/indication when…).',
		'2) Each constraint must directly prevent or mitigate the hazard state (match the unsafe state).',
		'3) Do NOT prescribe internal design solutions (no sensors/software/algorithms).',
		'',
		'FORBIDDEN IN CONSTRAINTS (rewrite until none appear):',
		'- detect / detection / false positives / false negatives',
		'- sensor / software / algorithm / controller / network / communication',
		'- accuracy / assessment quality / performance / reliability / robust',
		'- shall not administer incorrect… / shall not do no… (describe the allowed/prevented behavior instead)',
		'',
		'LOSS COVERAGE RULE (HARD):',
		'- Every Loss Li MUST appear in at least one hazard (leads_to: ... Li ...).',
		'- If you cannot link a loss, remove it OR rewrite hazards so it is legitimately covered.',
		'',
		'COMPLETENESS MINIMUMS:',
		'- Losses: at least 5',
		'- Hazards: at least 6',
		'- Safety Constraints: at least 8',
		'',
		'DERIVED TABLES (MUST BE CONSISTENT, NO INVENTION):',
		'- Table A: Loss -> Hazards derived ONLY from (leads_to). Use "; " between IDs.',
		'- Table B: Hazard -> Safety Constraints derived ONLY from (addresses). Use "; " between IDs.',
		'',
		'TABLE CONSISTENCY RULE (SELF-CHECK):',
		'- Every Loss Li must appear in at least one hazard leads_to mapping and the same mapping must be reflected in Table A.',
		'- Table B must use ONLY addresses data and cover every hazard that has an SC.',
		'- If Table A/B do not match the leads_to/addresses above, revise the hazards or constraints until they align.',
		'',
		'FINAL SELF-CHECK (DO NOT SKIP):',
		'1) Each hazard is a controlled-process unsafe state/condition (not an action mistake).',
		'2) No forbidden terms appear in hazards or constraints.',
		'3) Every hazard maps ONLY to Loss IDs, every constraint maps ONLY to Hazard IDs.',
		'4) Every hazard has exactly one refinement line (context only).',
		'5) Tables exactly match the mappings.',
		'',
		'OUTPUT REQUIREMENTS:',
		'- Output ONLY the sections below, in this exact order.',
		'- Output MUST start with "=== LOSSES ===" and contain no text before it.',
		'',
		'=== LOSSES ===',
		'L1: <unacceptable outcome/harm>',
		'L2: <...>',
		'',
		'=== HAZARDS ===',
		'H1: The controlled process <unsafe_state_phrase> while <operational context>. (leads_to: L#, L#)',
		'H2: ...',
		'',
		'=== SAFETY CONSTRAINTS ===',
		'SC1: The system shall/shall not <observable behavior>. (addresses: H#)',
		'SC2: ...',
		'',
		'=== REFINED HAZARDS ===',
		'H1 refinement: <ODD + worst-case context only>',
		'H2 refinement: ...',
		'',
		'=== MISSING INFORMATION ===',
		'- None or clarification questions',
		'',
		'=== TABLE A: LOSS TO HAZARDS ===',
		'| Loss | Hazards |',
		'| --- | --- |',
		'| L# | H#; H# |',
		'',
		'=== TABLE B: HAZARD TO SAFETY CONSTRAINTS ===',
		'| Hazard | Safety Constraints |',
		'| --- | --- |',
		'| H# | SC#; SC# |',
		'',
		'READ-ONLY SYSTEM DESCRIPTION (INPUT ONLY – DO NOT REPEAT IN OUTPUT):',
		'--- SYSTEM TEXT START ---',
		systemText,
		'--- SYSTEM TEXT END ---',
	].join('\\n');
}


/**
 * STEP 2 (10/10 target)
 * Key upgrades:
 * - Forces "information content" feedback naming (no generic "status").
 * - Requires at least one fully closed loop; encourages a driver/HMI loop only if implied.
 * - Prevents inventing components; uses Missing Information for required-but-unclear signals.
 */
export function buildStep2Prompt(systemText: string, systemType: SystemType, step1Text: string): string {
	return [
		'You are an expert safety engineer performing Systems-Theoretic Process Analysis (STPA).',
		'',
		'Perform STPA Step 2: Model the hierarchical control structure.',
		'Reference: STPA Handbook guidance on control structures and closed-loop control.',
		'',
		`Domain / system type: ${systemType}.`,
		'',
		'GOAL (MUST ACHIEVE):',
		'- Produce a COMPLETE control structure that is sufficient to derive UCAs in Step 3.',
		'- Provide at least one CLOSED control loop:',
		'  Controller → Control Action(s) → Actuator(s) → Controlled Process → Feedback(s) → Controller.',
		'',
		'READ-ONLY INPUTS (do not modify):',
		'--- STEP 1 START ---',
		step1Text,
		'--- STEP 1 END ---',
		'',
		'SOURCE OF TRUTH SYSTEM DESCRIPTION:',
		'--- SYSTEM TEXT START ---',
		systemText,
		'--- SYSTEM TEXT END ---',
		'',
		'STRICT RULES:',
		'- Use ONLY information explicitly stated or clearly implied by the system description.',
		'- Do NOT invent components, users, networks, sensors, features, or organizations not present/implied.',
		'- If something is necessary for a closed loop but unclear, add it as a question under MISSING INFORMATION.',
		'',
		'CRITICAL DISTINCTIONS:',
		'- Controller = decision-making entity (human/software/device/organization).',
		'- Actuator = physical/effecting mechanism that changes the controlled process.',
		'- Sensor = measures the controlled process or environment and produces information used by controllers.',
		'',
		'FEEDBACK QUALITY RULE (HARD):',
		'- Feedback signals must NOT be generic labels like "status signal".',
		'- Name the information content (examples: speed estimate, acceleration, brake pressure, wheel slip, distance gap, TTC, temperature, flow rate, access state).',
		'- If the system text implies specific feedback items (e.g., wheel slip), represent them explicitly.',
		'',
		'CONTROL ACTION QUALITY RULE (HARD):',
		'- Control actions must be commands/communications issued by controllers.',
		'- Use action verbs and keep them observable (e.g., "Command braking deceleration", "Issue collision warning").',
		'',
		'OUTPUT FORMAT REQUIREMENTS (MUST FOLLOW EXACTLY):',
		'- Output MUST be editable Markdown.',
		'- Use EXACT headings and EXACT line formats shown below.',
		'- Do NOT include extra headings, prose, or analysis outside the sections.',
		'',
		'=== CONTROL_STRUCTURE_TEXT ===',
		'<Concise textual description of the hierarchical control structure (2–8 lines).>',
		'',
		'=== CONTROLLERS ===',
		'C1: <name> (type: human|software|device|organization) - <notes>',
		'C2: <name> (type: human|software|device|organization) - <notes>',
		'',
		'=== CONTROLLED_PROCESSES ===',
		'P1: <name> - <notes>',
		'',
		'=== ACTUATORS ===',
		'A1: <name> (affects: P1) - <notes>',
		'',
		'=== SENSORS ===',
		'S1: <name> (measures: P1) - <notes>',
		'S2: <name> (measures: P1) - <notes>',
		'',
		'=== EXTERNAL_SYSTEMS ===',
		'X1: <name> - <notes>',
		'',
		'=== CONTROL_ACTIONS ===',
		'CA1: C1 -> <action>',
		'CA2: C1 -> <action>',
		'CA3: C2 -> <action>',
		'CA4: C2 -> <action>',
		'',
		'=== FEEDBACK ===',
		'F1: <from> -> C1 : <signal_name> - <information content notes>',
		'F2: <from> -> C2 : <signal_name> - <information content notes>',
		'',
		'=== CONTROL_LOOPS ===',
		'LOOP1: controller=C1; controlled_process=P1; actuators=[A1]; control_actions=[CA1, CA2]; feedback=[F1]',
		'',
		'=== MISSING INFORMATION ===',
		'- <question or clarification needed, if any>',
		'',
		'=== SUMMARY TABLE ===',
		'Provide ONE concise markdown table with columns:',
		'| Loop | Controller | Control Actions | Actuators | Controlled Process | Feedback |',
		'| --- | --- | --- | --- | --- | --- |',
		'| LOOP1 | C1 | CA1; CA2 | A1 | P1 | F1; F2 |',
	].join('\n');
}

/**
 * STEP 3 (10/10 target)
 * Key upgrades:
 * - Enforces "UCA must align to hazard meaning" (warning UCAs map to warning hazards, etc.).
 * - Requires minimum coverage: at least 1 UCA per control action.
 * - Prevents failure-language; keeps it an unsafe action in context.
 */
export function buildStep3Prompt(
	systemText: string,
	systemType: SystemType,
	step1Text: string,
	step2Text: string
): string {
	return [
		'You are an expert safety engineer performing Systems-Theoretic Process Analysis (STPA).',
		'',
		'Perform STPA Step 3: Identify Unsafe Control Actions (UCAs).',
		'Reference: STPA Handbook Step 3 UCA categories.',
		'',
		`Domain / system type: ${systemType}.`,
		'',
		'GOAL (HARD):',
		'- UCAs must be derived ONLY from control actions defined in Step 2.',
		'- UCAs must map ONLY to hazards defined in Step 1 (H#).',
		'',
		'READ-ONLY INPUTS (do not modify):',
		'--- STEP 1 START ---',
		step1Text,
		'--- STEP 1 END ---',
		'',
		'--- STEP 2 START ---',
		step2Text,
		'--- STEP 2 END ---',
		'',
		'--- SYSTEM TEXT START ---',
		systemText,
		'--- SYSTEM TEXT END ---',
		'',
		'UCA CATEGORIES:',
		'A) omission (not providing the control action when required)',
		'B) commission (providing the control action when not appropriate)',
		'C) timing/sequence (too early, too late, out of order)',
		'D) duration (applied too long or stopped too soon)',
		'',
		'SYSTEMATIC COVERAGE (MANDATORY):',
		'- For EACH control action CA# in Step 2, produce at least ONE UCA.',
		'- Produce additional UCAs only if they introduce genuinely different unsafe contexts.',
		'',
		'UCA FORMULATION RULES (HARD):',
		'- Each UCA must be phrased as an unsafe control action IN CONTEXT (not a cause analysis).',
		'- Forbidden phrasing: "fails to", "due to", "because of", "sensor error", "mis-detection", "bug".',
		'- Each UCA must explicitly include:',
		'  • type: omission|commission|timing|duration',
		'  • controller: C#',
		'  • control_action: CA#',
		'  • specific operational context (ODD, workload, environment, mode, etc.)',
		'  • (leads_to: H#; H#) mapping that matches the UCA meaning',
		'',
		'MEANING ALIGNMENT RULE (HARD):',
		'- If a UCA is about warning/alerting, it must map to hazards about insufficient/absent warning state (not braking/actuation hazards).',
		'- If a UCA is about applying physical control, it must map to hazards about unsafe controlled-process states (distance, energy, traction, etc.).',
		'',
		'OUTPUT FORMAT REQUIREMENTS (MUST FOLLOW EXACTLY):',
		'- Output MUST be editable Markdown.',
		'- Use EXACT headings and EXACT line formats shown below.',
		'- Do NOT include extra headings, prose, or analysis outside the sections.',
		'',
		'=== UCAS ===',
		'UCA1: (type: omission) (controller: C1) (control_action: CA1) <unsafe action in context>. (leads_to: H1; H2)',
		'UCA2: (type: commission) (controller: C1) (control_action: CA2) <unsafe action in context>. (leads_to: H3)',
		'UCA3: (type: timing) (controller: C2) (control_action: CA3) <unsafe action in context>. (leads_to: H4)',
		'UCA4: (type: duration) (controller: C2) (control_action: CA4) <unsafe action in context>. (leads_to: H5)',
		'',
		'=== MISSING INFORMATION ===',
		'- <question or clarification needed, if any>',
		'',
		'=== SUMMARY TABLE ===',
		'Provide ONE concise markdown table with columns:',
		'Do NOT wrap this table in triple backticks (no ```).',
		'| UCA | Type | Controller | Control Action | Hazards |',
		'| --- | --- | --- | --- | --- |',
		'| UCA1 | omission | C1 | CA1 | H1; H2 |',
	].join('\n');
}

/**
 * STEP 4 (10/10 target)
 * Key upgrades:
 * - Anti-duplication (explicitly forbids near-duplicates).
 * - Forces scenario diversity across factor categories.
 * - Requires concrete factor statements (observable consequence), not vague filler.
 * - Uses ONLY existing IDs.
 */
export function buildStep4Prompt(
	systemText: string,
	systemType: SystemType,
	step1Text: string,
	step2Text: string,
	step3Text: string
): string {
	return [
		'You are an expert STPA analyst producing an academic-quality Step 4 output.',
		'',
		'Perform STPA Step 4 (Loss Scenarios) according to the STPA Handbook.',
		'',
		`Domain / system type: ${systemType}.`,
		'',
		'GOAL (Step 4):',
		'- Identify causal loss scenarios that can lead to existing UCAs and/or directly to Hazards.',
		'- Each scenario MUST be traceable: LS -> UCA(s) -> Hazard(s) -> Loss(es).',
		'',
		'READ-ONLY INPUTS (do not modify):',
		'--- STEP 1 START ---',
		step1Text,
		'--- STEP 1 END ---',
		'',
		'--- STEP 2 START ---',
		step2Text,
		'--- STEP 2 END ---',
		'',
		'--- STEP 3 START ---',
		step3Text,
		'--- STEP 3 END ---',
		'',
		'SOURCE OF TRUTH SYSTEM DESCRIPTION:',
		'--- SYSTEM TEXT START ---',
		systemText,
		'--- SYSTEM TEXT END ---',
		'',
		'STRICT CONSISTENCY RULES (HARD):',
		'- Do NOT invent new UCAs, Hazards, Losses, Controllers, Sensors, Actuators, Controlled Processes, Control Actions, or Loops.',
		'- Use ONLY IDs that already exist in Steps 1–3.',
		'',
		'REQUIRED OUTPUT CONTENT:',
		'- Produce AT LEAST 10 scenarios (LS1..LS10).',
		'- Each scenario MUST include: linked_ucas, linked_hazards, linked_losses, and trace (IDs).',
		'- Each scenario MUST include factors grouped by categories:',
		'  controller_process_model, feedback_and_sensing, actuator_and_control_path, controlled_process_and_dynamics, human_and_organization, communication_and_coordination, environment_and_disturbances',
		'',
		'UNIQUENESS (HARD, 10/10 REQUIREMENT):',
		'- Do NOT produce near-duplicate scenarios. No reworded repeats.',
		'- Each LS must introduce at least ONE distinct causal mechanism compared to all previous LS entries.',
		'',
		'DIVERSITY TARGET (MANDATORY ACROSS THE SET):',
		'- At least 2 scenarios dominated by incorrect/insufficient controller process model.',
		'- At least 2 dominated by missing/incorrect/stale feedback & sensing (without naming internal implementation).',
		'- At least 2 dominated by actuator/control path issues (command not transmitted, overridden, limited authority, etc.).',
		'- At least 2 dominated by controlled-process dynamics/physical limits (traction, inertia, saturation, delays).',
		'- At least 2 dominated by human/organization/coordination factors (handoff, mode confusion, workload), if humans exist in Step 2/3.',
		'',
		'FACTOR QUALITY RULE (HARD):',
		'- Factors must be concrete and testable (observable consequence), not vague fillers.',
		'- Avoid: "ineffective", "slow processing", "poor system".',
		'- Prefer: "feedback reflects stale value", "control action issued with insufficient lead time", "authority limited by friction", "warning masked by noise".',
		'',
		'OUTPUT FORMAT REQUIREMENTS (MUST FOLLOW EXACTLY):',
		'- Output MUST be editable Markdown.',
		'- Use EXACT headings and EXACT line formats shown below.',
		'- Do NOT include extra headings, prose, or analysis outside the sections.',
		'',
		'=== LOSS SCENARIOS ===',
		'LS1: (linked_ucas: UCA1) (linked_hazards: H1) (linked_losses: L1) (trace: C1/CA1/A1/P1; feedback: F1; sensors: S1) <short scenario narrative>. {factors: controller_process_model=...; feedback_and_sensing=...; actuator_and_control_path=...; controlled_process_and_dynamics=...; human_and_organization=...; communication_and_coordination=...; environment_and_disturbances=...}',
		'LS2: ...',
		'LS3: ...',
		'LS4: ...',
		'LS5: ...',
		'LS6: ...',
		'LS7: ...',
		'LS8: ...',
		'LS9: ...',
		'LS10: ...',
		'',
		'=== MISSING INFORMATION ===',
		'- <question or clarification needed, if any>',
		'',
		'=== SUMMARY TABLE ===',
		'Output EXACTLY one markdown table and nothing else in this section.',
		'No extra text is allowed in the SUMMARY TABLE section.',
		'Do NOT wrap this table in triple backticks (no ```).',
		'The first five columns MUST contain ONLY IDs separated by "; ".',
		'The "Key factors" column must contain only short keywords (2–6 words), not sentences.',
		'| LS | UCAs | Hazards | Losses | Control loop | Key factors |',
		'| --- | --- | --- | --- | --- | --- |',
		'| LS1 | UCA1; UCA2 | H1; H2 | L1; L2 | C1; CA1; A1; P1 | stale feedback; traction limit |',
	].join('\n');
}

async function runStepText(apiKey: string, prompt: string): Promise<string> {
	const openai = new OpenAI({ apiKey });
	const resp = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		temperature: 0.2,
		messages: [{ role: 'user', content: prompt }],
	});

	return (resp.choices?.[0]?.message?.content || '').trim();
}

export function sanitizeSummaryTableSection(stepText: string): string {
	const header = '=== SUMMARY TABLE ===';
	const headerIndex = stepText.indexOf(header);
	if (headerIndex === -1) return stepText;

	const afterHeader = headerIndex + header.length;
	const remainder = stepText.slice(afterHeader);
	const nextHeadingMatch = remainder.match(/\n===\s+[A-Z0-9 _]+===/);
	const nextHeadingIndex = nextHeadingMatch?.index;
	const sectionEnd = typeof nextHeadingIndex === 'number' ? afterHeader + nextHeadingIndex : stepText.length;
	const sectionBody = stepText.slice(afterHeader, sectionEnd);

	const lines = sectionBody.split(/\r?\n/);
	const withoutFences = lines.filter((line) => !/^```/.test(line.trim()));
	const tableLines = withoutFences.filter((line) => line.trim().startsWith('|'));

	if (tableLines.length) {
		const sanitizedSection = `${header}\n\n${tableLines.join('\n')}`;
		return stepText.slice(0, headerIndex) + sanitizedSection + stepText.slice(sectionEnd);
	}

	const cleanedBody = withoutFences.join('\n').trimEnd();
	const sanitizedSection = `${header}${cleanedBody ? `\n${cleanedBody}` : ''}`;
	return stepText.slice(0, headerIndex) + sanitizedSection + stepText.slice(sectionEnd);
}
function extractSectionBody(text: string, heading: string): string | null {
	const startIndex = text.indexOf(heading);
	if (startIndex === -1) return null;
	const remainder = text.slice(startIndex + heading.length).replace(/^\r?\n/, '');
	const nextHeadingMatch = remainder.match(/\n===\s+[A-Z0-9 :]+===/);
	const endIndex = typeof nextHeadingMatch?.index === 'number' ? nextHeadingMatch.index : remainder.length;
	const body = remainder.slice(0, endIndex);
	return body.trim();
}

function normalizeId(value: string): string {
	return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function parseTableRows(section?: string | null): string[] {
	if (!section) return [];
	const lines = section
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith('|'));
	if (!lines.length) return [];
	const rows = lines.filter((line) => !/^\|\s*-/.test(line));
	return rows.length > 1 ? rows.slice(1) : [];
}

function parseIdList(raw: string, pattern: RegExp): string[] {
	return raw
		.split(/[;,]/)
		.map((part) => normalizeId(part))
		.filter((item) => item && pattern.test(item));
}

export function validateStep1Tables(text: string): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	const sections = {
		losses: extractSectionBody(text, '=== LOSSES ==='),
		hazards: extractSectionBody(text, '=== HAZARDS ==='),
		constraints: extractSectionBody(text, '=== SAFETY CONSTRAINTS ==='),
		tableA: extractSectionBody(text, '=== TABLE A: LOSS TO HAZARDS ==='),
		tableB: extractSectionBody(text, '=== TABLE B: HAZARD TO SAFETY CONSTRAINTS ==='),
	};

	for (const [name, content] of Object.entries(sections)) {
		if (!content) {
			errors.push(`Missing section: ${name.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}.`);
		}
	}

	const lossLines = (sections.losses || '')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => /^L\d+/i.test(line));
	const losses = lossLines
		.map((line) => {
			const match = line.match(/^L(\d+)/i);
			return match ? `L${match[1]}` : '';
		})
		.filter(Boolean) as string[];
	const lossSet = new Set(losses);
	if (!losses.length) errors.push('No valid losses were parsed from Step 1 output.');

	const hazardLines = (sections.hazards || '')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => /^H\d+/i.test(line));
	const hazards = hazardLines.map(parseHazardRow).filter((hazard) => hazard.id);
	const hazardMap = new Map(hazards.map((hazard) => [hazard.id, hazard]));
	if (!hazards.length) errors.push('No hazards were parsed from Step 1 output.');

	const constraintLines = (sections.constraints || '')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => /^SC\d+/i.test(line));
	const constraints = constraintLines
		.map((line) => {
			const match = line.match(/^SC(\d+)/i);
			const id = match ? `SC${match[1]}` : '';
			const addressesMatch = line.match(/addresses\s*:\s*([^)]+)/i);
			const addresses = addressesMatch ? parseIdList(addressesMatch[1], /^H\d+$/i) : [];
			if (id && !addresses.length) {
				errors.push(`Constraint ${id} is missing hazard addresses.`);
			}
			return { id, addresses };
		})
		.filter((entry) => entry.id);
	const constraintMap = new Map(constraints.map((entry) => [entry.id, new Set(entry.addresses)]));
	if (!constraints.length) errors.push('No safety constraints were parsed from Step 1 output.');

	const tableARows = parseTableRows(sections.tableA);
	const tableBRows = parseTableRows(sections.tableB);

	const coveredLosses = new Set<string>();
	for (const hazard of hazards) {
		for (const lossId of hazard.leadsToLosses) {
			if (!lossSet.has(lossId)) {
				errors.push(`Hazard ${hazard.id} references undefined loss ${lossId}.`);
			} else {
				coveredLosses.add(lossId);
			}
		}
	}

	for (const lossId of losses) {
		if (!coveredLosses.has(lossId)) {
			errors.push(`Loss ${lossId} is not covered by any hazard leads_to listing.`);
		}
	}

	for (const row of tableARows) {
		const cells = row
			.split('|')
			.map((cell) => cell.trim())
			.filter((cell) => cell);
		if (cells.length < 2) {
			errors.push(`Malformed Table A row: "${row}".`);
			continue;
		}
		const lossId = normalizeId(cells[0]);
		if (!/^L\d+$/i.test(lossId)) {
			errors.push(`Table A row "${row}" references an invalid loss identifier.`);
			continue;
		}
		if (!lossSet.has(lossId)) {
			errors.push(`Table A row references unknown loss ${lossId}.`);
			continue;
		}
		const hazardIds = parseIdList(cells[1], /^H\d+$/i);
		if (!hazardIds.length) {
			errors.push(`Table A row for ${lossId} must list at least one hazard.`);
		}
		for (const hazardId of hazardIds) {
			const hazard = hazardMap.get(hazardId);
			if (!hazard) {
				errors.push(`Table A lists unknown hazard ${hazardId}.`);
				continue;
			}
			if (!hazard.leadsToLosses.includes(lossId)) {
				errors.push(`Hazard ${hazardId} does not link to ${lossId} but appears in Table A.`);
			}
		}
	}

	for (const row of tableBRows) {
		const cells = row
			.split('|')
			.map((cell) => cell.trim())
			.filter((cell) => cell);
		if (cells.length < 2) {
			errors.push(`Malformed Table B row: "${row}".`);
			continue;
		}
		const hazardId = normalizeId(cells[0]);
		if (!/^H\d+$/i.test(hazardId)) {
			errors.push(`Table B row "${row}" references an invalid hazard identifier.`);
			continue;
		}
		if (!hazardMap.has(hazardId)) {
			errors.push(`Table B references unknown hazard ${hazardId}.`);
			continue;
		}
		const constraintIds = parseIdList(cells[1], /^SC\d+$/i);
		if (!constraintIds.length) {
			errors.push(`Table B row for ${hazardId} must list at least one constraint.`);
			continue;
		}
		for (const constraintId of constraintIds) {
			const addresses = constraintMap.get(constraintId);
			if (!addresses) {
				errors.push(`Table B references unknown constraint ${constraintId}.`);
				continue;
			}
			if (!addresses.has(hazardId)) {
				errors.push(`Constraint ${constraintId} does not address hazard ${hazardId} but appears in Table B.`);
			}
		}
	}

	return { valid: errors.length === 0, errors };
}

/** -----------------------------------------------
 * Guided session state
 * ----------------------------------------------- */
type GuidedStep = 1 | 2 | 3 | 4;

type GuidedSession = {
	project: ProjectInfo;
	systemText: string;
	systemType: SystemType;
	currentStep: GuidedStep;
	guidedPath: string;
	step1Text?: string;
	step2Text?: string;
	step3Text?: string;
	step4Text?: string;
};

let guidedSession: GuidedSession | null = null;

type PendingJump = {
	targetStep: GuidedStep;
	systemText: string;
	systemType: SystemType;
};

let pendingJump: PendingJump | null = null;


/** Build guided md content (NO system description in file) */
function buildGuidedFileContent(session: GuidedSession): string {
	const lines: string[] = [];
	lines.push(`# STPA Guided Analysis`);
	lines.push(``);
	lines.push(`- **Project:** ${session.project.baseName}`);
	lines.push(`- **Domain:** ${session.systemType}`);
	lines.push(`- **Generated:** ${new Date().toISOString()}`);
	lines.push(``);
	lines.push(`---`);
	lines.push(``);

	if (session.step1Text) {
		lines.push(`## Step 1 – Define Purpose of Analysis`);
		lines.push(session.step1Text.trim());
		lines.push(``);
		lines.push(`---`);
		lines.push(``);
	}

	if (session.step2Text) {
		lines.push(`## Step 2 – Model the Control Structure`);
		lines.push(session.step2Text.trim());
		lines.push(``);
		lines.push(`---`);
		lines.push(``);
	}

	if (session.step3Text) {
		lines.push(`## Step 3 – Identify Unsafe Control Actions`);
		lines.push(session.step3Text.trim());
		lines.push(``);
		lines.push(`---`);
		lines.push(``);
	}

	if (session.step4Text) {
		lines.push(`## Step 4 – Identify Loss Scenarios`);
		lines.push(session.step4Text.trim());
		lines.push(``);
	}

	return lines.join('\n');
}

async function writeGuidedFile(session: GuidedSession) {
	const content = buildGuidedFileContent(session);
	fs.writeFileSync(session.guidedPath, content, 'utf-8');
}

async function openGuidedInEditor(session: GuidedSession) {
	const doc = await vscode.workspace.openTextDocument(session.guidedPath);
	await vscode.window.showTextDocument(doc, { preview: false });
}

function hasStep(text: string, step: GuidedStep): boolean {
	const rx =
		step === 1 ? /##\s*Step\s*1\b/i :
			step === 2 ? /##\s*Step\s*2\b/i :
				step === 3 ? /##\s*Step\s*3\b/i :
					/##\s*Step\s*4\b/i;
	return rx.test(text);
}

function extractStepBlock(text: string, step: GuidedStep): string | null {
	const title =
		step === 1 ? 'Step 1 – Define Purpose of Analysis' :
			step === 2 ? 'Step 2 – Model the Control Structure' :
				step === 3 ? 'Step 3 – Identify Unsafe Control Actions' :
					'Step 4 – Identify Loss Scenarios';

	const rx = new RegExp(
		`##\\s*${title.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*\\n([\\s\\S]*?)(\\n---\\n|$)`,
		'i'
	);

	const m = text.match(rx);
	if (!m) { return null; }
	return (m[1] || '').trim();
}


/** -----------------------------------------------
 * lastContext for classic output/diagrams preview
 * ----------------------------------------------- */
let lastContext: {
	systemType: SystemType;
	result: StpaResult;
	cs?: ControlStructInput;
	csMermaid?: string;
	impactMermaid?: string;
	project?: ProjectInfo;
} | null = null;

function getGuidedDiagramPaths(project: ProjectInfo) {
	return {
		csPath: path.join(project.dir, `${project.baseName}_cs.mmd`),
		impactPath: path.join(project.dir, `${project.baseName}_impact.mmd`),
		jsonPath: path.join(project.dir, `${project.baseName}_stpa.json`),
	};
}

function readResultFromJson(jsonPath: string): StpaResult | null {
	if (!fs.existsSync(jsonPath)) return null;
	try {
		const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
		return {
			losses: Array.isArray(parsed?.losses) ? parsed.losses : [],
			hazards: Array.isArray(parsed?.hazards) ? parsed.hazards : [],
			ucas: Array.isArray(parsed?.ucas) ? parsed.ucas : [],
			raw: typeof parsed?.raw === 'string' ? parsed.raw : '',
		};
	} catch {
		return null;
	}
}

function loadGuidedDiagramsFromDisk(session: GuidedSession): boolean {
	const { csPath, impactPath, jsonPath } = getGuidedDiagramPaths(session.project);
	if (!fs.existsSync(csPath) || !fs.existsSync(impactPath)) { return false; }

	const sameProject =
		lastContext?.project?.baseName === session.project.baseName &&
		lastContext?.project?.dir === session.project.dir;
	const hasMermaidsInContext = !!lastContext?.csMermaid && !!lastContext?.impactMermaid;

	if (!sameProject || !hasMermaidsInContext) {
		const csMermaid = fs.readFileSync(csPath, 'utf-8');
		const impactMermaid = fs.readFileSync(impactPath, 'utf-8');
		const result = readResultFromJson(jsonPath) || { losses: [], hazards: [], ucas: [], raw: '' };

		lastContext = {
			systemType: session.systemType,
			result,
			csMermaid,
			impactMermaid,
			project: session.project,
		};
	}

	return true;
}

async function generateDiagramsForGuidedSession(apiKey: string, session: GuidedSession): Promise<void> {
	const prompt = buildStpaPrompt({ systemType: session.systemType, text: session.systemText });
	const result = await runModel(apiKey, prompt);

	const step2Cs = session.step2Text ? parseStep2ControlStructure(session.step2Text) : undefined;
	const cs = step2Cs ?? deriveControlStructFromText(session.systemText);
	const csMermaid = buildControlStructureMermaid(cs);
	const impactMermaid = buildImpactGraphMermaid(result);

	lastContext = {
		systemType: session.systemType,
		result,
		cs,
		csMermaid,
		impactMermaid,
		project: session.project,
	};

	const md = buildMarkdownReport(lastContext);

	await saveResultAsJSON(result, session.project);
	await saveMarkdownReport(md, session.project);
	await saveMermaidDiagrams(session.project, csMermaid, impactMermaid);
}

export const __test__ = {
	getGuidedDiagramPaths,
	readResultFromJson,
	loadGuidedDiagramsFromDisk,
	generateDiagramsForGuidedSession,
	getLastContext: () => lastContext,
	setLastContext: (ctx: typeof lastContext) => {
		lastContext = ctx;
	},
	runModel,
};

/** ===========================================================
 * Activate
 * =========================================================== */
export function activate(context: vscode.ExtensionContext) {
	console.log('stpa-ext: activate start');
	const extRoot = vscode.Uri.joinPath(context.extensionUri, '').fsPath;
	loadEnvFromExtension(extRoot);

	const chatProvider = new StpaChatViewProvider(context);
	let pendingSmartEditPlan: SmartEditPlan | null = null;
	const resetGuidedSessionState = () => {
		guidedSession = null;
		pendingJump = null;
		pendingSmartEditPlan = null;
		lastContext = null;
	};
	chatProvider.onResetRequest = resetGuidedSessionState;
	const sendGuidedStage = (stage: UiStage, ctx?: StageContext) => {
		chatProvider.sendToWebview({
			type: 'guidedActions',
			payload: buildStagePayload(stage, ctx),
		});
	};
	context.subscriptions.push(vscode.window.registerWebviewViewProvider(StpaChatViewProvider.viewId, chatProvider));

	// Open the STPA Agent view container on activation (so the chat is visible)
	vscode.commands.executeCommand('workbench.view.extension.stpaAgent');

	// Request an auto-clear for this activation run
	chatProvider.requestClearOnNextReady();

	const inlineDisp = registerInlineCompletion(() => process.env.OPENAI_API_KEY);
	context.subscriptions.push(inlineDisp);

	// ✅ Highlight newly added lines (green)
	const stpaAddedGreenDecoration = vscode.window.createTextEditorDecorationType({
		backgroundColor: 'rgba(0, 200, 0, 0.18)',
		border: '1px solid rgba(0, 200, 0, 0.35)',
		borderRadius: '4px',
		isWholeLine: true,
	});

	context.subscriptions.push(stpaAddedGreenDecoration);

	const applyGreenDecoration = (editor: vscode.TextEditor | undefined, ranges: vscode.Range[] | undefined) => {
		if (!editor || !ranges?.length) return;
		editor.setDecorations(stpaAddedGreenDecoration, ranges);
		setTimeout(() => {
			try {
				editor.setDecorations(stpaAddedGreenDecoration, []);
			} catch { }
		}, 12000);
	};


	/** --------------------------------------------
	 * Classic Analyze Current File
	 * -------------------------------------------- */
	const analyzeFileCmd = vscode.commands.registerCommand('stpa-agent.analyzeCurrentFile', async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			vscode.window.showErrorMessage('Missing OPENAI_API_KEY.');
			return;
		}

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('No open file to analyze.');
			return;
		}

		const text = editor.document.getText().trim();
		if (!text) {
			vscode.window.showInformationMessage('File is empty.');
			return;
		}

		const status = vscode.window.setStatusBarMessage(' STPA Agent: Running analysis...', 5000);

		try {
			const pre = validateInput(text);
			const out = vscode.window.createOutputChannel('STPA Agent');
			out.clear();
			out.appendLine(formatIssuesTable(pre));
			out.show(true);

			const decision = await promptOnIssues(pre);

			const runFull = async (srcText: string) => {
				const suggestedName = editor.document.fileName
					? path.basename(editor.document.fileName, path.extname(editor.document.fileName))
					: 'my-system';

				const project = await prepareProjectFolder(suggestedName);
				if (!project) return;

				const systemType = detectSystemType(srcText);
				const prompt = buildStpaPrompt({ systemType, text: srcText });
				const result = await runModel(apiKey, prompt);

				printToOutput(result);

				const cs = deriveControlStructFromText(srcText);
				const csMermaid = buildControlStructureMermaid(cs);
				const impactMermaid = buildImpactGraphMermaid(result);

				lastContext = { systemType, result, cs, csMermaid, impactMermaid, project };

				const md = buildMarkdownReport(lastContext);
				await saveResultAsJSON(result, project);
				await saveMarkdownReport(md, project);
				await saveMermaidDiagrams(project, csMermaid, impactMermaid);

				vscode.window.showInformationMessage(`Analysis completed for "${project.baseName}".`);
			};

			if (decision === 'autofix') {
				await generateAndInsertMissingSections({
					apiKey,
					editor,
					baseText: text,
					systemType: detectSystemType(text),
					issues: pre.issues,
				});

				const newText = editor.document.getText().trim();
				const pre2 = validateInput(newText);

				out.appendLine('\n--- Re-check after AI auto-complete ---');
				out.appendLine(formatIssuesTable(pre2));

				const proceed = pre2.issues.length === 0 ? 'continue' : await promptOnIssues(pre2);
				if (proceed !== 'continue') return;

				await runFull(newText);
				return;
			}

			if (decision === 'cancel') return;
			await runFull(text);
		} catch (err: any) {
			vscode.window.showErrorMessage(`Error running analysis: ${err?.message || err}`);
		} finally {
			status?.dispose();
		}
	});

	/** --------------------------------------------
	 * Classic Analyze Selection
	 * -------------------------------------------- */
	const analyzeSelectionCmd = vscode.commands.registerCommand('stpa-agent.analyzeSelection', async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			vscode.window.showErrorMessage('Missing OPENAI_API_KEY.');
			return;
		}

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('No editor is active.');
			return;
		}

		const selText = editor.document.getText(editor.selection).trim() || editor.document.getText().trim();
		if (!selText) {
			vscode.window.showInformationMessage('No text to analyze.');
			return;
		}

		const status = vscode.window.setStatusBarMessage(' STPA Agent: Running analysis on selection...', 5000);

		try {
			const pre = validateInput(selText);
			const out = vscode.window.createOutputChannel('STPA Agent');
			out.clear();
			out.appendLine(formatIssuesTable(pre));
			out.show(true);

			const decision = await promptOnIssues(pre);

			const runFull = async (srcText: string) => {
				const suggestedName = editor.document.fileName
					? path.basename(editor.document.fileName, path.extname(editor.document.fileName)) + '-selection'
					: 'selection';

				const project = await prepareProjectFolder(suggestedName);
				if (!project) return;

				const systemType = detectSystemType(srcText);
				const prompt = buildStpaPrompt({ systemType, text: srcText });
				const result = await runModel(apiKey, prompt);

				printToOutput(result);

				const cs = deriveControlStructFromText(srcText);
				const csMermaid = buildControlStructureMermaid(cs);
				const impactMermaid = buildImpactGraphMermaid(result);

				lastContext = { systemType, result, cs, csMermaid, impactMermaid, project };

				const md = buildMarkdownReport(lastContext);
				await saveResultAsJSON(result, project);
				await saveMarkdownReport(md, project);
				await saveMermaidDiagrams(project, csMermaid, impactMermaid);

				vscode.window.showInformationMessage(`Selection analysis completed for "${project.baseName}".`);
			};

			if (decision === 'autofix') {
				await generateAndInsertMissingSections({
					apiKey,
					editor,
					baseText: selText,
					systemType: detectSystemType(selText),
					issues: pre.issues,
				});

				const newSelText = editor.document.getText(editor.selection).trim() || editor.document.getText().trim();
				const pre2 = validateInput(newSelText);

				out.appendLine('\n--- Re-check after AI auto-complete ---');
				out.appendLine(formatIssuesTable(pre2));

				const proceed = pre2.issues.length === 0 ? 'continue' : await promptOnIssues(pre2);
				if (proceed !== 'continue') return;

				await runFull(newSelText);
				return;
			}

			if (decision === 'cancel') return;
			await runFull(selText);
		} catch (err: any) {
			vscode.window.showErrorMessage(`Error analyzing selection: ${err?.message || err}`);
		} finally {
			status?.dispose();
		}
	});

	/** --------------------------------------------
	 * Preview Diagrams (classic)
	 * -------------------------------------------- */
	const previewDiagCmd = vscode.commands.registerCommand('stpa-agent.previewDiagrams', async () => {
		if (guidedSession && guidedSession.currentStep < 2) {
			chatProvider.sendToWebview({
				type: 'infoMessage',
				payload: { text: 'Diagrams are available after Step 2 (Control Structure) is completed.' },
			});
			return;
		}
		if (!lastContext) {
			chatProvider.sendToWebview({
				type: 'infoMessage',
				payload: { text: 'No diagrams yet. Complete Step 2 to generate diagrams.' },
			});
			return;
		}

		const csRaw = stripCodeFence(lastContext.csMermaid);
		const impRaw = stripCodeFence(lastContext.impactMermaid);

		const panel = vscode.window.createWebviewPanel('stpaDiag', 'STPA Diagrams', vscode.ViewColumn.Beside, { enableScripts: true });

		panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"/><style>
  :root { --zoom: 1; }
  body{font-family:var(--vscode-font-family); padding:12px}
  h2{margin:16px 0 8px}
  .toolbar{display:flex;gap:8px;align-items:center;margin:6px 0 12px}
  .wrap{
    border:1px solid var(--vscode-editorGroup-border);
    border-radius:8px;
    overflow:auto;
    width:100%;
    height:40vh;
    background:var(--vscode-editor-background);
    padding:8px;
  }
  .wrap.second{height:48vh;}
  .wrap svg{
    width:auto !important;
    height:auto !important;
    transform: scale(var(--zoom));
    transform-origin: top left;
  }
  button{
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; border-radius:6px; padding:4px 10px; cursor:pointer;
  }
  button:hover{ background: var(--vscode-button-hoverBackground); }
  .zoomVal{opacity:.7}
</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
<script>
  mermaid.initialize({
    startOnLoad: true,
    securityLevel: 'loose',
    flowchart: { useMaxWidth: false }
  });
  let zoom = 1;
  function setZoom(z){
    zoom = Math.max(0.25, Math.min(3, z));
    document.documentElement.style.setProperty('--zoom', zoom);
    const el = document.getElementById('zoomVal');
    if (el) el.textContent = Math.round(zoom*100) + '%';
  }
  function zoomIn(){ setZoom(zoom + 0.1); }
  function zoomOut(){ setZoom(zoom - 0.1); }
  function zoomReset(){ setZoom(1); }
  window.addEventListener('load', () => setZoom(1));
</script>
</head>
<body>
  <h2>Control Structure</h2>
  <div class="toolbar">
    <button onclick="zoomOut()">−</button>
    <button onclick="zoomReset()">100%</button>
    <button onclick="zoomIn()">+</button>
    <span class="zoomVal" id="zoomVal">100%</span>
  </div>
  <div class="wrap">
    <div class="mermaid">${csRaw || 'graph TD\\nA[No data]-->B[Run Analyze]'}</div>
  </div>

  <h2>UCA → Hazard → Loss</h2>
  <div class="wrap second">
    <div class="mermaid">${impRaw || 'graph LR\\nA[No data]-->B[Run Analyze]'}</div>
  </div>
</body></html>`;
	});

	/** --------------------------------------------
	 * Smart Edit command (shared)
	 * -------------------------------------------- */

	const smartEditCmd = vscode.commands.registerCommand(
		'stpa-agent.smartEdit',
		async (instruction?: string) => {
			try {
				if (!instruction || !instruction.trim()) {
					return 'No instruction provided.';
				}

				const scope: EditScope | undefined = guidedSession
					? {
						step: guidedSession.currentStep,
						allowedSections:
							guidedSession.currentStep === 1
								? ['LOSSES', 'HAZARDS', 'SAFETY_CONSTRAINTS', 'REFINED_HAZARDS']
								: guidedSession.currentStep === 2
									? [
										'CONTROLLERS',
										'CONTROLLED_PROCESSES',
										'ACTUATORS',
										'SENSORS',
										'EXTERNAL_SYSTEMS',
										'CONTROL_ACTIONS',
										'FEEDBACK',
										'CONTROL_LOOPS',
									]
									: guidedSession.currentStep === 3
										? ['UCAS']
										: ['LOSS_SCENARIOS'],
					}
					: undefined;

				const { applied, ranges, plan } = await smartEditFromChat(
					instruction,
					undefined,
					scope
				);

				const editor = vscode.window.activeTextEditor;
				applyGreenDecoration(editor, ranges);
				const savePromise = editor && ranges?.length ? editor.document.save() : undefined;

				if (guidedSession) {
					const stage: UiStage =
						guidedSession.currentStep === 1
							? 'afterStep1'
							: guidedSession.currentStep === 2
								? 'afterStep2'
								: guidedSession.currentStep === 3
									? 'afterStep3'
									: 'afterStep4';

					sendGuidedStage(stage);
				}

				if (plan?.actions?.length) {
					pendingSmartEditPlan = plan;
					chatProvider.sendToWebview({
						type: 'showSmartEditPlan',
						payload: plan,
					});
				}

				let summary =
					`Smart edit applied ${applied.length} change(s):\n` +
					applied.join('\n');

				if (plan?.actions?.length) {
					summary +=
						`\n\nSuggested follow-up fixes are ready (` +
						`${plan.actions.length}). Review and apply them from the chat.`;
				}

				if (savePromise) {
					await savePromise;
				}

				return summary;
			} catch (e: any) {
				vscode.window.showErrorMessage(
					`Smart edit failed: ${e?.message || e}`
				);

				// ⛔️ אין פה יותר שליחת guidedActions
				// ⛔️ אין פה יותר showSmartEditPlan

				return `Smart edit failed: ${e?.message || e}`;
			}
		}
	);

	/** --------------------------------------------
	 * Apply / discard the pending Smart Edit plan
	 * -------------------------------------------- */
	const applySmartEditPlanCmd = vscode.commands.registerCommand('stpa-agent.smartEdit.applyPlan', async (planId?: string) => {
		try {
			if (!pendingSmartEditPlan) return 'No pending plan to apply.';
			if (planId && pendingSmartEditPlan.id !== planId) return 'The pending plan ID does not match.';

			const { applied, ranges } = await applySmartEditPlan(pendingSmartEditPlan);
			pendingSmartEditPlan = null;

			const editor = vscode.window.activeTextEditor;
			applyGreenDecoration(editor, ranges);
			const savePromise = editor && ranges?.length ? editor.document.save() : undefined;

			const summary = `Applied ${applied.length} follow-up change(s):\n` + applied.join('\n');
			chatProvider.sendToWebview({ type: 'append', payload: { role: 'assistant', content: summary } });
			if (savePromise) {
				await savePromise;
			}
			return summary;
		} catch (e: any) {
			vscode.window.showErrorMessage(`Apply plan failed: ${e?.message || e}`);
			return `Apply plan failed: ${e?.message || e}`;
		}
	});

	const discardSmartEditPlanCmd = vscode.commands.registerCommand('stpa-agent.smartEdit.discardPlan', async (planId?: string) => {
		if (!pendingSmartEditPlan) return 'No pending plan to discard.';
		if (planId && pendingSmartEditPlan.id !== planId) return 'The pending plan ID does not match.';
		pendingSmartEditPlan = null;
		return 'Pending plan discarded.';
	});

	/** ===========================================================
	 * Guided STPA commands
	 * =========================================================== */

	const jumpStep1Cmd = vscode.commands.registerCommand('stpa-agent.guided.jump.step1', async () => {
		await vscode.commands.executeCommand('stpa-agent.guided.jumpInit', 1);
	});
	const jumpStep2Cmd = vscode.commands.registerCommand('stpa-agent.guided.jump.step2', async () => {
		await vscode.commands.executeCommand('stpa-agent.guided.jumpInit', 2);
	});
	const jumpStep3Cmd = vscode.commands.registerCommand('stpa-agent.guided.jump.step3', async () => {
		await vscode.commands.executeCommand('stpa-agent.guided.jumpInit', 3);
	});
	const jumpStep4Cmd = vscode.commands.registerCommand('stpa-agent.guided.jump.step4', async () => {
		await vscode.commands.executeCommand('stpa-agent.guided.jumpInit', 4);
	});


	const guidedStartStep1Cmd = vscode.commands.registerCommand('stpa-agent.guided.startStep1', async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			chatProvider.sendToWebview({ type: 'toast', payload: 'Missing OPENAI_API_KEY' });
			return;
		}

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			chatProvider.sendToWebview({ type: 'toast', payload: 'Open a system description file to start Step 1.' });
			return;
		}

		const systemText = editor.document.getText().trim();
		if (!systemText) {
			chatProvider.sendToWebview({ type: 'toast', payload: 'System description file is empty.' });
			return;
		}

		const suggestedName = path.basename(editor.document.fileName, path.extname(editor.document.fileName));
		const project = await prepareProjectFolder(suggestedName);
		if (!project) return;

		const systemType = detectSystemType(systemText);
		const guidedPath = path.join(project.dir, `${project.baseName}_guided.md`);

		guidedSession = {
			project,
			systemText,
			systemType,
			currentStep: 1,
			guidedPath,
		};

		chatProvider.sendToWebview({ type: 'busy', payload: true });

		try {
			const step1Text = await runStepText(apiKey, buildStep1Prompt(systemText, systemType));
			guidedSession.step1Text = step1Text;

			await writeGuidedFile(guidedSession);
			await openGuidedInEditor(guidedSession);

			chatProvider.sendToWebview({
				type: 'append',
				payload: { role: 'system', text: `Step 1 completed and saved to ${project.baseName}_guided.md` },
			});

			sendGuidedStage('afterStep1');
		} catch (e: any) {
			chatProvider.sendToWebview({ type: 'toast', payload: `Step 1 failed: ${e?.message || e}` });
		} finally {
			chatProvider.sendToWebview({ type: 'busy', payload: false });
		}
	});
	const guidedContinueStep2Cmd = vscode.commands.registerCommand('stpa-agent.guided.continueStep2', async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey || !guidedSession) return;

		chatProvider.sendToWebview({ type: 'busy', payload: true });

		try {
			if (!guidedSession.step1Text) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'Step 1 data missing.' });
				return;
			}

			const step2Text = await runStepText(
				apiKey,
				buildStep2Prompt(guidedSession.systemText, guidedSession.systemType, guidedSession.step1Text)
			);

			guidedSession.step2Text = step2Text;
			guidedSession.currentStep = 2;

			await writeGuidedFile(guidedSession);
			await openGuidedInEditor(guidedSession);

			chatProvider.sendToWebview({
				type: 'append',
				payload: { role: 'system', text: `Step 2 completed and appended to guided file.` },
			});

			sendGuidedStage('afterStep2');
		} catch (e: any) {
			chatProvider.sendToWebview({ type: 'toast', payload: `Step 2 failed: ${e?.message || e}` });
		} finally {
			chatProvider.sendToWebview({ type: 'busy', payload: false });
		}
	});

	const guidedContinueStep3Cmd = vscode.commands.registerCommand('stpa-agent.guided.continueStep3', async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey || !guidedSession) return;

		chatProvider.sendToWebview({ type: 'busy', payload: true });

		try {
			if (!guidedSession.step1Text || !guidedSession.step2Text) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'Step 1/2 data missing.' });
				return;
			}

			try {
				const hasDiagrams = loadGuidedDiagramsFromDisk(guidedSession);
				if (!hasDiagrams) {
					await generateDiagramsForGuidedSession(apiKey, guidedSession);
				}
			} catch (e: any) {
				chatProvider.sendToWebview({
					type: 'toast',
					payload: `Diagram generation after Step 2 failed: ${e?.message || e}`,
				});
			}

			const step3Text = await runStepText(
				apiKey,
				buildStep3Prompt(
					guidedSession.systemText,
					guidedSession.systemType,
					guidedSession.step1Text,
					guidedSession.step2Text
				)
			);

			guidedSession.step3Text = step3Text;
			guidedSession.currentStep = 3;

			await writeGuidedFile(guidedSession);
			await openGuidedInEditor(guidedSession);

			chatProvider.sendToWebview({
				type: 'append',
				payload: { role: 'system', text: `Step 3 completed and appended to guided file.` },
			});

			sendGuidedStage('afterStep3');
		} catch (e: any) {
			chatProvider.sendToWebview({ type: 'toast', payload: `Step 3 failed: ${e?.message || e}` });
		} finally {
			chatProvider.sendToWebview({ type: 'busy', payload: false });
		}
	});

	const guidedContinueStep4Cmd = vscode.commands.registerCommand('stpa-agent.guided.continueStep4', async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey || !guidedSession) return;

		chatProvider.sendToWebview({ type: 'busy', payload: true });

		try {
			if (!guidedSession.step1Text || !guidedSession.step2Text || !guidedSession.step3Text) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'Step 1/2/3 data missing.' });
				return;
			}

			const step4Text = await runStepText(
				apiKey,
				buildStep4Prompt(
					guidedSession.systemText,
					guidedSession.systemType,
					guidedSession.step1Text,
					guidedSession.step2Text,
					guidedSession.step3Text
				)
			);

			guidedSession.step4Text = step4Text;
			guidedSession.currentStep = 4;

			await writeGuidedFile(guidedSession);
			await openGuidedInEditor(guidedSession);

			chatProvider.sendToWebview({
				type: 'append',
				payload: { role: 'system', text: `Step 4 completed and appended to guided file.` },
			});

			sendGuidedStage('afterStep4');
		} catch (e: any) {
			chatProvider.sendToWebview({ type: 'toast', payload: `Step 4 failed: ${e?.message || e}` });
		} finally {
			chatProvider.sendToWebview({ type: 'busy', payload: false });
		}
	});

	const guidedEditMessages: Record<number, string> = {
		1: `Guided file opened. Edit Step 1 in chat (e.g., "add L5: ...", "remove L2", "add H7: ...").`,
		2: `Guided file opened. Edit Step 2 in chat (e.g., "add CA6: ...", "remove CA2", "add Feedback3: ...", "add Loop2: ...").`,
		3: `Guided file opened. Edit Step 3 in chat (e.g., "add UCA9: ...", "remove UCA3", "update UCA2: ...").`,
		4: `Guided file opened. Edit Step 4 in chat (e.g., "add CS5: ...", "remove CS2", "update CS1: ...").`,
	};

	const guidedEditCurrentCmd = vscode.commands.registerCommand('stpa-agent.guided.editCurrentStep', async () => {
		if (!guidedSession) {
			chatProvider.sendToWebview({ type: 'toast', payload: 'No guided session found.' });
			return;
		}

		await openGuidedInEditor(guidedSession);

		const editMessage =
			guidedEditMessages[guidedSession.currentStep] ??
			`Guided file opened. Add your edits in chat (e.g., "add L5", "remove H2", "add UCA9").`;

		chatProvider.sendToWebview({
			type: 'append',
			payload: {
				role: 'system',
				text: editMessage,
			},
		});

		const stage: UiStage =
			guidedSession.currentStep === 1
				? 'afterStep1'
				: guidedSession.currentStep === 2
					? 'afterStep2'
					: guidedSession.currentStep === 3
						? 'afterStep3'
						: 'afterStep4';

		sendGuidedStage(stage);
	});

	const guidedGenerateDiagramsCmd = vscode.commands.registerCommand('stpa-agent.guided.generateDiagrams', async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey || !guidedSession) return;

		chatProvider.sendToWebview({ type: 'busy', payload: true });

		try {
			const hasDiagrams = loadGuidedDiagramsFromDisk(guidedSession);
			if (!hasDiagrams) {
				await generateDiagramsForGuidedSession(apiKey, guidedSession);
			}

			chatProvider.sendToWebview({
				type: 'append',
				payload: {
					role: 'system',
					text: `Diagrams + report + JSON generated under stpa_results/${guidedSession.project.baseName}.`,
				},
			});

			await vscode.commands.executeCommand('stpa-agent.previewDiagrams');
		} catch (e: any) {
			chatProvider.sendToWebview({ type: 'toast', payload: `Diagram generation failed: ${e?.message || e}` });
		} finally {
			chatProvider.sendToWebview({ type: 'busy', payload: false });
		}
	});

	const guidedJumpInitCmd = vscode.commands.registerCommand(
		'stpa-agent.guided.jumpInit',
		async (targetStep: GuidedStep) => {
			const apiKey = process.env.OPENAI_API_KEY;
			if (!apiKey) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'Missing OPENAI_API_KEY' });
				return;
			}

			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'Open a system description file first.' });
				return;
			}

			const systemText = editor.document.getText().trim();
			if (!systemText) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'System description file is empty.' });
				return;
			}

			const systemType = detectSystemType(systemText);

			if (targetStep === 1) {
				await vscode.commands.executeCommand('stpa-agent.guided.startStep1');
				return;
			}

			pendingJump = { targetStep, systemText, systemType };

			chatProvider.sendToWebview({
				type: 'append',
				payload: {
					role: 'system',
					text:
						`To jump to Step ${targetStep}: open your guided .md file (with previous steps) in the editor, then click "Confirm guided file".`,
				},
			});

			sendGuidedStage('confirmJumpGuidedFile', { targetStep });
		}
	);
	const guidedJumpConfirmCmd = vscode.commands.registerCommand(
		'stpa-agent.guided.jumpConfirm',
		async () => {
			const apiKey = process.env.OPENAI_API_KEY;
			if (!apiKey) return;

			if (!pendingJump) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'No pending jump request.' });
				return;
			}

			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'Open the guided .md file first.' });
				return;
			}

			const guidedText = editor.document.getText().trim();
			if (!guidedText) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'Guided file is empty.' });
				return;
			}

			// // צריך לוודא שקיימים השלבים הקודמים
			// const need1 = pendingJump.targetStep >= 2;
			// const need2 = pendingJump.targetStep >= 3;
			// const need3 = pendingJump.targetStep >= 4;

			// if (need1 && !hasStep(guidedText, 1)) {
			// 	chatProvider.sendToWebview({ type: 'toast', payload: 'Step 1 not found in the guided file.' });
			// 	return;
			// }
			// if (need2 && !hasStep(guidedText, 2)) {
			// 	chatProvider.sendToWebview({ type: 'toast', payload: 'Step 2 not found in the guided file.' });
			// 	return;
			// }
			// if (need3 && !hasStep(guidedText, 3)) {
			// 	chatProvider.sendToWebview({ type: 'toast', payload: 'Step 3 not found in the guided file.' });
			// 	return;
			// }

			// Ensure previous steps exist; if not, offer options instead of failing hard.
			const required: GuidedStep[] = [];
			if (pendingJump.targetStep >= 2) required.push(1 as GuidedStep);
			if (pendingJump.targetStep >= 3) required.push(2 as GuidedStep);
			if (pendingJump.targetStep >= 4) required.push(3 as GuidedStep);


			let missingStep: number | null = null;
			let lastFound: number | null = null;

			for (const s of required) {
				if (!hasStep(guidedText, s)) {
					missingStep = s;
					break;
				}
				lastFound = s;
			}

			if (missingStep !== null) {
				const target = pendingJump.targetStep;
				const lf = lastFound ?? 0;

				chatProvider.sendToWebview({
					type: 'append',
					payload: {
						role: 'system',
						text:
							`Missing Step ${missingStep}. To jump to Step ${target}, the guided file must contain Steps 1..${target - 1}. ` +
							(lf > 0 ? `Last found step: ${lf}.` : 'No previous steps were found.'),
					},
				});

				sendGuidedStage('jumpMissingSteps', { missingStep, targetStep: target, lastFound: lf });

				return;
			}


			// Build guidedSession from file + systemText
			const step1Text = extractStepBlock(guidedText, 1) || undefined;
			const step2Text = extractStepBlock(guidedText, 2) || undefined;
			const step3Text = extractStepBlock(guidedText, 3) || undefined;
			const step4Text = extractStepBlock(guidedText, 4) || undefined;

			// ננסה להסיק project + guidedPath בצורה הכי בטוחה שיש לנו:
			const guidedPath = editor.document.uri.fsPath;
			const baseName = path.basename(guidedPath, path.extname(guidedPath)).replace(/_guided$/i, '') || 'stpa-project';
			const projectDir = path.dirname(guidedPath);
			const project: ProjectInfo = { dir: projectDir, baseName };

			guidedSession = {
				project,
				systemText: pendingJump.systemText,
				systemType: pendingJump.systemType,
				currentStep: pendingJump.targetStep,
				guidedPath,
				step1Text,
				step2Text,
				step3Text,
				step4Text,
			};



			const target = pendingJump.targetStep;

			// If target step already exists, do NOT regenerate/continue.
			if (hasStep(guidedText, target as GuidedStep)) {
				guidedSession.currentStep = target as GuidedStep;
				chatProvider.sendToWebview({
					type: 'append',
					payload: {
						role: 'assistant',
						text: `Step ${target} already exists in the guided file. What would you like to do?`,
					},
				});
				sendGuidedStage('jumpTargetExists', { targetStep: target });
				return;
			}
			pendingJump = null;


			// עכשיו מריצים את ההמשך הרגיל
			if (target === 2) await vscode.commands.executeCommand('stpa-agent.guided.continueStep2');
			if (target === 3) await vscode.commands.executeCommand('stpa-agent.guided.continueStep3');
			if (target === 4) await vscode.commands.executeCommand('stpa-agent.guided.continueStep4');

			// // If the target step already exists in the guided file, offer options instead of regenerating.
			// if (hasStep(guidedText, target as GuidedStep)) {
			// 	chatProvider.sendToWebview({
			// 		type: 'append',
			// 		payload: {
			// 			role: 'assistant',
			// 			text: `Step ${target} already exists in the guided file. What would you like to do?`,
			// 		},
			// 	});

			// 	chatProvider.sendToWebview({
			// 		type: 'guidedActions',
			// 		payload: { stage: 'jumpTargetExists', targetStep: target },
			// 	});

			// 	return;
			// }

		}
	);

	const guidedJumpContinueMissingCmd = vscode.commands.registerCommand(
		'stpa-agent.guided.jumpContinueMissing',
		async (missingStep: number) => {
			if (!pendingJump) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'No pending jump request.' });
				return;
			}

			// We keep pendingJump so user can still aim for the original target after continuing.
			if (missingStep === 1) return vscode.commands.executeCommand('stpa-agent.guided.startStep1');
			if (missingStep === 2) return vscode.commands.executeCommand('stpa-agent.guided.continueStep2');
			if (missingStep === 3) return vscode.commands.executeCommand('stpa-agent.guided.continueStep3');
			if (missingStep === 4) return vscode.commands.executeCommand('stpa-agent.guided.continueStep4');
		}
	);


	const guidedOpenStepInFileCmd = vscode.commands.registerCommand(
		'stpa-agent.guided.openStepInGuidedFile',
		async (targetStep: GuidedStep) => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'Open the guided .md file first.' });
				return;
			}

			const text = editor.document.getText();
			const heading = `## Step ${targetStep}`;
			const idx = text.indexOf(heading);
			if (idx < 0) {
				chatProvider.sendToWebview({ type: 'toast', payload: `Step ${targetStep} not found in the guided file.` });
				return;
			}

			const pos = editor.document.positionAt(idx);
			editor.selection = new vscode.Selection(pos, pos);
			editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
		}
	);

	const guidedJumpEditTargetStepCmd = vscode.commands.registerCommand(
		'stpa-agent.guided.jumpEditTargetStep',
		async (targetStep: GuidedStep) => {
			if (!guidedSession) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'No active guided session.' });
				return;
			}

			guidedSession.currentStep = targetStep;

			// Run the same edit command you use in the normal flow
			await vscode.commands.executeCommand('stpa-agent.guided.editCurrentStep');

			// Ensure the usual "afterStepX" buttons appear (same as normal flow)
			const stage: UiStage = `afterStep${targetStep}` as UiStage;
			sendGuidedStage(stage);
		}
	);

	const guidedRefreshActionsCmd = vscode.commands.registerCommand('stpa-agent.guided.refreshActions', async () => {
		if (!guidedSession) return;

		const stage =
			guidedSession.currentStep === 1
				? 'afterStep1'
				: guidedSession.currentStep === 2
					? 'afterStep2'
					: guidedSession.currentStep === 3
						? 'afterStep3'
						: 'afterStep4';

		sendGuidedStage(stage);

		// אם יש plan תלוי – להציג שוב (כדי לא להיתקע בלי כפתורים שלו)
		if (pendingSmartEditPlan && pendingSmartEditPlan.actions?.length) {
			chatProvider.sendToWebview({ type: 'showSmartEditPlan', payload: pendingSmartEditPlan });
		}
	});




	// const guidedJumpCmd = vscode.commands.registerCommand('stpa-agent.guided.jumpToStep', async () => {
	// 	const hasSession = !!guidedSession;

	// 	const current = guidedSession?.currentStep; // undefined if no session

	// 	const items: vscode.QuickPickItem[] = [
	// 		{ label: 'Step 1', description: 'Define purpose of analysis' },
	// 		{ label: 'Step 2', description: 'Model the control structure (needs Step 1)' },
	// 		{ label: 'Step 3', description: 'Identify unsafe control actions (needs Step 1–2)' },
	// 		{ label: 'Step 4', description: 'Identify loss scenarios (needs Step 1–3)' },
	// 	];

	// 	const picked = await vscode.window.showQuickPick(items, {
	// 		title: hasSession ? `Jump to step (current: Step ${current})` : 'Jump to step (no guided session yet)',
	// 		placeHolder: 'Choose which STPA step to jump to',
	// 		ignoreFocusOut: true,
	// 	});

	// 	if (!picked) return;

	// 	const targetStep =
	// 		picked.label === 'Step 1' ? 1 :
	// 			picked.label === 'Step 2' ? 2 :
	// 				picked.label === 'Step 3' ? 3 : 4;

	// 	// כרגע רק לוג/הודעה — את הבדיקות והקפיצה האמיתית נעשה בשלב הבא
	// 	chatProvider.sendToWebview({
	// 		type: 'append',
	// 		payload: { role: 'system', text: `Jump requested: Step ${targetStep} (current: ${hasSession ? 'Step ' + current : 'none'})` },
	// 	});
	// });





	// Explain current step (English)


	const guidedExplainCmd = vscode.commands.registerCommand('stpa-agent.guided.explainCurrentStep', async () => {
		// If no guided session yet → short STPA intro + how to start
		if (!guidedSession) {
			chatProvider.sendToWebview({
				type: 'append',
				payload: {
					role: 'assistant',
					text:
						`STPA (Systems-Theoretic Process Analysis) is a step-by-step safety analysis method.\n\n` +
						`To start the guided flow:\n` +
						`1) Open your system description file in the editor.\n` +
						`2) Click “Start guided STPA (Step 1)”.\n` +
						`3) Choose a project name when asked.\n\n` +
						`Then I will generate Step 1 and offer buttons to continue to the next steps.`,
				},
			});
			return;
		}

		const step = guidedSession.currentStep;

		const explainByStep: Record<number, string> = {
			1:
				`Step 1 (Define the purpose of the analysis):\n` +
				`- Identify unacceptable losses (what must be prevented).\n` +
				`- Identify system-level hazards that could lead to those losses.\n` +
				`- Define system-level safety constraints that prevent hazards.\n` +
				`This step sets the scope and the safety goals for everything that follows.`,
			2:
				`Step 2 (Model the control structure):\n` +
				`- Identify controllers, controlled processes, actuators, sensors, human operators, and interfaces.\n` +
				`- Describe control actions and feedback paths.\n` +
				`This creates the control model needed to reason about unsafe control actions.`,
			3:
				`Step 3 (Identify Unsafe Control Actions - UCAs):\n` +
				`- Find control actions that can be unsafe in context.\n` +
				`- Consider: not providing an action when needed, providing an unsafe action, wrong timing/order, or stopping too soon/applying too long.\n` +
				`UCAs connect the control structure to hazards.`,
			4:
				`Step 4 (Identify loss scenarios / causal factors):\n` +
				`- Explain how causal factors (human, software, sensors, actuators, communication, process model flaws, environment) can lead to UCAs and hazards.\n` +
				`This step produces concrete scenarios that you can mitigate via requirements, constraints, design changes, and procedures.`,
		};

		chatProvider.sendToWebview({
			type: 'append',
			payload: { role: 'assistant', text: explainByStep[step] ?? `You are currently in Step ${step}.` },
		});
	});

	// Register
	context.subscriptions.push(
		analyzeFileCmd,
		analyzeSelectionCmd,
		previewDiagCmd,
		smartEditCmd,
		applySmartEditPlanCmd,
		discardSmartEditPlanCmd,


		guidedStartStep1Cmd,
		guidedContinueStep2Cmd,
		guidedContinueStep3Cmd,
		guidedContinueStep4Cmd,
		guidedEditCurrentCmd,
		guidedGenerateDiagramsCmd,
		guidedJumpInitCmd,
		guidedJumpConfirmCmd,
		jumpStep1Cmd,
		jumpStep2Cmd,
		jumpStep3Cmd,
		jumpStep4Cmd,
		guidedExplainCmd,
		guidedJumpContinueMissingCmd,
		inlineDisp,
		guidedOpenStepInFileCmd,
		guidedJumpEditTargetStepCmd,
		guidedRefreshActionsCmd,

	);
	console.log('stpa-ext: activate end');
}

export function deactivate() { }
