/**
 * A3 · browser push + audible for the halt-resume alert. The window is ~2
 * minutes and the operator may not be looking at the tab, so a TRADEABLE resume
 * asks the OS to raise a notification and plays a short tone. Permission is
 * requested ONCE (the first time an alert would fire); a denied or unsupported
 * environment degrades silently to the in-app feed, which always shows it.
 */
let asked = false;

export function requestNotifyOnce(): void {
  if (asked || typeof Notification === "undefined") return;
  asked = true;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => { /* denied — the feed still shows it */ });
  }
}

export function pushNotification(title: string, body: string): void {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, tag: "spread-halt" });
    }
  } catch { /* some browsers throw on construct outside a SW — ignore */ }
}

/** A short two-tone beep via WebAudio — no asset to load, no autoplay policy on a
 *  user-session tab that has already interacted. */
export function beep(): void {
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = 0.06;
    gain.connect(ctx.destination);
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(gain);
      o.start(ctx.currentTime + i * 0.14);
      o.stop(ctx.currentTime + i * 0.14 + 0.12);
    });
    setTimeout(() => ctx.close().catch(() => {}), 500);
  } catch { /* audio blocked — the visual alert stands */ }
}
