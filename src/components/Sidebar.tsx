import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { ensureHistory, loadHistory, useHistory } from '@/lib/historyStore';
import { useAuth } from '@/hooks/useAuth';
import { useAuthTransition } from '@/hooks/useAuthTransition';
import { useTheme } from '@/hooks/useTheme';
import { useSidebarState } from '@/hooks/useSidebar';
import LogoMark from '@/components/LogoMark';
import type { CheckinRow, ConversationRow } from '@/types';
import {
  BarChart3,
  Bot,
  CalendarDays,
  LayoutDashboard,
  Loader2,
  LogOut,
  MessageSquare,
  Moon,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Settings,
  Sun,
  Trash2,
  X,
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/checkin', label: 'Check-In', icon: CalendarDays },
];

/** Small app icon badge, used at the top of the sidebar in both states. */
function AppIcon() {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-on-primary shadow-sm shadow-primary/20">
      <LogoMark />
    </span>
  );
}

/** Floating tooltip shown to the right of an icon when the sidebar is collapsed. */
function Tooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs font-medium text-foreground opacity-0 shadow-elevated transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
    >
      {label}
    </span>
  );
}

const MOODS = [
  { value: 1, emoji: '😞', label: 'Rough' },
  { value: 2, emoji: '😕', label: 'Meh' },
  { value: 3, emoji: '😐', label: 'Okay' },
  { value: 4, emoji: '🙂', label: 'Good' },
  { value: 5, emoji: '🤩', label: 'Great' },
];

