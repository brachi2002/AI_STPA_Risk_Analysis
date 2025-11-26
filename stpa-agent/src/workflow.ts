// ----------------------------------------
// STPA Guided Workflow
// זרימה מונחית לפי STPA HANDBOOK – שלבים 1–4
// + סינתזה סופית ל-JSON ודוח
// ----------------------------------------

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';

import { buildMarkdownTables } from './tables';
import { buildControlStructureMermaid, buildImpactGraphMermaid } from './diagrams';
import { deriveControlStructFromText } from './csExtract';
import type { SystemType, StpaResult, ControlStructInput } from './types';

// --------- טיפוסים פנימיים ---------

type StpaPhase = 'system' | 'step1' | 'step2' | 'step3' | 'step4' | 'final';

type ProjectInfo = {
    dir: string;      // תיקיית הפרויקט המלאה
    baseName: string; // שם בסיס לקבצים (ללא סיומת)
};

interface GuidedSession {
    project: ProjectInfo;
    phase: StpaPhase;
    systemText: string;
    step1Text?: string;
    step2Text?: string;
    step3Text?: string;
    step4Text?: string;
}

let currentSession: GuidedSession | null = null;

// --------- כלי עזר כלליים ---------

function detectSystemType(text: string): SystemType {
    const lower = text.toLowerCase();
    if (/(patient|drug|dose|dosing|infusion|hospital|clinic|therapy|medical|device|monitoring)/.test(lower)) return 'medical';
    if (/(drone|uav|flight|gps|gnss|altitude|aircraft|autopilot|waypoint|gimbal)/.test(lower)) return 'drone';
    if (/(vehicle|car|brake|steer|steering|engine|automotive|airbag|lane|ecu|can bus|adas)/.test(lower)) return 'automotive';
    return 'generic';
}

/** הופך שם חופשי ל-slug נחמד לתיקייה/קובץ */
function slugify(name: string): string {
    return (
        name
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9א-ת]+/gi, '-')
            .replace(/^-+|-+$/g, '') || 'stpa-project'
    );
}

/** יצירת תיקיית פרויקט תחת stpa_results ושם בסיס */
async function prepareProjectFolder(suggested?: string): Promise<ProjectInfo | null> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
        vscode.window.showErrorMessage('No workspace is open. Open a folder first.');
        return null;
    }

    const input = await vscode.window.showInputBox({
        title: 'STPA – Project name',
        prompt: 'איך לקרוא למערכת / לניתוח? (ישמש לתיקייה ולקבצים)',
        value: suggested || 'my-system',
        ignoreFocusOut: true,
    });

    if (!input) {
        vscode.window.showInformationMessage('Guided STPA canceled – no project name.');
        return null;
    }

    const baseName = slugify(input);
    const rootDir = path.join(ws, 'stpa_results');
    if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir, { recursive: true });

    const dir = path.join(rootDir, baseName);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    return { dir, baseName };
}

/** פרסר לפורמט [LOSSES]/[HAZARDS]/[UCAS] */
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

/** שמירת JSON לקובץ projectName_stpa.json */
async function saveResultAsJSON(result: StpaResult, project: ProjectInfo) {
    const file = path.join(project.dir, `${project.baseName}_stpa.json`);
    fs.writeFileSync(
        file,
        JSON.stringify(
            {
                losses: result.losses,
                hazards: result.hazards,
                ucas: result.ucas,
            },
            null,
            2
        ),
        'utf-8'
    );
    vscode.window.showInformationMessage(`STPA JSON saved: ${file}`);
}

/** בניית דוח Markdown מלא (טבלאות + דיאגרמות + מקור) */
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
        '# STPA Report',
        '',
        `- **Generated:** ${when}`,
        `- **Domain:** ${ctx.systemType}`,
        '',
        '---',
        '',
        '## Analysis Tables',
        tables,
        '---',
        '',
        '## Diagrams',
        '',
        '### Control Structure',
        ctx.csMermaid || '_No control structure found._',
        '',
        '### UCA → Hazard → Loss',
        ctx.impactMermaid || '_No relations found._',
        '',
        '---',
        '## Raw STPA Output',
        '```',
        ctx.result.raw.trim(),
        '```',
        '',
        '## Source System Text',
        '```',
        ctx.text.trim(),
        '```',
        '',
    ].join('\n');
}

