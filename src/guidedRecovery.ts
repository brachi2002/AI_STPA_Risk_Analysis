export interface RecoveryAgent {
	setBusy: (busy: boolean) => void;
	sendInfo: (text: string) => void;
	log: (message: string) => void;
}

export interface RecoveryConfig<T> {
	label: string;
	run: () => Promise<T>;
	onSuccess: (result: T) => Promise<void>;
	validator?: (value: T) => { valid: boolean; errors?: string[] };
	attempts?: number;
	failureMessage?: string;
}

const defaultFailureMessage = (label: string) =>
	`I couldn't generate a consistent ${label} yet. Please try again or refine the system description.`;

export async function runWithRecovery<T>(agent: RecoveryAgent, config: RecoveryConfig<T>): Promise<boolean> {
	const attempts = Math.max(1, config.attempts ?? 2);
	agent.setBusy(true);
	try {
		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			try {
				const result = await config.run();
				if (config.validator) {
					const validation = config.validator(result);
					if (!validation.valid) {
						agent.log(`[${config.label}] validation failed (attempt ${attempt}/${attempts}).`);
						validation.errors?.forEach((error) => agent.log(`  • ${error}`));
						if (attempt === attempts) {
							agent.sendInfo(config.failureMessage ?? defaultFailureMessage(config.label));
							return false;
						}
						continue;
					}
				}

				await config.onSuccess(result);
				return true;
			} catch (error: any) {
				agent.log(`[${config.label}] attempt ${attempt}/${attempts} error: ${error?.message || error}`);
				if (attempt === attempts) {
					agent.sendInfo(config.failureMessage ?? defaultFailureMessage(config.label));
					return false;
				}
			}
		}

		return false;
	} finally {
		agent.setBusy(false);
	}
}
