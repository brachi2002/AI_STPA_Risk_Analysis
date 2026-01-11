import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeArtifact(name: string, payload: unknown) {
  const dir = path.join(process.cwd(), 'tests', 'e2e', 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${name}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
}

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10000
) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await delay(200);
  }
}

function getWorkspaceFile(name: string): string {
  let folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'stpa-e2e-'));
    const added = vscode.workspace.updateWorkspaceFolders(0, 0, {
      uri: vscode.Uri.file(tempDir),
      name: 'stpa-e2e',
    });
    if (!added) {
      throw new Error('No workspace folder is available for E2E tests.');
    }
    folder = tempDir;
  }
  return path.join(folder, name);
}

suite('STPA Agent E2E', () => {
  test('opens the chat view and executes public commands without errors', async function () {
    this.timeout(20000);

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: any[]) => {
      errors.push(args.map(String).join(' '));
      originalError(...args);
    };

    const originalInfo = vscode.window.showInformationMessage;
    const infoMessages: string[] = [];
    (vscode.window as any).showInformationMessage = async (...args: any[]) => {
      if (typeof args[0] === 'string') {
        infoMessages.push(args[0]);
      }
      return originalInfo.apply(vscode.window, args as any);
    };

    try {
      const filePath = getWorkspaceFile('stpa-e2e-system.md');
      fs.writeFileSync(filePath, 'System description: sample system for E2E.', 'utf-8');
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc, { preview: false });

      delete process.env.OPENAI_API_KEY;

      await vscode.commands.executeCommand('workbench.view.extension.stpaAgent');

      await waitForCondition(
        () => vscode.window.visibleTextEditors.some((editor) => editor.document.uri.fsPath === filePath)
      );

      await vscode.commands.executeCommand('stpa-agent.guided.explainCurrentStep');

      const smartEditResult = await vscode.commands.executeCommand(
        'stpa-agent.smartEdit',
        'add L1: Example loss.'
      );
      if (typeof smartEditResult === 'string') {
        if (!smartEditResult.includes('Missing OPENAI_API_KEY')) {
          throw new Error(`Unexpected smart edit result: ${smartEditResult}`);
        }
      }

      const applyResult = await vscode.commands.executeCommand('stpa-agent.smartEdit.applyPlan');
      if (typeof applyResult !== 'string' || !applyResult.includes('No pending plan')) {
        throw new Error(`Unexpected apply plan result: ${String(applyResult)}`);
      }

      await vscode.commands.executeCommand('stpa-agent.previewDiagrams');
      await waitForCondition(() => infoMessages.length > 0);

      if (errors.length) {
        throw new Error(`Console errors: ${errors.join(' | ')}`);
      }
    } catch (err) {
      writeArtifact('chatView', { errors, infoMessages, message: String(err) });
      throw err;
    } finally {
      console.error = originalError;
      (vscode.window as any).showInformationMessage = originalInfo;
    }
  });
});
