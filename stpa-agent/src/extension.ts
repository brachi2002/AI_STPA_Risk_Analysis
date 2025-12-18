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
import { smartEditFromChat } from './aiEdit';

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
		return m[1].split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !/^\[.*\]$/.test(s));
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
	fs.writeFileSync(
		file,
		JSON.stringify({ losses: result.losses, hazards: result.hazards, ucas: result.ucas }, null, 2),
		'utf-8'
	);
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
		'You are an expert STPA analyst.',
		'Perform STPA Step 1 according to the STPA Handbook.',
		'Output MUST include at least:',
		'- 5 LOSSES (L1..)',
		'- 5 HAZARDS (H1..) mapped to losses',
		'- 5 SAFETY CONSTRAINTS (SC1..) mapped to hazards',
		'',
		'Use EXACT headings and line styles so the document is editable later:',
		'=== LOSSES ===',
		'L1: ...',
		'...',
		'',
		'=== HAZARDS ===',
		'H1: ... (related: L1, L2)',
		'...',
		'',
		'=== CONSTRAINTS ===',
		'SC1: ... (related: H1)',
		'...',
		'',
		'=== SUMMARY TABLE ===',
		'(Provide a concise markdown table summarizing Losses, Hazards, Constraints.)',
		'',
		`Domain hints: ${systemType}.`,
		'',
		'--- SYSTEM TEXT START ---',
		systemText,
		'--- SYSTEM TEXT END ---',
	].join('\n');
}

function buildStep2Prompt(systemText: string, systemType: SystemType, step1Text: string): string {
	return [
		'You are an expert STPA analyst.',
		'Perform STPA Step 2 according to the STPA Handbook.',
		'Goal: model the hierarchical control structure.',
		'',
		'Use Step 1 for consistency:',
		'--- STEP 1 START ---',
		step1Text,
		'--- STEP 1 END ---',
		'',
		'Output MUST use EXACT headings:',
		'=== CONTROL_STRUCTURE_TEXT ===',
		'(Concise textual description)',
		'',
		'=== COMPONENTS ===',
		'- Controllers: ...',
		'- Actuators: ...',
		'- Sensors: ...',
		'- Human Operators: ...',
		'- Controlled Processes: ...',
		'- External Systems/Interfaces: ...',
		'',
		'=== SUMMARY TABLE ===',
		'(Concise markdown table of components)',
		'',
		`Domain hints: ${systemType}.`,
		'',
		'--- SYSTEM TEXT START ---',
		systemText,
		'--- SYSTEM TEXT END ---',
	].join('\n');
}

function buildStep3Prompt(systemText: string, systemType: SystemType, step1Text: string, step2Text: string): string {
	return [
		'You are an expert STPA analyst.',
		'Perform STPA Step 3 according to the STPA Handbook.',
		'Goal: identify Unsafe Control Actions (UCAs).',
		'Consider 4 categories: not provided, provided unsafe, wrong timing/order, stopped too soon/applied too long.',
		'',
		'Use prior steps:',
		'--- STEP 1 START ---',
		step1Text,
		'--- STEP 1 END ---',
		'',
		'--- STEP 2 START ---',
		step2Text,
		'--- STEP 2 END ---',
		'',
		'Output MUST use EXACT headings and line styles:',
		'=== UCAS ===',
		'UCA1: ... (control loop: ... ; related: H1)',
		'UCA2: ...',
		'...',
		'',
		'=== SUMMARY TABLE ===',
		'(Concise markdown table mapping UCA → Hazard → Loss)',
		'',
		`Domain hints: ${systemType}.`,
		'',
		'--- SYSTEM TEXT START ---',
		systemText,
		'--- SYSTEM TEXT END ---',
	].join('\n');
}

