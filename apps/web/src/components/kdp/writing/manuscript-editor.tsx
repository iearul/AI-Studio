"use client";

import {
  manuscriptToRichText,
  richTextToManuscript,
  type RichTextNode,
} from "@ai-film-studio/book-engine";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, Redo2, SeparatorHorizontal, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";

export type SelectionInfo = {
  from: number;
  to: number;
  markup: string;
  words: number;
};

/**
 * WYSIWYG manuscript editor limited to what a novel needs: paragraphs,
 * italics, bold, hard line breaks and scene breaks. Content goes in and out
 * as manuscript markup, so storage and exports never see editor internals.
 */
export function ManuscriptEditor({
  initialMarkup,
  editable,
  onChange,
  onSelection,
  onReady,
  onSave,
}: {
  initialMarkup: string;
  editable: boolean;
  onChange: (markup: string) => void;
  onSelection: (selection: SelectionInfo | null) => void;
  onReady: (editor: Editor) => void;
  onSave: () => void;
}) {
  // The editor is created once; callbacks are read through refs so they stay current.
  const callbacks = useRef({ onChange, onSelection, onSave });
  useEffect(() => {
    callbacks.current = { onChange, onSelection, onSave };
  }, [onChange, onSelection, onSave]);
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        link: false,
      }),
    ],
    content: manuscriptToRichText(initialMarkup),
    editorProps: {
      attributes: {
        class: "kdp-prose",
        "aria-label": "Chapter text",
        spellcheck: "true",
      },
      handleKeyDown: (_view, event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          callbacks.current.onSave();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      callbacks.current.onChange(
        richTextToManuscript(current.getJSON() as RichTextNode),
      );
    },
    onSelectionUpdate: ({ editor: current }) => {
      const { from, to, empty } = current.state.selection;
      if (empty) {
        callbacks.current.onSelection(null);
        return;
      }
      const slice = current.state.doc.slice(from, to).content.toJSON() as
        RichTextNode[] | null;
      const markup = richTextToManuscript({
        type: "doc",
        content: wrapInline(slice ?? []),
      });
      const text = current.state.doc.textBetween(from, to, " ");
      callbacks.current.onSelection({
        from,
        to,
        markup,
        words: text.split(/\s+/).filter(Boolean).length,
      });
    },
  });

  useEffect(() => {
    if (editor) onReady(editor);
  }, [editor, onReady]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  if (!editor)
    return <div className="kdp-prose kdp-prose-loading" aria-busy="true" />;
  const button = (
    label: string,
    active: boolean,
    action: () => void,
    icon: React.ReactNode,
    shortcut?: string,
  ) => (
    <button
      type="button"
      className={active ? "active" : ""}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={!editable}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
    >
      {icon}
    </button>
  );
  return (
    <div className="kdp-editor">
      <div
        className="kdp-editor-toolbar"
        role="toolbar"
        aria-label="Formatting"
      >
        {button(
          "Italic",
          editor.isActive("italic"),
          () => editor.chain().focus().toggleItalic().run(),
          <Italic size={15} />,
          "⌘I",
        )}
        {button(
          "Bold",
          editor.isActive("bold"),
          () => editor.chain().focus().toggleBold().run(),
          <Bold size={15} />,
          "⌘B",
        )}
        {button(
          "Scene break",
          false,
          () => editor.chain().focus().setHorizontalRule().run(),
          <SeparatorHorizontal size={15} />,
        )}
        <span className="kdp-toolbar-gap" />
        {button(
          "Undo",
          false,
          () => editor.chain().focus().undo().run(),
          <Undo2 size={15} />,
          "⌘Z",
        )}
        {button(
          "Redo",
          false,
          () => editor.chain().focus().redo().run(),
          <Redo2 size={15} />,
          "⇧⌘Z",
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

/** A selection inside one paragraph comes back as bare text nodes. */
function wrapInline(nodes: RichTextNode[]): RichTextNode[] {
  return nodes.every(
    (node) => node.type === "text" || node.type === "hardBreak",
  )
    ? [{ type: "paragraph", content: nodes }]
    : nodes;
}

/** Replaces a range with manuscript markup, keeping inline replacements inline. */
export function replaceRange(
  editor: Editor,
  from: number,
  to: number,
  markup: string,
): void {
  const doc = manuscriptToRichText(markup);
  const blocks = doc.content ?? [];
  const content =
    blocks.length === 1 && blocks[0]!.type === "paragraph"
      ? (blocks[0]!.content ?? [])
      : blocks;
  editor.chain().focus().insertContentAt({ from, to }, content).run();
}
