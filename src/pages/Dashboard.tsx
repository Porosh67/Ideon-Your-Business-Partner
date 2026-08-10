import { useEffect, useLayoutEffect, useState, useCallback, useRef, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, callEdgeFunction } from '@/lib/supabase';
import {
  addConversation,
  ensureHistory,
  loadHistory,
  removeConversation,
  touchConversation as touchConversationInStore,
  useHistory,
} from '@/lib/historyStore';
import {
  clearActive as clearActiveChat,
  getSnapshot as getChatSnapshot,
  setActive as setActiveChat,
  subscribe as subscribeChat,
} from '@/lib/dashboardChatStore';
import { useMarkRouteReady } from '@/lib/transitionStore';
import {
  attachmentPayload,
  uploadChatAttachment,
  validateAttachmentFiles,
  ACCEPTED_DOCUMENT_ACCEPT,
  ACCEPTED_IMAGE_ACCEPT,
} from '@/lib/attachments';
import { useAuth } from '@/hooks/useAuth';
import type {
  AttachmentDraft,
  AttachmentKind,
  ChatAttachmentResult,
  ChatAttachmentRow,
  CheckinRow,
  ConversationRow,
  ConversationMessageRow,
  ChatResult,
  ChatCombinedResult,
  ChatPlanResult,
  ChatReplyResult,
  ChatResearchResult,
} from '@/types';
import {
  CalendarDays,
  Check,
  Copy,
  FileText,
  Flame,
  Image as ImageIcon,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ThumbsDown,
  ThumbsUp,
  User as UserIcon,
  X,
} from 'lucide-react';
import IdeonLoader from '@/components/IdeonLoader';
import LogoMark from '@/components/LogoMark';
import TypingIndicator from '@/components/TypingIndicator';

// ── Branded loading for the full pipeline (two stages) ──
function PipelineLoading({ stage }: { stage: 'research' | 'plan' }) {
  const sublabel =
    stage === 'research'
      ? 'Researching the market with live web data'
      : 'Drafting your business plan and roadmap';
  return (
    <div className="flex flex-col items-start gap-3 animate-message-in">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <LogoMark className="h-3.5 w-3.5" />
      </span>
      <IdeonLoader label={`Ideon is ${stage === 'research' ? 'researching' : 'planning'}`} sublabel={sublabel} size="sm" />
    </div>
  );
}

// ── Shared chat bubble row (used on Dashboard) ──
//
// Two modes:
//  • Legacy / no-actions: pass no `controls` prop — bubble renders exactly as
//    before, with no hover icons. Other pages that import this component keep
//    working untouched.
//  • Hover actions: pass `controls` with the callbacks you wired up. The row
//    reveals a small icon bar (Copy / Edit / ThumbsUp / ThumbsDown / Regenerate
//    depending on role) on hover or keyboard focus, matching Gemini's pattern.
//    Edit mode replaces the bubble with an inline textarea + Save/Cancel.
type MessageCopyState = 'idle' | 'copied';
type MessageFeedbackState = 'idle' | 'up' | 'down';

export interface ChatMessageRowControls {
  // Callbacks
  onCopy?: () => void;
  onEdit?: () => void; // user only
  onRegenerate?: () => void; // assistant only
  onThumbsUp?: () => void; // assistant only
  onThumbsDown?: () => void; // assistant only
  // Visual state
  copyState?: MessageCopyState;
  feedbackState?: MessageFeedbackState;
  isProcessing?: boolean; // true while Regenerate is in-flight
  // Edit mode (user only)
  isEditing?: boolean;
  editDraft?: string;
  onEditDraftChange?: (v: string) => void;
  onEditConfirm?: () => void;
  onEditCancel?: () => void;
}