/** שמירת דוח Markdown לקובץ projectName_report.md */
async function saveMarkdownReport(md: string, project: ProjectInfo): Promise<string | null> {
    const file = path.join(project.dir, `${project.baseName}_report.md`);
    fs.writeFileSync(file, md, 'utf-8');
    vscode.window.showInformationMessage(`Markdown report saved: ${file}`);
    return file;
}

// --------- קריאות ל-OpenAI ----------

async function callLLM(apiKey: string, prompt: string): Promise<string> {
    const openai = new OpenAI({ apiKey });
    const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
    });
    return resp.choices?.[0]?.message?.content?.trim() || '';
}

// --------- שלבי STPA (1–4) ----------

async function runStep1(apiKey: string): Promise<void> {
    if (!currentSession) return;
    const { project, systemText } = currentSession;

    const prompt = [
        'do STPA Step 1 Analysis for the system described below According to the STPA HANDBOOK.',
        'On page 15 it says the first step in applying STPA is to define the purpose of the analysis.',
        'Defining the purpose of the analysis has four parts:',
        '1. Identify losses',
        '2. Identify system-level hazards',
        '3. Identify system-level constraints',
        '4. Refine hazards',
        '',
        'Add a summary table at the end.',
        '',
        '--- SYSTEM DESCRIPTION START ---',
        systemText,
        '--- SYSTEM DESCRIPTION END ---',
    ].join('\n');

    let stepText = await callLLM(apiKey, prompt);
    const file = path.join(project.dir, `${project.baseName}_step1.md`);
    fs.writeFileSync(file, stepText, 'utf-8');

    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc);

    while (true) {
        const choice = await vscode.window.showInformationMessage(
            'STPA Step 1 completed. How to continue?',
            'Approve Step 1',
            'Adjust with AI based on my comments',
            'Cancel guided STPA'
        );

        if (!choice || choice === 'Cancel guided STPA') {
            vscode.window.showInformationMessage('Guided STPA canceled at Step 1.');
            currentSession = null;
            return;
        }

        if (choice === 'Approve Step 1') {
            currentSession.step1Text = stepText;
            currentSession.phase = 'step2';
            await runStep2(apiKey);
            return;
        }

        // Adjust with comments
        const comment = await vscode.window.showInputBox({
            title: 'Step 1 – comments',
            prompt: 'מה תרצי לתקן/להדגיש? (אפשר בעברית, ההנחיה תתורגם במודל)',
            ignoreFocusOut: true,
        });
        if (!comment) continue;

        const refinePrompt = [
            'You are revising an STPA Step 1 result according to user comments.',
            'User comments:',
            comment,
            '',
            'Original Step 1 result:',
            stepText,
            '',
            'Rewrite the Step 1 result so that it matches the user comments.',
            'Keep the structure: losses, system-level hazards, system-level constraints, refined hazards, and a summary table.',
        ].join('\n');

        stepText = await callLLM(apiKey, refinePrompt);
        fs.writeFileSync(file, stepText, 'utf-8');
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    }
}

async function runStep2(apiKey: string): Promise<void> {
    if (!currentSession) return;
    const { project, systemText, step1Text } = currentSession;

    const prompt = [
        'do step 2 of STPA for the system According to the STPA HANDBOOK.',
        'Note that on page 22 it says "Modeling the control structure The next step in STPA is to model the hierarchical control structure, as Figure 2.5 shows."',
        '',
        'Add a summary table at the end.',
        '',
        'Use the following system description and Step 1 result as context.',
        '--- SYSTEM DESCRIPTION ---',
        systemText,
        '--- STEP 1 ---',
        step1Text || '',
        '--- END ---',
    ].join('\n');

    let stepText = await callLLM(apiKey, prompt);
    const file = path.join(project.dir, `${project.baseName}_step2.md`);
    fs.writeFileSync(file, stepText, 'utf-8');

    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc);

    while (true) {
        const choice = await vscode.window.showInformationMessage(
            'STPA Step 2 completed. How to continue?',
            'Approve Step 2',
            'Adjust with AI based on my comments',
            'Cancel guided STPA'
        );

        if (!choice || choice === 'Cancel guided STPA') {
            vscode.window.showInformationMessage('Guided STPA canceled at Step 2.');
            currentSession = null;
            return;
        }

        if (choice === 'Approve Step 2') {
            currentSession.step2Text = stepText;
            currentSession.phase = 'step3';
            await runStep3(apiKey);
            return;
        }

        const comment = await vscode.window.showInputBox({
            title: 'Step 2 – comments',
            prompt: 'מה תרצי לתקן/להדגיש בשלב 2?',
            ignoreFocusOut: true,
        });
        if (!comment) continue;

        const refinePrompt = [
            'You are revising an STPA Step 2 result (control structure modeling) according to user comments.',
            'User comments:',
            comment,
            '',
            'Original Step 2 result:',
            stepText,
            '',
            'Rewrite the Step 2 result so that it matches the user comments.',
            'Keep the structure clear and keep the summary table.',
        ].join('\n');

        stepText = await callLLM(apiKey, refinePrompt);
        fs.writeFileSync(file, stepText, 'utf-8');
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    }
}

