import type { Metadata } from "next";
import "./globals.css";
import ChatWidgetMount from "./ChatWidgetMount";
import { AuthProvider } from "@/contexts/AuthContext";

export const metadata: Metadata = {
  title: "DOCTAR — AI Health Assistant",
  description: "Upload prescriptions, find doctors, get health guidance in Hindi & English",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
          <ChatWidgetMount />
        </AuthProvider>
      </body>
    </html>
  );
}
