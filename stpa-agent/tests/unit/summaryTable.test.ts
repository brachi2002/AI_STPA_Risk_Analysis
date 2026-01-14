import { sanitizeSummaryTableSection } from '../../src/extension';

const extractSummarySection = (text: string): string => {
	const match = text.match(/=== SUMMARY TABLE ===[\s\S]*?(?=\n=== [A-Z0-9 _]+===|$)/);
	return match ? match[0].trimEnd() : '';
};

describe('sanitizeSummaryTableSection', () => {
	it('removes fences and keeps only table rows with a blank line after the header', () => {
		const input = [
			'=== PREAMBLE ===',
			'context line',
			'=== SUMMARY TABLE ===',
			'```markdown',
			'| Loop | Controller |',
			'| --- | --- |',
			'| LOOP1 | C1 |',
			'```',
			'=== NEXT ===',
		].join('\n');

		const sanitized = sanitizeSummaryTableSection(input);
		const summarySection = extractSummarySection(sanitized);

		expect(summarySection).toBe(['=== SUMMARY TABLE ===', '', '| Loop | Controller |', '| --- | --- |', '| LOOP1 | C1 |'].join('\n'));
	});

	it('drops extra prose from the section, keeping only the table rows', () => {
		const input = [
			'=== SUMMARY TABLE ===',
			'Please see the table below.',
			'| Loop | Controller |',
			'| --- | --- |',
			'| LOOP1 | C1 |',
			'Note: the table is authoritative.',
			'=== OTHER ===',
		].join('\n');

		const sanitized = sanitizeSummaryTableSection(input);
		const summarySection = extractSummarySection(sanitized);

		expect(summarySection).toBe(['=== SUMMARY TABLE ===', '', '| Loop | Controller |', '| --- | --- |', '| LOOP1 | C1 |'].join('\n'));
	});

	it('keeps content when no table rows exist, but strips the fences', () => {
		const input = [
			'=== SUMMARY TABLE ===',
			'```',
			'Placeholder text while we wait for the table.',
			'```',
			'More explanation remains.',
			'=== END ===',
		].join('\n');

		const sanitized = sanitizeSummaryTableSection(input);
		const summarySection = extractSummarySection(sanitized);

		expect(summarySection).toBe([
			'=== SUMMARY TABLE ===',
			'',
			'Placeholder text while we wait for the table.',
			'More explanation remains.',
		].join('\n'));
	});
});
