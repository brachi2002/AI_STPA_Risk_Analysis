import { parseHazardRow } from './tables';

type Step1HazardEntry = { id: string; leadsToLosses: string[] };
type Step1ConstraintEntry = { id: string; addresses: string[] };
type Step1TableARow = { loss: string; hazards: string[] };
type Step1TableBRow = { hazard: string; constraints: string[] };

const SECTION_LOSSES = 'LOSSES';
const SECTION_HAZARDS = 'HAZARDS';
const SECTION_CONSTRAINTS = 'SAFETY CONSTRAINTS';
const SECTION_TABLE_A = 'TABLE A: LOSS TO HAZARDS';
const SECTION_TABLE_B = 'TABLE B: HAZARD TO SAFETY CONSTRAINTS';

function escapeHeading(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSection(text: string, heading: string): string | null {
	const safe = escapeHeading(heading);
	const rx = new RegExp(`===\\s*${safe}\\s*===\\s*([\\s\\S]*?)(?=\\n===|$)`, 'i');
	const match = text.match(rx);
	return match ? match[1].trim() : null;
}

function splitLines(section: string | null): string[] {
	if (!section) return [];
	return section
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length);
}

function normalizeId(raw: string): string {
	return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function normalizeIdList(raw: string, pattern: RegExp): string[] {
	return raw
		.split(/[;,]/)
		.map((part) => normalizeId(part))
		.filter((id) => id && pattern.test(id));
}

function extractTargets(line: string, keys: string[], pattern: RegExp): string[] {
	for (const key of keys) {
		const rx = new RegExp(`${key}\\s*:\\s*([^\\)]+)`, 'i');
		const match = line.match(rx);
		if (match && match[1]) {
			return normalizeIdList(match[1], pattern);
		}
	}
	return [];
}

function parseHazardSection(section: string | null): Step1HazardEntry[] {
	return splitLines(section)
		.map(parseHazardRow)
		.filter((row) => Boolean(row.id))
		.map((row) => ({ id: row.id, leadsToLosses: row.leadsToLosses }));
}

function parseSafetyConstraintRow(line: string): Step1ConstraintEntry | null {
	const match = line.match(/^\s*(SC\d+)\s*:/i);
	if (!match) return null;
	return {
		id: match[1].toUpperCase(),
		addresses: extractTargets(line, ['addresses'], /^H\d+$/i),
	};
}

function parseConstraintSection(section: string | null): Step1ConstraintEntry[] {
	return splitLines(section)
		.map(parseSafetyConstraintRow)
		.filter((entry): entry is Step1ConstraintEntry => Boolean(entry?.id));
}

function parseTablePairs(section: string | null): string[][] {
	if (!section) return [];
	return section
		.split(/\r?\n/)
		.map((line) => line.trim())
		.map((line) => line.split('|').map((cell) => cell.trim()).filter((cell) => cell.length))
		.filter((cells) => cells.length >= 2)
		.filter((cells) => !cells.some((cell) => /^-+$/.test(cell)))
		.filter((cells) => !/^(Loss|Hazard|Safety Constraints)$/i.test(cells[0]));
}

function parseTableASection(section: string | null): Step1TableARow[] {
	return parseTablePairs(section).map(([loss, hazards]) => ({
		loss: normalizeId(loss),
		hazards: normalizeIdList(hazards, /^H\d+$/i),
	}));
}

function parseTableBSection(section: string | null): Step1TableBRow[] {
	return parseTablePairs(section).map(([hazard, constraints]) => ({
		hazard: normalizeId(hazard),
		constraints: normalizeIdList(constraints, /^SC\d+$/i),
	}));
}

function parseLossIds(section: string | null): string[] {
	return splitLines(section)
		.map((line) => line.match(/^\s*(L\d+)\s*:/i)?.[1])
		.filter(Boolean)
		.map((id) => id!.toUpperCase());
}

export interface Step1TableValidationResult {
	valid: boolean;
	errors: string[];
}

export function validateStep1Tables(text: string): Step1TableValidationResult {
	const errors: string[] = [];

	const lossSection = extractSection(text, SECTION_LOSSES);
	const hazardSection = extractSection(text, SECTION_HAZARDS);
	const constraintSection = extractSection(text, SECTION_CONSTRAINTS);
	const tableASection = extractSection(text, SECTION_TABLE_A);
	const tableBSection = extractSection(text, SECTION_TABLE_B);

	const lossIds = parseLossIds(lossSection);
	const lossSet = new Set(lossIds);
	if (!lossSection) errors.push(`Missing section: ${SECTION_LOSSES}.`);
	if (!hazardSection) errors.push(`Missing section: ${SECTION_HAZARDS}.`);
	if (!constraintSection) errors.push(`Missing section: ${SECTION_CONSTRAINTS}.`);
	if (!tableASection) errors.push(`Missing section: ${SECTION_TABLE_A}.`);
	if (!tableBSection) errors.push(`Missing section: ${SECTION_TABLE_B}.`);
	if (!lossIds.length) errors.push('No losses defined in Step 1 output.');

	const hazards = parseHazardSection(hazardSection);
	const hazardMap = new Map<string, Step1HazardEntry>();
	hazards.forEach((hazard) => {
		if (hazard.id) hazardMap.set(hazard.id, hazard);
	});
	if (!hazards.length) errors.push('No hazards parsed from Step 1.');

	const constraints = parseConstraintSection(constraintSection);
	const constraintMap = new Map<string, Step1ConstraintEntry>();
	constraints.forEach((constraint) => constraintMap.set(constraint.id, constraint));
	if (!constraints.length) errors.push('No safety constraints parsed from Step 1.');

	const tableARows = parseTableASection(tableASection);
	const tableBRows = parseTableBSection(tableBSection);

	const lossCoverage = new Map(lossIds.map((id) => [id, 0]));
	for (const hazard of hazards) {
		const id = hazard.id;
		hazard.leadsToLosses.forEach((loss) => {
			if (!lossSet.has(loss)) {
				errors.push(`Hazard ${id} references undefined loss ${loss}.`);
				return;
			}
			if (lossCoverage.has(loss)) {
				lossCoverage.set(loss, (lossCoverage.get(loss) ?? 0) + 1);
			}
		});
	}

	const uncovered = [...lossCoverage.entries()].filter(([, count]) => count === 0).map(([id]) => id);
	if (uncovered.length) {
		errors.push(`Losses without hazard coverage: ${uncovered.join(', ')}.`);
	}

	if (tableARows.length) {
		for (const row of tableARows) {
			if (!row.loss) {
				errors.push('Table A contains a row without a valid loss ID.');
				continue;
			}
			if (!lossSet.has(row.loss)) {
				errors.push(`Table A references undefined loss ${row.loss}.`);
				continue;
			}
			if (!row.hazards.length) {
				errors.push(`Table A row for ${row.loss} has no hazards.`);
				continue;
			}
			row.hazards.forEach((hid) => {
				const hazard = hazardMap.get(hid);
				if (!hazard) {
					errors.push(`Table A row for ${row.loss} references unknown hazard ${hid}.`);
					return;
				}
				if (!hazard.leadsToLosses.includes(row.loss)) {
					errors.push(`Table A row for ${row.loss} lists ${hid} but ${hid} does not lead to ${row.loss}.`);
				}
			});
		}
	}

	if (tableBRows.length) {
		for (const row of tableBRows) {
			if (!row.hazard) {
				errors.push('Table B contains a row without a valid hazard ID.');
				continue;
			}
			if (!hazardMap.has(row.hazard)) {
				errors.push(`Table B references unknown hazard ${row.hazard}.`);
				continue;
			}
			if (!row.constraints.length) {
				errors.push(`Table B row for ${row.hazard} has no safety constraints.`);
				continue;
			}
			row.constraints.forEach((sc) => {
				const constraint = constraintMap.get(sc);
				if (!constraint) {
					errors.push(`Table B row for ${row.hazard} references unknown constraint ${sc}.`);
					return;
				}
				if (!constraint.addresses.includes(row.hazard)) {
					errors.push(`Table B row for ${row.hazard} lists ${sc} but ${sc} does not address ${row.hazard}.`);
				}
			});
		}
	}

	return { valid: errors.length === 0, errors };
}
