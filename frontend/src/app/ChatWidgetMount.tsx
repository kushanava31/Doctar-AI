"use client";

import { usePathname } from "next/navigation";
import ChatWidget from "@/components/ChatWidget";

/**
 * Mounts the floating ChatWidget on every page EXCEPT the full-screen
 * AI chat page (/chat), where the widget would duplicate the interface.
 * ChatWidget itself is unchanged so it keeps working on all other routes.
 */
export default function ChatWidgetMount() {
  const pathname = usePathname();
  if (pathname === "/chat") return null;
  return <ChatWidget />;
}
