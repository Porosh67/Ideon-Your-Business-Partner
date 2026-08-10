import { supabase } from '@/lib/supabase';
import type { AttachmentDraft, AttachmentKind, ChatAttachmentRow } from '@/types';

// ── Limits (must match the chat-attachment edge function) ──
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file
export const MAX_ATTACHMENTS = 3; // files per message

export const ACCEPTED_IMAGE_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,image/bmp';
export const ACCEPTED_DOCUMENT_ACCEPT =
  '.pdf,.txt,.md,.csv,.docx,application/pdf,text/plain,text/csv,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']);
const DOC_MIMES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** Best-effort MIME guess from a file name (used when the browser reports none). */
export function guessMimeName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'pdf':
      return 'application/pdf';
    case 'txt':
    case 'md':
      return 'text/plain';
    case 'csv':
      return 'text/csv';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default:
      return '';
  }
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Enforce the size / count / type limits before a file joins the composer. */
export function validateAttachmentFiles(
  files: File[],
  kind: AttachmentKind,
  currentCount: number
): ValidationResult {
  const allowed = kind === 'image' ? IMAGE_MIMES : DOC_MIMES;
  if (currentCount + files.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `You can attach up to ${MAX_ATTACHMENTS} files per message.` };
  }
  for (const f of files) {
    if (f.size > MAX_FILE_SIZE) {
      return { ok: false, error: `"${f.name}" is over the 10 MB limit.` };
    }
    const type = guessMimeName(f.name) || f.type || '';
    if (!allowed.has(type)) {
      return {
        ok: false,
        error: `"${f.name}" isn't a supported ${kind === 'image' ? 'image' : 'file'} type.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Upload one draft to the private `chat-attachments` bucket (owner-only RLS)
 * and save its DB row, linked to the chat message that carries it.
 */
export async function uploadChatAttachment(
  userId: string,
  draft: AttachmentDraft,
  messageId: string,
  conversationId: string
): Promise<ChatAttachmentRow> {
  const safeName = draft.file.name.replace(/[^\w.\-]+/g, '_').slice(0, 120);
  const path = `${userId}/${crypto.randomUUID()}/${safeName}`;
  const contentType = draft.file.type || guessMimeName(draft.file.name) || undefined;

  const { error: upErr } = await supabase.storage
    .from('chat-attachments')
    .upload(path, draft.file, { contentType, upsert: false });
  if (upErr) {
    console.error('attachment upload error:', upErr.message);
    throw new Error(`We couldn't upload "${draft.file.name}" — try again?`);
  }

  const { data, error: insErr } = await supabase
    .from('chat_attachments')
    .insert({
      user_id: userId,
      message_id: messageId,
      conversation_id: conversationId,
      file_name: draft.file.name,
      file_path: path,
      mime_type: contentType ?? 'application/octet-stream',
      file_size: draft.file.size,
      kind: draft.kind,
    })
    .select('*')
    .single();

  if (insErr || !data) {
    console.error('attachment row insert error:', insErr?.message);
    throw new Error(`We couldn't save "${draft.file.name}" — try again?`);
  }
  return data as ChatAttachmentRow;
}

/** Map saved DB rows to the payload the chat-attachment edge function expects. */
export function attachmentPayload(rows: ChatAttachmentRow[]) {
  return rows.map((r) => ({
    id: r.id,
    file_name: r.file_name,
    storage_path: r.file_path,
    file_size: r.file_size,
    kind: r.kind,
    mime_type: r.mime_type,
  }));
}
