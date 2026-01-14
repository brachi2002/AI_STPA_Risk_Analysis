import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { activate } from '../../src/extension';

describe('analyze current file', () => {
  beforeEach(() => {
    const api = vscode as any;
    if (typeof api.__resetMockState === 'function') {
      api.__resetMockState();
    }
  });

  test('writes report and diagram files to the workspace', async () => {
    const api = vscode as any;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stpa-analyze-'));
    api.__setWorkspaceFolders([tempDir]);
    api.__setInputBoxResult('demo');
    api.__setWarningMessageResult('Continue anyway');

    const systemText = [
      'System overview: The infusion pump system delivers medication in hospital wards.',
      'Objectives: prevent harm, ensure correct dosage, and support clinical workflows.',
      'Environment: indoor hospital rooms with varied staffing.',
      'Actors: nurse operator, technician.',
    ].join('\n');

    const filePath = path.join(tempDir, 'system.md');
    fs.writeFileSync(filePath, systemText, 'utf-8');
    const editor = api.__createTextEditor(systemText, filePath, 'markdown');
    api.__setActiveTextEditor(editor);

    const context = {
      extensionUri: api.Uri.file(tempDir),
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;
    activate(context);

    await vscode.commands.executeCommand('stpa-agent.analyzeCurrentFile');

    const resultDir = path.join(tempDir, 'stpa_results', 'demo');
    const reportPath = path.join(resultDir, 'demo_report.md');
    const csPath = path.join(resultDir, 'demo_cs.mmd');
    const impactPath = path.join(resultDir, 'demo_impact.mmd');

    expect(fs.existsSync(reportPath)).toBe(true);
    expect(fs.existsSync(csPath)).toBe(true);
    expect(fs.existsSync(impactPath)).toBe(true);

    const report = fs.readFileSync(reportPath, 'utf-8');
    expect(report).toContain('# STPA Report');
    expect(report).toContain('## Analysis Tables');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
