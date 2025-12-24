// -------------------------------
// STPA Agent - VS Code Extension
// Main file (guided + classic flows)
// -------------------------------

import * as vscode from 'vscode';
import OpenAI from 'openai';
import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';

// UI
import { StpaChatViewProvider } from './chatView';

// internal
import { validateInput, formatIssuesTable, promptOnIssues } from './validator';
import { generateAndInsertMissingSections } from './aiQuickFix';
import { registerInlineCompletion } from './inlineCompletion';
import { applySmartEditPlan, smartEditFromChat, type SmartEditPlan } from './aiEdit';

// tables + diagrams + cs extract
import { buildMarkdownTables } from './tables';
import { buildControlStructureMermaid, buildImpactGraphMermaid } from './diagrams';
import { deriveControlStructFromText } from './csExtract';
import type { SystemType, StpaResult, ControlStructInput } from './types';

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
function buildStep1Prompt(systemText: string, systemType: SystemType): string {
	return [
		'You are an expert safety engineer performing Systems-Theoretic Process Analysis (STPA).',
		'',
		'Perform STPA Step 1: Define the purpose of the analysis.',
		'Reference: STPA Handbook (Nancy Leveson), Chapter 2, Step 1, p.15.',
		'',
		'STEP 1 MUST PRODUCE:',
		'1) Unacceptable losses (L#)',
		'2) System-level hazards (H#) mapped ONLY to losses',
		'3) System-level safety constraints (SC#) mapped ONLY to hazards',
		'4) Exactly one refinement entry for EACH hazard (context only; no causes)',
		'',
		'MANDATORY DEFINITIONS:',
		'- Loss (L): an unacceptable outcome or harm to people, mission, property, environment, or public trust.',
		'- Hazard (H): a SYSTEM STATE or SET OF CONDITIONS that, with worst-case environmental conditions, will lead to one or more losses.',
		'- Safety Constraint (SC): a system-level requirement/restriction that prevents or mitigates a hazard.',
		'- Hazard Refinement: operational context clarification ONLY (ODD, assumptions, worst-case conditions) WITHOUT causes, failures, control actions, UCAs, scenarios, sensors, software, or performance.',
		'',
		'====================',
		'HAZARDS: STRICT RULES',
		'====================',
		'Hazards MUST describe ONLY an externally observable unsafe system/vehicle state (WHAT, not WHY).',
		'',
		'FORBIDDEN HAZARD FORMS (MUST NOT APPEAR):',
		'- "is in a state where"',
		'- "is in a condition where"',
		'- "is in a situation where"',
		'',
		'FORBIDDEN WORDS/CONCEPTS IN HAZARDS (rewrite until none appear):',
		'- failure / fails / failed',
		'- delay / delayed / late',
		'- insufficient / inadequate / ineffective',
		'- detect / detected / detection / misinterpret / misjudgment',
		'- performance / degradation / reliability',
		'- sensor / software / algorithm / controller / integration / communication / network',
		'- causal wording: because, due to, caused by, results from',
		'',
		'MANDATORY HAZARD SENTENCE FORM (MUST MATCH EXACTLY):',
		'"The vehicle or system <ALLOWED_DANGEROUS_STATE_PHRASE> while <operational context>."',
		'',
		'ALLOWED_DANGEROUS_STATE_PHRASES (COPY VERBATIM; USE ONLY THESE):',
		'- remains on a collision trajectory',
		'- collision risk exists',
		'- enters a loss-of-control or unstable state',
		'- applies emergency braking when no collision threat exists',
		'- does not apply emergency braking when a collision threat exists',
		'- does not warn the driver during an imminent collision situation',
		'',
		'HAZARD GRAMMAR RULE (MANDATORY):',
		'- After "The vehicle or system" you MUST paste ONE allowed phrase exactly as written above (no extra words).',
		'- Example for "collision risk exists":',
		'  "The vehicle or system collision risk exists while <context>."',
		'',
		'IMPORTANT (HUMAN CONTEXT PLACEMENT):',
		'- Do NOT use driver internal state (e.g., "driver distracted") inside Hazards.',
		'- If relevant, include such human context ONLY in the corresponding hazard refinement line.',
		'',
		'================================',
		'SAFETY CONSTRAINTS: STRICT RULES',
		'================================',
		'Constraints MUST be system-level "shall/shall not" requirements that directly prevent/mitigate the referenced hazard(s).',
		'Constraints MUST NOT be design/architecture solutions.',
		'',
		'FORBIDDEN WORDS/CONCEPTS IN SAFETY CONSTRAINTS (MUST NOT APPEAR):',
		'- detect / detected / detection',
		'- false positive(s) / false negative(s)',
		'- sensor / software / algorithm / controller / integration / integrate / interface / communication / network / ADAS',
		'- performance / reliability / robust / effectively / appropriate / optimize / minimize / maximize',
		'- accurate / accurately / assessment / assessed',
		'',
		'FORBIDDEN EXAMPLES (SC) — MUST REWRITE IF PRESENT:',
		'- INCORRECT: "when an obstacle is detected", "operate effectively", "integrate with ADAS", "assessed accurately"',
		'- CORRECT: "while approaching a stationary object", "under low light and adverse weather within the defined operating domain"',
		'',
		'CONSTRAINT OBSERVABILITY RULE (MANDATORY):',
		'- Each SC must state an observable required/forbidden behavior at the vehicle/system level.',
		'- Do NOT specify internal qualities (accuracy, assessment quality, performance, detection quality).',
		'',
		'CONSTRAINT-TO-HAZARD MATCH RULE (MANDATORY):',
		'- If a hazard uses the phrase "does not warn the driver...", the addressing constraints MUST require warning behavior.',
		'- For all other hazards, constraints MUST be phrased as prevention/mitigation of the hazardous state (avoid "provide warnings" as the primary constraint unless the hazard is warning-related).',
		'',
		'SAFETY CONSTRAINT COUNT RULE (MANDATORY):',
		'- You MUST output at least 8 safety constraints: SC1..SC8 (or more).',
		'',
		'HARD FAIL RULE:',
		'- If ANY forbidden word appears in ANY safety constraint, you MUST rewrite that constraint BEFORE returning the final output.',
		'',
		'====================',
		'TRACEABILITY CHECKS',
		'====================',
		'- Every hazard MUST map ONLY to Loss IDs using: (leads_to: L#, L#...).',
		'- Every constraint MUST map ONLY to Hazard IDs using: (addresses: H#, H#...).',
		'- Hazards MUST NOT map to hazards.',
		'',
		'LOSS COVERAGE RULE (MANDATORY):',
		'- Every Loss Li listed MUST appear in at least one hazard (leads_to: ... Li ...).',
		'- If a Loss cannot be linked to any hazard, you MUST NOT keep it as a Loss.',
		'  Instead, move it into "=== MISSING INFORMATION ===" as a question/assumption issue, OR rewrite hazards to include it correctly.',
		'',
		'============================',
		'COMPLETENESS (MINIMUMS)',
		'============================',
		'- Losses: at least 5 (add more if needed, but obey LOSS COVERAGE RULE).',
		'- Hazards: at least 6 (add more if needed).',
		'- Safety Constraints: at least 8 (add more if needed).',
		'- Refinements: exactly one refinement line for EACH hazard listed.',
		'',
		'===========================',
		'REFINED HAZARDS: STYLE RULE',
		'===========================',
		'- Each refinement must be a short ODD + worst-case context statement.',
		'- Do NOT include causes, failures, internal mechanisms, sensors, software, or performance.',
		'- Avoid "in a situation/scenario where"; use direct context phrasing (approaching..., with..., during...).',
		'',
		'===========================',
		'SUMMARY TABLE: DERIVED RULES',
		'===========================',
		'The summary table MUST be derived from your mappings (no invention):',
		'',
		'SUMMARY TABLE BUILD ALGORITHM (MANDATORY):',
		'1) For each loss Li, scan all hazards and collect ALL Hj that list Li in (leads_to).',
		'2) For that Li, scan all constraints and collect ALL SCk that address ANY of those Hj.',
		'3) Write the row using exactly those sets (no omissions, no extras).',
		'4) If any row violates steps 1–3, you MUST fix the table (or mappings) before returning.',
		'',
		'====================',
		'FINAL SELF-CHECK',
		'====================',
		'Before returning, you MUST verify and fix until ALL are true:',
		'1) Every hazard matches the hazard sentence form and uses ONLY allowed phrases.',
		'2) No hazard contains forbidden words/concepts.',
		'3) No constraint contains forbidden words/concepts (especially effectively / integrate / ADAS / detection / accurate).',
		'4) Every hazard has exactly one refinement line and it contains ONLY context.',
		'5) Every Loss is covered by at least one hazard (LOSS COVERAGE RULE).',
		'6) The summary table matches the leads_to and addresses mappings exactly.',
		'',
		'OUTPUT REQUIREMENTS:',
		'- Output ONLY the sections below, in this exact order.',
		'- Output MUST start with "=== LOSSES ===" and contain no text before it.',
		'- Use EXACT headings and line formats. Do NOT add extra headings or prose.',
		'',
		'=== LOSSES ===',
		'L1: <unacceptable outcome/harm>',
		'L2: <unacceptable outcome/harm>',
		'L3: <unacceptable outcome/harm>',
		'L4: <unacceptable outcome/harm>',
		'L5: <unacceptable outcome/harm>',
		'...',
		'',
		'=== HAZARDS ===',
		'H1: The vehicle or system <ALLOWED_DANGEROUS_STATE_PHRASE> while <operational context>. (leads_to: L#, L#)',
		'H2: ...',
		'...',
		'',
		'=== SAFETY CONSTRAINTS ===',
		'SC1: The system shall ... (addresses: H#)',
		'SC2: ...',
		'...',
		'',
		'=== REFINED HAZARDS ===',
		'H1 refinement: <ODD + worst-case context only>',
		'H2 refinement: ...',
		'...',
		'',
		'=== MISSING INFORMATION ===',
		'- None or clarification questions',
		'',
		'=== SUMMARY TABLE ===',
		'| Losses | Hazards (→ Losses) | Safety Constraints (→ Hazards) |',
		'| --- | --- | --- |',
		'| L# | H# (→ L#...); ... | SC# (→ H#...); ... |',
		'',
		`Domain hints: ${systemType}.`,
		'',
		'--- SYSTEM TEXT START ---',
		systemText,
		'--- SYSTEM TEXT END ---',
	].join('\\n');
}



