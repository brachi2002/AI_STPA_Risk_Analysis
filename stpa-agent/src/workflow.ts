import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import OpenAI from 'openai';

import { buildMarkdownTables } from './tables';
import { buildControlStructureMermaid, buildImpactGraphMermaid } from './diagrams';
import { deriveControlStructFromText } from './csExtract';
import type { SystemType, StpaResult, ControlStructInput } from './types';

// -----------------------------------------------------
// Types
// -----------------------------------------------------

export type GuidedStep = 1 | 2 | 3 | 4;

type ProjectInfo = {
  dir: string;
  baseName: string;
};

type GuidedSession = {
  project: ProjectInfo;
  systemText: string;
  systemType: SystemType;

  currentStep: GuidedStep;
  guidedFilePath: string;

  // store step texts for later export
  stepText: Partial<Record<GuidedStep, string>>;

  // keep parsed STPA backbone for diagrams/json
  losses: string[];
  hazards: string[];
  ucas: string[];
};

// -----------------------------------------------------
// Session (singleton for now)
// -----------------------------------------------------

let session: GuidedSession | null = null;

// -----------------------------------------------------
// Helpers
// -----------------------------------------------------

function detectSystemType(text: string): SystemType {
  const lower = text.toLowerCase();
  if (/(patient|drug|dose|dosing|infusion|hospital|clinic|therapy|medical|device|monitoring)/.test(lower)) return 'medical';
  if (/(drone|uav|flight|gps|gnss|altitude|aircraft|autopilot|waypoint|gimbal)/.test(lower)) return 'drone';
  if (/(vehicle|car|brake|steer|steering|engine|automotive|airbag|lane|ecu|can bus|adas)/.test(lower)) return 'automotive';
  return 'generic';
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9א-ת]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'stpa-project'
  );
}

async function prepareProjectFolder(suggested?: string): Promise<ProjectInfo | null> {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) {
    vscode.window.showErrorMessage('No workspace is open. Open a folder first.');
    return null;
  }

  const input = await vscode.window.showInputBox({
    title: 'STPA – Project name',
    prompt: 'איך לקרוא לניתוח / למערכת? (ישמש לתיקייה ולקבצים)',
    value: suggested || 'my-system',
    ignoreFocusOut: true,
  });

  if (!input) {
    vscode.window.showInformationMessage('Analysis canceled – no project name provided.');
    return null;
  }

  const baseName = slugify(input);
  const rootDir = path.join(ws, 'stpa_results');
  if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir, { recursive: true });

  const dir = path.join(rootDir, baseName);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  return { dir, baseName };
}

function guidedFileName(project: ProjectInfo) {
  return path.join(project.dir, `${project.baseName}_guided.md`);
}

function ensureFile(p: string) {
  if (!fs.existsSync(p)) fs.writeFileSync(p, '', 'utf-8');
}

function appendToFile(p: string, content: string) {
  ensureFile(p);
  const prev = fs.readFileSync(p, 'utf-8');
  const next = prev.trimEnd() + '\n\n' + content.trim() + '\n';
  fs.writeFileSync(p, next, 'utf-8');
}

function writeFile(p: string, content: string) {
  fs.writeFileSync(p, content, 'utf-8');
}

// basic parser for losses/hazards/ucas out of step outputs
function extractLinesByPrefix(lines: string[], prefix: RegExp): string[] {
  return lines.filter(l => prefix.test(l.trim()));
}

function mergeUnique(base: string[], add: string[]) {
  const set = new Set(base);
  for (const a of add) set.add(a);
  return Array.from(set);
}

// -----------------------------------------------------
// Prompts (handbook-oriented)
// -----------------------------------------------------