async function runStep3(apiKey: string): Promise<void> {
    if (!currentSession) return;
    const { project, systemText, step1Text, step2Text } = currentSession;

    const prompt = [
        'do step 3 of STPA for the system According to the STPA HANDBOOK.',
        'Note that on page 35 it says "3. Identify Unsafe Control Actions',
        'Definition: An Unsafe Control Action (UCA) is a control action that, in a particular context and worst-case environment, will lead to a hazard"',
        '',
        'Add a summary table at the end.',
        '',
        'Use the system description, Step 1 and Step 2 as context.',
        '--- SYSTEM DESCRIPTION ---',
        systemText,
        '--- STEP 1 ---',
        step1Text || '',
        '--- STEP 2 ---',
        step2Text || '',
        '--- END ---',
    ].join('\n');

    let stepText = await callLLM(apiKey, prompt);
    const file = path.join(project.dir, `${project.baseName}_step3.md`);
    fs.writeFileSync(file, stepText, 'utf-8');

    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc);

    while (true) {
        const choice = await vscode.window.showInformationMessage(
            'STPA Step 3 completed. How to continue?',
            'Approve Step 3',
            'Adjust with AI based on my comments',
            'Cancel guided STPA'
        );

        if (!choice || choice === 'Cancel guided STPA') {
            vscode.window.showInformationMessage('Guided STPA canceled at Step 3.');
            currentSession = null;
            return;
        }

        if (choice === 'Approve Step 3') {
            currentSession.step3Text = stepText;
            currentSession.phase = 'step4';
            await runStep4(apiKey);
            return;
        }

        const comment = await vscode.window.showInputBox({
            title: 'Step 3 – comments',
            prompt: 'מה תרצי לתקן/להדגיש בשלב 3 (UCAs)?',
            ignoreFocusOut: true,
        });
        if (!comment) continue;

        const refinePrompt = [
            'You are revising an STPA Step 3 result (Unsafe Control Actions) according to user comments.',
            'User comments:',
            comment,
            '',
            'Original Step 3 result:',
            stepText,
            '',
            'Rewrite the Step 3 result so that it matches the user comments.',
            'Keep the UCAs clear and keep the summary table.',
        ].join('\n');

        stepText = await callLLM(apiKey, refinePrompt);
        fs.writeFileSync(file, stepText, 'utf-8');
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    }
}

async function runStep4(apiKey: string): Promise<void> {
    if (!currentSession) return;
    const { project, systemText, step1Text, step2Text, step3Text } = currentSession;

    const prompt = [
        'do step 4 of STPA for the system According to the STPA HANDBOOK.',
        'Note that on page 42 it says "4. Identify loss scenarios',
        'Definition: A loss scenario describes the causal factors that can lead to the unsafe control actions and to hazards."',
        '',
        'Add a summary table at the end.',
        '',
        'Use the system description and the results of Steps 1–3 as context.',
        '--- SYSTEM DESCRIPTION ---',
        systemText,
        '--- STEP 1 ---',
        step1Text || '',
        '--- STEP 2 ---',
        step2Text || '',
        '--- STEP 3 ---',
        step3Text || '',
        '--- END ---',
    ].join('\n');

    let stepText = await callLLM(apiKey, prompt);
    const file = path.join(project.dir, `${project.baseName}_step4.md`);
    fs.writeFileSync(file, stepText, 'utf-8');

    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc);

    while (true) {
        const choice = await vscode.window.showInformationMessage(
            'STPA Step 4 completed. How to continue?',
            'Approve Step 4 and generate final STPA JSON+report',
            'Adjust with AI based on my comments',
            'Cancel guided STPA'
        );

        if (!choice || choice === 'Cancel guided STPA') {
            vscode.window.showInformationMessage('Guided STPA canceled at Step 4.');
            currentSession = null;
            return;
        }

        if (choice === 'Approve Step 4 and generate final STPA JSON+report') {
            currentSession.step4Text = stepText;
            currentSession.phase = 'final';
            await runFinalSynthesis(apiKey);
            return;
        }

        const comment = await vscode.window.showInputBox({
            title: 'Step 4 – comments',
            prompt: 'מה תרצי לתקן/להדגיש בשלב 4 (loss scenarios)?',
            ignoreFocusOut: true,
        });
        if (!comment) continue;

        const refinePrompt = [
            'You are revising an STPA Step 4 result (loss scenarios) according to user comments.',
            'User comments:',
            comment,
            '',
            'Original Step 4 result:',
            stepText,
            '',
            'Rewrite the Step 4 result so that it matches the user comments.',
            'Keep the loss scenarios structured and keep the summary table.',
        ].join('\n');

        stepText = await callLLM(apiKey, refinePrompt);
        fs.writeFileSync(file, stepText, 'utf-8');
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    }
}

