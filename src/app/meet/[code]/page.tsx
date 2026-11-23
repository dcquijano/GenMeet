"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { GenMeetLogo } from "@/components/GenMeetLogo";
import { MeetingLobby } from "@/components/MeetingLobby";
import { MeetingRoom } from "@/components/MeetingRoom";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { useWebRTCRoom } from "@/hooks/useWebRTCRoom";
import { parseMeetingInput } from "@/lib/meeting-code";

export default function MeetingPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const rawCode = typeof params?.code === "string" ? params.code : "";
  const roomId = parseMeetingInput(rawCode);

  const [displayName, setDisplayName] = useState("Guest");
  const [leftCall, setLeftCall] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("genmeet:displayName");
    if (saved && saved.trim()) {
      setDisplayName(saved.trim());
    }
  }, []);

  const media = useMediaDevices();
  const webrtc = useWebRTCRoom({
    roomId: roomId ?? "invalid",
    localStream: media.cameraStream,
    screenStream: media.screenStream,
    audioEnabled: media.audioEnabled,
    videoEnabled: media.videoEnabled,
    screenSharing: media.screenSharing,
  });

  if (!roomId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4 text-center text-[#202124]">
        <GenMeetLogo />
        <h1 className="mt-6 text-2xl font-normal">Check your meeting code</h1>
        <p className="mt-2 max-w-md text-sm text-[#5f6368]">
          Make sure you entered the right meeting code, such as{" "}
          <code className="rounded bg-[#f1f3f4] px-1.5 py-0.5">abc-defg-hij</code>.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-full bg-[#1a73e8] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#1765cc]"
        >
          Return to home screen
        </Link>
      </div>
    );
  }

  const handleJoin = async (name: string, startWithScreenShare = false) => {
    setDisplayName(name);
    window.localStorage.setItem("genmeet:displayName", name);
    try {
      const raw = window.localStorage.getItem("genmeet:recentRooms");
      const existing = raw ? (JSON.parse(raw) as unknown[]) : [];
      const updated = [
        roomId,
        ...existing.filter((item): item is string => typeof item === "string" && item !== roomId),
      ].slice(0, 3);
      window.localStorage.setItem("genmeet:recentRooms", JSON.stringify(updated));
    } catch {
      // Ignore localStorage failures
    }
    setLeftCall(false);
    if (startWithScreenShare) {
      await media.startScreenShare();
    }
    await webrtc.joinRoom(name);
  };

  const handleLeave = () => {
    webrtc.leaveRoom();
    media.stopScreenShare();
    setLeftCall(true);
  };

  const handleRejoin = async () => {
    setLeftCall(false);
    await webrtc.joinRoom(displayName);
  };

  if (leftCall) {
    return (
      <div className="flex min-h-screen flex-col bg-white text-[#202124]">
        <header className="px-6 py-4">
          <Link href="/">
            <GenMeetLogo />
          </Link>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
          <h1 className="text-3xl font-normal tracking-tight">
            You left the meeting
          </h1>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void handleRejoin()}
              className="rounded-full border border-[#dadce0] px-6 py-2.5 text-sm font-medium text-[#1a73e8] hover:bg-[#f1f6fe] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]"
            >
              Rejoin
            </button>
            <button
              type="button"
              onClick={() => {
                media.stopAllMedia();
                router.push("/");
              }}
              className="rounded-full bg-[#1a73e8] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#1765cc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]"
            >
              Return to home screen
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (!webrtc.joined) {
    return (
      <MeetingLobby
        roomId={roomId}
        initialName={displayName}
        media={media}
        previewPeers={webrtc.previewPeers}
        joinError={webrtc.joinError}
        connected={webrtc.connected}
        onJoin={handleJoin}
      />
    );
  }

  return (
    <MeetingRoom
      roomId={roomId}
      selfId={webrtc.selfId}
      selfName={displayName}
      media={media}
      peers={webrtc.peers}
      chatMessages={webrtc.chatMessages}
      reactions={webrtc.reactions}
      handRaised={webrtc.handRaised}
      onToggleHand={webrtc.toggleHandRaise}
      onSendReaction={webrtc.sendReaction}
      onSendChat={webrtc.sendChatMessage}
      onLeave={handleLeave}
    />
  );
}
