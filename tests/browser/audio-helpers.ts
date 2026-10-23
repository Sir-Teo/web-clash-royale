import type { Page } from "@playwright/test";

export async function observeCombatAudio(page: Page) {
  await page.addInitScript(() => {
    const log: {
      path: string;
      rate: number;
      volume: number;
      time: number;
      outcome?: string;
      element: HTMLMediaElement;
    }[] = [];
    Object.defineProperty(window, "__combatAudioLog", { value: log });
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const entry: (typeof log)[number] = {
        path: new URL(this.src).pathname,
        rate: this.playbackRate,
        volume: this.volume,
        time: (window as any).__arena?.state.time ?? 0,
        element: this,
      };
      log.push(entry);
      const playing = original.call(this);
      void playing.then(
        () => {
          entry.outcome = "playing";
        },
        (error) => {
          entry.outcome = String(error);
        },
      );
      return playing;
    };
  });
}
export const playedCombatAudio = (page: Page, files: string[]) =>
  page.evaluate(
    (paths) =>
      (window as any).__combatAudioLog
        .filter((entry: any) => paths.includes(entry.path))
        .map((entry: any) => ({
          path: entry.path,
          rate: entry.rate,
          volume: entry.volume,
          time: entry.time,
          outcome: entry.outcome,
          paused: entry.element.paused,
        })),
    files,
  );

export async function decodeAudioFiles(page: Page, files: string[]) {
  return page.evaluate(async (paths) => {
    const decoded: { path: string; duration: number }[] = [];
    for (let offset = 0; offset < paths.length; offset += 6) {
      decoded.push(
        ...(await Promise.all(
          paths.slice(offset, offset + 6).map(
            (path) =>
              new Promise<{ path: string; duration: number }>(
                (resolve, reject) => {
                  const audio = new Audio(path);
                  const timer = setTimeout(
                    () => finish(new Error(`${path}: decode timeout`)),
                    15000,
                  );
                  function finish(error?: Error) {
                    clearTimeout(timer);
                    audio.oncanplay = audio.onerror = null;
                    const duration = audio.duration;
                    audio.pause();
                    audio.removeAttribute("src");
                    audio.load();
                    if (error) reject(error);
                    else resolve({ path, duration });
                  }
                  audio.oncanplay = () => finish();
                  audio.onerror = () =>
                    finish(
                      new Error(
                        `${path}: ${audio.error?.message ?? "decode failed"}`,
                      ),
                    );
                  audio.preload = "auto";
                  audio.load();
                },
              ),
          ),
        )),
      );
    }
    return decoded;
  }, files);
}
