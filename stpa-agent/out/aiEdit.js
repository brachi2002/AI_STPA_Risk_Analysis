"use strict";
// src/aiEdit.ts
// English-only code & UI strings (per project convention).
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
exports.KIND_META = void 0;
exports.findSectionRangeByHeading = findSectionRangeByHeading;
exports.findGuidedStepBodyRange = findGuidedStepBodyRange;
exports.ensureSectionExistsInsideStep = ensureSectionExistsInsideStep;
exports.findInsertLineInSection = findInsertLineInSection;
exports.endPositionFromText = endPositionFromText;
exports.validateGeneratedLines = validateGeneratedLines;
exports.validateAddGrounding = validateAddGrounding;
exports.buildAddGroundingContext = buildAddGroundingContext;
exports.normalizeStep1Text = normalizeStep1Text;
exports.normalizeStep2Text = normalizeStep2Text;
exports.normalizeUcaText = normalizeUcaText;
exports.validateStep1Plan = validateStep1Plan;
exports.validateStep2Plan = validateStep2Plan;
exports.applySmartEditPlan = applySmartEditPlan;
exports.smartEditFromChat = smartEditFromChat;
const vscode = __importStar(require("vscode"));
const openai_1 = __importDefault(require("openai"));
exports.KIND_META = {
    loss: {
        section: 'LOSSES',
        prefix: 'L',
        lineRx: /^L(\d+)\s*:/i,
        headingRx: /^\s*(\[?\s*LOSSES\s*\]?|===\s*LOSSES\s*===)\s*$/i,
        allowAutoNumber: true,
    },
    hazard: {
        section: 'HAZARDS',
        prefix: 'H',
        lineRx: /^H(\d+)\s*:/i,
        headingRx: /^\s*(\[?\s*HAZARDS\s*\]?|===\s*HAZARDS\s*===)\s*$/i,
        allowAutoNumber: true,
    },
    safety_constraint: {
        section: 'SAFETY_CONSTRAINTS',
        prefix: 'SC',
        lineRx: /^SC(\d+)\s*:/i,
        headingRx: /^\s*(\[?\s*SAFETY[\s_]+CONSTRAINTS\s*\]?|===\s*SAFETY[\s_]+CONSTRAINTS\s*===|===\s*CONSTRAINTS\s*===)\s*$/i,
        allowAutoNumber: true,
    },
    refined_hazard: {
        section: 'REFINED_HAZARDS',
        prefix: 'H',
        lineRx: /^H(\d+)\s+refinement\s*:/i,
        headingRx: /^\s*(\[?\s*REFINED[\s_]+HAZARDS\s*\]?|===\s*REFINED[\s_]+HAZARDS\s*===)\s*$/i,
        // IMPORTANT: refined hazards must attach to an existing H#, so we do NOT auto-number
        allowAutoNumber: false,
    },
    controller: {
        section: 'CONTROLLERS',
        prefix: 'C',
        lineRx: /^C(\d+)\s*:/i,
        headingRx: /^\s*(\[?\s*CONTROLLERS\s*\]?|===\s*CONTROLLERS\s*===)\s*$/i,
        allowAutoNumber: true,
    },
    controlled_process: {
        section: 'CONTROLLED_PROCESSES',
        prefix: 'P',
        lineRx: /^P(\d+)\s*:/i,
        headingRx: /^\s*(\[?\s*CONTROLLED[\s_]+PROCESSES\s*\]?|===\s*CONTROLLED[\s_]+PROCESSES\s*===)\s*$/i,
        allowAutoNumber: true,
    },
    actuator: {
        section: 'ACTUATORS',
        prefix: 'A',
        lineRx: /^A(\d+)\s*:/i,
        headingRx: /^\s*(\[?\s*ACTUATORS\s*\]?|===\s*ACTUATORS\s*===)\s*$/i,
        allowAutoNumber: true,
    },
    sensor: {
        section: 'SENSORS',
        prefix: 'S',
        lineRx: /^S(\d+)\s*:/i,
        headingRx: /^\s*(\[?\s*SENSORS\s*\]?|===\s*SENSORS\s*===)\s*$/i,
        allowAutoNumber: true,
    },
    external_system: {
        section: 'EXTERNAL_SYSTEMS',
        prefix: 'X',
        lineRx: /^X(\d+)\s*:/i,
        headingRx: /^\s*(\[?\s*EXTERNAL[\s_]+SYSTEMS\s*\]?|===\s*EXTERNAL[\s_]+SYSTEMS\s*===)\s*$/i,
        allowAutoNumber: true,
    },
    control_action: {
        section: 'CONTROL_ACTIONS',
        prefix: 'CA',
        lineRx: /^CA(\d+)\s*:/i,
        headingRx: /^\s*(\[?\s*CONTROL[\s_]+ACTIONS\s*\]?|===\s*CONTROL[\s_]+ACTIONS\s*===)\s*$/i,
        allowAutoNumber: true,
    },
    feedback: {
        section: 'FEEDBACK',
        prefix: 'F',
        lineRx: /^F(\d+)\s*:/i,
        headingRx: /^\s*(\[?\s*FEEDBACK\s*\]?|===\s*FEEDBACK\s*===)\s*$/i,
        allowAutoNumber: true,
    },
    control_loop: {
        section: 'CONTROL_LOOPS',
        prefix: 'LOOP',
        lineRx: /^LOOP(\d+)\s*:/i,
        headingRx: /^\s*(\[?\s*CONTROL[\s_]+LOOPS\s*\]?|===\s*CONTROL[\s_]+LOOPS\s*===)\s*$/i,
        allowAutoNumber: true,
    },
    uca: {
        section: 'UCAS',
        prefix: 'UCA',
        lineRx: /^UCA(\d+)\s*:/i,
        headingRx: /^\s*(\[?\s*UCAS\s*\]?|===\s*UCAS\s*===)\s*$/i,
        allowAutoNumber: true,
    },
    loss_scenario: {
        section: 'LOSS_SCENARIOS',
        prefix: 'LS',
        lineRx: /^LS(\d+)\s*:/i,
        headingRx: /^\s*(\[?\s*LOSS[\s_]+SCENARIOS\s*\]?|===\s*LOSS[\s_]+SCENARIOS\s*===)\s*$/i,
        allowAutoNumber: true,
    },
};
function detectStepHeadingStyle(lines, step) {
    const stepRange = findGuidedStepBodyRange(lines, step);
    if (!stepRange) {
        return null;
    }
    const headingRx = /^\s*(?:\[\s*([A-Z_ ]+)\s*\]|===\s*([A-Z_ ]+)\s*===)\s*$/;
    for (let i = stepRange.start; i < stepRange.end; i++) {
        const m = lines[i].match(headingRx);
        const label = (m?.[1] || m?.[2] || '').trim();
        if (!label)
            continue;
        if (label.includes('_'))
            return 'underscore';
        if (label.includes(' '))
            return 'space';
    }
    return null;
}
function headingLineForSection(section, lines) {
    const step = stepForSection(section);
    const detected = lines ? detectStepHeadingStyle(lines, step) : null;
    const useUnderscore = detected === 'underscore'
        ? true
        : detected === 'space'
            ? false
            : step === 2;
    const label = useUnderscore ? section : section.replace(/_/g, ' ');
    return `=== ${label} ===`;
}
function stepForSection(section) {
    if (section === 'LOSSES' || section === 'HAZARDS' || section === 'SAFETY_CONSTRAINTS' || section === 'REFINED_HAZARDS') {
        return 1;
    }
    if (section === 'CONTROLLERS' ||
        section === 'CONTROLLED_PROCESSES' ||
        section === 'ACTUATORS' ||
        section === 'SENSORS' ||
        section === 'EXTERNAL_SYSTEMS' ||
        section === 'CONTROL_ACTIONS' ||
        section === 'FEEDBACK' ||
        section === 'CONTROL_LOOPS') {
        return 2;
    }
    if (section === 'UCAS') {
        return 3;
    }
    return 4;
}
function extractAnyExplicitId(instr) {
    const m = String(instr || '').match(/\b(L\d+|H\d+|SC\d+|UCA\d+|LS\d+|C\d+|P\d+|A\d+|S\d+|X\d+|CA\d+|F\d+|LOOP\d+)\b/i);
    return m ? m[1].toUpperCase() : null;
}
function kindFromExplicitId(id) {
    const u = id.toUpperCase();
    if (/^UCA\d+$/.test(u)) {
        return 'uca';
    }
    if (/^LS\d+$/.test(u)) {
        return 'loss_scenario';
    }
    if (/^SC\d+$/.test(u)) {
        return 'safety_constraint';
    }
    if (/^CA\d+$/.test(u)) {
        return 'control_action';
    }
    if (/^LOOP\d+$/.test(u)) {
        return 'control_loop';
    }
    if (/^C\d+$/.test(u)) {
        return 'controller';
    }
    if (/^P\d+$/.test(u)) {
        return 'controlled_process';
    }
    if (/^A\d+$/.test(u)) {
        return 'actuator';
    }
    if (/^S\d+$/.test(u)) {
        return 'sensor';
    }
    if (/^X\d+$/.test(u)) {
        return 'external_system';
    }
    if (/^F\d+$/.test(u)) {
        return 'feedback';
    }
    if (/^H\d+$/.test(u)) {
        return 'hazard';
    }
    if (/^L\d+$/.test(u)) {
        return 'loss';
    }
    return null;
}
/** Detects the item kind from the user's instruction (Hebrew+English). */
function detectKindFromInstruction(instr) {
    const explicit = extractAnyExplicitId(instr);
    if (explicit) {
        // NOTE: if they say "H2 refinement", we still extract H2 (hazard), so we rely on keywords "refinement/refined"
        const t = instr.toLowerCase();
        if (/(refined\s*hazard|refinement)/i.test(t)) {
            return 'refined_hazard';
        }
        const k = kindFromExplicitId(explicit);
        if (k) {
            return k;
        }
    }
    const t = instr.toLowerCase();
    if (/(refined\s*hazard|refinement|h\d+\s*refinement)/i.test(t)) {
        return 'refined_hazard';
    }
    if (/(safety\s*constraint|constraints|\bsc\b|SC\d+)/i.test(t)) {
        return 'safety_constraint';
    }
    if (/(hazard|hazards|סיכון|סיכונים)/i.test(t)) {
        return 'hazard';
    }
    if (/(loss|losses|אובדן|אבדן)/i.test(t)) {
        return 'loss';
    }
    if (/(uca|ucas|בקרה\s*לא\s*בטוחה)/i.test(t)) {
        return 'uca';
    }
    if (/(controller|controllers)/i.test(t)) {
        return 'controller';
    }
    if (/(controlled\s*process|processes)/i.test(t)) {
        return 'controlled_process';
    }
    if (/(actuator|actuators)/i.test(t)) {
        return 'actuator';
    }
    if (/(sensor|sensors)/i.test(t)) {
        return 'sensor';
    }
    if (/(external\s*system|external\s*systems)/i.test(t)) {
        return 'external_system';
    }
    if (/(control\s*action|control\s*actions)/i.test(t)) {
        return 'control_action';
    }
    if (/(feedback)/i.test(t)) {
        return 'feedback';
    }
    if (/(control\s*loop|control\s*loops)/i.test(t)) {
        return 'control_loop';
    }
    if (/(loss\s*scenario|loss\s*scenarios)/i.test(t)) {
        return 'loss_scenario';
    }
    return null;
}
/** Detects edit operation: add / update / delete (Hebrew+English). */
function detectOpFromInstruction(instr) {
    const t = instr.toLowerCase();
    if (/(\bdelete\b|\bremove\b|\berase\b|\bdrop\b|\bdiscard\b|מחוק|למחוק|תמחק|להסיר|תסיר)/i.test(t)) {
        return 'delete';
    }
    if (/(\bupdate\b|\bedit\b|\bchange\b|\breplace\b|\bmodify\b|\brev(i|e)se\b|לעדכן|תעדכן|לשנות|תשנה|לתקן|תתקן)/i.test(t)) {
        return 'update';
    }
    return 'add';
}
function findSectionRangeByHeading(lines, headingRx) {
    const nextHeadRx = /^\s*(\[[^\]]+\]|===\s*.+\s*===|##\s*Step\s*[1-4]\b)\s*$/i;
    const start = lines.findIndex((l) => headingRx.test(l));
    if (start === -1) {
        return null;
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (nextHeadRx.test(lines[i])) {
            end = i;
            break;
        }
    }
    return { start, end };
}
function findGuidedStepBodyRange(lines, step) {
    const headRe = new RegExp(`^##\\s*Step\\s*${step}\\b`, 'i');
    let head = -1;
    for (let i = 0; i < lines.length; i++) {
        if (headRe.test(lines[i])) {
            head = i;
            break;
        }
    }
    if (head === -1) {
        return null;
    }
    const start = head + 1;
    let end = lines.length;
    const nextHeadRe = /^##\s*Step\s*[1-4]\b/i;
    for (let i = start; i < lines.length; i++) {
        if (nextHeadRe.test(lines[i])) {
            end = i;
            break;
        }
    }
    return { start, end };
}
function ensureSectionExistsInsideStep(lines, section) {
    const step = stepForSection(section);
    const stepRange = findGuidedStepBodyRange(lines, step);
    const insertAt = stepRange ? stepRange.end : lines.length;
    lines.splice(insertAt, 0, '', headingLineForSection(section, lines), '');
    // return line index just AFTER the heading line
    return insertAt + 2;
}
function findInsertLineInSection(lines, meta) {
    const range = findSectionRangeByHeading(lines, meta.headingRx);
    if (!range) {
        return ensureSectionExistsInsideStep(lines, meta.section);
    }
    let lastItem = range.start;
    for (let i = range.start + 1; i < range.end; i++) {
        if (meta.lineRx.test(lines[i]))
            lastItem = i;
    }
    return lastItem + 1;
}
/** Computes the next index based on the lines already in the document. */
function nextIndex(lines, rx) {
    let max = 0;
    for (const ln of lines) {
        const m = ln.match(rx);
        if (m)
            max = Math.max(max, parseInt(m[1], 10));
    }
    return max + 1;
}
/** Finds a line index by kind + explicit id. Handles refined_hazard specially. */
function findLineIndexByKindAndId(lines, kind, id) {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (kind === 'refined_hazard') {
        // refinement lines look like: "H2 refinement: ..."
        const rx = new RegExp(`^\\s*${safe}\\s+refinement\\s*:`, 'i');
        return lines.findIndex((l) => rx.test(l));
    }
    // normal "ID:" lines
    const rx = new RegExp(`^\\s*${safe}\\s*:`, 'i');
    return lines.findIndex((l) => rx.test(l));
}
/** Computes the final Position after inserting text starting at `start`. */
function endPositionFromText(start, insertedText) {
    const parts = insertedText.split(/\r?\n/);
    if (parts.length === 1) {
        return start.translate(0, parts[0].length);
    }
    const lastLine = parts[parts.length - 1];
    return new vscode.Position(start.line + (parts.length - 1), lastLine.length);
}
/* ==========================================================
   LLM prompting + validation + retry
   ========================================================== */
