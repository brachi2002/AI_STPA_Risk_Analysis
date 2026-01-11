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
const AI_FIX_START = '<!-- STPA_AI_FIX_START -->';
const AI_FIX_END = '<!-- STPA_AI_FIX_END -->';
function missingSectionsFromIssues(issues) {
    const map = {
        MISSING_SYSTEM_CONTEXT: 'System context',
        MISSING_OBJECTIVES: 'System objectives / purpose',
        MISSING_BOUNDARY: 'System boundary (in-scope / out-of-scope)',
        MISSING_ASSUMPTIONS: 'Assumptions / limitations',
        MISSING_ACTORS: 'Actors (human/organizational)',
        MISSING_SENSORS: 'Sensors & telemetry',
        MISSING_ACTUATORS: 'Actuators / effectors',
        MISSING_CONTROL_LOOPS: 'Control loop',
        MISSING_INTERFACES: 'Interfaces & communication',
        MISSING_ENVIRONMENT: 'Operating environment',
    };
    const wanted = issues.map((i) => map[i.id]).filter(Boolean);
    const order = [
        'System context',
        'System objectives / purpose',
        'System boundary (in-scope / out-of-scope)',
        'Assumptions / limitations',
        'Actors (human/organizational)',
        'Sensors & telemetry',
        'Actuators / effectors',
        'Control loop',
        'Interfaces & communication',
        'Operating environment',
    ];
    return order.filter((x) => wanted.includes(x));
}
function docHasHeading(docText, heading) {
    // Match "## Heading" or "# Heading" or "### Heading"
    const rx = new RegExp(`^#{1,6}\\s+${escapeRegExp(heading)}\\s*$`, 'mi');
    return rx.test(docText);
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function upsertAiFixBlock(original, blockContent) {
    const fullBlock = [
        AI_FIX_START,
        '### STPA Input – AI completed sections',
        '',
        blockContent.trim(),
        '',
        AI_FIX_END,
        '',
    ].join('\n');
    const startIdx = original.indexOf(AI_FIX_START);
    const endIdx = original.indexOf(AI_FIX_END);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const before = original.slice(0, startIdx).trimEnd();
        const after = original.slice(endIdx + AI_FIX_END.length).trimStart();
        return [before, '', fullBlock, after].join('\n').trim() + '\n';
    }
    // If no existing block: insert AFTER top title if exists, else at start.
    // Try to place after first H1 line if present.
    const lines = original.split(/\r?\n/);
    const h1Index = lines.findIndex((l) => /^#\s+/.test(l.trim()));
    if (h1Index !== -1) {
        const insertAt = h1Index + 1;
        lines.splice(insertAt, 0, '', fullBlock);
        return lines.join('\n').trim() + '\n';
    }
    return (fullBlock + original).trim() + '\n';
}
async function generateAndInsertMissingSections(params) {
    const { apiKey, editor, baseText, systemType, issues } = params;
    // 1) map issues -> requested headings
    let sections = missingSectionsFromIssues(issues);
    // 2) avoid duplicates: do not ask AI for headings that already exist in the doc
    sections = sections.filter((h) => !docHasHeading(baseText, h));
    if (sections.length === 0) {
        vscode.window.showInformationMessage('No missing sections detected (or sections already exist in the document).');
        return;
    }
    const openai = new openai_1.default({ apiKey });
    const prompt = [
        'You are assisting an engineer to complete an STPA system description BEFORE analysis.',
        `System domain: ${systemType}.`,
        'From the existing text below, infer plausible details and write concise, conservative sections for ONLY the requested headings.',
        'Keep each section short (3–6 bullets OR 1 short paragraph).',
        'Do NOT repeat content already in the text. Do NOT add extra headings.',
        '',
        'Requested sections (in this order):',
        ...sections.map((s) => `- ${s}`),
        '',
        'Existing text:',
        '--- START ---',
        baseText,
        '--- END ---',
        '',
        'Return output as Markdown, using these headings exactly (and only these):',
        ...sections.map((s) => `## ${s}`),
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
    // 3) upsert a single managed block
    const updated = upsertAiFixBlock(baseText, addition);
    // 4) replace entire document text (keeps it clean + deterministic)
    const doc = editor.document;
    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
    await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, updated);
    });
    await vscode.window.activeTextEditor?.document.save();
    vscode.window.showInformationMessage('AI-completed sections were updated (single managed block).');
}
//# sourceMappingURL=aiQuickFix.js.map