import { deriveControlStructFromText } from '../../src/csExtract';

describe('deriveControlStructFromText', () => {
  test('extracts labeled sections into control structure fields', () => {
    const text = [
      'Actors: Operator, Technician',
      'Sensors: Camera; Radar',
      'Actuators: Motor',
      'Controllers: Autopilot',
      'Environment: Highway',
      'Process: Vehicle motion',
      'Interfaces: CAN bus',
    ].join('\n');

    const out = deriveControlStructFromText(text);

    expect(out.actors).toEqual(['Operator', 'Technician']);
    expect(out.sensors).toEqual(['Camera', 'Radar']);
    expect(out.actuators).toEqual(['Motor']);
    expect(out.controllers).toEqual(['Autopilot']);
    expect(out.environment).toEqual(['Highway']);
    expect(out.process).toEqual(['Vehicle motion']);
    expect(out.interfaces).toEqual(['CAN bus']);
  });

  test('falls back to heuristic defaults when headings are missing', () => {
    const text =
      'The controller uses a sensor to drive an actuator. ' +
      'An operator supervises the system in the environment.';

    const out = deriveControlStructFromText(text);

    expect(out.controllers).toEqual(['Controller']);
    expect(out.sensors).toEqual(['Sensor']);
    expect(out.actuators).toEqual(['Actuator']);
    expect(out.actors).toEqual(['Operator']);
    expect(out.environment).toEqual(['Environment']);
  });
});
