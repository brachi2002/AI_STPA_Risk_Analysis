import * as vscode from 'vscode';
import OpenAI from 'openai';

type ToolbarIcons = {
  explain: vscode.Uri;
  diagram: vscode.Uri;
  clear: vscode.Uri;
};

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export class StpaChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'stpa-agent.chat';
  private _view?: vscode.WebviewView;

  // When true, the next time the webview signals "ready", we clear chat state/UI.
  private _clearOnNextReady = true;

  constructor(private readonly context: vscode.ExtensionContext) { }

  /** Safely send a message to the webview (if mounted). */
  public sendToWebview(message: any) {
    this._view?.webview.postMessage(message);
  }

  /**
   * Ask the webview to clear itself the next time it's ready.
   * Call this from activate() to ensure a fresh chat after reload/run.
   */
  public requestClearOnNextReady() {
    this._clearOnNextReady = true;
    // If already mounted, attempt an immediate reset too.
    this.sendToWebview({ type: 'reset' });
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    console.log('stpa-ext: resolveWebviewView start');
    console.log('stpa-ext: resolveWebviewView');
    this._view = webviewView;
    const webview = webviewView.webview;

    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot],
    };

    const icons: ToolbarIcons = {
      explain: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'analyze.svg')),
      diagram: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'diagram.svg')),
      clear: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'clear.svg')),
    };

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'main.js'));
    webview.html = this.getHtml(webview, icons, scriptUri);
    console.log('stpa-ext: webview.html set');

    const allowedModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'];

    webview.onDidReceiveMessage(async (msg) => {
      console.log('stpa-ext: message from webview', msg.type);
      switch (msg.type) {
        // Webview handshake: it is now safe to post messages to it.
        case 'ready': {
          if (this._clearOnNextReady) {
            this._clearOnNextReady = false;
            this.sendToWebview({ type: 'reset' });
          }
          const config = vscode.workspace.getConfiguration('stpaAgent');
          const modelSetting = config.get<string>('model', 'gpt-4o-mini');
          const model = allowedModels.includes(modelSetting) ? modelSetting : 'gpt-4o-mini';
          this.sendToWebview({ type: 'model', payload: { model } });
          break;
        }

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
          if (!action) { return; }

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

            case 'confirmJumpGuidedFile':
              await vscode.commands.executeCommand('stpa-agent.guided.jumpConfirm');
              break;

            // NEW: in-chat jump buttons
            case 'jumpStep1':
              await vscode.commands.executeCommand('stpa-agent.guided.startStep1');
              break;

            case 'jumpStep2':
              await vscode.commands.executeCommand('stpa-agent.guided.jumpInit', 2);
              break;

            case 'jumpStep3':
              await vscode.commands.executeCommand('stpa-agent.guided.jumpInit', 3);
              break;

            case 'jumpStep4':
              await vscode.commands.executeCommand('stpa-agent.guided.jumpInit', 4);
              break;


            // old command (optional to keep)
            case 'jumpToStep':
              await vscode.commands.executeCommand('stpa-agent.guided.jumpToStep');
              break;

            case 'jumpOpenExistingStep':
              await vscode.commands.executeCommand('stpa-agent.guided.openStepInGuidedFile', msg.payload?.targetStep);
              break;

            case 'jumpEditTargetStep':
              await vscode.commands.executeCommand('stpa-agent.guided.jumpEditTargetStep', msg.payload?.targetStep);
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

            const text =
              Array.isArray(res) ? res.join('\n') : (res as any) || 'Applied.';

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

            // ✅⬇️⬇️⬇️ זה המקום המדויק ⬇️⬇️⬇️
            // החזרת כפתורי EDIT / APPROVE אחרי השגיאה או ההצלחה
            this.sendToWebview({
              type: 'guidedActions',
              payload: { stage: 'afterCurrentStep' },
            });
          }

          break;
        }


        case 'applySmartEditPlan': {
          const planId = msg?.payload?.id;
          const out = await vscode.commands.executeCommand('stpa-agent.smartEdit.applyPlan', planId);
          if (typeof out === 'string' && out.trim()) {
            this.sendToWebview({ type: 'append', payload: { role: 'assistant', text: out } });
          }
          break;
        }

        case 'discardSmartEditPlan': {
          const planId = msg?.payload?.id;
          const out = await vscode.commands.executeCommand('stpa-agent.smartEdit.discardPlan', planId);
          if (typeof out === 'string' && out.trim()) {
            this.sendToWebview({ type: 'append', payload: { role: 'assistant', text: out } });
          }
          break;
        }

        case 'manualPrompt':
          await this.runManualPrompt(msg.payload?.text ?? '');
          break;

        case 'setModel': {
          const raw = msg.payload?.model;
          const model = typeof raw === 'string' ? raw.trim() : '';
          if (model && allowedModels.includes(model)) {
            const config = vscode.workspace.getConfiguration('stpaAgent');
            await config.update('model', model, vscode.ConfigurationTarget.Global);
            this.sendToWebview({ type: 'model', payload: { model } });
          }
          break;
        }

        // User clicked Clear in the UI
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
      this.sendToWebview({ type: 'toast', payload: 'Please type a message.' });
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

  private getHtml(webview: vscode.Webview, icons: ToolbarIcons, scriptUri: vscode.Uri): string {
    const nonce = getNonce();
    const csp = [
      "default-src 'none';",
      `img-src ${webview.cspSource} data:;`,
      `style-src 'nonce-${nonce}';`,
      `script-src 'nonce-${nonce}';`,
    ].join(' ');
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
      .tool-btn.secondary:hover { background: var(--btn-bg-hover); }

      .btn-icon img { width: 16px; height: 16px; }

      .composer {
        display: grid;
        grid-template-columns: 1fr auto auto;
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
      .model-select {
        min-height: 56px;
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
      .busy button,
      .busy select {
        opacity: 0.99;
      }
      .busy textarea,
      .busy .send-btn,
      .busy .model-select,
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

      /* Smart edit plan card */
      .plan-card {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px;
        margin: 10px 0;
        background: var(--vscode-editor-background);
      }
      .plan-title { font-weight: 700; margin-bottom: 6px; }
      .plan-summary { color: var(--muted); margin-bottom: 8px; }
      .plan-actions { margin-top: 6px; }
      .plan-btn-row { display: flex; gap: 8px; margin-top: 10px; justify-content: flex-end; }
      .plan-btn { border-radius: 8px; padding: 6px 10px; border: 1px solid var(--border); background: var(--btn-bg); color: var(--btn-fg); cursor: pointer; font-weight: 600; }
      .plan-btn:hover { background: var(--btn-bg-hover); }
      .plan-btn.secondary { background: transparent; color: var(--fg); font-weight: 500; }
    `;

    // IMPORTANT: This string is embedded inside another template literal (the HTML).
    // Avoid backticks inside this JS string (no template literals inside).
    const js = `
      console.log('stpa-webview: boot start');
      console.log('stpa-webview: acquireVsCodeApi typeof', typeof acquireVsCodeApi);
      const vscode = acquireVsCodeApi();
      console.log('stpa-webview: acquireVsCodeApi ok');
      const savedState = vscode.getState() || {};
      const savedMessages = Array.isArray(savedState.messages) ? savedState.messages : [];
      console.log('stpa-webview: savedState', savedState);

      const chat = document.getElementById('chat');
      const input = document.getElementById('input');
      const root = document.getElementById('root');
      const modelSelect = document.getElementById('modelSelect');
      const bootMarker = document.getElementById('boot-marker');
      if (bootMarker) bootMarker.remove();

      let isBusy = false;

      const WELCOME_TEXT ='Hi, I am your STPA Agent. I can guide you step-by-step according to the STPA Handbook.\n\n' + 'Please make sure your System Description is currently open in the editor.';
      const AUTO_SCROLL_THRESHOLD = 120;
      let autoScrollPending = false;
      let autoScrollFrame = 0;
      let autoScrollForce = false;

      function isNearBottom() {
        return (chat.scrollHeight - (chat.scrollTop + chat.clientHeight)) < AUTO_SCROLL_THRESHOLD;
      }

      function requestAutoScroll(shouldScroll, force) {
        if (force) autoScrollForce = true;
        if (!force && !shouldScroll) return;
        autoScrollPending = true;
        if (autoScrollFrame) return;

        autoScrollFrame = requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            autoScrollFrame = 0;
            if (!autoScrollPending) return;
            autoScrollPending = false;
            const shouldForce = autoScrollForce;
            autoScrollForce = false;
            if (!shouldForce && !isNearBottom()) return;
            chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
          });
        });
      }

      function scrollToBottomImmediate() {
        chat.scrollTop = chat.scrollHeight;
      }

      function moveActionRowsToBottom() {
        const rows = chat.querySelectorAll('.action-row');
        rows.forEach(function(row) { chat.appendChild(row); });
      }

      function getMessages() {
        const st = vscode.getState() || { messages: [] };
        return Array.isArray(st.messages) ? st.messages : [];
      }

      function setMessages(messages) {
        vscode.setState({ messages: messages });
      }

      function persist(role, text) {
        const messages = getMessages();
        messages.push({ id: String(Date.now()), role: role, text: text });
        setMessages(messages);
      }

      function append(role, text, save) {
        if (save === undefined) save = true;
        const shouldScroll = isNearBottom();

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
        const forceScroll = role === 'assistant';
        if (forceScroll) {
          moveActionRowsToBottom();
        }
        requestAutoScroll(forceScroll ? true : shouldScroll, forceScroll);

        if (save) persist(role, text);
      }

      function renderActionButtons(groupId, buttons) {
        console.log('stpa-webview: renderActionButtons', groupId, Array.isArray(buttons) ? buttons.length : 0);
        const existing = chat.querySelector('.action-row[data-group="' + groupId + '"]');
        if (existing) {
          const shouldScroll = isNearBottom();
          chat.appendChild(existing);
          requestAutoScroll(shouldScroll, true);
          return;
        }
        const shouldScroll = isNearBottom();

        const row = document.createElement('div');
        row.className = 'action-row';
        row.dataset.group = groupId;

        buttons.forEach(function(btn) {
          const b = document.createElement('button');
          b.className = 'action-btn ' + (btn.secondary ? 'secondary' : '');
          b.textContent = btn.label;
          b.onclick = function() {
            if (isBusy) return;

            row.remove();
            append('user', btn.label, true);

            // Jump button: open menu inside chat only
            if (btn.action === 'openJumpMenu') {
              hideTyping();
              renderJumpMenu();
              return;
            }
          
            showTyping();
            if (btn.action === 'jumpOpenExistingStep') {
              vscode.postMessage({
                type: 'guidedAction',
                payload: { action: 'jumpOpenExistingStep', targetStep: window.__jumpTargetStep }
              });
            } else if (btn.action === 'jumpEditTargetStep') {
              vscode.postMessage({
                type: 'guidedAction',
                payload: { action: 'jumpEditTargetStep', targetStep: window.__jumpTargetStep }
              });
            } else {
              vscode.postMessage({ type: 'guidedAction', payload: { action: btn.action } });
            }

          };

          row.appendChild(b);
        });

        chat.appendChild(row);
        requestAutoScroll(shouldScroll, true);
      }


      function renderSmartEditPlan(plan) {
        if (!plan || !plan.id) return;
        const shouldScroll = isNearBottom();

        // Remove previous plan card with the same id
        const existing = document.querySelector('[data-plan-id="' + plan.id + '"]');
        if (existing) existing.remove();

        const card = document.createElement('div');
        card.className = 'plan-card';
        card.setAttribute('data-plan-id', plan.id);

        const title = document.createElement('div');
        title.className = 'plan-title';
        title.textContent = plan.title || 'Suggested consistency fixes';

        const summary = document.createElement('div');
        summary.className = 'plan-summary';
        summary.textContent = plan.summary || '';

        const actions = Array.isArray(plan.actions) ? plan.actions : [];
        if (actions.length) {
          const listWrap = document.createElement('div');
          listWrap.className = 'plan-actions';

          const ul = document.createElement('ul');
          ul.style.margin = '6px 0 0 18px';
          ul.style.padding = '0';

          actions.slice(0, 12).forEach(function(a) {
            const li = document.createElement('li');
            const op = String(a.op || '').toUpperCase();
            const sec = String(a.section || '');
            const note = a.note ? (' — ' + String(a.note)) : '';
            li.textContent = op + ' in ' + sec + note;
            ul.appendChild(li);
          });

          if (actions.length > 12) {
            const li = document.createElement('li');
            li.textContent = '...and ' + String(actions.length - 12) + ' more';
            ul.appendChild(li);
          }

          listWrap.appendChild(ul);
          card.appendChild(listWrap);
        }

        const btnRow = document.createElement('div');
        btnRow.className = 'plan-btn-row';

        const applyBtn = document.createElement('button');
        applyBtn.className = 'plan-btn';
        applyBtn.textContent = 'Apply suggested fixes';
        applyBtn.addEventListener('click', function() {
          vscode.postMessage({ type: 'applySmartEditPlan', payload: { id: plan.id } });
          applyBtn.disabled = true;
        });

        const discardBtn = document.createElement('button');
        discardBtn.className = 'plan-btn secondary';
        discardBtn.textContent = 'Dismiss';
        discardBtn.addEventListener('click', function() {
          vscode.postMessage({ type: 'discardSmartEditPlan', payload: { id: plan.id } });
          card.remove();
        });

        btnRow.appendChild(applyBtn);
        btnRow.appendChild(discardBtn);

        card.appendChild(title);
        card.appendChild(summary);
        card.appendChild(btnRow);

        // Show as an assistant message block (consistent layout)
        chat.appendChild(card);
        requestAutoScroll(shouldScroll, true);
      }
        


      function renderWelcomeButtonsOnly() {
        console.log('stpa-webview: renderWelcomeButtonsOnly');
        renderActionButtons('welcome', [
          { label: 'Start guided STPA (Step 1)', action: 'startStep1' },
          { label: 'Jump to a specific step', action: 'openJumpMenu', secondary: true }
        ]);
      }

      function renderWelcome() {
        console.log('stpa-webview: renderWelcome');
        append('system', WELCOME_TEXT, false);
        renderWelcomeButtonsOnly();
      }

      function renderJumpMenu() {
        renderActionButtons('jumpMenu', [
          { label: 'Step 1', action: 'startStep1' },
          { label: 'Step 2', action: 'jumpStep2' },
          { label: 'Step 3', action: 'jumpStep3' },
          { label: 'Step 4', action: 'jumpStep4' },
        ]);
      }

      function renderJumpFallbackButtons(groupId) {
        renderActionButtons(groupId, [
          { label: 'Back to step menu', action: 'openJumpMenu', secondary: true },
        ]);
      }





      function hardReset() {
        hideTyping();
        chat.innerHTML = '';
        setMessages([]);
        renderWelcome();
      }

      // initial render
      if (!Array.isArray(savedState.messages)) {
        setMessages([]);
      }

      if (savedMessages.length === 0) {
        renderWelcome();
      } else {
        savedMessages.forEach(function(m) { append(m.role, m.text, false); });

        const onlyWelcome =
          (savedMessages.length === 1 &&
           savedMessages[0].role === 'system' &&
           String(savedMessages[0].text || '').indexOf('STPA Agent') !== -1);

        if (onlyWelcome) {
          renderWelcomeButtonsOnly();
        }
      }

      scrollToBottomImmediate();

      // Tell extension we're ready (so it can clear on activation)
      window.addEventListener('load', function() {
        vscode.postMessage({ type: 'ready' });
      });

      // toolbar
      document.getElementById('btnPreview').onclick = function() {
        if (isBusy) return;
        showTyping();
        vscode.postMessage({ type: 'previewDiagrams' });
      };

      document.getElementById('btnExplain').onclick = function() {
        if (isBusy) return;
        showTyping();
        vscode.postMessage({ type: 'explainCurrentStep' });
      };

      document.getElementById('btnClear').onclick = function() {
        hardReset();
        vscode.postMessage({ type: 'clear' });
      };

      // send manual/smart edit
      document.getElementById('btnSend').onclick = onSend;
      console.log('stpa-webview: listeners attached', {
        send: !!document.getElementById('btnSend'),
        input: !!input,
        chat: !!chat
      });

      if (modelSelect) {
        modelSelect.addEventListener('change', function() {
          const value = String(modelSelect.value || '');
          if (!value) return;
          vscode.postMessage({ type: 'setModel', payload: { model: value } });
        });
      }

      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onSend();
        }
      });
      console.log('stpa-webview: handlers attached');

      function onSend() {
        console.log('stpa-webview: send clicked');
        if (isBusy) return;

        const text = String(input.value || '').trim();
        if (!text) return;

        input.value = '';
        append('user', text, true);

        const lower = text.toLowerCase();
        const wantsEdit =
          /(add|create|insert|append|augment|extend|remove|delete|update|change)/i.test(lower) ||
          /(h[0-9]+|l[0-9]+|uca[0-9]+)/i.test(lower) ||
          /(hazard|loss|uca|constraint)/i.test(lower);

        showTyping();

        if (wantsEdit) {
          vscode.postMessage({ type: 'smartEdit', payload: { text: text } });
        } else {
          vscode.postMessage({ type: 'manualPrompt', payload: { text: text } });
        }
      }

      // typing indicator
      let typingRow = null;

      function showTyping() {
        if (typingRow && typingRow.parentElement) return;
        const shouldScroll = isNearBottom();

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
        requestAutoScroll(shouldScroll, true);
      }

      function hideTyping() {
        if (typingRow && typingRow.parentElement) typingRow.remove();
        typingRow = null;
      }

      // receive from extension
      window.addEventListener('message', function(event) {
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
            setTimeout(function() {
              if (!isBusy) hideTyping();
            }, 150);
          }
        }

        if (msg.type === 'toast') {
          hideTyping();
          append('system', String(msg.payload), true);
        }

        if (msg.type === 'showSmartEditPlan') {
          hideTyping();
          renderSmartEditPlan(msg.payload);
        }

        if (msg.type === 'reset') {
          hardReset();
        }

        if (msg.type === 'guidedActions') {
          hideTyping();

          const stage = msg.payload && msg.payload.stage;
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
          
          if (stage === 'confirmJumpGuidedFile') {
            renderActionButtons('confirmJumpGuidedFile', [
              { label: 'Confirm your stpa file', action: 'confirmJumpGuidedFile' },
              { label: 'Cancel', action: 'openJumpMenu', secondary: true }
            ]);
          }

          if (stage === 'jumpMissingSteps') {
            const missing = Number(msg.payload && msg.payload.missingStep);
            const target = Number(msg.payload && msg.payload.targetStep);

            const contAction =
              (missing === 1) ? 'startStep1' :
              (missing === 2) ? 'continueStep2' :
              'continueStep3';

            renderActionButtons('jumpMissingSteps', [
              { label: 'Continue from Step ' + String(missing), action: contAction },  // ✅ calls normal flow
              { label: 'Confirm guided file', action: 'confirmJumpGuidedFile', secondary: true },
              { label: 'Back to Jump menu', action: 'openJumpMenu', secondary: true },
            ]);

            window.__jumpMissingStep = missing;
            window.__jumpTargetStep = target;
          }

          
          if (stage === 'jumpTargetExists') {
            const target = Number(msg.payload && msg.payload.targetStep);

            renderActionButtons('jumpTargetExists', [
              { label: 'Open Step ' + String(target) + ' in the guided file', action: 'jumpOpenExistingStep' },
              { label: 'Edit Step ' + String(target), action: 'editCurrentStep', secondary: true },
              { label: 'Back to step menu', action: 'openJumpMenu', secondary: true },
            ]);

            window.__jumpTargetStep = target;
          }

          // Fallback: never get stuck without buttons on Jump-related stages
          const looksLikeJumpStage =
            String(stage || '').toLowerCase().includes('jump');

          if (looksLikeJumpStage) {
            // If no action-row was added for this stage, add a default one.
            const existing = chat.querySelector('.action-row[data-group="' + stage + '"]');
            if (!existing) {
              renderJumpFallbackButtons(stage);
            }
          }




        }

        if (msg.type === 'model') {
          const value = String(msg.payload && msg.payload.model || '');
          if (value && modelSelect) {
            const option = modelSelect.querySelector('option[value="' + value + '"]');
            if (option) modelSelect.value = value;
          }
        }
      });
      
    `;

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta http-equiv="Content-Security-Policy" content="${csp}" />
          <style nonce="${nonce}">${css}</style>
        </head>
        <body>
          <div id="root" class="container">
            <div id="chat" class="chat" role="log" aria-live="polite">
              <div id="boot-marker" style="font-size: 11px; color: var(--muted); text-align: center;">WEBVIEW BOOT OK</div>
            </div>

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
              <select id="modelSelect" class="model-select" title="Model">
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                <option value="gpt-4.1">gpt-4.1</option>
              </select>
              <button id="btnSend" class="send-btn">Send</button>
            </div>
          </div>

          <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>
    `;
  }
}
