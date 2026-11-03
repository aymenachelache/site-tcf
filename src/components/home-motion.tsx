'use client';

import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

export function HomeMotion() {
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    const homeElement = document.getElementById("public-home");
    if (!homeElement) return;
    const home: HTMLElement = homeElement;

    const motionPreference = window.matchMedia("(prefers-reduced-motion: no-preference)");
    const supportsScrollTimeline = CSS.supports("animation-timeline: scroll()");
    const revealItems = home.querySelectorAll<HTMLElement>("[data-reveal]");
    const faqCloseTimers = new Map<HTMLDetailsElement, number>();
    let observer: IntersectionObserver | undefined;

    if (motionPreference.matches) {
      home.classList.add("home-motion-ready");
      if ("IntersectionObserver" in window) {
        observer = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-visible");
            observer?.unobserve(entry.target);
          });
        }, { threshold: 0.15 });
        revealItems.forEach((item) => observer?.observe(item));
      } else {
        revealItems.forEach((item) => item.classList.add("is-visible"));
      }
    }

    function updateScrollState() {
      home.classList.toggle("home-scrolled", window.scrollY > 20);
      setShowBackToTop(window.scrollY > 400);
      if (motionPreference.matches && !supportsScrollTimeline) {
        const scrollableDistance = document.documentElement.scrollHeight - window.innerHeight;
        const progress = scrollableDistance > 0 ? window.scrollY / scrollableDistance : 0;
        home.style.setProperty("--home-scroll-progress", String(progress));
      }
    }

    function scrollToSection(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (!(event.target instanceof Element)) return;

      const summary = event.target.closest<HTMLElement>("#public-home .home-faq-list summary");
      const details = summary?.parentElement;
      if (details instanceof HTMLDetailsElement && details.open && motionPreference.matches) {
        event.preventDefault();
        details.classList.add("is-closing");
        const previousTimer = faqCloseTimers.get(details);
        if (previousTimer) window.clearTimeout(previousTimer);
        faqCloseTimers.set(details, window.setTimeout(() => {
          details.open = false;
          details.classList.remove("is-closing");
          faqCloseTimers.delete(details);
        }, 240));
        return;
      }

      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest<HTMLAnchorElement>('#public-home a[href^="#"]');
      const href = link?.getAttribute("href");
      const section = href ? document.querySelector<HTMLElement>(href) : null;
      if (!link || !section) return;

      event.preventDefault();
      window.history.pushState(null, "", href);
      section.scrollIntoView({ behavior: motionPreference.matches ? "smooth" : "instant", block: "start" });
    }

    window.addEventListener("scroll", updateScrollState, { passive: true });
    home.addEventListener("click", scrollToSection);
    updateScrollState();

    return () => {
      observer?.disconnect();
      faqCloseTimers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("scroll", updateScrollState);
      home.removeEventListener("click", scrollToSection);
      home.classList.remove("home-motion-ready", "home-scrolled");
      home.style.removeProperty("--home-scroll-progress");
    };
  }, []);

  return (
    <button
      type="button"
      className={`home-back-to-top${showBackToTop ? " is-visible" : ""}`}
      aria-label="Retour en haut de page"
      aria-hidden={!showBackToTop}
      tabIndex={showBackToTop ? 0 : -1}
      onClick={() => window.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: no-preference)").matches ? "smooth" : "instant",
      })}
    >
      <ArrowUp size={19} aria-hidden="true" />
    </button>
  );
}