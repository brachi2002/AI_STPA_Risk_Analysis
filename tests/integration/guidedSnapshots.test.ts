import { buildStep1Prompt, buildStep2Prompt, buildStep3Prompt, buildStep4Prompt } from '../../src/extension';
import { loadSystemDescriptionFixtures } from '../utils/fixtureUtils';
import { assertStep1Consistency, assertStep2Consistency, assertStep3Consistency, assertStep4Consistency } from '../utils/consistencyAssertions';
import { mockChatCompletion } from '../utils/llmMock';

function detectSystemType(text: string): 'generic' | 'medical' | 'drone' | 'automotive' {
  const lower = text.toLowerCase();
  if (/(patient|drug|dose|dosing|infusion|hospital|clinic|therapy|medical|device|monitoring)/.test(lower)) return 'medical';
  if (/(drone|uav|flight|gps|gnss|altitude|aircraft|autopilot|waypoint|gimbal)/.test(lower)) return 'drone';
  if (/(vehicle|car|brake|steer|steering|engine|automotive|airbag|lane|ecu|can bus|adas|aeb)/.test(lower)) return 'automotive';
  return 'generic';
}

describe('guided step snapshots', () => {
  const fixtures = loadSystemDescriptionFixtures().sort((a, b) => a.name.localeCompare(b.name));

  test.each(fixtures)('snapshot: %s', async (fixture) => {
    const systemType = detectSystemType(fixture.text);

    const step1Prompt = buildStep1Prompt(fixture.text, systemType);
    const step1Text = await mockChatCompletion(step1Prompt);

    const step2Prompt = buildStep2Prompt(fixture.text, systemType, step1Text);
    const step2Text = await mockChatCompletion(step2Prompt);

    const step3Prompt = buildStep3Prompt(fixture.text, systemType, step1Text, step2Text);
    const step3Text = await mockChatCompletion(step3Prompt);

    const step4Prompt = buildStep4Prompt(fixture.text, systemType, step1Text, step2Text, step3Text);
    const step4Text = await mockChatCompletion(step4Prompt);

    const step1Ids = assertStep1Consistency(step1Text);
    const step2Ids = assertStep2Consistency(step2Text);
    const step3Ids = assertStep3Consistency(step3Text, step1Ids.hazardIds, step2Ids.controlActionIds);
    assertStep4Consistency(step4Text, step3Ids.ucaIds, step1Ids.hazardIds, step1Ids.lossIds);

    expect({
      step1: step1Text,
      step2: step2Text,
      step3: step3Text,
      step4: step4Text,
    }).toMatchSnapshot(fixture.name);
  });
});
