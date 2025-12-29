import * as vscode from 'vscode';

export type Severity = 'error' | 'warn' | 'info';

export interface ValidationIssue {
    id: string;       // e.g., "MISSING_OBJECTIVES"
    message: string;  // human-friendly
    hint?: string;    // suggestion to fix
    severity: Severity;
}

export interface ValidationResult {
    issues: ValidationIssue[];
    score: number;    // 0..100
    summary: string;
}

export type ValidationStage = 'step1' | 'step2' | 'classic';

export interface ValidateOptions {
    stage?: ValidationStage;
    languageId?: string; // VS Code document.languageId if available
}

/** Keywords / heuristics */
const KW = {
    // Step-1-ish (purpose/scope/context)
    system: [/system\b/i, /architecture\b/i, /scope\b/i, /boundary\b/i, /overview\b/i, /description\b/i],
    objectives: [/objective\b/i, /goal\b/i, /purpose\b/i, /aim\b/i, /intended\b/i, /prevent\b/i, /reduce\b/i],
    boundary: [/scope\b/i, /boundary\b/i, /in[- ]?scope\b/i, /out[- ]?of[- ]?scope\b/i, /assume\b/i],
    environment: [/environment\b/i, /context\b/i, /operating conditions\b/i, /odd\b/i, /weather\b/i, /day\b/i, /night\b/i],
    actors: [/operator\b/i, /user\b/i, /human\b/i, /nurse\b/i, /driver\b/i, /pilot\b/i, /technician\b/i],
    assumptions: [/assumption\b/i, /assume\b/i, /limitation\b/i, /constraint\b/i, /not designed to\b/i],

    // Step-2-ish (control structure)
    sensors: [/sensor\b/i, /telemetry\b/i, /measure\b/i, /monitor\b/i, /feedback\b/i],
    actuators: [/actuator\b/i, /motor\b/i, /valve\b/i, /pump\b/i, /brake\b/i, /steer\b/i],
    controlLoop: [
        /control loop/i,
        /controller\b/i,
        /setpoint\b/i,
        /closed[- ]?loop/i,
        /pid\b/i,
        /autopilot\b/i,
        /ecu\b/i,
        /feedback loop/i,
    ],
    interfaces: [/interface\b/i, /api\b/i, /bus\b/i, /can\b/i, /uart\b/i, /network\b/i, /wireless\b/i],
};

/** "Looks like code" heuristics */
const CODELIKE = [
    /\b(import|export|class|function|const|let|var|interface|type|return|async|await)\b/i,
    /;\s*$/m,
    /{\s*$/m,
    /}\s*$/m,
    /=>/m,
    /console\./i,
];

function containsAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some((rx) => rx.test(text));
}

function countMatches(text: string, patterns: RegExp[]): number {
    let c = 0;
    for (const rx of patterns) if (rx.test(text)) c++;
    return c;
}

