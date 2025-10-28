// -------------------------------
// STPA Agent - VS Code Extension
// קובץ ראשי עם כל הזרימות + הערות
// -------------------------------

import * as vscode from 'vscode';
import OpenAI from 'openai';
import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';
import { smartEditFromChat } from './aiEdit';


// Sidebar Chat (חלון צ׳אט בצד)
import { StpaChatViewProvider } from './chatView';

// מודולים פנימיים: ולידציה, השלמות חסרים, השלמה-תוך-כדי-כתיבה
import { validateInput, formatIssuesTable, promptOnIssues } from './validator';
import { generateAndInsertMissingSections } from './aiQuickFix';
import { registerInlineCompletion } from './inlineCompletion';

/** -----------------------------------------------
 * טעינת משתני סביבה מתוך .env (ל־OPENAI_API_KEY)
 * ----------------------------------------------- */
function loadEnvFromExtension(extRoot: string) {
	try {
		const envPath = path.join(extRoot, '.env');
		if (fs.existsSync(envPath)) {
			dotenv.config({ path: envPath });
		} else {
			dotenv.config(); // fallback: יטען לפי ה־cwd אם יש
		}
	} catch {
		/* noop */
	}
}

/** ----------------------
 * טיפוסי עזר ללוגיקה
 * ---------------------- */
type SystemType = 'medical' | 'drone' | 'automotive' | 'generic';

type PromptInput = {
	systemType?: SystemType;
	text: string;
};

type StpaResult = {
	losses: string[];  // רשימת שורות תחת [LOSSES]
	hazards: string[]; // רשימת שורות תחת [HAZARDS]
	ucas: string[];    // רשימת שורות תחת [UCAS]
	raw: string;       // הפלט הגולמי מהמודל (לדוח/דיבוג)
};

/** -----------------------------------------------------------
 * קונטקסט אחרון שנשמר אחרי ניתוח (לטובת Refine / Export)
 * ----------------------------------------------------------- */
let lastContext: { text: string; systemType: SystemType; result: StpaResult } | null = null;

/** -----------------------------------------------------------
 * זיהוי דומיין בסיסי מתוך טקסט חופשי (מילות מפתח)
 * משפיע על הרמזים שנשלח לפרומפט
 * ----------------------------------------------------------- */
function detectSystemType(text: string): SystemType {
	const lower = text.toLowerCase();
	if (/(patient|drug|dose|dosing|infusion|hospital|clinic|therapy|medical|device|monitoring)/.test(lower)) {
		return 'medical';
	}
	if (/(drone|uav|flight|gps|gnss|altitude|aircraft|autopilot|waypoint|gimbal)/.test(lower)) {
		return 'drone';
	}
	if (/(vehicle|car|brake|steer|steering|engine|automotive|airbag|lane|ecu|can bus|adas)/.test(lower)) {
		return 'automotive';
	}
	return 'generic';
}

/** -----------------------------------------------------------
 * בניית פרומפט STPA מובנה עם דרישות מינימום ופורמט קבוע
 * זה מבטיח פלט עקבי שקל לפרסר בהמשך
 * ----------------------------------------------------------- */
function buildStpaPrompt({ systemType = 'generic', text }: PromptInput): string {
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
 * פרסר לפלט ה־LLM: שולף את 3 הסקשנים לפי תגיות [BRACKETS]
 * ומחזיר גם את הטקסט הגולמי
 * ----------------------------------------------------------- */
function parseStpaOutput(text: string): StpaResult {
	const grab = (section: string) => {
		const rx = new RegExp(`\\[${section}\\]([\\s\\S]*?)(\\n\\[|$)`, 'i');
		const m = text.match(rx);
		if (!m) {
			return [];
		}
		return m[1]
			.split(/\r?\n/)
			.map((s) => s.trim())
			.filter((s) => s && !/^\[.*\]$/.test(s));
	};

	const losses = grab('LOSSES');
	const hazards = grab('HAZARDS');
	const ucas = grab('UCAS');
	return { losses, hazards, ucas, raw: text };
}

/** ===========================================================
 *  כלי טבלאות Markdown להצגה קריאה + יצוא לדוח
 * =========================================================== */

// שורות מפורקות עם שדות (ID/תאור/קשרים) לטבלאות
type LossRow = { id: string; text: string };
type HazardRow = { id: string; text: string; relatedLosses: string[] };
type UcaRow = { id: string; text: string; controlLoop?: string; relatedHazards: string[] };

/** ניקוי תו '|' כדי לא לשבור טבלת Markdown */
function sanitizeCell(s: string): string {
	return s.replace(/\|/g, '\\|').trim();
}

/** פירוק שורה "L5: ..." ל־ID + טקסט */
function parseLossRow(line: string): LossRow {
	const m = line.match(/^L(\d+)\s*:\s*(.+)$/i);
	if (m) {
		return { id: `L${m[1]}`, text: m[2].trim() };
	}
	return { id: '', text: line.trim() };
}

/** פירוק שורה "H2: ... (related: L1, L3)" ל־ID/טקסט/קשרים */
function parseHazardRow(line: string): HazardRow {
	const idm = line.match(/^H(\d+)\s*:\s*(.+)$/i);
	const id = idm ? `H${idm[1]}` : '';
	const meta = (line.match(/\(([^)]*)\)/) || [])[1] || '';
	const rel = (meta.match(/related\s*:\s*([^)]+)/i) || [])[1] || '';
	const relatedLosses = rel
		.split(',')
		.map((s) => s.trim())
		.filter((s) => !!s);
	const text = line
		.replace(/\([^)]*\)/g, '')
		.replace(/^H\d+\s*:\s*/i, '')
		.trim();
	return { id, text, relatedLosses };
}

