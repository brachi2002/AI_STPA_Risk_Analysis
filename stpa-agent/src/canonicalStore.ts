import * as vscode from 'vscode';

const KEY = 'stpa.canonical';

export type Canonical = {
    steps: any[]; // [{ step: 1, ... }, { step: 2, ... }]
};

export function loadCanonical(ctx: vscode.ExtensionContext): Canonical {
    return ctx.workspaceState.get<Canonical>(KEY) ?? { steps: [] };
}

export async function saveCanonical(ctx: vscode.ExtensionContext, canonical: Canonical) {
    await ctx.workspaceState.update(KEY, canonical);
}

export function upsertStep(canonical: Canonical, stepData: any): Canonical {
    const stepNum = stepData?.step;
    if (!stepNum) return canonical;

    const steps = Array.isArray(canonical.steps) ? [...canonical.steps] : [];
    const idx = steps.findIndex(s => s?.step === stepNum);
    if (idx >= 0) steps[idx] = stepData;
    else steps.push(stepData);

    // סדר לפי step
    steps.sort((a, b) => (a?.step ?? 0) - (b?.step ?? 0));
    return { ...canonical, steps };
}