function buildStep1Prompt(systemText: string, systemType: SystemType): string {
  return [
    'You are an expert STPA analyst.',
    'Perform STPA Step 1 according to the STPA Handbook.',
    'Step 1 goal: define the purpose of the analysis.',
    'Include the following sub-parts:',
    '1) Identify losses (L1…).',
    '2) Identify system-level hazards (H1…) and map each to losses.',
    '3) Identify system-level safety constraints (SC1…).',
    '4) Refine hazards if needed.',
    '',
    'Output format MUST be exactly:',
    '[LOSSES]',
    'L1: ...',
    'L2: ...',
    '...',
    '',
    '[HAZARDS]',
    'H1: ... (leads_to: L1, L2)',
    'H2: ...',
    '...',
    '',
    '[CONSTRAINTS]',
    'SC1: ... (addresses: H1)',
    'SC2: ...',
    '...',
    '',
    '[TABLE_A]',
    'Table A - Loss to Hazards (derived only from leads_to mappings).',
    'Columns: Loss | Hazards',
    'Use "; " between hazard IDs and use "-" if none.',
    'Include every Loss ID even if its Hazards list is empty.',
    '',
    '[TABLE_B]',
    'Table B - Hazard to Safety Constraints (derived only from addresses mappings).',
    'Columns: Hazard | Safety Constraints',
    'Use "; " between SC IDs and use "-" if none.',
    'Include every Hazard ID even if its Safety Constraints list is empty.',
    'Do NOT output any other summary tables, only Table A and Table B.',
    '',
    `Domain hints: ${systemType}.`,
    '',
    '--- SYSTEM TEXT START ---',
    systemText,
    '--- SYSTEM TEXT END ---',
  ].join('\n');
}

function buildStep2Prompt(systemText: string, systemType: SystemType, step1Text: string): string {
  return [
    'You are an expert STPA analyst.',
    'Perform STPA Step 2 according to the STPA Handbook.',
    'Step 2 goal: model the hierarchical control structure.',
    'Derive controllers, controlled processes, actuators, sensors, human operators, and relevant interfaces.',
    '',
    'Use the prior Step 1 results to stay consistent:',
    '--- STEP 1 START ---',
    step1Text,
    '--- STEP 1 END ---',
    '',
    'Output format MUST be exactly:',
    '[CONTROL_STRUCTURE_TEXT]',
    'Provide a concise textual description of the control structure.',
    '',
    '[COMPONENTS]',
    '- Controllers: ...',
    '- Actuators: ...',
    '- Sensors: ...',
    '- Human Operators: ...',
    '- Controlled Processes: ...',
    '- External Systems/Interfaces: ...',
    '',
    '[SUMMARY_TABLE]',
    'Provide a concise markdown table listing the components and roles.',
    '',
    `Domain hints: ${systemType}.`,
    '',
    '--- SYSTEM TEXT START ---',
    systemText,
    '--- SYSTEM TEXT END ---',
  ].join('\n');
}

function buildStep3Prompt(systemText: string, systemType: SystemType, step1Text: string, step2Text: string): string {
  return [
    'You are an expert STPA analyst.',
    'Perform STPA Step 3 according to the STPA Handbook.',
    'Step 3 goal: identify Unsafe Control Actions (UCAs).',
    'Define UCAs in four categories when relevant:',
    '1) Not providing a control action when needed',
    '2) Providing an unsafe control action',
    '3) Providing the action too early/too late/out of order',
    '4) Stopping too soon/applying too long',
    '',
    'Use prior steps for consistency:',
    '--- STEP 1 START ---',
    step1Text,
    '--- STEP 1 END ---',
    '',
    '--- STEP 2 START ---',
    step2Text,
    '--- STEP 2 END ---',
    '',
    'Output format MUST be exactly:',
    '[UCAS]',
    'UCA1: ... (control action: ... ; context: ... ; related: H1)',
    'UCA2: ...',
    '...',
    '',
    '[SUMMARY_TABLE]',
    'Provide a concise markdown table mapping UCA → Hazard → Loss.',
    '',
    `Domain hints: ${systemType}.`,
    '',
    '--- SYSTEM TEXT START ---',
    systemText,
    '--- SYSTEM TEXT END ---',
  ].join('\n');
}

