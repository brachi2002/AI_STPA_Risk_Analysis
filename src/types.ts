// src/types.ts
/**
 * Shared STPA data shapes used across the extension.
 */
export type SystemType = 'medical' | 'drone' | 'automotive' | 'generic';

/**
 * Classic STPA output payload captured from the markdown analysis.
 */
export type StpaResult = {
    losses: string[];
    hazards: string[];
    ucas: string[];
    raw: string;
};

/**
 * Represents a control action belonging to a controller in the control structure.
 */
export type ControlActionItem = {
    id: string;
    controller: string;
    label: string;
};

/**
 * Represents a feedback path from one component to another.
 */
export type FeedbackItem = {
    id: string;
    from: string;
    to: string;
    label: string;
};

/**
 * Captures an assembled control loop including actuators, actions, and feedback.
 */
export type ControlLoopItem = {
    id: string;
    controller?: string;
    controlledProcess?: string;
    actuators: string[];
    controlActions: string[];
    feedback: string[];
};

/**
 * Partial control structure captured from system descriptions or guided steps.
 */
export type ControlStructInput = {
    actors?: string[];
    sensors?: string[];
    actuators?: string[];
    controllers?: string[];
    environment?: string[];
    process?: string[];
    interfaces?: string[];
    externalSystems?: string[];
    controlActions?: ControlActionItem[];
    feedback?: FeedbackItem[];
    loops?: ControlLoopItem[];
};
