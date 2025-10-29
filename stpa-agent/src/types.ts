// src/types.ts
export type SystemType = 'medical' | 'drone' | 'automotive' | 'generic';

export type StpaResult = {
    losses: string[];   // שורות L1:, L2: ...
    hazards: string[];  // שורות H1: ... (related: ...)
    ucas: string[];     // שורות UCA1: ... (control loop: ... ; related: ...)
    raw: string;        // הטקסט הגולמי
};

export type ControlStructInput = {
    actors?: string[];
    sensors?: string[];
    actuators?: string[];
    controllers?: string[];
    environment?: string[];
    process?: string[];
    interfaces?: string[];
};
