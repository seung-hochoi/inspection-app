import React, { useEffect, useState } from "react";
import InspectionMobileLayout from "./InspectionMobileLayout";
import InspectionWebLayout from "./InspectionWebLayout";

function useIsMobile(breakpoint = 960) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= breakpoint : true
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mediaQuery = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setIsMobile(mediaQuery.matches);
    update();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, [breakpoint]);

  return isMobile;
}

function InspectionTab(props) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return <InspectionMobileLayout {...props} />;
  }

  return <InspectionWebLayout {...props} />;
}

export default InspectionTab;
