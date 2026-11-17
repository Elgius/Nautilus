"use client";

import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const RoomMessageText = memo(function RoomMessageText({ text, className = '' }: { text: string; className?: string }) {
  return <div className={`room-message-text ${className}`}>
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({ href, title, children }) => href ? <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      // Display descriptions without fetching URLs supplied in messages.
      img: ({ alt }) => <span>{alt}</span>,
      table: ({ children }) => <div className="room-private-table"><table>{children}</table></div>,
    }}>{text}</Markdown>
  </div>;
});
