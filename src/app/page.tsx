"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Keyboard,
  Link2,
  Mic,
  Plus,
  ShieldCheck,
  Sparkles,
  Video,
  Wifi,
  X,
} from "lucide-react";
import { GenMeetLogo } from "@/components/GenMeetLogo";
import {
  generateMeetingCode,
  getAvatarColor,
  getInitials,
  parseMeetingInput,
} from "@/lib/meeting-code";

const CAROUSEL_SLIDES = [
  {
    title: "Get a link you can share",
    description:
      "Click New meeting to generate a room code you can share across tabs or devices on your network.",
    badge: "Instant rooms",
    accent: "#1a73e8",
    bg: "from-[#e8f0fe] to-[#d2e3fc]",
    icon: "link",
  },
  {
    title: "Studio-grade collaboration",
    description:
      "Present your screen in one click, raise your hand, react live with emojis, and chat in real time.",
    badge: "Screen share & chat",
    accent: "#0f9d58",
    bg: "from-[#e6f4ea] to-[#ceead6]",
    icon: "calendar",
  },
  {
    title: "Direct peer-to-peer WebRTC",
    description:
      "Audio and video stream directly between participants over encrypted peer-to-peer media channels.",
    badge: "Encrypted P2P",
    accent: "#7c3aed",
    bg: "from-[#f3e8fd] to-[#e9d5ff]",
    icon: "shield",
  },
] as const;