/** פירוק שורה "UCA3: ... (control loop: ... ; related: H1, H2)" */
function parseUcaRow(line: string): UcaRow {
	const idm = line.match(/^UCA(\d+)\s*:\s*(.+)$/i);
	const id = idm ? `UCA${idm[1]}` : '';
	const meta = (line.match(/\(([^)]*)\)/) || [])[1] || '';
	const cl = (meta.match(/control\s*loop\s*:\s*([^;)\]]+)/i) || [])[1];
	const rel = (meta.match(/related\s*:\s*([^)]+)/i) || [])[1] || '';
	const relatedHazards = rel
		.split(',')
		.map((s) => s.trim())
		.filter((s) => !!s);
	const text = line
		.replace(/\([^)]*\)/g, '')
		.replace(/^UCA\d+\s*:\s*/i, '')
		.trim();
	return { id, text, controlLoop: cl?.trim(), relatedHazards };
}

/** בניית טבלת Markdown כללית מראשי עמודות ושורות */
function mdTable(headers: string[], rows: string[][]): string {
	const head = `| ${headers.map(sanitizeCell).join(' | ')} |`;
	const sep = `| ${headers.map(() => '---').join(' | ')} |`;
	const body = rows.map((r) => `| ${r.map((c) => sanitizeCell(c)).join(' | ')} |`).join('\n');
	return [head, sep, body].join('\n');
}

/** הפיכת StpaResult ל־3 טבלאות Markdown (Losses/Hazards/UCAs) */
function buildMarkdownTables(result: StpaResult): string {
	const lossRows: LossRow[] = result.losses.map(parseLossRow);
	const hazRows: HazardRow[] = result.hazards.map(parseHazardRow);
	const ucaRows: UcaRow[] = result.ucas.map(parseUcaRow);

	const lossesTbl = mdTable(
		['ID', 'Loss Description'],
		lossRows.map((r) => [r.id || '-', r.text || '-'])
	);

	const hazardsTbl = mdTable(
		['ID', 'Hazard Description', 'Related Losses'],
		hazRows.map((r) => [r.id || '-', r.text || '-', r.relatedLosses.join(', ') || '-'])
	);

	const ucasTbl = mdTable(
		['ID', 'UCA Description', 'Control Loop', 'Related Hazards'],
		ucaRows.map((r) => [r.id || '-', r.text || '-', r.controlLoop || '-', r.relatedHazards.join(', ') || '-'])
	);

	return [
		'## Losses',
		lossesTbl,
		'',
		'## Hazards',
		hazardsTbl,
		'',
		'## UCAs',
		ucasTbl,
		'',
	].join('\n');
}

/** -----------------------------------------------------------
 * שמירת JSON לתיקיית workspace/stpa_results/
 * נוח להשוואות/גרפים/ייצוא עתידי
 * ----------------------------------------------------------- */
async function saveResultAsJSON(result: StpaResult) {
	const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!ws) {
		vscode.window.showErrorMessage('No workspace is open to save the file.');
		return;
	}
	const dir = path.join(ws, 'stpa_results');
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const file = path.join(dir, `stpa_result_${Date.now()}.json`);
	fs.writeFileSync(
		file,
		JSON.stringify({ losses: result.losses, hazards: result.hazards, ucas: result.ucas }, null, 2),
		'utf-8'
	);
	vscode.window.showInformationMessage(`Saved: ${file}`);
}

/** -----------------------------------------------------------
 * בניית דוח Markdown מלא (כותרות, טבלאות, פלט גולמי, טקסט מקור)
 * ----------------------------------------------------------- */
