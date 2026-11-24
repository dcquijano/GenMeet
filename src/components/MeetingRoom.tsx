"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Captions,
  Check,
  Copy,
  Globe,
  Hand,
  Info,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  MoreVertical,
  PhoneOff,
  Power,
  Send,
  ShieldCheck,
  Smile,
  Users,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { VideoTile } from "@/components/VideoTile";
import type { MediaDevicesState } from "@/hooks/useMediaDevices";
import { usePublicTunnel } from "@/hooks/usePublicTunnel";
import type { RemotePeerState } from "@/hooks/useWebRTCRoom";
import { getAvatarColor, getInitials } from "@/lib/meeting-code";
import {
  ALLOWED_REACTIONS,
  type ChatMessage,
  type ReactionEmoji,
  type ReactionEvent,
} from "@/lib/signaling-schema";

type SidePanelTab = "details" | "people" | "chat" | null;
type LayoutMode = "auto" | "tiled" | "spotlight";

interface MeetingRoomProps {
  roomId: string;
  selfId: string;
  selfName: string;
  media: MediaDevicesState;
  peers: Record<string, RemotePeerState>;
  chatMessages: ChatMessage[];
  reactions: ReactionEvent[];
  handRaised: boolean;
  onToggleHand: () => void;
  onSendReaction: (emoji: ReactionEmoji) => void;
  onSendChat: (text: string) => Promise<string | null>;
  onLeave: () => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

export function MeetingRoom({
  roomId,
  selfId,
  selfName,
  media,
  peers,
  chatMessages,
  reactions,
  handRaised,
  onToggleHand,
  onSendReaction,
  onSendChat,
  onLeave,
}: MeetingRoomProps) {
  const [activePanel, setActivePanel] = useState<SidePanelTab>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("auto");
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [mirroredLocal, setMirroredLocal] = useState(true);
  const [showReactionsBar, setShowReactionsBar] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [captionText, setCaptionText] = useState<string>("");
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [peopleSearch, setPeopleSearch] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [nowText, setNowText] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [copied, setCopied] = useState(false);
  const [instanceNet, setInstanceNet] = useState<{
    virtualIp: string;
    lanUrls: string[];
  } | null>(null);
  const tunnel = usePublicTunnel();

  useEffect(() => {
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
  }, []);

  const prevChatCountRef = useRef(chatMessages.length);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const peerList = useMemo(() => Object.values(peers), [peers]);
  const totalParticipants = 1 + peerList.length;

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 2500);
  };

  // Live clock & call duration timer
  useEffect(() => {
    const updateClock = () => {
      setNowText(
        new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })
      );
    };
    updateClock();
    const clockTimer = window.setInterval(updateClock, 15_000);
    const durationTimer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => {
      window.clearInterval(clockTimer);
      window.clearInterval(durationTimer);
    };
  }, []);

  // Keyboard shortcuts matching Google Meet: Ctrl+D (mic), Ctrl+E (camera)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "d") {
        e.preventDefault();
        void media.toggleAudio();
      } else if (key === "e") {
        e.preventDefault();
        void media.toggleVideo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [media]);

  // Track unread chat messages when chat drawer is closed
  useEffect(() => {
    const diff = chatMessages.length - prevChatCountRef.current;
    prevChatCountRef.current = chatMessages.length;
    if (diff > 0) {
      if (activePanel === "chat") {
        setUnreadChatCount(0);
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      } else {
        setUnreadChatCount((prev) => prev + diff);
      }
    }
  }, [chatMessages.length, activePanel]);

  useEffect(() => {
    if (activePanel === "chat") {
      setUnreadChatCount(0);
      chatEndRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [activePanel]);

  // Optional live captions via browser SpeechRecognition API
  useEffect(() => {
    if (!captionsEnabled || !media.audioEnabled) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      if (!captionsEnabled) setCaptionText("");
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      setCaptionText("Live captions are not supported in this browser.");
      return;
    }

    const recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const latest = event.results[event.results.length - 1];
      const text = latest?.[0]?.transcript;
      if (text) {
        setCaptionText(text);
      }
    };
    recognition.onerror = () => {
      setCaptionText("Captions paused (microphone speech unavailable).");
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      setCaptionText("Could not start live captions.");
    }

    return () => {
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [captionsEnabled, media.audioEnabled]);

  const getActiveShareUrl = () => {
    if (tunnel.publicUrl) {
      return `${tunnel.publicUrl}/meet/${roomId}`;
    }
    if (typeof window !== "undefined") {
      const isLocalhost =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      if (isLocalhost && instanceNet?.lanUrls[0]) {
        return `${instanceNet.lanUrls[0]}/meet/${roomId}`;
      }
      return window.location.href;
    }
    return `/meet/${roomId}`;
  };

  const handleCopyMeetingLink = async () => {
    try {
      const shareUrl = getActiveShareUrl();
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      showToast(
        tunnel.publicUrl
          ? "Copied Public 5G HTTPS invite link"
          : shareUrl.includes("192.168.") || shareUrl.includes("10.") || shareUrl.includes("172.")
          ? "Copied LAN/Mobile invite link"
          : "Copied meeting link"
      );
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Copy failed — use the address bar URL");
    }
  };

  const handleToggleScreenShare = async () => {
    if (media.screenSharing) {
      media.stopScreenShare();
      showToast("Stopped presenting");
    } else {
      const stream = await media.startScreenShare();
      if (stream) {
        showToast("You are presenting your screen");
      }
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed) return;
    const err = await onSendChat(trimmed);
    if (err) {
      setChatError(err);
    } else {
      setChatError(null);
      setChatInput("");
    }
  };

  const togglePanel = (tab: Exclude<SidePanelTab, null>) => {
    setActivePanel((prev) => (prev === tab ? null : tab));
    setShowReactionsBar(false);
    setShowMoreMenu(false);
  };

  // Build unified list of tiles (self + remote peers)
  const allTiles = useMemo(() => {
    const localStream = media.screenSharing
      ? media.screenStream
      : media.cameraStream;

    const selfTile = {
      id: selfId || "local",
      name: selfName,
      stream: localStream,
      audioEnabled: media.audioEnabled,
      videoEnabled: media.videoEnabled,
      screenSharing: media.screenSharing,
      handRaised,
      isLocal: true,
    };

    const remoteTiles = peerList.map((peer) => ({
      id: peer.id,
      name: peer.name,
      stream: peer.stream,
      audioEnabled: peer.audioEnabled,
      videoEnabled: peer.videoEnabled,
      screenSharing: peer.screenSharing,
      handRaised: peer.handRaised,
      isLocal: false,
    }));

    return [selfTile, ...remoteTiles];
  }, [
    selfId,
    selfName,
    media.screenSharing,
    media.screenStream,
    media.cameraStream,
    media.audioEnabled,
    media.videoEnabled,
    handRaised,
    peerList,
  ]);

  // Determine whether Spotlight / Presentation layout is active
  const presenterTile = allTiles.find((t) => t.screenSharing);
  const pinnedTile = pinnedId ? allTiles.find((t) => t.id === pinnedId) : undefined;
  const spotlightTile =
    layoutMode === "tiled"
      ? undefined
      : pinnedTile ?? presenterTile ?? (layoutMode === "spotlight" ? allTiles[0] : undefined);

  const filmstripTiles = spotlightTile
    ? allTiles.filter((t) => t.id !== spotlightTile.id)
    : [];

  const getGridClass = (count: number) => {
    if (count <= 1) return "grid-cols-1 max-w-5xl mx-auto";
    if (count === 2) return "grid-cols-1 md:grid-cols-2";
    if (count <= 4) return "grid-cols-1 sm:grid-cols-2";
    if (count <= 6) return "grid-cols-2 lg:grid-cols-3";
    return "grid-cols-2 md:grid-cols-3 lg:grid-cols-4";
  };

  const filteredPeople = allTiles.filter((t) =>
    t.name.toLowerCase().includes(peopleSearch.trim().toLowerCase())
  );

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#17181b] text-white">
      {/* Top Floating HUD */}
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 sm:px-5">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#292b2f]/90 px-3 py-1.5 text-xs font-medium text-[#e8eaed] ring-1 ring-white/10 backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-[#34a853]" aria-hidden="true" />
            <span className="font-mono">{formatDuration(elapsedSeconds)}</span>
            <span className="text-white/25">|</span>
            <button
              type="button"
              onClick={() => void handleCopyMeetingLink()}
              className="font-mono text-[#a8c7fa] hover:underline focus-visible:outline-none"
              title="Copy meeting link"
            >
              {roomId}
            </button>
          </div>

          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-[#292b2f]/75 px-3 py-1.5 text-xs text-[#bdc1c6] ring-1 ring-white/10">
            <ShieldCheck className="h-3.5 w-3.5 text-[#81c995]" aria-hidden="true" />
            Encrypted P2P
          </span>

          {tunnel.publicUrl && (
            <button
              type="button"
              onClick={() => void handleCopyMeetingLink()}
              title="Copy Public 5G HTTPS invite link"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#137333]/30 px-3 py-1.5 text-xs font-medium text-[#81c995] ring-1 ring-[#81c995]/40 hover:bg-[#137333]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81c995]"
            >
              <Globe className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Public HTTPS Live</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {media.screenSharing && (
            <div className="inline-flex items-center gap-2 rounded-full bg-[#1a73e8]/25 px-3 py-1 text-xs font-medium text-[#a8c7fa] ring-1 ring-[#8ab4f8]/40">
              <span>You are presenting</span>
              <button
                type="button"
                onClick={() => {
                  media.stopScreenShare();
                  showToast("Stopped presenting");
                }}
                className="rounded-full bg-[#ea4335] px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-[#d93025]"
              >
                Stop
              </button>
            </div>
          )}

          {/* Quick Layout Switcher */}
          <div
            role="group"
            aria-label="Layout mode"
            className="hidden sm:inline-flex items-center rounded-full bg-[#292b2f]/90 p-0.5 text-xs ring-1 ring-white/10"
          >
            {(["auto", "tiled", "spotlight"] as LayoutMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setLayoutMode(mode)}
                className={`rounded-full px-3 py-1 capitalize transition-colors ${
                  layoutMode === mode
                    ? "bg-[#a8c7fa] font-semibold text-[#062e6f]"
                    : "text-[#bdc1c6] hover:text-white"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main stage + optional side drawer */}
      <div className="relative flex min-h-0 flex-1 gap-3 p-3 sm:p-4">
        {/* Video stage */}
        <main className="relative flex min-h-0 flex-1 flex-col">
          {spotlightTile ? (
            <div className="flex h-full min-h-0 flex-col gap-3 lg:flex-row">
              <div className="min-h-0 flex-1">
                <VideoTile
                  name={spotlightTile.name}
                  stream={spotlightTile.stream}
                  audioEnabled={spotlightTile.audioEnabled}
                  videoEnabled={spotlightTile.videoEnabled}
                  screenSharing={spotlightTile.screenSharing}
                  handRaised={spotlightTile.handRaised}
                  isLocal={spotlightTile.isLocal}
                  mirrored={spotlightTile.isLocal && mirroredLocal}
                  pinned={pinnedId === spotlightTile.id}
                  audioOutputId={media.selectedAudioOutputId}
                  onTogglePin={() =>
                    setPinnedId((prev) =>
                      prev === spotlightTile.id ? null : spotlightTile.id
                    )
                  }
                />
              </div>

              {filmstripTiles.length > 0 && (
                <div className="flex h-32 shrink-0 gap-2 overflow-x-auto lg:h-full lg:w-64 lg:flex-col lg:overflow-y-auto">
                  {filmstripTiles.map((tile) => (
                    <div
                      key={tile.id}
                      className="h-full aspect-video shrink-0 lg:h-40 lg:w-full"
                    >
                      <VideoTile
                        name={tile.name}
                        stream={tile.stream}
                        audioEnabled={tile.audioEnabled}
                        videoEnabled={tile.videoEnabled}
                        screenSharing={tile.screenSharing}
                        handRaised={tile.handRaised}
                        isLocal={tile.isLocal}
                        mirrored={tile.isLocal && mirroredLocal}
                        pinned={pinnedId === tile.id}
                        audioOutputId={media.selectedAudioOutputId}
                        compact
                        onTogglePin={() =>
                          setPinnedId((prev) => (prev === tile.id ? null : tile.id))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div
              className={`grid h-full w-full auto-rows-fr gap-3 ${getGridClass(
                allTiles.length
              )}`}
            >
              {allTiles.map((tile) => (
                <VideoTile
                  key={tile.id}
                  name={tile.name}
                  stream={tile.stream}
                  audioEnabled={tile.audioEnabled}
                  videoEnabled={tile.videoEnabled}
                  screenSharing={tile.screenSharing}
                  handRaised={tile.handRaised}
                  isLocal={tile.isLocal}
                  mirrored={tile.isLocal && mirroredLocal}
                  pinned={pinnedId === tile.id}
                  audioOutputId={media.selectedAudioOutputId}
                  onTogglePin={() =>
                    setPinnedId((prev) => (prev === tile.id ? null : tile.id))
                  }
                />
              ))}
            </div>
          )}

          {/* Floating Emoji Reactions */}
          <div
            className="pointer-events-none absolute bottom-4 left-6 z-20 flex flex-col gap-2"
            aria-live="polite"
          >
            {reactions.map((item, idx) => (
              <div
                key={item.id}
                className="animate-float-reaction flex items-center gap-2"
                style={{ marginLeft: `${(idx % 4) * 24}px` }}
              >
                <span className="text-3xl drop-shadow">{item.emoji}</span>
                <span className="rounded-full bg-[#18191c]/85 px-2.5 py-0.5 text-xs font-medium text-white shadow ring-1 ring-white/10">
                  {item.senderName}
                </span>
              </div>
            ))}
          </div>

          {/* Captions Overlay */}
          {captionsEnabled && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 w-full max-w-2xl -translate-x-1/2 px-4">
              <div className="rounded-2xl bg-[#18191c]/90 px-4 py-3 text-center text-sm text-white shadow-xl ring-1 ring-white/15 backdrop-blur-md">
                <span className="mr-2 font-semibold text-[#8ab4f8]">{selfName}:</span>
                <span>{captionText || "Listening..."}</span>
              </div>
            </div>
          )}

          {/* Toast Notification */}
          {toast && (
            <div
              role="status"
              className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full bg-[#292b2f] px-4 py-2 text-xs font-medium text-white shadow-xl ring-1 ring-white/15"
            >
              {toast}
            </div>
          )}
        </main>

        {/* Collapsible Side Drawer with Segmented Tabs */}
        {activePanel && (
          <aside
            aria-label={
              activePanel === "chat"
                ? "In-call messages"
                : activePanel === "people"
                ? "People"
                : "Meeting details"
            }
            className="fixed inset-3 z-40 flex flex-col overflow-hidden rounded-3xl bg-white text-[#202124] shadow-2xl md:static md:inset-auto md:w-[370px] md:shrink-0"
          >
            <div className="border-b border-[#e8eaed] px-4 pt-4 pb-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#202124]">
                  {activePanel === "chat" && "In-call messages"}
                  {activePanel === "people" && `People (${totalParticipants})`}
                  {activePanel === "details" && "Meeting details"}
                </h2>
                <button
                  type="button"
                  onClick={() => setActivePanel(null)}
                  aria-label="Close side panel"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              {/* Drawer quick tab switcher */}
              <div className="mt-3 grid grid-cols-3 gap-1 rounded-full bg-[#f1f3f4] p-1 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setActivePanel("chat")}
                  className={`rounded-full py-1.5 transition-colors ${
                    activePanel === "chat"
                      ? "bg-white text-[#1a73e8] shadow-xs"
                      : "text-[#5f6368] hover:text-[#202124]"
                  }`}
                >
                  Chat
                </button>
                <button
                  type="button"
                  onClick={() => setActivePanel("people")}
                  className={`rounded-full py-1.5 transition-colors ${
                    activePanel === "people"
                      ? "bg-white text-[#1a73e8] shadow-xs"
                      : "text-[#5f6368] hover:text-[#202124]"
                  }`}
                >
                  People ({totalParticipants})
                </button>
                <button
                  type="button"
                  onClick={() => setActivePanel("details")}
                  className={`rounded-full py-1.5 transition-colors ${
                    activePanel === "details"
                      ? "bg-white text-[#1a73e8] shadow-xs"
                      : "text-[#5f6368] hover:text-[#202124]"
                  }`}
                >
                  Details
                </button>
              </div>
            </div>

            {activePanel === "details" && (
              <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5 text-sm">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[#5f6368]">
                    {tunnel.publicUrl
                      ? "Joining info (Public 5G / Any Wi-Fi HTTPS)"
                      : "Joining info (LAN / Mobile ready)"}
                  </h3>
                  <p className="mt-2 break-all rounded-xl bg-[#f8f9fa] p-3 font-mono text-xs text-[#3c4043]">
                    {getActiveShareUrl()}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleCopyMeetingLink()}
                    className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#e8f0fe] px-4 py-2 text-xs font-semibold text-[#1967d2] hover:bg-[#d2e3fc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]"
                  >
                    {copied ? (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    )}
                    {tunnel.publicUrl ? "Copy 5G HTTPS joining info" : "Copy joining info"}
                  </button>
                </div>

                {/* One-click Go Public (5G / Internet HTTPS) card */}
                {(tunnel.canManage || tunnel.publicUrl) && (
                  <div
                    className={`rounded-2xl border p-3.5 text-xs space-y-2 ${
                      tunnel.publicUrl
                        ? "border-[#ceead6] bg-[#e6f4ea]/70 text-[#0d652d]"
                        : "border-[#d2e3fc] bg-[#f4f8ff] text-[#3c4043]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 font-semibold">
                        <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {tunnel.publicUrl
                          ? "Public HTTPS Active (5G / Any Wi-Fi)"
                          : "Go Public (5G / Different Wi-Fi HTTPS)"}
                      </span>
                    </div>

                    {tunnel.publicUrl ? (
                      <>
                        <p className="break-all rounded-lg bg-white px-2.5 py-2 font-mono text-[11px] text-[#0d652d]">
                          {`${tunnel.publicUrl}/meet/${roomId}`}
                        </p>
                        <p className="text-[11px]">
                          Anyone on <strong>5G, another Wi-Fi, Android, or iPhone</strong> can join with full camera &amp; mic.
                        </p>
                        {tunnel.canManage && (
                          <button
                            type="button"
                            onClick={() => void tunnel.stopTunnel()}
                            className="inline-flex items-center gap-1.5 rounded-full border border-[#f2b8b5] bg-white px-3 py-1.5 text-xs font-semibold text-[#b3261e] hover:bg-[#fce8e6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b3261e]"
                          >
                            <Power className="h-3.5 w-3.5" aria-hidden="true" />
                            Stop Public Link
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-[11px] text-[#5f6368]">
                          Starts an automatic Cloudflare HTTPS link so phones on <strong>5G or another Wi-Fi</strong> can join with live camera &amp; mic.
                        </p>
                        {tunnel.isBusy ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-[#1967d2]">
                              <Loader2
                                className="h-3.5 w-3.5 motion-safe:animate-spin"
                                aria-hidden="true"
                              />
                              {tunnel.status === "downloading"
                                ? "Downloading tunnel helper..."
                                : "Starting HTTPS tunnel..."}
                            </span>
                            <button
                              type="button"
                              onClick={() => void tunnel.stopTunnel()}
                              className="rounded-full border border-[#dadce0] bg-white px-2.5 py-1.5 text-xs font-medium text-[#3c4043] hover:bg-[#f1f3f4]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void tunnel.startTunnel()}
                            className="inline-flex items-center gap-1.5 rounded-full bg-[#137333] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0d652d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#137333]"
                          >
                            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                            Go Public (5G / Internet HTTPS)
                          </button>
                        )}
                        {tunnel.error && (
                          <p
                            role="alert"
                            className="rounded-lg bg-[#fce8e6] px-2.5 py-1.5 text-[11px] text-[#b3261e]"
                          >
                            {tunnel.error}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}

                <div className="border-t border-[#e8eaed] pt-4 text-xs text-[#5f6368] space-y-2.5">
                  <p>
                    Meeting code: <strong className="font-mono text-[#202124]">{roomId}</strong>
                  </p>
                  {instanceNet && (
                    <>
                      <p>
                        Install Node ID:{" "}
                        <strong className="font-mono text-[#1967d2]">
                          {instanceNet.virtualIp}
                        </strong>
                      </p>
                      {instanceNet.lanUrls[0] && (
                        <p className="break-all">
                          LAN invite (same Wi-Fi):{" "}
                          <strong className="font-mono text-[#202124]">
                            {`${instanceNet.lanUrls[0]}/meet/${roomId}`}
                          </strong>
                        </p>
                      )}
                    </>
                  )}
                  <p>
                    Shortcuts: <kbd className="rounded bg-[#f1f3f4] px-1.5 py-0.5">Ctrl+D</kbd> mute,{" "}
                    <kbd className="rounded bg-[#f1f3f4] px-1.5 py-0.5">Ctrl+E</kbd> camera.
                  </p>
                </div>

                <div className="rounded-2xl border border-[#d2e3fc] bg-[#f4f8ff] p-3.5 text-xs text-[#3c4043] space-y-1.5">
                  <p className="font-semibold text-[#1967d2]">
                    {tunnel.publicUrl
                      ? "Connect PC ↔ Phone (5G or Any Wi-Fi)"
                      : "Connect PC ↔ Phone (Same Wi-Fi)"}
                  </p>
                  <p>
                    <strong>PC &rarr; Phone:</strong> Open <strong>GenMeet Mobile</strong> (or Safari/Chrome) on your phone, paste{" "}
                    <code className="rounded bg-white px-1 py-0.5 font-mono">
                      {tunnel.publicUrl ?? instanceNet?.lanUrls[0] ?? "http://<PC-IP>:3000"}
                    </code>{" "}
                    as Server URL and <code className="rounded bg-white px-1 py-0.5 font-mono">{roomId}</code> as Meeting Code.
                  </p>
                  <p>
                    <strong>Phone &rarr; PC:</strong> Start a room on your phone, then enter its code on your PC at{" "}
                    <code className="rounded bg-white px-1 py-0.5 font-mono">http://localhost:3000</code>.
                  </p>
                  {!tunnel.publicUrl && (
                    <p className="text-[11px] text-[#5f6368]">
                      Need 5G, different Wi-Fi, or live phone camera &amp; mic? Click{" "}
                      <strong>Go Public (5G / Internet HTTPS)</strong> above.
                    </p>
                  )}
                </div>
              </div>
            )}

            {activePanel === "people" && (
              <div className="flex flex-1 flex-col overflow-hidden p-4">
                <button
                  type="button"
                  onClick={() => void handleCopyMeetingLink()}
                  className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#e8f0fe] px-4 py-2.5 text-sm font-medium text-[#1967d2] hover:bg-[#d2e3fc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]"
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  Copy invite link
                </button>

                <input
                  type="search"
                  value={peopleSearch}
                  onChange={(e) => setPeopleSearch(e.target.value)}
                  placeholder="Search for people"
                  aria-label="Search for people"
                  className="mb-3 rounded-xl border border-[#dadce0] px-3 py-2 text-sm focus:border-[#1a73e8] focus:outline-none"
                />

                <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-[#5f6368]">
                  In call
                </p>

                <ul className="flex-1 space-y-1 overflow-y-auto">
                  {filteredPeople.map((person) => (
                    <li
                      key={person.id}
                      className="flex items-center justify-between rounded-xl px-2.5 py-2 hover:bg-[#f8f9fa]"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                          style={{ backgroundColor: getAvatarColor(person.name) }}
                        >
                          {getInitials(person.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[#202124]">
                            {person.name}
                            {person.isLocal ? " (You)" : ""}
                          </p>
                          {person.screenSharing && (
                            <p className="text-[11px] font-medium text-[#1a73e8]">
                              Presenting
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 text-[#5f6368]">
                        {person.handRaised && (
                          <span
                            title="Hand raised"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#fef7e0] text-[#b06000]"
                          >
                            <Hand className="h-3.5 w-3.5" aria-hidden="true" />
                          </span>
                        )}
                        {person.audioEnabled ? (
                          <Mic className="h-4 w-4 text-[#1e8e3e]" aria-label="Mic on" />
                        ) : (
                          <MicOff className="h-4 w-4 text-[#5f6368]" aria-label="Mic off" />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {activePanel === "chat" && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="mx-4 mt-3 rounded-xl bg-[#f1f3f4] px-3.5 py-2 text-xs text-[#5f6368]">
                  Messages can only be seen by people in the call and clear when the call ends.
                </div>

                <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
                  {chatMessages.length === 0 ? (
                    <p className="pt-8 text-center text-xs text-[#5f6368]">
                      No messages yet. Say hello to the group!
                    </p>
                  ) : (
                    chatMessages.map((msg) => {
                      const isSelf = msg.senderId === selfId;
                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${
                            isSelf ? "items-end" : "items-start"
                          }`}
                        >
                          <div className="mb-0.5 flex items-baseline gap-2 px-1">
                            <span className="text-[11px] font-semibold text-[#3c4043]">
                              {isSelf ? "You" : msg.senderName}
                            </span>
                            <span className="text-[10px] text-[#5f6368]">
                              {new Date(msg.timestamp).toLocaleTimeString([], {
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <p
                            className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${
                              isSelf
                                ? "rounded-tr-xs bg-[#e8f0fe] text-[#174ea6]"
                                : "rounded-tl-xs bg-[#f1f3f4] text-[#202124]"
                            }`}
                          >
                            {msg.text}
                          </p>
                        </div>
                      );
                    })
                  )}
                  <div ref={chatEndRef} />
                </div>

                <form
                  onSubmit={(e) => void handleSendChat(e)}
                  className="border-t border-[#e8eaed] p-3"
                >
                  {chatError && (
                    <p className="mb-1.5 text-xs text-[#d93025]">{chatError}</p>
                  )}
                  <div className="flex items-center gap-2 rounded-full bg-[#f1f3f4] px-4 py-1.5">
                    <input
                      type="text"
                      maxLength={1000}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Send a message"
                      aria-label="Send a message"
                      className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-[#202124] placeholder:text-[#5f6368] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim()}
                      aria-label="Send message"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-[#1a73e8] hover:bg-[#e8f0fe] disabled:text-[#9aa0a6] disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]"
                    >
                      <Send className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </form>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Bottom Floating Glassmorphic Control Dock */}
      <footer className="relative flex flex-wrap items-center justify-between gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-1 sm:px-6">
        {/* Left: Time + Meeting code */}
        <div className="hidden items-center gap-3 text-sm text-[#bdc1c6] md:flex">
          <span className="font-medium text-[#e8eaed]">{nowText}</span>
          <span className="text-white/20">|</span>
          <button
            type="button"
            onClick={() => void handleCopyMeetingLink()}
            className="rounded-lg px-2 py-1 font-mono text-xs text-[#e8eaed] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ab4f8]"
            title="Copy meeting link"
          >
            {roomId}
          </button>
        </div>

        {/* Center: Floating Pill Control Dock */}
        <div className="relative mx-auto flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/10 bg-[#292b2f]/95 px-3 py-2 shadow-2xl backdrop-blur-md sm:gap-2.5">
          {/* Mic */}
          <button
            type="button"
            onClick={() => void media.toggleAudio()}
            aria-label={media.audioEnabled ? "Turn off microphone (Ctrl+D)" : "Turn on microphone (Ctrl+D)"}
            title={media.audioEnabled ? "Turn off microphone (Ctrl+D)" : "Turn on microphone (Ctrl+D)"}
            className={`flex h-11 w-11 items-center justify-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ab4f8] ${
              media.audioEnabled
                ? "bg-[#3c4043] text-white hover:bg-[#4a4e52]"
                : "bg-[#ea4335] text-white shadow-md shadow-[#ea4335]/30 hover:bg-[#d93025]"
            }`}
          >
            {media.audioEnabled ? (
              <Mic className="h-5 w-5" aria-hidden="true" />
            ) : (
              <MicOff className="h-5 w-5" aria-hidden="true" />
            )}
          </button>

          {/* Camera */}
          <button
            type="button"
            onClick={() => void media.toggleVideo()}
            aria-label={media.videoEnabled ? "Turn off camera (Ctrl+E)" : "Turn on camera (Ctrl+E)"}
            title={media.videoEnabled ? "Turn off camera (Ctrl+E)" : "Turn on camera (Ctrl+E)"}
            className={`flex h-11 w-11 items-center justify-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ab4f8] ${
              media.videoEnabled
                ? "bg-[#3c4043] text-white hover:bg-[#4a4e52]"
                : "bg-[#ea4335] text-white shadow-md shadow-[#ea4335]/30 hover:bg-[#d93025]"
            }`}
          >
            {media.videoEnabled ? (
              <Video className="h-5 w-5" aria-hidden="true" />
            ) : (
              <VideoOff className="h-5 w-5" aria-hidden="true" />
            )}
          </button>

          {/* Captions */}
          <button
            type="button"
            onClick={() => setCaptionsEnabled((prev) => !prev)}
            aria-label={captionsEnabled ? "Turn off captions" : "Turn on captions"}
            aria-pressed={captionsEnabled}
            title="Toggle live captions"
            className={`flex h-11 w-11 items-center justify-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ab4f8] ${
              captionsEnabled
                ? "bg-[#a8c7fa] text-[#062e6f]"
                : "bg-[#3c4043] text-white hover:bg-[#4a4e52]"
            }`}
          >
            <Captions className="h-5 w-5" aria-hidden="true" />
          </button>

          {/* Reactions */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowReactionsBar((prev) => !prev);
                setShowMoreMenu(false);
              }}
              aria-label="Send a reaction"
              aria-expanded={showReactionsBar}
              title="Send a reaction"
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ab4f8] ${
                showReactionsBar
                  ? "bg-[#a8c7fa] text-[#062e6f]"
                  : "bg-[#3c4043] text-white hover:bg-[#4a4e52]"
              }`}
            >
              <Smile className="h-5 w-5" aria-hidden="true" />
            </button>

            {showReactionsBar && (
              <div
                role="menu"
                aria-label="Choose a reaction"
                className="absolute bottom-14 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#2b2d30] px-2.5 py-1.5 shadow-2xl ring-1 ring-white/15"
              >
                {ALLOWED_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onSendReaction(emoji);
                      setShowReactionsBar(false);
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-xl transition-transform hover:scale-125 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ab4f8]"
                    aria-label={`Send ${emoji} reaction`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Present Screen */}
          <button
            type="button"
            onClick={() => void handleToggleScreenShare()}
            aria-label={media.screenSharing ? "Stop presenting" : "Present screen"}
            aria-pressed={media.screenSharing}
            title={media.screenSharing ? "Stop presenting" : "Present now"}
            className={`flex h-11 w-11 items-center justify-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ab4f8] ${
              media.screenSharing
                ? "bg-[#a8c7fa] text-[#062e6f]"
                : "bg-[#3c4043] text-white hover:bg-[#4a4e52]"
            }`}
          >
            {media.screenSharing ? (
              <MonitorOff className="h-5 w-5" aria-hidden="true" />
            ) : (
              <MonitorUp className="h-5 w-5" aria-hidden="true" />
            )}
          </button>

          {/* Raise Hand */}
          <button
            type="button"
            onClick={onToggleHand}
            aria-label={handRaised ? "Lower hand" : "Raise hand"}
            aria-pressed={handRaised}
            title={handRaised ? "Lower hand" : "Raise hand"}
            className={`flex h-11 w-11 items-center justify-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ab4f8] ${
              handRaised
                ? "bg-[#fdd663] text-[#202124]"
                : "bg-[#3c4043] text-white hover:bg-[#4a4e52]"
            }`}
          >
            <Hand className="h-5 w-5" aria-hidden="true" />
          </button>

          {/* More Options */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowMoreMenu((prev) => !prev);
                setShowReactionsBar(false);
              }}
              aria-label="More options"
              aria-expanded={showMoreMenu}
              title="More options"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[#3c4043] text-white transition-colors hover:bg-[#4a4e52] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ab4f8]"
            >
              <MoreVertical className="h-5 w-5" aria-hidden="true" />
            </button>

            {showMoreMenu && (
              <div
                role="menu"
                className="absolute bottom-14 right-0 z-40 w-60 rounded-2xl bg-[#2b2d30] py-2 text-sm text-[#e8eaed] shadow-2xl ring-1 ring-white/15"
              >
                <div className="px-4 py-1.5 text-xs font-medium uppercase tracking-wider text-[#9aa0a6]">
                  Change layout
                </div>
                {(["auto", "tiled", "spotlight"] as LayoutMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setLayoutMode(mode);
                      setShowMoreMenu(false);
                    }}
                    className="flex w-full items-center justify-between px-4 py-2 text-left capitalize hover:bg-white/10"
                  >
                    <span className="inline-flex items-center gap-2">
                      <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                      {mode}
                    </span>
                    {layoutMode === mode && (
                      <Check className="h-4 w-4 text-[#8ab4f8]" aria-hidden="true" />
                    )}
                  </button>
                ))}
                <div className="my-1 border-t border-white/10" />
                <button
                  type="button"
                  onClick={() => {
                    setMirroredLocal((prev) => !prev);
                    setShowMoreMenu(false);
                  }}
                  className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-white/10"
                >
                  <span>Mirror self-view</span>
                  {mirroredLocal && (
                    <Check className="h-4 w-4 text-[#8ab4f8]" aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleCopyMeetingLink();
                    setShowMoreMenu(false);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-white/10"
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  Copy meeting link
                </button>
              </div>
            )}
          </div>

          <div className="mx-0.5 h-6 w-px bg-white/15" aria-hidden="true" />

          {/* Leave Call */}
          <button
            type="button"
            onClick={onLeave}
            aria-label="Leave call"
            title="Leave call"
            className="flex h-11 w-16 items-center justify-center rounded-full bg-[#ea4335] text-white shadow-md shadow-[#ea4335]/30 transition-colors hover:bg-[#d93025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <PhoneOff className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Right: Side Panel Toggles */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          <button
            type="button"
            onClick={() => togglePanel("details")}
            aria-label="Meeting details"
            aria-pressed={activePanel === "details"}
            title="Meeting details"
            className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ab4f8] ${
              activePanel === "details"
                ? "bg-[#a8c7fa]/20 text-[#a8c7fa]"
                : "text-[#e8eaed] hover:bg-white/10"
            }`}
          >
            <Info className="h-5 w-5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => togglePanel("people")}
            aria-label={`Show everyone (${totalParticipants})`}
            aria-pressed={activePanel === "people"}
            title="Show everyone"
            className={`relative flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ab4f8] ${
              activePanel === "people"
                ? "bg-[#a8c7fa]/20 text-[#a8c7fa]"
                : "text-[#e8eaed] hover:bg-white/10"
            }`}
          >
            <Users className="h-5 w-5" aria-hidden="true" />
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#5f6368] px-1 text-[10px] font-semibold text-white">
              {totalParticipants}
            </span>
          </button>

          <button
            type="button"
            onClick={() => togglePanel("chat")}
            aria-label="Chat with everyone"
            aria-pressed={activePanel === "chat"}
            title="Chat with everyone"
            className={`relative flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ab4f8] ${
              activePanel === "chat"
                ? "bg-[#a8c7fa]/20 text-[#a8c7fa]"
                : "text-[#e8eaed] hover:bg-white/10"
            }`}
          >
            <MessageSquare className="h-5 w-5" aria-hidden="true" />
            {unreadChatCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#8ab4f8] px-1 text-[10px] font-bold text-[#202124]">
                {unreadChatCount > 9 ? "9+" : unreadChatCount}
              </span>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
