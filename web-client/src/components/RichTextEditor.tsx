// ./components/RichTextEditor.tsx
// Lightweight WYSIWYG editor (TipTap) used for composing HTML bodies from a
// ticket. Emits HTML via onChange; the backend sanitizes before send + store.
import React, { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Box, ToggleButton, ToggleButtonGroup, Divider, Tooltip, TextField } from "@mui/material";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatUnderlinedIcon from "@mui/icons-material/FormatUnderlined";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";
import LinkIcon from "@mui/icons-material/Link";
import CodeIcon from "@mui/icons-material/Code";
import TextFieldsIcon from "@mui/icons-material/TextFields";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  minHeight?: number;
  /** When set, pasted/dropped images are uploaded via this handler and inserted
   *  by the returned URL (e.g. an attachment download URL). */
  onImageUpload?: (file: File) => Promise<string>;
  allowSource?: boolean;
}

type EditorMode = "visual" | "source";

function Toolbar({
  editor,
  mode,
  onModeChange,
  allowSource,
}: {
  editor: Editor;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  allowSource: boolean;
}) {
  if (!editor) return null;

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return; // cancelled
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, p: 0.5, borderBottom: 1, borderColor: "divider" }}>
      {mode === "visual" && (
        <>
          <ToggleButtonGroup size="small">
            <ToggleButton value="bold" selected={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
              <Tooltip title="Bold"><FormatBoldIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="italic" selected={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
              <Tooltip title="Italic"><FormatItalicIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="strike" selected={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
              <Tooltip title="Strikethrough"><FormatUnderlinedIcon fontSize="small" /></Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
          <Divider orientation="vertical" flexItem />
          <ToggleButtonGroup size="small">
            <ToggleButton value="bullet" selected={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
              <Tooltip title="Bulleted list"><FormatListBulletedIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="ordered" selected={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
              <Tooltip title="Numbered list"><FormatListNumberedIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="quote" selected={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
              <Tooltip title="Quote"><FormatQuoteIcon fontSize="small" /></Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
          <Divider orientation="vertical" flexItem />
          <ToggleButton size="small" value="link" selected={editor.isActive("link")} onClick={setLink}>
            <Tooltip title="Insert link"><LinkIcon sx={{
              fontSize: "small"
            }} /></Tooltip>
          </ToggleButton>
        </>
      )}
      {allowSource && (
        <>
          <Box sx={{ flexGrow: 1 }} />
          <ToggleButtonGroup
            size="small"
            exclusive
            value={mode}
            onChange={(_event, next) => next && onModeChange(next)}
          >
            <ToggleButton value="visual">
              <Tooltip title="Formatted editor"><TextFieldsIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="source">
              <Tooltip title="HTML source"><CodeIcon fontSize="small" /></Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
        </>
      )}
    </Box>
  );
}

const RichTextEditor: React.FC<RichTextEditorProps> = ({ value, onChange, minHeight = 180, onImageUpload, allowSource = true }) => {
  const editorRef = useRef<Editor | null>(null);
  const [mode, setMode] = useState<EditorMode>("visual");

  // Upload an image file then insert it at the cursor. Used by paste + drop.
  const uploadAndInsert = (file: File) => {
    if (!onImageUpload) return;
    onImageUpload(file)
      .then((url) => editorRef.current?.chain().focus().setImage({ src: url }).run())
      .catch(() => {});
  };

  const editor = useEditor({
    // StarterKit v3 bundles the Link extension, so configure it here rather than
    // registering a second `Link` — duplicate extension names collide on
    // ProseMirror plugin keys.
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Image.configure({ inline: false, HTMLAttributes: { loading: "lazy" } }),
    ],
    content: value,
    // React 18: don't render the editor during the initial render pass.
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    // NB: always an object. Passing `editorProps: undefined` makes TipTap v3
    // build the ProseMirror view with undefined props and crash on
    // `dispatchTransaction` — this is the signature-dialog "DOM explodes" bug
    // (the composer only worked because it passed onImageUpload → a props object).
    editorProps: onImageUpload
      ? {
          handlePaste: (_view, event) => {
            const imgs = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
            if (!imgs.length) return false;
            event.preventDefault();
            imgs.forEach(uploadAndInsert);
            return true;
          },
          handleDrop: (_view, event) => {
            const imgs = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
            if (!imgs.length) return false;
            event.preventDefault();
            imgs.forEach(uploadAndInsert);
            return true;
          },
        }
      : {},
  });

  // Keep a ref for the async insert callbacks.
  useEffect(() => { editorRef.current = editor; }, [editor]);

  // Sync external value changes (e.g. inserting a template) into the editor,
  // guarded so typing — which round-trips through onChange — doesn't reset the cursor.
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      // TipTap v3: second arg is an options object (was a boolean in v2).
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [value, editor]);

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
      {editor && <Toolbar editor={editor} mode={mode} onModeChange={setMode} allowSource={allowSource} />}
      {mode === "source" ? (
        <Box sx={{ p: 1, minHeight }}>
          <TextField
            value={value}
            onChange={(event) => onChange(event.target.value)}
            multiline
            fullWidth
            minRows={Math.max(5, Math.floor(minHeight / 24))}
            variant="standard"
            sx={{
              "& textarea": {
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 13,
                lineHeight: 1.55,
              },
            }}
            slotProps={{
              input: { disableUnderline: true },
              htmlInput: { spellCheck: false }
            }} />
        </Box>
      ) : (
        <Box
          sx={{
            px: 1.5,
            py: 1,
            minHeight,
            cursor: "text",
            "& .ProseMirror": { outline: "none", minHeight: minHeight - 16 },
            "& .ProseMirror p": { my: 0.5 },
            "& .ProseMirror img": { maxWidth: "100%", height: "auto", borderRadius: 1 },
            "& .ProseMirror img.ProseMirror-selectednode": { outline: "2px solid", outlineColor: "primary.main" },
            "& .ProseMirror:focus": { outline: "none" },
            "& .ProseMirror blockquote": { borderLeft: 3, borderColor: "divider", pl: 1.5, color: "text.secondary", ml: 0 },
          }}
          onClick={() => editor?.chain().focus().run()}
        >
          <EditorContent editor={editor} />
        </Box>
      )}
    </Box>
  );
};

export default RichTextEditor;
