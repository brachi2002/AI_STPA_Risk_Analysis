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


const modernUiStyles = `
        :root {
          --agent-accent: #5ce1ff;
          --agent-accent-2: #3c8ae5;
          --panel-bg: var(--vscode-sideBar-background);
        }
        html, body {
          margin: 0;
          height: 100%;
        }
        body {
          background: var(--panel-bg);
          color: var(--vscode-foreground);
          font-family: var(--vscode-font-family);
        }
        * {
          box-sizing: border-box;
        }
        .container {
          height: 100%;
          display: flex;
          flex-direction: column;
        }
        .chat {
          flex: 1;
          overflow-y: auto;
          padding: 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          background: transparent;
        }
        .msg {
          display: flex;
          align-items: flex-end;
          gap: 10px;
        }
        .bubble {
          max-width: 85%;
          padding: 10px 14px;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
          font-size: 14px;
          line-height: 1.5;
          color: var(--vscode-foreground);
          box-shadow: 0 10px 20px rgba(0, 0, 0, 0.15);
          white-space: pre-line;
        }
        .user {
          justify-content: flex-end;
        }
        .user .bubble {
          background: linear-gradient(135deg, var(--agent-accent), var(--agent-accent-2));
          color: #021024;
        }
        .assistant {
          justify-content: flex-start;
        }
        .assistant .bubble {
          background: rgba(255, 255, 255, 0.05);
        }
        .system {
          justify-content: center;
        }
        .system .bubble {
          border-style: dashed;
        }
        .role {
          font-size: 10px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--vscode-descriptionForeground);
        }
        .action-row {
          border-radius: 12px;
          padding: 8px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .action-btn {
          background: rgba(255, 255, 255, 0.95);
          color: var(--vscode-foreground);
          border: 1px solid rgba(15, 23, 42, 0.25);
          border-radius: 14px;
          min-height: 34px;
          padding: 0 16px;
          font-size: 13px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: border-color 0.2s ease, background 0.2s ease;
        }
        .action-btn:not(.primary):hover,
        .action-btn:not(.primary):focus-visible {
          background: #fff;
          border-color: rgba(15, 23, 42, 0.5);
        }
        .action-btn.primary {
          border: none;
          background: linear-gradient(135deg, var(--agent-accent), var(--agent-accent-2));
          color: #fff;
          box-shadow: 0 6px 12px rgba(0, 0, 0, 0.35);
        }
        .action-btn.primary:hover,
        .action-btn.primary:focus-visible {
          transform: translateY(-1px);
        }
        .action-btn.secondary {
          background: rgba(255, 255, 255, 0.85);
          border-color: rgba(136, 145, 183, 0.6);
        }
        .action-btn.secondary:hover,
        .action-btn.secondary:focus-visible {
          background: rgba(255, 255, 255, 1);
          border-color: rgba(69, 79, 112, 0.7);
        }
        .footer {
          flex-shrink: 0;
          padding: 10px 14px 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(7, 11, 20, 0.95);
          backdrop-filter: blur(10px);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .toolbar-row {
          width: 100%;
          display: flex;
          gap: 6px;
        }
        .tool-btn {
          flex: 1;
          min-width: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 6px 10px;
          font-size: 11px;
          font-weight: 600;
          text-transform: none;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.25);
          background: rgba(255, 255, 255, 0.04);
          color: #fff;
          cursor: pointer;
          transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
        }
        .tool-btn.secondary {
          border-color: rgba(255, 255, 255, 0.15);
          background: rgba(255, 255, 255, 0.02);
        }
        .tool-btn:hover,
        .tool-btn:focus-visible {
          background: rgba(255, 255, 255, 0.18);
          border-color: rgba(255, 255, 255, 0.45);
          transform: translateY(-1px);
        }
        .composer-row {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .composer-row textarea {
          flex: 1;
          min-height: 36px;
          max-height: 80px;
          width: auto;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.25);
          background: rgba(255, 255, 255, 0.04);
          color: #fff;
          padding: 8px 10px;
          font-size: 13px;
          resize: none;
        }
        .composer-row textarea::placeholder {
          color: rgba(255, 255, 255, 0.65);
        }
        .composer-buttons {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .send-btn {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(135deg, var(--agent-accent), var(--agent-accent-2));
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 6px 12px rgba(0, 0, 0, 0.25);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .send-btn:hover,
        .send-btn:focus-visible {
          transform: translateY(-1px);
          box-shadow: 0 10px 18px rgba(0, 0, 0, 0.35);
        }
        .send-btn svg {
          width: 16px;
          height: 16px;
        }
        .cancel-btn {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(135deg, var(--agent-accent), var(--agent-accent-2));
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: transparent;
          cursor: pointer;
          box-shadow: 0 6px 12px rgba(0, 0, 0, 0.25);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          font-size: 0;
        }
        .cancel-btn::before {
          content: '⏹';
          font-size: 16px;
          line-height: 1;
          color: #fff;
        }
        .cancel-btn:hover,
        .cancel-btn:focus-visible {
          transform: translateY(-1px);
          box-shadow: 0 10px 18px rgba(0, 0, 0, 0.35);
        }
        .cancel-btn.hide {
          display: none;
        }
        .model-row {
          width: 100%;
        }
        .model-select {
          width: 100%;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.28);
          background: rgba(255, 255, 255, 0.08);
          color: #fff;
          padding: 8px 10px;
          font-size: 12px;
        }
        .model-select option {
          background: var(--panel-bg);
          color: #000;
        }
        .busy textarea,
        .busy .send-btn,
        .busy .tool-btn {
          opacity: 0.65;
        }
        @media (max-width: 640px) {
          .action-row {
            flex-wrap: nowrap;
            justify-content: center;
            align-items: center;
            gap: 10px;
          }

          .action-row .action-btn {
            min-width: 120px;
            padding: 6px 14px;
            font-size: 12px;
          }

          .action-row[data-group="jumpMenu"] .action-btn {
            min-width: 0;
            padding: 4px 10px;
            font-size: 11px;
          }

          .toolbar-row {
            flex-wrap: wrap;
          }

          /* ===== Composer: force single row layout ===== */
          .composer-row {
            display: flex !important;
            flex-direction: row !important;
            flex-wrap: nowrap !important;
            align-items: stretch !important;
            width: 100% !important;
            gap: 10px !important;
          }

          /* Input takes all remaining space */
          #input {
            flex: 1 1 auto !important;
            width: 100% !important;
            min-width: 0 !important;
            min-height: 44px;
            display: block !important;
          }
            .composer-row textarea#input{
              flex: 1 1 auto !important;
              width: auto !important;      /* avoid 100% fighting flex */
              min-width: 0 !important;
              height: 44px !important;
              min-height: 44px !important;
              max-height: 96px !important;

              /* ensure it’s visible like on desktop */
              padding: 8px 10px !important;
              border-radius: 12px !important;
              border: 1px solid rgba(255,255,255,0.25) !important;
              background: rgba(255,255,255,0.04) !important;
              color: #fff !important;
              display:block !important;
            }

          /* Buttons must NOT grow */
          .composer-buttons {
            display: flex !important;
            flex: 0 0 auto !important;
            gap: 8px !important;
            align-items: center !important;
            width: 44px !important;
            height: 44px !important;
          }

          /* Square send button */
          #btnSend,
          .send-btn {
            flex: 0 0 44px !important;
            width: 44px !important;
            height: 44px !important;
            min-width: 44px !important;
            max-width: 44px !important;
            padding: 0 !important;
            position: static !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
          }

          /* If it's a VS Code web component */
          #btnSend::part(control) {
            width: 44px !important;
            height: 44px !important;
            padding: 0 !important;
            min-width: 44px !important;
          }
        }

          `;
