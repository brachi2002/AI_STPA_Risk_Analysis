// -------------------------------
// STPA Agent - VS Code Extension
// קובץ ראשי עם כל הזרימות + הערות
// -------------------------------

import * as vscode from 'vscode';
import OpenAI from 'openai';
import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';

// UI: חלון צ'אט צדדי
import { StpaChatViewProvider } from './chatView';

// לוגיקה פנימית: ולידציה / השלמות / אינליין־קומפלישן / עריכות חכמות
import { validateInput, formatIssuesTable, promptOnIssues } from './validator';
import { generateAndInsertMissingSections } from './aiQuickFix';
import { registerInlineCompletion } from './inlineCompletion';
import { smartEditFromChat } from './aiEdit';

// טבלאות + דיאגרמות + חילוץ Control Structure + טיפוסים
import { buildMarkdownTables } from './tables';
import { buildControlStructureMermaid, buildImpactGraphMermaid } from './diagrams';
import { deriveControlStructFromText } from './csExtract';
import type { SystemType, StpaResult, ControlStructInput } from './types';

/** -----------------------------------------------
 * טעינת משתני סביבה מתוך .env (OPENAI_API_KEY)
 * ----------------------------------------------- */
function loadEnvFromExtension(extRoot: string) {
	try {
		const envPath = path.join(extRoot, '.env');
		if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
		else dotenv.config();
	} catch { /* noop */ }
}

/** -----------------------------------------------------------
 * זיהוי דומיין בסיסי מתוך טקסט חופשי (מילות מפתח)
 * ----------------------------------------------------------- */
function detectSystemType(text: string): SystemType {
	const lower = text.toLowerCase();
	if (/(patient|drug|dose|dosing|infusion|hospital|clinic|therapy|medical|device|monitoring)/.test(lower)) return 'medical';
	if (/(drone|uav|flight|gps|gnss|altitude|aircraft|autopilot|waypoint|gimbal)/.test(lower)) return 'drone';
	if (/(vehicle|car|brake|steer|steering|engine|automotive|airbag|lane|ecu|can bus|adas)/.test(lower)) return 'automotive';
	return 'generic';
}

/** -----------------------------------------------------------
 * פרומפט STPA מובנה (פלט עקבי שקל לפרסר)
 * ----------------------------------------------------------- */
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
		'Output format (example pattern – extend as needed):',
		'[LOSSES]',
		'L1: ...',
		'L2: ...',
		'L3: ...',
		'L4: ...',
		'L5: ...',
		'L6: ...',
		'',
		'[HAZARDS]',
		'H1: ... (related: L1, L2)',
		'H2: ... (related: L3)',
		'H3: ... (related: L1)',
		'H4: ... (related: L2, L5)',
		'H5: ... (related: L4)',
		'H6: ... (related: L5)',
		'',
		'[UCAS]',
		'UCA1: ... (control loop: ... ; related: H1)',
		'UCA2: ... (control loop: ... ; related: H2)',
		'UCA3: ... (control loop: ... ; related: H3)',
		'UCA4: ... (control loop: ... ; related: H1, H4)',
		'UCA5: ... (control loop: ... ; related: H2)',
		'UCA6: ... (control loop: ... ; related: H5)',
		'UCA7: ... (control loop: ... ; related: H3)',
		'UCA8: ... (control loop: ... ; related: H6)',
		'',
		'--- SYSTEM TEXT START ---',
		text,
		'--- SYSTEM TEXT END ---',
	].join('\n');
}

/** -----------------------------------------------------------
 * פרסר לפלט ה־LLM (מוציא LOSSES/HAZARDS/UCAS)
 * ----------------------------------------------------------- */
function parseStpaOutput(text: string): StpaResult {
	const grab = (section: string) => {
		const rx = new RegExp(`\\[${section}\\]([\\s\\S]*?)(\\n\\[|$)`, 'i');
		const m = text.match(rx);
		if (!m) return [];
		return m[1].split(/\r?\n/).map(s => s.trim()).filter(s => s && !/^\[.*\]$/.test(s));
	};
	return {
		losses: grab('LOSSES'),
		hazards: grab('HAZARDS'),
		ucas: grab('UCAS'),
		raw: text,
	};
}

