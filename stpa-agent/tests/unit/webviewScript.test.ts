import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import * as path from 'path';

function createHarness() {
  const scriptPath = path.join(__dirname, '../../media/main.js');
  const scriptContent = readFileSync(scriptPath, 'utf-8');

  const dom = new JSDOM(
    `<html><head><style nonce="test"></style></head><body>
      <div id="root" class="container">
        <div id="chat" class="chat"></div>
        <div id="boot-marker"></div>
      </div>
      <textarea id="input"></textarea>
      <select id="modelSelect"></select>
      <button id="btnSend"></button>
    </body></html>`,
    { runScripts: 'dangerously', resources: 'usable' }
  );

  const { window } = dom;
  window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0);
  window.cancelAnimationFrame = () => {};
  const chat = window.document.getElementById('chat') as any;
  if (chat && !chat.scrollTo) {
    chat.scrollTo = () => {};
  }
  const posted: any[] = [];
  window.acquireVsCodeApi = () => ({
    postMessage(message: any) {
      posted.push(message);
      return true;
    },
    getState() {
      return { messages: [] };
    },
    setState() {
      /* no-op */
    },
  });

  window.eval(scriptContent);

  return { window, posted };
}

describe('webview script messaging', () => {
  it('renders guided action buttons from the extension payload', () => {
    const { window } = createHarness();
    const stage = 'afterStep1';
    const actionMessage = {
      type: 'guidedActions',
      payload: {
        stage,
        actions: [{ label: 'Continue', action: 'continueStep2' }],
      },
    };

    window.dispatchEvent(new window.MessageEvent('message', { data: actionMessage }));

    const actionRow = window.document.querySelector('.action-row[data-group="afterStep1"]');
    expect(actionRow).toBeTruthy();
    const button = actionRow?.querySelector('button');
    expect(button?.textContent).toContain('Continue');
  });

  it('shows fallback controls for unknown message types', () => {
    const { window } = createHarness();
    window.dispatchEvent(new window.MessageEvent('message', { data: { type: 'unknown' } }));
    const fallback = window.document.querySelector('.action-row[data-group="unknown"]');
    expect(fallback).toBeTruthy();
    expect(fallback?.textContent).toContain('Retry last operation');
  });
});
