"use client";

import { Editor, Extension, wrappingInputRule } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import { Plugin } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';

export type RoomChatEditorHandle = { focus: () => void };
type Props = {
  ref: Ref<RoomChatEditorHandle>;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent, inList: boolean) => void;
  attributes: Record<string, string>;
};

const ChatLists = Extension.create({
  name: 'chatLists',
  addInputRules() {
    return [wrappingInputRule({
      find: /^(\d{1,9})[.)]\s$/,
      type: this.editor.schema.nodes.orderedList,
      getAttributes: match => ({ start: Number(match[1]) }),
      joinPredicate: (match, node) => node.childCount + node.attrs.start === Number(match[1]),
    })];
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      filterTransaction(transaction, state) {
        if (!transaction.docChanged) return true;
        const length = editor.markdown?.serialize(transaction.doc.toJSON()).length ?? 0;
        return length <= 20000 || length < (editor.markdown?.serialize(state.doc.toJSON()).length ?? 0);
      },
    })];
  },
});

export function RoomChatEditor({ ref, ...props }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; });
  useImperativeHandle(ref, () => ({ focus: () => { editor.current?.commands.focus(); } }), []);

  useEffect(() => {
    const instance = new Editor({
      element: host.current!,
      extensions: [StarterKit.configure({
        // Keep chat focused on text and lists; links never navigate while editing.
        link: false, underline: false, heading: false, horizontalRule: false,
        codeBlock: false, blockquote: false, trailingNode: false,
      }), Markdown.configure({ markedOptions: { breaks: true } }), ChatLists],
      content: latest.current.value,
      contentType: 'markdown',
      editorProps: {
        handleDOMEvents: {
          // Leave IME confirmation to the browser before list keymaps see Enter.
          keydown: (_view, event) => event.isComposing,
        },
        attributes: {
          ...latest.current.attributes,
          class: 'room-chat-editable',
          'data-slot': 'input-group-control',
          'aria-multiline': 'true',
        },
        handleKeyDown(_view, event) {
          if (event.isComposing) return false;
          latest.current.onKeyDown(event, instance.isActive('listItem'));
          return event.defaultPrevented;
        },
        handlePaste(_view, event) {
          // Pasted text may contain Markdown, but rich clipboard HTML is never inserted.
          const text = event.clipboardData?.getData('text/plain');
          if (!text) return false;
          event.preventDefault();
          instance.commands.insertContent(text, { contentType: 'markdown' });
          return true;
        },
      },
      onUpdate({ editor: current }) { latest.current.onChange(current.getMarkdown()); },
      onTransaction({ editor: current }) {
        current.view.dom.dataset.empty = String(current.isEmpty && !current.isActive('listItem'));
      },
    });
    editor.current = instance;
    instance.view.dom.dataset.empty = String(instance.isEmpty);
    return () => { editor.current = null; instance.destroy(); };
  }, []);

  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    if (instance.getMarkdown() !== props.value) {
      instance.commands.setContent(props.value, { contentType: 'markdown', emitUpdate: false });
      instance.commands.setTextSelection(instance.state.doc.content.size - 1);
    }
    instance.setOptions({ editorProps: { ...instance.options.editorProps, attributes: {
      ...props.attributes,
      class: 'room-chat-editable',
      'data-slot': 'input-group-control',
      'aria-multiline': 'true',
    } } });
  }, [props.value, props.attributes]);

  return <div className="room-chat-editor" ref={host} />;
}
