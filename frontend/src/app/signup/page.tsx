"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export default function SignupPage() {
  const { signup } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signup(email, password, name.trim() || undefined);
      router.push("/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-blue-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/doctar-logo.svg" alt="DOCTAR" className="w-12 h-12 rounded-full mx-auto mb-4" />
        <h1 className="text-xl font-bold text-gray-800 text-center">Create an account</h1>
        <p className="text-sm text-gray-500 text-center mt-1 mb-6">
          Save your chat history and pick up conversations later.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name (optional)</label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-doctar-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-doctar-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-doctar-500 focus:border-transparent"
            />
            <p className="text-[11px] text-gray-400 mt-1">At least 8 characters.</p>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-doctar-600 hover:bg-doctar-700 disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-xl transition-colors"
          >
            {submitting ? "Creating account…" : "Sign up"}
          </button>
        </form>

        <p className="text-xs text-gray-500 text-center mt-5">
          Already have an account?{" "}
          <Link href="/login" className="text-doctar-600 font-medium hover:underline">
            Sign in
          </Link>
        </p>
        <p className="text-xs text-gray-400 text-center mt-3">
          <Link href="/chat" className="hover:underline">
            Continue without an account →
          </Link>
        </p>
      </div>
    </div>
  );
}
