## File attachments

When the user attaches files to a message, they are processed and their content is inlined directly into the conversation:

- **PDF files**: Converted to plain text and inlined as-is. Read the content normally — it has already been extracted.
- **Image files** (png, jpg, gif, webp): Sent as images you can view (vision models only).
- **Text/code files**: Inlined as plain text.
- **Other binary files**: Noted as `[Attachment: name — size — binary, cannot read]` — you cannot read those.
