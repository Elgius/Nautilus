// Browser-local files deliberately have no object key, server document ID, or
// upload side effects. A future storage action must be explicit and separate.
export const MAX_LOCAL_FILES = 20;
export const MAX_LOCAL_FILE_BYTES = 10 * 1024 * 1024;

export type LocalRoomFile = {
  id: string;
  source: 'local';
  file: File;
};

export function isLocalRoomFileId(id?: string): boolean {
  return !!id?.startsWith('local:');
}

export function addLocalRoomFiles(previous: LocalRoomFile[], files: File[]): LocalRoomFile[] {
  if (previous.length + files.length > MAX_LOCAL_FILES) throw new Error(`Keep up to ${MAX_LOCAL_FILES} local files in this room at a time.`);
  if (files.some((file) => !file.size)) throw new Error('Choose non-empty files.');
  if (files.some((file) => file.size > MAX_LOCAL_FILE_BYTES)) throw new Error('Choose files up to 10 MB each.');
  return [...previous, ...files.map((file) => ({ id: `local:${crypto.randomUUID()}`, source: 'local' as const, file }))];
}

export function localPreviewType(file: Pick<File, 'name' | 'type'>): 'text' | 'image' | 'pdf' | 'download' {
  if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name) && /^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type)) return 'image';
  if (/\.pdf$/i.test(file.name) && (!file.type || file.type === 'application/pdf')) return 'pdf';
  if (/\.(txt|md|csv|tsv|json|log|xml|html?|css|js|ts|yaml|yml)$/i.test(file.name) || /^text\//.test(file.type)) return 'text';
  return 'download';
}
