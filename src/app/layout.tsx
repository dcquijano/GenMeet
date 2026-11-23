import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GenMeet — Video calls and meetings for everyone",
  description: "Real-time video conferencing, screen sharing, and collaboration built with Next.js and WebRTC.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-[#202124] antialiased">
        {children}
      </body>
    </html>
  );
}