if (!document.getElementById('stpa-modern-theme')) {
  const modernUiNode = document.createElement('style');
  modernUiNode.setAttribute('id', 'stpa-modern-theme');
  const baseStyle = document.querySelector('style[nonce]');
  const styleNonce = baseStyle?.getAttribute('nonce');
  if (!styleNonce) {
    console.log('stpa-webview: warning - no nonce found on base style, CSP may block new styles');
  }
  modernUiNode.setAttribute('nonce', styleNonce || '');
  modernUiNode.textContent = modernUiStyles;
  document.head.appendChild(modernUiNode);
  console.log('stpa-webview: modern styles injected', { nonce: styleNonce });
}

let isBusy = false;
let pendingRequest = null;
let watchdogTimer = null;
const WATCHDOG_TIMEOUT_MS = 45000;
const ESCAPE_ACTION = { label: 'Reset to start', action: 'reset', secondary: true };
const WATCHDOG_ACTIONS = [
  { label: 'Retry last operation', action: 'retryWatchdog' },
  ESCAPE_ACTION,
];
const btnSend = document.getElementById('btnSend');
const btnPreview = document.getElementById('btnPreview');
const btnExplain = document.getElementById('btnExplain');
const btnClear = document.getElementById('btnClear');

const WELCOME_TEXT =
  'Hi, I am your STPA Agent. I can guide you step-by-step according to the STPA Handbook.\n\n' +
  'Please make sure your System Description is currently open in the editor.';
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

  autoScrollFrame = requestAnimationFrame(function () {
    requestAnimationFrame(function () {
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
  rows.forEach(function (row) { chat.appendChild(row); });
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
  bubble.classList.add('bubble-animate');
  setTimeout(function () {
    bubble.classList.remove('bubble-animate');
  }, 420);

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

function setPendingRequest(request) {
  pendingRequest = request;
}

function dispatchAsyncRequest(type, payload) {
  const safePayload = payload && typeof payload === 'object' ? { ...payload } : undefined;
  setPendingRequest({ type, payload: safePayload });
  showTyping();
  vscode.postMessage({ type, payload: safePayload });
}

function dispatchSimpleMessage(type) {
  setPendingRequest({ type, payload: undefined });
  showTyping();
  vscode.postMessage({ type });
}

function retryPendingRequest() {
  if (!pendingRequest) {
    append('system', 'Nothing to retry yet.', true);
    return;
  }
  append('system', 'Retrying the last operation...', true);
  dispatchAsyncRequest(pendingRequest.type, pendingRequest.payload);
}

function handleResetAction() {
  hardReset();
  setPendingRequest(null);
  clearWatchdog();
  vscode.postMessage({ type: 'clear' });
}

function startWatchdog() {
  clearWatchdog();
  watchdogTimer = setTimeout(function () {
    isBusy = false;
    root.classList.remove('busy');
    hideTyping();
    append('system', 'The request is taking too long. Retry or reset to continue.', true);
    renderActionButtons('timeout', WATCHDOG_ACTIONS);
  }, WATCHDOG_TIMEOUT_MS);
}

function clearWatchdog() {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

function handleActionClick(btn) {
  if (btn.action === 'openJumpMenu') {
    hideTyping();
    renderJumpMenu();
    return;
  }
  if (btn.action === 'reset') {
    handleResetAction();
    return;
  }
  if (btn.action === 'retryWatchdog') {
    retryPendingRequest();
    return;
  }
  if (btn.action === 'previewDiagrams' || btn.action === 'explainCurrentStep') {
    dispatchSimpleMessage(btn.action);
    return;
  }
  const payload = btn.payload ? { ...btn.payload } : {};
  payload.action = btn.action;
  dispatchAsyncRequest('guidedAction', payload);
}

function renderActionButtons(groupId, buttons) {
  if (!Array.isArray(buttons) || !buttons.length) {
    buttons = [ESCAPE_ACTION];
  }
  const group = groupId || 'actions';
  const existing = chat.querySelector('.action-row[data-group="' + group + '"]');
  if (existing) {
    existing.remove();
  }
  const row = document.createElement('div');
  row.className = 'action-row';
  row.dataset.group = group;

  let primaryAssigned = false;
  buttons.forEach(function (btn) {
    const classNames = ['action-btn'];
    if (btn.secondary) {
      classNames.push('secondary');
    }
    if (!btn.secondary && !primaryAssigned) {
      classNames.push('primary');
      primaryAssigned = true;
    }
    const b = document.createElement('button');
    b.className = classNames.filter(Boolean).join(' ');
    b.textContent = btn.label;
    b.onclick = function () {
      if (isBusy && btn.action !== 'reset') return;
      row.remove();
      append('user', btn.label, true);
      handleActionClick(btn);
    };
    row.appendChild(b);
  });

  chat.appendChild(row);
  requestAutoScroll(true, true);
}

function renderSmartEditPlan(plan) {
  if (!plan || !plan.id) return;
  const shouldScroll = isNearBottom();

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

    actions.slice(0, 12).forEach(function (a) {
      const li = document.createElement('li');
      const op = String(a.op || '').toUpperCase();
      const sec = String(a.section || '');
      const note = a.note ? (' - ' + String(a.note)) : '';
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
  applyBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'applySmartEditPlan', payload: { id: plan.id } });
    applyBtn.disabled = true;
  });

  const discardBtn = document.createElement('button');
  discardBtn.className = 'plan-btn secondary';
  discardBtn.textContent = 'Dismiss';
  discardBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'discardSmartEditPlan', payload: { id: plan.id } });
    card.remove();
  });

  btnRow.appendChild(applyBtn);
  btnRow.appendChild(discardBtn);

  card.appendChild(title);
  card.appendChild(summary);
  card.appendChild(btnRow);

  chat.appendChild(card);
  requestAutoScroll(shouldScroll, true);
}

