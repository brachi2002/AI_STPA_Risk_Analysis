// parser.test.ts
import { expect } from 'chai';
import { parsePastaContent } from '../../extension.js';

describe('parsePastaContent', () => {
    it('should parse a full PASTA DSL file correctly', () => {
        const input = `
      System: Smart Car
      Actor: Brake Controller
      ControlAction: Apply Brake
      Hazard: Braking at wrong time
      Loss: Passenger injury
      UCA: Apply Brake when not needed
    `;

        const result = parsePastaContent(input);

        expect(result.system).to.equal('Smart Car');
        expect(result.actors).to.deep.equal(['Brake Controller']);
        expect(result.controlActions).to.deep.equal(['Apply Brake']);
        expect(result.hazards).to.deep.equal(['Braking at wrong time']);
        expect(result.losses).to.deep.equal(['Passenger injury']);
        expect(result.ucas).to.deep.equal(['Apply Brake when not needed']);
    });

    it('should handle empty input gracefully', () => {
        const input = '';
        const result = parsePastaContent(input);

        expect(result.system).to.equal(null);
        expect(result.actors).to.deep.equal([]);
        expect(result.controlActions).to.deep.equal([]);
        expect(result.hazards).to.deep.equal([]);
        expect(result.losses).to.deep.equal([]);
        expect(result.ucas).to.deep.equal([]);
    });

    it('should ignore unrelated lines', () => {
        const input = `
      System: UAV
      This is a comment
      Actor: Autopilot
      Note: Something else
    `;

        const result = parsePastaContent(input);

        expect(result.system).to.equal('UAV');
        expect(result.actors).to.deep.equal(['Autopilot']);
        expect(result.controlActions).to.deep.equal([]);
    });
});
