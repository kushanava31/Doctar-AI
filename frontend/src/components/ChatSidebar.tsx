"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SessionSummary } from "@/lib/chatSessions";
import { useAuth } from "@/contexts/AuthContext";

// ── Icons — hand-drawn inline SVGs, matching how every other icon in this
// app is done (ChatInterface.tsx uses no icon library anywhere). ──────────
function MessageSquareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3v5h5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 7v5l3 3" />
    </svg>
  );
}

function ChevronIcon({ className, open }: { className?: string; open: boolean }) {
  return (
    <svg
      className={`${className} transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function DotsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** No date library in this project — a small hand-rolled formatter matches
 * the codebase's existing preference for that over adding a dependency. */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, (Date.now() - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = diffSec / 60;
  if (diffMin < 60) return `${Math.floor(diffMin)}m ago`;
  const diffHr = diffMin / 60;
  if (diffHr < 24) return `${Math.floor(diffHr)}h ago`;
  const diffDay = diffHr / 24;
  if (diffDay < 7) return `${Math.floor(diffDay)}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

interface ChatSidebarProps {
  sessions: SessionSummary[];
  currentSessionId: string | null;
  loading: boolean;
  error: string | null;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
  onRetry: () => void;
  /** Mobile-only drawer state — ignored above the md breakpoint, where the
   * sidebar is always visible inline (see the wrapper's md: classes below). */
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default function ChatSidebar({
  sessions,
  currentSessionId,
  loading,
  error,
  onNewChat,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onRetry,
  mobileOpen,
  onMobileClose,
}: ChatSidebarProps) {
  const { user } = useAuth();

  // Chat/History nav and the Recents section's own chevron drive the SAME
  // toggle — the "simpler to wire" option the visual spec explicitly offered,
  // since there's only ever one conversation pane to show either way.
  const [sidebarView, setSidebarView] = useState<"chat" | "history">("history");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const recentsExpanded = sidebarView === "history";

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  // Close the row menu on outside click.
  useEffect(() => {
    if (!openMenuId) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
        setConfirmDeleteId(null);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [openMenuId]);

  function startRename(session: SessionSummary) {
    setOpenMenuId(null);
    setRenamingId(session.id);
    setRenameValue(session.title);
  }

  function submitRename() {
    const id = renamingId;
    const value = renameValue.trim();
    setRenamingId(null);
    if (id && value) onRenameSession(id, value);
  }

  // On mobile the drawer should get out of the way once its job is done;
  // on desktop onMobileClose is a no-op visually (md:translate-x-0 keeps the
  // sidebar shown regardless of mobileOpen), so wrapping unconditionally is safe.
  function handleNewChat() {
    onNewChat();
    onMobileClose();
  }
  function handleSelectSession(id: string) {
    onSelectSession(id);
    onMobileClose();
  }

  return (
    <>
      {/* Backdrop — mobile drawer only. md:hidden guarantees it never shows
          on desktop even if mobileOpen is stale from a resize. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      {/* Below md: fixed-position slide-in drawer, translated off-screen
          unless mobileOpen. At md and up: back to a normal static flex
          child, always visible — md:translate-x-0 cancels the transform
          regardless of mobileOpen, and md:static takes it out of the
          fixed-overlay stacking context entirely. */}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-72 h-full flex flex-col bg-white border-r border-gray-100 transform transition-transform duration-200 ease-in-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:static md:z-auto md:translate-x-0 md:shrink-0`}
      >
        {/* Mobile-only close row — desktop has no drawer to close. */}
        <div className="flex justify-end p-2 pb-0 md:hidden">
          <button
            onClick={onMobileClose}
            aria-label="Close sidebar"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* New Consultation */}
        <div className="p-3 shrink-0">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center justify-center gap-2 bg-doctar-600 hover:bg-doctar-700 text-white font-bold text-sm py-2.5 rounded-full transition-colors"
          >
            <PlusIcon className="w-4 h-4" />
            New Consultation
          </button>
        </div>

        {/* Nav */}
        <div className="px-3 pb-2 shrink-0 space-y-1">
          <button
            onClick={() => setSidebarView("chat")}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              sidebarView === "chat" ? "bg-doctar-50 text-doctar-700" : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            {/* w-5 h-5, matching the icon-sizing convention used elsewhere in
                the app (e.g. the header's location-pin icon in
                ChatInterface.tsx) — NOT w-4.5, which isn't a real Tailwind
                spacing value. Tailwind silently generates no CSS for an
                invalid utility class rather than erroring, so this rendered
                as a completely unconstrained, container-filling SVG. */}
            <MessageSquareIcon className="w-5 h-5 shrink-0" />
            Chat
          </button>
          <button
            onClick={() => setSidebarView("history")}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              sidebarView === "history" ? "bg-doctar-50 text-doctar-700" : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            <HistoryIcon className="w-5 h-5 shrink-0" />
            History
          </button>
        </div>

      {/* Recents */}
      <div className="flex-1 min-h-0 flex flex-col px-3 pb-3">
        <button
          onClick={() => setSidebarView((v) => (v === "history" ? "chat" : "history"))}
          className="w-full flex items-center justify-between px-1 py-2 shrink-0 text-xs font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-600 transition-colors"
        >
          Recents
          <ChevronIcon className="w-3.5 h-3.5" open={recentsExpanded} />
        </button>

        {recentsExpanded && (
          <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 space-y-0.5">
            {!user ? (
              <div className="text-center py-8 px-2">
                <p className="text-xs text-gray-500 mb-2">Sign in to save your chat history.</p>
                <Link
                  href="/login"
                  className="inline-block text-xs font-medium text-doctar-600 hover:underline"
                >
                  Sign in →
                </Link>
              </div>
            ) : loading ? (
              <p className="text-xs text-gray-400 text-center py-6">Loading…</p>
            ) : error ? (
              <div className="text-center py-6 px-2">
                <p className="text-xs text-red-500 mb-2">{error}</p>
                <button onClick={onRetry} className="text-xs font-medium text-doctar-600 hover:underline">
                  Retry
                </button>
              </div>
            ) : sessions.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">No conversations yet.</p>
            ) : (
              sessions.map((s) => {
                const isActive = s.id === currentSessionId;
                const isRenaming = renamingId === s.id;
                const isConfirmingDelete = confirmDeleteId === s.id;
                return (
                  <div key={s.id} className="relative group">
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={submitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename();
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="w-full px-2.5 py-2 text-sm rounded-lg border border-doctar-300 focus:outline-none focus:ring-2 focus:ring-doctar-500"
                      />
                    ) : (
                      <button
                        onClick={() => handleSelectSession(s.id)}
                        className={`w-full flex items-center gap-2 pl-2.5 pr-8 py-2 rounded-lg text-left transition-colors ${
                          isActive ? "bg-doctar-50" : "hover:bg-gray-50"
                        }`}
                      >
                        <MessageSquareIcon
                          className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-doctar-600" : "text-gray-400"}`}
                        />
                        <span
                          className={`flex-1 min-w-0 truncate text-sm ${
                            isActive ? "font-semibold text-gray-900" : "text-gray-500"
                          }`}
                        >
                          {s.title}
                        </span>
                      </button>
                    )}

                    {!isRenaming && (
                      <div className="absolute right-1 top-1/2 -translate-y-1/2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(openMenuId === s.id ? null : s.id);
                            setConfirmDeleteId(null);
                          }}
                          className={`w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-opacity ${
                            openMenuId === s.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                          }`}
                          aria-label="Session options"
                        >
                          <DotsIcon className="w-4 h-4" />
                        </button>

                        {openMenuId === s.id && (
                          <div
                            ref={menuRef}
                            className="absolute right-0 top-full mt-1 w-40 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-10"
                          >
                            {isConfirmingDelete ? (
                              <div className="px-3 py-2">
                                <p className="text-xs text-gray-600 mb-2">Delete this chat?</p>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => {
                                      onDeleteSession(s.id);
                                      setOpenMenuId(null);
                                      setConfirmDeleteId(null);
                                    }}
                                    className="flex-1 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg py-1.5"
                                  >
                                    Delete
                                  </button>
                                  <button
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="flex-1 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg py-1.5"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <button
                                  onClick={() => startRename(s)}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                  <PencilIcon className="w-3.5 h-3.5" />
                                  Rename
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(s.id)}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                >
                                  <TrashIcon className="w-3.5 h-3.5" />
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {!isRenaming && (
                      <p className="pl-8 -mt-0.5 text-[11px] text-gray-400">{formatRelativeTime(s.updated_at)}</p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
