import { createRequire } from 'node:module';
import type * as Steamworks from 'steamworks.js';

/**
 * Optional Steam integration. The game must run fine without Steam (dev, CI, tests),
 * so every call is guarded. 480 is Valve's public "Spacewar" test app; swap in your
 * real App ID once you've paid the Steam Direct fee.
 */
const STEAM_APP_ID = Number(process.env.STEAM_APP_ID ?? 480);

let client: ReturnType<typeof Steamworks.init> | null = null;

export function initSteam(): void {
  if (process.env.GM_DISABLE_STEAM === '1') return;
  try {
    const require = createRequire(import.meta.url);
    const steamworks = require('steamworks.js') as typeof Steamworks;
    client = steamworks.init(STEAM_APP_ID);
    steamworks.electronEnableSteamOverlay();
  } catch (err) {
    client = null;
    console.info('[steam] not available, running without Steam:', (err as Error).message);
  }
}

/** The Steam client, or null when the game runs without Steam: what a league hosted on Steam goes through. */
export const steamClient = () => client;

export function steamStatus() {
  return { enabled: client !== null, playerName: client?.localplayer.getName() ?? null };
}