function formatListDate(d: string): string {
  return new Date(d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

type HistoryEntry =
  | { type: 'chat'; row: ConversationRow }
  | { type: 'checkin'; row: CheckinRow };

/** One row in the sidebar's Recent list — chat or check-in, with a 3-dot menu. */
function HistoryRow({
  entry,
  active = false,
  onOpen,
  onChanged,
}: {
  entry: HistoryEntry;
  active?: boolean;
  onOpen: (entry: HistoryEntry) => void;
  onChanged: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{
    left: number;
    anchorTop: number;
    anchorBottom: number;
    openUp: boolean;
  } | null>(null);

  const isChat = entry.type === 'chat';
  const row = entry.row as ConversationRow;
  const checkin = entry.row as CheckinRow;
  const title =
    (isChat ? row.title : checkin.title)?.trim() ||
    (isChat
      ? 'Untitled conversation'
      : formatListDate(checkin.checkin_date));

  const closeMenu = () => {
    setMenuOpen(false);
    setConfirmingDelete(false);
  };

  // Position the portal menu against the 3-dot button and open it. Position is
  // derived from the button's viewport rect, flips upward when there isn't
  // enough room below, and is clamped inside the window horizontally.
  const openMenu = () => {
    const btn = menuButtonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const MENU_W = 208; // w-52
    const EST_H = 160; // tallest state (delete confirmation)
    const GAP = 6;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < EST_H + GAP * 2 && rect.top >= spaceBelow;
    const left = Math.max(
      0,
      Math.min(rect.right - MENU_W, window.innerWidth - MENU_W - GAP)
    );
    setMenuPos({ left, anchorTop: rect.top, anchorBottom: rect.bottom, openUp });
    setMenuOpen(true);
  };

  // Close on outside click / Escape / scroll / resize; return focus to trigger.
  // The menu renders in a portal at <body> level (so the history list's
  // overflow-y-auto can never clip it), therefore the outside-click check must
  // exclude BOTH the row wrapper and the portal menu itself.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMenu();
        menuButtonRef.current?.focus();
      }
    };
    const onScrollOrResize = () => closeMenu();
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [menuOpen]);

  // Arrow-key navigation between menu items (WAI-ARIA menu pattern).
  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []
    );
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items[next].focus();
  };

  const startRename = () => {
    setRenameValue(isChat ? row.title ?? '' : checkin.title ?? '');
    setMenuOpen(false);
    setRenaming(true);
  };

  const saveRename = async () => {
    if (!renaming) return;
    const value = renameValue.trim() || null;
    setRenaming(false);
    const prev = isChat ? row.title : checkin.title;
    if (value === prev) return;
    if (isChat) {
      await supabase.from('conversations').update({ title: value }).eq('id', row.id);
    } else {
      await supabase.from('daily_checkins').update({ title: value }).eq('id', checkin.id);
    }
    onChanged();
  };

  const togglePin = async () => {
    const next = !(isChat ? row.is_pinned : checkin.is_pinned);
    if (isChat) {
      await supabase.from('conversations').update({ is_pinned: next }).eq('id', row.id);
    } else {
      await supabase.from('daily_checkins').update({ is_pinned: next }).eq('id', checkin.id);
    }
    setMenuOpen(false);
    onChanged();
  };

  const handleDelete = async () => {
    if (isChat) {
      await supabase.from('conversation_messages').delete().eq('conversation_id', row.id);
      await supabase.from('conversations').delete().eq('id', row.id);
    } else {
      await supabase.from('daily_checkins').delete().eq('id', checkin.id);
    }
    closeMenu();
    onChanged();
    // If the user just deleted the chat that's open, reset the dashboard.
    if (isChat) {
      window.dispatchEvent(new CustomEvent('ideon:conversation-deleted', { detail: { id: row.id } }));
    }
  };

  return (
    <li className="group relative overflow-hidden">
      <div
        ref={wrapperRef}
        className={`flex items-center gap-1 rounded-lg transition-colors duration-150 ${
          menuOpen
            ? 'bg-surface-hover'
            : active
              ? 'bg-primary/10'
              : 'hover:bg-surface-hover'
        }`}
      >
        <button
          type="button"
          onClick={() => onOpen(entry)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg py-1.5 pl-3 pr-1 text-left"
          title={title}
        >
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 ${
              active ? 'text-primary' : 'text-muted'
            }`}
          >
            {isChat ? (
              <Bot className="h-4 w-4" />
            ) : (
              <span className="text-sm" aria-hidden="true">
                {MOODS.find((m) => m.value === checkin.mood)?.emoji ?? '😐'}
              </span>
            )}
          </span>
          {renaming ? (
            <span className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={saveRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveRename();
                  if (e.key === 'Escape') setRenaming(false);
                }}
                aria-label="Name this item"
                placeholder="Name…"
                className="w-full rounded-md border border-primary/40 bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </span>
          ) : (
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span
                  className={`truncate text-sm transition-colors duration-150 ${
                    active ? 'font-medium text-foreground' : 'text-foreground/85'
                  }`}
                >
                  {title}
                </span>
                {(isChat ? row.is_pinned : checkin.is_pinned) && (
                  <Pin className="h-3 w-3 shrink-0 text-primary" />
                )}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted/70">
                {isChat ? formatListDate(row.updated_at) : formatListDate(checkin.checkin_date)}
                {!isChat && checkin.notes ? ` · ${checkin.notes}` : ''}
              </span>
            </span>
          )}
        </button>

        <div className="relative shrink-0">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => (menuOpen ? closeMenu() : openMenu())}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Options for ${title}`}
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg transition-all duration-150 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
              menuOpen
                ? 'bg-surface text-foreground opacity-100'
                : active
                  ? 'text-muted opacity-70 group-hover:opacity-100 focus-visible:opacity-100'
                  : 'text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
            }`}
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {menuOpen &&
            menuPos &&
            createPortal(
              <div
                ref={menuRef}
                role="menu"
                aria-label={`Actions for ${title}`}
                onKeyDown={handleMenuKeyDown}
                className="fixed z-50 w-52 animate-fade-in rounded-xl border border-border/80 bg-surface-elevated p-1.5 shadow-elevated"
                style={
                  menuPos.openUp
                    ? { left: menuPos.left, bottom: window.innerHeight - menuPos.anchorTop + 6 }
                    : { left: menuPos.left, top: menuPos.anchorBottom + 6 }
                }
              >
              {confirmingDelete ? (
                <div className="p-2">
                  <p className="text-sm font-medium text-foreground">
                    Delete this {isChat ? 'conversation' : 'check-in'}?
                  </p>
                  <p className="mt-0.5 text-xs text-muted">This can't be undone.</p>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                      className="flex-1 cursor-pointer rounded-lg border border-border px-2 py-1.5 text-xs font-semibold text-muted transition-all duration-150 hover:border-primary/40 hover:text-foreground active:scale-[0.97]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-destructive px-2 py-1.5 text-xs font-semibold text-white transition-all duration-150 hover:bg-destructive/90 active:scale-[0.97]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button type="button" role="menuitem" onClick={startRename} className={menuItemClass}>
                    <Pencil className="h-4 w-4" />
                    Rename
                  </button>
                  <button type="button" role="menuitem" onClick={togglePin} className={menuItemClass}>
                    {isChat ? row.is_pinned : checkin.is_pinned ? (
                      <PinOff className="h-4 w-4" />
                    ) : (
                      <Pin className="h-4 w-4" />
                    )}
                    {isChat ? row.is_pinned : checkin.is_pinned ? 'Unpin' : 'Pin to top'}
                  </button>
                  <div className="my-1 h-px bg-border" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setConfirmingDelete(true)}
                    className={`${menuItemClass} text-destructive hover:bg-destructive/10 hover:text-destructive`}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </>
              )}
              </div>,
              document.body
            )}
        </div>
      </div>
    </li>
  );
}

const menuItemClass =
  'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

interface SidebarContentProps {
  collapsed: boolean;
  onNavigate?: () => void;
  onToggleCollapse?: () => void;
  showCloseButton?: boolean;
  onClose?: () => void;
}

/** Shared nav content, rendered by both the desktop rail and the mobile drawer. */
function SidebarContent({
  collapsed,
  onNavigate,
  onToggleCollapse,
  showCloseButton,
  onClose,
}: SidebarContentProps) {
  const { user, signingOut } = useAuth();
  const { signOutWithTransition } = useAuthTransition();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // Shared history store: conversations, check-ins and ideas all live here,
  // loaded once per session — no refetching on every route change.
  const { conversations, checkins } = useHistory();

  useEffect(() => {
    if (user) ensureHistory(user.id);
  }, [user]);

  // Refresh the store after sidebar-driven mutations (rename/pin/delete).
  const refreshHistory = () => {
    if (user) void loadHistory(user.id);
  };

  // Merge chats and check-ins into one recents list, pinned first then by recency.
  const entries = useMemo<HistoryEntry[]>(() => {
    const merged: HistoryEntry[] = [
      ...conversations.map((row) => ({ type: 'chat' as const, row })),
      ...checkins.map((row) => ({ type: 'checkin' as const, row })),
    ].sort((a, b) => {
      const aPin = a.type === 'chat' ? a.row.is_pinned : (a.row as CheckinRow).is_pinned;
      const bPin = b.type === 'chat' ? b.row.is_pinned : (b.row as CheckinRow).is_pinned;
      if (aPin !== bPin) return aPin ? -1 : 1;
      const aDate =
        a.type === 'chat'
          ? new Date((a.row as ConversationRow).updated_at).getTime()
          : new Date((a.row as CheckinRow).checkin_date).getTime();
      const bDate =
        b.type === 'chat'
          ? new Date((b.row as ConversationRow).updated_at).getTime()
          : new Date((b.row as CheckinRow).checkin_date).getTime();
      return bDate - aDate;
    });
    return merged;
  }, [conversations, checkins]);

  // Close profile dropdown on outside click / Escape
  useEffect(() => {
    if (!profileOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [profileOpen]);

  const handleSignOut = async () => {
    // The branded overlay appears IMMEDIATELY (before the network sign-out),
    // the session is cleared under the cover, and the landing page is revealed
    // once rendered — no dead wait, no stale-closure 3s failsafe (see
    // useAuthTransition.signOutWithTransition). Layout's user→null effect is
    // suppressed so it never stacks a second overlay.
    setProfileOpen(false);
    await signOutWithTransition();
  };

  const userInitial = (
    user?.user_metadata?.full_name?.charAt(0) ?? user?.email?.charAt(0) ?? '?'
  ).toUpperCase();
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;
  const userName = (user?.user_metadata?.full_name as string) ?? 'User';

  const openEntry = (entry: HistoryEntry) => {
    onNavigate?.();
    if (entry.type === 'chat') {
      navigate(`/dashboard?conversation=${entry.row.id}`);
    } else {
      navigate(`/dashboard?checkin=${entry.row.id}`);
    }
  };

  // Start a fresh chat: navigate to the Dashboard and ask it to reset to the
  // welcome state. Uses the ?new=1 deep-link (handled in Dashboard's URL
  // effect) instead of a window event, so it works from any page — not just
  // when the Dashboard is already mounted.
  const handleNewChat = () => {
    onNavigate?.();
    navigate('/dashboard?new=1');
  };

  const navLinkClass = (isActive: boolean, isCollapsed: boolean) =>
    `group/tip relative flex items-center gap-3 text-sm font-medium transition-all duration-200 ${
      isCollapsed ? 'h-11 w-11 justify-center' : 'rounded-lg px-3 py-2'
    } ${
      isActive
        ? 'rounded-lg bg-primary/10 font-medium text-primary'
        : 'rounded-lg text-muted hover:bg-surface-hover hover:text-foreground'
    }`;

  return (
    <div className="flex h-full w-full flex-col">
      {/* ── Top: app icon + name + collapse toggle ── */}
      <div
        className={`flex h-16 shrink-0 items-center border-b border-border/80 ${
          collapsed ? 'justify-center px-2' : 'justify-between px-4'
        }`}
      >
        {collapsed ? (
          // Gemini-style: the logo itself becomes the expand toggle on hover.
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="group/expand flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl transition-all duration-200 hover:bg-surface-hover active:scale-95"
          >
            <LogoMark className="h-5 w-5 text-primary transition-transform duration-200 group-hover/expand:rotate-90 group-hover/expand:scale-110" />
          </button>
        ) : (
          <>
            <span className="flex min-w-0 items-center gap-2.5">
              <AppIcon />
              <span className="truncate font-heading text-lg font-semibold tracking-tight">
                Ideon
              </span>
            </span>
            {showCloseButton ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close menu"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground active:scale-90"
              >
                <X className="h-5 w-5" />
              </button>
            ) : (
              onToggleCollapse && (
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  aria-label="Collapse sidebar"
                  title="Collapse sidebar"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground active:scale-90"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              )
            )}
          </>
        )}
      </div>

      {/* ── Nav items: New chat pill first (Gemini-style), then core pages ── */}
      <nav
        aria-label="Main"
        className={`flex shrink-0 flex-col gap-1.5 pt-4 ${collapsed ? 'items-center px-2' : 'px-3'}`}
      >
        {/* New chat — the primary action, but refined: a calm tinted pill
            (no loud gradient/glow) in both the expanded and collapsed states. */}
        <button
          type="button"
          onClick={handleNewChat}
          className={`group/tip relative flex cursor-pointer items-center gap-2.5 text-sm font-medium transition-all duration-200 active:scale-[0.98] ${
            collapsed
              ? 'h-11 w-11 justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary hover:border-primary/30 hover:bg-primary/15'
              : 'rounded-lg border border-primary/15 bg-primary/10 px-3 py-2 text-primary hover:border-primary/25 hover:bg-primary/15'
          }`}
        >
          <Plus className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
          {!collapsed && <span className="truncate">New chat</span>}
          {collapsed && <Tooltip label="New chat" />}
        </button>
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.to === '/dashboard'
              ? location.pathname === '/dashboard' &&
                !location.search.includes('conversation=') &&
                !location.search.includes('checkin=')
              : location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              aria-current={isActive ? 'page' : undefined}
              className={navLinkClass(isActive, collapsed)}
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {collapsed && <Tooltip label={item.label} />}
            </Link>
          );
        })}
      </nav>

      {/* ── History (always-visible Recent list, Gemini-style) ── */}
      {!collapsed && (
        <div className="mt-5 flex min-h-0 flex-1 flex-col px-3">
          <h2 className="mb-2 flex items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted/60">
            <MessageSquare className="h-3.5 w-3.5" />
            History
          </h2>
          {entries.length === 0 ? (
            <p className="flex-1 px-3 py-2 text-xs leading-relaxed text-muted/60">
              Your chats and check-ins will show up here.
            </p>
          ) : (
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-2">
              {entries.map((entry) => (
                <HistoryRow
                  key={entry.type === 'chat' ? `c-${entry.row.id}` : `k-${entry.row.id}`}
                  entry={entry}
                  active={
                    entry.type === 'chat'
                      ? location.search.includes(`conversation=${entry.row.id}`)
                      : location.search.includes(`checkin=${entry.row.id}`)
                  }
                  onOpen={openEntry}
                  onChanged={refreshHistory}
                />
              ))}
            </ul>
          )}
        </div>
      )}
      {collapsed && (
        <div className="mt-4 flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto pb-2">
          {entries.length > 0 ? (
            entries.slice(0, 8).map((entry) => {
              const isChat = entry.type === 'chat';
              const title = isChat
                ? (entry.row as ConversationRow).title?.trim() ||
                  'Untitled conversation'
                : (entry.row as CheckinRow).title?.trim() ||
                  formatListDate((entry.row as CheckinRow).checkin_date);
              return (
                <button
                  key={isChat ? `c-${entry.row.id}` : `k-${entry.row.id}`}
                  type="button"
                  onClick={() => openEntry(entry)}
                  aria-label={`Open ${title}`}
                  title={title}
                  className="group/tip relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted transition-all duration-150 hover:bg-surface-hover hover:text-primary active:scale-90"
                >
                  {isChat ? (
                    <Bot className="h-4 w-4" />
                  ) : (
                    <span className="text-sm" aria-hidden="true">
                      {MOODS.find((m) => m.value === (entry.row as CheckinRow).mood)?.emoji ?? '😐'}
                    </span>
                  )}
                  <Tooltip label={title} />
                </button>
              );
            })
          ) : (
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted/40"
              aria-hidden="true"
            >
              <MessageSquare className="h-4 w-4" />
            </span>
          )}
        </div>
      )}

      {/* ── Profile ── */}
      <div
        ref={profileRef}
        className={`relative shrink-0 border-t border-border/80 ${
          collapsed ? 'flex justify-center p-2' : 'px-3 py-2'
        }`}
      >
        <button
          type="button"
          onClick={() => setProfileOpen((v) => !v)}
          disabled={signingOut}
          aria-haspopup="true"
          aria-expanded={profileOpen}
          aria-label="Profile menu"
          className={`group/tip relative flex cursor-pointer items-center gap-2.5 rounded-xl text-left transition-all duration-200 hover:bg-surface-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${
            collapsed ? 'h-11 w-11 justify-center' : 'w-full px-3 py-2'
          }`}
        >
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary text-xs font-semibold text-on-primary ring-1 ring-white/15">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
            ) : (
              userInitial
            )}
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {userName}
            </span>
          )}
          {collapsed && <Tooltip label={userName} />}
        </button>

        {/* Dropdown */}
        <div
          className={`absolute bottom-full z-50 mb-2 w-56 origin-bottom overflow-hidden rounded-xl border border-border/80 bg-surface-elevated shadow-elevated transition-all duration-150 ease-out ${
            collapsed ? 'left-full ml-2 mb-0 bottom-0 origin-bottom-left' : 'left-3 right-3'
          } ${profileOpen ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0'}`}
          role="menu"
          aria-label="User menu"
        >
          <div className="border-b border-border/80 px-4 py-3">
            <p className="truncate text-sm font-medium text-foreground">{userName}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
          </div>
          <div className="p-1.5">
            <button
              onClick={toggleTheme}
              disabled={signingOut}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              role="menuitem"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            </button>
            <button
              onClick={() => {
                setProfileOpen(false);
                navigate('/settings');
              }}
              disabled={signingOut}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              role="menuitem"
            >
              <Settings className="h-4 w-4" />
              Settings
            </button>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              aria-busy={signingOut}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-all duration-200 hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-muted"
              role="menuitem"
            >
              {signingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Full-screen branded transition during sign-out (Part A) ── */}
      {/* Intentionally absent: the Sidebar unmounts the instant `user` becomes
          null during sign-out, so an overlay here would never render. Layout
          owns the sign-out transition (see Layout.tsx). */}
    </div>
  );
}