function buildMarkdownReport(ctx: { text: string; systemType: SystemType; result: StpaResult }): string {
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

/** -----------------------------------------------------------
 * שמירת דוח Markdown לתיקיית stpa_results ופתיחה אופציונלית
 * ----------------------------------------------------------- */
async function saveMarkdownReport(md: string): Promise<string | null> {
	const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!ws) {
		vscode.window.showErrorMessage('No workspace is open to save the file.');
		return null;
	}
	const dir = path.join(ws, 'stpa_results');
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const file = path.join(dir, `stpa_report_${Date.now()}.md`);
	fs.writeFileSync(file, md, 'utf-8');
	vscode.window.showInformationMessage(`Markdown report saved: ${file}`);
	return file;
}

/** -----------------------------------------------------------
 * הדפסה לערוץ Output בפורמט טבלאות Markdown
 * ----------------------------------------------------------- */
function printToOutput(result: StpaResult) {
	const out = vscode.window.createOutputChannel('STPA Agent');
	out.clear();
	out.appendLine('=== STPA (Markdown Tables) ===\n');
	out.appendLine(buildMarkdownTables(result));
	out.appendLine('\n=== End of Tables ===\n');
	out.show(true);
}

/** -----------------------------------------------------------
 * קריאה ל־GPT להפקת הניתוח הראשוני (STPA Pass)
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

/** -----------------------------------------------------------
 * קריאה ל־GPT לשדרוג הניתוח האחרון (Refine)
 * מחזיר בלוקים: [SUGGESTED_*], [GAPS], [QUALITY_NOTES]
 * ----------------------------------------------------------- */
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

	const content = resp.choices?.[0]?.message?.content?.trim() ?? '';
	return content;
}

/** ===========================================================
 *  הפונקציה הראשית של התוסף - נרשום תצוגות ופקודות
 * =========================================================== */
