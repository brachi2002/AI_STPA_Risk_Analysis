import * as fs from 'fs';
import * as path from 'path';

type Disposable = { dispose: () => void };

export class Position {
  line: number;
  character: number;

  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }

  translate(lineDelta = 0, characterDelta = 0): Position {
    return new Position(this.line + lineDelta, this.character + characterDelta);
  }
}

export class Range {
  start: Position;
  end: Position;

  constructor(start: Position, end: Position) {
    this.start = start;
    this.end = end;
  }
}

export class Selection extends Range {
  constructor(start: Position, end: Position) {
    super(start, end);
  }
}

export class Uri {
  fsPath: string;
  scheme: string;

  constructor(fsPath: string, scheme = 'file') {
    this.fsPath = fsPath;
    this.scheme = scheme;
  }

  static file(fsPath: string): Uri {
    return new Uri(fsPath, 'file');
  }

  static joinPath(base: Uri, ...paths: string[]): Uri {
    return new Uri(path.join(base.fsPath, ...paths), base.scheme);
  }
}

type TextLine = {
  text: string;
  range: Range;
  rangeIncludingLineBreak: Range;
};

type TextDocument = {
  uri: Uri;
  fileName: string;
  languageId: string;
  getText: () => string;
  lineAt: (line: number) => TextLine;
  positionAt: (offset: number) => Position;
  offsetAt: (position: Position) => number;
  save: () => Promise<boolean>;
};

type TextEditorEdit = {
  replace: (range: Range, text: string) => void;
  delete: (range: Range) => void;
  insert: (position: Position, text: string) => void;
};

type TextEditor = {
  document: TextDocument;
  selection: Selection;
  edit: (callback: (edit: TextEditorEdit) => void) => Promise<boolean>;
  revealRange: (range: Range) => void;
  setDecorations: () => void;
};

type OutputChannel = {
  name: string;
  lines: string[];
  appendLine: (value: string) => void;
  clear: () => void;
  show: () => void;
};

const state = {
  activeTextEditor: undefined as TextEditor | undefined,
  workspaceFolders: [] as { uri: Uri }[],
  commands: new Map<string, (...args: any[]) => any>(),
  configuration: new Map<string, any>(),
  warningMessageResult: undefined as string | undefined,
  infoMessageResult: undefined as string | undefined,
  errorMessageResult: undefined as string | undefined,
  inputBoxResult: undefined as string | undefined,
  quickPickResult: undefined as string | undefined,
  outputChannels: [] as OutputChannel[],
  webviewProviders: new Map<string, any>(),
};

function makeDisposable(): Disposable {
  return { dispose: () => undefined };
}

function getLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function positionAt(text: string, offset: number): Position {
  const lines = getLines(text);
  let remaining = Math.max(0, offset);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (remaining <= line.length) {
      return new Position(i, remaining);
    }
    remaining -= line.length + 1;
  }
  return new Position(lines.length - 1, lines[lines.length - 1]?.length || 0);
}

function offsetAt(text: string, position: Position): number {
  const lines = getLines(text);
  let offset = 0;
  for (let i = 0; i < Math.min(position.line, lines.length); i += 1) {
    offset += lines[i].length + 1;
  }
  return offset + position.character;
}

function makeDocument(text: string, uri: Uri, languageId = 'markdown'): TextDocument {
  let docText = text;

  const document: TextDocument = {
    uri,
    fileName: uri.fsPath,
    languageId,
    getText: () => docText,
    lineAt: (line: number) => {
      const lines = getLines(docText);
      const safeLine = Math.max(0, Math.min(line, lines.length - 1));
      const lineText = lines[safeLine] ?? '';
      const lineStart = new Position(safeLine, 0);
      const lineEnd = new Position(safeLine, lineText.length);
      const lineEndWithBreak = new Position(
        safeLine,
        lineText.length + (safeLine < lines.length - 1 ? 1 : 0)
      );
      return {
        text: lineText,
        range: new Range(lineStart, lineEnd),
        rangeIncludingLineBreak: new Range(lineStart, lineEndWithBreak),
      };
    },
    positionAt: (offset: number) => positionAt(docText, offset),
    offsetAt: (position: Position) => offsetAt(docText, position),
    save: async () => true,
  };

  const setText = (next: string) => {
    docText = next;
  };

  (document as any).__setText = setText;
  return document;
}

function applyEdits(text: string, edits: { start: number; end: number; text: string }[]): string {
  const sorted = edits.sort((a, b) => b.start - a.start);
  let next = text;
  for (const edit of sorted) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  }
  return next;
}

