export type RoomDocumentSaveRequest = {
  organizationId: string;
  roomId: string;
  waitUntil: (save: Promise<void>) => void;
};

/** Only room document editors participate; local File previews never register. */
export async function flushRoomDocuments(organizationId: string, roomId: string) {
  const saves: Promise<void>[] = [];
  window.dispatchEvent(new window.CustomEvent<RoomDocumentSaveRequest>('room-document-save', {
    detail: { organizationId, roomId, waitUntil: (save) => saves.push(save) },
  }));
  // Let every save settle before either starting work or reporting a failure.
  const results = await Promise.allSettled(saves);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}
