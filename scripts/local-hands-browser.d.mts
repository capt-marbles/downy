import type { z } from "zod";
import type { BrowserResearchSchema } from "../src/lib/browser-research";

type BrowserAction = {
  kind: string;
  riskLevel: string;
  targetConnectorId?: string;
  input: Record<string, unknown>;
};
type BrowserOptions = {
  connectorId?: string;
  expectedAccount?: string;
  allowedHosts?: string[];
  asideBin?: string;
  env?: NodeJS.ProcessEnv;
  run?: (
    bin: string,
    args: string[],
    options: {
      timeout: number;
      killSignal: string;
      maxBuffer: number;
      env: NodeJS.ProcessEnv;
    },
  ) => Promise<{ stdout: string }>;
};
export function browserRequest(
  action: BrowserAction,
  options?: BrowserOptions,
): {
  operation: "x_search" | "read_page";
  query?: string;
  url: string;
  maxResults: number;
  expectedAccount: string | null;
};
export function executeBrowserResearch(
  action: BrowserAction,
  options?: BrowserOptions,
): Promise<z.infer<typeof BrowserResearchSchema>>;
