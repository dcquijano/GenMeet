"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ChatMessage,
  ParticipantInfo,
  ReactionEmoji,
  ReactionEvent,
  RoomPreviewResponse,
} from "@/lib/signaling-schema";

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ],
};

interface PeerSession {
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  polite: boolean;
  queuedCandidates: RTCIceCandidateInit[];
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
}

export interface RemotePeerState extends ParticipantInfo {
  stream: MediaStream | null;
}

interface UseWebRTCRoomArgs {
  roomId: string;
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
}

export function useWebRTCRoom({
  roomId,
  localStream,
  screenStream,
  audioEnabled,
  videoEnabled,
  screenSharing,
}: UseWebRTCRoomArgs) {
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [selfId, setSelfId] = useState<string>("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [previewPeers, setPreviewPeers] = useState<Pick<ParticipantInfo, "id" | "name">[]>([]);
  const [peers, setPeers] = useState<Record<string, RemotePeerState>>({});
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);
  const [handRaised, setHandRaised] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const selfIdRef = useRef<string>("");
  const peerSessionsRef = useRef<Map<string, PeerSession>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const screenStreamRef = useRef<MediaStream | null>(screenStream);
  const joinedRef = useRef(false);

  localStreamRef.current = localStream;
  screenStreamRef.current = screenStream;
  joinedRef.current = joined;

  const getActiveVideoTrack = useCallback((): MediaStreamTrack | null => {
    return (
      screenStreamRef.current?.getVideoTracks()[0] ??
      localStreamRef.current?.getVideoTracks()[0] ??
      null
    );
  }, []);

  const getActiveAudioTrack = useCallback((): MediaStreamTrack | null => {
    return localStreamRef.current?.getAudioTracks()[0] ?? null;
  }, []);

  const closePeerSession = useCallback((peerId: string) => {
    const session = peerSessionsRef.current.get(peerId);
    if (!session) return;
    session.pc.onicecandidate = null;
    session.pc.ontrack = null;
    session.pc.onnegotiationneeded = null;
    session.pc.close();
    peerSessionsRef.current.delete(peerId);
  }, []);

  const closeAllPeers = useCallback(() => {
    for (const peerId of Array.from(peerSessionsRef.current.keys())) {
      closePeerSession(peerId);
    }
  }, [closePeerSession]);

  const ensurePeerSession = useCallback(
    (peerId: string): PeerSession => {
      const existing = peerSessionsRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(RTC_CONFIG);
      const myId = selfIdRef.current;
      const polite = myId.localeCompare(peerId) < 0;

      const session: PeerSession = {
        pc,
        remoteStream: new MediaStream(),
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        polite,
        queuedCandidates: [],
        audioSender: null,
        videoSender: null,
      };

      const audioTrack = getActiveAudioTrack();
      const videoTrack = getActiveVideoTrack();
      const outgoingStream = new MediaStream();

      if (audioTrack) {
        outgoingStream.addTrack(audioTrack);
        session.audioSender = pc.addTrack(audioTrack, outgoingStream);
      }
      if (videoTrack) {
        outgoingStream.addTrack(videoTrack);
        session.videoSender = pc.addTrack(videoTrack, outgoingStream);
      }

      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit("signal", {
            targetId: peerId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        for (const existingTrack of session.remoteStream.getTracks()) {
          if (existingTrack.kind === event.track.kind && existingTrack.id !== event.track.id) {
            session.remoteStream.removeTrack(existingTrack);
          }
        }
        if (!session.remoteStream.getTracks().some((t) => t.id === event.track.id)) {
          session.remoteStream.addTrack(event.track);
        }
        const updatedStream = new MediaStream(session.remoteStream.getTracks());
        setPeers((prev) => {
          const current = prev[peerId];
          if (!current) return prev;
          return {
            ...prev,
            [peerId]: {
              ...current,
              stream: updatedStream,
            },
          };
        });
      };

      pc.onnegotiationneeded = async () => {
        if (!socketRef.current) return;
        try {
          session.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) {
            socketRef.current.emit("signal", {
              targetId: peerId,
              description: {
                type: pc.localDescription.type,
                sdp: pc.localDescription.sdp,
              },
            });
          }
        } catch {
          // Ignore transient negotiation race errors handled by Perfect Negotiation
        } finally {
          session.makingOffer = false;
        }
      };

      peerSessionsRef.current.set(peerId, session);
      return session;
    },
    [getActiveAudioTrack, getActiveVideoTrack]
  );

  // Sync local audio/video/screen tracks into active peer connections whenever tracks change
  useEffect(() => {
    if (!joined) return;
    const audioTrack = getActiveAudioTrack();
    const videoTrack = getActiveVideoTrack();

    for (const [, session] of peerSessionsRef.current.entries()) {
      const { pc } = session;

      if (audioTrack) {
        if (session.audioSender) {
          if (session.audioSender.track !== audioTrack) {
            void session.audioSender.replaceTrack(audioTrack);
          }
        } else {
          session.audioSender = pc.addTrack(audioTrack, new MediaStream([audioTrack]));
        }
      }

      if (videoTrack) {
        if (session.videoSender) {
          if (session.videoSender.track !== videoTrack) {
            void session.videoSender.replaceTrack(videoTrack);
          }
        } else {
          session.videoSender = pc.addTrack(videoTrack, new MediaStream([videoTrack]));
        }
      } else if (session.videoSender && session.videoSender.track) {
        void session.videoSender.replaceTrack(null);
      }
    }
  }, [joined, localStream, screenStream, getActiveAudioTrack, getActiveVideoTrack]);

  // Broadcast media-state updates to room peers
  useEffect(() => {
    if (!joined || !socketRef.current) return;
    socketRef.current.emit("media-state", {
      audioEnabled,
      videoEnabled,
      screenSharing,
    });
  }, [joined, audioEnabled, videoEnabled, screenSharing]);

  // Initialize Socket.IO connection
  useEffect(() => {
    const socket = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    const fetchPreview = () => {
      socket.emit(
        "preview-room",
        { roomId },
        (res: { ok: true; data: RoomPreviewResponse } | { ok: false }) => {
          if (res.ok) {
            setPreviewPeers(res.data.participants);
          }
        }
      );
    };

    socket.on("connect", () => {
      setConnected(true);
      selfIdRef.current = socket.id ?? "";
      setSelfId(socket.id ?? "");
      if (!joinedRef.current) {
        fetchPreview();
      }
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    const previewInterval = window.setInterval(() => {
      if (!joinedRef.current && socket.connected) {
        fetchPreview();
      }
    }, 5000);

    socket.on("peer-joined", (participant: ParticipantInfo) => {
      setPeers((prev) => ({
        ...prev,
        [participant.id]: {
          ...participant,
          stream: prev[participant.id]?.stream ?? null,
        },
      }));
      ensurePeerSession(participant.id);
    });

    socket.on("peer-left", ({ peerId }: { peerId: string }) => {
      closePeerSession(peerId);
      setPeers((prev) => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
    });

    socket.on(
      "peer-media-state",
      (payload: { peerId: string; audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean }) => {
        setPeers((prev) => {
          const existing = prev[payload.peerId];
          if (!existing) return prev;
          return {
            ...prev,
            [payload.peerId]: {
              ...existing,
              audioEnabled: payload.audioEnabled,
              videoEnabled: payload.videoEnabled,
              screenSharing: payload.screenSharing,
            },
          };
        });
      }
    );

    socket.on("peer-hand-state", ({ peerId, raised }: { peerId: string; raised: boolean }) => {
      if (peerId === selfIdRef.current) {
        setHandRaised(raised);
        return;
      }
      setPeers((prev) => {
        const existing = prev[peerId];
        if (!existing) return prev;
        return {
          ...prev,
          [peerId]: {
            ...existing,
            handRaised: raised,
          },
        };
      });
    });

    socket.on("chat-message", (msg: ChatMessage) => {
      setChatMessages((prev) => [...prev, msg]);
    });

    socket.on("reaction", (event: ReactionEvent) => {
      setReactions((prev) => [...prev, event]);
      window.setTimeout(() => {
        setReactions((prev) => prev.filter((item) => item.id !== event.id));
      }, 2800);
    });

    socket.on(
      "signal",
      async ({
        senderId,
        description,
        candidate,
      }: {
        senderId: string;
        description?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit;
      }) => {
        const session = ensurePeerSession(senderId);
        const { pc } = session;

        try {
          if (description) {
            const readyForOffer =
              !session.makingOffer &&
              (pc.signalingState === "stable" || session.isSettingRemoteAnswerPending);
            const offerCollision = description.type === "offer" && !readyForOffer;

            session.ignoreOffer = !session.polite && offerCollision;
            if (session.ignoreOffer) return;

            session.isSettingRemoteAnswerPending = description.type === "answer";
            await pc.setRemoteDescription(description);
            session.isSettingRemoteAnswerPending = false;

            // Flush any ICE candidates that arrived before remoteDescription was ready
            while (session.queuedCandidates.length > 0) {
              const queued = session.queuedCandidates.shift();
              if (queued) {
                await pc.addIceCandidate(queued);
              }
            }

            if (description.type === "offer") {
              await pc.setLocalDescription();
              if (pc.localDescription) {
                socket.emit("signal", {
                  targetId: senderId,
                  description: {
                    type: pc.localDescription.type,
                    sdp: pc.localDescription.sdp,
                  },
                });
              }
            }
          } else if (candidate) {
            if (!pc.remoteDescription) {
              session.queuedCandidates.push(candidate);
              return;
            }
            try {
              await pc.addIceCandidate(candidate);
            } catch {
              if (!session.ignoreOffer) {
                // Ignore stale ICE candidates from superseded offers
              }
            }
          }
        } catch {
          session.isSettingRemoteAnswerPending = false;
        }
      }
    );

    return () => {
      window.clearInterval(previewInterval);
      closeAllPeers();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, ensurePeerSession, closePeerSession, closeAllPeers]);

  const joinRoom = useCallback(
    async (name: string) => {
      const socket = socketRef.current;
      if (!socket) return false;
      setJoinError(null);

      return new Promise<boolean>((resolve) => {
        socket.emit(
          "join-room",
          {
            roomId,
            name: name.trim(),
            audioEnabled,
            videoEnabled,
            screenSharing,
          },
          (
            res:
              | {
                  ok: true;
                  data: {
                    selfId: string;
                    participants: ParticipantInfo[];
                    chatHistory: ChatMessage[];
                  };
                }
              | { ok: false; error: string }
          ) => {
            if (!res.ok) {
              setJoinError(res.error);
              resolve(false);
              return;
            }

            selfIdRef.current = res.data.selfId;
            setSelfId(res.data.selfId);
            setChatMessages(res.data.chatHistory);

            const initialPeers: Record<string, RemotePeerState> = {};
            for (const p of res.data.participants) {
              initialPeers[p.id] = { ...p, stream: null };
            }
            setPeers(initialPeers);
            setJoined(true);

            // Establish PeerConnections to existing room members
            for (const p of res.data.participants) {
              ensurePeerSession(p.id);
            }
            resolve(true);
          }
        );
      });
    },
    [roomId, audioEnabled, videoEnabled, screenSharing, ensurePeerSession]
  );

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit("leave-room");
    closeAllPeers();
    setPeers({});
    setJoined(false);
    setHandRaised(false);
  }, [closeAllPeers]);

  const sendChatMessage = useCallback(async (text: string): Promise<string | null> => {
    const socket = socketRef.current;
    if (!socket) return "Not connected";
    return new Promise((resolve) => {
      socket.emit("chat-message", { text }, (res: { ok: boolean; error?: string }) => {
        resolve(res.ok ? null : res.error ?? "Failed to send message");
      });
    });
  }, []);

  const toggleHandRaise = useCallback(() => {
    const next = !handRaised;
    setHandRaised(next);
    socketRef.current?.emit("raise-hand", { raised: next });
  }, [handRaised]);

  const sendReaction = useCallback((emoji: ReactionEmoji) => {
    socketRef.current?.emit("reaction", { emoji });
  }, []);

  return {
    connected,
    joined,
    selfId,
    joinError,
    previewPeers,
    peers,
    chatMessages,
    reactions,
    handRaised,
    joinRoom,
    leaveRoom,
    sendChatMessage,
    toggleHandRaise,
    sendReaction,
  };
}
