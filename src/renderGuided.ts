// renderGuided.ts
/**
 * Safely parse JSON text without throwing to support downstream guided renderers.
 */
export function safeJsonParse<T = any>(text: string): T | null {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

// ---------------------------
// General renderer (all steps)
// ---------------------------

type StepObj = { step?: number; reference?: string;[k: string]: any };

function normalizeSteps(input: any): StepObj[] {
    if (!input) return [];

    // Case A: already a single step object { step: 1, ... }
    if (typeof input === 'object' && !Array.isArray(input) && typeof input.step === 'number') {
        return [input as StepObj];
    }

    // Case B: { steps: [ {step:1..}, {step:2..} ] }
    if (typeof input === 'object' && !Array.isArray(input) && Array.isArray((input as any).steps)) {
        return ((input as any).steps as any[]).filter(Boolean);
    }

    // Case C: { step1: {...}, step2: {...} } or { s1: {...} ... }
    if (typeof input === 'object' && !Array.isArray(input)) {
        const candidates: any[] = [];
        for (const [k, v] of Object.entries(input)) {
            if (!v || typeof v !== 'object') continue;
            // accept common keys
            if (/^step\d+$/i.test(k) || /^s\d+$/i.test(k) || k.toLowerCase() === 'step') {
                candidates.push(v);
            }
            // also accept any object that looks like a step
            if (typeof (v as any).step === 'number') candidates.push(v);
        }
        // de-dup by reference identity
        return Array.from(new Set(candidates)) as StepObj[];
    }

    return [];
}

function renderOneStep(stepData: StepObj): string {
    switch (stepData.step) {
        case 1:
            return [
                '## Step 1 – Define Purpose of Analysis',
                renderStep1Markdown(stepData),
            ].join('\n');
        case 2:
            return [
                '## Step 2 – Model the Control Structure',
                renderStep2Markdown(stepData),
            ].join('\n');
        case 3:
            return [
                '## Step 3 – Identify Unsafe Control Actions',
                renderStep3Markdown(stepData),
            ].join('\n');
        case 4:
            return [
                '## Step 4 – Identify Loss Scenarios',
                renderStep4Markdown(stepData),
            ].join('\n');
        default:
            // Unknown step: still show something minimal
            return [
                `## Step ${String(stepData.step ?? '?')}`,
                stepData.reference ? `**Reference:** ${stepData.reference}\n` : '',
                '_Unsupported or missing step renderer._',
            ].join('\n');
    }
}

/**
 * Renders a full guided analysis markdown.
 * Accepts either:
 *  - a single step object { step: n, ... }
 *  - an aggregate object { steps: [...] }
 *  - an aggregate object { step1: {...}, step2: {...} }
 */
export function renderGuidedMarkdown(input: any): string {
    const steps = normalizeSteps(input);

    // If parsing failed or it's not structured: try to parse if it's a string JSON
    if (!steps.length && typeof input === 'string') {
        const parsed = safeJsonParse<any>(input);
        if (parsed) return renderGuidedMarkdown(parsed);
    }

    const sorted = steps
        .filter(s => typeof s?.step === 'number')
        .sort((a, b) => (a.step as number) - (b.step as number));

    const body = sorted.length
        ? sorted.map(s => renderOneStep(s)).join('\n\n---\n\n')
        : '_No guided STPA data found to render._';

    return [
        '# STPA Guided Analysis',
        '',
        body,
        '',
    ].join('\n');
}

/**
 * Render Step 1 losses, hazards, constraints, and refinements as Markdown lists.
 */
export function renderStep1Markdown(data: any): string {
    const ref = data?.reference ? `**Reference:** ${data.reference}\n\n` : '';
    const losses = (data?.losses ?? []).map((l: any) => `- **${l.id}:** ${l.description}`).join('\n');
    const hazards = (data?.hazards ?? []).map((h: any) => {
        const rel = Array.isArray(h.leads_to) ? h.leads_to.join(', ') : '';
        return `- **${h.id}:** ${h.description}${rel ? ` *(leads to: ${rel})*` : ''}`;
    }).join('\n');
    const sc = (data?.safety_constraints ?? []).map((s: any) => {
        const rel = Array.isArray(s.addresses) ? s.addresses.join(', ') : '';
        return `- **${s.id}:** ${s.description}${rel ? ` *(addresses: ${rel})*` : ''}`;
    }).join('\n');
    const rh = (data?.refined_hazards ?? []).map((r: any) => `- **${r.hazard_id}:** ${r.refinement}`).join('\n');

    return [
        ref,
        '### Losses',
        losses || '_No losses provided._',
        '',
        '### System-level Hazards',
        hazards || '_No hazards provided._',
        '',
        '### System-level Safety Constraints',
        sc || '_No constraints provided._',
        rh ? '\n### Hazard Refinement\n' + rh : '',
    ].join('\n');
}

/**
 * Render Step 2 control structure components and relationships into Markdown sections.
 */
export function renderStep2Markdown(data: any): string {
    const ref = data?.reference ? `**Reference:** ${data.reference}\n\n` : '';
    const cs = data?.control_structure ?? {};
    const list = (arr: any[], title: string) =>
        [`### ${title}`, ...(arr?.length ? arr.map((x: any) => `- **${x.id}:** ${x.name}${x.notes ? ` — ${x.notes}` : ''}`) : ['_None._']), ''].join('\n');

    const controllers = list(cs.controllers ?? [], 'Controllers');
    const processes = list(cs.controlled_processes ?? [], 'Controlled Processes');
    const actuators = list(cs.actuators ?? [], 'Actuators');
    const sensors = list(cs.sensors ?? [], 'Sensors');
    const externals = list(cs.external_systems ?? [], 'External Systems');
    const actions = (cs.control_actions ?? []).map((a: any) => `- **${a.id}:** (${a.controller}) ${a.action}`).join('\n') || '_None._';
    const feedback = (cs.feedback ?? []).map((f: any) => `- **${f.id}:** ${f.from} → ${f.to}: ${f.signal}`).join('\n') || '_None._';

    return [
        ref,
        controllers,
        processes,
        actuators,
        sensors,
        externals,
        '### Control Actions',
        actions,
        '',
        '### Feedback',
        feedback,
    ].join('\n');
}

/**
 * Render Step 3 unsafe control actions and their summary table as Markdown.
 */
export function renderStep3Markdown(data: any): string {
    const ref = data?.reference ? `**Reference:** ${data.reference}\n\n` : '';
    const ucas = (data?.unsafe_control_actions ?? []).map((u: any) => {
        const hz = Array.isArray(u.leads_to_hazards) ? u.leads_to_hazards.join(', ') : '';
        return `- **${u.id}:** ${u.uca}\n  - CA: ${u.control_action_id}, Controller: ${u.controller_id}, Type: ${u.type}\n  - Context: ${u.context}\n  - Hazards: ${hz || 'N/A'}`;
    }).join('\n') || '_No UCAs provided._';

    const table = data?.summary_table;
    const tableMd =
        table?.columns && table?.rows
            ? [
                '',
                '### Summary Table',
                `| ${table.columns.join(' | ')} |`,
                `| ${table.columns.map(() => '---').join(' | ')} |`,
                ...table.rows.map((r: any[]) => `| ${r.join(' | ')} |`),
            ].join('\n')
            : '';

    return [ref, '### Unsafe Control Actions (UCAs)', ucas, tableMd].join('\n');
}

/**
 * Render Step 4 loss scenarios and their summary table as Markdown.
 */
export function renderStep4Markdown(data: any): string {
    const ref = data?.reference ? `**Reference:** ${data.reference}\n\n` : '';
    const ls = (data?.loss_scenarios ?? []).map((s: any) => {
        const u = Array.isArray(s.linked_ucas) ? s.linked_ucas.join(', ') : '';
        const h = Array.isArray(s.linked_hazards) ? s.linked_hazards.join(', ') : '';
        const factors = Array.isArray(s.causal_factors) ? s.causal_factors.join('; ') : '';
        return `- **${s.id}:** ${s.scenario}\n  - UCAs: ${u}\n  - Hazards: ${h}\n  - Causal factors: ${factors}`;
    }).join('\n') || '_No loss scenarios provided._';

    const table = data?.summary_table;
    const tableMd =
        table?.columns && table?.rows
            ? [
                '',
                '### Summary Table',
                `| ${table.columns.join(' | ')} |`,
                `| ${table.columns.map(() => '---').join(' | ')} |`,
                ...table.rows.map((r: any[]) => `| ${r.join(' | ')} |`),
            ].join('\n')
            : '';

    return [ref, '### Loss Scenarios', ls, tableMd].join('\n');
}
