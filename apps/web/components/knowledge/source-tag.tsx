"use client";

import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { knowledgeRequest, type KnowledgeScope } from '@/lib/knowledge-client';
import { errorMessage } from '@/lib/auth-client';

export function KnowledgeSourceTag({ organizationId, roomId, documentId, messageId, disabled = false }: {
  organizationId: string; roomId: string; documentId?: string; messageId?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false), [scope, setScope] = useState<KnowledgeScope>('PERSONAL');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  async function tag() {
    setBusy(true); setError('');
    try {
      await knowledgeRequest(organizationId, '/sources', 'POST', { scope, roomId, ...(documentId ? { documentId } : { messageId }) });
      setNotice(`Tagged for ${scope === 'PERSONAL' ? 'Personal' : 'Organization'} Knowledge.`); setOpen(false);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <>
    <Button variant="ghost" size="sm" disabled={disabled} aria-label={`Tag ${documentId ? 'document' : 'message'} for Knowledge`} title={notice || 'Tag for the Knowledge agent'} onClick={() => { setError(''); setOpen(true); }}><BookOpen size={14} /><span>Knowledge</span></Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Tag for Knowledge</DialogTitle><DialogDescription>
        {documentId ? 'Allow the Knowledge agent to read this saved document and its future saved versions.' : 'Allow the Knowledge agent to read this message only. Other messages and linked documents are excluded.'}
      </DialogDescription></DialogHeader>
        <label className="grid gap-2 text-sm font-medium">Knowledge bucket
          <select className="rounded-md border bg-background p-2" value={scope} onChange={(event) => setScope(event.target.value as KnowledgeScope)} disabled={busy}>
            <option value="PERSONAL">Personal — only you</option><option value="ORGANIZATION">Organization — everyone in this organization</option>
          </select>
        </label>
        <p className="text-sm text-muted-foreground">{scope === 'PERSONAL' ? 'Findings stay private to you in this organization.' : 'You are approving this source for organization-wide knowledge. You must be a room owner or an organization admin with room access.'} The agent checks every 6 hours and after saved source changes. Manage tags in Knowledge.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button disabled={busy} onClick={tag}>{busy ? 'Tagging…' : scope === 'PERSONAL' ? 'Tag for Personal Knowledge' : 'Approve and tag for Organization'}</Button>
      </DialogContent>
    </Dialog>
    {notice && <span role="status" className="sr-only">{notice}</span>}
  </>;
}
