import { useEffect, useRef, type ReactNode } from "react";
import { tabTrapTarget } from "./focusTrap";

/**
 * One accessible modal-dialog seam for the HUD overlays (PRD 25.15). While
 * mounted it behaves as a semantic dialog: `role="dialog"` + `aria-modal` with
 * an accessible name, initial focus into the panel, Escape-to-close, Tab focus
 * containment, background inertness, and focus restoration to whatever was
 * focused before it opened. Overlays stay mount-controlled (render `<Dialog>`
 * only while open) — the primitive owns behaviour, not open/close state.
 *
 * ## Background inertness & the urgent-HUD exception (documented rule)
 * On open the dialog makes the rest of the app inert (`inert` + `aria-hidden`)
 * so the world canvas and non-urgent HUD leave the tab order and the a11y tree.
 * Elements carrying `data-dialog-keep-live` are deliberately **exempt**: the
 * media control bar and the room knock/approval HUD stay reachable and are woven
 * into the focus-containment ring, so an admin can still approve a knock or a
 * user can still toggle mic/cam while an overlay is open. Nothing else escapes.
 *
 * Nested dialogs are handled via a shared open-stack: only the topmost dialog
 * responds to Escape/Tab, so closing peels one layer at a time.
 */

const KEEP_LIVE_SELECTOR = "[data-dialog-keep-live]";
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Open-dialog stack; only the top entry handles keyboard. */
const dialogStack: symbol[] = [];

export interface DialogProps {
  /** Requested close (Escape, backdrop click, or a close control). */
  onClose: () => void;
  /** Accessible name when there is no visible titled element to point at. */
  label?: string;
  /** id of the element that titles the dialog (takes precedence over `label`). */
  labelledBy?: string;
  /** id of a description element. */
  describedBy?: string;
  /** Class for the centered panel element (the dialog box). */
  className?: string;
  /** Class for the full-viewport backdrop. */
  backdropClassName?: string;
  /** Close when the backdrop (outside the panel) is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /** Element to focus on open; falls back to the first focusable / the panel. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}

function isHtmlElement(node: unknown): node is HTMLElement {
  return node instanceof HTMLElement;
}

export default function Dialog({
  onClose,
  label,
  labelledBy,
  describedBy,
  className,
  backdropClassName,
  closeOnBackdrop = true,
  initialFocusRef,
  children,
}: DialogProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-installing the key listener each render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Ordered focus-containment set: the panel's own controls followed by any
  // always-live regions the dialog leaves reachable (urgent HUD exception).
  const collectFocusables = (): HTMLElement[] => {
    const panel = panelRef.current;
    if (!panel) return [];
    const set: HTMLElement[] = [];
    panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR).forEach((el) => set.push(el));
    document.querySelectorAll<HTMLElement>(KEEP_LIVE_SELECTOR).forEach((region) => {
      if (panel.contains(region)) return;
      region.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR).forEach((el) => set.push(el));
      if (region.matches(FOCUSABLE_SELECTOR)) set.push(region);
    });
    return set;
  };

  // Focus management + background inertness live in one mount/unmount effect so
  // they are always torn down together.
  useEffect(() => {
    const previouslyFocused = isHtmlElement(document.activeElement)
      ? document.activeElement
      : null;

    // Make everything except this dialog's backdrop and the keep-live regions
    // inert. Walk up from the backdrop hiding each ancestor's other children.
    const restorers: Array<() => void> = [];
    const backdrop = backdropRef.current;
    let node: HTMLElement | null = backdrop;
    while (node && node.parentElement) {
      const parent = node.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (!isHtmlElement(sibling) || sibling === node) continue;
        if (sibling.matches(KEEP_LIVE_SELECTOR) || sibling.querySelector(KEEP_LIVE_SELECTOR)) {
          continue;
        }
        const prevAriaHidden = sibling.getAttribute("aria-hidden");
        const prevInert = sibling.hasAttribute("inert");
        sibling.setAttribute("aria-hidden", "true");
        sibling.setAttribute("inert", "");
        restorers.push(() => {
          if (prevAriaHidden === null) sibling.removeAttribute("aria-hidden");
          else sibling.setAttribute("aria-hidden", prevAriaHidden);
          if (!prevInert) sibling.removeAttribute("inert");
        });
      }
      node = parent;
      if (parent === document.body) break;
    }

    // Initial focus: caller's target, else the first focusable, else the panel.
    const initial =
      initialFocusRef?.current ??
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      panelRef.current;
    initial?.focus();

    return () => {
      for (const restore of restorers) restore();
      // Restore focus to the opener if it is still around and focusable.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [initialFocusRef]);

  // Keyboard: Escape closes, Tab is contained. Only the topmost dialog reacts.
  useEffect(() => {
    const id = Symbol("dialog");
    dialogStack.push(id);
    const onKeyDown = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== id) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab") {
        const set = collectFocusables();
        if (set.length === 0) {
          e.preventDefault();
          panelRef.current?.focus();
          return;
        }
        const current = isHtmlElement(document.activeElement)
          ? set.indexOf(document.activeElement)
          : -1;
        const target = tabTrapTarget(set.length, current, e.shiftKey);
        if (target !== null) {
          e.preventDefault();
          set[target]?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      const at = dialogStack.lastIndexOf(id);
      if (at !== -1) dialogStack.splice(at, 1);
    };
  }, []);

  return (
    <div
      ref={backdropRef}
      className={backdropClassName}
      onClick={closeOnBackdrop ? () => onClose() : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={className}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
