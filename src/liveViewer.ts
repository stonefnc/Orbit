import type { EarthCamCamera } from "./earthcam/earthcamTypes";

/**
 * A floating, draggable, resizable window that plays a camera inside the page: real live video where the agency
 * publishes it (HLS or MP4), otherwise a still image that refreshes on its own. Everything shown from the feed is
 * set with textContent, never innerHTML.
 */
export type LiveViewerHooks = { onShowOnGlobe?: (cam: EarthCamCamera) => void };

type Mode = "video" | "still";

type HlsInstance = {
  loadSource(url: string): void;
  attachMedia(el: HTMLVideoElement): void;
  destroy(): void;
  on(event: string, cb: (event: string, data: { fatal?: boolean }) => void): void;
};

let root: HTMLDivElement | null = null;
let hooks: LiveViewerHooks = {};
let current: EarthCamCamera | null = null;
let mode: Mode = "still";
let hls: HlsInstance | null = null;
let stillTimer: number | null = null;
let openToken = 0;

const q = <T extends HTMLElement>(sel: string): T => root!.querySelector(sel) as T;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function build(): HTMLDivElement {
  const w = el("div", "live-win hidden");
  w.setAttribute("role", "dialog");
  w.setAttribute("aria-label", "Live camera");

  const head = el("div", "live-win-head");
  const titles = el("div", "live-win-titles");
  titles.append(el("strong", "live-win-title"), el("span", "live-win-sub"));
  const actions = el("div", "live-win-actions");
  const globeBtn = el("button", "live-win-btn", "Show on globe");
  globeBtn.type = "button";
  globeBtn.dataset.act = "globe";
  const closeBtn = el("button", "live-win-btn live-win-close", "×");
  closeBtn.type = "button";
  closeBtn.dataset.act = "close";
  closeBtn.setAttribute("aria-label", "Close live window");
  actions.append(globeBtn, closeBtn);
  head.append(titles, actions);

  const body = el("div", "live-win-body");
  const video = el("video", "live-win-video hidden");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  const still = el("img", "live-win-still");
  still.alt = "";
  const badge = el("div", "live-win-badge");
  const msg = el("div", "live-win-msg hidden");
  body.append(video, still, badge, msg);

  const foot = el("div", "live-win-foot");
  const modes = el("div", "live-win-modes");
  for (const m of ["video", "still"] as const) {
    const b = el("button", "live-win-btn", m === "video" ? "Live video" : "Still image");
    b.type = "button";
    b.dataset.mode = m;
    modes.append(b);
  }
  const time = el("span", "live-win-time");
  const page = el("a", "live-win-link", "Agency page");
  page.target = "_blank";
  page.rel = "noopener noreferrer";
  foot.append(modes, time, page);

  const credit = el("div", "live-win-credit");
  w.append(head, body, foot, credit);

  w.addEventListener("click", (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>("button");
    if (!t) return;
    if (t.dataset.act === "close") closeLiveViewer();
    else if (t.dataset.act === "globe" && current) hooks.onShowOnGlobe?.(current);
    else if (t.dataset.mode && current) void setMode(t.dataset.mode as Mode);
  });

  // Drag by the title bar (pointer events cover mouse, touch and pen).
  let drag: { dx: number; dy: number } | null = null;
  head.addEventListener("pointerdown", (ev) => {
    if ((ev.target as HTMLElement).closest("button")) return;
    const r = w.getBoundingClientRect();
    drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
    head.setPointerCapture(ev.pointerId);
    w.style.left = `${r.left}px`;
    w.style.top = `${r.top}px`;
    w.style.right = "auto";
    w.style.bottom = "auto";
  });
  head.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const x = Math.min(window.innerWidth - 80, Math.max(-w.offsetWidth + 80, ev.clientX - drag.dx));
    const y = Math.min(window.innerHeight - 40, Math.max(0, ev.clientY - drag.dy));
    w.style.left = `${x}px`;
    w.style.top = `${y}px`;
  });
  const endDrag = (): void => {
    drag = null;
  };
  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", endDrag);

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && root && !root.classList.contains("hidden")) closeLiveViewer();
  });

  document.body.appendChild(w);
  return w;
}

function setBadge(text: string, live: boolean): void {
  const b = q<HTMLDivElement>(".live-win-badge");
  b.textContent = text;
  b.classList.toggle("is-live", live);
}

function setMessage(text: string | null): void {
  const m = q<HTMLDivElement>(".live-win-msg");
  m.textContent = text ?? "";
  m.classList.toggle("hidden", !text);
}

