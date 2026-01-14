# STPA AI Agent – VS Code extension

STPA AI Agent embeds guided System-Theoretic Process Analysis into VS Code so you can walk through hazard analysis, validation, and diagram preview without leaving your workspace.

## What is STPA?
STPA (System-Theoretic Process Analysis) is a practical safety-engineering method that finds design-level risks by thinking in terms of control loops and constraints.

## Features
- **Guided analysis (Steps 1–4)**: Run through STPA Step 1 (define losses), Step 2 (hazard identification), Step 3 (control structure), and Step 4 (constraints) with tailored prompts that capture your context.
- **Smart edit workflow**: Ask the agent to refactor or enrich code with proposed edits, preview a plan in the chat, and apply or discard the fix.
- **Validation help**: Use quick validation commands to spot missing controls or rule violations identified during the guided session.
- **Diagram preview**: Automatically render your control structure in the integrated preview, including Mermaid diagram syntax generated from your analysis.
- **Mermaid diagrams**: Export or refine Mermaid-compatible control structures for documentation or safety reports.

## Requirements
- A valid OpenAI API key stored in `OPENAI_API_KEY` (set in your shell, a `.env` file, or VS Code launch configuration). The extension does not bundle or provide a key.

## How to use
1. Install the extension from VSIX or the marketplace and make sure your OpenAI key is available to the IDE.
2. Open the **STPA Agent** view from the Activity Bar to launch the guided workflow and chat panel.
3. Start `Guided STPA` to progress through Steps 1–4, capture hazards, and let the agent suggest control structures.
4. Use the Smart Edit commands from the chat panel to request automated fixes; apply them directly or review the proposed plan first.
5. Trigger Diagram Preview to inspect the generated Mermaid control structure, then export or copy it into your documentation.

## Privacy and security
- The extension never stores or transmits your API key. All OpenAI requests rely on the key you provide at runtime, so keep it managed by your personal environment or secret manager.

## Development
1. Clone the repository and run `npm install` to fetch dependencies.
2. Run `npm run watch` (or `npm run compile`) to build the TypeScript sources.
3. Launch the extension from VS Code (F5) with `OPENAI_API_KEY` set so the guided and chat commands can call the OpenAI service.

## Testing
- `npm test`: unit and integration tests via Jest.
- `npm run test:cov`: collects coverage data for the Jest suite.
- `npm run test:e2e`: compiles `tsconfig.e2e.json` and executes the VS Code smoke test harness.
- `npm run test:update-snapshots`: refresh Webview snapshots when UI changes affect stored fixtures.
