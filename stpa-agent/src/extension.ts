// -------------------------------
// STPA Agent - VS Code Extension
// קובץ ראשי עם כל הזרימות + הערות
// -------------------------------

import * as vscode from 'vscode';
import OpenAI from 'openai';
import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';
import { startGuidedStpa } from './workflow';


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
		if (fs.existsSync(envPath)) { dotenv.config({ path: envPath }); }
		else { dotenv.config(); }
	} catch {
		/* noop */
	}
}

/** -----------------------------------------------------------
 * זיהוי דומיין בסיסי מתוך טקסט חופשי (מילות מפתח)
 * ----------------------------------------------------------- */
function detectSystemType(text: string): SystemType {
	const lower = text.toLowerCase();
	if (/(patient|drug|dose|dosing|infusion|hospital|clinic|therapy|medical|device|monitoring)/.test(lower)) { return 'medical'; }
	if (/(drone|uav|flight|gps|gnss|altitude|aircraft|autopilot|waypoint|gimbal)/.test(lower)) { return 'drone'; }
	if (/(vehicle|car|brake|steer|steering|engine|automotive|airbag|lane|ecu|can bus|adas)/.test(lower)) { return 'automotive'; }
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
		if (!m) { return []; }
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

// ===== Project folder helpers =====

type ProjectInfo = {
	dir: string; // תיקיית הפרויקט המלאה
	baseName: string; // שם בסיס לקבצים (ללא סיומת)
};

/** הפיכה של שם חופשי ל-slug נחמד לתיקייה/קובץ */
function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9א-ת]+/gi, '-') // כל מה שלא אות/ספרה → מקף
			.replace(/^-+|-+$/g, '') || 'stpa-project'
	);
}

/** מבקש שם פרויקט מהמשתמש, יוצר תיקייה מתחת ל-stpa_results, ומחזיר פרטים */
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
	if (!fs.existsSync(rootDir)) {
		fs.mkdirSync(rootDir, { recursive: true });
	}
	const dir = path.join(rootDir, baseName);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	return { dir, baseName };
}

/** מוריד ```mermaid ו-``` מסטרינג אם יש */
function stripCodeFence(s?: string): string {
	if (!s) { return ''; }
	return s
		.replace(/^\s*```mermaid\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();
}

/** -----------------------------------------------------------
 * JSON/Markdown/Output Utilities
 * ----------------------------------------------------------- */
async function saveResultAsJSON(result: StpaResult, project: ProjectInfo) {
	const file = path.join(project.dir, `${project.baseName}_stpa.json`);
	fs.writeFileSync(
		file,
		JSON.stringify(
			{ losses: result.losses, hazards: result.hazards, ucas: result.ucas },
			null,
			2
		),
		'utf-8'
	);
	vscode.window.showInformationMessage(`STPA JSON saved: ${file}`);
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
	text: string;
	systemType: SystemType;
	result: StpaResult;
	csMermaid?: string;
	impactMermaid?: string;
}): string {
	const when = new Date().toISOString();
	const tables = buildMarkdownTables(ctx.result);
	return [
		`# STPA Report`,
		'',
		`- **Generated:** ${when}`,
		`- **Domain:** ${ctx.systemType}`,
		'',
		`---`,
		'',
		`## Analysis Tables`,
		tables,
		`---`,
		'',
		`## Diagrams`,
		'',
		`### Control Structure`,
		ctx.csMermaid || '_No control structure found._',
		'',
		`### UCA → Hazard → Loss`,
		ctx.impactMermaid || '_No relations found._',
		'',
		`---`,
		`## Raw STPA Output`,
		'```',
		ctx.result.raw.trim(),
		'```',
		'',
		`## Source System Text`,
		'```',
		ctx.text.trim(),
		'```',
		'',
	].join('\n');
}

async function saveMarkdownReport(md: string, project: ProjectInfo): Promise<string | null> {
	const file = path.join(project.dir, `${project.baseName}_report.md`);
	fs.writeFileSync(file, md, 'utf-8');
	vscode.window.showInformationMessage(`Markdown report saved: ${file}`);
	return file;
}

