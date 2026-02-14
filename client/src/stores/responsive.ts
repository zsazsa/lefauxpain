import { createSignal } from "solid-js";

const MOBILE_BREAKPOINT = 768;

const [mobile, setMobile] = createSignal(window.innerWidth <= MOBILE_BREAKPOINT);
const [sidebarOpen, setSidebarOpen] = createSignal(false);

export const isMobile = mobile;
export { sidebarOpen, setSidebarOpen };

function updateAppHeight() {
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${vh}px`);
}

export function initResponsive() {
  const onResize = () => {
    const nowMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    setMobile(nowMobile);
    // Auto-close sidebar when crossing to desktop
    if (!nowMobile) setSidebarOpen(false);
  };
  window.addEventListener("resize", onResize);

  // Track visual viewport for mobile keyboard
  updateAppHeight();
  window.visualViewport?.addEventListener("resize", updateAppHeight);
  window.visualViewport?.addEventListener("scroll", updateAppHeight);

  return () => {
    window.removeEventListener("resize", onResize);
    window.visualViewport?.removeEventListener("resize", updateAppHeight);
    window.visualViewport?.removeEventListener("scroll", updateAppHeight);
  };
}
