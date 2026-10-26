import { MAX_LOCAL_FILES, type LocalRoomFile } from './local-room-files';

export type RoomFileState = {
  files: LocalRoomFile[];
  selectedId?: string;
  visitedIds: string[];
  openIds: string[];
  uploadOpen: boolean;
  error: string;
};
export type RoomFileAction =
  | { type: 'select'; id: string }
  | { type: 'add'; entries: LocalRoomFile[] }
  | { type: 'close'; id: string }
  | { type: 'remove'; id: string; fallbackId?: string }
  | { type: 'upload-dialog'; open: boolean }
  | { type: 'upload-error'; message: string };

export function initialRoomFileState(selectedId?: string): RoomFileState {
  return { files: [], selectedId, visitedIds: selectedId ? [selectedId] : [], openIds: selectedId ? [selectedId] : [], uploadOpen: false, error: '' };
}

function select(state: RoomFileState, selectedId?: string): RoomFileState {
  return { ...state, selectedId, openIds: selectedId && !state.openIds.includes(selectedId) ? [...state.openIds, selectedId] : state.openIds, visitedIds: selectedId && !state.visitedIds.includes(selectedId) ? [...state.visitedIds, selectedId] : state.visitedIds };
}

// IDs are generated before dispatch. The reducer is pure and always validates
// against the latest file list, including when React batches multiple uploads.
export function roomFileReducer(state: RoomFileState, action: RoomFileAction): RoomFileState {
  switch (action.type) {
    case 'select': return select(state, action.id);
    case 'close': {
      const index = state.openIds.indexOf(action.id);
      if (index < 0) return state;
      const openIds = state.openIds.filter((id) => id !== action.id);
      return { ...state, openIds, selectedId: state.selectedId === action.id ? openIds[Math.min(index, openIds.length - 1)] : state.selectedId };
    }
    case 'upload-dialog': return { ...state, uploadOpen: action.open, error: '' };
    case 'upload-error': return { ...state, error: action.message };
    case 'add': {
      const entries = action.entries.filter((entry) => !state.files.some((file) => file.id === entry.id));
      if (!entries.length) return state;
      if (state.files.length + entries.length > MAX_LOCAL_FILES) {
        return { ...state, error: `Keep up to ${MAX_LOCAL_FILES} local files in this room at a time.` };
      }
      return select({ ...state, files: [...state.files, ...entries], openIds: [...state.openIds, ...entries.map((entry) => entry.id).filter((id) => !state.openIds.includes(id))], uploadOpen: false, error: '' }, entries[0].id);
    }
    case 'remove': {
      const index = state.files.findIndex((file) => file.id === action.id);
      if (index < 0) return state;
      const files = state.files.filter((file) => file.id !== action.id);
      const next = { ...state, files, openIds: state.openIds.filter((id) => id !== action.id), visitedIds: state.visitedIds.filter((id) => id !== action.id) };
      return state.selectedId === action.id ? select(next, files[Math.min(index, files.length - 1)]?.id ?? action.fallbackId) : next;
    }
  }
}
