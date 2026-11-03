import { parseAvatarDesign, type AvatarDesign } from '../../../shared/avatar-design';

export type { AvatarDesign } from '../../../shared/avatar-design';

export class AvatarGenerationError extends Error {
  constructor(message: string, readonly quotaExhausted: boolean, readonly retryAfterSeconds?: number) { super(message); }
}

export async function generateAvatarPreview(organizationId: string, description: string, signal: AbortSignal): Promise<AvatarDesign> {
  const response = await fetch(`/api/organizations/${encodeURIComponent(organizationId)}/avatar-preview`, {
    method: "POST", credentials: "include", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const retryAfter = result?.retryAfterSeconds;
    throw new AvatarGenerationError(
      result?.error || "Couldn’t generate this avatar. Please try again.",
      response.status === 429 && result?.code === 'quota_exhausted',
      response.status === 429 && typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 7 * 86400 ? retryAfter : undefined,
    );
  }
  try { return parseAvatarDesign(result?.avatar); }
  catch { throw new Error("The generated avatar was invalid. Please try again."); }
}
