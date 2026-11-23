import { z } from "zod";
import { ROOM_CODE_REGEX } from "./meeting-code";

// ceiling: mesh WebRTC topology degrades above ~12 peers; upgrade path is an SFU (mediasoup or LiveKit).
export const MAX_ROOM_PARTICIPANTS = 12;
export const MAX_CHAT_HISTORY = 100;
export const MAX_CHAT_MESSAGE_LENGTH = 1000;
export const MAX_DISPLAY_NAME_LENGTH = 50;

export const ALLOWED_REACTIONS = [
  "💖",
  "👍",
  "🎉",
  "👏",
  "😂",
  "😮",
  "😢",
  "🤔",
  "👎",
] as const;

export type ReactionEmoji = (typeof ALLOWED_REACTIONS)[number];

export const roomIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(ROOM_CODE_REGEX, "Invalid meeting code");

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(MAX_DISPLAY_NAME_LENGTH, "Name is too long");

export const joinRoomSchema = z.object({
  roomId: roomIdSchema,
  name: displayNameSchema,
  audioEnabled: z.boolean(),
  videoEnabled: z.boolean(),
  screenSharing: z.boolean().optional().default(false),
});

export const previewRoomSchema = z.object({
  roomId: roomIdSchema,
});

export const mediaStateSchema = z.object({
  audioEnabled: z.boolean(),
  videoEnabled: z.boolean(),
  screenSharing: z.boolean(),
});

export const raiseHandSchema = z.object({
  raised: z.boolean(),
});

export const chatMessageSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(MAX_CHAT_MESSAGE_LENGTH, "Message is too long"),
});

export const reactionSchema = z.object({
  emoji: z.enum(ALLOWED_REACTIONS),
});

const sdpDescriptionSchema = z.object({
  type: z.enum(["offer", "answer", "pranswer", "rollback"]),
  sdp: z.string().max(128_000).optional(),
});

const iceCandidateSchema = z.object({
  candidate: z.string().max(4096),
  sdpMid: z.string().max(128).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
});

export const signalPayloadSchema = z.object({
  targetId: z.string().min(1).max(128),
  description: sdpDescriptionSchema.optional(),
  candidate: iceCandidateSchema.optional(),
}).refine(
  (val) => Boolean(val.description) !== Boolean(val.candidate),
  "Signal must contain either description or candidate"
);

export interface ParticipantInfo {
  id: string;
  name: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  handRaised: boolean;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

export interface ReactionEvent {
  id: string;
  senderId: string;
  senderName: string;
  emoji: ReactionEmoji;
  timestamp: number;
}

export interface RoomPreviewResponse {
  roomId: string;
  participants: Pick<ParticipantInfo, "id" | "name">[];
}
