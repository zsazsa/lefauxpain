import { createSignal } from "solid-js";

const MOBILE_BREAKPOINT = 768;

const [mobile, setMobile] = createSignal(window.innerWidth <= MOBILE_BREAKPOINT);
const [sidebarOpen, setSidebarOpen] = createSignal(false);

export const isMobile = mobile;
export { sidebarOpen, setSidebarOpen };

export function initResponsive() {
  const onResize = () => {
    const nowMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    setMobile(nowMobile);
    // Auto-close sidebar when crossing to desktop
    if (!nowMobile) setSidebarOpen(false);
  };
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
}
