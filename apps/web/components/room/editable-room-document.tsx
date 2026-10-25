"use client";

import { memo } from "react";

// Keep the browser in charge of the editable DOM so chat updates never reset
// the document or move the cursor while someone is typing.
export const EditableRoomDocument = memo(function EditableRoomDocument({
  initialContent,
  onChange,
}: {
  initialContent: string;
  onChange: (value: string) => void;
}) {
  function captureContent(element: HTMLDivElement) {
    const content = Array.from(element.childNodes)
      .map((node) => {
        if (!(node instanceof HTMLElement)) return node.textContent ?? "";
        const text = node.innerText;
        if (node.tagName === "H2") return `# ${text}`;
        if (node.tagName === "H3") return `## ${text}`;
        if (node.tagName === "UL" || node.tagName === "OL") {
          return Array.from(node.children)
            .map(
              (item, index) =>
                `${node.tagName === "OL" ? `${index + 1}.` : "•"} ${(item as HTMLElement).innerText}`,
            )
            .join("\n");
        }
        return text;
      })
      .join("\n\n");
    onChange(content);
  }
  return (
    <div
      id="document-editor"
      className="room-document-prose room-document-canvas"
      role="textbox"
      aria-label="Document content"
      aria-multiline="true"
      aria-describedby="document-editing-help"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck
      onInput={(event) => captureContent(event.currentTarget)}
    >
      {initialContent.split("\n\n").map((block, index) =>
        block.startsWith("# ") ? (
          <h2 key={index}>{block.slice(2)}</h2>
        ) : block.startsWith("## ") ? (
          <h3 key={index}>{block.slice(3)}</h3>
        ) : /^\d+\. /.test(block) ? (
          <ol key={index}>
            {block.split("\n").map((line, lineIndex) => (
              <li key={lineIndex}>{line.replace(/^\d+\. /, "")}</li>
            ))}
          </ol>
        ) : block.startsWith("• ") ? (
          <ul key={index}>
            {block.split("\n").map((line, lineIndex) => (
              <li key={lineIndex}>{line.slice(2)}</li>
            ))}
          </ul>
        ) : (
          <p key={index}>{block}</p>
        ),
      )}
    </div>
  );
});
