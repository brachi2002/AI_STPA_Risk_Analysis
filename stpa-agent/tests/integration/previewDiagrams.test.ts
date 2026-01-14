import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { activate, __test__ } from '../../src/extension';

describe('preview diagrams command', () => {
  beforeEach(() => {
    const api = vscode as any;
    if (typeof api.__resetMockState === 'function') {
      api.__resetMockState();
    }
  });

  test('renders mermaid content into a webview panel', async () => {
    const api = vscode as any;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stpa-preview-'));
    api.__setWorkspaceFolders([tempDir]);

    const panels: any[] = [];
    const spy = jest.spyOn(vscode.window, 'createWebviewPanel').mockImplementation(() => {
      const panel = {
        webview: {
          html: '',
          options: undefined,
          postMessage: async () => true,
        },
        onDidDispose: () => ({ dispose: () => undefined }),
        dispose: () => undefined,
      };
      panels.push(panel);
      return panel as any;
    });

    const context = {
      extensionUri: api.Uri.file(tempDir),
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;
    activate(context);

    __test__.setLastContext({
      systemType: 'generic',
      result: { losses: [], hazards: [], ucas: [], raw: '' },
      csMermaid: '```mermaid\ngraph TD\nA-->B\n```',
      impactMermaid: '```mermaid\ngraph LR\nA-->B\n```',
      project: { dir: tempDir, baseName: 'demo' },
    });

    await vscode.commands.executeCommand('stpa-agent.previewDiagrams');

    expect(panels.length).toBe(1);
    const html = panels[0].webview.html;
    expect(html).toContain('Control Structure');
    expect(html).toContain('graph TD');
    expect(html).toContain('graph LR');

    spy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
