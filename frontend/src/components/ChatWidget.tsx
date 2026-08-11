"use client";

import { useState } from "react";
import ChatInterface from "./ChatInterface";

export default function ChatWidget() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating bubble */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-doctar-600 hover:bg-doctar-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105"
        aria-label="Open DOCTAR AI Chat"
      >
        {open ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          /* pointer-events-none so the click always reaches the button, and
             draggable={false} so the icon can't be dragged out of it (dropping
             it back on the tab would navigate to the raw SVG). */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src="/doctar-logo.svg"
            alt="DOCTAR"
            draggable={false}
            className="w-8 h-8 pointer-events-none select-none"
          />
        )}
      </button>

      {/* Chat popup */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-96 h-[520px] rounded-2xl shadow-2xl overflow-hidden border border-gray-200 flex flex-col">
          <div className="bg-doctar-700 text-white px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/doctar-logo.svg"
                alt="DOCTAR"
                draggable={false}
                className="w-7 h-7 pointer-events-none select-none"
              />
              <div>
                <p className="font-semibold text-sm leading-tight">DOCTAR AI</p>
                <p className="text-doctar-200 text-xs">Health Assistant</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <ChatInterface compact />
          </div>
        </div>
      )}
    </>
  );
}
