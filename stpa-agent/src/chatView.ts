import * as vscode from 'vscode';
import OpenAI from 'openai';

type ToolbarIcons = {
  explain: vscode.Uri;
  diagram: vscode.Uri;
  clear: vscode.Uri;
};

export class StpaChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'stpa-agent.chat';
  private _view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public sendToWebview(message: any) {
    this._view?.webview.postMessage(message);
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    const webview = webviewView.webview;

    webview.options = { enableScripts: true };

    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const icons: ToolbarIcons = {
      explain: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'analyze.svg')),
      diagram: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'diagram.svg')),
      clear: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'clear.svg')),
    };

    webview.html = this.getHtml(icons);

    webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'analyzeFile':
          await vscode.commands.executeCommand('stpa-agent.analyzeCurrentFile');
          break;

        case 'analyzeSelection':
          await vscode.commands.executeCommand('stpa-agent.analyzeSelection');
          break;

        case 'previewDiagrams':
          await vscode.commands.executeCommand('stpa-agent.previewDiagrams');
          break;

        case 'explainCurrentStep':
          await vscode.commands.executeCommand('stpa-agent.guided.explainCurrentStep');
          break;

        case 'guidedAction': {
          const action = msg.payload?.action as string | undefined;
          if (!action) return;

          switch (action) {
            case 'startStep1':
              await vscode.commands.executeCommand('stpa-agent.guided.startStep1');
              break;
            case 'continueStep2':
              await vscode.commands.executeCommand('stpa-agent.guided.continueStep2');
              break;
            case 'continueStep3':
              await vscode.commands.executeCommand('stpa-agent.guided.continueStep3');
              break;
            case 'continueStep4':
              await vscode.commands.executeCommand('stpa-agent.guided.continueStep4');
              break;
            case 'editCurrentStep':
              await vscode.commands.executeCommand('stpa-agent.guided.editCurrentStep');
              break;
            case 'generateDiagrams':
              await vscode.commands.executeCommand('stpa-agent.guided.generateDiagrams');
              break;
            case 'jumpToStep':
              await vscode.commands.executeCommand('stpa-agent.guided.jumpToStep');
              break;
            default:
              break;
          }
          break;
        }

        case 'smartEdit': {
          try {
            this.sendToWebview({ type: 'busy', payload: true });

            const res = await vscode.commands.executeCommand(
              'stpa-agent.smartEdit',
              msg.payload?.text
            );

            const text = Array.isArray(res) ? res.join('\n') : res || 'Applied.';
            this.sendToWebview({
              type: 'append',
              payload: { role: 'assistant', text },
            });
          } catch (e: any) {
            this.sendToWebview({
              type: 'append',
              payload: { role: 'assistant', text: `Error: ${e?.message || e}` },
            });
          } finally {
            this.sendToWebview({ type: 'busy', payload: false });
          }
          break;
        }

        case 'manualPrompt':
          await this.runManualPrompt(msg.payload?.text ?? '');
          break;

        case 'clear':
          this.sendToWebview({ type: 'reset' });
          break;

        default:
          break;
      }
    });
  }

  private async runManualPrompt(text: string) {
    if (!text.trim()) {
      this.sendToWebview({ type: 'toast', payload: 'נא להקליד הודעה.' });
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      this.sendToWebview({ type: 'toast', payload: 'Missing OPENAI_API_KEY' });
      return;
    }

    try {
      this.sendToWebview({ type: 'busy', payload: true });

      const openai = new OpenAI({ apiKey });
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [{ role: 'user', content: text }],
      });

      const content = resp.choices?.[0]?.message?.content?.trim() || '(no response)';
      this.sendToWebview({ type: 'append', payload: { role: 'assistant', text: content } });
    } catch (e: any) {
      this.sendToWebview({
        type: 'append',
        payload: { role: 'assistant', text: `Error: ${e?.message || e}` },
      });
    } finally {
      this.sendToWebview({ type: 'busy', payload: false });
    }
  }

  private getHtml(icons: ToolbarIcons): string {
    const css = `
      :root {
        --bg: var(--vscode-sideBar-background);
        --fg: var(--vscode-foreground);
        --muted: var(--vscode-descriptionForeground);
        --border: var(--vscode-editorGroup-border);
        --btn-bg: var(--vscode-button-background);
        --btn-bg-hover: var(--vscode-button-hoverBackground);
        --btn-fg: var(--vscode-button-foreground);
        --input-bg: var(--vscode-input-background);
        --input-fg: var(--vscode-input-foreground);
        --input-border: var(--vscode-input-border);
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; }
      body {
        margin: 0;
        padding: 0;
        background: var(--bg);
        color: var(--fg);
        font-family: var(--vscode-font-family);
        font-size: 13px;
      }
      .container {
        display: grid;
        grid-template-rows: 1fr auto auto;
        height: 100%;
        gap: 8px;
        padding: 10px;
      }
      .chat {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 8px;
        overflow: auto;
        background: var(--vscode-editor-background);
      }
      .msg {
        display: flex;
        gap: 8px;
        margin: 8px 0;
        align-items: flex-end;
      }
      .bubble {
        max-width: 85%;
        padding: 8px 10px;
        border-radius: 12px;
        white-space: pre-wrap;
        word-wrap: break-word;
      }
      .role {
        font-size: 11px;
        color: var(--muted);
        margin: 0 6px;
      }
      .user { justify-content: flex-end; }
      .user .bubble {
        background: var(--vscode-charts-blue);
        color: white;
        border-bottom-right-radius: 4px;
      }
      .assistant { justify-content: flex-start; }
      .assistant .bubble {
        background: var(--vscode-editorInlayHint-background, #00000020);
        border-bottom-left-radius: 4px;
      }
      .system { justify-content: center; }
      .system .bubble {
        background: transparent;
        color: var(--muted);
        border: 1px dashed var(--border);
      }
      .action-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin: 8px 0 14px 0;
        justify-content: center;
      }
      .action-btn {
        background: var(--btn-bg);
        color: var(--btn-fg);
        border: none;
        padding: 6px 12px;
        border-radius: 999px;
        cursor: pointer;
        font-weight: 600;
        font-size: 12px;
        white-space: nowrap;
      }
      .action-btn.secondary {
        background: transparent;
        border: 1px solid var(--border);
        color: var(--fg);
        font-weight: 500;
      }
      .action-btn:hover { background: var(--btn-bg-hover); }
      .action-btn.secondary:hover { background: var(--vscode-editor-background); }

      .toolbar {
        display: flex;
        flex-direction: column;
        gap: 6px;
        align-items: center;
      }
      .toolbar-row {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: center;
      }
      .tool-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        background: var(--btn-bg);
        color: var(--btn-fg);
        border: none;
        padding: 8px 18px;
        border-radius: 999px;
        cursor: pointer;
        font-weight: 600;
        font-size: 13px;
        min-width: 150px;
        min-height: 40px;
        white-space: nowrap;
      }
      .tool-btn:hover { background: var(--btn-bg-hover); }
      .tool-btn.secondary {
        background: var(--btn-bg);
        color: var(--btn-fg);
        border: none;
        font-weight: 600;
      }
      .tool-btn.secondary:hover {  background: var(--btn-bg-hover);  }

      .btn-icon img { width: 16px; height: 16px; }

      .composer {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: end;
      }
      textarea {
        width: 100%;
        min-height: 56px;
        max-height: 160px;
        resize: vertical;
        padding: 8px;
        border-radius: 8px;
        background: var(--input-bg);
        color: var(--input-fg);
        border: 1px solid var(--input-border);
      }
      .send-btn {
        background: var(--btn-bg);
        color: var(--btn-fg);
        border: none;
        padding: 0 22px;
        min-height: 56px;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        font-size: 13px;
      }
      .send-btn:hover { background: var(--btn-bg-hover); }

      .busy textarea,
      .busy button {
        opacity: 0.99;
      }
      .busy textarea,
      .busy .send-btn,
      .busy .tool-btn,
      .busy .action-btn {
        pointer-events: none;
      }

      .typing {
        display: inline-block;
        width: 1.1em;
        text-align: left;
      }
      .typing::after {
        content: '…';
        animation: blink 1s infinite steps(1,end);
      }
      @keyframes blink { 50% { opacity: 0; } }
    `;

    const js = `
      const vscode = acquireVsCodeApi();
      const state = vscode.getState() || { messages: [] };

      const chat = document.getElementById('chat');
      const input = document.getElementById('input');
      const root = document.getElementById('root');

      let isBusy = false;

      const WELCOME_TEXT = 'Hi, I am your STPA Agent. I can guide you step-by-step according to the STPA Handbook.';

      function persist(role, text) {
        const messages = (vscode.getState()?.messages || []);
        messages.push({ id: String(Date.now()), role, text });
        vscode.setState({ messages });
      }

      function append(role, text, save = true) {
        const row = document.createElement('div');
        row.className = 'msg ' + role;

        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerText = text;

        const label = document.createElement('div');
        label.className = 'role';
        label.textContent = role === 'user'
          ? 'You'
          : (role === 'assistant' ? 'STPA Agent' : 'Info');

        if (role === 'user') {
          row.appendChild(label);
          row.appendChild(bubble);
        } else {
          row.appendChild(bubble);
          row.appendChild(label);
        }

        chat.appendChild(row);
        scrollToBottom();

        if (save) persist(role, text);
      }

      function renderActionButtons(groupId, buttons) {
        const row = document.createElement('div');
        row.className = 'action-row';
        row.dataset.group = groupId;

        buttons.forEach(btn => {
          const b = document.createElement('button');
          b.className = 'action-btn ' + (btn.secondary ? 'secondary' : '');
          b.textContent = btn.label;
          b.onclick = () => {
            if (isBusy) return;
            row.remove();
            append('user', btn.label, true);
            showTyping();
            vscode.postMessage({ type: 'guidedAction', payload: { action: btn.action } });
          };
          row.appendChild(b);
        });

        chat.appendChild(row);
        scrollToBottom();
      }

      function renderWelcomeButtonsOnly() {
        // avoid duplicates
        if (chat.querySelector('.action-row[data-group="welcome"]')) return;

        renderActionButtons('welcome', [
          { label: 'Start guided STPA (Step 1)', action: 'startStep1' },
          { label: 'Jump to a specific step', action: 'jumpToStep', secondary: true }
        ]);
      }

      function renderWelcome() {
        // IMPORTANT: do NOT persist the welcome message, otherwise on reload it blocks buttons.
        append('system', WELCOME_TEXT, false);
        renderWelcomeButtonsOnly();
      }

      // initial render
      if (!state.messages || state.messages.length === 0) {
        renderWelcome();
      } else {
        (state.messages || []).forEach(m => append(m.role, m.text, false));

        // If the state contains ONLY the welcome message (common after reload) → show the welcome buttons.
        const onlyWelcome =
          (state.messages.length === 1 &&
           state.messages[0].role === 'system' &&
           String(state.messages[0].text || '').includes('STPA Agent'));

        if (onlyWelcome) {
          renderWelcomeButtonsOnly();
        }
      }

      scrollToBottom();

      // toolbar
      document.getElementById('btnPreview').onclick = () => {
        if (isBusy) return;
        showTyping();
        vscode.postMessage({ type: 'previewDiagrams' });
      };

      document.getElementById('btnExplain').onclick = () => {
        if (isBusy) return;
        showTyping();
        vscode.postMessage({ type: 'explainCurrentStep' });
      };

      document.getElementById('btnClear').onclick = () => {
        vscode.setState({ messages: [] });
        chat.innerHTML = '';
        hideTyping();
        vscode.postMessage({ type: 'clear' });
        renderWelcome();
      };

      // send manual/smart edit
      document.getElementById('btnSend').onclick = onSend;

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onSend();
        }
      });

      function onSend() {
        if (isBusy) return;

        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        append('user', text, true);

        const wantsEdit = (() => {
          const lower = text.toLowerCase();
          return (
            /(add|create|insert|append|augment|extend|remove|delete|update|change)/i.test(lower) ||
            /(h\\d+|l\\d+|uca\\d+)/i.test(lower) ||
            /(hazard|loss|uca|constraint)/i.test(lower)
          );
        })();

        showTyping();

        if (wantsEdit) {
          vscode.postMessage({ type: 'smartEdit', payload: { text } });
        } else {
          vscode.postMessage({ type: 'manualPrompt', payload: { text } });
        }
      }

      // typing indicator
      let typingRow = null;

      function showTyping() {
        if (typingRow && typingRow.parentElement) return;

        typingRow = document.createElement('div');
        typingRow.className = 'msg assistant';

        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerHTML = '<span class="typing"></span>';

        const label = document.createElement('div');
        label.className = 'role';
        label.textContent = 'STPA Agent';

        typingRow.appendChild(bubble);
        typingRow.appendChild(label);

        chat.appendChild(typingRow);
        scrollToBottom();
      }

      function hideTyping() {
        if (typingRow && typingRow.parentElement) typingRow.remove();
        typingRow = null;
      }

      function scrollToBottom() {
        chat.scrollTop = chat.scrollHeight;
      }

      // receive from extension
      window.addEventListener('message', (event) => {
        const msg = event.data;

        if (msg.type === 'append') {
          hideTyping();
          append(msg.payload.role, msg.payload.text, true);
        }

        if (msg.type === 'busy') {
          isBusy = !!msg.payload;

          if (isBusy) {
            root.classList.add('busy');
            showTyping();
          } else {
            root.classList.remove('busy');
            setTimeout(() => {
              if (!isBusy) hideTyping();
            }, 150);
          }
        }

        if (msg.type === 'toast') {
          hideTyping();
          append('system', String(msg.payload), true);
        }

        if (msg.type === 'reset') {
          hideTyping();
          chat.innerHTML = '';
          vscode.setState({ messages: [] });
          renderWelcome();
        }

        if (msg.type === 'guidedActions') {
          hideTyping();

          const stage = msg.payload?.stage;
          if (!stage) return;

          if (stage === 'afterStep1') {
            renderActionButtons('afterStep1', [
              { label: 'Approve Step 1 and continue to Step 2', action: 'continueStep2' },
              { label: 'Edit Step 1', action: 'editCurrentStep', secondary: true }
            ]);
          }

          if (stage === 'afterStep2') {
            renderActionButtons('afterStep2', [
              { label: 'Approve Step 2 and continue to Step 3', action: 'continueStep3' },
              { label: 'Edit Step 2', action: 'editCurrentStep', secondary: true }
            ]);
          }

          if (stage === 'afterStep3') {
            renderActionButtons('afterStep3', [
              { label: 'Approve Step 3 and continue to Step 4', action: 'continueStep4' },
              { label: 'Edit Step 3', action: 'editCurrentStep', secondary: true }
            ]);
          }

          if (stage === 'afterStep4') {
            renderActionButtons('afterStep4', [
              { label: 'Edit Step 4', action: 'editCurrentStep', secondary: true },
              { label: 'Generate Diagrams', action: 'generateDiagrams' }
            ]);
          }
        }
      });
    `;

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>${css}</style>
        </head>
        <body>
          <div id="root" class="container">
            <div id="chat" class="chat" role="log" aria-live="polite"></div>

            <div class="toolbar">
              <div class="toolbar-row">
                <button id="btnPreview" class="tool-btn">
                  <span class="btn-icon"><img src="${icons.diagram}" alt="" /></span>
                  <span class="btn-label">Preview Diagrams</span>
                </button>

                <button id="btnExplain" class="tool-btn">
                  <span class="btn-icon"><img src="${icons.explain}" alt="" /></span>
                  <span class="btn-label">Explain current step</span>
                </button>
              </div>

              <div class="toolbar-row">
                <button id="btnClear" class="tool-btn secondary">
                  <span class="btn-icon"><img src="${icons.clear}" alt="" /></span>
                  <span class="btn-label">Clear</span>
                </button>
              </div>
            </div>

            <div class="composer">
              <textarea id="input" placeholder="Type your system description or STPA request here."></textarea>
              <button id="btnSend" class="send-btn">Send</button>
            </div>
          </div>

          <script>${js}</script>
        </body>
      </html>
    `;
  }
}
