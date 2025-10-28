"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerInlineCompletion = registerInlineCompletion;
const vscode = __importStar(require("vscode"));
const openai_1 = __importDefault(require("openai"));
const TRIGGERS = [
    /^sensors:\s*$/i,
    /^actuators:\s*$/i,
    /^control loop:\s*$/i,
    /^interfaces:\s*$/i,
    /^environment:\s*$/i,
];
function registerInlineCompletion(apiKeyProvider) {
    const provider = {
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
            const openai = new openai_1.default({ apiKey });
            // נחלץ מעט קונטקסט שלפני הקריאה כדי לעזור ל-LLM להשלים נכון
            const startLine = Math.max(0, position.line - 40);
            const windowText = document.getText(new vscode.Range(new vscode.Position(startLine, 0), position));
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
    const selector = [{ language: 'markdown' }, { language: 'plaintext' }];
    const disp = vscode.languages.registerInlineCompletionItemProvider(selector, provider);
    return disp;
}
//# sourceMappingURL=inlineCompletion.js.map