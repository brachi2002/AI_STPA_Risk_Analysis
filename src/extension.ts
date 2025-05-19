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
	});

	context.subscriptions.push(disposable);
}

export function deactivate() { }
