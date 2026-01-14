import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { WebviewProtocolHarness } from '../utils/webviewHarness';
import { useDefaultLlmMock, useInvalidLlmMock, useThrowingLlmMock, withMockHandler } from '../utils/llmMock';

let capturedProvider: any;

jest.mock('../../src/chatView', () => {
  const actual = jest.requireActual('../../src/chatView');
  return {
    ...actual,
    StpaChatViewProvider: class extends actual.StpaChatViewProvider {
      constructor(context: vscode.ExtensionContext) {
        super(context);
        capturedProvider = this;
      }
    },
  };
});

async function setupHarness(options?: { text?: string; activeEditor?: boolean }) {
  const vscodeApi = await import('vscode');
  const { __resetMockState, __setWorkspaceFolders, __setInputBoxResult, __setWarningMessageResult, __createTextEditor } =
    vscodeApi as any;

  __resetMockState();
  capturedProvider = undefined;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stpa-protocol-'));
  __setWorkspaceFolders([tempDir]);
  __setInputBoxResult('demo-project');
  __setWarningMessageResult('Continue anyway');

  const text = options?.text ?? 'System description for protocol tests.';
  const editor = __createTextEditor(text, path.join(tempDir, 'system.md'), 'markdown');

  if (options?.activeEditor === false) {
    (vscodeApi.window as any).activeTextEditor = undefined;
  } else {
    (vscodeApi.window as any).activeTextEditor = editor;
  }

  const { activate } = await import('../../src/extension');
  const context = {
    extensionUri: (vscodeApi.Uri as any).file(tempDir),
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;

  activate(context);
  if (!capturedProvider) {
    throw new Error('Chat provider not captured');
  }

  const harness = new WebviewProtocolHarness(capturedProvider);
  return { harness, vscodeApi, tempDir };
}

async function waitForMessage(
  harness: WebviewProtocolHarness,
  predicate: (msg: any) => boolean,
  label: string,
  timeoutMs = 3000
) {
  try {
    return await harness.waitForMessage(predicate, timeoutMs);
  } catch (err) {
    const tail = harness.outgoing.slice(-6);
    throw new Error(`Timed out waiting for ${label}. Recent messages: ${JSON.stringify(tail)}`);
  }
}

describe('Webview protocol integration', () => {
  const guidedStageWithActions = (stage: string) => (msg: any) =>
    msg.type === 'guidedActions' &&
    msg.payload?.stage === stage &&
    Array.isArray(msg.payload?.actions) &&
    msg.payload.actions.length > 0;

  test('covers core message types and guided flow', async () => {
    const { harness } = await setupHarness();

    await harness.sendFromWebview({ type: 'ready' });
    await harness.waitForMessage((msg) => msg.type === 'model');
    await harness.waitForMessage((msg) => msg.type === 'reset');

    await harness.sendFromWebview({ type: 'setModel', payload: { model: 'gpt-4o' } });
    await harness.waitForMessage((msg) => msg.type === 'model' && msg.payload?.model === 'gpt-4o');

    await harness.sendFromWebview({ type: 'manualPrompt', payload: { text: 'Hello agent' } });
    await harness.waitForMessage((msg) => msg.type === 'append' && msg.payload?.role === 'assistant');
    await harness.assertIdle();

    await harness.sendFromWebview({ type: 'analyzeFile' });
    await harness.assertIdle();
    await harness.sendFromWebview({ type: 'analyzeSelection' });
    await harness.assertIdle();
    await harness.sendFromWebview({ type: 'previewDiagrams' });
    await harness.assertIdle();

    await harness.sendFromWebview({ type: 'explainCurrentStep' });
    await harness.waitForMessage((msg) => msg.type === 'append');

    await harness.sendFromWebview({ type: 'guidedAction', payload: { action: 'startStep1' } });
    await harness.waitForMessage(guidedStageWithActions('afterStep1'));
    await harness.assertIdle();

    await harness.sendFromWebview({ type: 'guidedAction', payload: { action: 'continueStep2' } });
    await harness.waitForMessage(guidedStageWithActions('afterStep2'));
    await harness.assertIdle();

    await harness.sendFromWebview({ type: 'guidedAction', payload: { action: 'continueStep3' } });
    await harness.waitForMessage(guidedStageWithActions('afterStep3'));
    await harness.assertIdle();

    await harness.sendFromWebview({ type: 'guidedAction', payload: { action: 'continueStep4' } });
    await harness.waitForMessage(guidedStageWithActions('afterStep4'));
    await harness.assertIdle();

    await harness.sendFromWebview({ type: 'guidedAction', payload: { action: 'editCurrentStep' } });
    await harness.waitForMessage((msg) => msg.type === 'guidedActions' && Array.isArray(msg.payload?.actions) && msg.payload.actions.length > 0);

    await harness.sendFromWebview({ type: 'applySmartEditPlan', payload: { id: 'plan_1' } });
    await harness.waitForMessage((msg) => msg.type === 'append');

    await harness.sendFromWebview({ type: 'discardSmartEditPlan', payload: { id: 'plan_1' } });
    await harness.waitForMessage((msg) => msg.type === 'append');

    await harness.sendFromWebview({ type: 'clear' });
    await harness.waitForMessage((msg) => msg.type === 'reset');
  });

  test('covers error paths, model switch, and clear mid-flow', async () => {
    useDefaultLlmMock();

    const missing = await setupHarness({ activeEditor: false });
    await missing.harness.sendFromWebview({ type: 'guidedAction', payload: { action: 'startStep1' } });
    await waitForMessage(missing.harness, (msg) => msg.type === 'toast', 'toast (missing editor)');

    const empty = await setupHarness({ text: '   ' });
    await empty.harness.sendFromWebview({ type: 'guidedAction', payload: { action: 'startStep1' } });
    await waitForMessage(empty.harness, (msg) => msg.type === 'toast', 'toast (empty system text)');

    const invalidInstr = await setupHarness();
    const commands = invalidInstr.vscodeApi.commands as any;
    commands.registerCommand('stpa-agent.smartEdit', async () => {
      throw new Error('Invalid instruction: ADD L999');
    });
    await invalidInstr.harness.sendFromWebview({ type: 'smartEdit', payload: { text: 'ADD L999' } });
    await waitForMessage(
      invalidInstr.harness,
      (msg) => msg.type === 'append' && /Error:/i.test(msg.payload?.text || ''),
      'append error (invalid instruction)'
    );
    await invalidInstr.harness.assertIdle();

    const invalidLlm = await setupHarness({ text: '=== LOSSES ===\nL1: Existing loss.' });
    useInvalidLlmMock('bad output');
    await invalidLlm.harness.sendFromWebview({ type: 'smartEdit', payload: { text: 'update L1: revised' } });
    await waitForMessage(
      invalidLlm.harness,
      (msg) =>
        msg.type === 'append' &&
        /(Error:|Smart edit failed:)/i.test(msg.payload?.text || ''),
      'append error (invalid LLM)'
    );
    await invalidLlm.harness.assertIdle();
    useDefaultLlmMock();

    const throwing = await setupHarness();
    useThrowingLlmMock('timeout');
    await throwing.harness.sendFromWebview({ type: 'manualPrompt', payload: { text: 'Trigger timeout' } });
    await waitForMessage(
      throwing.harness,
      (msg) => msg.type === 'append' && /Error:/i.test(msg.payload?.text || ''),
      'append error (throwing LLM)'
    );
    await throwing.harness.assertIdle();
    useDefaultLlmMock();

    const clearMid = await setupHarness();
    let resolveDelay: (() => void) | undefined;
    withMockHandler(async (req) => {
      if (/Hello mid-flow/i.test(req.messages?.[0]?.content || '')) {
        await new Promise<void>((resolve) => {
          resolveDelay = resolve;
        });
        return { content: 'Delayed response' };
      }
      return { content: 'Follow-up response' };
    });

    await clearMid.harness.sendFromWebview({ type: 'setModel', payload: { model: 'gpt-4o-mini' } });
    const pendingPrompt = clearMid.harness.sendFromWebview({
      type: 'manualPrompt',
      payload: { text: 'Hello mid-flow' },
    });
    await clearMid.harness.sendFromWebview({ type: 'clear' });
    await waitForMessage(clearMid.harness, (msg) => msg.type === 'reset', 'reset after clear');
    if (resolveDelay) resolveDelay();
    await pendingPrompt;
    await clearMid.harness.assertIdle();

    await clearMid.harness.sendFromWebview({ type: 'manualPrompt', payload: { text: 'After clear' } });
    await waitForMessage(clearMid.harness, (msg) => msg.type === 'append', 'append after clear');
    await clearMid.harness.assertIdle();
  }, 15000);
});
