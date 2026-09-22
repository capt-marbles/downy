import { vi } from "vitest";

// Mock handles shared by the VoiceCall test files. Kept free of imports so a
// vi.mock factory can load this module without pulling in the coordinator.
export const mocks = {
  create: vi.fn(),
  attach: vi.fn(),
  lookup: vi.fn(),
  lookupResult: vi.fn(),
  transcript: vi.fn(),
};
