const CODE_ALPHABET = "abcdefghijkmnopqrstuvwxyz";

const AVATAR_PALETTE = [
  "#1a73e8",
  "#d93025",
  "#1e8e3e",
  "#f9ab00",
  "#9334e6",
  "#e52592",
  "#00897b",
  "#e8710a",
] as const;

export const ROOM_CODE_REGEX = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

function randomSegment(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    const idx = Math.floor(Math.random() * CODE_ALPHABET.length);
    out += CODE_ALPHABET[idx];
  }
  return out;
}

/** Generate a Google Meet-style `xxx-yyyy-zzz` meeting code. */
export function generateMeetingCode(): string {
  return `${randomSegment(3)}-${randomSegment(4)}-${randomSegment(3)}`;
}

/**
 * Parse a meeting code or full meeting URL into a validated lowercase room code.
 * Returns null if the input is empty or contains invalid characters.
 */
export function parseMeetingInput(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  let candidate = trimmed;

  // Handle pasted full URLs or /meet/<code> paths
  if (candidate.includes("://") || candidate.startsWith("/")) {
    try {
      const url = candidate.startsWith("/")
        ? new URL(candidate, "http://localhost")
        : new URL(candidate);
      const segments = url.pathname.split("/").filter(Boolean);
      const meetIndex = segments.lastIndexOf("meet");
      if (meetIndex !== -1 && segments[meetIndex + 1]) {
        candidate = segments[meetIndex + 1];
      } else if (segments.length > 0) {
        candidate = segments[segments.length - 1];
      } else {
        return null;
      }
    } catch {
      return null;
    }
  } else if (candidate.includes("/")) {
    const segments = candidate.split("/").filter(Boolean);
    const meetIndex = segments.lastIndexOf("meet");
    candidate =
      meetIndex !== -1 && segments[meetIndex + 1]
        ? segments[meetIndex + 1]
        : segments[segments.length - 1] ?? "";
  }

  const normalized = candidate.trim().toLowerCase();
  if (!ROOM_CODE_REGEX.test(normalized)) {
    return null;
  }

  return normalized;
}

/** Derive 1-2 uppercase initials from a participant display name. */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** Deterministic avatar background color for a given participant name or ID. */
export function getAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}
