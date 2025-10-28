import * as vscode from 'vscode';
import OpenAI from 'openai';

const TRIGGERS = [
    /^sensors:\s*$/i,
    /^actuators:\s*$/i,
    /^control loop:\s*$/i,
    /^interfaces:\s*$/i,
    /^environment:\s*$/i,
];

export function registerInlineCompletion(apiKeyProvider: () => string | undefined) {
    const provider: vscode.InlineCompletionItemProvider = {
        async provideInlineCompletionItems(document, position) {
            const lineText = document.lineAt(position.line).text.slice(0, position.character);

            // טריגר: השורה היא רק "Sensors:" / "Actuators:" וכו'
            if (!TRIGGERS.some((rx) => rx.test(lineText))) {
                return undefined;
            }

            const apiKey = apiKeyProvider();
            if (!apiKey) {
                return undefined;
            }

            const openai = new OpenAI({ apiKey });

            // נחלץ מעט קונטקסט שלפני הקריאה כדי לעזור ל-LLM להשלים נכון
            const startLine = Math.max(0, position.line - 40);
            const windowText = document.getText(
                new vscode.Range(new vscode.Position(startLine, 0), position)
            );

            const prompt = [
                'Continue the list with concise, domain-appropriate bullets (2–5 items).',
                'Use hyphen bullets, short phrases, no extra headings.',
                'Context (recent lines):',
                '---',
                windowText,
                '---',
            ].join('\n');

            const resp = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.3,
                messages: [{ role: 'user', content: prompt }],
            });

            const text = resp.choices?.[0]?.message?.content ?? '';
            if (!text.trim()) {
                return undefined;
            }

            return {
                items: [
                    {
                        insertText: text.replace(/\r/g, ''),
                        range: new vscode.Range(position, position),
                    },
                ],
            };
        },
    };

    const selector: vscode.DocumentSelector = [{ language: 'markdown' }, { language: 'plaintext' }];
    const disp = vscode.languages.registerInlineCompletionItemProvider(selector, provider);
    return disp;
}