/** Minimum readiness check before sending to LLM */
export function validateInput(text: string, opts: ValidateOptions = {}): ValidationResult {
    const stage: ValidationStage = opts.stage ?? 'classic';
    const t = text || '';
    const tl = t.toLowerCase();

    const issues: ValidationIssue[] = [];

    // ---------- Basic sanity ----------
    const minChars = stage === 'step1' ? 250 : 200;
    if (t.trim().length < minChars) {
        issues.push({
            id: 'TOO_SHORT',
            message: 'Input text is very short for a system description.',
            hint: 'Add an overview + objectives + operating context (even 5–10 lines help).',
            severity: 'warn',
        });
    }

    // If the active doc is clearly code, warn (do not hard-block in mode B)
    const languageId = opts.languageId || '';
    const likelyCodeLanguage =
        ['typescript', 'javascript', 'json', 'jsonc', 'cpp', 'c', 'csharp', 'java', 'python', 'go', 'rust'].includes(languageId);

    const codeScore = countMatches(t, CODELIKE);
    if (codeScore >= 2 || (likelyCodeLanguage && codeScore >= 1)) {
        issues.push({
            id: 'LOOKS_LIKE_CODE',
            message: 'This file looks like source code rather than a system description.',
            hint: 'Open a plain-text/markdown file that describes the system behavior, scope, and context.',
            severity: 'warn',
        });
    }

    // ---------- Stage-specific checks ----------
    // Step 1: purpose + scope + context + actors (do NOT require sensors/actuators/loops)
    if (stage === 'step1') {
        if (!containsAny(tl, KW.system)) {
            issues.push({
                id: 'MISSING_SYSTEM_CONTEXT',
                message: 'System overview/scope not detected.',
                hint: 'Add a short paragraph defining what the system is and what it does (scope/boundary).',
                severity: 'warn',
            });
        }

        if (!containsAny(tl, KW.objectives)) {
            issues.push({
                id: 'MISSING_OBJECTIVES',
                message: 'System objectives/purpose not detected.',
                hint: 'Add 2–5 bullet points: what the system is intended to achieve.',
                severity: 'warn',
            });
        }

        if (!containsAny(tl, KW.environment)) {
            issues.push({
                id: 'MISSING_ENVIRONMENT',
                message: 'Operating environment / context not described.',
                hint: 'Add where/when it operates (ODD): urban/highway/day/night/weather/indoor/etc.',
                severity: 'info',
            });
        }

        if (!containsAny(tl, KW.actors)) {
            issues.push({
                id: 'MISSING_ACTORS',
                message: 'No primary actors/users detected.',
                hint: 'Name the main human/operator roles and how they interact with the system.',
                severity: 'info',
            });
        }

        if (!containsAny(tl, KW.boundary)) {
            issues.push({
                id: 'MISSING_BOUNDARY',
                message: 'System boundary / in-scope vs out-of-scope not detected.',
                hint: 'Add what is included/excluded and key assumptions/constraints.',
                severity: 'info',
            });
        }

        if (!containsAny(tl, KW.assumptions)) {
            issues.push({
                id: 'MISSING_ASSUMPTIONS',
                message: 'Assumptions/limitations not mentioned.',
                hint: 'Add a short “Assumptions / Limitations” section (even 2–3 bullets).',
                severity: 'info',
            });
        }
    }

    // Step 2: now sensors/actuators/loops become important
    if (stage === 'step2') {
        if (!containsAny(tl, KW.actors)) {
            issues.push({
                id: 'MISSING_ACTORS',
                message: 'No human/organizational actors detected.',
                hint: 'Name primary human actors (e.g., operator/driver/nurse) and their responsibilities.',
                severity: 'warn',
            });
        }

        if (!containsAny(tl, KW.sensors)) {
            issues.push({
                id: 'MISSING_SENSORS',
                message: 'No sensors/telemetry mentioned.',
                hint: 'List key sensors and what they measure (signals, units, update rate if known).',
                severity: 'warn',
            });
        }

        if (!containsAny(tl, KW.actuators)) {
            issues.push({
                id: 'MISSING_ACTUATORS',
                message: 'No actuators/effectors mentioned.',
                hint: 'List actuators (motors, valves, pumps, brakes) and what they influence.',
                severity: 'warn',
            });
        }

        if (!containsAny(tl, KW.controlLoop)) {
            issues.push({
                id: 'MISSING_CONTROL_LOOPS',
                message: 'No control loops detected.',
                hint: 'Describe at least one loop: controller → action → actuator → process → feedback.',
                severity: 'warn', // not error (mode B)
            });
        }

        if (!containsAny(tl, KW.interfaces)) {
            issues.push({
                id: 'MISSING_INTERFACES',
                message: 'No interfaces/buses/APIs mentioned.',
                hint: 'Specify key interfaces (e.g., CAN, REST API, wireless link).',
                severity: 'info',
            });
        }

        if (!containsAny(tl, KW.environment)) {
            issues.push({
                id: 'MISSING_ENVIRONMENT',
                message: 'Operating environment not described.',
                hint: 'Add conditions (indoor/outdoor, weather, EMC, vibrations, users).',
                severity: 'info',
            });
        }
    }

    // Classic (your old behavior) — keep mostly as-is, but don’t hard-error on loops
    if (stage === 'classic') {
        if (!containsAny(tl, KW.system)) {
            issues.push({
                id: 'MISSING_SYSTEM_CONTEXT',
                message: 'System context/architecture not detected.',
                hint: 'Add a short paragraph that defines the system scope, boundary, and purpose.',
                severity: 'warn',
            });
        }

        if (!containsAny(tl, KW.actors)) {
            issues.push({
                id: 'MISSING_ACTORS',
                message: 'No human/organizational actors detected.',
                hint: 'Name primary human actors (e.g., operator/driver/nurse) and their responsibilities.',
                severity: 'warn',
            });
        }

        if (!containsAny(tl, KW.environment)) {
            issues.push({
                id: 'MISSING_ENVIRONMENT',
                message: 'Operating environment not described.',
                hint: 'Add environment/conditions (indoor/outdoor, weather, EMC, vibrations, users).',
                severity: 'info',
            });
        }
    }

    // ---------- scoring ----------
    // For step1 scoring: reward step1 elements only
    let passed = 0;
    let maxChecks = 0;

    const addCheck = (ok: boolean) => {
        maxChecks++;
        passed += ok ? 1 : 0;
    };

    if (stage === 'step1') {
        addCheck(containsAny(tl, KW.system));
        addCheck(containsAny(tl, KW.objectives));
        addCheck(containsAny(tl, KW.environment));
        addCheck(containsAny(tl, KW.actors));
        addCheck(containsAny(tl, KW.boundary));
        addCheck(containsAny(tl, KW.assumptions));
    } else if (stage === 'step2') {
        addCheck(containsAny(tl, KW.actors));
        addCheck(containsAny(tl, KW.sensors));
        addCheck(containsAny(tl, KW.actuators));
        addCheck(containsAny(tl, KW.controlLoop));
        addCheck(containsAny(tl, KW.interfaces));
        addCheck(containsAny(tl, KW.environment));
    } else {
        addCheck(containsAny(tl, KW.system));
        addCheck(containsAny(tl, KW.actors));
        addCheck(containsAny(tl, KW.environment));
    }

    const score = maxChecks ? Math.round((passed / maxChecks) * 100) : 0;

    const summary =
        score >= 80
            ? `Input Quality Score: ${score}/100 — good`
            : `Input Quality Score: ${score}/100 — consider adding missing elements`;

    return { issues, score, summary };
}

