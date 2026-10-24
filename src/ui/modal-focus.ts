const identities = [
  "id",
  "data-nav",
  "data-card-info",
  "data-edit-slot",
  "data-filter",
  "data-collection",
];

function identity(element: HTMLElement | null) {
  if (!element) return null;
  for (const attribute of identities) {
    const value = element.getAttribute(attribute);
    if (value !== null) return `[${attribute}="${CSS.escape(value)}"]`;
  }
  return null;
}

function available(element: HTMLElement | null): element is HTMLElement {
  return (
    !!element?.isConnected &&
    !element.closest("[inert]") &&
    !element.matches(":disabled") &&
    element.getClientRects().length > 0
  );
}

/** Keep one opener across dialog views and preserve controls during redraws. */
export class ModalFocus {
  private key = "";
  private renderId = 0;
  private opener: HTMLElement | null = null;
  private openerIdentity: string | null = null;
  private previousInert: boolean[] = [];

  constructor(
    private root: HTMLElement,
    private background: HTMLElement[],
    private fallback: () => HTMLElement | null,
  ) {}

  render(key: string, draw: () => void) {
    const renderId = ++this.renderId;
    const active =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;
    const resume =
      this.key === key && active && this.root.contains(active)
        ? identity(active)
        : null;
    const selection =
      resume &&
      (active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement)
        ? {
            start: active.selectionStart,
            end: active.selectionEnd,
            direction: active.selectionDirection,
          }
        : null;
    if (!this.key) {
      this.opener = active;
      this.openerIdentity = identity(active);
      this.previousInert = this.background.map((element) => element.inert);
      for (const element of this.background) element.inert = true;
    }
    this.key = key;
    draw();
    const replacement = resume
      ? this.root.querySelector<HTMLElement>(resume)
      : null;
    const target = available(replacement)
      ? replacement
      : this.root.querySelector<HTMLElement>(".close-modal");
    const restore = (element: HTMLElement | null) => {
      element?.focus();
      if (
        selection?.start !== null &&
        selection?.start !== undefined &&
        (element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement)
      ) {
        element.setSelectionRange(
          selection.start,
          selection.end,
          selection.direction ?? undefined,
        );
      }
    };
    restore(target);
    if (resume && !available(replacement))
      // Collection cards are populated after the dialog shell is drawn.
      queueMicrotask(() => {
        if (
          this.key !== key ||
          this.renderId !== renderId ||
          document.activeElement !== target
        )
          return;
        const completed = this.root.querySelector<HTMLElement>(resume);
        if (available(completed)) restore(completed);
      });
  }

  close() {
    if (!this.key) return;
    this.key = "";
    this.root.replaceChildren();
    this.background.forEach(
      (element, index) => (element.inert = this.previousInert[index]),
    );
    const replacement = this.openerIdentity
      ? (this.background
          .map((element) =>
            element.querySelector<HTMLElement>(this.openerIdentity!),
          )
          .find(available) ?? null)
      : null;
    const target = available(this.opener)
      ? this.opener
      : (replacement ?? this.fallback());
    if (available(target)) target.focus({ preventScroll: true });
    this.opener = null;
    this.openerIdentity = null;
  }
}
