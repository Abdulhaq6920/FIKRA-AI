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
import { CurrencySwitch } from "@/features/currency/CurrencySwitch";
import { chatApi } from "@/lib/api/chat";
import { cn } from "@/lib/utils/cn";
import { truncate } from "@/lib/utils/format";
import { api } from "@/lib/api/client";
import { useHistoryNavigation } from "@/lib/hooks/useHistoryNavigation";
import { NinjaArtwork } from "@/features/theme/NinjaArtwork";
import { useTheme } from "@/features/theme/ThemeProvider";
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, logout } = useAuth();
  const { definition } = useTheme();
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

  // Load conversations when on chat page
  const loadConversations = useCallback(async () => {
    if (!isOnChat) return;
    try {
      const convs = await chatApi.listConversations();
      setConversations(convs);
    } catch {
      // non-fatal
    }
  }, [isOnChat]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations, conversationRefreshTrigger]);

  const handleNewConversation = async () => {
    if (onNewConversation) {
      onNewConversation();
    } else {
      try {
        const conv = await chatApi.createConversation();
        setConversations((prev) => [conv, ...prev]);
        router.push(`/chat?conversation=${conv.id}`);
      } catch {}
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await chatApi.deleteConversation(id).catch(() => {});
    setConversations((prev) => prev.filter((c) => c.id !== id));
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
            {definition.artwork ? (
              <NinjaArtwork variant={definition.artwork} className="h-6 w-7" />
            ) : (
              <Sparkles className="w-4 h-4 text-brand-400" />
            )}
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
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
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
            <CurrencySwitch />
            <NotificationBell />
          </div>
        </header>

        <main className="relative flex-1 overflow-hidden">
          {children}
          {/* Decorative only. Hidden on chat so it never competes with the composer. */}
          {definition.artwork && !isOnChat && (
            <NinjaArtwork
              variant={definition.artwork}
              className="theme-watermark fixed bottom-3 right-2 z-20 hidden h-52 w-64 lg:block"
            />
          )}
        </main>
      </div>
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
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ items: NotificationItem[]; unread: number }>("/notifications?page_size=10");
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      // A notification outage must never block navigation or chat.
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 15_000);
    return () => window.clearInterval(id);
  }, [load]);

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
      <button onClick={() => { setOpen((value) => !value); load(); }} className="relative rounded-xl border border-surface-700 bg-surface-900/90 p-2 text-surface-300 shadow-lg backdrop-blur hover:text-cyan-300" aria-label="Notifications">
        <Bell className="h-4 w-4" />
        {unread > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-brand-500 px-1 text-center text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl">
          <p className="border-b border-surface-800 px-3 py-2 text-xs font-semibold text-surface-200">Notifications</p>
          {items.length ? items.map((item) => (
            <button key={item.id} onClick={() => openItem(item)} className={cn("block w-full border-b border-surface-800/70 px-3 py-3 text-left hover:bg-surface-800", !item.is_read && "bg-brand-500/5")}>
              <p className="text-xs font-medium text-surface-100">{item.title}</p>
              <p className="mt-0.5 text-xs text-surface-400">{item.body}</p>
            </button>
          )) : <p className="px-3 py-7 text-center text-xs text-surface-500">You’re all caught up.</p>}
        </div>
      )}
    </div>
  );
}

// ─── Conversation item component ─────────────────────────────────────────────

function ConversationItem({
  conv, active, editingId, editTitle,
  onSelect, onStartEdit, onEditChange, onEditConfirm, onEditCancel, onDelete,
}: {
  conv: Conversation;
  active: boolean;
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
      <MessageSquare className="w-3 h-3 flex-shrink-0 opacity-50" />

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
