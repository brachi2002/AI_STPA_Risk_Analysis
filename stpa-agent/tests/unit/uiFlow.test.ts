import { buildStagePayload, getActionsForStage, INITIAL_STATE, reduceFlowState, UiStage } from '../../src/uiFlow';

describe('UI flow state machine', () => {
  const allStages: UiStage[] = [
    'welcome',
    'afterStep1',
    'afterStep2',
    'afterStep3',
    'afterStep4',
    'confirmJumpGuidedFile',
    'jumpMissingSteps',
    'jumpTargetExists',
    'timeout',
    'errorFallback',
  ];

  it('returns at least one action per stage', () => {
    allStages.forEach((stage) => {
      const actions = getActionsForStage(stage, { missingStep: 2, targetStep: 3 });
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.every((a) => typeof a.label === 'string' && a.label.length > 0)).toBe(true);
    });
  });

  it('builds payloads that keep stage and actions in sync', () => {
    const payload = buildStagePayload('afterStep2');
    expect(payload.stage).toBe('afterStep2');
    expect(payload.actions.length).toBeGreaterThan(0);
    expect(payload).toMatchObject({
      stage: 'afterStep2',
      actions: getActionsForStage('afterStep2'),
    });
  });

  it('reducer transitions keep actions available', () => {
    const updated = reduceFlowState(INITIAL_STATE, { type: 'setStage', stage: 'afterStep3' });
    expect(updated.stage).toBe('afterStep3');
    expect(updated.actions.length).toBeGreaterThan(0);
  });

  it('jump stage respects context in labels', () => {
    const actions = getActionsForStage('jumpMissingSteps', { missingStep: 2, targetStep: 4 });
    expect(actions[0].label).toMatch(/Step 2/);
  });

  it('guided stages do not surface reset buttons', () => {
    const regularStages: UiStage[] = [
      'welcome',
      'afterStep1',
      'afterStep2',
      'afterStep3',
      'afterStep4',
      'confirmJumpGuidedFile',
      'jumpMissingSteps',
      'jumpTargetExists',
    ];
    regularStages.forEach((stage) => {
      const actions = getActionsForStage(stage);
      expect(actions.some((a) => a.action === 'reset')).toBe(false);
    });
  });

  it('timeout and error fallback stages keep reset as a secondary action', () => {
    ['timeout', 'errorFallback'].forEach((stage) => {
      const actions = getActionsForStage(stage as UiStage);
      expect(actions.some((a) => a.action === 'reset')).toBe(true);
    });
  });
});
