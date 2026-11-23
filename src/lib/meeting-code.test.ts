import { describe, expect, it } from "vitest";
import {
  generateMeetingCode,
  getAvatarColor,
  getInitials,
  parseMeetingInput,
} from "./meeting-code";

describe("meeting-code utilities", () => {
  it("generates Google Meet style xxx-yyyy-zzz codes", () => {
    const code = generateMeetingCode();
    expect(code).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
  });

  it("parses raw codes, relative paths, and full URLs", () => {
    expect(parseMeetingInput("abc-defg-hij")).toBe("abc-defg-hij");
    expect(parseMeetingInput("  ABC-DEFG-HIJ  ")).toBe("abc-defg-hij");
    expect(parseMeetingInput("/meet/xyz-abcd-efg")).toBe("xyz-abcd-efg");
    expect(parseMeetingInput("http://localhost:3000/meet/xyz-abcd-efg?pli=1")).toBe("xyz-abcd-efg");
    expect(parseMeetingInput("https://meet.example.com/meet/team-sync-1")).toBe("team-sync-1");
  });

  it("rejects empty or invalid meeting codes", () => {
    expect(parseMeetingInput("")).toBeNull();
    expect(parseMeetingInput("   ")).toBeNull();
    expect(parseMeetingInput("a")).toBeNull();
    expect(parseMeetingInput("bad code with spaces")).toBeNull();
    expect(parseMeetingInput("http://localhost:3000/")).toBeNull();
  });

  it("extracts initials cleanly", () => {
    expect(getInitials("Ada Lovelace")).toBe("AL");
    expect(getInitials("Ada")).toBe("AD");
    expect(getInitials("  Grace   Brewster  Hopper ")).toBe("GH");
    expect(getInitials("   ")).toBe("?");
  });

  it("returns deterministic avatar colors", () => {
    expect(getAvatarColor("Ada")).toBe(getAvatarColor("Ada"));
    expect(getAvatarColor("Ada")).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
