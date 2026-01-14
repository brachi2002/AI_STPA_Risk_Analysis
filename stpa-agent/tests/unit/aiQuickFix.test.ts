import * as vscode from 'vscode';
import { generateAndInsertMissingSections } from '../../src/aiQuickFix';
import type { ValidationIssue } from '../../src/validator';
import { withMockHandler } from '../utils/llmMock';

describe('generateAndInsertMissingSections', () => {
  beforeEach(() => {
    const api = vscode as any;
    if (typeof api.__resetMockState === 'function') {
      api.__resetMockState();
    }
  });

  test('inserts an AI fix block with requested headings', async () => {
    const api = vscode as any;
    const editor = api.__createTextEditor('# Title\n\nExisting content.\n', 'C:\\temp\\system.md', 'markdown');
    api.__setActiveTextEditor(editor);

    const issues: ValidationIssue[] = [
      { id: 'MISSING_SYSTEM_CONTEXT', message: 'missing', severity: 'warn' },
      { id: 'MISSING_OBJECTIVES', message: 'missing', severity: 'warn' },
    ];

    withMockHandler(() => ({
      content: [
        '## System context',
        'Context details.',
        '',
        '## System objectives / purpose',
        'Objective details.',
      ].join('\n'),
    }));

    await generateAndInsertMissingSections({
      apiKey: 'test-key',
      editor,
      baseText: editor.document.getText(),
      systemType: 'generic',
      issues,
    });

    const updated = editor.document.getText();
    expect(updated).toContain('<!-- STPA_AI_FIX_START -->');
    expect(updated).toContain('## System context');
    expect(updated).toContain('## System objectives / purpose');
    expect(updated).toContain('<!-- STPA_AI_FIX_END -->');
  });

  test('does nothing when requested headings already exist', async () => {
    const api = vscode as any;
    const baseText = '# Title\n\n## System context\nExisting section.\n';
    const editor = api.__createTextEditor(baseText, 'C:\\temp\\system.md', 'markdown');
    api.__setActiveTextEditor(editor);

    const issues: ValidationIssue[] = [
      { id: 'MISSING_SYSTEM_CONTEXT', message: 'missing', severity: 'warn' },
    ];

    withMockHandler(() => ({
      content: '## System context\nNew content should not be inserted.',
    }));

    await generateAndInsertMissingSections({
      apiKey: 'test-key',
      editor,
      baseText,
      systemType: 'generic',
      issues,
    });

    expect(editor.document.getText()).toBe(baseText);
  });
});