function buildStep4Prompt(systemText: string, systemType: SystemType, step1Text: string, step2Text: string, step3Text: string): string {
	return [
		'You are an expert STPA analyst.',
		'Perform STPA Step 4 according to the STPA Handbook.',
		'Goal: identify loss scenarios / causal factors leading to UCAs and hazards.',
		'',
		'Use prior steps:',
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
		'Output MUST use EXACT headings:',
		'=== LOSS SCENARIOS ===',
		'LS1: ... (related: UCA1, H1)',
		'LS2: ...',
		'...',
		'',
		'=== SUMMARY TABLE ===',
		'(Concise markdown table Scenario → UCA → Hazard → Loss)',
		'',
		`Domain hints: ${systemType}.`,
		'',
		'--- SYSTEM TEXT START ---',
		systemText,
		'--- SYSTEM TEXT END ---',
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
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(StpaChatViewProvider.viewId, chatProvider)
	);

	const inlineDisp = registerInlineCompletion(() => process.env.OPENAI_API_KEY);
	context.subscriptions.push(inlineDisp);

	const addedGreenDecoration = vscode.window.createTextEditorDecorationType({
		backgroundColor: 'rgba(0, 255, 0, 0.18)',
		border: '1px solid rgba(0, 255, 0, 0.35)',
		overviewRulerColor: 'rgba(0, 255, 0, 0.55)',
		overviewRulerLane: vscode.OverviewRulerLane.Right,
	});
	context.subscriptions.push(addedGreenDecoration);


	function highlightAddedRanges(editor: vscode.TextEditor | undefined, ranges: vscode.Range[], ms = 6000) {
		if (!editor || !ranges?.length) return;
		editor.setDecorations(addedGreenDecoration, ranges);

		setTimeout(() => {
			// עדיין אותו עורך? אם לא – לא קריטי, פשוט ננסה לנקות
			editor.setDecorations(addedGreenDecoration, []);
		}, ms);
	}

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

		const status = vscode.window.setStatusBarMessage('🔎 STPA Agent: Running analysis...', 5000);
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

		const selText =
			editor.document.getText(editor.selection).trim() || editor.document.getText().trim();

		if (!selText) {
			vscode.window.showInformationMessage('No text to analyze.');
			return;
		}

		const status = vscode.window.setStatusBarMessage('🔎 STPA Agent: Running analysis on selection...', 5000);
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

				const newSelText =
					editor.document.getText(editor.selection).trim() || editor.document.getText().trim();

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

		const panel = vscode.window.createWebviewPanel(
			'stpaDiag',
			'STPA Diagrams',
			vscode.ViewColumn.Beside,
			{ enableScripts: true }
		);

		panel.webview.html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
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
</body>
</html>`;
	});

	/** --------------------------------------------
	 * Smart Edit command (shared)
	 * -------------------------------------------- */
	const smartEditCmd = vscode.commands.registerCommand('stpa-agent.smartEdit', async (instruction?: string) => {
		try {
			if (!instruction || !instruction.trim()) return 'No instruction provided.';

			const { applied, ranges } = await smartEditFromChat(instruction);
			highlightAddedRanges(vscode.window.activeTextEditor, ranges);
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

			const summary = `Added ${applied.length} line(s):\n` + applied.join('\n');
			return summary;
		} catch (e: any) {
			vscode.window.showErrorMessage(`Smart edit failed: ${e?.message || e}`);
			return `Smart edit failed: ${e?.message || e}`;
		}
	});

	/** ===========================================================
	 * Guided STPA commands
	 * =========================================================== */

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

	const guidedJumpCmd = vscode.commands.registerCommand('stpa-agent.guided.jumpToStep', async () => {
		chatProvider.sendToWebview({
			type: 'append',
			payload: { role: 'system', text: 'Jump to step will be added soon. For now, start from Step 1.' },
		});
	});

	// ✅ Explain current step (English)
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

		guidedStartStep1Cmd,
		guidedContinueStep2Cmd,
		guidedContinueStep3Cmd,
		guidedContinueStep4Cmd,
		guidedEditCurrentCmd,
		guidedGenerateDiagramsCmd,
		guidedJumpCmd,
		guidedExplainCmd,

		inlineDisp
	);
}

export function deactivate() { }
