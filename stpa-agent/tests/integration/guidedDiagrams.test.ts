import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SystemType } from '../../src/types';
import { __test__ } from '../../src/extension';

const {
	getGuidedDiagramPaths,
	readResultFromJson,
	loadGuidedDiagramsFromDisk,
	generateDiagramsForGuidedSession,
	getLastContext,
	setLastContext,
} = __test__;

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'stpa-test-'));
}

describe('getGuidedDiagramPaths', () => {
	test('returns correct cs/impact/json paths', () => {
		const dir = makeTempDir();
		const project = { dir, baseName: 'demo' };
		const paths = getGuidedDiagramPaths(project);
		expect(paths.csPath).toBe(path.join(project.dir, 'demo_cs.mmd'));
		expect(paths.impactPath).toBe(path.join(project.dir, 'demo_impact.mmd'));
		expect(paths.jsonPath).toBe(path.join(project.dir, 'demo_stpa.json'));
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

describe('readResultFromJson', () => {
	let dir: string;

	beforeEach(() => {
		dir = makeTempDir();
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('returns null if file does not exist', () => {
		const file = path.join(dir, 'missing.json');
		expect(readResultFromJson(file)).toBeNull();
	});

	test('returns parsed StpaResult for valid JSON', () => {
		const file = path.join(dir, 'valid.json');
		fs.writeFileSync(
			file,
			JSON.stringify({ losses: ['L1'], hazards: ['H1'], ucas: ['UCA1'], raw: 'raw' }),
			'utf-8'
		);
		expect(readResultFromJson(file)).toEqual({
			losses: ['L1'],
			hazards: ['H1'],
			ucas: ['UCA1'],
			raw: 'raw',
		});
	});

	test('returns empty arrays for missing fields', () => {
		const file = path.join(dir, 'partial.json');
		fs.writeFileSync(file, JSON.stringify({ losses: ['L1'] }), 'utf-8');
		expect(readResultFromJson(file)).toEqual({
			losses: ['L1'],
			hazards: [],
			ucas: [],
			raw: '',
		});
	});

	test('returns null for invalid JSON', () => {
		const file = path.join(dir, 'invalid.json');
		fs.writeFileSync(file, '{ invalid json', 'utf-8');
		expect(readResultFromJson(file)).toBeNull();
	});
});

describe('loadGuidedDiagramsFromDisk', () => {
	let dir: string;
	let project: { dir: string; baseName: string };
	let session: {
		project: { dir: string; baseName: string };
		systemText: string;
		systemType: SystemType;
		currentStep: 2;
		guidedPath: string;
	};

	beforeEach(() => {
		dir = makeTempDir();
		project = { dir, baseName: 'demo' };
		session = {
			project,
			systemText: 'System text',
			systemType: 'generic',
			currentStep: 2,
			guidedPath: path.join(dir, 'demo_guided.md'),
		};
		setLastContext(null);
	});

	afterEach(() => {
		setLastContext(null);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('returns false when mermaid files are missing', () => {
		expect(loadGuidedDiagramsFromDisk(session)).toBe(false);
	});

	test('returns true and populates lastContext when files exist', () => {
		const { csPath, impactPath, jsonPath } = getGuidedDiagramPaths(project);
		fs.writeFileSync(csPath, 'cs', 'utf-8');
		fs.writeFileSync(impactPath, 'impact', 'utf-8');
		fs.writeFileSync(
			jsonPath,
			JSON.stringify({ losses: ['L1'], hazards: [], ucas: [], raw: 'raw' }),
			'utf-8'
		);

		expect(loadGuidedDiagramsFromDisk(session)).toBe(true);
		const ctx = getLastContext();
		expect(ctx?.project?.baseName).toBe('demo');
		expect(ctx?.csMermaid).toBe('cs');
		expect(ctx?.impactMermaid).toBe('impact');
		expect(ctx?.result.losses).toEqual(['L1']);
	});

	test('does not overwrite lastContext when it already matches the same project', () => {
		const { csPath, impactPath } = getGuidedDiagramPaths(project);
		fs.writeFileSync(csPath, 'disk-cs', 'utf-8');
		fs.writeFileSync(impactPath, 'disk-impact', 'utf-8');

		const existing = {
			systemType: 'generic' as SystemType,
			result: { losses: ['L1'], hazards: [], ucas: [], raw: 'raw' },
			csMermaid: 'in-memory',
			impactMermaid: 'in-memory',
			project,
		};

		setLastContext(existing);
		expect(loadGuidedDiagramsFromDisk(session)).toBe(true);
		expect(getLastContext()).toBe(existing);
		expect(getLastContext()?.csMermaid).toBe('in-memory');
	});
});

describe('diagram generation guard', () => {
	let dir: string;
	let project: { dir: string; baseName: string };
	let session: {
		project: { dir: string; baseName: string };
		systemText: string;
		systemType: SystemType;
		currentStep: 2;
		guidedPath: string;
	};

	beforeEach(() => {
		dir = makeTempDir();
		project = { dir, baseName: 'guard' };
		session = {
			project,
			systemText: 'System text',
			systemType: 'generic',
			currentStep: 2,
			guidedPath: path.join(dir, 'guard_guided.md'),
		};
		setLastContext(null);
	});

	afterEach(() => {
		setLastContext(null);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('does not create new files when diagrams already exist', async () => {
		const { csPath, impactPath } = getGuidedDiagramPaths(project);
		fs.writeFileSync(csPath, 'cs', 'utf-8');
		fs.writeFileSync(impactPath, 'impact', 'utf-8');

		const before = fs.readdirSync(project.dir).sort();

		const hasDiagrams = loadGuidedDiagramsFromDisk(session);
		if (!hasDiagrams) {
			await generateDiagramsForGuidedSession('fake-key', session);
		}

		const after = fs.readdirSync(project.dir).sort();
		expect(after).toEqual(before);
	});
});
