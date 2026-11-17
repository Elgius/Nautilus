"use client";

import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { HubCitation } from '../../../../shared/room-chat';
import { InlineCitationLink } from '@/components/ai-elements/inline-citation';

export const RoomMessageText = memo(function RoomMessageText({ text, className = '', citations }: { text: string; className?: string; citations?: HubCitation[] }) {
  return <div className={`room-message-text ${className}`}>
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({ href, title, children }) => {
        if (citations && href?.startsWith('#source-')) {
          const citation = citations.find((item) => item.sourceId === href.slice(8));
          return citation ? <InlineCitationLink href={citation.url} title={citation.title} quote={citation.quote} locator={citation.locator} version={citation.documentVersionId} number={citation.number}>{children}</InlineCitationLink> : <span>{children}</span>;
        }
        return href ? <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
      },
      // Display descriptions without fetching URLs supplied in messages.
      img: ({ alt }) => <span>{alt}</span>,
      table: ({ children }) => <div className="room-private-table"><table>{children}</table></div>,
    }}>{text}</Markdown>
  </div>;
});