function normalizeGeneratedLines(raw) {
    return raw
        .replace(/```[\s\S]*?```/g, '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
}
function validateGeneratedLines(kind, lines) {
    if (!lines.length) {
        return 'Model returned no lines.';
    }
    // Basic: ensure it doesn't output headings
    if (lines.some((l) => /^===\s*.+\s*===\s*$/i.test(l))) {
        return 'Model output contains headings.';
    }
    // Helper: detect if line starts with ANY known ID prefix
    const startsWithAnyId = (l) => /^\s*(L|H|SC|UCA|LS|C|P|A|S|X|CA|F|LOOP)\d+\s*:/i.test(l);
    switch (kind) {
        case 'hazard': {
            // MUST be H#:
            const ok = lines.every((l) => /^\s*H\d+\s*:/i.test(l) &&
                /\(\s*leads_to\s*:\s*[^)]+\)/i.test(l));
            if (!ok) {
                return 'Expected HAZARD lines like "H#: ... (leads_to: Lx, Ly)".';
            }
            return null;
        }
        case 'loss': {
            // MUST be L#: and must NOT contain mapping parentheses
            const ok = lines.every((l) => /^\s*L\d+\s*:/i.test(l) &&
                !/\(\s*leads_to\s*:/i.test(l) &&
                !/\(\s*addresses\s*:/i.test(l) &&
                !/\(\s*control\s*loop\s*:/i.test(l));
            if (!ok) {
                return 'Expected LOSS lines like "L#: ..." (no leads_to/addresses/control loop).';
            }
            return null;
        }
        case 'safety_constraint': {
            const ok = lines.every((l) => /^\s*SC\d+\s*:/i.test(l) &&
                !/\(\s*leads_to\s*:/i.test(l) &&
                !/\(\s*control\s*loop\s*:/i.test(l));
            if (!ok) {
                return 'Expected SAFETY CONSTRAINT lines like "SC#: ... (addresses: Hx, Hy)".';
            }
            return null;
        }
        case 'refined_hazard': {
            // MUST be "H# refinement:"
            const ok = lines.every((l) => /^\s*H\d+\s+refinement\s*:/i.test(l));
            if (!ok) {
                return 'Expected REFINED HAZARD lines like "H2 refinement: ...".';
            }
            return null;
        }
        case 'uca': {
            // MUST be UCA#:
            const ok = lines.every((l) => /^\s*UCA\d+\s*:/i.test(l) &&
                /\(\s*control\s*loop\s*:\s*LOOP\d+/i.test(l) &&
                /\brelated\s*:\s*H\d+\b/i.test(l));
            if (!ok) {
                return 'Expected UCA lines like "UCA#: ... (control loop: LOOP#; related: H#)".';
            }
            return null;
        }
        case 'controller': {
            const ok = lines.every((l) => (!startsWithAnyId(l) || /^\s*C\d+\s*:/i.test(l)));
            if (!ok) {
                return 'Expected CONTROLLER lines like "C#: ...".';
            }
            return null;
        }
        case 'controlled_process': {
            const ok = lines.every((l) => (!startsWithAnyId(l) || /^\s*P\d+\s*:/i.test(l)));
            if (!ok) {
                return 'Expected CONTROLLED PROCESS lines like "P#: ...".';
            }
            return null;
        }
        case 'actuator': {
            const ok = lines.every((l) => (!startsWithAnyId(l) || /^\s*A\d+\s*:/i.test(l)));
            if (!ok) {
                return 'Expected ACTUATOR lines like "A#: ...".';
            }
            return null;
        }
        case 'sensor': {
            const ok = lines.every((l) => (!startsWithAnyId(l) || /^\s*S\d+\s*:/i.test(l)));
            if (!ok) {
                return 'Expected SENSOR lines like "S#: ...".';
            }
            return null;
        }
        case 'external_system': {
            const ok = lines.every((l) => (!startsWithAnyId(l) || /^\s*X\d+\s*:/i.test(l)));
            if (!ok) {
                return 'Expected EXTERNAL SYSTEM lines like "X#: ...".';
            }
            return null;
        }
        case 'control_action': {
            const ok = lines.every((l) => (!startsWithAnyId(l) || /^\s*CA\d+\s*:/i.test(l)));
            if (!ok) {
                return 'Expected CONTROL ACTION lines like "CA#: ...".';
            }
            return null;
        }
        case 'feedback': {
            const ok = lines.every((l) => (!startsWithAnyId(l) || /^\s*F\d+\s*:/i.test(l)));
            if (!ok) {
                return 'Expected FEEDBACK lines like "F#: ...".';
            }
            return null;
        }
        case 'control_loop': {
            const ok = lines.every((l) => {
                if (startsWithAnyId(l) && !/^\s*LOOP\d+\s*:/i.test(l))
                    return false;
                const hasC = /\bC\d+\b/i.test(l);
                const hasP = /\bP\d+\b/i.test(l);
                const hasCA = /\bCA\d+\b/i.test(l);
                const hasF = /\bF\d+\b/i.test(l);
                return hasC && hasP && hasCA && hasF;
            });
            if (!ok) {
                return 'Expected CONTROL LOOP lines like "LOOP#: ... C# ... P# ... CA# ... F# ...".';
            }
            return null;
        }
        case 'loss_scenario': {
            const ok = lines.every((l) => {
                if (startsWithAnyId(l) && !/^\s*LS\d+\s*:/i.test(l))
                    return false;
                if (/\(\s*leads_to\s*:/i.test(l))
                    return false;
                if (/\(\s*addresses\s*:/i.test(l))
                    return false;
                if (/\(\s*control\s*loop\s*:/i.test(l))
                    return false;
                return true;
            });
            if (!ok) {
                return 'Expected LOSS SCENARIO lines like "LS#: ..." (no leads_to/addresses/control loop).';
            }
            return null;
        }
        default: {
            // Step 2 + Step 4 kinds: if model starts with an ID, it must match the right prefix.
            // (Optional) You can tighten these later.
            return null;
        }
    }
}
const GROUNDING_STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by', 'can', 'could', 'did', 'do', 'does',
    'for', 'from', 'had', 'has', 'have', 'if', 'in', 'into', 'is', 'it', 'its', 'may', 'might', 'more', 'most',
    'not', 'of', 'on', 'or', 'other', 'our', 'out', 'over', 'should', 'so', 'some', 'such', 'than', 'that', 'the',
    'their', 'then', 'there', 'these', 'they', 'this', 'those', 'to', 'under', 'up', 'upon', 'use', 'used', 'using',
    'via', 'was', 'were', 'what', 'when', 'where', 'which', 'while', 'will', 'with', 'within', 'without', 'would',
    'system', 'systems', 'controller', 'controllers', 'process', 'processes', 'control', 'controls', 'action',
    'actions', 'feedback', 'loss', 'losses', 'hazard', 'hazards', 'safety', 'constraint', 'constraints', 'scenario',
    'scenarios', 'related', 'provide', 'provides', 'provided', 'providing', 'during', 'before', 'after', 'about',
]);
function normalizeForMatch(text) {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
}
function tokenizeMeaningfulKeywords(text) {
    const tokens = text.match(/[A-Za-z0-9][A-Za-z0-9_-]*/g) || [];
    const out = [];
    for (const raw of tokens) {
        const token = raw.toLowerCase();
        if (token.length < 4)
            continue;
        if (GROUNDING_STOPWORDS.has(token))
            continue;
        out.push(token);
    }
    return out;
}
function extractSystemDescriptionBlock(docText) {
    const lines = docText.split(/\r?\n/);
    const headingRxs = [
        /^\s*===\s*SYSTEM[\s_]+DESCRIPTION\s*===\s*$/i,
        /^\s*\[\s*SYSTEM_DESCRIPTION\s*\]\s*$/i,
        /^\s*##\s*System\s+Description\s*$/i,
    ];
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (headingRxs.some((rx) => rx.test(lines[i]))) {
            start = i;
            break;
        }
    }
    if (start === -1)
        return '';
    const endRx = /^\s*(\[[^\]]+\]|===\s*.+\s*===|#{1,6}\s+.+)\s*$/i;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (endRx.test(lines[i])) {
            end = i;
            break;
        }
    }
    return lines.slice(start, end).join('\n').trim();
}
function extractSectionBlock(docText, headingRx) {
    const lines = docText.split(/\r?\n/);
    const range = findSectionRangeByHeading(lines, headingRx);
    if (!range)
        return '';
    return lines.slice(range.start, range.end).join('\n').trim();
}
const FALLBACK_HEAD_LINES = 250;
const FALLBACK_PRE_SECTION_LINES = 120;
function extractFallbackSystemContext(docText, headingRx) {
    const lines = docText.split(/\r?\n/);
    const range = findSectionRangeByHeading(lines, headingRx);
    const keep = new Set();
    const headCount = Math.min(FALLBACK_HEAD_LINES, lines.length);
    for (let i = 0; i < headCount; i++)
        keep.add(i);
    if (range) {
        const start = Math.max(0, range.start - FALLBACK_PRE_SECTION_LINES);
        for (let i = start; i < range.start; i++)
            keep.add(i);
        for (let i = range.start; i < range.end; i++)
            keep.add(i);
    }
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        if (keep.has(i))
            out.push(lines[i]);
    }
    return out.join('\n').trim();
}
function isEntityToken(token) {
    if (!token)
        return false;
    if (/\d/.test(token))
        return true;
    if (/^[A-Z0-9_-]{2,}$/.test(token))
        return true;
    return /^[A-Z][a-z0-9_-]+$/.test(token);
}
function extractEntityPhrases(systemDescription) {
    const phrases = new Set();
    const addPhrase = (raw) => {
        const normalized = normalizeForMatch(raw);
        if (normalized.length < 3)
            return;
        const words = normalized.split(' ').filter(Boolean);
        if (!words.length)
            return;
        if (words.every((w) => GROUNDING_STOPWORDS.has(w)))
            return;
        phrases.add(normalized);
    };
    const doubleQuoteRx = /"([^"]{3,})"/g;
    let m = doubleQuoteRx.exec(systemDescription);
    while (m) {
        addPhrase(m[1]);
        m = doubleQuoteRx.exec(systemDescription);
    }
    const singleQuoteRx = /'([^']{3,})'/g;
    m = singleQuoteRx.exec(systemDescription);
    while (m) {
        addPhrase(m[1]);
        m = singleQuoteRx.exec(systemDescription);
    }
    const tokens = systemDescription.match(/[A-Za-z0-9][A-Za-z0-9_-]*/g) || [];
    let current = [];
    const flush = () => {
        if (!current.length)
            return;
        if (current.length >= 2) {
            addPhrase(current.join(' '));
        }
        else {
            addPhrase(current[0]);
        }
        current = [];
    };
    for (const token of tokens) {
        if (isEntityToken(token)) {
            current.push(token);
        }
        else {
            flush();
        }
    }
    flush();
    return Array.from(phrases);
}
function validateAddGrounding(lines, systemContext, currentSection) {
    const contextText = `${systemContext}\n${currentSection}`.trim();
    const contextKeywords = tokenizeMeaningfulKeywords(contextText);
    const contextSet = new Set(contextKeywords);
    const entityPhrases = extractEntityPhrases(contextText);
    if (contextSet.size === 0 && entityPhrases.length === 0) {
        return null;
    }
    for (const line of lines) {
        const normalizedLine = normalizeForMatch(line);
        let grounded = false;
        if (entityPhrases.length) {
            grounded = entityPhrases.some((phrase) => normalizedLine.includes(phrase));
        }
        if (!grounded) {
            const lineTokens = tokenizeMeaningfulKeywords(line);
            let matches = 0;
            const seen = new Set();
            for (const token of lineTokens) {
                if (contextSet.has(token) && !seen.has(token)) {
                    seen.add(token);
                    matches += 1;
                    if (matches >= 2)
                        break;
                }
            }
            grounded = matches >= 2;
        }
        if (!grounded) {
            return 'Generated line is not grounded in the System Description or current section.';
        }
    }
    return null;
}
function buildAddGroundingContext(docText, headingRx) {
    const currentSection = extractSectionBlock(docText, headingRx);
    const systemDescription = extractSystemDescriptionBlock(docText);
    if (systemDescription) {
        return { systemContext: systemDescription, currentSection };
    }
    return { systemContext: extractFallbackSystemContext(docText, headingRx), currentSection };
}
function buildAddPrompt(kind, userInstruction, docText, grounding) {
    const meta = exports.KIND_META[kind];
    const section = meta.section;
    const context = grounding ?? buildAddGroundingContext(docText, meta.headingRx);
    const rulesByKind = {
        loss: [
            '- Output a short, clear loss statement.',
            '- No extra parentheses required.',
        ],
        hazard: [
            '- Hazard line MUST end with "(leads_to: Lx, Ly)". Use existing Loss IDs from the document when possible.',
            '- Keep it one sentence, system-level (no root cause analysis).',
        ],
        safety_constraint: [
            '- Safety constraint line SHOULD end with "(addresses: Hx, Hy)". Use existing Hazard IDs when possible.',
            '- Phrase as a constraint ("The system shall..."/"The controller shall not...").',
        ],
        refined_hazard: [
            '- Output exactly one refinement line for the specified Hazard ID.',
            '- Use the format: "H#: refinement: <refinement text>"',
            '- Keep it minimal (ODD/context refinement only).',
        ],
        controller: ['- Define the controller entity in one short line.'],
        controlled_process: ['- Define the controlled process entity in one short line.'],
        actuator: ['- Define the actuator entity in one short line.'],
        sensor: ['- Define the sensor entity in one short line.'],
        external_system: ['- Define the external system entity in one short line.'],
        control_action: ['- Define a control action in one short line (verb + object).'],
        feedback: ['- Define a feedback item in one short line (returned information).'],
        control_loop: ['- Define a control loop in one short line, consistent with the document style.'],
        uca: [
            '- UCA line MUST end with "(control loop: LOOP#; related: H#)". Use existing IDs when possible.',
            '- Keep it operational: "controller provides/does not provide CA# under context..."',
        ],
        loss_scenario: [
            '- Define a loss scenario in one concise line.',
            '- Do NOT add hazards/ucas here; keep it a scenario statement.',
        ],
    };
    const exampleByKind = {
        loss: 'L6: Injury to a patient due to incorrect dosage.',
        hazard: 'H7: The system administers medication inconsistent with the prescription. (leads_to: L1, L6)',
        safety_constraint: 'SC3: The system shall not administer medication unless the verified prescription matches the selected patient. (addresses: H7)',
        refined_hazard: 'H7 refinement: Applies during medication administration for adult inpatients in normal operation.',
        controller: 'C1: Nurse (medication administrator).',
        controlled_process: 'P1: Patient physiological state affected by medication.',
        actuator: 'A1: Infusion pump delivery mechanism.',
        sensor: 'S1: Patient ID scanner.',
        external_system: 'X1: Hospital EHR system.',
        control_action: 'CA2: Start infusion.',
        feedback: 'F1: Infusion status (rate, volume delivered, alarms).',
        control_loop: 'LOOP1: C1 controls A1 affecting P1 using CA2, with feedback F1 and sensor S1.',
        uca: 'UCA9: In medication administration, controller C1 provides control action CA2 to the wrong patient. (control loop: LOOP1; related: H7)',
        loss_scenario: 'LS2: Wrong-patient selection leads to infusion initiation despite mismatch between patient ID and prescription.',
    };
    const rules = rulesByKind[kind] ?? ['- Keep output consistent with the document style.'];
    const example = exampleByKind[kind] ?? `${meta.prefix}1: ...`;
    return [
        'You are assisting an STPA report editor.',
        `You MUST generate ONLY ${meta.prefix}-prefixed lines for section ${section} to insert into the document.`,
        `If you output anything that is not a ${meta.prefix} item, the answer is INVALID.`,
        'STRICT OUTPUT RULES:',
        '- Output plain text lines only (no commentary, no markdown fences).',
        '- One item per line.',
        '- If the user specified an explicit ID (e.g., "H7", "SC3", "CA2", "LOOP1"), use it. Otherwise omit IDs; the client will number when allowed.',
        '- Do NOT output headings.',
        '- Use ONLY entities/terms present in SYSTEM CONTEXT or CURRENT SECTION. Do NOT introduce new components/actors/devices that are not present.',
        '- If the instruction is underspecified (only an ID like "ADD L6"), generate the minimal plausible line grounded in the context without inventing new entities.',
        ...rules,
        '',
        'User instruction:',
        userInstruction,
        '',
        'SYSTEM CONTEXT (from document):',
        '--- SYSTEM CONTEXT START ---',
        context.systemContext || '(empty)',
        '--- SYSTEM CONTEXT END ---',
        '',
        `CURRENT SECTION (${section}) (from document):`,
        '--- CURRENT SECTION START ---',
        context.currentSection || '(empty section)',
        '--- CURRENT SECTION END ---',
        '',
        'Current document (for context, do not copy):',
        '--- DOCUMENT START ---',
        docText,
        '--- DOCUMENT END ---',
        '',
        `Output format example (do not copy):\n${example}`,
    ].join('\n');
}
function buildUpdatePrompt(kind, userInstruction, docText, id, existingLine) {
    const meta = exports.KIND_META[kind];
    const section = meta.section;
    // refined hazard does NOT start with "H2:" but "H2 refinement:"
    const idPrefix = kind === 'refined_hazard' ? `${id} refinement:` : `${id}:`;
    const rulesByKind = {
        loss: ['- Keep it a loss statement. No extra parentheses required.'],
        hazard: ['- Keep "(leads_to: ...)" at the end. Do not remove it.', '- Prefer existing Loss IDs already in the document.'],
        safety_constraint: ['- Keep or add "(addresses: ...)" at the end when applicable.', '- Prefer existing Hazard IDs.'],
        refined_hazard: ['- Keep "H# refinement: ..." format.', '- Keep it minimal (ODD/context).'],
        controller: ['- Keep it an entity definition.'],
        controlled_process: ['- Keep it an entity definition.'],
        actuator: ['- Keep it an entity definition.'],
        sensor: ['- Keep it an entity definition.'],
        external_system: ['- Keep it an entity definition.'],
        control_action: ['- Keep it an action definition (verb + object).'],
        feedback: ['- Keep it a feedback definition.'],
        control_loop: ['- Keep it a control loop definition, consistent with the document style.'],
        uca: ['- Keep "(control loop: ...; related: H#)" at the end.', '- Keep the operational unsafe action framing.'],
        loss_scenario: ['- Keep it a scenario statement; do not add new IDs or other items.'],
    };
    const rules = rulesByKind[kind] ?? ['- Keep mapping/format consistent with the document style.'];
    return [
        'You are assisting an STPA report editor.',
        `Task: UPDATE exactly one existing line in section ${section} while keeping the same ID.`,
        'STRICT OUTPUT RULES:',
        `- Output exactly ONE line that starts with "${idPrefix}".`,
        '- Output plain text only (no commentary, no markdown fences).',
        '- Do NOT invent new IDs.',
        ...rules,
        '',
        'User instruction:',
        userInstruction,
        '',
        `Existing line to update (must be replaced):\n${existingLine}`,
        '',
        'Current document context (do not copy):',
        '--- DOCUMENT START ---',
        docText,
        '--- DOCUMENT END ---',
    ].join('\n');
}
async function llmGenerateLinesWithRetry(openai, prompt, kind, extraValidator) {
    // Try up to 2 times: initial + 1 retry if validation fails
    let lastRaw = '';
    for (let attempt = 0; attempt < 2; attempt++) {
        const resp = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: attempt === 0 ? 0.2 : 0.0,
            messages: [
                { role: 'user', content: attempt === 0 ? prompt : `${prompt}\n\nCRITICAL: Your previous output violated the rules. Try again and follow the STRICT OUTPUT RULES exactly.` },
            ],
        });
        lastRaw = resp.choices?.[0]?.message?.content?.trim() || '';
        const lines = normalizeGeneratedLines(lastRaw);
        const err = validateGeneratedLines(kind, lines) || (extraValidator ? extraValidator(lines) : null);
        if (!err) {
            return lines;
        }
    }
    // If still bad, return the last normalized lines and let caller throw a helpful error
    return normalizeGeneratedLines(lastRaw);
}
function makePlanId() {
    return `plan_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function parseIdList(text) {
    return text.split(',').map((x) => x.trim()).filter(Boolean);
}
function parseStep1(docText) {
    const lines = docText.split(/\r?\n/);
    const lossesRange = findSectionRangeByHeading(lines, exports.KIND_META.loss.headingRx);
    const hazardsRange = findSectionRangeByHeading(lines, exports.KIND_META.hazard.headingRx);
    const constraintsRange = findSectionRangeByHeading(lines, exports.KIND_META.safety_constraint.headingRx);
    const refinedRange = findSectionRangeByHeading(lines, exports.KIND_META.refined_hazard.headingRx);
    const losses = [];
    if (lossesRange) {
        for (let i = lossesRange.start + 1; i < lossesRange.end; i++) {
            const m = lines[i].match(/^\s*(L\d+)\s*:\s*(.+)\s*$/i);
            if (m)
                losses.push({ id: m[1].toUpperCase(), line: lines[i] });
        }
    }
    const hazards = [];
    if (hazardsRange) {
        for (let i = hazardsRange.start + 1; i < hazardsRange.end; i++) {
            const m = lines[i].match(/^\s*(H\d+)\s*:\s*(.+?)\s*\(\s*leads_to\s*:\s*([^\)]*)\)\s*$/i);
            if (m)
                hazards.push({ id: m[1].toUpperCase(), line: lines[i], leadsTo: parseIdList(m[3]).map((x) => x.toUpperCase()) });
        }
    }
    const constraints = [];
    if (constraintsRange) {
        for (let i = constraintsRange.start + 1; i < constraintsRange.end; i++) {
            const m = lines[i].match(/^\s*(SC\d+)\s*:\s*(.+?)\s*\(\s*addresses\s*:\s*([^\)]*)\)\s*$/i);
            if (m)
                constraints.push({ id: m[1].toUpperCase(), line: lines[i], addresses: parseIdList(m[3]).map((x) => x.toUpperCase()) });
        }
    }
    const refined = [];
    if (refinedRange) {
        for (let i = refinedRange.start + 1; i < refinedRange.end; i++) {
            const m = lines[i].match(/^\s*(H\d+)\s+refinement\s*:\s*(.+)\s*$/i);
            if (m)
                refined.push({ hazardId: m[1].toUpperCase(), line: lines[i] });
        }
    }
    const hasStep1 = Boolean(lossesRange && hazardsRange && constraintsRange);
    return { losses, hazards, constraints, refined, hasStep1 };
}
function normalizeStep1Text(docText, opts) {
    const trailingNewlineMatch = docText.match(/(\r?\n)+$/);
    const trailingNewline = trailingNewlineMatch ? trailingNewlineMatch[0] : '';
    const baseText = trailingNewline ? docText.slice(0, docText.length - trailingNewline.length) : docText;
    const lines = baseText.split(/\r?\n/);
    const lineBreak = docText.includes('\r\n') ? '\r\n' : '\n';
    const lossesRange = findSectionRangeByHeading(lines, exports.KIND_META.loss.headingRx);
    const hazardsRange = findSectionRangeByHeading(lines, exports.KIND_META.hazard.headingRx);
    const constraintsRange = findSectionRangeByHeading(lines, exports.KIND_META.safety_constraint.headingRx);
    const refinedRange = findSectionRangeByHeading(lines, exports.KIND_META.refined_hazard.headingRx);
    if (!lossesRange || !hazardsRange || !constraintsRange) {
        return { text: docText, changed: false };
    }
    const renumber = opts?.renumber !== false;
    const lossIdMap = new Map();
    const hazardIdMap = new Map();
    const lossLineRx = /^(\s*)(L\d+)(\s*:\s*)(.+)\s*$/i;
    const hazardLineRx = /^(\s*)(H\d+)(\s*:\s*)(.+?)(\s*)\(\s*leads_to\s*:\s*([^\)]*)\)\s*$/i;
    const constraintLineRx = /^(\s*)(SC\d+)(\s*:\s*)(.+?)(\s*)\(\s*addresses\s*:\s*([^\)]*)\)\s*$/i;
    const refinedLineRx = /^(\s*)(H\d+)(\s+refinement\s*:\s*)(.+)\s*$/i;
    let lossIdx = 1;
    for (let i = lossesRange.start + 1; i < lossesRange.end; i++) {
        const m = lines[i].match(lossLineRx);
        if (!m)
            continue;
        const oldId = m[2].toUpperCase();
        const newId = renumber ? `L${lossIdx++}` : oldId;
        lossIdMap.set(oldId, newId);
        if (oldId !== newId) {
            lines[i] = lines[i].replace(/^(\s*)L\d+(\s*:\s*)/i, `$1${newId}$2`);
        }
    }
    let hazardIdx = 1;
    for (let i = hazardsRange.start + 1; i < hazardsRange.end; i++) {
        const m = lines[i].match(hazardLineRx);
        if (!m)
            continue;
        const oldId = m[2].toUpperCase();
        const newId = renumber ? `H${hazardIdx++}` : oldId;
        hazardIdMap.set(oldId, newId);
        const leadsRaw = parseIdList(m[6]).map((x) => x.toUpperCase());
        const mapped = leadsRaw.map((id) => lossIdMap.get(id)).filter(Boolean);
        const leadsText = mapped.join(', ');
        const rebuilt = `${m[1]}${newId}${m[3]}${m[4]}${m[5]}(leads_to: ${leadsText})`;
        if (lines[i] !== rebuilt) {
            lines[i] = rebuilt;
        }
    }
    let constraintIdx = 1;
    for (let i = constraintsRange.start + 1; i < constraintsRange.end; i++) {
        const m = lines[i].match(constraintLineRx);
        if (!m)
            continue;
        const oldId = m[2].toUpperCase();
        const newId = renumber ? `SC${constraintIdx++}` : oldId;
        const addrRaw = parseIdList(m[6]).map((x) => x.toUpperCase());
        const mapped = addrRaw.map((id) => hazardIdMap.get(id)).filter(Boolean);
        const addrText = mapped.join(', ');
        const rebuilt = `${m[1]}${newId}${m[3]}${m[4]}${m[5]}(addresses: ${addrText})`;
        if (lines[i] !== rebuilt) {
            lines[i] = rebuilt;
        }
    }
    if (refinedRange) {
        for (let i = refinedRange.start + 1; i < refinedRange.end; i++) {
            const m = lines[i].match(refinedLineRx);
            if (!m)
                continue;
            const oldId = m[2].toUpperCase();
            const newId = hazardIdMap.get(oldId);
            if (newId && newId !== oldId) {
                lines[i] = lines[i].replace(/^(\s*)H\d+(\s+refinement\s*:\s*)/i, `$1${newId}$2`);
            }
        }
    }
    const nextText = lines.join(lineBreak) + trailingNewline;
    return { text: nextText, changed: nextText !== docText };
}
async function normalizeStep1InEditor(editor) {
    const before = editor.document.getText();
    const normalized = normalizeStep1Text(before, { renumber: true });
    if (!normalized.changed)
        return false;
    const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(before.length));
    await editor.edit((ed) => {
        ed.replace(fullRange, normalized.text);
    });
    return true;
}
function normalizeStep2Text(docText, opts) {
    const trailingNewlineMatch = docText.match(/(\r?\n)+$/);
    const trailingNewline = trailingNewlineMatch ? trailingNewlineMatch[0] : '';
    const baseText = trailingNewline ? docText.slice(0, docText.length - trailingNewline.length) : docText;
    const lines = baseText.split(/\r?\n/);
    const lineBreak = docText.includes('\r\n') ? '\r\n' : '\n';
    const renumber = opts?.renumber !== false;
    let changed = false;
    const step2Kinds = [
        'controller',
        'controlled_process',
        'actuator',
        'sensor',
        'external_system',
        'control_action',
        'feedback',
        'control_loop',
    ];
    for (const kind of step2Kinds) {
        const meta = exports.KIND_META[kind];
        const range = findSectionRangeByHeading(lines, meta.headingRx);
        if (!range)
            continue;
        const escaped = meta.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const lineRx = new RegExp(`^(\\s*)(${escaped}\\d+)(\\s*:\\s*)(.*)$`, 'i');
        let idx = 1;
        for (let i = range.start + 1; i < range.end; i++) {
            const m = lines[i].match(lineRx);
            if (!m)
                continue;
            const oldId = m[2].toUpperCase();
            const newId = renumber ? `${meta.prefix}${idx++}` : oldId;
            const rebuilt = `${m[1]}${newId}${m[3]}${m[4]}`;
            if (lines[i] !== rebuilt) {
                lines[i] = rebuilt;
                changed = true;
            }
        }
    }
    const nextText = lines.join(lineBreak) + trailingNewline;
    return { text: nextText, changed: changed || nextText !== docText };
}
function normalizeUcaText(docText, opts) {
    const trailingNewlineMatch = docText.match(/(\r?\n)+$/);
    const trailingNewline = trailingNewlineMatch ? trailingNewlineMatch[0] : '';
    const baseText = trailingNewline ? docText.slice(0, docText.length - trailingNewline.length) : docText;
    const lines = baseText.split(/\r?\n/);
    const lineBreak = docText.includes('\r\n') ? '\r\n' : '\n';
    const ucaRange = findSectionRangeByHeading(lines, exports.KIND_META.uca.headingRx);
    if (!ucaRange) {
        return { text: docText, changed: false };
    }
    const renumber = opts?.renumber !== false;
    const ucaLineRx = /^(\s*)(UCA\d+)(\s*:\s*)(.*)$/i;
    let ucaIdx = 1;
    let changed = false;
    for (let i = ucaRange.start + 1; i < ucaRange.end; i++) {
        const m = lines[i].match(ucaLineRx);
        if (!m)
            continue;
        const oldId = m[2].toUpperCase();
        const newId = renumber ? `UCA${ucaIdx++}` : oldId;
        const rebuilt = `${m[1]}${newId}${m[3]}${m[4]}`;
        if (lines[i] !== rebuilt) {
            lines[i] = rebuilt;
            changed = true;
        }
    }
    const nextText = lines.join(lineBreak) + trailingNewline;
    return { text: nextText, changed: changed || nextText !== docText };
}
async function normalizeStep2InEditor(editor) {
    const before = editor.document.getText();
    const normalized = normalizeStep2Text(before, { renumber: true });
    if (!normalized.changed)
        return false;
    const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(before.length));
    await editor.edit((ed) => {
        ed.replace(fullRange, normalized.text);
    });
    return true;
}
async function normalizeUcaInEditor(editor) {
    const before = editor.document.getText();
    const normalized = normalizeUcaText(before, { renumber: true });
    if (!normalized.changed)
        return false;
    const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(before.length));
    await editor.edit((ed) => {
        ed.replace(fullRange, normalized.text);
    });
    return true;
}
async function normalizeAfterEdit(editor) {
    await normalizeStep1InEditor(editor);
    await normalizeStep2InEditor(editor);
    await normalizeUcaInEditor(editor);
    warnStep2ControlLoopRefs(editor.document.getText());
}
function checkStep1Consistency(p) {
    const lossToHaz = new Map();
    for (const l of p.losses) {
        lossToHaz.set(l.id, 0);
    }
    for (const h of p.hazards) {
        for (const l of h.leadsTo) {
            if (lossToHaz.has(l))
                lossToHaz.set(l, (lossToHaz.get(l) || 0) + 1);
        }
    }
    const lossesWithoutHazards = [...lossToHaz.entries()].filter(([, c]) => c === 0).map(([id]) => id);
    const hazardToSc = new Map();
    for (const h of p.hazards) {
        hazardToSc.set(h.id, 0);
    }
    for (const sc of p.constraints) {
        for (const h of sc.addresses) {
            if (hazardToSc.has(h))
                hazardToSc.set(h, (hazardToSc.get(h) || 0) + 1);
        }
    }
    const hazardsWithoutConstraints = [...hazardToSc.entries()].filter(([, c]) => c === 0).map(([id]) => id);
    return { lossesWithoutHazards, hazardsWithoutConstraints };
}
function collectStep2Ids(lines, kind) {
    const meta = exports.KIND_META[kind];
    const range = findSectionRangeByHeading(lines, meta.headingRx);
    const ids = new Set();
    if (!range)
        return ids;
    const escaped = meta.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lineRx = new RegExp(`^\\s*(${escaped}\\d+)\\s*:\\s*`, 'i');
    for (let i = range.start + 1; i < range.end; i++) {
        const m = lines[i].match(lineRx);
        if (m)
            ids.add(m[1].toUpperCase());
    }
    return ids;
}
function warnStep2ControlLoopRefs(docText) {
    const lines = docText.split(/\r?\n/);
    const loopRange = findSectionRangeByHeading(lines, exports.KIND_META.control_loop.headingRx);
    if (!loopRange)
        return;
    const sets = {
        C: collectStep2Ids(lines, 'controller'),
        P: collectStep2Ids(lines, 'controlled_process'),
        A: collectStep2Ids(lines, 'actuator'),
        S: collectStep2Ids(lines, 'sensor'),
        X: collectStep2Ids(lines, 'external_system'),
        CA: collectStep2Ids(lines, 'control_action'),
        F: collectStep2Ids(lines, 'feedback'),
        LOOP: collectStep2Ids(lines, 'control_loop'),
    };
    const missing = [];
    const tokenRx = /\b(LOOP|CA|C|P|A|S|X|F)\d+\b/gi;
    for (let i = loopRange.start + 1; i < loopRange.end; i++) {
        const line = lines[i];
        const tokens = line.match(tokenRx) || [];
        for (const t of tokens) {
            const upper = t.toUpperCase();
            if (upper.startsWith('LOOP')) {
                if (!sets.LOOP.has(upper))
                    missing.push(upper);
                continue;
            }
            if (upper.startsWith('CA')) {
                if (!sets.CA.has(upper))
                    missing.push(upper);
                continue;
            }
            const key = upper.slice(0, 1);
            if (!sets[key].has(upper))
                missing.push(upper);
        }
    }
    if (missing.length) {
        const unique = Array.from(new Set(missing)).sort();
        console.warn(`Step 2 consistency: CONTROL_LOOPS reference missing IDs: ${unique.join(', ')}`);
    }
}
function extractFirstJsonObject(raw) {
    const cleaned = raw.replace(/```[\s\S]*?```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        return null;
    }
    const candidate = cleaned.slice(start, end + 1);
    try {
        return JSON.parse(candidate);
    }
    catch {
        return null;
    }
}
function buildStep1RepairPrompt(docText, issues) {
    return [
        'You are an expert STPA editor.',
        'Task: propose a MINIMAL add-only plan to complete missing Step 1 items after an edit.',
        'You MUST follow these rules:',
        '- Do NOT rewrite or replace any existing lines.',
        '- Only propose ADD actions.',
        '- Only target HAZARDS or SAFETY_CONSTRAINTS sections.',
        '- For each missing Loss, you may propose ONE new Hazard that references it.',
        '- For each missing Hazard, you may propose ONE new Safety Constraint that addresses it.',
        '- Use the existing house style for lines (including leads_to / addresses).',
        '',
        'Return ONLY valid JSON with this schema:',
        '{',
        '  "title": "...",',
        '  "summary": "...",',
        '  "actions": [',
        '    { "op": "add", "section": "HAZARDS|SAFETY_CONSTRAINTS", "lines": ["..."] }',
        '  ]',
        '}',
        '',
        'Issues found:',
        JSON.stringify(issues, null, 2),
        '',
        'Current document:',
        '--- DOCUMENT START ---',
        docText,
        '--- DOCUMENT END ---',
    ].join('\n');
}
function validateStep1Plan(plan) {
    if (!plan.actions || !plan.actions.length) {
        return 'Plan has no actions.';
    }
    for (const action of plan.actions) {
        if (action.op !== 'add') {
            return 'Only add actions are permitted.';
        }
        if (!['HAZARDS', 'SAFETY_CONSTRAINTS'].includes(action.section)) {
            return 'Plan targets a non-Step-1 completion section.';
        }
        if (!Array.isArray(action.lines) || action.lines.length === 0) {
            return 'Add action has no lines.';
        }
        for (const line of action.lines) {
            if (typeof line !== 'string' || !line.trim()) {
                return 'Add action contains an empty line.';
            }
            if (/^===\s*.+\s*===\s*$/i.test(line)) {
                return 'Add action contains a heading.';
            }
            if (action.section === 'HAZARDS') {
                if (!/^\s*H\d+\s*:/i.test(line)) {
                    return 'Hazard lines must start with H#.';
                }
                if (!/\(\s*leads_to\s*:\s*L\d+/i.test(line)) {
                    return 'Hazard lines must include leads_to with at least one Loss ID.';
                }
            }
            if (action.section === 'SAFETY_CONSTRAINTS') {
                if (!/^\s*SC\d+\s*:/i.test(line)) {
                    return 'Safety constraint lines must start with SC#.';
                }
                if (!/\(\s*addresses\s*:\s*H\d+/i.test(line)) {
                    return 'Safety constraint lines must include addresses with at least one Hazard ID.';
                }
            }
        }
    }
    return null;
}
function parseRelatedHazardsFromUca(line) {
    const parenMatch = line.match(/\(([^)]*)\)/);
    const target = parenMatch ? parenMatch[1] : line;
    const ids = target.match(/\bH\d+\b/gi) || [];
    return ids.map((x) => x.toUpperCase());
}
function findFirstControlLoopId(lines) {
    const loopRange = findSectionRangeByHeading(lines, exports.KIND_META.control_loop.headingRx);
    if (loopRange) {
        for (let i = loopRange.start + 1; i < loopRange.end; i++) {
            const m = lines[i].match(/\bLOOP(\d+)\b/i);
            if (m)
                return `LOOP${m[1]}`;
        }
    }
    return null;
}
function checkStep2Consistency(docText) {
    const parsed = parseStep1(docText);
    if (!parsed.hasStep1) {
        return { hazardsWithoutUcas: [] };
    }
    const lines = docText.split(/\r?\n/);
    const ucaRange = findSectionRangeByHeading(lines, exports.KIND_META.uca.headingRx);
    const relatedSet = new Set();
    if (ucaRange) {
        for (let i = ucaRange.start + 1; i < ucaRange.end; i++) {
            for (const h of parseRelatedHazardsFromUca(lines[i])) {
                relatedSet.add(h);
            }
        }
    }
    const hazardsWithoutUcas = parsed.hazards
        .map((h) => h.id)
        .filter((id) => !relatedSet.has(id));
    return { hazardsWithoutUcas };
}
function buildStep2CompletionPrompt(docText, issues, loopId) {
    return [
        'You are an expert STPA editor.',
        'Task: propose a MINIMAL add-only plan to complete missing Step 2 UCAs.',
        'You MUST follow these rules:',
        '- Do NOT rewrite or replace any existing lines.',
        '- Only propose ADD actions.',
        '- Only target the UCAS section.',
        '- Each line MUST follow: "UCA#: <text> (control loop: LOOP#; related: H#)".',
        `- Use control loop ID: ${loopId}.`,
        '',
        'Return ONLY valid JSON with this schema:',
        '{',
        '  "title": "...",',
        '  "summary": "...",',
        '  "actions": [',
        '    { "op": "add", "section": "UCAS", "lines": ["..."] }',
        '  ]',
        '}',
        '',
        'Issues found:',
        JSON.stringify(issues, null, 2),
        '',
        'Current document:',
        '--- DOCUMENT START ---',
        docText,
        '--- DOCUMENT END ---',
    ].join('\n');
}
function validateStep2Plan(plan) {
    if (!plan.actions || !plan.actions.length) {
        return 'Plan has no actions.';
    }
    for (const action of plan.actions) {
        if (action.op !== 'add') {
            return 'Only add actions are permitted.';
        }
        if (action.section !== 'UCAS') {
            return 'Plan targets a non-UCAS section.';
        }
        if (!Array.isArray(action.lines) || action.lines.length === 0) {
            return 'Add action has no lines.';
        }
        for (const line of action.lines) {
            if (typeof line !== 'string' || !line.trim()) {
                return 'Add action contains an empty line.';
            }
            if (/^===\s*.+\s*===\s*$/i.test(line)) {
                return 'Add action contains a heading.';
            }
            if (!/^\s*UCA\d+\s*:/i.test(line)) {
                return 'UCA lines must start with UCA#.';
            }
            if (!/\(\s*control\s*loop\s*:\s*LOOP\d+\s*;\s*related\s*:\s*H\d+/i.test(line)) {
                return 'UCA lines must include control loop and related hazard.';
            }
        }
    }
    return null;
}
async function proposeStep1RepairPlan(openai, docText) {
    const parsed = parseStep1(docText);
    if (!parsed.hasStep1) {
        return undefined;
    }
    const issues = checkStep1Consistency(parsed);
    const hasMissing = issues.lossesWithoutHazards.length > 0 ||
        issues.hazardsWithoutConstraints.length > 0;
    if (!hasMissing) {
        return undefined;
    }
    const prompt = buildStep1RepairPrompt(docText, issues);
    const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
    });
    const raw = resp.choices?.[0]?.message?.content?.trim() || '';
    const json = extractFirstJsonObject(raw);
    if (!json || typeof json !== 'object') {
        return undefined;
    }
    const title = typeof json.title === 'string' ? json.title : 'Step 1 completion suggestions';
    const summary = typeof json.summary === 'string' ? json.summary : 'Proposed minimal additions to keep Step 1 complete.';
    const actions = Array.isArray(json.actions) ? json.actions : [];
    const normalized = [];
    for (const a of actions) {
        if (!a || typeof a !== 'object')
            continue;
        if (a.op === 'add' && typeof a.section === 'string' && Array.isArray(a.lines)) {
            const section = a.section;
            if (!['HAZARDS', 'SAFETY_CONSTRAINTS'].includes(section))
                continue;
            const lines = a.lines.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
            if (!lines.length)
                continue;
            normalized.push({ op: 'add', section, lines, note: typeof a.note === 'string' ? a.note : undefined });
        }
    }
    if (!normalized.length) {
        return undefined;
    }
    const plan = { id: makePlanId(), title, summary, actions: normalized };
    const planErr = validateStep1Plan(plan);
    if (planErr) {
        console.warn(`Step 1 plan rejected: ${planErr}`);
        return undefined;
    }
    return plan;
}
async function proposeStep2CompletionPlan(openai, docText) {
    const lines = docText.split(/\r?\n/);
    const ucaRange = findSectionRangeByHeading(lines, exports.KIND_META.uca.headingRx);
    if (!ucaRange) {
        return undefined;
    }
    const hasAnyUca = lines
        .slice(ucaRange.start + 1, ucaRange.end)
        .some((l) => /^\s*UCA\d+\s*:/i.test(l));
    if (!hasAnyUca) {
        return undefined;
    }
    const issues = checkStep2Consistency(docText);
    if (!issues.hazardsWithoutUcas.length) {
        return undefined;
    }
    const loopId = findFirstControlLoopId(lines);
    if (!loopId) {
        return undefined;
    }
    const prompt = buildStep2CompletionPrompt(docText, issues, loopId);
    const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
    });
    const raw = resp.choices?.[0]?.message?.content?.trim() || '';
    const json = extractFirstJsonObject(raw);
    if (!json || typeof json !== 'object') {
        return undefined;
    }
    const title = typeof json.title === 'string' ? json.title : 'Step 2 completion suggestions';
    const summary = typeof json.summary === 'string' ? json.summary : 'Proposed minimal additions to cover missing UCAs.';
    const actions = Array.isArray(json.actions) ? json.actions : [];
    const normalized = [];
    for (const a of actions) {
        if (!a || typeof a !== 'object')
            continue;
        if (a.op === 'add' && typeof a.section === 'string' && Array.isArray(a.lines)) {
            const section = a.section;
            if (section !== 'UCAS')
                continue;
            const lines = a.lines.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
            if (!lines.length)
                continue;
            normalized.push({ op: 'add', section, lines, note: typeof a.note === 'string' ? a.note : undefined });
        }
    }
    if (!normalized.length) {
        return undefined;
    }
    const plan = { id: makePlanId(), title, summary, actions: normalized };
    const planErr = validateStep2Plan(plan);
    if (planErr) {
        console.warn(`Step 2 plan rejected: ${planErr}`);
        return undefined;
    }
    return plan;
}
/* ==========================================================
   Apply a pending plan (deterministic edits; no LLM)
   ========================================================== */
async function applySmartEditPlan(plan) {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        throw new Error('No active editor to edit.');
    const before = editor.document.getText();
    const lines = before.split(/\r?\n/);
    const hasUcas = plan.actions.some((action) => action.section === 'UCAS');
    const planErr = hasUcas ? validateStep2Plan(plan) : validateStep1Plan(plan);
    if (planErr) {
        console.warn(`${hasUcas ? 'Step 2' : 'Step 1'} plan rejected: ${planErr}`);
        throw new Error(`Invalid ${hasUcas ? 'Step 2' : 'Step 1'} plan: ${planErr}`);
    }
    if (plan.scope) {
        const allowed = new Set(plan.scope.allowedSections);
        for (const action of plan.actions) {
            if (!allowed.has(action.section)) {
                throw new Error(`Safety scope violation: action targets section "${action.section}" outside allowed scope for Step ${plan.scope.step}.`);
            }
        }
    }
    const applied = [];
    const ranges = [];
    await editor.edit((ed) => {
        for (const action of plan.actions) {
            if (action.op === 'add') {
                const meta = exports.KIND_META[action.section === 'LOSSES'
                    ? 'loss'
                    : action.section === 'HAZARDS'
                        ? 'hazard'
                        : action.section === 'SAFETY_CONSTRAINTS'
                            ? 'safety_constraint'
                            : action.section === 'UCAS'
                                ? 'uca'
                                : 'refined_hazard'];
                const insertAt = findInsertLineInSection(lines, meta);
                const guidedRange = plan.scope ? findGuidedStepBodyRange(lines, plan.scope.step) : null;
                if (plan.scope && !guidedRange) {
                    throw new Error(`Guided Step ${plan.scope.step} heading not found in the document.`);
                }
                if (guidedRange && (insertAt < guidedRange.start || insertAt >= guidedRange.end)) {
                    throw new Error(`Insert position is outside the guided step scope (Step ${plan.scope?.step}).`);
                }
                const pos = new vscode.Position(insertAt, 0);
                const text = action.lines.join('\n') + '\n';
                ed.insert(pos, text);
                lines.splice(insertAt, 0, ...action.lines);
                const endPos = endPositionFromText(pos, text);
                ranges.push(new vscode.Range(pos, endPos));
                applied.push(...action.lines);
                continue;
            }
            if (action.op === 'replace') {
                const idx = lines.findIndex((l) => l === action.match);
                if (idx === -1)
                    continue;
                const start = new vscode.Position(idx, 0);
                const end = new vscode.Position(idx, lines[idx].length);
                ed.replace(new vscode.Range(start, end), action.replacement);
                lines[idx] = action.replacement;
                ranges.push(new vscode.Range(start, new vscode.Position(idx, action.replacement.length)));
                applied.push(action.replacement);
                continue;
            }
            if (action.op === 'delete') {
                const idx = lines.findIndex((l) => l === action.match);
                if (idx === -1) {
                    continue;
                }
                const start = new vscode.Position(idx, 0);
                const end = idx < lines.length - 1 ? new vscode.Position(idx + 1, 0) : new vscode.Position(idx, lines[idx].length);
                ed.delete(new vscode.Range(start, end));
                const removed = lines[idx];
                lines.splice(idx, 1);
                applied.push(`Deleted: ${removed}`);
            }
        }
    });
    await normalizeAfterEdit(editor);
    return { applied, ranges };
}
/* ==========================================================
   Public entry point from chat
   ========================================================== */
async function smartEditFromChat(instruction, kindHint, scope) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        throw new Error('No active editor to edit.');
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
        throw new Error('Missing OPENAI_API_KEY.');
    const openai = new openai_1.default({ apiKey });
    const docText = editor.document.getText();
    const lines = docText.split(/\r?\n/);
    const guidedRange = scope ? findGuidedStepBodyRange(lines, scope.step) : null;
    if (scope && !guidedRange) {
        throw new Error(`Guided Step ${scope.step} heading not found in the document.`);
    }
    const explicitId = extractAnyExplicitId(instruction);
    const kind = kindHint || detectKindFromInstruction(instruction);
    if (!kind) {
        throw new Error('Could not infer what to edit. Mention an explicit ID (e.g., H2, SC1, CA3, UCA5, LS2) or the item type.');
    }
    const meta = exports.KIND_META[kind];
    const wantsStep2Plan = scope?.step === 2 || meta.section === 'UCAS';
    const canProposeStep2Plan = (text) => {
        const lines = text.split(/\r?\n/);
        const ucaRange = findSectionRangeByHeading(lines, exports.KIND_META.uca.headingRx);
        if (!ucaRange)
            return false;
        const hasAnyUca = lines
            .slice(ucaRange.start + 1, ucaRange.end)
            .some((l) => /^\s*UCA\d+\s*:/i.test(l));
        if (!hasAnyUca)
            return false;
        return Boolean(findFirstControlLoopId(lines));
    };
    if (scope) {
        const allowed = new Set(scope.allowedSections);
        if (!allowed.has(meta.section)) {
            throw new Error(`This edit targets section "${meta.section}" which is not allowed in the current step scope.`);
        }
    }
    let op = detectOpFromInstruction(instruction);
    // Refined hazards must reference a specific hazard ID.
    if (kind === 'refined_hazard') {
        if (!explicitId || !/^H\d+$/i.test(explicitId)) {
            throw new Error('Refined hazard edits require an explicit Hazard ID (e.g., "H2 refinement: ...").');
        }
        // If user said "add" but H2 refinement already exists, treat as update to prevent duplicates.
        if (op === 'add') {
            const existingIdx = findLineIndexByKindAndId(lines, 'refined_hazard', explicitId);
            if (existingIdx !== -1) {
                op = 'update';
            }
        }
    }
    // -------------- DELETE --------------
    if (op === 'delete') {
        if (!explicitId)
            throw new Error('To delete, please specify the exact ID (e.g., L3, H2, SC1, CA2, UCA5, LS2).');
        const idx = findLineIndexByKindAndId(lines, kind, explicitId);
        if (idx === -1)
            throw new Error(`Could not find ${explicitId} in the document.`);
        if (guidedRange && (idx < guidedRange.start || idx >= guidedRange.end)) {
            throw new Error(`This edit is outside the current guided step (Step ${scope?.step}).`);
        }
        const delRange = editor.document.lineAt(idx).rangeIncludingLineBreak;
        const deletedLine = editor.document.lineAt(idx).text;
        await editor.edit((ed) => ed.delete(delRange));
        await normalizeAfterEdit(editor);
        return { applied: [`Deleted: ${deletedLine}`], preview: [], ranges: [] };
    }
    // -------------- UPDATE --------------
    if (op === 'update') {
        if (!explicitId)
            throw new Error('To update, please specify the exact ID (e.g., L3, H2, SC1, CA2, UCA5, LS2).');
        const idx = findLineIndexByKindAndId(lines, kind, explicitId);
        if (idx === -1)
            throw new Error(`Could not find ${explicitId} in the document.`);
        if (guidedRange && (idx < guidedRange.start || idx >= guidedRange.end)) {
            throw new Error(`This edit is outside the current guided step (Step ${scope?.step}).`);
        }
        const existingLine = editor.document.lineAt(idx).text;
        const prompt = buildUpdatePrompt(kind, instruction, docText, explicitId, existingLine);
        const genLines = await llmGenerateLinesWithRetry(openai, prompt, kind);
        const validationErr = validateGeneratedLines(kind, genLines);
        if (validationErr)
            throw new Error(`LLM returned wrong content for "${kind}": ${validationErr}`);
        const replacement = genLines[0];
        const lineRange = new vscode.Range(new vscode.Position(idx, 0), new vscode.Position(idx, existingLine.length));
        await editor.edit((ed) => ed.replace(lineRange, replacement));
        await normalizeAfterEdit(editor);
        const range = new vscode.Range(new vscode.Position(idx, 0), new vscode.Position(idx, replacement.length));
        // Step 1 plan (only if Step 1)
        const afterText = editor.document.getText();
        const plan = wantsStep2Plan && canProposeStep2Plan(afterText)
            ? await proposeStep2CompletionPlan(openai, afterText)
            : await proposeStep1RepairPlan(openai, afterText);
        if (scope && plan) {
            const allowed = new Set(scope.allowedSections);
            const inScope = plan.actions.every((a) => allowed.has(a.section));
            if (inScope)
                plan.scope = scope;
        }
        return { applied: [replacement], preview: [replacement], ranges: [range], plan };
    }
    // -------------- ADD --------------
    const grounding = buildAddGroundingContext(docText, meta.headingRx);
    const prompt = buildAddPrompt(kind, instruction, docText, grounding);
    const genLines = await llmGenerateLinesWithRetry(openai, prompt, kind, (lines) => validateAddGrounding(lines, grounding.systemContext, grounding.currentSection));
    const validationErr = validateGeneratedLines(kind, genLines);
    if (validationErr)
        throw new Error(`LLM returned wrong content for "${kind}": ${validationErr}`);
    const groundingErr = validateAddGrounding(genLines, grounding.systemContext, grounding.currentSection);
    if (groundingErr)
        throw new Error(`LLM returned ungrounded content for "${kind}": ${groundingErr}`);
    // refined_hazard add must keep the explicit H# refinement line; no auto-number
    if (kind === 'refined_hazard') {
        // already validated format, but we also ensure we don't duplicate
        const hid = explicitId.toUpperCase();
        const existingIdx = findLineIndexByKindAndId(lines, 'refined_hazard', hid);
        if (existingIdx !== -1) {
            // Safety net: if somehow we got here, convert to update behavior
            const existingLine = editor.document.lineAt(existingIdx).text;
            const updatePrompt = buildUpdatePrompt(kind, instruction, docText, hid, existingLine);
            const updLines = await llmGenerateLinesWithRetry(openai, updatePrompt, kind);
            const updErr = validateGeneratedLines(kind, updLines);
            if (updErr)
                throw new Error(`LLM returned wrong content for "${kind}": ${updErr}`);
            const replacement = updLines[0];
            const lineRange = new vscode.Range(new vscode.Position(existingIdx, 0), new vscode.Position(existingIdx, existingLine.length));
            await editor.edit((ed) => ed.replace(lineRange, replacement));
            await normalizeAfterEdit(editor);
            const range = new vscode.Range(new vscode.Position(existingIdx, 0), new vscode.Position(existingIdx, replacement.length));
            const afterText = editor.document.getText();
            const plan = wantsStep2Plan && canProposeStep2Plan(afterText)
                ? await proposeStep2CompletionPlan(openai, afterText)
                : await proposeStep1RepairPlan(openai, afterText);
            if (scope && plan) {
                const allowed = new Set(scope.allowedSections);
                const inScope = plan.actions.every((a) => allowed.has(a.section));
                if (inScope)
                    plan.scope = scope;
            }
            return { applied: [replacement], preview: [replacement], ranges: [range], plan };
        }
    }
    // Auto-number if needed and allowed
    let toInsert = genLines.slice();
    const hasNumbers = genLines.some((l) => meta.lineRx.test(l));
    if (!hasNumbers) {
        if (!meta.allowAutoNumber) {
            throw new Error(`This kind (${kind}) requires an explicit ID (e.g., "H2 refinement: ...").`);
        }
        // numbering regex:
        // e.g., ^H(\d+):, ^SC(\d+):, ^CA(\d+):, ^LOOP(\d+):
        const rx = new RegExp(`^${meta.prefix}(\\d+)\\s*:`, 'i');
        const next = nextIndex(lines, rx);
        toInsert = genLines.map((l, i) => {
            // remove any accidental leading "X#: " fragments
            const clean = l.replace(/^[A-Z]+(\d+)?\s*:\s*/i, '');
            return `${meta.prefix}${next + i}: ${clean}`;
        });
    }
    // Insert into correct section
    // Insert into correct section (NOTE: this may mutate `lines` by creating the section)
    const insertAt = findInsertLineInSection(lines, meta);
    // Recompute guided range AFTER possible mutations to `lines`
    const guidedRange2 = scope ? findGuidedStepBodyRange(lines, scope.step) : null;
    if (scope && !guidedRange2) {
        throw new Error(`Guided Step ${scope.step} heading not found in the document.`);
    }
    if (guidedRange2 && (insertAt < guidedRange2.start || insertAt >= guidedRange2.end)) {
        throw new Error(`Insert position is outside the current guided step (Step ${scope?.step}).`);
    }
    const pos = new vscode.Position(insertAt, 0);
    const insertedText = toInsert.join('\n') + '\n';
    await editor.edit((ed) => ed.insert(pos, insertedText));
    await normalizeAfterEdit(editor);
    const endPos = endPositionFromText(pos, insertedText);
    const range = new vscode.Range(pos, endPos);
    const afterText = editor.document.getText();
    const plan = wantsStep2Plan && canProposeStep2Plan(afterText)
        ? await proposeStep2CompletionPlan(openai, afterText)
        : await proposeStep1RepairPlan(openai, afterText);
    if (scope && plan) {
        const allowed = new Set(scope.allowedSections);
        const inScope = plan.actions.every((a) => allowed.has(a.section));
        if (inScope)
            plan.scope = scope;
    }
    return { applied: toInsert, preview: genLines, ranges: [range], plan };
}
//# sourceMappingURL=aiEdit.js.map