const ActionBtn = ({
  label,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    disabled={disabled}
    className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted transition-all duration-200 active:scale-90 hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 ${
      active ? 'bg-primary/15 text-primary' : ''
    }`}
  >
    {children}
  </button>
);

export function ChatMessageRow({
  role,
  content,
  children,
  controls,
}: {
  role: 'user' | 'assistant';
  content?: string;
  children?: React.ReactNode;
  controls?: ChatMessageRowControls;
}) {
  const isUser = role === 'user';
  const hasControls = controls !== undefined;
  const copyState = controls?.copyState ?? 'idle';
  const feedbackState = controls?.feedbackState ?? 'idle';
  const isEditing = controls?.isEditing ?? false;

  return (
    <div
      className={`mx-auto my-3 flex w-full max-w-3xl animate-message-in flex-col group/chatrow ${
        isUser ? 'items-end' : 'items-start'
      }`}
    >
      {isEditing ? (
        // ── Edit mode — inline textarea + Save/Cancel. The bubble is replaced
        //    by an editable field that auto-focuses; Enter saves, Escape cancels.
        <EditBubble
          draft={controls?.editDraft ?? ''}
          onChange={(v) => controls?.onEditDraftChange?.(v)}
          onConfirm={() => controls?.onEditConfirm?.()}
          onCancel={() => controls?.onEditCancel?.()}
        />
      ) : (
        // Inner row — spec: flex items-center justify-end/start gap-2.5 max-w-3xl mx-auto w-full.
        // `justify-end` keeps the bubble + avatar glued to the right side for user
        // messages; `justify-start` mirrors that for assistant messages.
        <div
          className={`flex w-full items-center gap-2.5 ${
            isUser ? 'justify-end' : 'justify-start'
          }`}
        >
          {!isUser && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              <LogoMark className="h-3.5 w-3.5" />
            </span>
          )}
          {/* Spec: max-w-[75%] rounded-2xl px-4 py-2.5 text-sm bg-[#c43200] text-white shadow-sm */}
          <div
            className={`relative min-w-0 whitespace-pre-wrap break-words rounded-2xl text-sm leading-relaxed shadow-sm ${
              isUser
                ? 'max-w-[75%] bg-[#c43200] px-4 py-2.5 text-white'
                : 'max-w-[85%] px-4 py-2.5 text-foreground'
            }`}
          >
            {content ?? children}
            {/* ── Hover action bar — absolutely positioned just above THIS
                bubble's right edge so it hugs the message it belongs to
                (not the chat wrapper, not the page). */}
            {hasControls && !isEditing && (
              <div
                className="absolute -top-8 right-0 flex gap-0.5 transition-opacity duration-150 opacity-0 group-hover/chatrow:opacity-100 focus-within:opacity-100"
              >
                {isUser ? (
                  <>
                    {controls?.onEdit && (
                      <ActionBtn label="Edit message" onClick={controls.onEdit}>
                        <Pencil className="h-3.5 w-3.5" />
                      </ActionBtn>
                    )}
                    {controls?.onCopy && (
                      <ActionBtn
                        label={copyState === 'copied' ? 'Copied to clipboard' : 'Copy message'}
                        onClick={controls.onCopy}
                        active={copyState === 'copied'}
                      >
                        {copyState === 'copied' ? (
                          <Check className="h-3.5 w-3.5 text-success" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </ActionBtn>
                    )}
                  </>
                ) : (
                  <>
                    {controls?.onRegenerate && (
                      <ActionBtn
                        label={controls.isProcessing ? 'Regenerating…' : 'Regenerate response'}
                        onClick={controls.onRegenerate}
                        disabled={controls.isProcessing}
                        active={controls.isProcessing}
                      >
                        {controls.isProcessing ? (
                          <LogoMark className="h-3.5 w-3.5 ideon-loader-logo" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                      </ActionBtn>
                    )}
                    {controls?.onThumbsUp && (
                      <ActionBtn
                        label="Good response"
                        onClick={controls.onThumbsUp}
                        active={feedbackState === 'up'}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                      </ActionBtn>
                    )}
                    {controls?.onThumbsDown && (
                      <ActionBtn
                        label="Bad response"
                        onClick={controls.onThumbsDown}
                        active={feedbackState === 'down'}
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                      </ActionBtn>
                    )}
                    {controls?.onCopy && (
                      <ActionBtn
                        label={copyState === 'copied' ? 'Copied to clipboard' : 'Copy message'}
                        onClick={controls.onCopy}
                        active={copyState === 'copied'}
                      >
                        {copyState === 'copied' ? (
                          <Check className="h-3.5 w-3.5 text-success" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </ActionBtn>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {isUser && (
            // Spec avatar: w-7 h-7 rounded-full shrink-0 flex items-center
            // justify-center bg-accent text-xs font-semibold
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
              <UserIcon className="h-3.5 w-3.5" />
            </span>
          )}
          {/* Spacer keeps the bubble at the same horizontal position as the
              action bar (when present) — items-center centers the inner row
              between the two spacers. */}
          {!isUser && hasControls && !isEditing && <span className="flex-1" />}
          {isUser && hasControls && !isEditing && <span className="flex-1" />}
        </div>
      )}

      {/* ── Hover action bar — only when controls are present and not editing. */}
      {hasControls && !isEditing && (
        <div
          className={`mt-1 flex gap-0.5 transition-opacity duration-150 ${
            isUser ? 'self-end' : 'self-start'
          } opacity-0 group-hover/chatrow:opacity-100 focus-within:opacity-100`}
        >
          {isUser ? (
            <>
              {controls?.onEdit && (
                <ActionBtn label="Edit message" onClick={controls.onEdit}>
                  <Pencil className="h-3.5 w-3.5" />
                </ActionBtn>
              )}
              {controls?.onCopy && (
                <ActionBtn
                  label={copyState === 'copied' ? 'Copied to clipboard' : 'Copy message'}
                  onClick={controls.onCopy}
                  active={copyState === 'copied'}
                >
                  {copyState === 'copied' ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </ActionBtn>
              )}
            </>
          ) : (
            <>
              {controls?.onRegenerate && (
                <ActionBtn
                  label={controls.isProcessing ? 'Regenerating…' : 'Regenerate response'}
                  onClick={controls.onRegenerate}
                  disabled={controls.isProcessing}
                  active={controls.isProcessing}
                >
                  {controls.isProcessing ? (
                    <LogoMark className="h-3.5 w-3.5 ideon-loader-logo" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </ActionBtn>
              )}
              {controls?.onThumbsUp && (
                <ActionBtn
                  label="Good response"
                  onClick={controls.onThumbsUp}
                  active={feedbackState === 'up'}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                </ActionBtn>
              )}
              {controls?.onThumbsDown && (
                <ActionBtn
                  label="Bad response"
                  onClick={controls.onThumbsDown}
                  active={feedbackState === 'down'}
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                </ActionBtn>
              )}
              {controls?.onCopy && (
                <ActionBtn
                  label={copyState === 'copied' ? 'Copied to clipboard' : 'Copy message'}
                  onClick={controls.onCopy}
                  active={copyState === 'copied'}
                >
                  {copyState === 'copied' ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </ActionBtn>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Inline editor for a user message being edited.
function EditBubble({
  draft,
  onChange,
  onConfirm,
  onCancel,
}: {
  draft: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the edit textarea to fit content, clamped at 200px (matches the
  // composer box's behaviour so the two feel like the same control surface).
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [draft]);

  // Enter submits, Shift+Enter inserts a newline (matches the composer).
  // Escape cancels — matches the standard "Cancel" expectation.
  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (draft.trim()) onConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="flex w-full max-w-[75%] flex-col items-stretch gap-2">
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKey}
        rows={2}
        autoFocus
        aria-label="Edit message"
        className="w-full resize-none rounded-2xl border border-primary/40 bg-[#c43200]/5 px-4 py-2.5 text-[15px] leading-relaxed text-foreground shadow-sm transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground active:scale-[0.97] cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!draft.trim()}
          className="cursor-pointer rounded-lg bg-gradient-to-br from-accent to-accent-hover px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-accent/20 transition-all duration-200 hover:shadow-lg hover:shadow-accent/30 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          Save & resubmit
        </button>
      </div>
    </div>
  );
}

// ── Chat composer — one instance shared by the centered welcome state and
//    the fixed bottom bar, so the move between them is one smooth glide.
//    Enter sends, Shift+Enter inserts a newline (no instructional text shown).
function ChatInputBox({
  value,
  onChange,
  onSend,
  disabled,
  sending,
  inputError,
  textareaRef,
  placeholder = 'Ask Ideon…',
  attachments = [],
  onAttachFiles,
  onRemoveAttachment,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  sending?: boolean;
  inputError?: string | null;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  placeholder?: string;
  attachments?: AttachmentDraft[];
  onAttachFiles?: (files: FileList | File[], kind: AttachmentKind) => void;
  onRemoveAttachment?: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  // Close the "+" menu on outside click / Escape (accessibility).
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Auto-grow: expand the textarea as the user types multi-line text,
  // clamped to a max of 200px. useLayoutEffect prevents a flash of the
  // intermediate "auto" height before the target height is committed.
  useLayoutEffect(() => {
    const textarea = (textareaRef as React.RefObject<HTMLTextAreaElement> | null)?.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [value, textareaRef]);

  return (
    <div>
      <div className="max-w-3xl mx-auto">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 rounded-t-xl border border-b-0 border-border bg-surface px-4 py-2.5">
            {attachments.map((att) => (
              <span
                key={att.id}
                className="group inline-flex max-w-[220px] items-center gap-2 rounded-lg border border-border bg-background/60 py-1 pl-1 pr-1.5 text-xs text-foreground shadow-sm"
              >
                {att.kind === 'image' && att.previewUrl ? (
                  <img
                    src={att.previewUrl}
                    alt=""
                    className="h-7 w-7 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <FileText className="h-3.5 w-3.5" />
                  </span>
                )}
                <span className="max-w-[120px] truncate" title={att.file.name}>
                  {att.file.name}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment?.(att.id)}
                  aria-label={`Remove ${att.file.name}`}
                  className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-md text-muted transition-all duration-200 hover:bg-surface-hover hover:text-destructive active:scale-90"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Input composer row — spec violation fixed (was gap-2 min-h-12 → gap-2.5 min-h-[52px]).
            The legacy `composer-box` class is retained for the hover/focus ring
            behaviour painted in src/index.css. When attachments are present, the
            attachment area shares the top border so they read as one unit. */}
        <div className={`composer-box flex items-center gap-2.5 rounded-2xl border px-4 min-h-[52px] bg-card/90 backdrop-blur shadow-sm ${
          attachments.length > 0 ? 'rounded-b-2xl composer-box-attached' : 'rounded-2xl'
        }`}>
        {/* Hidden file inputs — real pickers, opened from the menu */}
        <input
          ref={imageInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_ACCEPT}
          multiple
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) onAttachFiles?.(Array.from(files), 'image');
            e.target.value = '';
          }}
        />
        <input
          ref={docInputRef}
          type="file"
          accept={ACCEPTED_DOCUMENT_ACCEPT}
          multiple
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) onAttachFiles?.(Array.from(files), 'document');
            e.target.value = '';
          }}
        />

        {/* "+" button — opens the attachment menu (Gemini-style, left side) */}
        <div className="relative flex items-center shrink-0 self-center">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            disabled={disabled}
            aria-label="Attach files"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground active:scale-90 disabled:opacity-50"
          >
            <Plus className="h-5 w-5" />
          </button>

          {/* "+" menu — Add images / Add files */}
          {menuOpen && (
            <div
              ref={menuRef}
              role="menu"
              aria-label="Attach options"
              className="absolute bottom-full left-0 z-30 mb-2 w-44 animate-scale-in rounded-xl border border-border bg-surface p-1.5 shadow-elevated"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  imageInputRef.current?.click();
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-all duration-200 hover:bg-surface-hover active:scale-[0.98]"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent">
                  <ImageIcon className="h-4 w-4" />
                </span>
                Add images
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  docInputRef.current?.click();
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-all duration-200 hover:bg-surface-hover active:scale-[0.98]"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <FileText className="h-4 w-4" />
                </span>
                Add files
              </button>
            </div>
          )}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          maxLength={2000}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full shrink resize-none bg-transparent py-2 text-sm text-foreground placeholder:text-muted/50 transition-all focus:outline-none disabled:opacity-50"
          aria-label="Message Ideon"
        />

        <button
          type="button"
          onClick={onSend}
          disabled={(!value.trim() && attachments.length === 0) || disabled}
          aria-label="Send message"
          className="flex items-center shrink-0 self-center cursor-pointer h-9 w-9 justify-center rounded-lg bg-gradient-to-br from-primary to-secondary text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.95] disabled:opacity-50 disabled:shadow-none"
        >
          {sending ? (
            <LogoMark className="h-4 w-4 ideon-loader-logo" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
        </div>
        {/* End of composer row */}
        {inputError && (
          <p className="mt-1.5 text-sm text-destructive">{inputError}</p>
        )}
      </div>
      {/* Small, subtle disclaimer — no instructional text in the box */}
      <p className="mt-1.5 text-center text-xs text-muted/40">
        AI can make mistakes. Please double-check responses.
      </p>
    </div>
  );
}

const MOODS = [
  { value: 1, emoji: '😞', label: 'Rough' },
  { value: 2, emoji: '😕', label: 'Meh' },
  { value: 3, emoji: '😐', label: 'Okay' },
  { value: 4, emoji: '🙂', label: 'Good' },
  { value: 5, emoji: '🤩', label: 'Great' },
];

function formatCheckinDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Check-in detail modal — shows mood, energy, notes, and the AI response. */
function CheckinDetailModal({
  checkin,
  onClose,
}: {
  checkin: CheckinRow;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mood = MOODS.find((m) => m.value === checkin.mood);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Check-in details"
    >
      <div
        className="w-full max-w-md animate-scale-in rounded-2xl border border-border bg-surface p-6 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-lg" aria-hidden="true">
              {mood?.emoji ?? '😐'}
            </span>
            <div>
              <p className="font-heading text-sm font-bold tracking-tight">
                {checkin.title?.trim() || formatCheckinDate(checkin.checkin_date)}
              </p>
              <p className="text-xs text-muted">{formatCheckinDate(checkin.checkin_date)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close details"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground active:scale-90"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
            <CalendarDays className="h-3 w-3" />
            Mood: {mood?.label ?? 'Unknown'}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Flame className="h-3 w-3" />
            Energy: {checkin.energy}/5
          </span>
        </div>

        <div className="mb-4">
          <p className="mb-1.5 text-xs font-semibold text-muted">Notes</p>
          {checkin.notes ? (
            <p className="whitespace-pre-wrap rounded-xl border border-border bg-background/60 px-3.5 py-3 text-sm leading-relaxed text-foreground">
              {checkin.notes}
            </p>
          ) : (
            <p className="rounded-xl border border-dashed border-border px-3.5 py-3 text-sm text-muted">
              No notes for this check-in.
            </p>
          )}
        </div>

        {checkin.ai_response && (
          <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent px-3.5 py-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-primary">
              <LogoMark className="h-3.5 w-3.5" />
              Your coach says
            </p>
            <p className="text-sm leading-relaxed text-foreground">{checkin.ai_response}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, isGuest } = useAuth();
  // Marks this route as rendered so the sign-in transition dismisses as soon
  // as the dashboard SHELL is on screen (history loads in the background —
  // the shell is never blocked on it).
  useMarkRouteReady();

  // ── Chat state ──
  // Conversations/check-ins come from the shared history store (the same data
  // the sidebar renders) — load once in the background, never gate the render.
  const { conversations, checkins, loaded: historyLoaded } = useHistory();
  const [activeConv, setActiveConv] = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<ConversationMessageRow[]>([]);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [pipelineStage, setPipelineStage] = useState<'research' | 'plan' | null>(null);
  const [showTyping, setShowTyping] = useState(false);
  // Files picked in the composer but not yet sent (preview chips above the box).
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  // True while a history conversation's messages are being fetched — shows the
  // branded loader in the messages area instead of a blank thread.
  const [loadingConversation, setLoadingConversation] = useState(false);
  // True while the deep-linked check-in (not in the store) is being fetched.
  const [loadingCheckin, setLoadingCheckin] = useState(false);
  const [checkinModal, setCheckinModal] = useState<CheckinRow | null>(null);

  // ── Message-actions state (Copy / Edit / Thumbs / Regenerate) ──
  // The message is being edited inline; only one can be in edit mode at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // Which message's Copy button is showing the "copied" confirmation. Auto-clears
  // after 1.5s via the timeout ref below.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  // Per-message thumbs feedback ('up' / 'down'). Hydrated from
  // `message_feedback` on conversation open and kept in sync optimistically
  // with each click — persisted on the server, NOT cleared after a timer.
  const [feedback, setFeedback] = useState<Record<string, 'up' | 'down'>>({});
  const feedbackTimerRef = useRef<number | null>(null);
  // True while a Regenerate is in flight — used to dim the action button and
  // swap the icon for a branded loader (matches the composer behaviour).
  const [processingMessageId, setProcessingMessageId] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  // Bumped on every "new chat" reset; in-flight requests compare against it so
  // their UI updates become no-ops if the user starts a fresh chat mid-request.
  const sessionRef = useRef(0);
  // The last URL search string the URL-handling effect acted on — each distinct
  // search string is processed exactly once (see the effect below).
  const lastHandledSearchRef = useRef<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Session-scoped persistence: remember which conversation was last active
  // in the Dashboard across route changes. The component's local `activeConv`
  // state is destroyed on unmount (e.g. user navigates to /reports and back),
  // so without this store the remounted Dashboard would always show the empty
  // welcome screen. See `src/lib/dashboardChatStore.ts` for the contract.
  // Messages are NOT cached here — we keep only the identity, and `openConversation`
  // always re-fetches a fresh message list when restoring.
  const chatStoreSnap = useSyncExternalStore(subscribeChat, getChatSnapshot, getChatSnapshot);

  useEffect(() => {
    if (user) ensureHistory(user.id);
    // When the user signs out, drop any persisted active conv so the next
    // signed-in user can't see this user's conversation id leaking across.
    // No-op when already null (ref-stable store update is a no-op).
    else clearActiveChat();
  }, [user]);

  // Auto-scroll chat on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, showTyping, pipelineStage]);

  // Load messages when a conversation is opened
  const openConversation = useCallback(
    async (conv: ConversationRow) => {
      sessionRef.current += 1; // invalidate any in-flight send's UI updates
      const session = sessionRef.current;
      setActiveConv(conv);
      setMessages([]);
      setLoadingConversation(true);
      // Persist identity so a later navigation away & back to /dashboard
      // restores this conversation from the module-singleton chat store
      // (the URL deep-link param is intentionally stripped after handling
      // — see the URL effect below — so this is the only persistent signal).
      setActiveChat(conv);
      // A pending attachment draft belongs to the previous composer — clear it.
      setAttachments((prev) => {
        prev.forEach((a) => {
          if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
        });
        return [];
      });
      if (!user) {
        setLoadingConversation(false);
        return;
      }
      try {
        const { data } = await supabase
          .from('conversation_messages')
          .select('*')
          .eq('conversation_id', conv.id)
          .eq('user_id', user.id)
          .order('created_at', { ascending: true });
        if (sessionRef.current !== session) return; // superseded mid-fetch
        setMessages((data ?? []) as ConversationMessageRow[]);
        // Hydrate per-message feedback so thumbs-rated messages render in
        // their selected state on reopen (e.g. after reload). One round-trip
        // for the whole conversation's message ids, gated by `session` so a
        // switched conversation cannot race in stale votes.
        if (data && data.length > 0) {
          const msgIds = (data as ConversationMessageRow[]).map((m) => m.id);
          const { data: fbRows } = await supabase
            .from('message_feedback')
            .select('message_id, rating')
            .eq('user_id', user.id)
            .in('message_id', msgIds);
          if (sessionRef.current === session) {
            const fbMap: Record<string, 'up' | 'down'> = {};
            (fbRows ?? []).forEach((r: { message_id: string; rating: string }) => {
              if (r.rating === 'up' || r.rating === 'down') {
                fbMap[r.message_id] = r.rating;
              }
            });
            // Server snapshot is the base; any optimistic local flips the
            // user just made win (`prev` overwrites on collision).
            setFeedback((prev) => ({ ...fbMap, ...prev }));
          }
        }
      } finally {
        // Clear the loader only if this fetch is still the current one — a
        // "new chat" or another openConversation supersedes it.
        if (sessionRef.current === session) setLoadingConversation(false);
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    },
    [user]
  );

  // Reset to the brand-new-chat welcome state: clears the thread, composer and
  // any in-flight request, then focuses the composer. Memoized with an empty
  // dep list so its identity is stable — effects/listeners that call it never
  // re-fire just because the component re-rendered.
  const newConversation = useCallback(() => {
    sessionRef.current += 1; // invalidate any in-flight request's UI updates
    sendingRef.current = false;
    setActiveConv(null);
    setMessages([]);
    setInput('');
    setInputError(null);
    setSending(false);
    setShowTyping(false);
    setPipelineStage(null);
    setLoadingConversation(false);
    setLoadingCheckin(false);
    setCheckinModal(null);
    // Drop the persisted active id too — "New chat" should leave no trace,
    // so navigating away and back shows the empty welcome, NOT the previous
    // thread.
    clearActiveChat();
    // Clear any pending attachment drafts (and revoke their object URLs).
    setAttachments((prev) => {
      prev.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      });
      return [];
    });
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  // URL-driven navigation — the sidebar's "New chat" pill navigates here with
  // ?new=1 (works from any page), and history rows deep-link with
  // ?conversation=<id> / ?checkin=<id>. Each distinct search string is
  // processed EXACTLY ONCE: lastHandledSearchRef records the search string
  // only once it has been acted on, so re-renders, store updates and
  // StrictMode's double effect invocation become harmless no-ops, and clearing
  // the params produces a *different* search string, so it can never re-trigger
  // a second reset. (This was the "New chat" freeze: an unstable
  // newConversation in the deps re-ran the effect on every render, each run
  // calling setSearchParams → endless update churn.)
  // Deep-links additionally wait for the history store's first fetch
  // (`loaded`): on a cold load the cache is empty, so a conversation or
  // check-in looked up too early would be missed. While the store is loading,
  // the deep-link is HELD — the URL is left untouched and the search string is
  // not recorded — so the effect re-runs the moment `loaded` flips and opens
  // the target from the now-warm cache.
  useEffect(() => {
    if (!user) return;
    const search = searchParams.toString();
    if (lastHandledSearchRef.current === search) return;

    // New chat wins over any deep-link.
    if (searchParams.get('new') === '1') {
      newConversation();
      setSearchParams({}, { replace: true });
      lastHandledSearchRef.current = search;
      return;
    }

    // Deep-link: open a specific conversation from ?conversation=<id>.
    const convId = searchParams.get('conversation');
    if (convId) {
      // Hold until the history store has finished its first fetch — on a cold
      // load the conversation isn't in the cache yet.
      if (!historyLoaded) return;
      const conv = conversations.find((c) => c.id === convId);
      if (conv) {
        void openConversation(conv);
        setSearchParams({}, { replace: true });
        lastHandledSearchRef.current = search;
        return;
      }
      // Not in the cache — fetch it directly (e.g. created/deleted in another
      // tab after the store snapshot). Add it to the store so the sidebar
      // stays in sync.
      setSearchParams({}, { replace: true });
      lastHandledSearchRef.current = search;
      void (async () => {
        const { data } = await supabase
          .from('conversations')
          .select('*')
          .eq('id', convId)
          .eq('user_id', user.id)
          .single();
        if (data) {
          const conv = data as ConversationRow;
          addConversation(conv);
          void openConversation(conv);
        }
      })();
      return;
    }

    // Deep-link to a check-in: show its detail modal from the store.
    const checkinId = searchParams.get('checkin');
    if (checkinId) {
      // Same hold as above: wait for the store so cold loads don't miss it.
      if (!historyLoaded) return;
      const checkin = checkins.find((c) => c.id === checkinId);
      if (checkin) {
        setCheckinModal(checkin);
      } else {
        void (async () => {
          setLoadingCheckin(true);
          try {
            const { data } = await supabase
              .from('daily_checkins')
              .select('*')
              .eq('id', checkinId)
              .eq('user_id', user.id)
              .single();
            if (data) setCheckinModal(data as CheckinRow);
          } finally {
            setLoadingCheckin(false);
          }
        })();
      }
      setSearchParams({}, { replace: true });
      lastHandledSearchRef.current = search;
      return;
    }

    // No deep-link — record the (empty) search string so unrelated store
    // updates don't re-run this effect's (now no-op) logic.
    lastHandledSearchRef.current = search;
  }, [user, conversations, checkins, historyLoaded, searchParams, setSearchParams, newConversation, openConversation]);

  // ── Session-scoped restore on remount ──
  //
  // When the Dashboard remounts after navigating away (to /reports, /checkin,
  // /settings, etc.) and back, the URL no longer carries a `?conversation=`
  // deep-link (the URL handler above strips it on success), and the local
  // `activeConv` state was destroyed on unmount. Without this effect, the
  // user would always see the empty welcome screen on return.
  //
  // The chat-store singleton remembers the conversation IDENTITY across
  // route changes; this effect re-opens it through `openConversation` so the
  // messages are refetched fresh from Supabase. We do NOT cache messages
  // in the store (would serve stale content if the conversation changed
  // in another tab) — only the identity is persisted.
  //
  // Guards:
  //   • user must be known (otherwise ProtectedRoute keeps us off /dashboard).
  //   • history store must have finished its first load (the conversation
  //     row we cached is what we restore from; on a cold load the row hasn't
  //     arrived yet).
  //   • NO URL deep-link present — `?conversation=<id>` and `?new=1` are
  //     handled by the URL effect above and take precedence.
  //   • Runs ONCE per component mount — gated by `mountRestoreKeyRef` so
  //     React 18 StrictMode's double-invoke in dev and any re-render after
  //     `chatStoreSnap` stabilises both become no-ops. We deliberately DO
  //     NOT clear the gate if activeConv later becomes null (e.g. user
  //     hit "New chat") because that would let a stale snapshot re-open
  //     something — but on `newConversation` we also clear the store, so
  //     `chatStoreSnap.activeConvId` becomes null and the early-return
  //     handles it without the gate ever mattering again.
  const mountRestoreKeyRef = useRef(false);
  useEffect(() => {
    if (!user) return;
    if (!historyLoaded) return;
    const searchString = searchParams.toString();
    if (searchString.includes('conversation=')) return;
    if (searchString.includes('new=1')) return;
    if (mountRestoreKeyRef.current) return;
    const stored = chatStoreSnap.activeConv;
    if (!stored) return;
    // If local state already points at the stored conversation (e.g. the
    // user reloaded while it was open and the URL handler re-opened it),
    // skip — opening twice would race a duplicate fetch.
    if (activeConv?.id === stored.id) return;
    mountRestoreKeyRef.current = true;
    void openConversation(stored);
  }, [user, historyLoaded, searchParams, chatStoreSnap, activeConv, openConversation]);

  // Refresh conversations when deleted elsewhere (sidebar 3-dot delete).
  useEffect(() => {
    const onDeleted = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail ?? {};
      if (!id) return;
      removeConversation(id);
      setActiveConv((prev) => (prev?.id === id ? null : prev));
      setMessages((prev) => (prev[0]?.conversation_id === id ? [] : prev));
      // If the deleted conversation was the persisted active one, drop it
      // from the chat store too — otherwise a navigation away & back would
      // re-open someone else's deleted thread. Read the live snapshot so
      // we don't need to re-register this listener on every store change.
      if (getChatSnapshot().activeConvId === id) clearActiveChat();
    };
    window.addEventListener('ideon:conversation-deleted', onDeleted);
    return () => window.removeEventListener('ideon:conversation-deleted', onDeleted);
  }, []);

  // ── Attachment handlers (step 5) ──
  const handleAttachFiles = useCallback((files: File[] | FileList, kind: AttachmentKind) => {
    const list = Array.from(files);
    const result = validateAttachmentFiles(list, kind, attachments.length);
    if (!result.ok) {
      setInputError(result.error);
      return;
    }
    const drafts: AttachmentDraft[] = list.map((file) => ({
      id: crypto.randomUUID(),
      file,
      kind,
      previewUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
    }));
    setAttachments((prev) => [...prev, ...drafts]);
    setInputError(null);
  }, [attachments.length]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  // ── Message actions: Copy / Edit / Thumbs / Regenerate ────────────────
  //
  // All four are wired into the chat message bubble via the `ChatMessageRow`
  // controls prop (defined at the top of this file). Each is a thin local
  // handler that delegates to the shared `runAssistantReply` pipeline below
  // for the AI-generation work — so Edit and Regenerate reuse the EXACT same
  // edge-function calls (assistant-chat, classify+reply, full-pipeline) that a
  // fresh send uses. No duplicate send path.

  // ── Copy: writes the message's plain text to the clipboard and shows a
  // 1.5s confirmation on the same button. Falls back to a hidden <textarea>
  // + execCommand if the async Clipboard API is unavailable (older browsers,
  // non-secure contexts). ────────────────────────────────────────────────
  const handleCopyMessage = useCallback(async (msgId: string, content: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        // Fallback for environments without the async Clipboard API.
        const ta = document.createElement('textarea');
        ta.value = content;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedId(msgId);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedId(null);
        copyTimerRef.current = null;
      }, 1500);
    } catch {
      // Clipboard rejected (insecure context, focus loss, permissions). Soft-fail;
      // we don't want to surface a scary error toast for a non-critical action.
    }
  }, []);

  // ── Edit: open the inline editor on a user message (pre-filled with its
  // current content). Blocked while a send/regenerate is in-flight to keep
  // the conversation state unambiguous. ─────────────────────────────────
  const handleStartEdit = useCallback(
    (msgId: string, content: string) => {
      if (sendingRef.current || processingMessageId) return;
      setEditingId(msgId);
      setEditDraft(content);
    },
    [processingMessageId]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditDraft('');
  }, []);

  // ── Thumbs up / down: persisted to the `message_feedback` table — one row
  // per (user, message). Same-constraint Unique index lets the swap be a
  // single upsert and the un-select (click same button again) a single
  // delete. Local `feedback` state is the source of truth for the visual
  // selected state; it is hydrated from DB on conversation open and kept
  // in sync optimistically with each click. ──────────────────────────
  const handleThumbsVote = useCallback(
    async (msgId: string, vote: 'up' | 'down') => {
      if (!user) return;
      const existing = feedback[msgId];

      // Same-button click → un-select: drop the row.
      if (existing === vote) {
        const prev = existing;
        setFeedback((p) => {
          const next = { ...p };
          delete next[msgId];
          return next;
        });
        const { error } = await supabase
          .from('message_feedback')
          .delete()
          .eq('message_id', msgId)
          .eq('user_id', user.id);
        if (error) {
          // Revert local state so the UI matches reality.
          setFeedback((p) => ({ ...p, [msgId]: prev }));
          // eslint-disable-next-line no-console
          console.warn('Could not save your feedback — try again?', error.message);
        }
        return;
      }

      // Fresh or opposite-button click → upsert (insert or update rating).
      // `feedback[msgId]` is the snapshot before this update; we keep the
      // pre-update value to roll back on error.
      const previous = existing;
      setFeedback((p) => ({ ...p, [msgId]: vote }));
      const { error } = await supabase
        .from('message_feedback')
        .upsert(
          { message_id: msgId, user_id: user.id, rating: vote },
          { onConflict: 'message_id,user_id' }
        );
      if (error) {
        if (previous) {
          setFeedback((p) => ({ ...p, [msgId]: previous }));
        } else {
          setFeedback((p) => {
            const next = { ...p };
            delete next[msgId];
            return next;
          });
        }
        // eslint-disable-next-line no-console
        console.warn('Could not save your feedback — try again?', error.message);
      }
    },
    [user, feedback]
  );

  // ── Shared AI-generation pipeline (single source of truth) ───────────
  //
  // Given a user-message text + history (history MUST exclude the user
  // message itself — the server treats it as the latest turn from this
  // client) + the conversation id, classify the message and either:
  //   • Inline reply (B/C fast path), or
  //   • Full research+plan pipeline (category A), or
  //   • Classic classify→reply fallback when extra data is needed,
  // then persist the assistant message and update state.
  //
  // `replaceAssistantMessageId` (optional): deletes an existing assistant
  // message row first, then inserts the new one — used by Regenerate to
  // replace in place. (Delete+insert is the cleanest match for "this turn
  // produced a new version of an existing response" without altering the
  // existing conversation_messages schema.)
  async function runAssistantReply({
    userText,
    history,
    convId,
    isCurrent,
    replaceAssistantMessageId,
  }: {
    userText: string;
    history: { role: 'user' | 'assistant'; content: string }[];
    convId: string;
    isCurrent: () => boolean;
    replaceAssistantMessageId?: string;
  }): Promise<void> {
    if (!user) return;
    const userId = user.id;

    try {
      // 1) Combined classify + reply fast path (Part C).
      const combined = (await callEdgeFunction<ChatResult>('assistant-chat', {
        phase: 'chat',
        message: userText,
        history,
        conversation_id: convId,
        idea_id: activeConv?.idea_id ?? undefined,
      })) as ChatCombinedResult;
      if (!isCurrent()) return;

      let reply = '';
      if (combined.reply != null && combined.category !== 'A') {
        // Inline reply — render immediately.
        reply = combined.reply;
      } else if (combined.category === 'A' && combined.idea_text) {
        // Full pipeline (research + plan).
        if (isCurrent()) setPipelineStage('research');
        const researchRes = (await callEdgeFunction<ChatResult>('assistant-chat', {
          phase: 'research',
          idea_text: combined.idea_text,
          conversation_id: convId,
        })) as ChatResearchResult;
        if (!isCurrent()) return;

        if (isCurrent()) setPipelineStage('plan');
        const planRes = (await callEdgeFunction<ChatResult>('assistant-chat', {
          phase: 'plan',
          idea_text: combined.idea_text,
          research: researchRes.research,
          conversation_id: convId,
        })) as ChatPlanResult;
        if (!isCurrent()) return;

        if (isCurrent()) setPipelineStage(null);
        // Link the conversation to the new idea (category A side effect).
        if (planRes.idea_id) {
          await supabase
            .from('conversations')
            .update({ idea_id: planRes.idea_id })
            .eq('id', convId);
          if (isCurrent()) {
            setActiveConv((prev) =>
              prev ? { ...prev, idea_id: planRes.idea_id } : prev
            );
          }
        }
        reply = planRes.reply;
      } else {
        // Combined couldn't answer inline — classic classify→reply path.
        const replyRes = (await callEdgeFunction<ChatResult>('assistant-chat', {
          phase: 'reply',
          category: combined.category,
          message: userText,
          history,
          conversation_id: convId,
          idea_id: activeConv?.idea_id ?? undefined,
          needs_web: combined.needs_web,
          needs_memory: combined.needs_memory,
          search_query: combined.search_query,
        })) as ChatReplyResult;
        if (!isCurrent()) return;
        reply = replyRes.reply;
      }

      if (!isCurrent()) return;

      // Persist + render the assistant message. For Regenerate, drop the old
      // row first so the new version cleanly replaces it (no orphan content).
      if (replaceAssistantMessageId) {
        await supabase
          .from('conversation_messages')
          .delete()
          .eq('id', replaceAssistantMessageId)
          .eq('user_id', userId);
        if (!isCurrent()) return;
      }
      const { data: inserted } = await supabase
        .from('conversation_messages')
        .insert({
          conversation_id: convId,
          user_id: userId,
          role: 'assistant',
          content: reply,
        })
        .select('id')
        .single();
      if (!isCurrent()) return;
      setShowTyping(false);
      setMessages((prev) => {
        const updated = [...prev];
        const newMsg: ConversationMessageRow = inserted
          ? {
              id: inserted.id,
              conversation_id: convId,
              user_id: userId,
              role: 'assistant',
              content: reply,
              created_at: new Date().toISOString(),
            }
          : {
              id: crypto.randomUUID(),
              conversation_id: convId,
              user_id: userId,
              role: 'assistant',
              content: reply,
              created_at: new Date().toISOString(),
            };
        if (replaceAssistantMessageId) {
          const idx = updated.findIndex((m) => m.id === replaceAssistantMessageId);
          if (idx >= 0) {
            updated[idx] = newMsg;
          } else {
            updated.push(newMsg);
          }
        } else {
          updated.push(newMsg);
        }
        return updated;
      });
      loadHistory(userId);
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      if (isCurrent()) {
        setPipelineStage(null);
        setShowTyping(false);
        setInputError('We couldn\'t process that — try again?');
      }
      // Persist the error message so the user has visible feedback in the
      // thread even when the main reply pipeline fails.
      try {
        await supabase.from('conversation_messages').insert({
          conversation_id: convId,
          user_id: userId,
          role: 'assistant',
          content: errMsg,
        });
        if (!isCurrent()) return;
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            conversation_id: convId,
            user_id: userId,
            role: 'assistant',
            content: errMsg,
            created_at: new Date().toISOString(),
          },
        ]);
      } catch {
        // ignore — DB write in catch is best-effort
      }
    }
  }

  // ── Confirm edit: persists the user's edited message, deletes every
  // subsequent message in the conversation, then re-runs the AI pipeline
  // with the edited text as the latest user turn. ──────────────────────
  async function handleConfirmEdit(): Promise<void> {
    if (!editingId || !activeConv || !user) return;
    const newContent = editDraft.trim();
    if (!newContent || sendingRef.current) return;
    const convId = activeConv.id;
    const idx = messages.findIndex((m) => m.id === editingId);
    if (idx < 0) return;

    // Snapshot state BEFORE we mutate it — needed to build the correct
    // history (everything strictly before the edited message).
    const previousMessages = messages;
    const subsequentIds = previousMessages.slice(idx + 1).map((m) => m.id);

    // 1. Update the user message content in Supabase.
    const { error: updateErr } = await supabase
      .from('conversation_messages')
      .update({ content: newContent })
      .eq('id', editingId)
      .eq('user_id', user.id);
    if (updateErr) {
      setInputError('Couldn\'t save your edit — try again?');
      return;
    }

    // 2. Hard-delete every subsequent message row (the old AI reply + any
    //    follow-ups). The next pipeline run will write fresh rows from this
    //    point forward, exactly like a brand-new send from here.
    if (subsequentIds.length > 0) {
      await supabase
        .from('conversation_messages')
        .delete()
        .in('id', subsequentIds)
        .eq('user_id', user.id);
    }

    // 3. Sync local state with the DB: replace edited content, drop the
    //    trailing messages, exit edit mode.
    const session = sessionRef.current;
    const isCurrent = () => sessionRef.current === session;
    setMessages((prev) => {
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        content: newContent,
        created_at: new Date().toISOString(),
      };
      return updated.slice(0, idx + 1);
    });
    setEditingId(null);
    setEditDraft('');

    // 4. Re-run AI generation with the same context as before the edit, but
    //    with the edited text as the latest user turn — identical to a fresh
    //    send from this point in the conversation.
    sendingRef.current = true;
    setSending(true);
    setShowTyping(true);

    const history = previousMessages
      .slice(0, idx)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      await runAssistantReply({
        userText: newContent,
        history,
        convId,
        isCurrent,
      });
    } finally {
      if (isCurrent()) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  }

  // ── Regenerate: re-runs the AI pipeline for an existing assistant
  // message, replacing its content in place. The history is built from
  // everything BEFORE the most recent user message in this turn. ──────
  async function handleRegenerate(aiMsgId: string): Promise<void> {
    if (!activeConv || !user) return;
    if (sendingRef.current || processingMessageId) return;
    const convId = activeConv.id;
    const idx = messages.findIndex((m) => m.id === aiMsgId);
    if (idx < 1) return;

    // Walk back to find the user message that triggered this assistant reply.
    let userIdx = idx - 1;
    while (userIdx >= 0 && messages[userIdx].role !== 'user') userIdx--;
    // Don't regenerate while the user is editing that triggering message —
    // they'd be racing two operations on the same turn.
    if (userIdx < 0 || messages[userIdx].id === editingId) return;

    const userText = messages[userIdx].content;
    const history = messages
      .slice(0, userIdx)
      .map((m) => ({ role: m.role, content: m.content }));

    setProcessingMessageId(aiMsgId);
    sendingRef.current = true;
    setSending(true);
    setShowTyping(true);
    // Cancelling any open edit — focus moves to the regenerate action.
    setEditingId(null);

    const session = sessionRef.current;
    const isCurrent = () => sessionRef.current === session;

    try {
      await runAssistantReply({
        userText,
        history,
        convId,
        isCurrent,
        replaceAssistantMessageId: aiMsgId,
      });
    } finally {
      if (isCurrent()) {
        sendingRef.current = false;
        setSending(false);
        setProcessingMessageId(null);
      }
    }
  }

  // Cleanup pending confirmation timers on unmount (avoids leaking them).
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      if (feedbackTimerRef.current !== null)
        window.clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  // ── Chat send flow (creates a fresh user message, then delegates to the
  //    same shared `runAssistantReply` used by Edit and Regenerate). ──
  const handleSend = async () => {
    const msg = input.trim();
    if ((!msg || sendingRef.current) && attachments.length === 0) return;
    if (!msg && attachments.length > 0) {
      // Attachment-only message: let the assistant describe the files.
    } else if (msg.length < 2) {
      setInputError('Say a little more so I can help.');
      return;
    }
    // Snapshot the session — every post-await update checks it so a "new
    // chat" mid-request cancels this in-flight request's UI updates.
    const session = sessionRef.current;
    const isCurrent = () => sessionRef.current === session;
    const drafts = attachments; // capture drafts to upload
    setInputError(null);
    setInput('');
    setAttachments([]); // clear the composer chips immediately
    // Sending starts — close any open edit (user just typed a new message).
    setEditingId(null);

    sendingRef.current = true;
    setSending(true);
    // Show the branded typing indicator IMMEDIATELY after the user's
    // message — the classify phase can take 1-2s and must not feel dead.
    setShowTyping(true);

    // Ensure a conversation exists (reuse active or create new).
    let conv = activeConv;
    let userMsgId: string | null = null;
    try {
      if (!conv && user) {
        const { data: newConv } = await supabase
          .from('conversations')
          .insert({ user_id: user.id, title: (msg || 'Attachment').slice(0, 80) })
          .select('*')
          .single();
        if (newConv) {
          conv = newConv as ConversationRow;
          if (isCurrent()) {
            setActiveConv(conv);
            // Persist the freshly-created conversation's identity so a
            // later navigation away & back to /dashboard can restore this
            // very thread (not the empty welcome).
            setActiveChat(conv);
          }
          addConversation(conv);
        }
      }
      if (conv && user) {
        const convId = conv.id; // capture before await — TS widens `let`
        const { data: inserted } = await supabase
          .from('conversation_messages')
          .insert({
            conversation_id: convId,
            user_id: user.id,
            role: 'user',
            content: msg,
          })
          .select('id')
          .single();
        userMsgId = inserted?.id ?? null;
        // Bump updated_at so this conversation re-sorts to the top of History.
        touchConversationInStore(convId);
        if (isCurrent()) {
          setMessages((prev) => [
            ...prev,
            {
              id: userMsgId ?? crypto.randomUUID(),
              conversation_id: convId,
              user_id: user.id,
              role: 'user',
              content: msg,
              created_at: new Date().toISOString(),
            },
          ]);
        }
      }
    } catch (preErr) {
      if (isCurrent()) {
        sendingRef.current = false;
        setSending(false);
        setShowTyping(false);
        setPipelineStage(null);
        setInputError('We couldn\'t start the conversation — try again?');
      }
      return;
    }
    if (!conv || !user) return;
    const convId = conv.id;

    // Upload attachments (if any) + link them to the new user message.
    const attachmentRows: ChatAttachmentRow[] = [];
    if (drafts.length > 0) {
      try {
        for (const draft of drafts) {
          const row = await uploadChatAttachment(user.id, draft, userMsgId ?? '', convId);
          attachmentRows.push(row);
        }
      } catch (uploadErr) {
        const upMsg = uploadErr instanceof Error ? uploadErr.message : 'Upload failed';
        if (isCurrent()) {
          setSending(false);
          sendingRef.current = false;
          setShowTyping(false);
          setInputError(upMsg);
        }
        return;
      }
    }

    const history = [...messages, { role: 'user' as const, content: msg }].map(
      (m) => ({ role: m.role, content: m.content })
    );

    try {
      // ── Attachment path: Gemini multimodal analysis. Kept inline here —
      //    this branch ONLY runs for fresh sends (attachments aren't a thing
      //    for Edit or Regenerate because the original message had no files).
      if (attachmentRows.length > 0) {
        const result = await callEdgeFunction<ChatAttachmentResult>('chat-attachment', {
          action: 'analyze',
          message: msg,
          attachments: attachmentPayload(attachmentRows),
        });
        if (!isCurrent()) return;
        setShowTyping(false);
        await supabase.from('conversation_messages').insert({
          conversation_id: convId,
          user_id: user.id,
          role: 'assistant',
          content: result.reply,
        });
        if (isCurrent()) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              conversation_id: convId,
              user_id: user.id,
              role: 'assistant',
              content: result.reply,
              created_at: new Date().toISOString(),
            },
          ]);
        }
        loadHistory(user.id);
      } else {
        // Standard path — delegate to the shared pipeline used by Edit
        // and Regenerate. Same edge-function calls, same persistence shape.
        await runAssistantReply({
          userText: msg,
          history,
          convId,
          isCurrent,
        });
      }
    } catch (err) {
      // runAssistantReply handles its own errors; this catch is only for the
      // attachment branch (which doesn't go through the pipeline).
      const errMsg =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      if (isCurrent()) {
        setPipelineStage(null);
        setShowTyping(false);
        setInputError('We couldn\'t process that — try again?');
      }
      try {
        await supabase.from('conversation_messages').insert({
          conversation_id: convId,
          user_id: user.id,
          role: 'assistant',
          content: errMsg,
        });
        if (!isCurrent()) return;
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            conversation_id: convId,
            user_id: user.id,
            role: 'assistant',
            content: errMsg,
            created_at: new Date().toISOString(),
          },
        ]);
      } catch {
        // ignore
      }
    } finally {
      // ALWAYS reset the busy flags — even if a nested catch threw, this
      // runs and unfreezes the composer.
      if (isCurrent()) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  };

  // Start a brand-new chat from any in-app "New chat" window event. The
  // sidebar's pill navigates via ?new=1 (handled in the URL effect above),
  // but this listener keeps window-event callers working too.
  useEffect(() => {
    const onNewChat = () => newConversation();
    window.addEventListener('ideon:new-chat', onNewChat);
    return () => window.removeEventListener('ideon:new-chat', onNewChat);
  }, [newConversation]);

  const hasActiveChat = activeConv !== null || messages.length > 0 || sending;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl animate-fade-in flex-1 flex-col">
      {checkinModal && (
        <CheckinDetailModal checkin={checkinModal} onClose={() => setCheckinModal(null)} />
      )}
      {loadingCheckin && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm"
        >
          <IdeonLoader
            label="Loading check-in"
            sublabel="Fetching your check-in…"
            size="sm"
          />
        </div>
      )}

      {/* ── Chat interface (pure chat, Gemini-style) ──
           Two distinct layouts, never animated between:
           • Welcome (centered): flex-1 + justify-center so the hero + composer
             sit in the vertical middle.
           • Active chat: flex-col with messages as flex-1 overflow-y-auto and
             the composer pinned at the bottom with shrink-0. No spacers, no
             flex-grow transitions — the shift is instant the moment
             hasActiveChat flips. */}
      {hasActiveChat ? (
        /* ── Active chat — explicit flex column: messages take all free space,
               composer shrinks to its natural height and sits at the bottom.
               No sticky positioning needed — the flex layout handles it. ── */
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            ref={messagesRef}
            className="min-h-0 flex-1 space-y-0 overflow-y-auto px-0.5 pt-4 pb-4 sm:px-1"
            aria-live="polite"
            aria-atomic="false"
          >
            {messages.map((m) => (
              <ChatMessageRow
                key={m.id}
                role={m.role}
                content={m.content}
                controls={{
                  onCopy: () => handleCopyMessage(m.id, m.content),
                  onEdit:
                    m.role === 'user'
                      ? () => handleStartEdit(m.id, m.content)
                      : undefined,
                  onRegenerate:
                    m.role === 'assistant'
                      ? () => handleRegenerate(m.id)
                      : undefined,
                  onThumbsUp:
                    m.role === 'assistant'
                      ? () => handleThumbsVote(m.id, 'up')
                      : undefined,
                  onThumbsDown:
                    m.role === 'assistant'
                      ? () => handleThumbsVote(m.id, 'down')
                      : undefined,
                  copyState: copiedId === m.id ? 'copied' : 'idle',
                  feedbackState: feedback[m.id] ?? 'idle',
                  isProcessing:
                    m.role === 'assistant' && processingMessageId === m.id,
                  isEditing: editingId === m.id,
                  editDraft: editingId === m.id ? editDraft : '',
                  onEditDraftChange: (v) => setEditDraft(v),
                  onEditConfirm: handleConfirmEdit,
                  onEditCancel: handleCancelEdit,
                }}
              />
            ))}
            {loadingConversation && (
              <div className="flex justify-center py-8 animate-message-in">
                <IdeonLoader
                  label="Loading conversation"
                  sublabel="Fetching your messages…"
                  size="sm"
                />
              </div>
            )}
            {pipelineStage && <PipelineLoading stage={pipelineStage} />}
            {showTyping && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
          {/* Composer: shrink-0 keeps it at its natural height; flex column places
              it at the bottom — no sticky needed, no z-index fight */}
          <div className="shrink-0 bg-background/95 pt-1.5 pb-2.5 backdrop-blur">
            <ChatInputBox
              value={input}
              onChange={(v) => {
                setInput(v);
                if (inputError) setInputError(null);
              }}
              onSend={handleSend}
              disabled={sending}
              sending={sending}
              inputError={inputError}
              textareaRef={textareaRef}
              attachments={attachments}
              onAttachFiles={handleAttachFiles}
              onRemoveAttachment={handleRemoveAttachment}
            />
          </div>
        </div>
      ) : (
        /* ── Welcome state — vertically centered hero + composer ── */
        <div className="flex flex-1 flex-col items-center justify-center px-1 text-center sm:px-2">
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
            <span className="group mb-4 flex h-14 w-14 cursor-pointer items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary shadow-sm ring-1 ring-primary/10 transition-all duration-300 hover:scale-110 hover:from-primary/25 hover:to-primary/10 hover:shadow-lg hover:shadow-primary/20">
              <LogoMark className="h-6 w-6 transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110" />
            </span>
            <h1 className="font-heading text-2xl font-bold tracking-tight">
              Hello! What can I help you build?
            </h1>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
              {isGuest
                ? 'Try it out as a guest — sign up to keep your conversations and plans across devices.'
                : 'Ask me anything about your business. Describe an idea for a full researched plan, or ask for idea suggestions in any industry.'}
            </p>
            {/* ── Example prompt chips (Part E): one click fills the input ── */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {[
                'A meal-prep service for busy professionals',
                'Idea suggestions in fitness',
                'Explain how pricing strategy works',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setInput(suggestion);
                    setInputError(null);
                    textareaRef.current?.focus();
                  }}
                  className="cursor-pointer rounded-full border border-border bg-surface/60 px-3.5 py-1.5 text-xs font-medium text-muted transition-all duration-200 hover:border-primary/40 hover:bg-primary/5 hover:text-primary active:scale-[0.97]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            {/* Composer inside the centered group, directly below the heading */}
            <div className="mt-5 w-full max-w-2xl">
              <ChatInputBox
                value={input}
                onChange={(v) => {
                  setInput(v);
                  if (inputError) setInputError(null);
                }}
                onSend={handleSend}
                disabled={sending}
                sending={sending}
                inputError={inputError}
                textareaRef={textareaRef}
                attachments={attachments}
                onAttachFiles={handleAttachFiles}
                onRemoveAttachment={handleRemoveAttachment}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}