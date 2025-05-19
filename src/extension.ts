import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	console.log('🎯 STPA Agent extension is now active.');

	const disposable = vscode.commands.registerCommand('stpa-agent.helloWorld', () => {
		const editor = vscode.window.activeTextEditor;

		if (!editor) {
			vscode.window.showWarningMessage("❌ No active editor.");
			return;
		}

		const document = editor.document;
		const fileName = document.fileName;
		const fileExtension = fileName.split('.').pop();
		const text = document.getText().trim();

		let detectionReason = '';
		let isPASTA = false;

		if (fileExtension === 'pasta') {
			isPASTA = true;
			detectionReason = 'file extension ".pasta"';
		} else if (fileExtension === 'txt') {
			isPASTA = true;
			detectionReason = 'file extension ".txt"';
		} else if (text.startsWith('System:')) {
			isPASTA = true;
			detectionReason = 'file content starts with "System:"';
		}

		if (!isPASTA) {
			vscode.window.showWarningMessage("📛 Current file is not a valid PASTA file.");
			return;
		}

		if (text.length === 0) {
			vscode.window.showInformationMessage(`📄 Empty PASTA file detected (${detectionReason}).`);
			console.log("📄 File is empty.");
			return;
		}

		// Proceed with parsing or analysis
		console.log("📄 Detected PASTA File Content:\n" + text);
		console.log(`🧠 Detection reason: ${detectionReason}`);
		vscode.window.showInformationMessage(`🧠 PASTA file detected via: ${detectionReason}`);

		const parsed = parsePastaContent(text);
		console.log('🔍 Parsed PASTA Elements:', parsed);

		const summary = `📋 Parsed Summary:\nSystem: ${parsed.system || 'N/A'}\nActors: ${parsed.actors.join(', ') || 'None'}\nControl Actions: ${parsed.controlActions.join(', ') || 'None'}\nHazards: ${parsed.hazards.join(', ') || 'None'}\nLosses: ${parsed.losses.join(', ') || 'None'}\nUCAs: ${parsed.ucas.join(', ') || 'None'}`;
		vscode.window.showInformationMessage(summary);
	});

	context.subscriptions.push(disposable);
}

function parsePastaContent(text: string) {
	const lines = text.split('\n').map(line => line.trim());

	const result: any = {
		system: null,
		actors: [],
		controlActions: [],
		hazards: [],
		losses: [],
		ucas: []
	};

	for (const line of lines) {
		if (line.startsWith('System:')) {
			result.system = line.replace('System:', '').trim();
		} else if (line.startsWith('Actor:')) {
			result.actors.push(line.replace('Actor:', '').trim());
		} else if (line.startsWith('ControlAction:')) {
			result.controlActions.push(line.replace('ControlAction:', '').trim());
		} else if (line.startsWith('Hazard:')) {
			result.hazards.push(line.replace('Hazard:', '').trim());
		} else if (line.startsWith('Loss:')) {
			result.losses.push(line.replace('Loss:', '').trim());
		} else if (line.startsWith('UCA:')) {
			result.ucas.push(line.replace('UCA:', '').trim());
		}
	}

	return result;
}

export function deactivate() { }
