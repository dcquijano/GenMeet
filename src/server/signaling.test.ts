import { EventEmitter } from "node:events";
import type { Server, Socket } from "socket.io";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_ROOM_PARTICIPANTS } from "../lib/signaling-schema";
import { createSignalingController } from "./signaling";

class FakeSocket extends EventEmitter {
  readonly id: string;
  private readonly bus: FakeIO;
  readonly joinedRooms = new Set<string>();
  private readonly serverHandlers = new Map<string, (...args: unknown[]) => void>();

  constructor(id: string, bus: FakeIO) {
    super();
    this.id = id;
    this.bus = bus;
  }

  /** Register a server-side listener (used by attach). */
  onServer(event: string, fn: (...args: unknown[]) => void): this {
    this.serverHandlers.set(event, fn);
    return this;
  }

  join(room: string): void {
    this.joinedRooms.add(room);
  }

  leave(room: string): void {
    this.joinedRooms.delete(room);
  }

  to(target: string) {
    return {
      emit: (event: string, payload: unknown) => {
        this.bus.emitToRoom(target, event, payload, this.id);
      },
    };
  }

  /** Simulate client emitting an event to the server. */
  sendToServer<T = unknown>(event: string, payload?: unknown): Promise<T> {
    return new Promise((resolve) => {
      const handler = this.serverHandlers.get(event);
      if (!handler) {
        resolve(undefined as T);
        return;
      }
      if (handler.length >= 2) {
        handler(payload, (ack: T) => resolve(ack));
      } else {
        handler(payload);
        resolve(undefined as T);
      }
    });
  }

  disconnectClient(): void {
    this.bus.disconnectSocket(this.id);
  }
}

class FakeIO {
  private readonly sockets = new Map<string, FakeSocket>();
  private connectionHandler: ((socket: Socket) => void) | null = null;
  private seq = 0;

  on(event: string, handler: (socket: Socket) => void): void {
    if (event === "connection") {
      this.connectionHandler = handler;
    }
  }

  to(target: string) {
    return {
      emit: (event: string, payload: unknown) => {
        if (this.sockets.has(target)) {
          this.sockets.get(target)?.emit(event, payload);
          return;
        }
        this.emitToRoom(target, event, payload);
      },
    };
  }

  emitToRoom(room: string, event: string, payload: unknown, excludeId?: string): void {
    for (const socket of this.sockets.values()) {
      if (socket.id === excludeId) continue;
      if (socket.joinedRooms.has(room)) {
        socket.emit(event, payload);
      }
    }
  }

  connect(customId?: string): FakeSocket {
    this.seq += 1;
    const id = customId ?? `sock-${this.seq}`;
    const socket = new FakeSocket(id, this);
    // Proxy .on() used by signaling controller to onServer()
    const proxy = new Proxy(socket, {
      get(target, prop) {
        if (prop === "on") {
          return (ev: string, fn: (...args: unknown[]) => void) => target.onServer(ev, fn);
        }
        const val = Reflect.get(target, prop);
        return typeof val === "function" ? val.bind(target) : val;
      },
    });
    this.sockets.set(id, socket);
    this.connectionHandler?.(proxy as unknown as Socket);
    return socket;
  }

  disconnectSocket(id: string): void {
    const socket = this.sockets.get(id);
    if (!socket) return;
    socket.sendToServer("disconnect");
    this.sockets.delete(id);
  }
}