function renderWelcomeButtonsOnly() {
  renderActionButtons('welcome', [
    { label: 'Start guided STPA (Step 1)', action: 'startStep1' },
    { label: 'Jump to a specific step', action: 'openJumpMenu', secondary: true }
  ]);
}

function renderWelcome() {
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
  setPendingRequest(null);
  clearWatchdog();
}

if (!Array.isArray(savedState.messages)) {
  setMessages([]);
}

if (savedMessages.length === 0) {
  renderWelcome();
} else {
  savedMessages.forEach(function (m) { append(m.role, m.text, false); });

  const onlyWelcome =
    (savedMessages.length === 1 &&
      savedMessages[0].role === 'system' &&
      String(savedMessages[0].text || '').indexOf('STPA Agent') !== -1);

  if (onlyWelcome) {
    renderWelcomeButtonsOnly();
  }
}

scrollToBottomImmediate();

window.addEventListener('load', function () {
  vscode.postMessage({ type: 'ready' });
});

if (btnSend) {
  btnSend.addEventListener('click', onSend);
}

if (btnPreview) {
  btnPreview.addEventListener('click', function () {
    if (isBusy) return;
    dispatchSimpleMessage('previewDiagrams');
  });
}

if (btnExplain) {
  btnExplain.addEventListener('click', function () {
    if (isBusy) return;
    dispatchSimpleMessage('explainCurrentStep');
  });
}