// --------- סינתזה סופית ל-JSON + דוח + דיאגרמות ----------

async function runFinalSynthesis(apiKey: string): Promise<void> {
    if (!currentSession) return;
    const { project, systemText, step1Text, step2Text, step3Text, step4Text } = currentSession;

    const synthPrompt = [
        'You are an expert STPA analyst.',
        'Using the following STPA Step 1–4 results, produce a consolidated STPA summary',
        'in this exact format:',
        '',
        '[LOSSES]',
        'L1: ...',
        '...',
        '',
        '[HAZARDS]',
        'H1: ... (related: L1, L2)',
        '...',
        '',
        '[UCAS]',
        'UCA1: ... (control loop: ... ; related: H1, H2)',
        '...',
        '',
        '--- SYSTEM DESCRIPTION ---',
        systemText,
        '--- STEP 1 ---',
        step1Text || '',
        '--- STEP 2 ---',
        step2Text || '',
        '--- STEP 3 ---',
        step3Text || '',
        '--- STEP 4 ---',
        step4Text || '',
    ].join('\n');

    const content = await callLLM(apiKey, synthPrompt);
    const result = parseStpaOutput(content);

    // JSON
    await saveResultAsJSON(result, project);

    // דיאגרמות
    const systemType = detectSystemType(systemText);
    const cs: ControlStructInput = deriveControlStructFromText(systemText);
    const csMermaid = buildControlStructureMermaid(cs);
    const impactMermaid = buildImpactGraphMermaid(result);

    const reportMd = buildMarkdownReport({
        text: systemText,
        systemType,
        result,
        csMermaid,
        impactMermaid,
    });
    await saveMarkdownReport(reportMd, project);

    vscode.window.showInformationMessage(
        `Guided STPA finished. Created Step1–4, JSON and report under: ${project.dir}`
    );

    // אופציונלי: לפתוח את הדוח
    const open = await vscode.window.showInformationMessage('Open final STPA report?', 'Open');
    if (open === 'Open') {
        const reportFile = path.join(project.dir, `${project.baseName}_report.md`);
        const doc = await vscode.workspace.openTextDocument(reportFile);
        await vscode.window.showTextDocument(doc);
    }

    currentSession = null;
}

// --------- נקודת כניסה חיצונית להרחבה ----------

export async function startGuidedStpa(apiKey: string) {
    if (!apiKey) {
        vscode.window.showErrorMessage('Missing OPENAI_API_KEY.');
        return;
    }

    const editor = vscode.window.activeTextEditor;
    let systemText = editor?.document.getText().trim() || '';

    if (!systemText) {
        const fromUser = await vscode.window.showInputBox({
            title: 'System description',
            prompt: 'תאר/י את המערכת לניתוח STPA (system-level description)',
            ignoreFocusOut: true,
        });
        if (!fromUser) {
            vscode.window.showInformationMessage('Guided STPA canceled – no system description.');
            return;
        }
        systemText = fromUser;
    }

    const suggestedName = editor?.document.fileName
        ? path.basename(editor.document.fileName, path.extname(editor.document.fileName))
        : 'my-system';

    const project = await prepareProjectFolder(suggestedName);
    if (!project) return;

    // שמירת system.md
    const systemFile = path.join(project.dir, `${project.baseName}_system.md`);
    fs.writeFileSync(systemFile, systemText, 'utf-8');

    currentSession = {
        project,
        phase: 'step1',
        systemText,
    };

    vscode.window.showInformationMessage('Starting guided STPA – Step 1...');
    await runStep1(apiKey);
}