function buildStep4Prompt(systemText: string, systemType: SystemType, step1Text: string, step2Text: string, step3Text: string): string {
  return [
    'You are an expert STPA analyst.',
    'Perform STPA Step 4 according to the STPA Handbook.',
    'Step 4 goal: identify loss scenarios (causal factors).',
    'Each scenario should explain how specific causal factors can lead to UCAs and hazards.',
    '',
    'Use prior steps for consistency:',
    '--- STEP 1 START ---',
    step1Text,
    '--- STEP 1 END ---',
    '',
    '--- STEP 2 START ---',
    step2Text,
    '--- STEP 2 END ---',
    '',
    '--- STEP 3 START ---',
    step3Text,
    '--- STEP 3 END ---',
    '',
    'Output format MUST be exactly:',
    '[LOSS_SCENARIOS]',
    'LS1: ... (related: UCA1, H1)',
    'LS2: ...',
    '...',
    '',
    '[SUMMARY_TABLE]',
    'Output EXACTLY one markdown table and nothing else in this section.',
    'No extra text is allowed in the SUMMARY TABLE section.',
    'Columns: LS | UCAs | Hazards | Losses | Control loop | Key factors.',
    'The first five columns MUST contain ONLY IDs separated by "; ".',
    'The "Key factors" column must contain only short keywords (2-6 words), not sentences.',
    '',
    `Domain hints: ${systemType}.`,
    '',
    '--- SYSTEM TEXT START ---',
    systemText,
    '--- SYSTEM TEXT END ---',
  ].join('\n');
}

// -----------------------------------------------------
// Model call
// -----------------------------------------------------

async function callLLM(apiKey: string, prompt: string): Promise<string> {
  const openai = new OpenAI({ apiKey });
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
  });
  return resp.choices?.[0]?.message?.content?.trim() ?? '';
}

// -----------------------------------------------------
// Public API used by extension/chat
// -----------------------------------------------------

export function getGuidedSession() {
  return session;
}

export async function startGuidedStep1(apiKey: string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Open the system description file first.');
    return;
  }

  const systemText = editor.document.getText().trim();
  if (!systemText) {
    vscode.window.showInformationMessage('System description file is empty.');
    return;
  }

  const suggestedName = path.basename(editor.document.fileName, path.extname(editor.document.fileName));
  const project = await prepareProjectFolder(suggestedName);
  if (!project) return;

  const systemType = detectSystemType(systemText);

  const guidedPath = guidedFileName(project);
  ensureFile(guidedPath);

  session = {
    project,
    systemText,
    systemType,
    currentStep: 1,
    guidedFilePath: guidedPath,
    stepText: {},
    losses: [],
    hazards: [],
    ucas: [],
  };

  const prompt = buildStep1Prompt(systemText, systemType);
  const step1Text = await callLLM(apiKey, prompt);

  session.stepText[1] = step1Text;

  // parse backbone items for later diagrams/json
  const lines = step1Text.split(/\r?\n/);
  const losses = extractLinesByPrefix(lines, /^L\d+\s*:/i);
  const hazards = extractLinesByPrefix(lines, /^H\d+\s*:/i);

  session.losses = mergeUnique(session.losses, losses);
  session.hazards = mergeUnique(session.hazards, hazards);

  // write guided file with header + step1
  writeFile(
    guidedPath,
    [
      `# Guided STPA Analysis`,
      ``,
      `- Project: ${project.baseName}`,
      `- Domain: ${systemType}`,
      `- Generated: ${new Date().toISOString()}`,
      ``,
      `---`,
      ``,
      `## Step 1 — Define the purpose of the analysis`,
      step1Text,
    ].join('\n')
  );

  const doc = await vscode.workspace.openTextDocument(guidedPath);
  await vscode.window.showTextDocument(doc, { preview: false });

  vscode.commands.executeCommand('stpa-agent.guided.ui.showAfterStep', 1);
}

export async function continueToNextStep(apiKey: string) {
  if (!session) {
    vscode.window.showInformationMessage('No guided session found. Start Step 1 first.');
    return;
  }

  const nextStep = (session.currentStep + 1) as GuidedStep;
  if (nextStep > 4) {
    vscode.window.showInformationMessage('Already completed Step 4.');
    return;
  }

  await runStep(apiKey, nextStep);
}

