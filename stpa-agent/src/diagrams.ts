// src/diagrams.ts
import type { ControlStructInput, StpaResult, ControlActionItem, FeedbackItem } from './types';
import { parseHazardRow, parseUcaRow, parseLossRow } from './tables';

/**
 * Remove characters that Mermaid treats as structural tokens so labels remain readable.
 */
function esc(s: string) {
    return s.replace(/[{}\[\]()|]/g, ' ').trim();
}

/** Allowed node shapes for the Mermaid control structure diagram. */
type NodeShape = 'rect' | 'round';

/**
 * Build a Mermaid flowchart showing how actors, controllers, and processes are connected through
 * control actions, actuators, and feedback loops.
 *
 * @param cs - Control structure inputs collected from the STPA worksheet.
 * @returns A Mermaid code block ready for rendering.
 */
export function buildControlStructureMermaid(cs: ControlStructInput): string {
    const lines: string[] = ['```mermaid', 'graph TD'];
    const knownNodes = new Map<string, NodeShape>();
    const renderedEdges = new Set<string>();

    /**
     * Register a node in the Mermaid output if it has not already been added.
     */
    const addNode = (id: string, label: string, shape: NodeShape = 'rect') => {
        if (!id) return;
        if (knownNodes.has(id)) return;
        knownNodes.set(id, shape);
        const safeLabel = esc(label || id);
        const node = shape === 'round' ? `${id}((${safeLabel}))` : `${id}[${safeLabel}]`;
        lines.push(node);
    };

    /**
     * Normalize raw lines from the input by assigning ids and labels that Mermaid can use.
     */
    const normalizeLineNode = (line: string, prefix: string, idx: number) => {
        const trimmed = line.trim();
        const match = trimmed.match(/^([A-Za-z]+[0-9]+)\s*:\s*(.+)$/i);
        if (match) {
            return { id: match[1].toUpperCase(), label: trimmed };
        }
        return { id: `${prefix}${idx}`, label: trimmed };
    };

    /**
     * Create Mermaid nodes for a list of raw labels and return the ids that were assigned.
     */
    const buildNodes = (items: string[] | undefined, prefix: string, shape: NodeShape = 'rect'): string[] => {
        const ids: string[] = [];
        (items || []).forEach((item, index) => {
            const { id, label } = normalizeLineNode(item, prefix, index);
            addNode(id, label, shape);
            ids.push(id);
        });
        return ids;
    };

    /**
     * Add a node unconditionally when the id is known but may not yet exist.
     */
    const ensureNode = (id: string | undefined, label?: string, shape: NodeShape = 'rect') => {
        if (!id) return;
        addNode(id, label ?? id, shape);
    };

    /**
     * Push a Mermaid edge definition once, deduplicating repeated statements.
     */
    const addEdge = (edge: string) => {
        if (!edge) return;
        if (renderedEdges.has(edge)) return;
        renderedEdges.add(edge);
        lines.push(edge);
    };

    /** Normalize controller, actuator, and feedback references to a predictable uppercase form. */
    const normalizeRef = (value: string | undefined) => (value ? value.trim().toUpperCase() : undefined);

    buildNodes(cs.actors, 'Actor');
    const controllerLines = cs.controllers || [];
    buildNodes(controllerLines, 'Ctrl');
    buildNodes(cs.sensors, 'Sens');
    const actuatorIds = buildNodes(cs.actuators, 'Act');
    const processIds = buildNodes(cs.process, 'Proc');
    const environmentIds = buildNodes(cs.environment, 'Env', 'round');
    buildNodes(cs.externalSystems, 'Ext', 'round');
    buildNodes(cs.interfaces, 'Ifc');

    const controlActionMap = new Map<string, ControlActionItem>();
    (cs.controlActions || []).forEach((ca) => controlActionMap.set(ca.id.toUpperCase(), ca));

    const feedbackMap = new Map<string, FeedbackItem>();
    (cs.feedback || []).forEach((fb) => feedbackMap.set(fb.id.toUpperCase(), fb));

    const loops = cs.loops || [];
    const hasStructuredLoops = loops.length > 0;

    const controllerTypes = new Map<string, string>();
    controllerLines.forEach((line, index) => {
        const { id } = normalizeLineNode(line, 'Ctrl', index);
        const typeMatch = line.match(/type\s*:\s*(human|software|device|organization)/i);
        if (typeMatch) {
            controllerTypes.set(id, typeMatch[1].toLowerCase());
        }
    });
    const softwareControllerId = [...controllerTypes.entries()].find(([, type]) => type === 'software')?.[0];

    const getActuationController = (loopControllerId?: string) => {
        if (!loopControllerId) return undefined;
        const loopType = controllerTypes.get(loopControllerId);
        if (loopType === 'human' && softwareControllerId && softwareControllerId !== loopControllerId) {
            return softwareControllerId;
        }
        return loopControllerId;
    };

    if (hasStructuredLoops) {
        loops.forEach((loop) => {
            const controllerId = normalizeRef(loop.controller);
            const actuationControllerId = getActuationController(controllerId);
            if (controllerId) {
                ensureNode(controllerId, controllerId);
            }
            if (actuationControllerId) {
                ensureNode(actuationControllerId, actuationControllerId);
            }

            const controlActionLabels = loop.controlActions
                .map((caId) => {
                    const normalized = caId.toUpperCase();
                    const item = controlActionMap.get(normalized);
                    return item ? `${item.id}: ${item.label}` : normalized;
                })
                .filter(Boolean);

            const actionLabel = controlActionLabels.join('\\n');
            const actorsToLabel = actionLabel ? esc(actionLabel) : '';

            loop.actuators.map(normalizeRef).filter(Boolean).forEach((actuatorId) => {
                ensureNode(actuatorId, actuatorId);
                if (actuationControllerId) {
                    const edgeLabel = actorsToLabel || '';
                    const edge = edgeLabel
                        ? `${actuationControllerId} -->|${edgeLabel}| ${actuatorId}`
                        : `${actuationControllerId} --> ${actuatorId}`;
                    addEdge(edge);
                }

                const explicitProcess = normalizeRef(loop.controlledProcess);
                if (explicitProcess) {
                    const processId = explicitProcess!;
                    ensureNode(processId);
                    addEdge(`${actuatorId} --> ${processId as string}`);
                } else {
                    const fallbackProcess = processIds[0];
                    if (fallbackProcess) {
                        const targetProcess = fallbackProcess!;
                        addEdge(`${actuatorId} --> ${targetProcess as string}`);
                    } else if (environmentIds.length) {
                        environmentIds.forEach((envId) => addEdge(`${actuatorId} --> ${envId}`));
                    }
                }
            });

            loop.feedback.map(normalizeRef).forEach((feedbackId) => {
                if (!feedbackId) return;
                const fb = feedbackMap.get(feedbackId);
                if (!fb) return;
                const fromId = normalizeRef(fb.from);
                const toId = normalizeRef(fb.to);
                if (!fromId || !toId) return;
                ensureNode(fromId, fromId);
                ensureNode(toId, toId);
                const label = esc(`${fb.id}: ${fb.label}`);
                addEdge(`${fromId} -->|${label}| ${toId}`);
            });
        });
    } else {
        const actuatorTargets = processIds.length ? processIds : environmentIds;
        actuatorIds.forEach((actuatorId) => {
            actuatorTargets.forEach((targetId) => addEdge(`${actuatorId} --> ${targetId}`));
        });
    }

    lines.push('```');
    return lines.join('\n');
}

