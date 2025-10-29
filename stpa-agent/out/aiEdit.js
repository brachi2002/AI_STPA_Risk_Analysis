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
// src/aiEdit.ts
const vscode = __importStar(require("vscode"));
const openai_1 = __importDefault(require("openai"));
/* ===========================
   עזרי זיהוי ופורמט
   =========================== */
/** זיהוי סוג מהנחיית המשתמש (גם עברית וגם אנגלית) */
function detectKindFromInstruction(instr) {
    const t = instr.toLowerCase();
    if (/(hazard|hazards|h[0-9]+|סיכון|סיכונים|H\d+)/i.test(t))
        return 'hazard';
    if (/(loss|losses|l[0-9]+|אובדן|אבדן|L\d+)/i.test(t))
        return 'loss';
    if (/(uca|ucas|uca[0-9]+|בקרה\s*לא\s*בטוחה|UCA\d+)/i.test(t))
        return 'uca';
    return null;
}
/** חישוב האינדקס הבא לפי השורות שיש כבר במסמך */
function nextIndex(lines, rx) {
    let max = 0;
    for (const ln of lines) {
        const m = ln.match(rx);
        if (m)
            max = Math.max(max, parseInt(m[1], 10));
    }
    return max + 1;
}
/* ===========================
   איתור סקשנים במסמך טקסטואלי
   =========================== */
/** מחזיר את טווח הסקשן [start,end) לפי כותרות (תומך גם ב-=== UCAS ===) */
function findSectionRange(lines, kind) {
    const headRx = kind === 'hazard'
        ? /^\s*(\[?\s*HAZARDS\s*\]?|===\s*HAZARDS\s*===)\s*$/i
        : kind === 'loss'
            ? /^\s*(\[?\s*LOSSES\s*\]?|===\s*LOSSES\s*===)\s*$/i
            : /^\s*(\[?\s*UCAS\s*\]?|===\s*UCAS\s*===)\s*$/i;
    // כל כותרת סקשן אחרת (למשל [LOSSES] / === LOSSES === / [SOMETHING ELSE])
    const nextHeadRx = /^\s*(\[[^\]]+\]|===\s*.+\s*===)\s*$/;
    const start = lines.findIndex(l => headRx.test(l));
    if (start === -1)
        return null;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (nextHeadRx.test(lines[i])) {
            end = i;
            break;
        }
    }
    return { start, end };
}
/** מוצא את שורת ההכנסה המדויקת בתוך טווח הסקשן:
 *  אם יש כבר פריטים (H/L/UCA#) – מכניס אחרי האחרון; אחרת אחרי הכותרת.
 */
function findInsertLinePrecise(lines, kind) {
    const range = findSectionRange(lines, kind);
    if (!range) {
        // אם אין סקשן – ניצור בסוף
        const header = kind === 'hazard' ? '[HAZARDS]' : kind === 'loss' ? '[LOSSES]' : '[UCAS]';
        lines.push('', header, '');
        return lines.length; // הכנסה בסוף אחרי הכותרת החדשה
    }
    const itemRx = kind === 'hazard' ? /^H\d+\s*:/i : kind === 'loss' ? /^L\d+\s*:/i : /^UCA\d+\s*:/i;
    let lastItemLine = range.start; // ברירת מחדל: אחרי הכותרת
    for (let i = range.start + 1; i < range.end; i++) {
        if (itemRx.test(lines[i]))
            lastItemLine = i;
    }
    return lastItemLine + 1; // אחרי הפריט האחרון
}
/* ===========================
   תמיכה במסמכי JSON
   =========================== */
function isJsonDoc(text) {
    const trimmed = text.trim();
    return trimmed.startsWith('{') || trimmed.startsWith('[');
}
/** מוסיף לתוך מערך hazards/losses/ucas בכל עומק מבני (case-insensitive) */
function tryInsertIntoJsonArrayDeep(docText, kind, toInsert) {
    let parsed;
    try {
        parsed = JSON.parse(docText);
    }
    catch {
        return null; // לא JSON תקין
    }
    const targetKey = (k) => k.toLowerCase() === (kind === 'hazard' ? 'hazards' : kind === 'loss' ? 'losses' : 'ucas');
    let updated = false;
    const visit = (node) => {
        if (Array.isArray(node)) {
            node.forEach(visit);
        }
        else if (node && typeof node === 'object') {
            for (const key of Object.keys(node)) {
                const val = node[key];
                if (targetKey(key) && Array.isArray(val)) {
                    // מכניס כמחרוזות - שומר על סגנון "H7: ..." בתוך המערך
                    for (const line of toInsert)
                        val.push(line);
                    updated = true;
                }
                else {
                    visit(val);
                }
            }
        }
    };
    visit(parsed);
    if (!updated)
        return null;
    // שמירה עם הזחה יפה (2 רווחים) ושמירה על סוף שורה אם היה
    return JSON.stringify(parsed, null, 2) + (docText.endsWith('\n') ? '\n' : '');
}
/* ===========================
   יצירת פריטי טקסט מה-LLM
   =========================== */