function buildStep2Prompt(systemText: string, systemType: SystemType, step1Text: string): string {
	return [
		'You are an expert safety engineer performing Systems-Theoretic Process Analysis (STPA).',
		'',
		'Perform STPA Step 2: Model the hierarchical control structure.',
		'Reference: STPA Handbook (Nancy Leveson), page 22, Figure 2.5.',
		'',
		'GOAL (MUST ACHIEVE):',
		'- Produce a COMPLETE hierarchical control structure suitable for Step 3 (UCAs).',
		'- Explicitly define at least one CLOSED control loop:',
		'  Controller → Control Action(s) → Actuator(s) → Controlled Process → Feedback(s) → Controller.',
		'',
		'INPUTS:',
		`Domain / system type: ${systemType}.`,
		'',
		'Use Step 1 ONLY for consistency (read-only). Do NOT modify Step 1 content:',
		'--- STEP 1 START ---',
		step1Text,
		'--- STEP 1 END ---',
		'',
		'System description (source of truth):',
		'--- SYSTEM TEXT START ---',
		systemText,
		'--- SYSTEM TEXT END ---',
		'',
		'STRICT RULES:',
		'- Use ONLY information explicitly stated or clearly implied by the system description.',
		'- Do NOT invent components, users, networks, or features not present or implied.',
		'- If something is unclear but necessary for a complete loop, add it under "=== MISSING INFORMATION ===" as a question.',
		'',
		'CRITICAL DISTINCTION (MUST FOLLOW):',
		'- Do NOT label a control unit as an actuator if it is a decision-making entity.',
		'- If there is both a decision element and a physical mechanism, model them separately (controller vs actuator).',
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
		'F1: <from> -> C1 : <signal> - <notes>',
		'F2: <from> -> C2 : <signal> - <notes>',
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


function buildStep3Prompt(systemText: string, systemType: SystemType, step1Text: string, step2Text: string): string {
	return [
		'You are an expert safety engineer performing Systems-Theoretic Process Analysis (STPA).',
		'',
		'Perform STPA Step 3: Identify Unsafe Control Actions (UCAs).',
		'Reference: STPA Handbook (Nancy Leveson), page 35.',
		'',
		'GOAL (MANDATORY):',
		'- UCAs must be derived ONLY from control actions defined in Step 2.',
		'- UCAs must map ONLY to hazards defined in Step 1 (H#).',
		'',
		`Domain / system type: ${systemType}.`,
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
		'UCA CATEGORIES (as applicable):',
		'A) omission (not providing the control action when required)',
		'B) commission (providing the control action when not appropriate)',
		'C) timing/sequence (too early, too late, or out of order)',
		'D) duration (applied too long or stopped too soon)',
		'',
		'UCA FORMULATION RULES (STRICT):',
		'- Each UCA must be phrased as an unsafe control action in context (not as a failure/cause).',
		'- Do NOT use: "fails to", "due to", "because of", "sensor error", "mis-detection".',
		'- Each UCA must explicitly reference:',
		'  • controller_id (C#)',
		'  • control_action_id (CA#)',
		'  • a specific operational context',
		'  • one or more hazards (H#)',
		'',
		'OUTPUT FORMAT REQUIREMENTS (MUST FOLLOW EXACTLY):',
		'- Output MUST be editable Markdown.',
		'- Use EXACT headings and EXACT line formats shown below.',
		'- Do NOT include extra headings, prose, or analysis outside the sections.',
		'',
		'=== UCAS ===',
		'UCA1: (type: omission) (controller: C1) (control_action: CA1) <unsafe action in context>. (leads_to: H1, H2)',
		'UCA2: (type: commission) (controller: C1) (control_action: CA2) <unsafe action in context>. (leads_to: H3)',
		'UCA3: (type: timing) (controller: C2) (control_action: CA3) <unsafe action in context>. (leads_to: H4)',
		'UCA4: (type: duration) (controller: C2) (control_action: CA4) <unsafe action in context>. (leads_to: H5)',
		'',
		'=== MISSING INFORMATION ===',
		'- <question or clarification needed, if any>',
		'',
		'=== SUMMARY TABLE ===',
		'Provide ONE concise markdown table with columns:',
		'| UCA | Type | Controller | Control Action | Hazards |',
		'| --- | --- | --- | --- | --- |',
		'| UCA1 | omission | C1 | CA1 | H1; H2 |',
	].join('\n');
}


function buildStep4Prompt(systemText: string, systemType: SystemType, step1Text: string, step2Text: string, step3Text: string): string {
	return [
		'You are an expert STPA analyst producing an academic-quality Step 4 output.',
		'',
		'Perform STPA Step 4 according to the STPA Handbook (Leveson).',
		'Reference: STPA Handbook, page 42.',
		'',
		'GOAL (Step 4):',
		'- Identify loss scenarios (causal factors) that can lead to existing UCAs and/or directly to Hazards.',
		'- Each scenario MUST be traceable: LS -> UCA(s) -> Hazard(s) -> Loss(es).',
		'',
		`Domain / system type: ${systemType}.`,
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
		'STRICT CONSISTENCY RULES:',
		'- Do NOT invent new UCAs, Hazards, Losses, Controllers, Sensors, Actuators, Controlled Processes, or Control Actions.',
		'- Use ONLY IDs that already exist in Steps 1–3.',
		'',
		'REQUIRED OUTPUT CONTENT:',
		'- Produce AT LEAST 10 scenarios (LS1..LS10).',
		'- Each scenario MUST include: linked_ucas, linked_hazards, linked_losses, and control_loop_trace (IDs).',
		'- Provide causal factors grouped by categories (controller/feedback/actuator/process/human/communication/environment).',
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
		'Provide ONE concise markdown table with columns:',
		'| LS | UCAs | Hazards | Losses | Control loop | Key causal factors |',
		'| --- | --- | --- | --- | --- | --- |',
		'| LS1 | UCA1 | H1 | L1 | C1/CA1/A1/P1 | feedback delay; incorrect process model |',
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
	if (!m) return null;
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

/** ===========================================================
 * Activate
 * =========================================================== */
export function activate(context: vscode.ExtensionContext) {
	const extRoot = vscode.Uri.joinPath(context.extensionUri, '').fsPath;
	loadEnvFromExtension(extRoot);

	const chatProvider = new StpaChatViewProvider(context);
	let pendingSmartEditPlan: SmartEditPlan | null = null;
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
		if (!lastContext) {
			vscode.window.showInformationMessage('No analysis to preview. Run "Analyze" first.');
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
	const smartEditCmd = vscode.commands.registerCommand('stpa-agent.smartEdit', async (instruction?: string) => {
		try {
			if (!instruction || !instruction.trim()) return 'No instruction provided.';

			const { applied, ranges, plan } = await smartEditFromChat(instruction);

			// Paint only newly inserted/replaced ranges in green
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				stpaAddedGreenDecoration && editor.setDecorations(stpaAddedGreenDecoration, ranges || []);

				// Optional: clear highlights after 12 seconds
				if (ranges?.length) {
					setTimeout(() => {
						try { editor.setDecorations(stpaAddedGreenDecoration, []); } catch { }
					}, 12000);
				}
			}

			// auto-save after smart edit so user doesn't need to save manually
			await vscode.window.activeTextEditor?.document.save();

			// after edit: show actions again for current guided step
			if (guidedSession) {
				const stage =
					guidedSession.currentStep === 1
						? 'afterStep1'
						: guidedSession.currentStep === 2
							? 'afterStep2'
							: guidedSession.currentStep === 3
								? 'afterStep3'
								: 'afterStep4';

				chatProvider.sendToWebview({ type: 'guidedActions', payload: { stage } });
			}

			// If a follow-up plan was created (Step 1 consistency), show it in the chat and keep it pending.
			if (plan && plan.actions && plan.actions.length) {
				pendingSmartEditPlan = plan;
				chatProvider.sendToWebview({ type: 'showSmartEditPlan', payload: plan });
			}

			let summary = `Smart edit applied ${applied.length} change(s):\n` + applied.join('\n');
			if (plan && plan.actions && plan.actions.length) {
				summary += `\n\nSuggested follow-up fixes are ready (${plan.actions.length}). Review and apply them from the chat.`;
			}
			return summary;
		} catch (e: any) {
			vscode.window.showErrorMessage(`Smart edit failed: ${e?.message || e}`);
			return `Smart edit failed: ${e?.message || e}`;
		}
	});

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
			if (editor) {
				stpaAddedGreenDecoration && editor.setDecorations(stpaAddedGreenDecoration, ranges || []);
				if (ranges?.length) {
					setTimeout(() => {
						try { editor.setDecorations(stpaAddedGreenDecoration, []); } catch { }
					}, 12000);
				}
				await editor.document.save();
			}

			const summary = `Applied ${applied.length} follow-up change(s):\n` + applied.join('\n');
			chatProvider.sendToWebview({ type: 'append', payload: { role: 'assistant', content: summary } });
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

		let systemText = editor.document.getText().trim();
		if (!systemText) {
			chatProvider.sendToWebview({ type: 'toast', payload: 'System description file is empty.' });
			return;
		}

		// ✅ Step 1 pre-validation (Mode B)
		const pre = validateInput(systemText, { stage: 'step1', languageId: editor.document.languageId });

		const out = vscode.window.createOutputChannel('STPA Agent');
		out.clear();
		out.appendLine(formatIssuesTable(pre));
		out.show(true);

		const decision = await promptOnIssues(pre);
		if (decision === 'cancel') {
			chatProvider.sendToWebview({ type: 'toast', payload: 'Step 1 canceled (refine the system description and try again).' });
			return;
		}

		// Optional AI autofix (only if you want it in guided too)
		if (decision === 'autofix') {
			await generateAndInsertMissingSections({
				apiKey,
				editor,
				baseText: systemText,
				systemType: detectSystemType(systemText),
				issues: pre.issues,
			});

			systemText = editor.document.getText().trim();
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

			chatProvider.sendToWebview({ type: 'guidedActions', payload: { stage: 'afterStep1' } });
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

			chatProvider.sendToWebview({ type: 'guidedActions', payload: { stage: 'afterStep2' } });
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

			chatProvider.sendToWebview({ type: 'guidedActions', payload: { stage: 'afterStep3' } });
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

			chatProvider.sendToWebview({ type: 'guidedActions', payload: { stage: 'afterStep4' } });
		} catch (e: any) {
			chatProvider.sendToWebview({ type: 'toast', payload: `Step 4 failed: ${e?.message || e}` });
		} finally {
			chatProvider.sendToWebview({ type: 'busy', payload: false });
		}
	});

	const guidedEditCurrentCmd = vscode.commands.registerCommand('stpa-agent.guided.editCurrentStep', async () => {
		if (!guidedSession) {
			chatProvider.sendToWebview({ type: 'toast', payload: 'No guided session found.' });
			return;
		}

		await openGuidedInEditor(guidedSession);

		chatProvider.sendToWebview({
			type: 'append',
			payload: {
				role: 'system',
				text: `Guided file opened. Add your edits in chat (e.g., "add L5", "remove H2", "add UCA9").`,
			},
		});

		const stage =
			guidedSession.currentStep === 1
				? 'afterStep1'
				: guidedSession.currentStep === 2
					? 'afterStep2'
					: guidedSession.currentStep === 3
						? 'afterStep3'
						: 'afterStep4';

		chatProvider.sendToWebview({ type: 'guidedActions', payload: { stage } });
	});

	const guidedGenerateDiagramsCmd = vscode.commands.registerCommand('stpa-agent.guided.generateDiagrams', async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey || !guidedSession) return;

		chatProvider.sendToWebview({ type: 'busy', payload: true });

		try {
			// compact classic pass for diagrams/json/report
			const prompt = buildStpaPrompt({ systemType: guidedSession.systemType, text: guidedSession.systemText });
			const result = await runModel(apiKey, prompt);

			const cs = deriveControlStructFromText(guidedSession.systemText);
			const csMermaid = buildControlStructureMermaid(cs);
			const impactMermaid = buildImpactGraphMermaid(result);

			lastContext = {
				systemType: guidedSession.systemType,
				result,
				cs,
				csMermaid,
				impactMermaid,
				project: guidedSession.project,
			};

			const md = buildMarkdownReport(lastContext);

			await saveResultAsJSON(result, guidedSession.project);
			await saveMarkdownReport(md, guidedSession.project);
			await saveMermaidDiagrams(guidedSession.project, csMermaid, impactMermaid);

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

			// 1) active editor חייב להיות תיאור מערכת
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'Open a system description file first.' });
				return;
			}

			let systemText = editor.document.getText().trim();
			if (!systemText) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'System description file is empty.' });
				return;
			}

			// 2) pre-check כמו step1
			const pre = validateInput(systemText, { stage: 'step1', languageId: editor.document.languageId });
			const out = vscode.window.createOutputChannel('STPA Agent');
			out.clear();
			out.appendLine(formatIssuesTable(pre));
			out.show(true);

			const decision = await promptOnIssues(pre);
			if (decision === 'cancel') {
				chatProvider.sendToWebview({ type: 'toast', payload: 'Jump canceled (refine the system description and try again).' });
				return;
			}

			if (decision === 'autofix') {
				await generateAndInsertMissingSections({
					apiKey,
					editor,
					baseText: systemText,
					systemType: detectSystemType(systemText),
					issues: pre.issues,
				});
				systemText = editor.document.getText().trim();
			}

			const systemType = detectSystemType(systemText);

			// אם בחר Step 1 → פשוט לקרוא ל-startStep1
			if (targetStep === 1) {
				await vscode.commands.executeCommand('stpa-agent.guided.startStep1');
				return;
			}

			// אחרת: שומרים pendingJump ומבקשים ממנו לפתוח guided.md
			pendingJump = { targetStep, systemText, systemType };

			chatProvider.sendToWebview({
				type: 'append',
				payload: {
					role: 'system',
					text:
						`To jump to Step ${targetStep}: open your guided .md file (with previous steps) in the editor, then click "Confirm guided file".`,
				},
			});

			chatProvider.sendToWebview({
				type: 'guidedActions',
				payload: { stage: 'confirmJumpGuidedFile', targetStep },
			});
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

			// צריך לוודא שקיימים השלבים הקודמים
			const need1 = pendingJump.targetStep >= 2;
			const need2 = pendingJump.targetStep >= 3;
			const need3 = pendingJump.targetStep >= 4;

			if (need1 && !hasStep(guidedText, 1)) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'Step 1 not found in the guided file.' });
				return;
			}
			if (need2 && !hasStep(guidedText, 2)) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'Step 2 not found in the guided file.' });
				return;
			}
			if (need3 && !hasStep(guidedText, 3)) {
				chatProvider.sendToWebview({ type: 'toast', payload: 'Step 3 not found in the guided file.' });
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
			pendingJump = null;

			// עכשיו מריצים את ההמשך הרגיל
			if (target === 2) await vscode.commands.executeCommand('stpa-agent.guided.continueStep2');
			if (target === 3) await vscode.commands.executeCommand('stpa-agent.guided.continueStep3');
			if (target === 4) await vscode.commands.executeCommand('stpa-agent.guided.continueStep4');
		}
	);


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

		inlineDisp
	);
}

export function deactivate() { }
