# STPA Agent VSCode Extension

The **STPA Agent** is a Visual Studio Code extension designed to assist engineers in analyzing safety-critical systems using the PASTA DSL (Domain Specific Language) for STPA (System-Theoretic Process Analysis).

This extension recognizes and parses `.pasta` and `.txt` files that follow the PASTA format, helping users validate and understand the structure of their safety models.

---

## 🚀 Features

- ✅ Detects and validates PASTA DSL files (`.pasta`, `.txt`, or content starting with `System:`)
- 📄 Parses and extracts:
  - System name
  - Defined actors
  - Control actions
- 💬 Provides instant feedback via information messages and logs
- 🛠 Prepares the ground for AI-guided STPA safety analysis

> Example of recognized PASTA content:
```pasta
System: Smart Car
Actor: Brake Controller
ControlAction: Apply Brake
🧩 Requirements
Node.js

Visual Studio Code

Yeoman and VSCode extension generator (if you want to scaffold from scratch):

bash
Copy
Edit
npm install -g yo generator-code
⚙️ How It Works
When you run the STPA: Hello World command (from Command Palette), the extension:

Detects if the current open file is a valid PASTA file.

Parses the file for key structural elements (System, Actor, ControlAction).

Displays a summary of the parsed data.

If the file is empty or doesn't match expected patterns, the extension will inform you.

🔧 Extension Settings
This version of the extension does not expose any user-configurable settings yet.

🐞 Known Issues
Does not yet support full PASTA syntax validation or nested structures.

No support for LLM-guided analysis (planned for future stages).

📦 Release Notes
0.1.0
Initial release with file detection and basic parsing

Logs and displays structured feedback

📚 Resources
STPA Overview

PASTA Tool

VS Code Extension API

🙌 Contributing
Planned soon. For now, feel free to fork and experiment!

