"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAndInsertMissingSections = generateAndInsertMissingSections;
// src/aiQuickFix.ts
const vscode = __importStar(require("vscode"));
const openai_1 = __importDefault(require("openai"));
function missingSectionsFromIssues(issues) {
    const map = {
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
async function generateAndInsertMissingSections(params) {
    const { apiKey, editor, baseText, systemType, issues } = params;
    const sections = missingSectionsFromIssues(issues);
    if (sections.length === 0) {
        vscode.window.showInformationMessage('No missing sections detected.');
        return;
    }
    const openai = new openai_1.default({ apiKey });
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
//# sourceMappingURL=aiQuickFix.js.map