/** פרומפט ל-LLM שמחזיר רק שורות מתאימות להחדרה */
function buildGenPrompt(kind, userInstruction, systemText) {
    const section = kind === 'hazard' ? 'HAZARDS' : kind === 'loss' ? 'LOSSES' : 'UCAS';
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
        `Example format (for illustration only, do NOT echo the word "Example"):\n${example}`,
    ].join('\n');
}
/** מנרמל את תשובת המודל לשורות נקיות */
function normalizeGeneratedLines(raw) {
    // מסיר גדרות ופספוסים, מפצל לשורות ומסנן ריקות
    return raw
        .replace(/```[\s\S]*?```/g, '')
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);
}
/* ===========================
   נקודת הכניסה הציבורית
   =========================== */
/**
 * מקבל הנחיה חופשית מהצ'אט, מייצר שורות בעזרת LLM,
 * מבצע נומרציה אם צריך, ומחדיר למקום המדויק:
 * - במסמכי טקסט: בתוך הסקשן הרלוונטי ובדיוק אחרי הפריט האחרון.
 * - במסמכי JSON: לתוך המערך hazards/losses/ucas (גם אם מקונן).
 */
async function smartEditFromChat(instruction, kindHint) {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        throw new Error('No active editor to edit.');
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
        throw new Error('Missing OPENAI_API_KEY');
    const docText = editor.document.getText();
    const lines = docText.split(/\r?\n/);
    // זיהוי סוג הפריט
    const kind = kindHint || detectKindFromInstruction(instruction);
    if (!kind)
        throw new Error('Could not infer what to add (hazards / losses / UCAs). Mention it in your message.');
    // בקשת שורות מהמודל
    const openai = new openai_1.default({ apiKey });
    const prompt = buildGenPrompt(kind, instruction, docText);
    const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
    });
    const raw = resp.choices?.[0]?.message?.content?.trim() || '';
    const genLines = normalizeGeneratedLines(raw);
    if (!genLines.length)
        throw new Error('Model returned no lines to insert.');
    // האם כבר הגיעו ממוספרות?
    const hasNumbers = genLines.some(l => kind === 'hazard' ? /^H\d+:/i.test(l) : kind === 'loss' ? /^L\d+:/i.test(l) : /^UCA\d+:/i.test(l));
    let toInsert = genLines.slice();
    // נומרציה אוטומטית לפי הקיים במסמך הטקסטואלי
    if (!hasNumbers) {
        const next = kind === 'hazard'
            ? nextIndex(lines, /^H(\d+)\s*:/i)
            : kind === 'loss'
                ? nextIndex(lines, /^L(\d+)\s*:/i)
                : nextIndex(lines, /^UCA(\d+)\s*:/i);
        toInsert = genLines.map((l, i) => kind === 'hazard'
            ? `H${next + i}: ${l.replace(/^H\d+\s*:\s*/i, '')}`
            : kind === 'loss'
                ? `L${next + i}: ${l.replace(/^L\d+\s*:\s*/i, '')}`
                : `UCA${next + i}: ${l.replace(/^UCA\d+\s*:\s*/i, '')}`);
    }
    // מסמך JSON? ננסה להחדיר עמוק לתוך המערך המתאים
    if (isJsonDoc(docText)) {
        const updated = tryInsertIntoJsonArrayDeep(docText, kind, toInsert);
        if (updated) {
            const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(editor.document.lineCount, 0));
            await editor.edit(ed => ed.replace(fullRange, updated));
            return { applied: toInsert, preview: genLines };
        }
        // אם לא מצאנו מערך מתאים – ניפול לגישת טקסט (ניצור סקשן טקסטואלי בסוף)
    }
    // מסמך טקסטואלי: החדרה במקום המדויק בתוך הסקשן
    const insertAt = findInsertLinePrecise(lines, kind);
    const pos = new vscode.Position(insertAt, 0);
    await editor.edit(ed => ed.insert(pos, toInsert.join('\n') + '\n'));
    return { applied: toInsert, preview: genLines };
}
//# sourceMappingURL=aiEdit.js.map