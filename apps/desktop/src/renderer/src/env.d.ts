import type { GmApi } from '@gm/shared';

declare global {
  interface Window {
    gm: GmApi;
  }
}

export {};
