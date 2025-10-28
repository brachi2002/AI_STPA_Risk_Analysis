import * as vscode from 'vscode';

export type Severity = 'error' | 'warn' | 'info';

export interface ValidationIssue {
    id: string;       // e.g., "MISSING_SENSORS"
    message: string;  // human-friendly
    hint?: string;    // suggestion to fix
    severity: Severity;
}

export interface ValidationResult {
    issues: ValidationIssue[];
    score: number;    // 0..100
    summary: string;
}

/** מילות מפתח בסיסיות (אפשר להרחיב לפי דומיין) */
const KW = {
    system: [/system\b/i, /architecture\b/i, /scope\b/i, /boundary\b/i],
    actors: [/operator\b/i, /user\b/i, /human\b/i, /nurse\b/i, /driver\b/i, /pilot\b/i],
    sensors: [/sensor\b/i, /telemetry\b/i, /measure\b/i, /monitor/i, /feedback/i],
    actuators: [/actuator\b/i, /motor\b/i, /valve\b/i, /pump\b/i, /brake\b/i, /steer/i],
    controlLoop: [
        /control loop/i,
        /controller\b/i,
        /setpoint\b/i,
        /closed[- ]?loop/i,
        /PID\b/i,
        /autopilot\b/i,
        /ECU\b/i,
        /feedback loop/i,
    ],
    interfaces: [/interface\b/i, /api\b/i, /bus\b/i, /can\b/i, /uart\b/i, /network\b/i, /wireless\b/i],
    environment: [/environment\b/i, /context\b/i, /operating conditions/i, /weather\b/i],
};

function containsAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some((rx) => rx.test(text));
}

/** בדיקת מוכנות מינימלית לפני שליחת הטקסט ל-LLM */
export function validateInput(text: string): ValidationResult {
    const t = text.toLowerCase();
    const issues: ValidationIssue[] = [];

    if (!containsAny(t, KW.system)) {
        issues.push({
            id: 'MISSING_SYSTEM_CONTEXT',
            message: 'System context/architecture not detected.',
            hint: 'Add a short paragraph that defines the system scope, boundary, and purpose.',
            severity: 'warn',
        });
    }

    if (!containsAny(t, KW.actors)) {
        issues.push({
            id: 'MISSING_ACTORS',
            message: 'No human/organizational actors detected.',
            hint: 'Name primary human actors (e.g., operator/driver/nurse) and their responsibilities.',
            severity: 'warn',
        });
    }

    if (!containsAny(t, KW.sensors)) {
        issues.push({
            id: 'MISSING_SENSORS',
            message: 'No sensors/telemetry mentioned.',
            hint: 'List key sensors and what they measure (units, update rate, thresholds).',
            severity: 'warn',
        });
    }

    if (!containsAny(t, KW.actuators)) {
        issues.push({
            id: 'MISSING_ACTUATORS',
            message: 'No actuators/effectors mentioned.',
            hint: 'List actuators (motors, valves, pumps) and what they influence.',
            severity: 'warn',
        });
    }

    if (!containsAny(t, KW.controlLoop)) {
        issues.push({
            id: 'MISSING_CONTROL_LOOPS',
            message: 'No control loops detected.',
            hint: 'Describe at least one control loop (controller, feedback, setpoint, controlled process).',
            severity: 'error',
        });
    }

    if (!containsAny(t, KW.interfaces)) {
        issues.push({
            id: 'MISSING_INTERFACES',
            message: 'No interfaces/buses/APIs mentioned.',
            hint: 'Specify internal/external interfaces (e.g., CAN bus, REST API, wireless link).',
            severity: 'info',
        });
    }

    if (!containsAny(t, KW.environment)) {
        issues.push({
            id: 'MISSING_ENVIRONMENT',
            message: 'Operating environment not described.',
            hint: 'Add environment/conditions (indoor/outdoor, weather, EMC, vibrations, users).',
            severity: 'info',
        });
    }

    const maxChecks = 7;
    const passed =
        (containsAny(t, KW.system) ? 1 : 0) +
        (containsAny(t, KW.actors) ? 1 : 0) +
        (containsAny(t, KW.sensors) ? 1 : 0) +
        (containsAny(t, KW.actuators) ? 1 : 0) +
        (containsAny(t, KW.controlLoop) ? 1 : 0) +
        (containsAny(t, KW.interfaces) ? 1 : 0) +
        (containsAny(t, KW.environment) ? 1 : 0);

    const score = Math.round((passed / maxChecks) * 100);
    const summary =
        score >= 80
            ? `Input Quality Score: ${score}/100 — good`
            : `Input Quality Score: ${score}/100 — consider adding missing elements`;

    return { issues, score, summary };
}

/** הדפסה יפה לטבלה ב-Output */
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

/** חלון פעולה: Continue / Refine / Auto-complete with AI */
export async function promptOnIssues(
    result: ValidationResult
): Promise<'continue' | 'cancel' | 'autofix'> {
    if (result.issues.length === 0) {
        return 'continue';
    }

    const hasError = result.issues.some((i) => i.severity === 'error');
    const title = hasError
        ? 'Pre-Check: critical items missing. Refine input or auto-complete with AI?'
        : 'Pre-Check: items missing. Continue, refine, or auto-complete with AI?';

    const choice = await vscode.window.showWarningMessage(
        title,
        { modal: false },
        'Auto-complete with AI',
        'Continue anyway',
        'Refine input'
    );

    if (choice === 'Auto-complete with AI') {
        return 'autofix';
    }
    if (choice === 'Continue anyway') {
        return 'continue';
    }
    return 'cancel';
}
