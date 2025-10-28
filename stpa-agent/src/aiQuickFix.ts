// src/aiQuickFix.ts
import * as vscode from 'vscode';
import OpenAI from 'openai';
import { ValidationIssue } from './validator';

type SystemType = 'medical' | 'drone' | 'automotive' | 'generic';

function missingSectionsFromIssues(issues: ValidationIssue[]): string[] {
    const map: Record<string, string> = {
        MISSING_SYSTEM_CONTEXT: 'System context & boundary',
        MISSING_ACTORS: 'Actors (human/organizational)',
        MISSING_SENSORS: 'Sensors & telemetry',
        MISSING_ACTUATORS: 'Actuators / effectors',
        MISSING_CONTROL_LOOPS: 'Control loop',
        MISSING_INTERFACES: 'Interfaces & communication',
        MISSING_ENVIRONMENT: 'Operating environment',
    };
    const wanted = issues.map(i => map[i.id]).filter(Boolean);
    // סדר עדיפויות נחמד להצגה
    const order = [
        'System context & boundary',
        'Actors (human/organizational)',
        'Sensors & telemetry',
        'Actuators / effectors',
        'Control loop',
        'Interfaces & communication',
        'Operating environment'
    ];
    return order.filter(x => wanted.includes(x));
}

export async function generateAndInsertMissingSections(params: {
    apiKey: string;
    editor: vscode.TextEditor;
    baseText: string;
    systemType: SystemType;
    issues: ValidationIssue[];
}): Promise<void> {
    const { apiKey, editor, baseText, systemType, issues } = params;

    const sections = missingSectionsFromIssues(issues);
    if (sections.length === 0) {
        vscode.window.showInformationMessage('No missing sections detected.');
        return;
    }

    const openai = new OpenAI({ apiKey });

    // פרומפט: מבקש פסקאות קצרות, בולטים קונקרטיים, וחיבור לקשר המערכת הקיימת
    const prompt = [
        'You are assisting an engineer to complete an STPA system description BEFORE analysis.',
        `System domain: ${systemType}.`,
        'From the existing text below, infer plausible details and write concise, factual sections for ONLY the requested headings.',
        'Keep each section short (3–6 bullet points or 1 short paragraph).',
        'Avoid making up specific numbers unless clearly implied. Be conservative.',
        '',
        'Requested sections (in this order):',
        ...sections.map(s => `- ${s}`),
        '',
        'Existing text:',
        '--- START ---',
        baseText,
        '--- END ---',
        '',
        'Return output as Markdown, using these headings exactly:',
        ...sections.map(s => `## ${s}`)
    ].join('\n');

    const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
    });

    const addition = resp.choices?.[0]?.message?.content?.trim();
    if (!addition) {
        vscode.window.showErrorMessage('AI auto-complete returned empty content.');
        return;
    }

    // היכן להכניס? בתחילת המסמך תחת בלוק כותרת
    const header = '### STPA Input – AI completed sections\n\n';
    const snippet = `${header}${addition}\n\n`;
    await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(0, 0), snippet);
    });

    vscode.window.showInformationMessage('AI-completed sections were inserted at the top of the document.');
}
