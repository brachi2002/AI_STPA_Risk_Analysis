import type * as vscode from 'vscode';

type MessageHandler = (message: any) => void | Promise<void>;

class FakeWebview {
  public html = '';
  public options: vscode.WebviewOptions | undefined;
  public readonly cspSource = 'vscode-resource';
  private handlers: MessageHandler[] = [];
  private onPostMessage: (message: any) => void;

  constructor(onPostMessage: (message: any) => void) {
    this.onPostMessage = onPostMessage;
  }

  onDidReceiveMessage(handler: MessageHandler) {
    this.handlers.push(handler);
    return { dispose: () => undefined };
  }

  async postMessage(message: any) {
    this.onPostMessage(message);
    return true;
  }

  asWebviewUri(uri: vscode.Uri) {
    return uri;
  }

  async dispatchMessage(message: any) {
    for (const handler of this.handlers) {
      await handler(message);
    }
  }
}

export class WebviewProtocolHarness {
  public readonly outgoing: any[] = [];
  public readonly webview: FakeWebview;
  public readonly view: vscode.WebviewView;
  private busy = false;
  private messageWaiters: { predicate: (msg: any) => boolean; resolve: (msg: any) => void }[] = [];

  constructor(provider: { resolveWebviewView: (view: vscode.WebviewView) => void }) {
    this.webview = new FakeWebview((message) => {
      this.outgoing.push(message);
      if (message?.type === 'busy') {
        this.busy = !!message.payload;
      }
      for (const waiter of this.messageWaiters.slice()) {
        if (waiter.predicate(message)) {
          waiter.resolve(message);
          this.messageWaiters = this.messageWaiters.filter((w) => w !== waiter);
        }
      }
    });

    this.view = { webview: this.webview } as unknown as vscode.WebviewView;
    provider.resolveWebviewView(this.view);
  }

  async sendFromWebview(message: any) {
    await this.webview.dispatchMessage(message);
  }

  waitForMessage(predicate: (msg: any) => boolean, timeoutMs = 1500) {
    const existing = this.outgoing.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), timeoutMs);
      this.messageWaiters.push({
        predicate,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
    });
  }

  async assertIdle(timeoutMs = 1500) {
    if (!this.busy) {
      return;
    }
    await this.waitForMessage((msg) => msg?.type === 'busy' && msg.payload === false, timeoutMs);
  }
}
