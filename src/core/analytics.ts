import { useSettings } from "./settings";
import { getFirebaseMode, loadFirebase, readFirebaseConfig } from "./sync/firebase";

type EventValue = string | number | boolean | undefined;
let analyticsPromise: Promise<import("firebase/analytics").Analytics | null> | null = null;
let analyticsKey = "";

async function analyticsClient(): Promise<import("firebase/analytics").Analytics | null> {
  const config = readFirebaseConfig();
  if (!config?.measurementId) return null;
  const key = `${getFirebaseMode()}:${config.projectId}:${config.appId}:${config.measurementId}`;
  if (analyticsKey !== key) {
    analyticsKey = key;
    analyticsPromise = null;
  }
  if (!analyticsPromise) {
    analyticsPromise = (async () => {
      await loadFirebase();
      const [{ getApps }, analytics] = await Promise.all([import("firebase/app"), import("firebase/analytics")]);
      if (!(await analytics.isSupported())) return null;
      const app = getApps().find((item) => item.name === `comik-${config.projectId}`);
      return app ? analytics.getAnalytics(app) : null;
    })().catch(() => null);
  }
  return analyticsPromise;
}

export async function refreshAnalyticsConsent(enabled: boolean): Promise<void> {
  const analytics = await analyticsClient();
  if (!analytics) return;
  const module = await import("firebase/analytics");
  module.setAnalyticsCollectionEnabled(analytics, enabled);
}

export async function trackAnalytics(name: string, values: Record<string, EventValue> = {}): Promise<void> {
  if (!useSettings.getState().analyticsConsent) return;
  const analytics = await analyticsClient();
  if (!analytics) return;
  const module = await import("firebase/analytics");
  module.logEvent(analytics, name, values);
}