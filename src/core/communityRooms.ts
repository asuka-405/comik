import type { ComikFirebaseOptions } from "./sync/firebase";
import { appLink } from "./platform";

const STORAGE_KEY = "comik.community.rooms.v1";

export interface CommunityRoom {
  id: string;
  name: string;
  config: ComikFirebaseOptions;
  createdAt: number;
  visibility: "invite";
  joined?: boolean;
}

export interface CommunityInvite {
  version: 1;
  room: CommunityRoom;
}

export function readCommunityRooms(): CommunityRoom[] {
  try {
    const rooms = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as CommunityRoom[];
    return Array.isArray(rooms) ? rooms.filter((room) => room.id && room.name && room.config?.projectId) : [];
  } catch {
    return [];
  }
}

export function saveCommunityRoom(room: CommunityRoom): CommunityRoom[] {
  const rooms = readCommunityRooms().filter((existing) => existing.id !== room.id);
  rooms.unshift(room);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
  return rooms;
}

export function removeCommunityRoom(id: string): CommunityRoom[] {
  const rooms = readCommunityRooms().filter((room) => room.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
  return rooms;
}

export function newCommunityRoom(name: string, config: ComikFirebaseOptions): CommunityRoom {
  return {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 80),
    config,
    createdAt: Date.now(),
    visibility: "invite",
  };
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function createCommunityInvite(room: CommunityRoom, origin = location.origin): string {
  const invite: CommunityInvite = { version: 1, room };
  const query = `?join=${encodeURIComponent(encodeBase64Url(JSON.stringify(invite)))}`;
  return appLink(`/community${query}`, origin);
}

export function parseCommunityInvite(encoded: string): CommunityRoom {
  const invite = JSON.parse(decodeBase64Url(encoded)) as CommunityInvite;
  if (invite.version !== 1 || !invite.room?.id || !invite.room.name || !invite.room.config?.projectId || invite.room.visibility !== "invite") {
    throw new Error("This community invite is invalid or expired.");
  }
  return invite.room;
}
