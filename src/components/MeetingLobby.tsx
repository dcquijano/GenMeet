"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Check,
  Copy,
  FlipHorizontal2,
  Mic,
  MicOff,
  MonitorUp,
  Sparkles,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";
import { GenMeetLogo } from "@/components/GenMeetLogo";
import { useActiveSpeaker } from "@/hooks/useActiveSpeaker";
import type { MediaDevicesState } from "@/hooks/useMediaDevices";
import { getAvatarColor, getInitials } from "@/lib/meeting-code";
import type { ParticipantInfo } from "@/lib/signaling-schema";

interface MeetingLobbyProps {
  roomId: string;
  initialName: string;
  media: MediaDevicesState;
  previewPeers: Pick<ParticipantInfo, "id" | "name">[];
  joinError: string | null;
  connected: boolean;
  onJoin: (displayName: string, startWithScreenShare?: boolean) => Promise<void>;
}

export function MeetingLobby({
  roomId,
  initialName,
  media,
  previewPeers,
  joinError,
  connected,
  onJoin,
}: MeetingLobbyProps) {
  const [name, setName] = useState(initialName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mirrored, setMirrored] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const { isSpeaking, audioLevel } = useActiveSpeaker(media.cameraStream, media.audioEnabled);

  const hasLiveVideo = Boolean(
    media.cameraStream &&
      media.cameraStream.getVideoTracks().some((t) => t.readyState === "live" && t.enabled)
  );
  const showCamera = media.videoEnabled && hasLiveVideo;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== media.cameraStream) {
      el.srcObject = media.cameraStream;
    }
    if (media.cameraStream) {
      el.play().catch(() => {});
    }
  }, [media.cameraStream]);

  const handleJoinSubmit = async (e: React.FormEvent, presentDirectly = false) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Please enter your name before joining.");
      return;
    }
    setNameError(null);
    setJoining(true);
    try {
      await onJoin(trimmed, presentDirectly);
    } finally {
      setJoining(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failures on non-secure contexts
    }
  };

  const renderOccupancyText = () => {
    if (!connected) return "Connecting to meeting room...";
    if (previewPeers.length === 0) return "No one else is here yet";
    if (previewPeers.length === 1) return `${previewPeers[0].name} is in this call`;
    if (previewPeers.length === 2) {
      return `${previewPeers[0].name} and ${previewPeers[1].name} are in this call`;
    }
    return `${previewPeers[0].name} and ${previewPeers.length - 1} others are in this call`;
  };

  const avatarSeed = name.trim() || "Guest";

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f4f8ff] via-white to-[#f8fafc] text-[#202124] flex flex-col">
      {/* Top header */}
      <header className="flex items-center justify-between border-b border-[#e8eaed]/70 bg-white/80 px-4 py-3 backdrop-blur-md sm:px-8">
        <Link
          href="/"
          className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]"
        >
          <GenMeetLogo />
        </Link>

        <div className="flex items-center gap-3 text-sm text-[#5f6368]">
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-[#f1f3f4] px-3 py-1 font-mono text-xs text-[#3c4043]">
            <span
              className={`h-2 w-2 rounded-full ${
                connected ? "bg-[#1e8e3e]" : "bg-[#f9ab00]"
              }`}
              aria-hidden="true"
            />
            {roomId}
          </span>
          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#dadce0] bg-white px-3.5 py-1.5 text-xs font-medium text-[#3c4043] shadow-xs hover:bg-[#f8f9fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-[#1e8e3e]" aria-hidden="true" />
                Copied link
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                Copy link
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main two-column green room */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-8 px-4 py-8 lg:flex-row lg:gap-12 lg:px-8">
        {/* Left: Studio Video Preview + Device Selectors */}
        <section className="w-full max-w-[660px] flex flex-col gap-3.5" aria-label="Camera and microphone preview">
          <div
            className={`relative aspect-video w-full overflow-hidden rounded-3xl bg-gradient-to-br from-[#23262b] to-[#18191c] shadow-2xl transition-shadow ${
              isSpeaking && media.audioEnabled
                ? "ring-2 ring-[#1a73e8] shadow-[#1a73e8]/20"
                : "ring-1 ring-black/10"
            }`}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-cover ${mirrored ? "-scale-x-100" : ""} ${
                showCamera ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            />

            {!showCamera && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
                {media.isInitializing ? (
                  <p className="text-sm text-[#bdc1c6]">Starting camera &amp; mic...</p>
                ) : (
                  <>
                    <div
                      className="flex h-24 w-24 items-center justify-center rounded-full text-3xl font-semibold text-white shadow-xl ring-2 ring-white/15"
                      style={{ backgroundColor: getAvatarColor(avatarSeed) }}
                    >
                      {getInitials(avatarSeed)}
                    </div>
                    <p className="text-sm text-[#bdc1c6]">Camera is off</p>
                  </>
                )}
              </div>
            )}

            {/* Top-left studio status chip */}
            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-[#18191c]/70 px-3 py-1 text-xs font-medium text-white backdrop-blur-md ring-1 ring-white/10">
              <Sparkles className="h-3.5 w-3.5 text-[#8ab4f8]" aria-hidden="true" />
              <span>{showCamera ? "HD Preview" : "Audio / Avatar"}</span>
            </div>

            {/* Top-right mirror toggle */}
            {showCamera && (
              <button
                type="button"
                onClick={() => setMirrored((prev) => !prev)}
                aria-label={mirrored ? "Disable camera mirror" : "Mirror camera preview"}
                title="Mirror preview"
                className={`absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                  mirrored
                    ? "bg-[#1a73e8]/90 text-white"
                    : "bg-[#18191c]/70 text-white hover:bg-[#18191c]"
                }`}
              >
                <FlipHorizontal2 className="h-4 w-4" aria-hidden="true" />
              </button>
            )}

            {/* Bottom-left audio level visualizer pill */}
            {media.audioEnabled && (
              <div
                className="absolute bottom-4 left-4 flex items-center gap-1 rounded-full bg-[#1a73e8]/90 px-3 py-2 shadow-lg backdrop-blur-sm"
                aria-label="Microphone level"
              >
                {[0.35, 0.7, 1, 0.65, 0.35].map((scale, i) => (
                  <span
                    key={i}
                    className="w-1 rounded-full bg-white transition-all duration-75"
                    style={{
                      height: `${Math.max(4, Math.round(4 + audioLevel * 16 * scale))}px`,
                    }}
                  />
                ))}
              </div>
            )}

            {/* Bottom-center Mic & Camera toggle buttons */}
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3.5 rounded-full bg-[#18191c]/65 p-1.5 backdrop-blur-md ring-1 ring-white/15">
              <button
                type="button"
                onClick={() => void media.toggleAudio()}
                aria-label={media.audioEnabled ? "Turn off microphone" : "Turn on microphone"}
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                  media.audioEnabled
                    ? "bg-[#3c4043]/80 text-white hover:bg-[#4a4e52]"
                    : "bg-[#ea4335] text-white hover:bg-[#d93025]"
                }`}
              >
                {media.audioEnabled ? (
                  <Mic className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <MicOff className="h-5 w-5" aria-hidden="true" />
                )}
              </button>

              <button
                type="button"
                onClick={() => void media.toggleVideo()}
                aria-label={media.videoEnabled ? "Turn off camera" : "Turn on camera"}
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                  media.videoEnabled
                    ? "bg-[#3c4043]/80 text-white hover:bg-[#4a4e52]"
                    : "bg-[#ea4335] text-white hover:bg-[#d93025]"
                }`}
              >
                {media.videoEnabled ? (
                  <Video className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <VideoOff className="h-5 w-5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {/* Device selector row */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded-full border border-[#dadce0] bg-white px-3.5 py-2 text-xs text-[#3c4043] shadow-xs">
              <Mic className="h-3.5 w-3.5 shrink-0 text-[#1a73e8]" aria-hidden="true" />
              <span className="sr-only">Microphone</span>
              <select
                value={media.selectedAudioInputId}
                onChange={(e) => void media.selectAudioInput(e.target.value)}
                className="w-full truncate bg-transparent focus:outline-none"
                aria-label="Select microphone"
              >
                {media.devices.audioInputs.length === 0 ? (
                  <option value="">Default microphone</option>
                ) : (
                  media.devices.audioInputs.map((d, idx) => (
                    <option key={d.deviceId || idx} value={d.deviceId}>
                      {d.label || `Microphone ${idx + 1}`}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label className="flex items-center gap-2 rounded-full border border-[#dadce0] bg-white px-3.5 py-2 text-xs text-[#3c4043] shadow-xs">
              <Volume2 className="h-3.5 w-3.5 shrink-0 text-[#1a73e8]" aria-hidden="true" />
              <span className="sr-only">Speakers</span>
              <select
                value={media.selectedAudioOutputId}
                onChange={(e) => media.selectAudioOutput(e.target.value)}
                className="w-full truncate bg-transparent focus:outline-none"
                aria-label="Select speaker"
              >
                {media.devices.audioOutputs.length === 0 ? (
                  <option value="">Default speaker</option>
                ) : (
                  media.devices.audioOutputs.map((d, idx) => (
                    <option key={d.deviceId || idx} value={d.deviceId}>
                      {d.label || `Speaker ${idx + 1}`}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label className="flex items-center gap-2 rounded-full border border-[#dadce0] bg-white px-3.5 py-2 text-xs text-[#3c4043] shadow-xs">
              <Video className="h-3.5 w-3.5 shrink-0 text-[#1a73e8]" aria-hidden="true" />
              <span className="sr-only">Camera</span>
              <select
                value={media.selectedVideoInputId}
                onChange={(e) => void media.selectVideoInput(e.target.value)}
                className="w-full truncate bg-transparent focus:outline-none"
                aria-label="Select camera"
              >
                {media.devices.videoInputs.length === 0 ? (
                  <option value="">Default camera</option>
                ) : (
                  media.devices.videoInputs.map((d, idx) => (
                    <option key={d.deviceId || idx} value={d.deviceId}>
                      {d.label || `Camera ${idx + 1}`}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>

          {media.mediaError && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-2xl border border-[#fde293] bg-[#fef7e0] px-4 py-3 text-xs text-[#5f4300]"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#b06000]" aria-hidden="true" />
              <span>{media.mediaError}</span>
            </div>
          )}
        </section>

        {/* Right: Elevated Join Card */}
        <section className="w-full max-w-sm rounded-3xl border border-[#e8eaed] bg-white p-7 text-center shadow-xl shadow-[#1a73e8]/5">
          <h1 className="text-[28px] font-semibold tracking-tight text-[#202124]">
            Ready to join?
          </h1>

          <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#f8f9fa] px-3.5 py-1 text-xs font-medium text-[#5f6368]">
            <span
              className={`h-2 w-2 rounded-full ${
                previewPeers.length > 0 ? "bg-[#1e8e3e]" : "bg-[#9aa0a6]"
              }`}
              aria-hidden="true"
            />
            {renderOccupancyText()}
          </p>

          {previewPeers.length > 0 && (
            <div className="mt-3 flex items-center justify-center -space-x-2">
              {previewPeers.slice(0, 5).map((peer) => (
                <div
                  key={peer.id}
                  title={peer.name}
                  className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-xs font-medium text-white shadow-xs"
                  style={{ backgroundColor: getAvatarColor(peer.name) }}
                >
                  {getInitials(peer.name)}
                </div>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => void handleJoinSubmit(e, false)}
            className="mt-6 w-full flex flex-col gap-4"
            noValidate
          >
            <div className="text-left">
              <label
                htmlFor="display-name-input"
                className="mb-1.5 block text-xs font-medium text-[#5f6368]"
              >
                Your display name
              </label>
              <div className="flex items-center gap-2 rounded-xl border border-[#dadce0] bg-white px-3 py-1.5 focus-within:border-[#1a73e8] focus-within:ring-2 focus-within:ring-[#1a73e8]/20">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: getAvatarColor(avatarSeed) }}
                >
                  {getInitials(avatarSeed)}
                </span>
                <input
                  id="display-name-input"
                  type="text"
                  maxLength={50}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                  placeholder="Enter your name"
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={nameError ? "display-name-error" : undefined}
                  className="w-full py-1.5 text-sm text-[#202124] focus:outline-none"
                />
              </div>
              {nameError && (
                <p id="display-name-error" className="mt-1 text-xs text-[#d93025]">
                  {nameError}
                </p>
              )}
            </div>

            {joinError && (
              <div
                role="alert"
                className="rounded-xl bg-[#fce8e6] px-3 py-2 text-xs text-[#c5221f]"
              >
                {joinError}
              </div>
            )}

            <div className="flex flex-col gap-2.5 pt-1">
              <button
                type="submit"
                disabled={joining || !connected}
                className="inline-flex h-12 w-full items-center justify-center rounded-full bg-gradient-to-r from-[#1d4ed8] to-[#1a73e8] px-7 text-sm font-semibold text-white shadow-md shadow-[#1a73e8]/25 transition-all hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] focus-visible:ring-offset-2"
              >
                {joining ? "Joining..." : "Join now"}
              </button>

              <button
                type="button"
                disabled={joining || !connected}
                onClick={(e) => void handleJoinSubmit(e, true)}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-[#dadce0] bg-white px-5 text-sm font-medium text-[#1a73e8] transition-colors hover:bg-[#f1f6fe] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] focus-visible:ring-offset-2"
              >
                <MonitorUp className="h-4 w-4" aria-hidden="true" />
                Present screen
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
