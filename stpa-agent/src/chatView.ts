import * as vscode from 'vscode';
import OpenAI from 'openai';

type ChatMsg = { id: string; role: 'user' | 'assistant' | 'system'; text: string };

type ToolbarIcons = {
  analyze: vscode.Uri;
  selection: vscode.Uri;
  refine: vscode.Uri;
  export: vscode.Uri;
  diagram: vscode.Uri;
  clear: vscode.Uri;
};

export class StpaChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'stpa-agent.chat';
  private _view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    const webview = webviewView.webview;
    webview.options = { enableScripts: true };

    // אייקונים מתיקיית media
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const icons: ToolbarIcons = {
      analyze: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'analyze.svg')),
      selection: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'selection.svg')),
      refine: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'refine.svg')),
      export: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'export.svg')),
      diagram: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'diagram.svg')),
      clear: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'clear.svg')),
    };

    webview.html = this.getHtml(icons);

    // קבלת הודעות מה-webview (כפתורים / צ׳אט)
    webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'analyzeFile':
          await vscode.commands.executeCommand('stpa-agent.analyzeCurrentFile');
          break;
        case 'analyzeSelection':
          await vscode.commands.executeCommand('stpa-agent.analyzeSelection');
          break;
        case 'refine':
          await vscode.commands.executeCommand('stpa-agent.refineAnalysis');
          break;
        case 'exportMd':
          await vscode.commands.executeCommand('stpa-agent.exportMarkdown');
          break;
        case 'previewDiagrams':
          await vscode.commands.executeCommand('stpa-agent.previewDiagrams');
          break;
        case 'manualPrompt':
          await this.runManualPrompt(msg.payload?.text ?? '');
          break;
        case 'smartEdit': {
          try {
            this.post({ type: 'busy', payload: true });
            const res = await vscode.commands.executeCommand(
              'stpa-agent.smartEdit',
              msg.payload?.text
            );
            const text = Array.isArray(res) ? res.join('\n') : (res || 'Applied.');
            this.post({ type: 'append', payload: { role: 'assistant', text } });
          } catch (e: any) {
            this.post({
              type: 'append',
              payload: { role: 'assistant', text: `Error: ${e?.message || e}` },
            });
          } finally {
            this.post({ type: 'busy', payload: false });
          }
          break;
        }
        case 'clear':
          this.post({ type: 'reset' });
          break;
        default:
          break;
      }
    });
  }

  /** שיחה ידנית מול GPT – התשובה תחזור ל-webview כהודעת assistant */
  private async runManualPrompt(text: string) {
    if (!text.trim()) {
      this.post({ type: 'toast', payload: 'נא להקליד הודעה.' });
      return;
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      this.post({ type: 'toast', payload: 'Missing OPENAI_API_KEY' });
      return;
    }
    try {
      this.post({ type: 'busy', payload: true });
      const openai = new OpenAI({ apiKey });
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [{ role: 'user', content: text }],
      });
      const content = resp.choices?.[0]?.message?.content?.trim() || '(no response)';
      this.post({ type: 'append', payload: { role: 'assistant', text: content } });
    } catch (e: any) {
      this.post({
        type: 'append',
        payload: { role: 'assistant', text: `Error: ${e?.message || e}` },
      });
    } finally {
      this.post({ type: 'busy', payload: false });
    }
  }

  private post(message: any) {
    this._view?.webview.postMessage(message);
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
        --link: var(--vscode-textLink-foreground);
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

      /* שלושה אזורים: צ'אט (למעלה), כפתורים (באמצע), שורת כתיבה (למטה) */
      .container {
        display: grid;
        grid-template-rows: 1fr auto auto;
        height: 100%;
        gap: 8px;
        padding: 10px;
      }

      /* === CHAT === */
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

      .system {
        justify-content: center;
      }
      .system .bubble {
        background: transparent;
        color: var(--muted);
        border: 1px dashed var(--border);
      }

      /* === TOOLBAR – כפתורים מתחת לצ'אט, במרכז === */
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
        background: transparent;
        color: var(--fg);
        border: 1px solid var(--border);
        font-weight: 500;
      }
      .tool-btn.secondary:hover {
        background: var(--vscode-editor-background);
      }

      .btn-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .btn-icon img {
        width: 16px;
        height: 16px;
        display: block;
      }
      .btn-label {
        line-height: 1;
      }

      /* === COMPOSER – האזור שכותבים בו (פשוט, כמו קודם) === */
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

      textarea:focus {
        outline: none;
        border-color: var(--btn-bg);
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

      .busy { opacity: 0.65; pointer-events: none; }

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
      a { color: var(--link); }
    `;

    const js = `
      const vscode = acquireVsCodeApi();

      const state = vscode.getState() || { messages: [] };
      const chat = document.getElementById('chat');
      const input = document.getElementById('input');
      const root = document.getElementById('root');

      // רנדר ראשון של ההודעות
      if (!state.messages || state.messages.length === 0) {
        append('system', 'Welcome to the STPA Agent. How can I help you?', true);
      } else {
        (state.messages || []).forEach(m => append(m.role, m.text, false));
      }
      scrollToBottom();

      // כפתורים
      document.getElementById('btnAnalyze').onclick = () => send('analyzeFile');
      document.getElementById('btnAnalyzeSel').onclick = () => send('analyzeSelection');
      document.getElementById('btnRefine').onclick = () => send('refine');
      document.getElementById('btnPreview').onclick = () => send('previewDiagrams');
      document.getElementById('btnClear').onclick = () => {
        vscode.setState({ messages: [] });
        chat.innerHTML = '';
        send('clear');
      };

      // שליחה ידנית
      document.getElementById('btnSend').onclick = onSend;
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onSend();
        }
      });

      function onSend() {
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        append('user', text, true);

        // זיהוי האם המשתמש מבקש לערוך את הקובץ (Smart Edit)
        const wantsEdit = (() => {
          const lower = text.toLowerCase();
          return (
            /(add|create|insert|append|augment|extend)/i.test(lower) ||
            /(h\\d+|l\\d+|uca\\d+)/i.test(lower) ||
            /(hazard|loss|uca)/i.test(lower)
          );
        })();

        showTyping();

        if (wantsEdit) {
          console.log('[ChatView] Smart edit trigger detected:', text);
          send('smartEdit', { text });
        } else {
          send('manualPrompt', { text });
        }
      }

      function send(type, payload) { vscode.postMessage({ type, payload }); }

      // קבלת הודעות מה-extension
      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.type === 'append') {
          hideTyping();
          append(msg.payload.role, msg.payload.text, true);
        } else if (msg.type === 'busy') {
          if (msg.payload) root.classList.add('busy'); else root.classList.remove('busy');
        } else if (msg.type === 'toast') {
          append('system', String(msg.payload), true);
        } else if (msg.type === 'reset') {
          chat.innerHTML = '';
          vscode.setState({ messages: [] });
        }
      });

      // UI helpers
      function append(role, text, persist = true) {
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

        if (persist) {
          const messages = (vscode.getState()?.messages || []);
          messages.push({ id: String(Date.now()), role, text });
          vscode.setState({ messages });
        }
      }

      // "הקלדה…" מדומה עד שמגיעה תשובה
      let typingRow = null;
      function showTyping() {
        hideTyping();
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
        if (typingRow && typingRow.parentElement) {
          chat.removeChild(typingRow);
        }
        typingRow = null;
      }

      function scrollToBottom() { chat.scrollTop = chat.scrollHeight; }
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
                <button id="btnAnalyze" class="tool-btn">
                  <span class="btn-icon"><img src="${icons.analyze}" alt="" /></span>
                  <span class="btn-label">Analyze File</span>
                </button>
                <button id="btnAnalyzeSel" class="tool-btn">
                  <span class="btn-icon"><img src="${icons.selection}" alt="" /></span>
                  <span class="btn-label">Analyze Selection</span>
                </button>
              </div>
              <div class="toolbar-row">
                <button id="btnRefine" class="tool-btn">
                  <span class="btn-icon"><img src="${icons.refine}" alt="" /></span>
                  <span class="btn-label">Refine</span>
                </button>
                <button id="btnPreview" class="tool-btn">
                  <span class="btn-icon"><img src="${icons.diagram}" alt="" /></span>
                  <span class="btn-label">Preview Diagrams</span>
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
              <textarea
                id="input"
                placeholder="Type your system description or STPA request here."
              ></textarea>
              <button id="btnSend" class="send-btn">Send</button>
            </div>
          </div>
          <script>${js}</script>
        </body>
      </html>
    `;
  }
}