export function activate(context: vscode.ExtensionContext) {
	// טען .env (ל־OPENAI_API_KEY) לפי תיקיית ההרחבה
	const extRoot = vscode.Uri.joinPath(context.extensionUri, '').fsPath;
	loadEnvFromExtension(extRoot);

	// Sidebar Chat: רישום ה־Webview View (חלון צ׳אט בצד)
	const chatProvider = new StpaChatViewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(StpaChatViewProvider.viewId, chatProvider)
	);

	// Inline completion: השלמת־שורה ל־"Sensors:" / "Actuators:" / "Control loop:" וכו'
	// כרגע עובד על markdown/plaintext עם קונטקסט של ~40 שורות אחורה.
	// (אפשר לשדרג בהמשך לרמז דומיין חכם)
	const inlineDisp = registerInlineCompletion(() => process.env.OPENAI_API_KEY);
	context.subscriptions.push(inlineDisp);

	/** --------------------------------------------
	 * פקודה: ניתוח קובץ מלא (Analyze Current File)
	 * -------------------------------------------- */
	const analyzeFileCmd = vscode.commands.registerCommand('stpa-agent.analyzeCurrentFile', async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			vscode.window.showErrorMessage('Missing OPENAI_API_KEY. Add it to .env (next to package.json) or as an environment variable.');
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
			// 1) Pre-Check: ציון איכות ורשימת חסרים
			const pre = validateInput(text);
			const out = vscode.window.createOutputChannel('STPA Agent');
			out.clear();
			out.appendLine(formatIssuesTable(pre));
			out.show(true);

			// בקשת פעולה: Refine / Continue / Auto-complete with AI
			const decision = await promptOnIssues(pre);

			// 1a) Auto-fix: השלמה אוטומטית של סעיפים חסרים ואז Re-check
			if (decision === 'autofix') {
				await generateAndInsertMissingSections({
					apiKey,
					editor,
					baseText: text,
					systemType: detectSystemType(text),
					issues: pre.issues,
				});

				// בדיקה מחדש אחרי ההשלמה
				const newText = editor.document.getText().trim();
				const pre2 = validateInput(newText);
				out.appendLine('\n--- Re-check after AI auto-complete ---');
				out.appendLine(formatIssuesTable(pre2));

				// אם עדיין יש בעיות — נשאל שוב אם להמשיך או לעצור
				const proceed = pre2.issues.length === 0 ? 'continue' : await promptOnIssues(pre2);
				if (proceed !== 'continue') {
					vscode.window.showInformationMessage('Analysis canceled after auto-complete. You can refine and try again.');
					return;
				}

				// 2) ניתוח STPA
				const systemType = detectSystemType(newText);
				const prompt = buildStpaPrompt({ systemType, text: newText });
				const result = await runModel(apiKey, prompt);

				// 3) הצגה כטבלאות + שמירת JSON + עדכון lastContext
				printToOutput(result);
				await saveResultAsJSON(result);
				lastContext = { text: newText, systemType, result };
				vscode.window.showInformationMessage('Analysis completed. See Output → STPA Agent. A JSON file was saved under stpa_results/.');
				return;
			}

			// 1b) ביטול
			if (decision === 'cancel') {
				vscode.window.showInformationMessage('Analysis canceled. Please refine your input and try again.');
				return;
			}

			// 2) ניתוח רגיל (אם Continue)
			const systemType = detectSystemType(text);
			const prompt = buildStpaPrompt({ systemType, text });
			const result = await runModel(apiKey, prompt);

			// 3) הצגה כטבלאות + שמירת JSON + עדכון lastContext
			printToOutput(result);
			await saveResultAsJSON(result);
			lastContext = { text, systemType, result };
			vscode.window.showInformationMessage('Analysis completed. See Output → STPA Agent. A JSON file was saved under stpa_results/.');

		} catch (err: any) {
			vscode.window.showErrorMessage(`Error running analysis: ${err?.message || err}`);
		} finally {
			status?.dispose();
		}
	});

	/** --------------------------------------------
	 * פקודה: ניתוח טקסט מסומן (Analyze Selection)
	 * אם אין סימון — נופל חזרה לכל הקובץ
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

		const status = vscode.window.setStatusBarMessage('🔎 STPA Agent: Running analysis on selection...', 5000);
		try {
			// 1) Pre-Check על הבחירה
			const pre = validateInput(selText);
			const out = vscode.window.createOutputChannel('STPA Agent');
			out.clear();
			out.appendLine(formatIssuesTable(pre));
			out.show(true);

			const decision = await promptOnIssues(pre);

			// 1a) Auto-fix לבחירה (משלים סעיפים חסרים) + Re-check
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
					vscode.window.showInformationMessage('Analysis canceled after auto-complete. You can refine and try again.');
					return;
				}

				const systemType = detectSystemType(newSelText);
				const prompt = buildStpaPrompt({ systemType, text: newSelText });
				const result = await runModel(apiKey, prompt);

				printToOutput(result);
				await saveResultAsJSON(result);
				lastContext = { text: newSelText, systemType, result };
				vscode.window.showInformationMessage('Selection analysis completed. Output shown and JSON saved under stpa_results/.');
				return;
			}

			if (decision === 'cancel') {
				vscode.window.showInformationMessage('Analysis canceled. Please refine your input and try again.');
				return;
			}

			// 2) ניתוח רגיל על הבחירה
			const systemType = detectSystemType(selText);
			const prompt = buildStpaPrompt({ systemType, text: selText });
			const result = await runModel(apiKey, prompt);

			printToOutput(result);
			await saveResultAsJSON(result);
			lastContext = { text: selText, systemType, result };
			vscode.window.showInformationMessage('Selection analysis completed. Output shown and JSON saved under stpa_results/.');

		} catch (err: any) {
			vscode.window.showErrorMessage(`Error analyzing selection: ${err?.message || err}`);
		} finally {
			status?.dispose();
		}
	});

	/** --------------------------------------------
	 * פקודה: שדרוג הניתוח האחרון (Refine Analysis)
	 * -------------------------------------------- */
	const refineCmd = vscode.commands.registerCommand('stpa-agent.refineAnalysis', async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			vscode.window.showErrorMessage('Missing OPENAI_API_KEY.');
			return;
		}
		if (!lastContext) {
			vscode.window.showInformationMessage('No previous analysis found. Run "Analyze" first.');
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

	/** --------------------------------------------
	 * פקודה: יצוא דוח Markdown (לטובת Wiki/דוח/מצגת)
	 * -------------------------------------------- */
	const exportMdCmd = vscode.commands.registerCommand('stpa-agent.exportMarkdown', async () => {
		if (!lastContext) {
			vscode.window.showInformationMessage('No analysis to export. Run "Analyze" first.');
			return;
		}
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

	/** פקודה פנימית: Smart Edit from Chat (מופעלת ע"י ה-webview) */
	const smartEditCmd = vscode.commands.registerCommand('stpa-agent.smartEdit', async (instruction?: string) => {
		try {
			if (!instruction || !instruction.trim()) {
				vscode.window.showInformationMessage('No instruction provided.');
				return 'No instruction provided.';
			}
			const { applied } = await smartEditFromChat(instruction);
			const summary = `Added ${applied.length} line(s):\n` + applied.join('\n');
			vscode.window.setStatusBarMessage('✚ STPA Agent: content inserted', 2500);
			return summary;
		} catch (e: any) {
			vscode.window.showErrorMessage(`Smart edit failed: ${e?.message || e}`);
			return `Smart edit failed: ${e?.message || e}`;
		}
	});


	// הוספת כל המנויים לניקוי אוטומטי בסגירת ההרחבה
	context.subscriptions.push(
		analyzeFileCmd,
		analyzeSelectionCmd,
		refineCmd,
		exportMdCmd,
		smartEditCmd,
		inlineDisp
	);
}

// אופציונלי: ניקוי משאבים בסגירת ההרחבה
export function deactivate() { }