function stampTime(): void {
  q<HTMLSpanElement>(".live-win-time").textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

function stopVideo(): void {
  hls?.destroy();
  hls = null;
  const v = q<HTMLVideoElement>(".live-win-video");
  v.pause();
  v.removeAttribute("src");
  v.load();
}

function stopStill(): void {
  if (stillTimer != null) {
    window.clearInterval(stillTimer);
    stillTimer = null;
  }
}

function startStill(cam: EarthCamCamera): void {
  stopStill();
  const img = q<HTMLImageElement>(".live-win-still");
  const url = cam.frameUrl ?? cam.thumbnail;
  if (!url) {
    setMessage("No image is available for this camera.");
    return;
  }
  const every = Math.min(60, Math.max(10, cam.frameRefreshSec ?? 30));
  const load = (): void => {
    const probe = new Image();
    probe.onload = () => {
      if (current?.id !== cam.id || mode !== "still") return;
      img.src = probe.src;
      setMessage(null);
      stampTime();
    };
    probe.onerror = () => {
      if (current?.id === cam.id && !img.src) setMessage("This camera's image is unavailable right now.");
    };
    probe.src = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
  };
  load();
  stillTimer = window.setInterval(() => {
    if (!document.hidden) load();
  }, every * 1000);
  setBadge(`STILL IMAGE · refreshes about every ${every} s`, false);
}

async function startVideo(cam: EarthCamCamera, token: number): Promise<void> {
  const v = q<HTMLVideoElement>(".live-win-video");
  const url = cam.videoUrl;
  if (!url || !cam.videoKind) return fallbackToStill(cam, "This camera has no live video.");
  setMessage("Connecting to live video…");
  setBadge("LIVE VIDEO", true);
  try {
    if (cam.videoKind === "mp4") {
      v.loop = true;
      v.src = url;
    } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = url; // Safari plays HLS natively
    } else {
      const { default: Hls } = await import("hls.js");
      if (token !== openToken) return;
      if (!Hls.isSupported()) return fallbackToStill(cam, "This browser can't play live video — showing a still image.");
      const instance = new Hls({ maxBufferLength: 12, liveSyncDurationCount: 3 }) as unknown as HlsInstance;
      hls = instance;
      instance.on("hlsError", (_e, data) => {
        if (data?.fatal && token === openToken) fallbackToStill(cam, "Live video unavailable — showing a still image.");
      });
      instance.loadSource(url);
      instance.attachMedia(v);
    }
    let started = false;
    v.onplaying = () => {
      if (token === openToken) {
        started = true;
        setMessage(null);
        stampTime();
      }
    };
    // Some agency streams accept the connection but never deliver video; don't leave the user on "Connecting…".
    window.setTimeout(() => {
      if (token === openToken && !started) {
        fallbackToStill(cam, "This stream isn't responding (the camera may be offline) — showing a still image.");
      }
    }, 15_000);
    v.onerror = () => {
      if (token === openToken) fallbackToStill(cam, "Live video unavailable — showing a still image.");
    };
    await v.play().catch(() => {
      /* autoplay can be blocked until the user interacts; the controls below still work */
    });
  } catch {
    if (token === openToken) fallbackToStill(cam, "Live video unavailable — showing a still image.");
  }
}

function fallbackToStill(cam: EarthCamCamera, why: string): void {
  stopVideo();
  mode = "still";
  applyModeUi(cam);
  startStill(cam);
  setMessage(why);
  window.setTimeout(() => current?.id === cam.id && mode === "still" && setMessage(null), 5000);
}

function applyModeUi(cam: EarthCamCamera): void {
  q<HTMLVideoElement>(".live-win-video").classList.toggle("hidden", mode !== "video");
  q<HTMLImageElement>(".live-win-still").classList.toggle("hidden", mode === "video");
  for (const b of root!.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    b.classList.toggle("active", b.dataset.mode === mode);
    b.disabled = b.dataset.mode === "video" && !cam.videoUrl;
    b.title = b.disabled ? "This camera only publishes still images" : "";
  }
}

async function setMode(next: Mode): Promise<void> {
  const cam = current;
  if (!cam || next === mode) return;
  openToken++;
  stopVideo();
  stopStill();
  mode = next;
  applyModeUi(cam);
  setMessage(null);
  if (next === "video") await startVideo(cam, openToken);
  else startStill(cam);
}

export function closeLiveViewer(): void {
  if (!root) return;
  openToken++;
  stopVideo();
  stopStill();
  current = null;
  root.classList.add("hidden");
}

export function isLiveViewerOpen(): boolean {
  return !!root && !root.classList.contains("hidden");
}

/** Opens (or switches) the window to this camera. Video is the default whenever the camera has it. */
export function openLiveViewer(cam: EarthCamCamera, h?: LiveViewerHooks): void {
  root ??= build();
  if (h) hooks = h;
  openToken++;
  stopVideo();
  stopStill();
  current = cam;
  mode = cam.videoUrl ? "video" : "still";

  q<HTMLElement>(".live-win-title").textContent = cam.name;
  q<HTMLElement>(".live-win-sub").textContent = [cam.cameraSource, cam.region ?? cam.country].filter(Boolean).join(" · ");
  q<HTMLElement>(".live-win-credit").textContent = cam.attribution ?? "";
  const page = q<HTMLAnchorElement>(".live-win-link");
  const href = cam.agencyPageUrl ?? cam.earthcamPageUrl;
  page.classList.toggle("hidden", !href);
  if (href) page.href = href;
  q<HTMLImageElement>(".live-win-still").removeAttribute("src");
  q<HTMLSpanElement>(".live-win-time").textContent = "";

  root.classList.remove("hidden");
  applyModeUi(cam);
  setMessage(null);
  if (mode === "video") void startVideo(cam, openToken);
  else startStill(cam);
}
