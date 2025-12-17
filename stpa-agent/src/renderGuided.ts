// renderGuided.ts
export function safeJsonParse<T = any>(text: string): T | null {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

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
