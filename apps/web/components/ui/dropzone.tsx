'use client';

import { useId, useState } from 'react';
import { useDropzone, type Accept } from 'react-dropzone';
import { FileUp, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function Dropzone({ accept, description, disabled, busy, onFile, onFiles, maxFiles = 1 }: {
  accept?: Accept; description: string; disabled?: boolean; busy?: boolean;
  maxFiles?: number;
} & ({ onFile: (file: File) => Promise<void>; onFiles?: never } | {
  onFiles: (files: File[]) => Promise<void>; onFile?: never;
})) {
  const id = useId();
  const [error, setError] = useState('');
  const { getRootProps, getInputProps, isDragActive, isDragReject, open } = useDropzone({
    accept, maxFiles, multiple: maxFiles > 1, maxSize: 10 * 1024 * 1024, minSize: 1,
    disabled: disabled || busy, noClick: true, noKeyboard: true,
    onDrop: (files, rejections) => {
      setError('');
      if (rejections.length) {
        const code = rejections[0].errors[0].code;
        setError(code === 'file-too-large' ? 'Choose files up to 10 MB each.' : code === 'too-many-files' ? `Choose up to ${maxFiles} ${maxFiles === 1 ? 'file' : 'files'} at a time.` : code === 'file-too-small' ? 'One of these files is empty.' : `Choose ${description}.`);
        return;
      }
      if (files.length && onFiles) void onFiles(files);
      else if (files[0] && onFile) void onFile(files[0]);
    },
  });
  return <div data-slot="dropzone" className="space-y-2">
    <div {...getRootProps({
      role: 'group', 'aria-label': 'File upload', 'aria-describedby': `${id}-description`, 'aria-busy': busy,
      className: cn('flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border bg-muted/30 p-8 text-center transition-colors',
        isDragActive && 'border-primary bg-primary/5', isDragReject && 'border-destructive bg-destructive/5', (disabled || busy) && 'opacity-60'),
    })}>
      <input {...getInputProps({ 'aria-label': maxFiles > 1 ? 'Choose files from your computer' : 'Choose a file to import' })} />
      {busy ? <LoaderCircle className="size-8 animate-spin text-muted-foreground" /> : <FileUp className="size-8 text-muted-foreground" />}
      <div><p className="font-medium">{busy ? 'Opening your files…' : isDragActive ? 'Drop files here' : 'Drag and drop files here'}</p>
        <p id={`${id}-description`} className="mt-1 text-xs text-muted-foreground">{description} · {maxFiles === 1 ? 'One file' : `Up to ${maxFiles} files`}, 10 MB each</p></div>
      <Button type="button" variant="outline" onClick={open} disabled={disabled || busy}>Browse files</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
