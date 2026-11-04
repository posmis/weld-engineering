import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow, type CloseRequestedEvent } from '@tauri-apps/api/window';

export const desktopWindow = {
  listenClose: async (handler: (event: Pick<CloseRequestedEvent, 'preventDefault'>) => void) => {
    if (!isTauri()) return () => {};
    return getCurrentWindow().onCloseRequested(handler);
  },
  close: async () => {
    if (isTauri()) {
      try { await getCurrentWindow().close(); } catch { throw { code: 'window_error' }; }
    }
  },
};