/**
 * Render loss-hazard-uca chains as a Mermaid impact graph with classification styling.
 *
 * @param stpa - The parsed STPA result containing losses, hazards, and UCAs.
 * @returns A Mermaid code block showing how UCAs lead to hazards and hazards lead to losses.
 */
export function buildImpactGraphMermaid(stpa: StpaResult): string {
	const lines: string[] = ['```mermaid', 'graph LR'];
	const lossRows = stpa.losses.map(parseLossRow).filter((row) => row.id);
	const hazardRows = stpa.hazards.map(parseHazardRow).filter((row) => row.id);
	const ucaRows = stpa.ucas.map(parseUcaRow).filter((row) => row.id);

	const lossIds = new Set(lossRows.map((row) => row.id));
	const hazardIds = new Set(hazardRows.map((row) => row.id));
	let ucaHazardEdges = 0;
	let hazardLossEdges = 0;

	lossRows.forEach((loss) => {
		const label = loss.text ? `${loss.id}` : loss.id;
		lines.push(`${loss.id}[${esc(label)}]:::loss`);
	});

    hazardRows.forEach((hazard) => {
        const label = hazard.text ? `${hazard.id}` : hazard.id;
        lines.push(`${hazard.id}[${esc(label)}]:::haz`);
    });

    ucaRows.forEach((uca) => {
        lines.push(`${uca.id}[${esc(uca.id)}]:::uca`);
    });

	ucaRows.forEach((uca) => {
		uca.leadsToHazards.forEach((hid) => {
			const hazardId = hid.toUpperCase();
			if (hazardIds.has(hazardId)) {
				lines.push(`${uca.id} --> ${hazardId}`);
				ucaHazardEdges++;
			}
		});
	});

	hazardRows.forEach((hazard) => {
		hazard.leadsToLosses.forEach((lid) => {
			const lossId = lid.toUpperCase();
			if (lossIds.has(lossId)) {
				lines.push(`${hazard.id} --> ${lossId}`);
				hazardLossEdges++;
			}
		});
	});

	if (ucaRows.length > 0 && ucaHazardEdges === 0) {
		throw new Error('Impact graph requires at least one UCA -> Hazard edge derived from Step 3 leads_to data.');
	}
	if (hazardRows.length > 0 && hazardLossEdges === 0) {
		throw new Error('Impact graph requires at least one Hazard -> Loss edge derived from Step 1 leads_to data.');
	}

	lines.push('classDef uca fill:#E6F7FF,stroke:#06c;');
	lines.push('classDef haz fill:#FFF4E6,stroke:#c60;');
	lines.push('classDef loss fill:#FDECEC,stroke:#c00;');
    lines.push('```');
    return lines.join('\n');
}
