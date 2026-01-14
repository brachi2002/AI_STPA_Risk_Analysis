export type UiStage =
  | 'welcome'
  | 'afterStep1'
  | 'afterStep2'
  | 'afterStep3'
  | 'afterStep4'
  | 'confirmJumpGuidedFile'
  | 'jumpMissingSteps'
  | 'jumpTargetExists'
  | 'timeout'
  | 'errorFallback';

export interface FlowAction {
  label: string;
  action: string;
  secondary?: boolean;
  payload?: Record<string, unknown>;
}

export interface StageContext {
  missingStep?: number;
  targetStep?: number;
  lastFound?: number;
}

interface StageFactory {
  (context?: StageContext): FlowAction[];
}

const escapeAction = (): FlowAction => ({
  label: 'Reset to start',
  action: 'reset',
  secondary: true,
});

const cloneAction = (action: FlowAction): FlowAction => ({
  label: action.label,
  action: action.action,
  secondary: action.secondary,
  payload: action.payload ? { ...action.payload } : undefined,
});

const cloneActions = (actions: FlowAction[]): FlowAction[] => actions.map((action) => cloneAction(action));

const withEscapeAction = (actions: FlowAction[]): FlowAction[] => {
  const cloned = cloneActions(actions);
  cloned.push(escapeAction());
  return cloned;
};

const stageFactories: Record<UiStage, StageFactory> = {
  welcome: () =>
    cloneActions([
      { label: 'Start guided STPA (Step 1)', action: 'startStep1' },
      { label: 'Jump to a specific step', action: 'openJumpMenu', secondary: true },
    ]),
  afterStep1: () =>
    cloneActions([
      { label: 'Approve Step 1 and continue to Step 2', action: 'continueStep2' },
      { label: 'Edit Step 1', action: 'editCurrentStep', secondary: true },
    ]),
  afterStep2: () =>
    cloneActions([
      { label: 'Approve Step 2 and continue to Step 3', action: 'continueStep3' },
      { label: 'Edit Step 2', action: 'editCurrentStep', secondary: true },
    ]),
  afterStep3: () =>
    cloneActions([
      { label: 'Approve Step 3 and continue to Step 4', action: 'continueStep4' },
      { label: 'Edit Step 3', action: 'editCurrentStep', secondary: true },
    ]),
  afterStep4: () =>
    cloneActions([{ label: 'Edit Step 4', action: 'editCurrentStep', secondary: true }]),
  confirmJumpGuidedFile: () =>
    cloneActions([
      { label: 'Confirm guided file', action: 'confirmJumpGuidedFile' },
      { label: 'Back to step menu', action: 'openJumpMenu', secondary: true },
    ]),
  jumpMissingSteps: (context?: StageContext) => {
    const missing = context?.missingStep ?? 2;
    const contAction =
      missing === 1 ? 'startStep1' : missing === 2 ? 'continueStep2' : 'continueStep3';
    return cloneActions([
      { label: `Continue from Step ${missing}`, action: contAction },
      { label: 'Confirm guided file', action: 'confirmJumpGuidedFile', secondary: true },
      { label: 'Back to step menu', action: 'openJumpMenu', secondary: true },
    ]);
  },
  jumpTargetExists: (context?: StageContext) => {
    const target = context?.targetStep ?? 2;
    return cloneActions([
      {
        label: `Open Step ${target} in the guided file`,
        action: 'jumpOpenExistingStep',
        payload: { targetStep: target },
      },
      {
        label: `Edit Step ${target}`,
        action: 'jumpEditTargetStep',
        payload: { targetStep: target },
        secondary: true,
      },
      { label: 'Back to step menu', action: 'openJumpMenu', secondary: true },
    ]);
  },
  timeout: () =>
    withEscapeAction([{ label: 'Retry last operation', action: 'retryWatchdog' }]),
  errorFallback: () =>
    withEscapeAction([{ label: 'Retry last operation', action: 'retryWatchdog' }]),
};

export function getActionsForStage(stage: UiStage, context?: StageContext): FlowAction[] {
  const factory = stageFactories[stage];
  if (!factory) {
    return withEscapeAction([]);
  }
  return factory(context);
}

export interface FlowState {
  stage: UiStage;
  actions: FlowAction[];
}

export const INITIAL_STATE: FlowState = {
  stage: 'welcome',
  actions: getActionsForStage('welcome'),
};

export type FlowEvent =
  | { type: 'setStage'; stage: UiStage; context?: StageContext }
  | { type: 'reset' };

export function reduceFlowState(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'setStage':
      return {
        stage: event.stage,
        actions: getActionsForStage(event.stage, event.context),
      };
    case 'reset':
      return INITIAL_STATE;
    default:
      return state;
  }
}

export interface StagePayload {
  stage: UiStage;
  actions: FlowAction[];
}

export function buildStagePayload(stage: UiStage, context?: StageContext): StagePayload {
  return {
    stage,
    actions: getActionsForStage(stage, context),
  };
}
