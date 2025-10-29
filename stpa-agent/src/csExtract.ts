// src/csExtract.ts
import type { ControlStructInput } from './types';

export function deriveControlStructFromText(text: string): ControlStructInput {
    // תומך בשני פורמטים:
    // 1) כותרות מפורשות: "Actors:", "Sensors:", "Actuators:", "Controllers:", "Environment:", "Process:", "Interfaces:"
    // 2) זיהוי קל ממילות מפתח אם אין כותרות
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

    // fallback סכמטי אם אין כותרות בכלל – heuristics רכים
    if (!out.controllers && /\b(controller|control unit|pid|autopilot|ecu)\b/i.test(text)) out.controllers = ['Controller'];
    if (!out.actors && /\b(operator|user|nurse|doctor|pilot|driver)\b/i.test(text)) out.actors = ['Operator'];
    if (!out.sensors && /\b(sensor|camera|lidar|thermistor|pressure|accelerometer|flow)\b/i.test(text)) out.sensors = ['Sensor'];
    if (!out.actuators && /\b(actuator|motor|valve|pump|servo|brake)\b/i.test(text)) out.actuators = ['Actuator'];
    if (!out.environment && /\b(patient|environment|vehicle|plant|process)\b/i.test(text)) out.environment = ['Environment'];

    return out;
}
