// src/csExtract.ts
import type { ControlStructInput, ControlActionItem, FeedbackItem, ControlLoopItem } from './types';

/**
 * Helpers for capturing control structure data from descriptive text and structured sections.
 */

type SectionKey =
    | 'CONTROLLERS'
    | 'CONTROLLED_PROCESSES'
    | 'ACTUATORS'
    | 'SENSORS'
    | 'ENVIRONMENT'
    | 'ACTORS'
    | 'INTERFACES'
    | 'EXTERNAL_SYSTEMS'
    | 'CONTROL_ACTIONS'
    | 'FEEDBACK'
    | 'CONTROL_LOOPS';

function sectionLines(text: string, heading: SectionKey): string[] {
    const rx = new RegExp(`===\\s*${heading}\\s*===\\s*([\\s\\S]*?)(?=\\n===|$)`, 'i');
    const match = text.match(rx);
    if (!match) return [];
    return match[1]
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => {
            if (!line) return false;
            if (line.startsWith('-')) return false;
            const normalized = line.toLowerCase();
            if (normalized === 'none') return false;
            return true;
        });
}

function parseBracketedList(value: string): string[] {
    return value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.toUpperCase());
}

function parseControlActionLine(line: string): ControlActionItem | null {
    const match = line.match(/^CA(\d+)\s*:\s*(C\d+)\s*->\s*(.+)$/i);
    if (!match) return null;
    return {
        id: `CA${match[1]}`,
        controller: match[2].toUpperCase(),
        label: match[3].trim(),
    };
}

function parseFeedbackLine(line: string): FeedbackItem | null {
    const match = line.match(/^F(\d+)\s*:\s*([A-Za-z]+\d+)\s*->\s*([A-Za-z]+\d+)\s*:\s*(.+)$/i);
    if (!match) return null;
    return {
        id: `F${match[1]}`,
        from: match[2].toUpperCase(),
        to: match[3].toUpperCase(),
        label: match[4].trim(),
    };
}

function parseLoopLine(line: string): ControlLoopItem | null {
    const match = line.match(/^LOOP(\d+)\s*:\s*(.+)$/i);
    if (!match) return null;
    const payload = match[2];
    const parts = payload.split(';').map((part) => part.trim()).filter(Boolean);
    const loop: ControlLoopItem = {
        id: `LOOP${match[1]}`,
        actuators: [],
        controlActions: [],
        feedback: [],
    };
    for (const part of parts) {
        const [rawKey, rawValue] = part.split('=').map((p) => p.trim());
        if (!rawKey || !rawValue) continue;
        const key = rawKey.toLowerCase();
        if (key === 'controller') {
            loop.controller = rawValue.toUpperCase();
            continue;
        }
        if (key === 'controlled_process') {
            loop.controlledProcess = rawValue.toUpperCase();
            continue;
        }
        if (key === 'actuators') {
            loop.actuators = parseBracketedList(rawValue);
            continue;
        }
        if (key === 'control_actions') {
            loop.controlActions = parseBracketedList(rawValue);
            continue;
        }
        if (key === 'feedback') {
            loop.feedback = parseBracketedList(rawValue);
        }
    }
    return loop;
}

function sanitizeSection(lines: string[]): string[] {
    return lines.map((line) => line.trim()).filter(Boolean);
}

/**
 * Heuristically derive control structure elements from a freeform system description.
 */
