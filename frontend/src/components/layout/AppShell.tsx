"use client";

/**
 * AppShell — unified sidebar layout.
 *
 * The left sidebar contains:
 * - App logo + name
 * - New conversation button (when on chat)
 * - Conversation list (when on chat)
 * - Nav links: Chat, Document library (members only), Settings, Admin
 *
 * This replaces the previous two-sidebar design where conversations
 * were in a separate inner sidebar only visible on the chat page.
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  MessageSquare,
  FileText,
  Settings,
  Shield,
  BarChart3,
  LogOut,
  Menu,
  X,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Edit2,
  Check,
  MoreHorizontal,
  Bell,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { chatApi } from "@/lib/api/chat";
import { AmbientMotion } from "@/components/ui/AmbientMotion";
import { cn } from "@/lib/utils/cn";
import { truncate } from "@/lib/utils/format";
import { api } from "@/lib/api/client";
import { useHistoryNavigation } from "@/lib/hooks/useHistoryNavigation";
import type { Conversation } from "@/types";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  /** Rendered only for non-admin users (e.g. the document library page). */
  memberOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/chat",      label: "Chat",      icon: <MessageSquare className="w-4 h-4" /> },
  {
    href: "/documents",
    label: "Documents",
    icon: <FileText className="w-4 h-4" />,
    // Admins manage documents inside the Admin area instead.
    memberOnly: true,
  },
  { href: "/analytics", label: "Analytics", icon: <BarChart3 className="w-4 h-4" /> },
  { href: "/settings",  label: "Settings",  icon: <Settings className="w-4 h-4" /> },
  { href: "/admin",     label: "Admin",     icon: <Shield className="w-4 h-4" />, adminOnly: true },
];

interface AppShellProps {
  children: React.ReactNode;
  activeConversationId?: string | null;
  onConversationSelect?: (id: string) => void;
  onNewConversation?: () => void;
  conversationRefreshTrigger?: number;
}

