import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import {
  MAX_CHAT_HISTORY,
  MAX_ROOM_PARTICIPANTS,
  chatMessageSchema,
  joinRoomSchema,
  mediaStateSchema,
  previewRoomSchema,
  raiseHandSchema,
  reactionSchema,
  signalPayloadSchema,
  type ChatMessage,
  type ParticipantInfo,
  type ReactionEvent,
  type RoomPreviewResponse,
} from "../lib/signaling-schema";

interface RoomState {
  participants: Map<string, ParticipantInfo>;
  chatHistory: ChatMessage[];
}

interface SocketMetadata {
  roomId: string | null;
}

type AckCallback<T = unknown> = (response: { ok: true; data: T } | { ok: false; error: string }) => void;

/**
 * In-memory room registry and Socket.IO signaling coordinator.
 * Exported as a factory so tests can spin up isolated signaling servers.
 */
export function createSignalingController() {
  const rooms = new Map<string, RoomState>();
  const socketMeta = new Map<string, SocketMetadata>();

  function getOrCreateRoom(roomId: string): RoomState {
    let room = rooms.get(roomId);
    if (!room) {
      room = {
        participants: new Map(),
        chatHistory: [],
      };
      rooms.set(roomId, room);
    }
    return room;
  }

  function removeParticipantFromRoom(io: Server, socket: Socket, roomId: string): void {
    const room = rooms.get(roomId);
    if (!room) return;

    const existed = room.participants.delete(socket.id);
    socket.leave(roomId);

    if (existed) {
      io.to(roomId).emit("peer-left", { peerId: socket.id });
    }

    if (room.participants.size === 0) {
      rooms.delete(roomId);
    }
  }

  function attach(io: Server): void {
    io.on("connection", (socket: Socket) => {
      socketMeta.set(socket.id, { roomId: null });

      socket.on("preview-room", (rawPayload: unknown, ack?: AckCallback<RoomPreviewResponse>) => {
        const parsed = previewRoomSchema.safeParse(rawPayload);
        if (!parsed.success) {
          ack?.({ ok: false, error: "Invalid meeting code" });
          return;
        }
        const room = rooms.get(parsed.data.roomId);
        const participants = room
          ? Array.from(room.participants.values()).map(({ id, name }) => ({ id, name }))
          : [];
        ack?.({
          ok: true,
          data: {
            roomId: parsed.data.roomId,
            participants,
          },
        });
      });

      socket.on(
        "join-room",
        (
          rawPayload: unknown,
          ack?: AckCallback<{
            selfId: string;
            participants: ParticipantInfo[];
            chatHistory: ChatMessage[];
          }>
        ) => {
          const parsed = joinRoomSchema.safeParse(rawPayload);
          if (!parsed.success) {
            ack?.({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid join request" });
            return;
          }

          const { roomId, name, audioEnabled, videoEnabled, screenSharing } = parsed.data;
          const meta = socketMeta.get(socket.id);

          // Leave any previous room before joining a new one.
          if (meta?.roomId && meta.roomId !== roomId) {
            removeParticipantFromRoom(io, socket, meta.roomId);
            meta.roomId = null;
          }

          const room = getOrCreateRoom(roomId);
          if (!room.participants.has(socket.id) && room.participants.size >= MAX_ROOM_PARTICIPANTS) {
            ack?.({
              ok: false,
              error: `This meeting is full (max ${MAX_ROOM_PARTICIPANTS} participants).`,
            });
            return;
          }

          const participant: ParticipantInfo = {
            id: socket.id,
            name,
            audioEnabled,
            videoEnabled,
            screenSharing,
            handRaised: false,
            joinedAt: Date.now(),
          };

          const existingPeers = Array.from(room.participants.values()).filter(
            (p) => p.id !== socket.id
          );

          room.participants.set(socket.id, participant);
          socketMeta.set(socket.id, { roomId });
          socket.join(roomId);

          socket.to(roomId).emit("peer-joined", participant);
          ack?.({
            ok: true,
            data: {
              selfId: socket.id,
              participants: existingPeers,
              chatHistory: [...room.chatHistory],
            },
          });
        }
      );

      socket.on("signal", (rawPayload: unknown) => {
        const meta = socketMeta.get(socket.id);
        if (!meta?.roomId) return;

        const parsed = signalPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) return;

        const room = rooms.get(meta.roomId);
        if (!room) return;

        // Only forward signaling messages to peers currently in the same room.
        if (!room.participants.has(parsed.data.targetId)) return;

        io.to(parsed.data.targetId).emit("signal", {
          senderId: socket.id,
          description: parsed.data.description,
          candidate: parsed.data.candidate,
        });
      });

      socket.on("media-state", (rawPayload: unknown) => {
        const meta = socketMeta.get(socket.id);
        if (!meta?.roomId) return;

        const parsed = mediaStateSchema.safeParse(rawPayload);
        if (!parsed.success) return;

        const room = rooms.get(meta.roomId);
        const participant = room?.participants.get(socket.id);
        if (!participant) return;

        participant.audioEnabled = parsed.data.audioEnabled;
        participant.videoEnabled = parsed.data.videoEnabled;
        participant.screenSharing = parsed.data.screenSharing;

        socket.to(meta.roomId).emit("peer-media-state", {
          peerId: socket.id,
          ...parsed.data,
        });
      });

      socket.on("raise-hand", (rawPayload: unknown) => {
        const meta = socketMeta.get(socket.id);
        if (!meta?.roomId) return;

        const parsed = raiseHandSchema.safeParse(rawPayload);
        if (!parsed.success) return;

        const room = rooms.get(meta.roomId);
        const participant = room?.participants.get(socket.id);
        if (!participant) return;

        participant.handRaised = parsed.data.raised;

        io.to(meta.roomId).emit("peer-hand-state", {
          peerId: socket.id,
          raised: parsed.data.raised,
        });
      });

      socket.on("chat-message", (rawPayload: unknown, ack?: AckCallback<ChatMessage>) => {
        const meta = socketMeta.get(socket.id);
        if (!meta?.roomId) {
          ack?.({ ok: false, error: "Not in a meeting" });
          return;
        }

        const parsed = chatMessageSchema.safeParse(rawPayload);
        if (!parsed.success) {
          ack?.({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid message" });
          return;
        }

        const room = rooms.get(meta.roomId);
        const participant = room?.participants.get(socket.id);
        if (!room || !participant) {
          ack?.({ ok: false, error: "Participant not found" });
          return;
        }

        const message: ChatMessage = {
          id: randomUUID(),
          senderId: socket.id,
          senderName: participant.name,
          text: parsed.data.text,
          timestamp: Date.now(),
        };

        room.chatHistory.push(message);
        if (room.chatHistory.length > MAX_CHAT_HISTORY) {
          room.chatHistory.shift();
        }

        io.to(meta.roomId).emit("chat-message", message);
        ack?.({ ok: true, data: message });
      });

      socket.on("reaction", (rawPayload: unknown) => {
        const meta = socketMeta.get(socket.id);
        if (!meta?.roomId) return;

        const parsed = reactionSchema.safeParse(rawPayload);
        if (!parsed.success) return;

        const room = rooms.get(meta.roomId);
        const participant = room?.participants.get(socket.id);
        if (!participant) return;

        const event: ReactionEvent = {
          id: randomUUID(),
          senderId: socket.id,
          senderName: participant.name,
          emoji: parsed.data.emoji,
          timestamp: Date.now(),
        };

        io.to(meta.roomId).emit("reaction", event);
      });

      socket.on("leave-room", () => {
        const meta = socketMeta.get(socket.id);
        if (meta?.roomId) {
          removeParticipantFromRoom(io, socket, meta.roomId);
          meta.roomId = null;
        }
      });

      socket.on("disconnect", () => {
        const meta = socketMeta.get(socket.id);
        if (meta?.roomId) {
          removeParticipantFromRoom(io, socket, meta.roomId);
        }
        socketMeta.delete(socket.id);
      });
    });
  }

  return {
    attach,
    getRoomCount: () => rooms.size,
    getParticipantCount: (roomId: string) => rooms.get(roomId)?.participants.size ?? 0,
  };
}
