import { useEffect, useRef } from "react";
import { useLocation } from "@tanstack/react-router";
import { pageViewProperties, trackClientAnalytics } from "@/lib/analytics-client";

export function AnalyticsBeacon() {
  const location = useLocation();
  const lastNavigation = useRef("");

  useEffect(() => {
    // Internal administration remains a read-only observer and must not
    // distort acquisition/product metrics by merely viewing the dashboard.
    if (location.pathname.startsWith("/admin")) return;
    const navigation = `${location.pathname}${location.searchStr}`;
    if (lastNavigation.current === navigation) return;
    lastNavigation.current = navigation;
    void trackClientAnalytics("page_view", pageViewProperties());
  }, [location.pathname, location.searchStr]);

  return null;
}