describe("SignalingController", () => {
  let fakeIo: FakeIO;
  let controller: ReturnType<typeof createSignalingController>;

  beforeEach(() => {
    fakeIo = new FakeIO();
    controller = createSignalingController();
    controller.attach(fakeIo as unknown as Server);
  });

  it("allows two peers to preview, join, exchange signals, chat, raise hands, react, and clean up", async () => {
    const alice = fakeIo.connect("alice-1");
    const bob = fakeIo.connect("bob-2");

    const aliceJoin = await alice.sendToServer<{
      ok: boolean;
      data: { selfId: string; participants: unknown[]; chatHistory: unknown[] };
    }>("join-room", {
      roomId: "abc-defg-hij",
      name: "Alice",
      audioEnabled: true,
      videoEnabled: true,
    });
    expect(aliceJoin.ok).toBe(true);
    expect(aliceJoin.data.participants).toHaveLength(0);

    const preview = await bob.sendToServer<{
      ok: boolean;
      data: { roomId: string; participants: { id: string; name: string }[] };
    }>("preview-room", { roomId: "abc-defg-hij" });
    expect(preview.ok).toBe(true);
    expect(preview.data.participants.map((p) => p.name)).toEqual(["Alice"]);

    const peerJoinedEvents: unknown[] = [];
    alice.on("peer-joined", (p) => peerJoinedEvents.push(p));

    const bobJoin = await bob.sendToServer<{
      ok: boolean;
      data: { participants: { id: string; name: string }[] };
    }>("join-room", {
      roomId: "abc-defg-hij",
      name: "Bob",
      audioEnabled: false,
      videoEnabled: true,
    });
    expect(bobJoin.ok).toBe(true);
    expect(bobJoin.data.participants).toHaveLength(1);
    expect(bobJoin.data.participants[0].name).toBe("Alice");
    expect(peerJoinedEvents).toHaveLength(1);

    // Signal relay Alice -> Bob
    const receivedSignals: { senderId: string; description?: { type: string } }[] = [];
    bob.on("signal", (sig) => receivedSignals.push(sig));
    await alice.sendToServer("signal", {
      targetId: bob.id,
      description: { type: "offer", sdp: "v=0\r\n" },
    });
    expect(receivedSignals).toHaveLength(1);
    expect(receivedSignals[0].senderId).toBe(alice.id);
    expect(receivedSignals[0].description?.type).toBe("offer");

    // Chat message
    const bobChats: { senderName: string; text: string }[] = [];
    bob.on("chat-message", (msg) => bobChats.push(msg));
    const chatAck = await alice.sendToServer<{ ok: boolean }>("chat-message", {
      text: "Hello Bob!",
    });
    expect(chatAck.ok).toBe(true);
    expect(bobChats).toHaveLength(1);
    expect(bobChats[0].senderName).toBe("Alice");
    expect(bobChats[0].text).toBe("Hello Bob!");

    // Hand raise & reaction
    const handEvents: { peerId: string; raised: boolean }[] = [];
    bob.on("peer-hand-state", (ev) => handEvents.push(ev));
    await alice.sendToServer("raise-hand", { raised: true });
    expect(handEvents).toEqual([{ peerId: "alice-1", raised: true }]);

    const reactionEvents: { emoji: string }[] = [];
    bob.on("reaction", (ev) => reactionEvents.push(ev));
    await alice.sendToServer("reaction", { emoji: "🎉" });
    expect(reactionEvents[0].emoji).toBe("🎉");

    // Disconnect cleanup
    const leftEvents: { peerId: string }[] = [];
    alice.on("peer-left", (ev) => leftEvents.push(ev));
    bob.disconnectClient();
    expect(leftEvents).toEqual([{ peerId: "bob-2" }]);

    alice.disconnectClient();
    expect(controller.getRoomCount()).toBe(0);
  });

  it("blocks cross-room signal spoofing, invalid payloads, and enforces room capacity", async () => {
    const alice = fakeIo.connect("alice-1");
    const eve = fakeIo.connect("eve-2");

    await alice.sendToServer("join-room", {
      roomId: "room-one-111",
      name: "Alice",
      audioEnabled: true,
      videoEnabled: true,
    });
    await eve.sendToServer("join-room", {
      roomId: "room-two-222",
      name: "Eve",
      audioEnabled: true,
      videoEnabled: true,
    });

    let signalReceived = false;
    alice.on("signal", () => {
      signalReceived = true;
    });
    await eve.sendToServer("signal", {
      targetId: alice.id,
      description: { type: "offer", sdp: "malicious" },
    });
    expect(signalReceived).toBe(false);

    const badChat = await alice.sendToServer<{ ok: boolean }>("chat-message", {
      text: "   ",
    });
    expect(badChat.ok).toBe(false);

    // Fill room-one-111 up to MAX_ROOM_PARTICIPANTS
    for (let i = 2; i <= MAX_ROOM_PARTICIPANTS; i += 1) {
      const guest = fakeIo.connect(`guest-${i}`);
      const res = await guest.sendToServer<{ ok: boolean }>("join-room", {
        roomId: "room-one-111",
        name: `Guest ${i}`,
        audioEnabled: false,
        videoEnabled: false,
      });
      expect(res.ok).toBe(true);
    }

    const overflow = await fakeIo.connect("overflow").sendToServer<{ ok: boolean; error: string }>(
      "join-room",
      {
        roomId: "room-one-111",
        name: "Overflow",
        audioEnabled: false,
        videoEnabled: false,
      }
    );
    expect(overflow.ok).toBe(false);
    expect(overflow.error).toContain("full");
  });
});