export async function runStep(apiKey: string, step: GuidedStep) {
  if (!session) {
    vscode.window.showInformationMessage('No guided session found.');
    return;
  }

  const { systemText, systemType } = session;

  let prompt = '';
  if (step === 2) {
    if (!session.stepText[1]) {
      vscode.window.showErrorMessage('Missing Step 1 content.');
      return;
    }
    prompt = buildStep2Prompt(systemText, systemType, session.stepText[1]!);
  }
  if (step === 3) {
    if (!session.stepText[1] || !session.stepText[2]) {
      vscode.window.showErrorMessage('Missing Step 1/2 content.');
      return;
    }
    prompt = buildStep3Prompt(systemText, systemType, session.stepText[1]!, session.stepText[2]!);
  }
  if (step === 4) {
    if (!session.stepText[1] || !session.stepText[2] || !session.stepText[3]) {
      vscode.window.showErrorMessage('Missing Step 1/2/3 content.');
      return;
    }
    prompt = buildStep4Prompt(systemText, systemType, session.stepText[1]!, session.stepText[2]!, session.stepText[3]!);
  }

  const stepText = await callLLM(apiKey, prompt);
  session.stepText[step] = stepText;
  session.currentStep = step;

  // update backbone stores
  const lines = stepText.split(/\r?\n/);
  if (step === 3) {
    const ucas = extractLinesByPrefix(lines, /^UCA\d+\s*:/i);
    session.ucas = mergeUnique(session.ucas, ucas);
  }
  if (step === 2) {
    // no backbone extraction needed here
  }
  if (step === 4) {
    // scenarios not needed for diagrams builder right now
  }

  appendToFile(
    session.guidedFilePath,
    [
      `---`,
      ``,
      `## Step ${step} — ${step === 2 ? 'Model the control structure' : step === 3 ? 'Identify Unsafe Control Actions' : 'Identify loss scenarios'}`,
      stepText,
    ].join('\n')
  );

  const doc = await vscode.workspace.openTextDocument(session.guidedFilePath);
  await vscode.window.showTextDocument(doc, { preview: false });

  vscode.commands.executeCommand('stpa-agent.guided.ui.showAfterStep', step);
}

export async function openGuidedFileForEdit() {
  if (!session) {
    vscode.window.showInformationMessage('No guided session found.');
    return;
  }
  const doc = await vscode.workspace.openTextDocument(session.guidedFilePath);
  await vscode.window.showTextDocument(doc, { preview: false });
}

export async function generateDiagramsAndExports() {
  if (!session) {
    vscode.window.showInformationMessage('No guided session found.');
    return;
  }
  if (session.currentStep !== 4) {
    vscode.window.showInformationMessage('Generate diagrams is available after Step 4.');
    return;
  }

  const { project, systemText } = session;

  // Build a minimal StpaResult from collected backbone
  const result: StpaResult = {
    losses: session.losses,
    hazards: session.hazards,
    ucas: session.ucas,
    raw: [
      '[LOSSES]',
      ...session.losses,
      '',
      '[HAZARDS]',
      ...session.hazards,
      '',
      '[UCAS]',
      ...session.ucas,
    ].join('\n'),
  };

  // Control Structure + Impact graph based on result
  const cs: ControlStructInput = deriveControlStructFromText(systemText);
  const csMermaid = buildControlStructureMermaid(cs);
  const impactMermaid = buildImpactGraphMermaid(result);

  // Save .mmd
  const clean = (s: string) =>
    s.replace(/^\s*```mermaid\s*/i, '').replace(/\s*```$/i, '').trim();

  writeFile(path.join(project.dir, `${project.baseName}_cs.mmd`), clean(csMermaid));
  writeFile(path.join(project.dir, `${project.baseName}_impact.mmd`), clean(impactMermaid));

  // Save JSON
  writeFile(
    path.join(project.dir, `${project.baseName}_stpa.json`),
    JSON.stringify({ losses: result.losses, hazards: result.hazards, ucas: result.ucas }, null, 2)
  );

  // Save report
  const reportMd = [
    `# STPA Report`,
    ``,
    `- Project: ${project.baseName}`,
    `- Domain: ${session.systemType}`,
    `- Generated: ${new Date().toISOString()}`,
    ``,
    `---`,
    ``,
    `## Analysis Tables`,
    buildMarkdownTables(result),
    ``,
    `---`,
    ``,
    `## Diagrams`,
    ``,
    `### Control Structure`,
    '```mermaid',
    clean(csMermaid),
    '```',
    ``,
    `### UCA → Hazard → Loss`,
    '```mermaid',
    clean(impactMermaid),
    '```',
    ``,
    `---`,
    ``,
    `## Guided Analysis (Steps 1–4)`,
    ``,
    `> See: ${path.basename(session.guidedFilePath)}`,
  ].join('\n');

  writeFile(path.join(project.dir, `${project.baseName}_report.md`), reportMd);

  // Open preview panel using your existing command
  await vscode.commands.executeCommand('stpa-agent.previewDiagrams');

  vscode.window.showInformationMessage(`Diagrams + report + JSON created under ${project.baseName}.`);
}