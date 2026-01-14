# Testing overview for STPA Agent

This document captures the automated and manual testing commitments for STPA Agent, including tooling, coverage, and mappings to functional and non-functional requirements.

## 1. Unit Tests

- **Tooling:** `jest` + `ts-jest` with module mocks for the VS Code APIs and the OpenAI/LLM layer (`tests/__mocks__`, `tests/utils`). Each unit test runs without rendering a UI or making network requests.
- **Modules covered:**
  * **Prompt builders for STPA steps 1-4:** `tests/unit/prompts.test.ts` validates the prompt generation helpers in `src/extension.ts`.
  * **LLM output to structured Markdown:** `renderGuided.ts` and `tables.ts` are exercised by `renderGuided.test.ts` and `tables.test.ts` to ensure the Markdown, tables, and identifiers follow the expected STPA format.
  * **Input pre-check / validation:** `validation.test.ts` and `validator.edgecases.test.ts` drive the helpers in `src/validator.ts` to surface missing system descriptions before the analysis can run.
  * **Smart Edit logic:** `aiEdit.test.ts`, `aiQuickFix.test.ts`, and `inlineCompletion.test.ts` verify section detection, plan generation, and add/update/delete behavior in `src/aiEdit.ts` and related helpers.
  * **Control-structure extraction:** `csExtract.test.ts` confirms that `src/csExtract.ts` can parse control structures from free-form requirements text and normalize them for diagrams.
  * **Mermaid diagram construction:** `diagrams.test.ts` validates the generation of Control Structure and Impact diagrams from structured nodes.
- **Status:** All unit tests complete successfully via `npm test` (ts-jest keeps the TypeScript sources compiled on the fly).

## 2. Integration Tests

- **Tooling:** `jest` with VS Code API mocks (`tests/__mocks__/vscode.ts` and helpers).
- **Scenarios:**
  * `tests/integration/analyzeCurrentFile.test.ts` proves that the `stpa-agent.analyzeCurrentFile` command orchestrates guided sessions, validation, and diagram generation.
  * `guidedDiagrams.test.ts`, `previewDiagrams.test.ts`, and `guidedSnapshots.test.ts` cover the data flow from the command palette to the Webview (diagrams, preview, and snapshot consistency).
  * `webviewProtocol.test.ts` asserts the message protocol between the Extension Host and the Webview, including Smart Edit requests and responses.
- **Status:** Integration tests run in the same Jest suite as the unit tests and have been passing with the current mock setup.

## 3. End-to-End Tests (E2E)

- **Tooling:** `@vscode/test-cli` driven by `npm run test:e2e` (builds `tsconfig.e2e.json` first).
- **Scope:** `tests/e2e/chatView.e2e.test.ts` launches a real VS Code window, loads the extension, opens the chat Webview, executes public commands such as `stpa-agent.guided`, and verifies that the Extension Host + Webview exchange messages without runtime errors.
- **Status:** The smoke test has been running successfully in local VS Code environments and does not rely on mocks.

## 4. Manual Acceptance Testing

Manual acceptance tests prove real-world usage, interacting with VS Code, the Webview, and Copilot/LLM flows. Results and artifacts (screenshots, logs, timestamps) are documented in the testing appendix.

| Scenario | Exercise | Result |
| --- | --- | --- |
| Free-form system description | User types a system description and the agent consumes it as input | PASS |
| Non-STPA expert workflow | New user completes a guided analysis with minimal prior knowledge | documented |
| STPA/CAST recommendation | Switch the system description and confirm the agent suggests the most appropriate method | documented |
| Refine weak prompts | Enter vague prompts and verify that the refinement helpers improve the phrasing | PASS |
| Structured STPA output | Inspect the Markdown/tables/IDs emitted by rendering helpers | PASS |
| Complete report + diagrams | Generate UCAs and Control Structure diagrams | PASS |
| Copilot Agent Mode | Run analysis with Copilot Agent integration enabled | documented |
| Contextual dialog | Ask follow-up questions about previous output | PASS |
| Save & reload analysis | Save the workspace state, close, and reopen to ensure data is restored | documented |

## 5. Requirement Mapping

### Functional requirements

| # | Requirement | Coverage |
| --- | --- | --- |
| 1 | Detect system type from the workspace | Acceptance scenario + `tests/integration/analyzeCurrentFile.test.ts` |
| 2 | Recommend STPA/CAST method per context | Acceptance checks (method switching scenario) |
| 3 | Assist with prompt refinement | Unit tests (`aiEdit`, `inlineCompletion`) + refinement walkthrough |
| 4 | Emit structured STPA output | Unit tests (`tables`, `renderGuided`) + acceptance verification |
| 5 | Produce reports and diagrams | Integration tests (`guidedDiagrams`, `previewDiagrams`) + manual report creation |
| 6 | Integrate with Copilot / PASTA modes | Acceptance scenario that enables Copilot Agent Mode |
| 7 | Maintain context-aware dialog | Acceptance scenario with follow-up prompts |
| 8 | Persist analyses (save/load) | Acceptance test that saves and reloads the session |

### Non-functional requirements

- **Performance:** Local pre-checks and diagram rendering finish within seconds (observed manually).
- **Load:** Works with multiple VS Code windows open simultaneously.
- **Capacity:** Reasonable CPU/RAM usage on a standard laptop while tests run.
- **Portability:** Compatible with Windows/macOS/Linux via VS Code.
- **Usability:** New users complete analyses during manual walkthroughs.
- **Maintainability:** Automated suites (`jest`, `ts-jest`, `tests/e2e`) are runnable in CI.
- **Platform constraints:** Depends on VS Code, Copilot Agents, and internet connections for upstream APIs (documented as acceptance limitations).

## Running the test suites

- `npm test` runs all unit and integration tests plus snapshots.
- `npm run test:cov` generates coverage reports (`coverage/lcov-report`).
- `npm run test:update-snapshots` refreshes Jest snapshots.
- `npm run test:e2e` compiles `tsconfig.e2e.json` and runs the VS Code smoke test via `@vscode/test-cli`.

**Current status:** All automated suites and the documented manual scenarios have run successfully in the current workspace.
