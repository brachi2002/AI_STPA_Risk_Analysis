import * as vscode from 'vscode';
import { registerInlineCompletion } from '../../src/inlineCompletion';

describe('inline completion', () => {
  beforeEach(() => {
    const api = vscode as any;
    if (typeof api.__resetMockState === 'function') {
      api.__resetMockState();
    }
  });

  test('provides suggestions for trigger headings', async () => {
    let provider: any;
    const spy = jest
      .spyOn(vscode.languages, 'registerInlineCompletionItemProvider')
      .mockImplementation((_selector: any, captured: any) => {
        provider = captured;
        return { dispose: () => undefined };
      });

    registerInlineCompletion(() => 'test-key');

    const api = vscode as any;
    const doc = api.__createTextDocument('Sensors:', 'C:\\temp\\doc.md', 'markdown');
    const position = new vscode.Position(0, 'Sensors:'.length);

    const result = await provider.provideInlineCompletionItems(doc, position);
    expect(result.items[0].insertText).toContain('- item one');

    spy.mockRestore();
  });

  test('returns undefined when no API key is available', async () => {
    let provider: any;
    const spy = jest
      .spyOn(vscode.languages, 'registerInlineCompletionItemProvider')
      .mockImplementation((_selector: any, captured: any) => {
        provider = captured;
        return { dispose: () => undefined };
      });

    registerInlineCompletion(() => undefined);

    const api = vscode as any;
    const doc = api.__createTextDocument('Sensors:', 'C:\\temp\\doc.md', 'markdown');
    const position = new vscode.Position(0, 'Sensors:'.length);

    const result = await provider.provideInlineCompletionItems(doc, position);
    expect(result).toBeUndefined();

    spy.mockRestore();
  });

  test('returns undefined for non-trigger lines', async () => {
    let provider: any;
    const spy = jest
      .spyOn(vscode.languages, 'registerInlineCompletionItemProvider')
      .mockImplementation((_selector: any, captured: any) => {
        provider = captured;
        return { dispose: () => undefined };
      });

    registerInlineCompletion(() => 'test-key');

    const api = vscode as any;
    const doc = api.__createTextDocument('Notes:', 'C:\\temp\\doc.md', 'markdown');
    const position = new vscode.Position(0, 'Notes:'.length);

    const result = await provider.provideInlineCompletionItems(doc, position);
    expect(result).toBeUndefined();

    spy.mockRestore();
  });
});
