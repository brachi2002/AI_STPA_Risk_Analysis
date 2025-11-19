import * as vscode from 'vscode';
import OpenAI from 'openai';

type ChatRole = 'user' | 'assistant' | 'system';
type ChatMsg = { id: string; role: ChatRole; text: string };

export class StpaChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'stpa-agent.chat';
  private _view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) { }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    const webview = webviewView.webview;
    webview.options = { enableScripts: true };

    webview.html = this.getHtml(webview);

    // Handle messages from webview
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

  /** Manual chat with the model – returns reply into the webview */
  private async runManualPrompt(text: string) {
    if (!text.trim()) {
      this.post({ type: 'toast', payload: 'Please type a message.' });
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
      this.post({ type: 'append', payload: { role: 'assistant', text: `Error: ${e?.message || e}` } });
    } finally {
      this.post({ type: 'busy', payload: false });
    }
  }

  private post(message: any) {
    this._view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    // Build URIs for icons from /media
    const mediaUri = (name: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', name));

    const iconAnalyze = mediaUri('analyze.svg');
    const iconSel = mediaUri('selection.svg');
    const iconRefine = mediaUri('refine.svg');
    const iconExport = mediaUri('export.svg');
    const iconDiagram = mediaUri('diagram.svg');
    const iconClear = mediaUri('clear.svg');

    const css = `
      :root{
        --bg: var(--vscode-sideBar-background);
        --panel: var(--vscode-editor-background);
        --fg: var(--vscode-foreground);
        --muted: var(--vscode-descriptionForeground);
        --border: var(--vscode-editorGroup-border);
        --accent: #12c2c2;              /* turquoise */
        --accent-hover:#0fb2b2;
        --accent-fg: #ffffff;
        --input-bg: var(--vscode-input-background);
        --input-fg: var(--vscode-input-foreground);
        --input-border: var(--vscode-input-border);
        --assistant-bubble: var(--vscode-editorInlayHint-background,#00000020);
      }
      *{box-sizing:border-box}
      html,body{height:100%}
      body{
        margin:0;padding:0;background:var(--bg);color:var(--fg);
        font-family: var(--vscode-font-family); font-size:13px;
      }

      .container{
        display:grid;grid-template-rows:auto 1fr auto;gap:10px;height:100%;padding:10px;
      }

      .toolbar{
        display:grid;
        grid-template-columns: 1fr auto; /* left: stacks, right: clear */
        align-items:center;
        gap:8px;
      }
      .btn-stacks{
        display:flex; flex-direction:column; gap:8px;
      }
      .row{
        display:flex; gap:8px; flex-wrap:wrap;
      }
      .spacer{flex:1}

      button.btn{
        display:inline-flex; align-items:center; gap:8px;
        max-width: 100%;
        background: var(--accent);
        color: var(--accent-fg);
        border:none; border-radius:10px;
        padding:10px 14px;               /* a bit taller */
        font-weight:600;
        cursor:pointer;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }
      button.btn:hover{ background: var(--accent-hover); }
      button.secondary{
        background:transparent; color:var(--fg);
        border:1px solid var(--border);
      }
      button .icon{
        width:16px; height:16px; display:inline-block; flex:0 0 auto;
        background-size:contain; background-repeat:no-repeat; background-position:center;
        filter: invert(1) brightness(2); /* make white on turquoise */
      }
      button.secondary .icon{
        filter: none; /* keep original on secondary button */
      }

      .chat{
        background: var(--panel);
        border:1px solid var(--border);
        border-radius:10px;
        padding:10px;
        overflow:auto;
      }

      .msg{display:flex; gap:8px; margin:8px 0; align-items:flex-end;}
      .bubble{
        max-width:85%;
        padding:10px 12px;
        border-radius:12px;
        white-space:pre-wrap; word-wrap:break-word;
      }
      .role{font-size:11px; color:var(--muted); margin:0 6px;}

      .user{ justify-content:flex-end; }
      .user .bubble{
        background: var(--accent); color:#fff; border-bottom-right-radius:4px;
      }
      .assistant{ justify-content:flex-start; }
      .assistant .bubble{
        background: var(--assistant-bubble); border-bottom-left-radius:4px;
      }
      .system{ justify-content:center; }
      .system .bubble{
        background: transparent; color: var(--muted);
        border:1px dashed var(--border);
      }

      .composer{
        display:grid; grid-template-columns: 1fr auto; gap:8px; align-items:end;
      }
      textarea{
        width:100%; min-height:56px; max-height:160px; resize:vertical;
        padding:10px; border-radius:10px;
        background: var(--input-bg); color:var(--input-fg); border:1px solid var(--input-border);
      }

      .busy{ opacity:.65; pointer-events:none; }
      .typing{ display:inline-block; width:1.1em; text-align:left; }
      .typing::after{ content:'…'; animation: blink 1s infinite steps(1,end); }
      @keyframes blink{ 50%{ opacity:0; } }

      a{ color: var(--vscode-textLink-foreground); }
    `;

    const js = `
      const vscode = acquireVsCodeApi();
      const state = vscode.getState() || { messages: [] };

      const chat = document.getElementById('chat');
      const input = document.getElementById('input');
      const root  = document.getElementById('root');

      // Initial render
      (state.messages || []).forEach(m => append(m.role, m.text, false));
      if (!state.messages || state.messages.length === 0){
        append('system', 'Welcome to the STPA Agent. How can I help you?', true);
      }
      scrollToBottom();

      // Buttons
      document.getElementById('btnAnalyze').onclick = () => send('analyzeFile');
      document.getElementById('btnAnalyzeSel').onclick = () => send('analyzeSelection');
      document.getElementById('btnRefine').onclick = () => send('refine');
      document.getElementById('btnExport').onclick = () => send('exportMd');
      document.getElementById('btnPreview').onclick = () => send('previewDiagrams');
      document.getElementById('btnClear').onclick = () => {
        vscode.setState({ messages: [] });
        chat.innerHTML = '';
        append('system', 'Welcome to the STPA Agent. How can I help you?', true);
        send('clear');
      };

      // Send
      document.getElementById('btnSend').onclick = onSend;
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey){
          e.preventDefault(); onSend();
        }
      });

      function onSend() {
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        append('user', text, true);

        // 🧭 Intent: בקשה להריץ ניתוח STPA (בעברית/אנגלית)
        const t = text.toLowerCase();
        const wantAnalyze =
          /(run|do|perform|start).*stpa|analy[sz]e.*stpa/.test(t) ||
          /(ת(ע|)שה|הרץ|בצע).*(ניתוח|אנליזה).*stpa/.test(t) ||
          /(ניתוח\s*stpa|ניתוח\s*לדף\s*זה|תעשה\s*לי\s*ניתוח)/.test(t);

        if (wantAnalyze) {
          // אפשר להראות הודעת מערכת קטנה
          append('system', 'Running STPA analysis…', true);
          send('analyzeFile');      // אפשר גם analyzeSelection אם תרצי לפי הֶקשר
          return;                   // לא שולחים ל-LLM הודעה חופשית
        }

  // 🧠 Intent: Smart-Edit (הוספת H7/UCA9 וכו')
  const wantsEdit = (() => {
    const lower = t;
    return (
      /(add|create|insert|append|augment|extend)/i.test(lower) ||
      /(h\d+|l\d+|uca\d+)/i.test(lower) ||
      /(hazard|loss|uca)/i.test(lower) ||
      /(הוסף|להוסיף|תוסיפי|תוסיפו)/.test(lower)
    );
  })();

  showTyping();
  if (wantsEdit) {
    send('smartEdit', { text }); // עריכה בקובץ
  } else {
    send('manualPrompt', { text }); // שאלה חופשית ל-LLM
  }
}


      function send(type, payload){ vscode.postMessage({ type, payload }); }

      // From extension
      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.type === 'append'){
          hideTyping();
          append(msg.payload.role, msg.payload.text, true);
        } else if (msg.type === 'busy'){
          if (msg.payload) root.classList.add('busy'); else root.classList.remove('busy');
        } else if (msg.type === 'toast'){
          append('system', String(msg.payload), true);
        } else if (msg.type === 'reset'){
          chat.innerHTML = '';
          vscode.setState({ messages: [] });
        }
      });

      // UI helpers
      function append(role, text, persist=true){
        const row = document.createElement('div');
        row.className = 'msg ' + role;

        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerText = text;

        const label = document.createElement('div');
        label.className = 'role';
        label.textContent = role === 'user' ? 'You' : (role === 'assistant' ? 'STPA Agent' : 'Info');

        if (role === 'user'){ row.appendChild(label); row.appendChild(bubble); }
        else { row.appendChild(bubble); row.appendChild(label); }

        chat.appendChild(row);
        scrollToBottom();

        if (persist){
          const messages = (vscode.getState()?.messages || []);
          messages.push({ id: String(Date.now()), role, text });
          vscode.setState({ messages });
        }
      }

      let typingRow = null;
      function showTyping(){
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
      function hideTyping(){
        if (typingRow && typingRow.parentElement){ chat.removeChild(typingRow); }
        typingRow = null;
      }
      function scrollToBottom(){ chat.scrollTop = chat.scrollHeight; }
    `;

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
          <style>${css}</style>
        </head>
        <body>
          <div id="root" class="container">
            <div class="toolbar">
              <div class="btn-stacks">
                <div class="row">
                  <button id="btnAnalyze" class="btn">
                    <span class="icon" style="background-image:url('${iconAnalyze}');"></span>
                    <span class="label">Analyze File</span>
                  </button>
                  <button id="btnAnalyzeSel" class="btn">
                    <span class="icon" style="background-image:url('${iconSel}');"></span>
                    <span class="label">Analyze Selection</span>
                  </button>
                </div>
                <div class="row">
                  <button id="btnRefine" class="btn">
                    <span class="icon" style="background-image:url('${iconRefine}');"></span>
                    <span class="label">Refine</span>
                  </button>
                  <button id="btnExport" class="btn">
                    <span class="icon" style="background-image:url('${iconExport}');"></span>
                    <span class="label">Export .md</span>
                  </button>
                  <button id="btnPreview" class="btn">
                    <span class="icon" style="background-image:url('${iconDiagram}');"></span>
                    <span class="label">Preview Diagrams</span>
                  </button>
                </div>
              </div>
              <div class="spacer"></div>
              <button id="btnClear" class="btn secondary">
                <span class="icon" style="background-image:url('${iconClear}');"></span>
                <span class="label">Clear</span>
              </button>
            </div>

            <div id="chat" class="chat" role="log" aria-live="polite"></div>

            <div class="composer">
              <textarea
                id="input"
                placeholder="Type your system description or STPA request here."></textarea>
              <button id="btnSend" class="btn">
                <span class="label">Send</span>
              </button>
            </div>
          </div>
          <script>${js}</script>
        </body>
      </html>
    `;
  }
}