export default function HomePage() {
  const router = useRouter();
  const [dateTimeLabel, setDateTimeLabel] = useState("");
  const [displayName, setDisplayName] = useState("Guest");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("Guest");
  const [menuOpen, setMenuOpen] = useState(false);
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [laterLinkCode, setLaterLinkCode] = useState<string | null>(null);
  const [copiedLaterLink, setCopiedLaterLink] = useState(false);
  const [copiedLan, setCopiedLan] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [recentRooms, setRecentRooms] = useState<string[]>([]);
  const [instanceNet, setInstanceNet] = useState<{
    virtualIp: string;
    lanUrls: string[];
  } | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{
    latestVersion: string;
    releaseUrl: string;
  } | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("genmeet:displayName");
    if (saved && saved.trim()) {
      setDisplayName(saved.trim());
      setNameDraft(saved.trim());
    }

    try {
      const rawRecent = window.localStorage.getItem("genmeet:recentRooms");
      if (rawRecent) {
        const parsed = JSON.parse(rawRecent);
        if (Array.isArray(parsed)) {
          setRecentRooms(parsed.filter((item): item is string => typeof item === "string").slice(0, 3));
        }
      }
    } catch {
      // Ignore malformed localStorage entries
    }

    fetch("/api/instance")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.virtualIp) {
          setInstanceNet({
            virtualIp: data.virtualIp,
            lanUrls: Array.isArray(data.lanUrls) ? data.lanUrls : [],
          });
        }
      })
      .catch(() => {
        // Non-fatal metadata fetch
      });

    fetch("/api/update-check")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.updateAvailable && data.latestVersion && data.releaseUrl) {
          setUpdateInfo({
            latestVersion: data.latestVersion,
            releaseUrl: data.releaseUrl,
          });
        }
      })
      .catch(() => {
        // Offline or unreachable GitHub is non-fatal
      });
  }, []);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const time = now.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });
      const date = now.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      setDateTimeLabel(`${time} • ${date}`);
    };
    updateClock();
    const timer = window.setInterval(updateClock, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const handleStartInstantMeeting = () => {
    setMenuOpen(false);
    const code = generateMeetingCode();
    router.push(`/meet/${code}`);
  };

  const handleCreateForLater = () => {
    setMenuOpen(false);
    setLaterLinkCode(generateMeetingCode());
    setCopiedLaterLink(false);
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseMeetingInput(joinInput);
    if (!parsed) {
      setJoinError("Enter a valid meeting code (e.g. abc-defg-hij) or link.");
      return;
    }
    setJoinError(null);
    router.push(`/meet/${parsed}`);
  };

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setDisplayName(trimmed);
    window.localStorage.setItem("genmeet:displayName", trimmed);
    setEditingName(false);
  };

  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  const shareBaseOrigin =
    isLocalhost && instanceNet?.lanUrls[0]
      ? instanceNet.lanUrls[0]
      : typeof window !== "undefined"
      ? window.location.origin
      : "";
  const laterFullUrl = laterLinkCode
    ? `${shareBaseOrigin}/meet/${laterLinkCode}`
    : "";

  const handleCopyLaterUrl = async () => {
    if (!laterFullUrl) return;
    try {
      await navigator.clipboard.writeText(laterFullUrl);
      setCopiedLaterLink(true);
      window.setTimeout(() => setCopiedLaterLink(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleCopyLanUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLan(true);
      window.setTimeout(() => setCopiedLan(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  const activeSlide = CAROUSEL_SLIDES[slideIndex];

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f4f8ff] via-white to-[#f8fafc] text-[#202124] flex flex-col">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-[#e8eaed]/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-8">
          <div className="flex items-center gap-4">
            <GenMeetLogo />
            {instanceNet && (
              <span className="hidden items-center gap-1.5 rounded-full border border-[#d2e3fc] bg-[#f1f6fe] px-3 py-1 text-xs font-medium text-[#1967d2] md:inline-flex">
                <span className="h-2 w-2 rounded-full bg-[#1e8e3e]" aria-hidden="true" />
                Node {instanceNet.virtualIp}
              </span>
            )}
            {updateInfo && (
              <a
                href={updateInfo.releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-[#1a73e8] px-3 py-1 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#1765cc]"
              >
                Update v{updateInfo.latestVersion} available
              </a>
            )}
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <span className="hidden text-sm font-medium text-[#5f6368] sm:inline">
              {dateTimeLabel}
            </span>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNameDraft(displayName);
                  setEditingName((prev) => !prev);
                }}
                aria-label={`Signed in as ${displayName}. Click to change display name`}
                className="flex items-center gap-2 rounded-full border border-[#dadce0] bg-white py-1 pl-1.5 pr-3 text-sm text-[#3c4043] shadow-xs transition-all hover:border-[#1a73e8]/50 hover:bg-[#f8f9fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]"
              >
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: getAvatarColor(displayName) }}
                >
                  {getInitials(displayName)}
                </span>
                <span className="max-w-[120px] truncate font-medium">
                  {displayName}
                </span>
              </button>

              {editingName && (
                <form
                  onSubmit={handleSaveName}
                  className="absolute right-0 top-12 z-30 w-64 rounded-2xl border border-[#dadce0] bg-white p-4 shadow-2xl"
                >
                  <label
                    htmlFor="home-display-name"
                    className="block text-xs font-medium text-[#5f6368]"
                  >
                    Display name
                  </label>
                  <input
                    id="home-display-name"
                    type="text"
                    maxLength={50}
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-[#dadce0] px-3 py-2 text-sm focus:border-[#1a73e8] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/15"
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingName(false)}
                      className="rounded-full px-3 py-1.5 text-xs font-medium text-[#5f6368] hover:bg-[#f1f3f4]"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="rounded-full bg-[#1a73e8] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#1765cc]"
                    >
                      Save
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Hero */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center gap-12 px-5 py-10 lg:flex-row lg:justify-between lg:px-10">
        {/* Left Hero */}
        <section className="w-full max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#d2e3fc] bg-[#e8f0fe]/70 px-3 py-1 text-xs font-medium text-[#1967d2]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Real-time HD Video, Audio &amp; Screen Sharing
          </div>

          <h1 className="mt-5 text-4xl font-semibold leading-[1.15] tracking-tight text-[#202124] sm:text-[46px]">
            Video calls and meetings{" "}
            <span className="bg-gradient-to-r from-[#1d4ed8] via-[#1a73e8] to-[#0891b2] bg-clip-text text-transparent">
              for everyone
            </span>
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-[#5f6368]">
            Connect, collaborate, and celebrate from anywhere with GenMeet. Zero accounts required.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-start">
            {/* New meeting dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-expanded={menuOpen}
                className="inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-[#1d4ed8] to-[#1a73e8] px-6 text-sm font-medium text-white shadow-md shadow-[#1a73e8]/25 transition-all hover:shadow-lg hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] focus-visible:ring-offset-2 sm:w-auto"
              >
                <Video className="h-5 w-5" aria-hidden="true" />
                <span>New meeting</span>
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-14 z-20 w-72 rounded-2xl border border-[#e8eaed] bg-white py-2 shadow-2xl"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleCreateForLater}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#202124] hover:bg-[#f1f6fe]"
                  >
                    <Link2 className="h-5 w-5 text-[#1a73e8]" aria-hidden="true" />
                    <span>Create a meeting for later</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleStartInstantMeeting}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#202124] hover:bg-[#f1f6fe]"
                  >
                    <Plus className="h-5 w-5 text-[#1a73e8]" aria-hidden="true" />
                    <span>Start an instant meeting</span>
                  </button>
                </div>
              )}
            </div>

            {/* Enter a code or link */}
            <form onSubmit={handleJoinSubmit} className="flex flex-col flex-1">
              <div className="flex items-center gap-2">
                <div className="relative flex flex-1 items-center sm:flex-initial">
                  <Keyboard
                    className="pointer-events-none absolute left-3.5 h-5 w-5 text-[#5f6368]"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={joinInput}
                    onChange={(e) => {
                      setJoinInput(e.target.value);
                      if (joinError) setJoinError(null);
                    }}
                    placeholder="Enter a code or link"
                    aria-label="Enter a meeting code or link"
                    aria-invalid={Boolean(joinError)}
                    aria-describedby={joinError ? "join-code-error" : undefined}
                    className="h-12 w-full rounded-full border border-[#dadce0] bg-white pl-11 pr-4 text-sm text-[#202124] shadow-xs placeholder:text-[#5f6368] focus:border-[#1a73e8] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/15 sm:w-64"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!joinInput.trim()}
                  className="h-12 rounded-full px-5 text-sm font-semibold text-[#1a73e8] transition-colors hover:bg-[#e8f0fe] disabled:cursor-default disabled:text-[#9aa0a6] disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]"
                >
                  Join
                </button>
              </div>
              {joinError && (
                <p id="join-code-error" className="mt-1.5 pl-3 text-xs text-[#d93025]">
                  {joinError}
                </p>
              )}
            </form>
          </div>

          {/* Recent rooms quick strip */}
          {recentRooms.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[#5f6368]">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Recent:
              </span>
              {recentRooms.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => router.push(`/meet/${code}`)}
                  className="rounded-full border border-[#dadce0] bg-white px-3 py-1 font-mono text-xs text-[#3c4043] transition-colors hover:border-[#1a73e8] hover:bg-[#f1f6fe] hover:text-[#1a73e8]"
                >
                  {code}
                </button>
              ))}
            </div>
          )}

          {/* Instance & LAN info card */}
          <div className="mt-8 rounded-2xl border border-[#e8eaed] bg-white/90 p-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5f6368]">
              <div className="flex items-center gap-2">
                <Wifi className="h-4 w-4 text-[#1a73e8]" aria-hidden="true" />
                <span className="font-medium text-[#3c4043]">
                  Share across tabs or your local network
                </span>
              </div>
              {instanceNet && (
                <span className="rounded-full bg-[#e8f0fe] px-2.5 py-0.5 font-mono text-[11px] font-medium text-[#1967d2]">
                  ID: {instanceNet.virtualIp}
                </span>
              )}
            </div>

            {instanceNet?.lanUrls[0] ? (
              <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-[#f8f9fa] px-3 py-2">
                <span className="truncate font-mono text-xs text-[#3c4043]">
                  {instanceNet.lanUrls[0]}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyLanUrl(instanceNet.lanUrls[0])}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[#1a73e8] shadow-xs hover:bg-[#f1f6fe]"
                >
                  {copiedLan ? (
                    <>
                      <Check className="h-3 w-3 text-[#1e8e3e]" aria-hidden="true" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" aria-hidden="true" />
                      Copy LAN URL
                    </>
                  )}
                </button>
              </div>
            ) : (
              <p className="mt-2 text-xs text-[#5f6368]">
                Open <code className="rounded bg-[#f1f3f4] px-1 py-0.5">/meet/abc-defg-hij</code> in another browser tab to test live video &amp; chat.
              </p>
            )}
          </div>
        </section>

        {/* Right Showcase Card */}
        <section
          aria-label="GenMeet highlights"
          className="w-full max-w-md rounded-3xl border border-[#e8eaed] bg-white p-6 shadow-xl shadow-[#1a73e8]/5"
        >
          {/* Mini Live Stage Preview */}
          <div className="mb-6 rounded-2xl bg-[#202124] p-3.5 text-white shadow-inner">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex h-24 flex-col justify-between rounded-xl bg-gradient-to-br from-[#2d3138] to-[#1e2024] p-2.5 ring-1 ring-[#8ab4f8]/60">
                <div className="flex justify-end">
                  <span className="h-2 w-2 rounded-full bg-[#34a853]" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1a73e8] text-[10px] font-semibold">
                    {getInitials(displayName)}
                  </span>
                  <span className="truncate text-[11px] text-[#e8eaed]">
                    {displayName}
                  </span>
                </div>
              </div>
              <div className="flex h-24 flex-col justify-between rounded-xl bg-gradient-to-br from-[#2d3138] to-[#1e2024] p-2.5 ring-1 ring-white/10">
                <div className="flex justify-end">
                  <Mic className="h-3 w-3 text-[#8ab4f8]" aria-hidden="true" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#00897b] text-[10px] font-semibold">
                    TM
                  </span>
                  <span className="truncate text-[11px] text-[#e8eaed]">
                    Team Guest
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-center gap-2">
              <span className="h-5 w-5 rounded-full bg-[#3c4043]" />
              <span className="h-5 w-5 rounded-full bg-[#3c4043]" />
              <span className="h-5 w-5 rounded-full bg-[#a8c7fa]" />
              <span className="h-5 w-8 rounded-full bg-[#ea4335]" />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() =>
                setSlideIndex((prev) =>
                  prev === 0 ? CAROUSEL_SLIDES.length - 1 : prev - 1
                )
              }
              aria-label="Previous highlight"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="flex flex-col items-center text-center">
              <div
                className={`flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br ${activeSlide.bg} shadow-xs`}
              >
                {activeSlide.icon === "link" && (
                  <Link2
                    className="h-9 w-9"
                    style={{ color: activeSlide.accent }}
                    aria-hidden="true"
                  />
                )}
                {activeSlide.icon === "calendar" && (
                  <Calendar
                    className="h-9 w-9"
                    style={{ color: activeSlide.accent }}
                    aria-hidden="true"
                  />
                )}
                {activeSlide.icon === "shield" && (
                  <ShieldCheck
                    className="h-9 w-9"
                    style={{ color: activeSlide.accent }}
                    aria-hidden="true"
                  />
                )}
              </div>

              <span className="mt-3 rounded-full bg-[#f1f3f4] px-2.5 py-0.5 text-[11px] font-medium text-[#5f6368]">
                {activeSlide.badge}
              </span>
              <h2 className="mt-2 text-xl font-medium text-[#202124]">
                {activeSlide.title}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[#5f6368]">
                {activeSlide.description}
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                setSlideIndex((prev) => (prev + 1) % CAROUSEL_SLIDES.length)
              }
              aria-label="Next highlight"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-5 flex items-center justify-center gap-2">
            {CAROUSEL_SLIDES.map((slide, idx) => (
              <button
                key={slide.title}
                type="button"
                onClick={() => setSlideIndex(idx)}
                aria-label={`Show slide ${idx + 1}: ${slide.title}`}
                className={`h-2 rounded-full transition-all ${
                  idx === slideIndex ? "w-6 bg-[#1a73e8]" : "w-2 bg-[#dadce0]"
                }`}
              />
            ))}
          </div>
        </section>
      </main>

      {/* "Here's your joining info" modal */}
      {laterLinkCode && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="later-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 id="later-dialog-title" className="text-lg font-semibold text-[#202124]">
                Here&apos;s your joining info
              </h2>
              <button
                type="button"
                onClick={() => setLaterLinkCode(null)}
                aria-label="Close dialog"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <p className="mt-2 text-sm text-[#5f6368]">
              Send this link to people you want to meet with. Save it so you can rejoin anytime.
            </p>

            <div className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-[#f1f3f4] px-3.5 py-3">
              <span className="truncate font-mono text-xs text-[#202124]">
                {laterFullUrl}
              </span>
              <button
                type="button"
                onClick={() => void handleCopyLaterUrl()}
                aria-label="Copy meeting link"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#3c4043] hover:bg-[#e0e2e5]"
              >
                {copiedLaterLink ? (
                  <Check className="h-4 w-4 text-[#1e8e3e]" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLaterLinkCode(null)}
                className="rounded-full px-4 py-2 text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4]"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => router.push(`/meet/${laterLinkCode}`)}
                className="rounded-full bg-[#1a73e8] px-5 py-2 text-sm font-medium text-white hover:bg-[#1765cc]"
              >
                Join now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
