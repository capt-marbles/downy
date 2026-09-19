export class CodexBridge {
  constructor(home: string, binary?: string);
  initialize(): Promise<void>;
  account(): Promise<{ authenticated: boolean }>;
  login(): Promise<{ verificationUrl: string; userCode: string }>;
  step(input: {
    model: string;
    system: string;
    transcript: string;
    tools: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }[];
  }): Promise<{
    text: string;
    toolCalls: { id: string; name: string; arguments: string }[];
  }>;
  close(): void;
}