export function AppShell({
  children,
  activeConversationId,
  onConversationSelect,
  onNewConversation,
  conversationRefreshTrigger,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convPage, setConvPage] = useState(1);
  const [convTotal, setConvTotal] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  // Conversation awaiting delete confirmation — deletion is irreversible, so
  // a stray click on the trash icon must never remove a thread outright.
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  // Conversations with an answer still streaming in the chat page. Surfaced
  // as a pulsing dot so background answers stay discoverable after switching.
  const [streamingIds, setStreamingIds] = useState<Record<string, boolean>>({});
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, logout } = useAuth();
  const { canGoBack, canGoForward, goBack, goForward } = useHistoryNavigation();

  const isOnChat = pathname.startsWith("/chat");
  const selectedConversationId = isOnChat
    ? searchParams.get("conversation")
    : null;

  const isAdmin =
    user?.is_platform_admin || user?.organization_role === "org_admin";

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.adminOnly) return isAdmin;
    if (item.memberOnly) return !isAdmin;
    return true;
  });

  const CONV_PAGE_SIZE = 15;

  // Load conversations when on chat page
  const loadConversations = useCallback(async () => {
    if (!isOnChat) return;
    try {
      const result = await chatApi.listConversations(convPage, CONV_PAGE_SIZE);
      setConversations(result.items);
      setConvTotal(result.total);
    } catch {
      // non-fatal
    }
  }, [isOnChat, convPage]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations, conversationRefreshTrigger]);

  // Coming back to chat always restarts at the newest page.
  useEffect(() => {
    if (isOnChat) setConvPage(1);
  }, [isOnChat]);

  const handleNewConversation = useCallback(async () => {
    if (onNewConversation) {
      onNewConversation();
    } else {
      try {
        const conv = await chatApi.createConversation();
        setConvTotal((prev) => prev + 1);
        setConvPage(1);
        setConversations((prev) => [conv, ...prev]);
        router.push(`/chat?conversation=${conv.id}`);
      } catch {}
    }
  }, [onNewConversation, router]);

  // Ctrl/Cmd+K starts a new chat from the keyboard while the chat page is open.
  useEffect(() => {
    if (!isOnChat) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        void handleNewConversation();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOnChat, handleNewConversation]);

  // The chat page broadcasts when a stream starts/stops so this sidebar can
  // show which threads are still answering.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ conversationId?: string; active?: boolean }>).detail;
      if (!detail?.conversationId) return;
      setStreamingIds((prev) => {
        const next = { ...prev };
        if (detail.active) next[detail.conversationId!] = true;
        else delete next[detail.conversationId!];
        return next;
      });
    };
    window.addEventListener("fikra:stream-state", handler);
    return () => window.removeEventListener("fikra:stream-state", handler);
  }, []);

  // Escape dismisses the delete confirmation without deleting anything.
  useEffect(() => {
    if (!deleteTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDeleteTarget(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteTarget]);

  const performDelete = useCallback(async (id: string) => {
    const wasActive = id === (selectedConversationId ?? activeConversationId);
    await chatApi.deleteConversation(id).catch(() => {});
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setConvTotal((prev) => Math.max(0, prev - 1));
    setStreamingIds((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // The chat page tears down any live stream and per-session UI state for
    // this conversation so nothing from it can linger on screen.
    window.dispatchEvent(new CustomEvent("fikra:conv-deleted", { detail: id }));
    if (wasActive) {
      // A deleted conversation must not stay open — land on a fresh chat.
      // Dropping the query param resets the page to a new, empty session.
      router.replace("/chat");
    }
  }, [selectedConversationId, activeConversationId, router]);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const target = conversations.find((c) => c.id === id);
    if (target) setDeleteTarget(target);
  };

  const handleRename = async (id: string) => {
    if (!editTitle.trim()) { setEditingId(null); return; }
    try {
      const updated = await chatApi.renameConversation(id, editTitle.trim());
      setConversations((prev) => prev.map((c) => c.id === id ? updated : c));
    } catch {}
    setEditingId(null);
  };

  const sidebarContent = (isMobile = false) => (
    <div className="flex flex-col h-full">
      {/* Logo — clicking it expands the mini sidebar; the collapse control lives beside the name */}
      <div
        className={cn(
          "flex items-center h-14 border-b border-surface-800 gap-3 flex-shrink-0",
          collapsed && !isMobile ? "justify-center px-2" : "px-4"
        )}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Open sidebar"
          aria-label="Open sidebar"
          className="flex-shrink-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 hover:bg-brand-600/20 p-1 transition-colors"
        >
          <span className="block w-7 h-7 rounded-lg bg-brand-600/30 border border-brand-500/40 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-brand-400" />
          </span>
        </button>
        <AnimatePresence>
          {(!collapsed || isMobile) && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-sm font-semibold text-surface-100 truncate"
            >
              FIKRA AI
            </motion.span>
          )}
        </AnimatePresence>
        {/* Collapse toggle sits beside the app name with a comfortable gap; the
            mini sidebar keeps only the visible logo. */}
        {!isMobile && !collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="ml-auto rounded-lg p-1.5 text-surface-400 hover:bg-surface-800 hover:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors flex-shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        {isMobile && (
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto text-surface-400 hover:text-surface-100"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Nav items — fully hidden in the collapsed mini sidebar */}
      {(!collapsed || isMobile) && (
        <nav className="px-2 pt-3 space-y-0.5 flex-shrink-0" aria-label="Main navigation">
          {visibleItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => isMobile && setMobileOpen(false)}
                title={item.label}
                className={cn(
                  "flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500",
                  active
                    ? "bg-brand-600/20 text-brand-300"
                    : "text-surface-400 hover:bg-surface-800 hover:text-surface-100"
                )}
                aria-current={active ? "page" : undefined}
              >
                <span className="flex-shrink-0">{item.icon}</span>
                <AnimatePresence>
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    {item.label}
                  </motion.span>
                </AnimatePresence>
              </Link>
            );
          })}
        </nav>
      )}

      {/* Conversations section — shown on chat page */}
      {isOnChat && (!collapsed || isMobile) && (
        <div className="flex-1 flex flex-col min-h-0 mt-3 border-t border-surface-800/60">
          {/* New conversation button */}
          <div className="px-2 py-2 flex-shrink-0">
            <button
              onClick={handleNewConversation}
              title="New conversation (Ctrl+K)"
              aria-keyshortcuts="Control+K Meta+K"
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600/20 hover:bg-brand-600/30 text-brand-300 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 border border-brand-500/20"
            >
              <Plus className="w-3.5 h-3.5 flex-shrink-0" />
              New conversation
            </button>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
            {conversations.length === 0 ? (
              <p className="text-xs text-surface-600 text-center py-4 px-2">
                No conversations yet
              </p>
            ) : (
              conversations.map((conv) => (
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  active={conv.id === (selectedConversationId ?? activeConversationId)}
                  streaming={Boolean(streamingIds[conv.id])}
                  editingId={editingId}
                  editTitle={editTitle}
                  onSelect={() => {
                    onConversationSelect?.(conv.id);
                    router.push(`/chat?conversation=${conv.id}`);
                    if (isMobile) setMobileOpen(false);
                  }}
                  onStartEdit={() => { setEditingId(conv.id); setEditTitle(conv.title); }}
                  onEditChange={setEditTitle}
                  onEditConfirm={() => handleRename(conv.id)}
                  onEditCancel={() => setEditingId(null)}
                  onDelete={(e) => handleDelete(conv.id, e)}
                />
              ))
            )}
          </div>

          {/* Conversation pagination */}
          {convTotal > CONV_PAGE_SIZE && (
            <div className="flex items-center justify-between px-3 pb-2 pt-1 text-[11px] text-surface-500 flex-shrink-0">
              <button
                type="button"
                onClick={() => setConvPage((p) => Math.max(1, p - 1))}
                disabled={convPage <= 1}
                className="rounded p-1 hover:bg-surface-800 hover:text-surface-200 disabled:opacity-30 disabled:hover:bg-transparent focus:outline-none focus:ring-2 focus:ring-brand-500"
                aria-label="Previous conversations"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="truncate">
                {convPage} / {Math.max(1, Math.ceil(convTotal / CONV_PAGE_SIZE))} · {convTotal} chats
              </span>
              <button
                type="button"
                onClick={() =>
                  setConvPage((p) =>
                    Math.min(Math.ceil(convTotal / CONV_PAGE_SIZE), p + 1)
                  )
                }
                disabled={convPage >= Math.ceil(convTotal / CONV_PAGE_SIZE)}
                className="rounded p-1 hover:bg-surface-800 hover:text-surface-200 disabled:opacity-30 disabled:hover:bg-transparent focus:outline-none focus:ring-2 focus:ring-brand-500"
                aria-label="Next conversations"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bottom: sign out — hidden with the rest of the mini sidebar */}
      {(!collapsed || isMobile) && (
        <div className="p-2 border-t border-surface-800 space-y-1 flex-shrink-0 mt-auto">
          <button
            onClick={() => logout()}
            className="flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm text-surface-400 hover:bg-surface-800 hover:text-surface-100 w-full focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-screen bg-surface-950 overflow-hidden">
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <motion.aside
        animate={{ width: collapsed ? 64 : 260 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="hidden md:flex flex-col border-r border-cyan-400/10 bg-surface-950/90 backdrop-blur-xl overflow-hidden flex-shrink-0 shadow-[12px_0_55px_rgba(0,0,0,0.22)]"
      >
        {sidebarContent(false)}
      </motion.aside>

      {/* ── Mobile sidebar overlay ───────────────────────────────────────── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 md:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              style={{ transformOrigin: "left center" }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="fixed left-0 top-0 bottom-0 z-50 w-64 bg-surface-900 border-r border-surface-800 flex flex-col md:hidden overflow-hidden"
            >
              {sidebarContent(true)}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Unified top bar: history controls are shared by desktop and mobile */}
        <header className="relative z-30 flex h-14 flex-shrink-0 items-center gap-1.5 border-b border-surface-800 bg-surface-900/70 px-3 backdrop-blur">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-800 hover:text-surface-100 md:hidden"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-1" role="group" aria-label="History navigation">
            <button
              type="button"
              onClick={goBack}
              disabled={!canGoBack}
              title="Go back"
              aria-label="Go back"
              className="rounded-lg border border-surface-800 bg-surface-900 p-1.5 text-surface-300 transition-colors hover:bg-surface-800 hover:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface-900 disabled:hover:text-surface-300"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goForward}
              disabled={!canGoForward}
              title="Go forward"
              aria-label="Go forward"
              className="rounded-lg border border-surface-800 bg-surface-900 p-1.5 text-surface-300 transition-colors hover:bg-surface-800 hover:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface-900 disabled:hover:text-surface-300"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <span className="ml-2 text-sm font-semibold text-surface-100 md:hidden">FIKRA AI</span>

          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
          </div>
        </header>

        <main className="relative flex-1 overflow-hidden">
          {/* Theme-tinted motion graphics sit behind every page. */}
          <AmbientMotion className="z-0" />

          {/* Routes fade in place — no sliding, no layout jump. */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pathname}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="relative z-10 h-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* ── Delete confirmation — deletion is permanent ──────────────────── */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => setDeleteTarget(null)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-conversation-title"
              aria-describedby="delete-conversation-body"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border border-surface-700 bg-surface-900 p-5 shadow-2xl"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10">
                <Trash2 className="h-5 w-5 text-red-400" aria-hidden="true" />
              </div>
              <h2
                id="delete-conversation-title"
                className="mt-4 text-base font-semibold text-surface-100"
              >
                Delete conversation?
              </h2>
              <p id="delete-conversation-body" className="mt-1.5 text-sm text-surface-400">
                <span className="font-medium text-surface-200">
                  “{deleteTarget.title}”
                </span>{" "}
                and all of its messages will be permanently removed. This cannot be
                undone.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  autoFocus
                  onClick={() => setDeleteTarget(null)}
                  className="rounded-lg border border-surface-700 px-3.5 py-2 text-xs font-medium text-surface-300 transition-colors hover:bg-surface-800 hover:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = deleteTarget;
                    setDeleteTarget(null);
                    void performDelete(target.id);
                  }}
                  className="rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

function NotificationBell() {
  const NOTIF_PAGE_SIZE = 10;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [page, setNotifPage] = useState(1);
  const [notifTotal, setNotifTotal] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const data = await api.get<{
        items: NotificationItem[];
        unread: number;
        total: number;
        page: number;
      }>(`/notifications?page=${page}&page_size=${NOTIF_PAGE_SIZE}`);
      setItems(data.items);
      setUnread(data.unread);
      setNotifTotal(data.total ?? data.items.length);
    } catch {
      // A notification outage must never block navigation or chat.
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load, page]);

  // Background refresh only resets to the newest page; if the user paged
  // deeper, appending duplicates must be avoided.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (page === 1) load();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [load, page]);

  const loadOlder = async () => {
    if (loadingOlder) return;
    setLoadingOlder(true);
    try {
      const data = await api.get<{
        items: NotificationItem[];
        unread: number;
        total: number;
      }>(`/notifications?page=${page + 1}&page_size=${NOTIF_PAGE_SIZE}`);
      setItems((current) => {
        const seen = new Set(current.map((entry) => entry.id));
        return [...current, ...data.items.filter((entry) => !seen.has(entry.id))];
      });
      setNotifPage((value) => value + 1);
      setNotifTotal(data.total ?? 0);
    } catch {
      // non-fatal
    } finally {
      setLoadingOlder(false);
    }
  };

  const openItem = async (item: NotificationItem) => {
    if (!item.is_read) {
      await api.patch(`/notifications/${item.id}/read`).catch(() => {});
      setUnread((value) => Math.max(0, value - 1));
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry));
    }
    if (item.link) router.push(item.link);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button onClick={() => { setOpen((value) => !value); if (page !== 1) { setNotifPage(1); } else { load(); } }} className="relative rounded-xl border border-surface-700 bg-surface-900/90 p-2 text-surface-300 shadow-lg backdrop-blur hover:text-cyan-300" aria-label="Notifications">
        <Bell className="h-4 w-4" />
        {unread > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-brand-500 px-1 text-center text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl">
          <p className="border-b border-surface-800 px-3 py-2 text-xs font-semibold text-surface-200">
            Notifications
            {notifTotal > NOTIF_PAGE_SIZE && (
              <span className="ml-2 font-normal text-surface-500">
                {items.length} of {notifTotal}
              </span>
            )}
          </p>
          <div className="max-h-96 overflow-y-auto">
            {items.length ? items.map((item) => (
              <button key={item.id} onClick={() => openItem(item)} className={cn("block w-full border-b border-surface-800/70 px-3 py-3 text-left hover:bg-surface-800", !item.is_read && "bg-brand-500/5")}>
                <p className="text-xs font-medium text-surface-100">{item.title}</p>
                <p className="mt-0.5 text-xs text-surface-400">{item.body}</p>
              </button>
            )) : <p className="px-3 py-7 text-center text-xs text-surface-500">You’re all caught up.</p>}
          </div>
          {items.length < notifTotal && (
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingOlder}
              className="block w-full border-t border-surface-800 px-3 py-2.5 text-center text-[11px] font-medium text-brand-300 hover:bg-surface-800 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {loadingOlder ? "Loading…" : "Show older notifications"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Conversation item component ─────────────────────────────────────────────

function ConversationItem({
  conv, active, streaming, editingId, editTitle,
  onSelect, onStartEdit, onEditChange, onEditConfirm, onEditCancel, onDelete,
}: {
  conv: Conversation;
  active: boolean;
  streaming: boolean;
  editingId: string | null;
  editTitle: string;
  onSelect: () => void;
  onStartEdit: () => void;
  onEditChange: (v: string) => void;
  onEditConfirm: () => void;
  onEditCancel: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const isEditing = editingId === conv.id;
  const [showActions, setShowActions] = useState(false);

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      className={cn(
        "group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors text-xs",
        active
          ? "bg-brand-600/20 text-brand-200"
          : "text-surface-400 hover:bg-surface-800 hover:text-surface-100"
      )}
    >
      {streaming ? (
        <span
          className="relative flex h-2 w-2 flex-shrink-0"
          aria-label="Response streaming"
          title="Response streaming"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300" />
        </span>
      ) : (
        <MessageSquare className="w-3 h-3 flex-shrink-0 opacity-50" />
      )}

      {isEditing ? (
        <input
          autoFocus
          value={editTitle}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onEditConfirm();
            if (e.key === "Escape") onEditCancel();
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 bg-surface-700 text-surface-100 text-xs rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-brand-500 min-w-0"
        />
      ) : (
        <span className="flex-1 truncate">{conv.title}</span>
      )}

      {/* Action buttons */}
      {!isEditing && (showActions || active) && (
        <div className="flex gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
            className="p-0.5 rounded hover:text-surface-200 hover:bg-surface-700"
            aria-label="Rename"
          >
            <Edit2 className="w-2.5 h-2.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-0.5 rounded hover:text-red-400 hover:bg-surface-700"
            aria-label="Delete"
          >
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        </div>
      )}
      {isEditing && (
        <div className="flex gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={(e) => { e.stopPropagation(); onEditConfirm(); }} className="p-0.5 hover:text-green-400" aria-label="Save">
            <Check className="w-2.5 h-2.5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onEditCancel(); }} className="p-0.5 hover:text-red-400" aria-label="Cancel">
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      )}
    </div>
  );
}
