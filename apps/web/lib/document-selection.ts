export const MAX_SELECTION_TEXT = 6000;

export type OfficeSelection = {
  text: string;
  location: string;
  truncated?: boolean;
};

export type DocumentSelection = OfficeSelection & {
  documentId: string;
  title: string;
  versionId: string | null;
};

// Use the existing text transport so quotes survive retries and chat history.
// Locations describe a captured snapshot, never an instruction to edit offsets blindly.
export function withDocumentSelection(message: string, selection?: DocumentSelection | null, includeReference = false) {
  if (!selection) return message;
  const source = `${selection.title} · ${selection.location}`;
  const reference = includeReference ? `\nDocument reference: ${JSON.stringify({ documentId: selection.documentId, versionId: selection.versionId })}` : '';
  const quote = `${source}${reference}\n\n${selection.text}`.replace(/\r\n?|\u2028|\u2029/g, '\n').split('\n').map((line) => `> ${line}`).join('\n');
  const label = includeReference ? 'Selected excerpt (snapshot; verify against the current document before editing)' : 'Selected excerpt';
  return `${message.trim()}\n\n${label}:\n${quote}${selection.truncated ? '\n> [Selection truncated]' : ''}`;
}
