"use client";

import React, { useEffect, useRef } from "react";
import { Hand, MicOff, MonitorUp, Pin, PinOff } from "lucide-react";
import { useActiveSpeaker } from "@/hooks/useActiveSpeaker";
import { getAvatarColor, getInitials } from "@/lib/meeting-code";

interface VideoTileProps {
  name: string;
  stream: MediaStream | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing?: boolean;
  handRaised?: boolean;
  isLocal?: boolean;
  mirrored?: boolean;
  pinned?: boolean;
  audioOutputId?: string;
  compact?: boolean;
  onTogglePin?: () => void;
}

export function VideoTile({
  name,
  stream,
  audioEnabled,
  videoEnabled,
  screenSharing = false,
  handRaised = false,
  isLocal = false,
  mirrored = false,
  pinned = false,
  audioOutputId,
  compact = false,
  onTogglePin,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { isSpeaking, audioLevel } = useActiveSpeaker(stream, audioEnabled);

  const hasLiveVideoTrack = Boolean(
    stream &&
      stream.getVideoTracks().some((t) => t.readyState === "live" && t.enabled)
  );
  const showVideo = (videoEnabled || screenSharing) && hasLiveVideoTrack;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    const el = videoRef.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!el || isLocal || !audioOutputId || !el.setSinkId) return;
    el.setSinkId(audioOutputId).catch(() => {
      // Browser may block sink selection until gesture or if unsupported
    });
  }, [audioOutputId, isLocal]);

  const avatarBg = getAvatarColor(name);
  const initials = getInitials(name);

  return (
    <div
      className={`group relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#2d3035] via-[#26282c] to-[#1d1f22] transition-all duration-150 ${
        isSpeaking && audioEnabled
          ? "ring-2 ring-[#8ab4f8] shadow-[0_0_24px_rgba(138,180,248,0.28)]"
          : "ring-1 ring-white/10"
      }`}
    >
      {/* Video / Screen Share element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={`h-full w-full ${
          screenSharing ? "object-contain bg-[#141517]" : "object-cover"
        } ${mirrored && !screenSharing ? "-scale-x-100" : ""} ${
          showVideo ? "opacity-100" : "opacity-0 pointer-events-none absolute inset-0"
        }`}
      />

      {/* Avatar Fallback when camera is off */}
      {!showVideo && (
        <div className="relative flex flex-col items-center justify-center p-4">
          <div
            className="pointer-events-none absolute h-36 w-36 rounded-full opacity-20 blur-2xl"
            style={{ backgroundColor: avatarBg }}
            aria-hidden="true"
          />
          <div
            className={`relative flex items-center justify-center rounded-full font-semibold text-white shadow-xl ring-2 ring-white/15 transition-transform duration-150 ${
              compact ? "h-14 w-14 text-lg" : "h-24 w-24 text-3xl"
            }`}
            style={{
              backgroundColor: avatarBg,
              transform:
                isSpeaking && audioEnabled
                  ? `scale(${1 + audioLevel * 0.08})`
                  : "scale(1)",
            }}
          >
            {initials}
            {isSpeaking && audioEnabled && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-2 rounded-full border-2 border-[#a8c7fa]/75"
              />
            )}
          </div>
        </div>
      )}

      {/* Top-right status badges */}
      <div className="absolute right-3 top-3 flex items-center gap-2">
        {handRaised && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-[#fdd663] px-2.5 py-1 text-xs font-semibold text-[#202124] shadow-md"
            title={`${name} raised their hand`}
          >
            <Hand className="h-3.5 w-3.5" aria-hidden="true" />
            {!compact && <span>Hand raised</span>}
          </span>
        )}
        {!audioEnabled && (
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#18191c]/80 text-[#f28b82] ring-1 ring-white/10 backdrop-blur-md"
            title="Microphone is off"
            aria-label="Microphone is off"
          >
            <MicOff className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
      </div>

      {/* Hover pin action */}
      {onTogglePin && (
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={pinned ? `Unpin ${name}` : `Pin ${name} to main screen`}
          className={`absolute left-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#18191c]/80 text-white ring-1 ring-white/15 backdrop-blur-md transition-opacity hover:bg-[#18191c] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ab4f8] ${
            pinned ? "opacity-100 text-[#8ab4f8]" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          {pinned ? (
            <PinOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Pin className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      )}

      {/* Bottom-left participant name label */}
      <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-full bg-[#18191c]/75 px-3 py-1 text-xs font-medium text-white ring-1 ring-white/10 backdrop-blur-md sm:text-sm">
        {screenSharing && (
          <MonitorUp className="h-3.5 w-3.5 shrink-0 text-[#8ab4f8]" aria-hidden="true" />
        )}
        <span className="truncate">
          {name}
          {isLocal ? " (You)" : ""}
        </span>
        {audioEnabled && isSpeaking && (
          <span className="inline-flex items-end gap-0.5 h-3" aria-hidden="true">
            <span
              className="w-0.5 rounded-full bg-[#8ab4f8] transition-all duration-75"
              style={{ height: `${Math.max(4, Math.round(4 + audioLevel * 8))}px` }}
            />
            <span
              className="w-0.5 rounded-full bg-[#8ab4f8] transition-all duration-75"
              style={{ height: `${Math.max(6, Math.round(6 + audioLevel * 10))}px` }}
            />
            <span
              className="w-0.5 rounded-full bg-[#8ab4f8] transition-all duration-75"
              style={{ height: `${Math.max(4, Math.round(4 + audioLevel * 7))}px` }}
            />
          </span>
        )}
      </div>
    </div>
  );
}
