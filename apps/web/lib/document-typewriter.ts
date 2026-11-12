import type { DocumentPreview } from '../../../shared/document-preview';

/** Reveal only a prefix of sequential edits: later offsets depend on earlier
 * insertions being complete. Recompute each frame from the saved document. */
export function documentPreviewPrefix(draft: DocumentPreview, characters: number): DocumentPreview {
  let remaining = Math.floor(characters);
  const edits: DocumentPreview['edits'] = [];
  for (const edit of draft.edits) {
    if (remaining < edit.text.length) {
      // Do not split a UTF-16 surrogate pair while typing emoji/non-Latin text.
      let end = remaining;
      if (end && /[\uD800-\uDBFF]/.test(edit.text[end - 1])) end--;
      edits.push({ ...edit, text: edit.text.slice(0, end) });
      break;
    }
    edits.push(edit);
    remaining -= edit.text.length;
  }
  return { ...draft, edits };
}

/** The network supplies cumulative targets; animation owns the visible pace. */
export class DocumentTypewriter {
  private target: DocumentPreview | null = null;
  private characters = 0;
  private frame: number | null = null;
  private previousTime: number | null = null;
  private waiters: (() => void)[] = [];
  private cancelled = false;

  constructor(private publish: (draft: DocumentPreview) => void, private scheduler = {
    request: (callback: FrameRequestCallback) => requestAnimationFrame(callback),
    cancel: (id: number) => cancelAnimationFrame(id),
  }) {}

  update(draft: DocumentPreview) {
    if (this.cancelled) return;
    this.target = draft;
    if (this.frame === null) this.frame = this.scheduler.request(this.tick);
  }

  finish(): Promise<void> {
    if (this.cancelled || this.frame === null) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  cancel() {
    this.cancelled = true;
    if (this.frame !== null) this.scheduler.cancel(this.frame);
    this.frame = null;
    this.resolve();
  }

  private resolve() { for (const resolve of this.waiters.splice(0)) resolve(); }

  private tick = (time: number) => {
    this.frame = null;
    if (this.cancelled || !this.target) return;
    const total = this.target.edits.reduce((sum, edit) => sum + edit.text.length, 0);
    const elapsed = this.previousTime === null ? 16 : Math.min(100, Math.max(0, time - this.previousTime));
    this.previousTime = time;
    // Keep a measured typing pace, with gentle catch-up for buffered responses.
    const speed = Math.max(65, Math.min(140, (total - this.characters) / 4));
    this.characters = Math.min(total, this.characters + elapsed * speed / 1000);
    this.publish(documentPreviewPrefix(this.target, this.characters));
    if (this.characters < total) this.frame = this.scheduler.request(this.tick);
    else { this.previousTime = null; this.resolve(); }
  };
}
