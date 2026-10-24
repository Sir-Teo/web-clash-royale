/** Releases wait for a deliberate lobby update; active games keep their assets. */
export class OfflineUpdates {
  private worker: ServiceWorker | null = null;
  private applying = false;
  private timeout: number | undefined;
  private button: HTMLButtonElement;
  private message: HTMLElement;
  private dismissed = false;
  private dismissButton: HTMLButtonElement;

  constructor(
    private host: HTMLElement,
    private canUpdate: () => boolean,
    private setBusy: (busy: boolean) => void = () => {},
  ) {
    host.hidden = true;
    host.innerHTML = `<span>An arena update is ready.</span><button type="button">Update game</button><button type="button" class="dismiss-update" aria-label="Dismiss update">×</button>`;
    this.button = host.querySelector("button")!;
    this.message = host.querySelector("span")!;
    this.button.onclick = () => this.apply();
    this.dismissButton = host.querySelector(".dismiss-update")!;
    this.dismissButton.onclick = () => {
      this.dismissed = true;
      this.update();
    };
  }

  async register() {
    try {
      if (!("serviceWorker" in navigator)) return;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (this.applying) location.reload();
      });
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "UPDATE_BLOCKED" && this.applying)
          this.retry("Close other arena tabs, then update.");
      });
      const registration = await navigator.serviceWorker.register(
        `${import.meta.env.BASE_URL}sw.js`,
      );
      const offer = (worker: ServiceWorker | null) => {
        if (
          !worker ||
          !navigator.serviceWorker.controller ||
          this.worker === worker
        )
          return;
        this.worker = worker;
        this.dismissed = false;
        this.message.textContent = "An arena update is ready.";
        this.update();
      };
      const watch = () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed")
            offer(registration.waiting ?? worker);
        });
      };
      offer(registration.waiting);
      watch();
      registration.addEventListener("updatefound", watch);
    } catch {
      // Offline installation and updates can retry on the next visit.
    }
  }

  update() {
    const hidden =
      !this.applying && (this.dismissed || !this.worker || !this.canUpdate());
    if (this.host.hidden !== hidden) this.host.hidden = hidden;
  }

  private retry(message: string) {
    window.clearTimeout(this.timeout);
    this.applying = false;
    this.setBusy(false);
    this.host.classList.remove("applying");
    this.button.disabled = false;
    this.dismissButton.hidden = false;
    this.message.textContent = message;
  }

  private apply() {
    if (!this.worker || this.applying || this.dismissed || !this.canUpdate())
      return;
    this.applying = true;
    this.setBusy(true);
    this.host.classList.add("applying");
    this.host.tabIndex = -1;
    this.host.focus();
    this.button.disabled = true;
    this.dismissButton.hidden = true;
    this.message.textContent = "Updating the arena…";
    this.timeout = window.setTimeout(() => location.reload(), 10000);
    try {
      this.worker.postMessage({ type: "ACTIVATE_UPDATE" });
    } catch {
      this.retry("The update couldn’t start. Reload to check again.");
    }
  }
}
