jest.mock('openai');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useDefaultLlmMock } = require('./llmMock');

beforeEach(() => {
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = 'test-key';
  }
  useDefaultLlmMock();
});
