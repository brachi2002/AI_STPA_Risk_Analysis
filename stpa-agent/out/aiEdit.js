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
exports.smartEditFromChat = smartEditFromChat;
const vscode = __importStar(require("vscode"));
const openai_1 = __importDefault(require("openai"));
function detectKindFromInstruction(instr) {
    const t = instr.toLowerCase();
    if (/(hazard|hazards|h[0-9]+|סיכון|סיכונים|H\d+)/i.test(t))
        return 'hazard';
    if (/(loss|losses|l[0-9]+|אובדן|אבדן|L\d+)/i.test(t))
        return 'loss';
    if (/(uca|ucas|uca[0-9]+|בקרה לא בטוחה|UCA\d+)/i.test(t))
        return 'uca';
    return null;
}
/** החזרת אינדקס ה-next לפי מה שכבר במסמך */
function nextIndex(lines, prefixRx, prefixLabel) {
    let max = 0;
    for (const ln of lines) {
        const m = ln.match(prefixRx);
        if (m)
            max = Math.max(max, parseInt(m[1], 10));
    }
    return max + 1;
}
/** מוצא או יוצר כותרת סקשן (לפי סוג) ומחזיר offset שורת ההכנסה */
function findInsertLine(lines, kind) {
    const header = kind === 'hazard' ? '[HAZARDS]'
        : kind === 'loss' ? '[LOSSES]'
            : '[UCAS]';
    let idx = lines.findIndex(l => l.trim().toUpperCase() === header);
    if (idx === -1) {
        // אם אין סקשן – ניצור בסוף
        lines.push('');
        lines.push(header);
        lines.push('');
        idx = lines.length - 1;
    }
    // הכנסה תהיה אחרי הכותרת
    return idx + 1;
}
/** מייצר פרומפט מתאים ל-LLM שיחזיר רק שורות לתוספת */
function buildGenPrompt(kind, userInstruction, systemText) {
    const section = kind === 'hazard' ? 'HAZARDS'
        : kind === 'loss' ? 'LOSSES'
            : 'UCAS';
    const example = kind === 'hazard'
        ? 'H7: ... (related: L2, L4)\nH8: ... (related: L1)'
        : kind === 'loss'
            ? 'L6: ...\nL7: ...'
            : 'UCA9: ... (control loop: ... ; related: H2)\nUCA10: ... (control loop: ... ; related: H5)';
    return [
        `You are assisting an STPA editor. Given the user's instruction and the existing system text,`,
        `generate ONLY new ${section} lines to insert into the document.`,
        `STRICT RULES:`,
        `- Return pure lines in the exact house-style (no extra commentary, no code fences).`,
        `- Keep each line concise and domain-plausible.`,
        `- Respect numbering if the user specified (e.g., "H7"). If the user didn't specify numbers, omit numbers and I'll number client-side.`,
        `- Preserve mappings: Hazards → (related: Lx), UCAs → (control loop: ... ; related: Hx).`,
        ``,
        `User instruction:`,
        userInstruction,
        ``,
        `--- SYSTEM TEXT START ---`,
        systemText,
        `--- SYSTEM TEXT END ---`,
        ``,
        `Example format (for illustration only, do NOT echo the word "Example"):\n${example}`
    ].join('\n');
}
/** מנרמל שורות שהחזיר GPT (מסיר רעש, מפצל לפי שורות) */
function normalizeGeneratedLines(raw) {
    const body = raw
        .replace(/^```[\s\S]*?```$/gm, '') // להסיר גדרות, אם הופיע בטעות
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);
    return body;
}
/** מוסיף שורות למסמך הפעיל, תוך נומרציה אם צריך */
async function smartEditFromChat(instruction, kindHint) {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        throw new Error('No active editor to edit.');
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
        throw new Error('Missing OPENAI_API_KEY');
    const docText = editor.document.getText();
    const lines = docText.split(/\r?\n/);
    const kind = kindHint || detectKindFromInstruction(instruction);
    if (!kind)
        throw new Error('Could not infer what to add (hazards / losses / UCAs). Mention it in your message.');
    // בקשת הצעה מה-LLM
    const openai = new openai_1.default({ apiKey });
    const prompt = buildGenPrompt(kind, instruction, docText);
    const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }]
    });
    const raw = resp.choices?.[0]?.message?.content?.trim() || '';
    const genLines = normalizeGeneratedLines(raw);
    if (!genLines.length)
        throw new Error('Model returned no lines to insert.');
    // חישוב נקודת הכנסה
    const insertAt = findInsertLine(lines, kind);
    // האם למספר? (אם אין מספרים בשורות)
    const hasNumbers = genLines.some(l => kind === 'hazard' ? /^H\d+:/i.test(l) : kind === 'loss' ? /^L\d+:/i.test(l) : /^UCA\d+:/i.test(l));
    let toInsert = genLines.slice();
    if (!hasNumbers) {
        // נמספר לפי הסוג
        const next = kind === 'hazard'
            ? nextIndex(lines, /^H(\d+)\s*:/i, 'H')
            : kind === 'loss'
                ? nextIndex(lines, /^L(\d+)\s*:/i, 'L')
                : nextIndex(lines, /^UCA(\d+)\s*:/i, 'UCA');
        toInsert = genLines.map((l, i) => kind === 'hazard'
            ? `H${next + i}: ${l.replace(/^H\d+\s*:\s*/i, '')}`
            : kind === 'loss'
                ? `L${next + i}: ${l.replace(/^L\d+\s*:\s*/i, '')}`
                : `UCA${next + i}: ${l.replace(/^UCA\d+\s*:\s*/i, '')}`);
    }
    // ביצוע ההכנסה במסמך
    const insertText = (toInsert.join('\n') + '\n');
    const pos = new vscode.Position(insertAt, 0);
    await editor.edit(ed => {
        ed.insert(pos, insertText);
    });
    return { applied: toInsert, preview: genLines };
}
//# sourceMappingURL=aiEdit.js.map