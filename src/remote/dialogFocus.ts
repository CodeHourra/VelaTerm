//! Focus containment and restoration shared by the project and filesystem dialogs.

import { useEffect, useRef, type KeyboardEvent } from "react";

export function useDialogFocus(active: boolean) {
  const ref = useRef<HTMLDivElement & HTMLFormElement>(null);
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const dialog = ref.current;
      if (!dialog || dialog.contains(document.activeElement)) return;
      (dialog.querySelector<HTMLElement>('input:not(:disabled), [role="listbox"][tabindex="0"], button:not(:disabled)') ?? dialog).focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active]);
  return ref;
}

export function trapDialogFocus(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab" || (e.target as Element).closest('[role="dialog"]') !== e.currentTarget) return;
  const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')]
    .filter(el => el.getClientRects().length > 0);
  const first = controls[0], last = controls[controls.length - 1];
  if (!first) { e.preventDefault(); e.currentTarget.focus(); }
  else if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