/** -----------------------------------------------------------
 * JSON/Markdown/Output Utilities
 * ----------------------------------------------------------- */
async function saveResultAsJSON(result: StpaResult) {
	const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!ws) { vscode.window.showErrorMessage('No workspace is open to save the file.'); return; }
	const dir = path.join(ws, 'stpa_results');
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `stpa_result_${Date.now()}.json`);
	fs.writeFileSync(file, JSON.stringify({ losses: result.losses, hazards: result.hazards, ucas: result.ucas }, null, 2), 'utf-8');
	vscode.window.showInformationMessage(`Saved: ${file}`);
}

function printToOutput(result: StpaResult) {
	const out = vscode.window.createOutputChannel('STPA Agent');
	out.clear();
	out.appendLine('=== STPA (Markdown Tables) ===\n');
	out.appendLine(buildMarkdownTables(result));
	out.appendLine('\n=== End of Tables ===\n');
	out.show(true);
}

function buildMarkdownReport(ctx: { text: string; systemType: SystemType; result: StpaResult; csMermaid?: string; impactMermaid?: string }): string {
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
		``,
		`## Source System Text`,
		'```',
		ctx.text.trim(),
		'```',
		'',
	].join('\n');
}

async function saveMarkdownReport(md: string): Promise<string | null> {
	const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!ws) { vscode.window.showErrorMessage('No workspace is open to save the file.'); return null; }
	const dir = path.join(ws, 'stpa_results');
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `stpa_report_${Date.now()}.md`);
	fs.writeFileSync(file, md, 'utf-8');
	vscode.window.showInformationMessage(`Markdown report saved: ${file}`);
	return file;
}

/** -----------------------------------------------------------
 * מודל: ניתוח בסיסי + שדרוג (Refine)
 * ----------------------------------------------------------- */
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

async function runRefine(apiKey: string, ctx: { text: string; systemType: SystemType; result: StpaResult }): Promise<string> {
	const openai = new OpenAI({ apiKey });

	const prev = [
		'[LOSSES]', ...ctx.result.losses, '',
		'[HAZARDS]', ...ctx.result.hazards, '',
		'[UCAS]', ...ctx.result.ucas,
	].join('\n');

	const prompt = [
		'You are an expert STPA reviewer. Improve the prior STPA pass with targeted additions.',
		'Goals:',
		'- Propose missing or stronger Hazards and UCAs.',
		'- Check that each Hazard maps to relevant Losses and each UCA maps to Hazards and a plausible control loop.',
		'- Keep it conservative; do not invent specifics that contradict the given text.',
		'',
		`Domain hints: ${ctx.systemType}. Consider common patterns (maintenance, human error, interface failures, timing, degraded modes).`,
		'',
		'Return ONLY these sections:',
		'[SUGGESTED_HAZARDS]',
		'[SUGGESTED_UCAS]',
		'[GAPS]',
		'[QUALITY_NOTES]',
		'',
		'--- PRIOR SYSTEM TEXT ---',
		ctx.text,
		'--- PRIOR STPA ---',
		prev,
	].join('\n');

	const resp = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		temperature: 0.2,
		messages: [{ role: 'user', content: prompt }],
	});
	return resp.choices?.[0]?.message?.content?.trim() ?? '';
}

/** -----------------------------------------------------------
 * זיכרון לניתוח האחרון (כולל דיאגרמות)
 * ----------------------------------------------------------- */
let lastContext: {
	text: string;
	systemType: SystemType;
	result: StpaResult;
	cs?: ControlStructInput;
	csMermaid?: string;
	impactMermaid?: string;
} | null = null;