/** Pretty table for Output */
export function formatIssuesTable(result: ValidationResult): string {
    if (result.issues.length === 0) {
        return `Pre-Check ✓  ${result.summary}\n`;
    }

    const header = 'ID                  | Severity | Message';
    const sep = '--------------------+----------+---------------------------------------------';
    const rows = result.issues.map((i) => `${pad(i.id, 20)} | ${pad(i.severity.toUpperCase(), 8)} | ${i.message}`);
    const hints = result.issues
        .filter((i) => i.hint)
        .map((i) => ` • ${i.id}: ${i.hint}`);

    return [
        `Pre-Check ✦ ${result.summary}`,
        header,
        sep,
        ...rows,
        '',
        hints.length ? 'Hints:' : '',
        ...hints,
        '',
    ].join('\n');
}

function pad(s: string, n: number): string {
    return (s + ' '.repeat(n)).slice(0, n);
}

/** Prompt user: Continue / Refine / Auto-complete with AI */
export async function promptOnIssues(result: ValidationResult): Promise<'continue' | 'cancel' | 'autofix'> {
    if (result.issues.length === 0) {
        return 'continue';
    }
    const actionable = result.issues.filter(i => i.severity !== 'info');
    if (actionable.length === 0) {
        return 'continue';
    }

    // In mode B we never hard-block; just warn.
    const title = 'Pre-Check: items missing. Continue, refine, or auto-complete with AI?';

    const choice = await vscode.window.showWarningMessage(
        title,
        { modal: false },
        'Auto-complete with AI',
        'Continue anyway',
        'Refine input'
    );

    if (choice === 'Auto-complete with AI') return 'autofix';
    if (choice === 'Continue anyway') return 'continue';
    return 'cancel';
}
