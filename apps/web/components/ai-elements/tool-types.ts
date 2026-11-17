// UI state contract shared by the AI Elements adapters; no server SDK bundled in the browser.
export type ToolUIPart = { type: `tool-${string}`; state: 'approval-requested' | 'approval-responded' | 'input-available' | 'input-streaming' | 'output-available' | 'output-denied' | 'output-error' };
export type DynamicToolUIPart = { type: 'dynamic-tool'; state: ToolUIPart['state'] };