async function saveMermaidDiagrams(
	project: ProjectInfo,
	csMermaid?: string,
	impactMermaid?: string
) {
	if (!csMermaid && !impactMermaid) {
		return;
	}

	const clean = (s?: string) =>
		(s || '')
			.replace(/^\s*```mermaid\s*/i, '')
			.replace(/\s*```$/i, '')
			.trim();

	const csRaw = clean(csMermaid);
	const impRaw = clean(impactMermaid);

	if (csRaw) {
		const csFile = path.join(project.dir, `${project.baseName}_cs.mmd`);
		fs.writeFileSync(csFile, csRaw, 'utf-8');
	}

	if (impRaw) {
		const impFile = path.join(project.dir, `${project.baseName}_impact.mmd`);
		fs.writeFileSync(impFile, impRaw, 'utf-8');
	}
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

async function runRefine(
	apiKey: string,
	ctx: { text: string; systemType: SystemType; result: StpaResult }
): Promise<string> {
	const openai = new OpenAI({ apiKey });

	const prev = [
		'[LOSSES]',
		...ctx.result.losses,
		'',
		'[HAZARDS]',
		...ctx.result.hazards,
		'',
		'[UCAS]',
		...ctx.result.ucas,
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
 * זיכרון לניתוח האחרון (כולל דיאגרמות + פרויקט)
 * ----------------------------------------------------------- */
let lastContext: {
	text: string;
	systemType: SystemType;
	result: StpaResult;
	cs?: ControlStructInput;
	csMermaid?: string;
	impactMermaid?: string;
	project?: ProjectInfo;
} | null = null;

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
			vscode.window.showInformationMessage('File is empty. Provide a system description or code.');
			return;
		}

		const status = vscode.window.setStatusBarMessage('🔎 STPA Agent: Running analysis...', 5000);
		try {
			// Pre-Check
			const pre = validateInput(text);
			const out = vscode.window.createOutputChannel('STPA Agent');
			out.clear();
			out.appendLine(formatIssuesTable(pre));
			out.show(true);

			const decision = await promptOnIssues(pre);

			// פונקציה שמריצה את כל האנליזה, כולל קבלת שם פרויקט ושמירה
			const runFull = async (srcText: string) => {
				const suggestedName = editor.document.fileName
					? path.basename(editor.document.fileName, path.extname(editor.document.fileName))
					: 'my-system';
				const project = await prepareProjectFolder(suggestedName);
				if (!project) { return; }

				const systemType = detectSystemType(srcText);
				const prompt = buildStpaPrompt({ systemType, text: srcText });
				const result = await runModel(apiKey, prompt);

				// Output + דיאגרמות
				printToOutput(result);
				const cs = deriveControlStructFromText(srcText);
				const csMermaid = buildControlStructureMermaid(cs);
				const impactMermaid = buildImpactGraphMermaid(result);
				await saveMermaidDiagrams(project, csMermaid, impactMermaid);

				// עדכון קונטקסט
				lastContext = { text: srcText, systemType, result, cs, csMermaid, impactMermaid, project };

				// שמירה לפרויקט
				const md = buildMarkdownReport(lastContext);
				await saveResultAsJSON(result, project);
				await saveMarkdownReport(md, project);

				// פתיחת דיאגרמות
				vscode.commands.executeCommand('stpa-agent.previewDiagrams');

				vscode.window.showInformationMessage(
					`Analysis completed for project "${project.baseName}". Files saved under stpa_results/${project.baseName}.`
				);
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
				if (proceed !== 'continue') {
					vscode.window.showInformationMessage('Analysis canceled after auto-complete.');
					return;
				}
				await runFull(newText);
				return;
			}

			if (decision === 'cancel') {
				vscode.window.showInformationMessage('Analysis canceled.');
				return;
			}

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
				if (!project) { return; }

				const systemType = detectSystemType(srcText);
				const prompt = buildStpaPrompt({ systemType, text: srcText });
				const result = await runModel(apiKey, prompt);

				printToOutput(result);

				const cs = deriveControlStructFromText(srcText);
				const csMermaid = buildControlStructureMermaid(cs);
				const impactMermaid = buildImpactGraphMermaid(result);

				await saveMermaidDiagrams(project, csMermaid, impactMermaid);

				lastContext = { text: srcText, systemType, result, cs, csMermaid, impactMermaid, project };

				const md = buildMarkdownReport(lastContext);
				await saveResultAsJSON(result, project);
				await saveMarkdownReport(md, project);

				vscode.commands.executeCommand('stpa-agent.previewDiagrams');

				vscode.window.showInformationMessage(
					`Selection analysis completed for project "${project.baseName}".`
				);
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
				if (proceed !== 'continue') {
					vscode.window.showInformationMessage('Analysis canceled after auto-complete.');
					return;
				}
				await runFull(newSelText);
				return;
			}

			if (decision === 'cancel') {
				vscode.window.showInformationMessage('Analysis canceled.');
				return;
			}

			await runFull(selText);
		} catch (err: any) {
			vscode.window.showErrorMessage(`Error analyzing selection: ${err?.message || err}`);
		} finally {
			status?.dispose();
		}
	});

	const guidedCmd = vscode.commands.registerCommand('stpa-agent.guided', async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			vscode.window.showErrorMessage('Missing OPENAI_API_KEY.');
			return;
		}
		await startGuidedStpa(apiKey);
	});
	/** Refine Analysis */
	const refineCmd = vscode.commands.registerCommand('stpa-agent.refineAnalysis', async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			vscode.window.showErrorMessage('Missing OPENAI_API_KEY.');
			return;
		}
		if (!lastContext) {
			vscode.window.showInformationMessage('No previous analysis found.');
			return;
		}

		const status = vscode.window.setStatusBarMessage('🛠 STPA Agent: Refining analysis...', 5000);
		try {
			const out = vscode.window.createOutputChannel('STPA Agent');
			const refined = await runRefine(apiKey, lastContext);
			if (!refined) {
				vscode.window.showWarningMessage('No refinement suggestions were returned.');
				return;
			}
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

	/** Export Markdown – אפשר לייצא שוב, לתיקיית פרויקט (קיימת או חדשה) */
	const exportMdCmd = vscode.commands.registerCommand('stpa-agent.exportMarkdown', async () => {
		if (!lastContext) {
			vscode.window.showInformationMessage('No analysis to export.');
			return;
		}

		// כאן אנחנו מבטיחים שמשתנה project הוא תמיד מסוג ProjectInfo בלבד
		let project: ProjectInfo;

		if (lastContext.project) {
			// כבר יש פרויקט מהניתוח הקודם
			project = lastContext.project;
		} else {
			// אין פרויקט – נשאל את המשתמש/ת שם וניצור אחד חדש
			const created = await prepareProjectFolder('export');
			if (!created) {
				// המשתמש/ת ביטלה את תיבת הקלט
				return;
			}
			project = created;
			lastContext.project = project;
		}

		const md = buildMarkdownReport(lastContext);
		const saved = await saveMarkdownReport(md, project);
		if (saved) {
			const open = await vscode.window.showInformationMessage('Open Markdown report?', 'Open');
			if (open === 'Open') {
				const doc = await vscode.workspace.openTextDocument(saved);
				await vscode.window.showTextDocument(doc);
			}
		}
	});


	/** Preview Diagrams – Webview עם Mermaid + זום */
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

	/** Smart Edit (מופעל מה־chatView לצורך "הוסף H7/H8" וכו') */
	const smartEditCmd = vscode.commands.registerCommand('stpa-agent.smartEdit', async (instruction?: string) => {
		try {
			if (!instruction || !instruction.trim()) { return 'No instruction provided.'; }
			const { applied } = await smartEditFromChat(instruction);
			const summary = `Added ${applied.length} line(s):\n` + applied.join('\n');
			vscode.window.setStatusBarMessage('✚ STPA Agent: content inserted', 2500);
			return summary;
		} catch (e: any) {
			vscode.window.showErrorMessage(`Smart edit failed: ${e?.message || e}`);
			return `Smart edit failed: ${e?.message || e}`;
		}
	});

	// -------------------------------------------
	// WATCHER – update report + diagrams on JSON save
	// -------------------------------------------

	const jsonWatcher = vscode.workspace.onDidSaveTextDocument(async (doc) => {
		try {
			// בודק אם זה קובץ תוצאת ניתוח
			const file = path.basename(doc.fileName);
			if (!file.endsWith('_stpa.json')) { return; }

			// תיקיית הפרויקט
			const dir = path.dirname(doc.fileName);

			// טוען JSON
			let parsed: any = null;
			try {
				parsed = JSON.parse(doc.getText());
			} catch (e) {
				vscode.window.showErrorMessage('❌ JSON parsing failed – fix the JSON format.');
				return;
			}

			// בודק שהשדות קיימים
			const result: StpaResult = {
				losses: parsed.losses ?? [],
				hazards: parsed.hazards ?? [],
				ucas: parsed.ucas ?? [],
				raw: doc.getText()
			};

			// **************************************
			// 1. Rebuild impact diagram
			// **************************************
			const impactMermaid = buildImpactGraphMermaid(result);

			fs.writeFileSync(
				path.join(dir, file.replace('_stpa.json', '_impact.mmd')),
				impactMermaid,
				'utf-8'
			);

			// **************************************
			// 2. Rebuild control structure (simplified, no sourceText)
			// **************************************
			// כיוון שאין טקסט מערכת → נייצר רק משהו בסיסי או ריק
			const csMermaid = `graph TD\n A[System] --> B[No sourceText provided]`;

			fs.writeFileSync(
				path.join(dir, file.replace('_stpa.json', '_cs.mmd')),
				csMermaid,
				'utf-8'
			);

			// **************************************
			// 3. Rebuild Markdown report
			// **************************************
			const md = [
				`# STPA Report`,
				`Generated: ${new Date().toISOString()}`,
				``,
				`## Tables`,
				buildMarkdownTables(result),
				``,
				`## Diagrams`,
				`### Control Structure`,
				'```mermaid',
				csMermaid,
				'```',
				``,
				`### UCA → Hazard → Loss`,
				'```mermaid',
				impactMermaid,
				'```',
				``,
				`## Raw JSON`,
				'```json',
				doc.getText(),
				'```'
			].join('\n');

			fs.writeFileSync(
				path.join(dir, file.replace('_stpa.json', '_report.md')),
				md,
				'utf-8'
			);

			vscode.window.showInformationMessage('✔ Project updated: report + diagrams regenerated.');

		} catch (err: any) {
			vscode.window.showErrorMessage('Watcher error: ' + (err?.message || err));
		}
	});

	// להוסיף למנויים


	// רישום כל המנויים
	context.subscriptions.push(
		analyzeFileCmd,
		analyzeSelectionCmd,
		refineCmd,
		exportMdCmd,
		previewDiagCmd,
		smartEditCmd,
		inlineDisp,
		jsonWatcher,
		guidedCmd

	);
}

export function deactivate() { }