if (btnClear) {
  btnClear.addEventListener('click', function () {
    handleResetAction();
  });
}

if (modelSelect) {
  modelSelect.addEventListener('change', function () {
    const value = String(modelSelect.value || '');
    if (!value) return;
    vscode.postMessage({ type: 'setModel', payload: { model: value } });
  });
}

input.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    onSend();
  }
});

function onSend() {
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

  if (wantsEdit) {
    dispatchAsyncRequest('smartEdit', { text: text });
  } else {
    dispatchAsyncRequest('manualPrompt', { text: text });
  }
}

let typingRow = null;

function showTyping() {
  if (typingRow && typingRow.parentElement) return;
  const shouldScroll = isNearBottom();

  typingRow = document.createElement('div');
  typingRow.className = 'msg assistant';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';

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

window.addEventListener('message', function (event) {
  const msg = event.data;

  if (msg.type === 'append') {
    hideTyping();
    append(msg.payload.role, msg.payload.text, true);
    return;
  }

  if (msg.type === 'busy') {
    isBusy = !!msg.payload;

    if (isBusy) {
      root.classList.add('busy');
      showTyping();
      startWatchdog();
    } else {
      root.classList.remove('busy');
      clearWatchdog();
      setTimeout(function () {
        if (!isBusy) hideTyping();
      }, 150);
    }
    return;
  }

  if (msg.type === 'toast') {
    hideTyping();
    append('system', String(msg.payload), true);
    renderActionButtons('errorFallback', WATCHDOG_ACTIONS);
    return;
  }

  if (msg.type === 'infoMessage') {
    hideTyping();
    append('system', String(msg.payload?.text || ''), true);
    return;
  }

  if (msg.type === 'showSmartEditPlan') {
    hideTyping();
    renderSmartEditPlan(msg.payload);
    return;
  }

  if (msg.type === 'reset') {
    hardReset();
    return;
  }

  if (msg.type === 'guidedActions') {
    hideTyping();
    const stage = msg.payload && msg.payload.stage;
    const actions = Array.isArray(msg.payload?.actions) ? msg.payload.actions : [];
    renderActionButtons(stage || 'guided', actions);

    const looksLikeJumpStage = String(stage || '').toLowerCase().includes('jump');
    if (looksLikeJumpStage) {
      const existing = chat.querySelector('.action-row[data-group="' + stage + '"]');
      if (!existing) {
        renderJumpFallbackButtons(stage || 'jumpFallback');
      }
    }
    return;
  }

  if (msg.type === 'model') {
    const value = String(msg.payload && msg.payload.model || '');
    if (value && modelSelect) {
      const option = modelSelect.querySelector('option[value="' + value + '"]');
      if (option) option.selected = true;
    }
    return;
  }

  console.warn('stpa-webview: unknown message type', msg.type);
  renderActionButtons('unknown', WATCHDOG_ACTIONS);
});