export function deriveControlStructFromText(text: string): ControlStructInput {
    const out: ControlStructInput = {};

    const take = (label: string) => {
        const rx = new RegExp(`\\b${label}\\s*:\\s*([\\s\\S]*?)(?:\\n\\s*\\w+\\s*:|$)`, 'i');
        const m = text.match(rx);
        if (!m) return [] as string[];
        return m[1]
            .split(/\r?\n|,|;/)
            .map((s) => s.trim())
            .filter(Boolean);
    };

    const as = take('Actors');
    const ss = take('Sensors');
    const ac = take('Actuators');
    const cs = take('Controllers');
    const env = take('Environment');
    const proc = take('Process');
    const ifc = take('Interfaces');

    if (as.length) out.actors = as;
    if (ss.length) out.sensors = ss;
    if (ac.length) out.actuators = ac;
    if (cs.length) out.controllers = cs;
    if (env.length) out.environment = env;
    if (proc.length) out.process = proc;
    if (ifc.length) out.interfaces = ifc;

    if (!out.controllers && /\b(controller|control unit|pid|autopilot|ecu)\b/i.test(text)) out.controllers = ['Controller'];
    if (!out.actors && /\b(operator|user|nurse|doctor|pilot|driver)\b/i.test(text)) out.actors = ['Operator'];
    if (!out.sensors && /\b(sensor|camera|lidar|thermistor|pressure|accelerometer|flow)\b/i.test(text)) out.sensors = ['Sensor'];
    if (!out.actuators && /\b(actuator|motor|valve|pump|servo|brake)\b/i.test(text)) out.actuators = ['Actuator'];
    if (!out.environment && /\b(patient|environment|vehicle|plant|process)\b/i.test(text)) out.environment = ['Environment'];

    return out;
}

/**
 * Parse Step 2 markdown sections to populate structured control structure pieces.
 */
export function parseStep2ControlStructure(text: string): ControlStructInput {
    if (!text) return {};
    const cs: ControlStructInput = {};

    const controllers = sectionLines(text, 'CONTROLLERS');
    const processes = sectionLines(text, 'CONTROLLED_PROCESSES');
    const actuators = sectionLines(text, 'ACTUATORS');
    const sensors = sectionLines(text, 'SENSORS');
    const environment = sectionLines(text, 'ENVIRONMENT');
    const externals = sectionLines(text, 'EXTERNAL_SYSTEMS');
    const interfaces = sectionLines(text, 'INTERFACES');
    const controlActions = sectionLines(text, 'CONTROL_ACTIONS');
    const feedback = sectionLines(text, 'FEEDBACK');
    const loops = sectionLines(text, 'CONTROL_LOOPS');

    if (controllers.length) cs.controllers = sanitizeSection(controllers);
    if (processes.length) cs.process = sanitizeSection(processes);
    if (actuators.length) cs.actuators = sanitizeSection(actuators);
    if (sensors.length) cs.sensors = sanitizeSection(sensors);
    if (environment.length) cs.environment = sanitizeSection(environment);
    if (externals.length) cs.externalSystems = sanitizeSection(externals);
    if (interfaces.length) cs.interfaces = sanitizeSection(interfaces);

    const controlActionItems = controlActions.map(parseControlActionLine).filter(Boolean) as ControlActionItem[];
    if (controlActionItems.length) cs.controlActions = controlActionItems;

    const feedbackItems = feedback.map(parseFeedbackLine).filter(Boolean) as FeedbackItem[];
    if (feedbackItems.length) cs.feedback = feedbackItems;

    const loopItems = loops.map(parseLoopLine).filter(Boolean) as ControlLoopItem[];
    if (loopItems.length) cs.loops = loopItems;

    return cs;
}

const mergeArray = <T>(primary?: T[], fallback?: T[]): T[] | undefined => {
    if (primary && primary.length) return primary;
    if (fallback && fallback.length) return fallback;
    return undefined;
};

/**
 * Merge two control structure inputs, preferring the primary values when present.
 */
export function mergeControlStructInputs(
    primary?: ControlStructInput,
    fallback?: ControlStructInput
): ControlStructInput {
    if (!primary) return fallback ? { ...fallback } : {};
    if (!fallback) return { ...primary };
    return {
        actors: mergeArray(primary.actors, fallback.actors),
        controllers: mergeArray(primary.controllers, fallback.controllers),
        sensors: mergeArray(primary.sensors, fallback.sensors),
        actuators: mergeArray(primary.actuators, fallback.actuators),
        process: mergeArray(primary.process, fallback.process),
        environment: mergeArray(primary.environment, fallback.environment),
        interfaces: mergeArray(primary.interfaces, fallback.interfaces),
        externalSystems: mergeArray(primary.externalSystems, fallback.externalSystems),
        controlActions: mergeArray(primary.controlActions, fallback.controlActions),
        feedback: mergeArray(primary.feedback, fallback.feedback),
        loops: mergeArray(primary.loops, fallback.loops),
    };
}
