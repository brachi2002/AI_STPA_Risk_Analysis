type ChatRequest = {
  model: string;
  temperature?: number;
  messages: { role: string; content: string }[];
};

type ChatResponse = { content: string };

let handler: (req: ChatRequest) => Promise<ChatResponse> | ChatResponse = async (req) => ({
  content: req.messages?.[0]?.content || '',
});

export function __setMockHandler(next: typeof handler) {
  handler = next;
}

export function __resetMockHandler() {
  handler = async (req) => ({ content: req.messages?.[0]?.content || '' });
}

export default class OpenAI {
  apiKey: string;
  chat: {
    completions: {
      create: (req: ChatRequest) => Promise<{ choices: { message: { content: string } }[] }>;
    };
  };

  constructor(opts: { apiKey: string }) {
    this.apiKey = opts.apiKey;
    this.chat = {
      completions: {
        create: async (req: ChatRequest) => {
          const res = await handler(req);
          return { choices: [{ message: { content: res.content } }] };
        },
      },
    };
  }
}

(OpenAI as any).__setMockHandler = __setMockHandler;
(OpenAI as any).__resetMockHandler = __resetMockHandler;
