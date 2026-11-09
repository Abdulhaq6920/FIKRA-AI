/**
 * Companion event bus.
 *
 * Pages and shared widgets announce what the user is doing ("reading",
 * "writing", "success"…) with a plain DOM event. The themed anime companion in
 * the app shell listens and performs a matching reaction, so the character
 * stays relevant to clicks anywhere in the product without prop drilling.
 */

export type CompanionAction = "idle" | "read" | "write" | "think" | "success" | "alert";

export const COMPANION_EVENT = "fikra:companion";

export function signalCompanion(action: CompanionAction, duration = 1500): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<{ action: CompanionAction; duration: number }>(COMPANION_EVENT, {
      detail: { action, duration },
    })
  );
}