function stripCodeFence(s?: string): string {
	if (!s) return '';
	return s
		.replace(/^\s*```mermaid\s*/i, '')  // מסיר ```mermaid בתחילת הטקסט
		.replace(/\s*```$/i, '')            // מסיר ``` בסוף הטקסט
		.trim();
}

/** ===========================================================
 *  הפונקציה הראשית של ההרחבה
 * =========================================================== */
export function activate(context: vscode.ExtensionContext) {
	// טעינת .env
	const extRoot = vscode.Uri.joinPath(context.extensionUri, '').fsPath;
	loadEnvFromExtension(extRoot);

	// Sidebar Chat
	const chatProvider = new StpaChatViewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(StpaChatViewProvider.viewId, chatProvider)
	);

	// Inline completion (Sensors/Actuators/Control loop וכו')
	const inlineDisp = registerInlineCompletion(() => process.env.OPENAI_API_KEY);
	context.subscriptions.push(inlineDisp);

	/** Analyze Current File */
	const analyzeFileCmd = vscode.commands.registerCommand('stpa-agent.analyzeCurrentFile', async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) { vscode.window.showErrorMessage('Missing OPENAI_API_KEY.'); return; }

		const editor = vscode.window.activeTextEditor;
		if (!editor) { vscode.window.showInformationMessage('No open file to analyze.'); return; }

		const text = editor.document.getText().trim();
		if (!text) { vscode.window.showInformationMessage('File is empty. Provide a system description or code.'); return; }

		const status = vscode.window.setStatusBarMessage('🔎 STPA Agent: Running analysis...', 5000);
		try {
			// Pre-Check
			const pre = validateInput(text);
			const out = vscode.window.createOutputChannel('STPA Agent');
			out.clear();
			out.appendLine(formatIssuesTable(pre));
			out.show(true);

			const decision = await promptOnIssues(pre);

			// Auto-fix → Re-check → Analyze
			const runFull = async (srcText: string) => {
				const systemType = detectSystemType(srcText);
				const prompt = buildStpaPrompt({ systemType, text: srcText });
				const result = await runModel(apiKey, prompt);

				printToOutput(result);
				await saveResultAsJSON(result);

				// הפקת דיאגרמות מהטקסט ומהתוצאה
				const cs = deriveControlStructFromText(srcText);
				const csMermaid = buildControlStructureMermaid(cs);
				const impactMermaid = buildImpactGraphMermaid(result);




				lastContext = { text: srcText, systemType, result, cs, csMermaid, impactMermaid };
				vscode.window.showInformationMessage('Analysis completed. See Output → STPA Agent. A JSON file was saved under stpa_results/.');
				console.log('CONTROL STRUCTURE:\n', csMermaid);
				console.log('IMPACT GRAPH:\n', impactMermaid);

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
				if (proceed !== 'continue') { vscode.window.showInformationMessage('Analysis canceled after auto-complete.'); return; }
				await runFull(newText);
				return;
			}

			if (decision === 'cancel') { vscode.window.showInformationMessage('Analysis canceled.'); return; }

			// Continue (רגיל)
			await runFull(text);

		} catch (err: any) {
			vscode.window.showErrorMessage(`Error running analysis: ${err?.message || err}`);
		} finally {
			status?.dispose();
		}
	});

	/** Analyze Selection */
	const analyzeSelectionCmd = vscode.commands.registerCommand('stpa-agent.analyzeSelection', async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) { vscode.window.showErrorMessage('Missing OPENAI_API_KEY.'); return; }

		const editor = vscode.window.activeTextEditor;
		if (!editor) { vscode.window.showInformationMessage('No editor is active.'); return; }

		const selText = editor.document.getText(editor.selection).trim() || editor.document.getText().trim();
		if (!selText) { vscode.window.showInformationMessage('No text to analyze.'); return; }

		const status = vscode.window.setStatusBarMessage('🔎 STPA Agent: Running analysis on selection...', 5000);
		try {
			const pre = validateInput(selText);
			const out = vscode.window.createOutputChannel('STPA Agent');
			out.clear();
			out.appendLine(formatIssuesTable(pre));
			out.show(true);

			const decision = await promptOnIssues(pre);

			const runFull = async (srcText: string) => {
				const systemType = detectSystemType(srcText);
				const prompt = buildStpaPrompt({ systemType, text: srcText });
				const result = await runModel(apiKey, prompt);

				printToOutput(result);
				await saveResultAsJSON(result);

				const cs = deriveControlStructFromText(srcText);
				const csMermaid = buildControlStructureMermaid(cs);
				const impactMermaid = buildImpactGraphMermaid(result);

				lastContext = { text: srcText, systemType, result, cs, csMermaid, impactMermaid };
				vscode.window.showInformationMessage('Selection analysis completed. Output shown and JSON saved under stpa_results/.');
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
				if (proceed !== 'continue') { vscode.window.showInformationMessage('Analysis canceled after auto-complete.'); return; }
				await runFull(newSelText);
				return;
			}

			if (decision === 'cancel') { vscode.window.showInformationMessage('Analysis canceled.'); return; }

			await runFull(selText);

		} catch (err: any) {
			vscode.window.showErrorMessage(`Error analyzing selection: ${err?.message || err}`);
		} finally {
			status?.dispose();
		}
	});

	/** Refine Analysis */
	const refineCmd = vscode.commands.registerCommand('stpa-agent.refineAnalysis', async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) { vscode.window.showErrorMessage('Missing OPENAI_API_KEY.'); return; }
		if (!lastContext) { vscode.window.showInformationMessage('No previous analysis found.'); return; }

		const status = vscode.window.setStatusBarMessage('🛠 STPA Agent: Refining analysis...', 5000);
		try {
			const out = vscode.window.createOutputChannel('STPA Agent');
			const refined = await runRefine(apiKey, lastContext);
			if (!refined) { vscode.window.showWarningMessage('No refinement suggestions were returned.'); return; }
			out.appendLine('\n=== REFINEMENT SUGGESTIONS ===\n');
			out.appendLine(refined);
			out.show(true);
			vscode.window.showInformationMessage('Refinement completed. See Output → STPA Agent.');
		} catch (err: any) {
			vscode.window.showErrorMessage(`Error refining analysis: ${err?.message || err}`);
		} finally {
			status?.dispose();
		}
	});

	/** Export Markdown */
	const exportMdCmd = vscode.commands.registerCommand('stpa-agent.exportMarkdown', async () => {
		if (!lastContext) { vscode.window.showInformationMessage('No analysis to export.'); return; }
		const md = buildMarkdownReport(lastContext);
		const saved = await saveMarkdownReport(md);
		if (saved) {
			const open = await vscode.window.showInformationMessage('Open Markdown report?', 'Open');
			if (open === 'Open') {
				const doc = await vscode.workspace.openTextDocument(saved);
				await vscode.window.showTextDocument(doc);
			}
		}
	});



	/** Preview Diagrams – Webview עם Mermaid */
	const previewDiagCmd = vscode.commands.registerCommand('stpa-agent.previewDiagrams', async () => {
		if (!lastContext) { vscode.window.showInformationMessage('No analysis to preview. Run "Analyze" first.'); return; }
		const panel = vscode.window.createWebviewPanel('stpaDiag', 'STPA Diagrams', vscode.ViewColumn.Beside, { enableScripts: true });
		const csRaw = stripCodeFence(lastContext?.csMermaid || '');
		const impRaw = stripCodeFence(lastContext?.impactMermaid || '');

		panel.webview.html = `
    <!doctype html>
    <html><head>
      <meta charset="utf-8"/>
      <style> body{font-family:var(--vscode-font-family); padding:12px} .box{margin:12px 0} </style>
      <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
      <script>mermaid.initialize({ startOnLoad: true });</script>
    </head>
    <body>
      <h2>Control Structure</h2>
		<div class="mermaid">
		${csRaw || 'graph TD\nA[No data]-->B[Run Analyze]'}
		</div>
		<h2>UCA → Hazard → Loss</h2>
		<div class="mermaid">
		${impRaw || 'graph LR\nA[No data]-->B[Run Analyze]'}
		</div>
    </body></html>`;
	});

	/** Smart Edit (מופעל מה־chatView לצורך "הוסף H7/H8" וכו') */
	const smartEditCmd = vscode.commands.registerCommand('stpa-agent.smartEdit', async (instruction?: string) => {
		try {
			if (!instruction || !instruction.trim()) return 'No instruction provided.';
			const { applied } = await smartEditFromChat(instruction);
			const summary = `Added ${applied.length} line(s):\n` + applied.join('\n');
			vscode.window.setStatusBarMessage('✚ STPA Agent: content inserted', 2500);
			return summary;
		} catch (e: any) {
			vscode.window.showErrorMessage(`Smart edit failed: ${e?.message || e}`);
			return `Smart edit failed: ${e?.message || e}`;
		}
	});

	// רישום כל המנויים
	context.subscriptions.push(
		analyzeFileCmd,
		analyzeSelectionCmd,
		refineCmd,
		exportMdCmd,
		previewDiagCmd,
		smartEditCmd,
		inlineDisp
	);
}

export function deactivate() { }
