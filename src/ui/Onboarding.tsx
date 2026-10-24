import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpenText, BookmarkSimple, ChatCircleText, Compass, CloudArrowUp, DownloadSimple, ShieldCheck, Sparkle, type Icon } from "@phosphor-icons/react";
import { useSettings } from "@/core/settings";
import { useWalkthrough } from "@/core/onboarding";
import { isNativeShell } from "@/core/platform";
import { refreshAnalyticsConsent } from "@/core/analytics";
import { Toggle } from "./common";

interface Step {
  icon: Icon;
  hue: number;
  title: string;
  body: ReactNode;
  /** aria-label of the navigation item to spotlight. */
  target?: string;
}

const STEPS: Step[] = [
  {
    icon: Sparkle, hue: 0, title: "Welcome to Comik",
    body: "One shelf for the comics, manga and webtoons you read. Your library lives on this device first, and nothing leaves it unless you turn sync on. This quick tour takes under a minute.",
  },
  {
    icon: Compass, hue: 5, title: "Discover", target: "Discover",
    body: "About 100 sources in one place. Search all of them at once or open one to browse. Open a series and add it to your shelf.",
  },
  {
    icon: BookmarkSimple, hue: 2, title: "Your shelf", target: "Shelf",
    body: "Everything you follow, with unread counts and a resume button that takes you straight back to your page. Sort, filter and group it your way.",
  },
  {
    icon: BookOpenText, hue: 4, title: "A reader that adapts",
    body: "Right to left, left to right, vertical pages or continuous webtoon scroll. Comik picks a sensible mode per series, and you can change fit, spreads and image colors while you read.",
  },
  {
    icon: DownloadSimple, hue: 6, title: "Offline and up to date", target: "Timeline",
    body: "Download chapters to read without a connection. Comik checks your shelf for new chapters and lists them on the Timeline. Export a backup file whenever you like.",
  },
  {
    icon: CloudArrowUp, hue: 3, title: "Sign in and sync", target: "Account",
    body: isNativeShell
      ? "Sign in as a guest or with Google to keep your shelf across devices. Comik's Firebase works with no setup, or bring your own and everything is stored in your project, with nothing kept by Comik."
      : "Sign in as a guest or with Google to keep your shelf across devices. Comik's Firebase works with no setup. Reading comics in the browser needs your own Firebase, so the shared site never makes requests that get banned. The Android, Linux and Windows apps read directly from your device.",
  },
  {
    icon: ChatCircleText, hue: 1, title: "Community", target: "Community",
    body: "Share what you are reading, rate comics and vote in polls. Start a private, invite-only room for friends, on Comik's Firebase or on yours.",
  },
];

const LAST = STEPS.length; // the choices step comes after the tour

/** Rectangle of the navigation item to spotlight, or null when there is none to show. */
function useTargetRect(label: string | undefined, active: boolean) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!label || !active) return setRect(null);
    const measure = () => {
      const element = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
      setRect(element && element.offsetParent !== null ? element.getBoundingClientRect() : null);
    };
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, [label, active]);
  return rect;
}

export function Onboarding() {
  const open = useWalkthrough((state) => state.open);
  if (!open) return null;
  return <Walkthrough />;
}

function Walkthrough() {
  const finish = useWalkthrough((state) => state.finish);
  const settings = useSettings();
  const [index, setIndex] = useState(0);
  // Both are on by default, and nothing is applied until the person presses the final button.
  const [safeMode, setSafeMode] = useState(true);
  const [analytics, setAnalytics] = useState(true);
  const primary = useRef<HTMLButtonElement>(null);
  const choosing = index === LAST;
  const step = STEPS[index];
  const rect = useTargetRect(step?.target, !choosing);

  useEffect(() => primary.current?.focus(), [index]);

  const done = () => {
    settings.set({ safeMode, analyticsConsent: analytics });
    void refreshAnalyticsConsent(analytics);
    finish();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" && index < LAST) setIndex(index + 1);
      if (event.key === "ArrowLeft" && index > 0) setIndex(index - 1);
      // Escape skips the tour but never the two choices, which need an answer.
      if (event.key === "Escape" && index < LAST) setIndex(LAST);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [index]);

  const Icon = choosing ? ShieldCheck : step!.icon;
  const hue = choosing ? 1 : step!.hue;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        <div className="tour-ring" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card" data-hue={hue}>
        <div className="tour-top">
          <span className="tour-icon"><Icon size={26} weight="duotone" /></span>
          <span className="tour-count">{index + 1} / {LAST + 1}</span>
        </div>
        {choosing ? (
          <>
            <h2 id="tour-title">Two quick choices</h2>
            <p className="muted">Both are on to start with. Change them any time in Settings, Privacy and community.</p>
            <div className="tour-choice">
              <div><strong>Safe mode</strong><span>Hides sources marked 18+ from Discover, search, your shelf and Community.</span></div>
              <Toggle label="Safe mode" on={safeMode} onChange={setSafeMode} />
            </div>
            <div className="tour-choice">
              <div><strong>Anonymous usage analytics</strong><span>Counts which screens and features get used, to guide what to improve. Never comic titles, searches or post text.</span></div>
              <Toggle label="Anonymous usage analytics" on={analytics} onChange={setAnalytics} />
            </div>
          </>
        ) : (
          <>
            <h2 id="tour-title">{step!.title}</h2>
            <p>{step!.body}</p>
            {index === 5 && !isNativeShell && <p className="tour-aside"><Link to="/setup" onClick={() => setIndex(LAST)}>How the web setup works</Link></p>}
          </>
        )}
        <div className="tour-dots" aria-hidden="true">{Array.from({ length: LAST + 1 }, (_, i) => <i key={i} className={i === index ? "on" : i < index ? "past" : ""} />)}</div>
        <div className="tour-actions">
          {index > 0 ? <button className="btn" onClick={() => setIndex(index - 1)}><ArrowLeft size={16} /> Back</button> : <span />}
          {!choosing && <button className="btn ghost" onClick={() => setIndex(LAST)}>Skip tour</button>}
          <button ref={primary} className="btn primary" onClick={() => (choosing ? done() : setIndex(index + 1))}>
            {choosing ? "Start reading" : <>Next <ArrowRight size={16} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
