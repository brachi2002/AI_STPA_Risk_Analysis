import { defineConfig } from '@vscode/test-cli';
import * as os from 'os';
import * as path from 'path';

export default defineConfig({
	files: 'out/e2e/tests/e2e/**/*.test.js',
	launchArgs: [
		'--new-window',
		'--user-data-dir',
		path.join(os.tmpdir(), `vscode-test-userdata-${process.pid}-${Date.now()}`),
		'--extensions-dir',
		path.join(os.tmpdir(), `vscode-test-extensions-${process.pid}-${Date.now()}`),
	],
	env: {
		OPENAI_API_KEY: '',
		DOTENV_CONFIG_OVERRIDE: 'false',
	},
	workspaceFolder: '.',
});