function makeEditor(document: TextDocument): TextEditor {
  return {
    document,
    selection: new Selection(new Position(0, 0), new Position(0, 0)),
    edit: async (callback: (edit: TextEditorEdit) => void) => {
      const edits: { start: number; end: number; text: string }[] = [];
      const editBuilder: TextEditorEdit = {
        replace: (range: Range, text: string) => {
          edits.push({
            start: document.offsetAt(range.start),
            end: document.offsetAt(range.end),
            text,
          });
        },
        delete: (range: Range) => {
          edits.push({
            start: document.offsetAt(range.start),
            end: document.offsetAt(range.end),
            text: '',
          });
        },
        insert: (position: Position, text: string) => {
          const offset = document.offsetAt(position);
          edits.push({ start: offset, end: offset, text });
        },
      };

      callback(editBuilder);
      const updated = applyEdits(document.getText(), edits);
      (document as any).__setText(updated);
      return true;
    },
    revealRange: () => undefined,
    setDecorations: () => undefined,
  };
}

export const window = {
  get activeTextEditor(): TextEditor | undefined {
    return state.activeTextEditor;
  },
  set activeTextEditor(editor: TextEditor | undefined) {
    state.activeTextEditor = editor;
  },
  showWarningMessage: async () => state.warningMessageResult,
  showInformationMessage: async () => state.infoMessageResult,
  showErrorMessage: async () => state.errorMessageResult,
  showInputBox: async () => state.inputBoxResult,
  showQuickPick: async () => state.quickPickResult,
  createOutputChannel: (name: string) => {
    const channel: OutputChannel = {
      name,
      lines: [],
      appendLine: (value: string) => {
        channel.lines.push(value);
      },
      clear: () => {
        channel.lines = [];
      },
      show: () => undefined,
    };
    state.outputChannels.push(channel);
    return channel;
  },
  createWebviewPanel: () => {
    return {
      webview: {
        html: '',
        options: undefined,
        postMessage: async () => true,
      },
      onDidDispose: () => makeDisposable(),
      dispose: () => undefined,
    };
  },
  setStatusBarMessage: () => makeDisposable(),
  showTextDocument: async (doc: TextDocument) => {
    const editor = makeEditor(doc);
    state.activeTextEditor = editor;
    return editor;
  },
  registerWebviewViewProvider: (viewId: string, provider: any) => {
    state.webviewProviders.set(viewId, provider);
    return makeDisposable();
  },
  createTextEditorDecorationType: () => makeDisposable(),
};

export const workspace = {
  get workspaceFolders(): { uri: Uri }[] {
    return state.workspaceFolders;
  },
  set workspaceFolders(folders: { uri: Uri }[]) {
    state.workspaceFolders = folders;
  },
  getConfiguration: (section: string) => ({
    get: <T>(key: string, fallback?: T) => {
      const full = `${section}.${key}`;
      return state.configuration.has(full) ? state.configuration.get(full) : fallback;
    },
    update: async (key: string, value: any) => {
      const full = `${section}.${key}`;
      state.configuration.set(full, value);
    },
  }),
  openTextDocument: async (uriOrPath: string | Uri) => {
    const fsPath = typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.fsPath;
    const text = fs.existsSync(fsPath) ? fs.readFileSync(fsPath, 'utf-8') : '';
    return makeDocument(text, new Uri(fsPath));
  },
};

export const commands = {
  registerCommand: (command: string, handler: (...args: any[]) => any) => {
    state.commands.set(command, handler);
    return makeDisposable();
  },
  executeCommand: async (command: string, ...args: any[]) => {
    const handler = state.commands.get(command);
    return handler ? handler(...args) : undefined;
  },
};

export const languages = {
  registerInlineCompletionItemProvider: () => makeDisposable(),
};

export const ConfigurationTarget = {
  Global: 1,
};

export const ViewColumn = {
  Beside: 2,
};

export const TextEditorRevealType = {
  InCenter: 0,
};

export function __resetMockState() {
  state.activeTextEditor = undefined;
  state.workspaceFolders = [];
  state.commands.clear();
  state.configuration.clear();
  state.warningMessageResult = undefined;
  state.infoMessageResult = undefined;
  state.errorMessageResult = undefined;
  state.inputBoxResult = undefined;
  state.quickPickResult = undefined;
  state.outputChannels = [];
  state.webviewProviders.clear();
}

export function __setWorkspaceFolders(paths: string[]) {
  state.workspaceFolders = paths.map((p) => ({ uri: new Uri(p) }));
}

export function __setActiveTextEditor(editor: TextEditor | undefined) {
  state.activeTextEditor = editor;
}

export function __createTextDocument(text: string, filePath: string, languageId = 'markdown') {
  return makeDocument(text, new Uri(filePath), languageId);
}

export function __createTextEditor(text: string, filePath: string, languageId = 'markdown') {
  const doc = makeDocument(text, new Uri(filePath), languageId);
  return makeEditor(doc);
}

export function __setWarningMessageResult(value: string | undefined) {
  state.warningMessageResult = value;
}

export function __setInputBoxResult(value: string | undefined) {
  state.inputBoxResult = value;
}

export function __setQuickPickResult(value: string | undefined) {
  state.quickPickResult = value;
}

export function __getOutputChannels(): OutputChannel[] {
  return state.outputChannels;
}
