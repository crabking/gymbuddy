import type { ClientAnalyticsEventName } from "@/lib/analytics";

type ClientProperties = {
  locale?: "en" | "sv";
  interval?: "monthly" | "annual";
  referrer_host?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
};

function boundedCampaign(value: string | null) {
  const trimmed = value?.trim();
  return trimmed && /^[a-zA-Z0-9._~ -]{1,80}$/.test(trimmed) ? trimmed : undefined;
}

export function pageViewProperties(): ClientProperties {
  const search = new URLSearchParams(window.location.search);
  let referrerHost: string | undefined;
  try {
    referrerHost = document.referrer
      ? new URL(document.referrer).hostname.slice(0, 253)
      : undefined;
  } catch {
    referrerHost = undefined;
  }
  return {
    locale: search.get("lang") === "sv" ? "sv" : "en",
    referrer_host: referrerHost,
    utm_source: boundedCampaign(search.get("utm_source")),
    utm_medium: boundedCampaign(search.get("utm_medium")),
    utm_campaign: boundedCampaign(search.get("utm_campaign")),
  };
}

export async function trackClientAnalytics(
  eventName: ClientAnalyticsEventName,
  properties: ClientProperties = {},
) {
  if (typeof window === "undefined") return;
  try {
    await fetch("/api/analytics", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: crypto.randomUUID(),
        event_name: eventName,
        route: window.location.pathname,
        properties,
      }),
    });
  } catch {
    // Product behavior never depends on analytics delivery.
  }
}