interface SidebarProps {
  /** Controlled collapsed state; falls back to the internally persisted state when omitted. */
  collapsed?: boolean;
  /** Controlled collapse-toggle callback; required when `collapsed` is provided. */
  onToggleCollapse?: () => void;
}

export default function Sidebar({
  collapsed: collapsedProp,
  onToggleCollapse: onToggleProp,
}: SidebarProps = {}) {
  const { collapsed: collapsedInternal, toggle: toggleInternal } = useSidebarState();
  const collapsed = collapsedProp ?? collapsedInternal;
  const toggle = onToggleProp ?? toggleInternal;
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  // Escape closes the mobile drawer and returns focus to the trigger
  useEffect(() => {
    if (!mobileOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [mobileOpen]);

  // Focus the panel when it opens
  useEffect(() => {
    if (mobileOpen) {
      panelRef.current?.focus();
    }
  }, [mobileOpen]);

  return (
    <>
      {/* ── Mobile top bar ── */}
      <div className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-xl md:hidden">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground active:scale-90"
        >
          <PanelLeftOpen className="h-5 w-5" />
        </button>
        <span className="flex items-center gap-2">
          <AppIcon />
          <span className="font-heading text-base font-semibold tracking-tight">Ideon</span>
        </span>
      </div>

      {/* ── Desktop persistent rail ── */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden shrink-0 border-r border-border bg-surface transition-[width] duration-200 ease-out md:flex ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        <SidebarContent collapsed={collapsed} onToggleCollapse={toggle} />
      </aside>

      {/* ── Mobile drawer overlay ── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            data-sidebar-overlay="true"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            data-sidebar-drawer="true"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 w-72 max-w-[80vw] animate-slide-up bg-surface shadow-elevated outline-none"
            style={{ animationName: 'none' }}
          >
            <div className="h-full w-72 max-w-[80vw] translate-x-0 transition-transform duration-200 ease-out">
              <SidebarContent
                collapsed={false}
                onNavigate={() => setMobileOpen(false)}
                showCloseButton
                onClose={() => setMobileOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
