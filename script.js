"use strict";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const siteHeader = $("#siteHeader");
const scrollProgress = $("#scrollProgress");
const menuButton = $("#menuButton");
const mobileMenu = $("#mobileMenu");
const menuClose = $("#menuClose");
const menuBackdrop = $("#menuBackdrop");
const shareButton = $("#shareButton");
const copyEmailButton = $("#copyEmailButton");
const backToTop = $("#backToTop");
const toast = $("#toast");
const currentYear = $("#currentYear");
let toastTimer = null;

function showToast(message) {
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2200);
}

function openMenu() {
  if (!mobileMenu || !menuButton || !menuBackdrop) return;
  mobileMenu.classList.add("is-open");
  mobileMenu.setAttribute("aria-hidden", "false");
  menuButton.setAttribute("aria-expanded", "true");
  menuBackdrop.hidden = false;
  document.body.classList.add("menu-open");
  menuClose?.focus();
}

function closeMenu() {
  if (!mobileMenu || !menuButton || !menuBackdrop) return;
  mobileMenu.classList.remove("is-open");
  mobileMenu.setAttribute("aria-hidden", "true");
  menuButton.setAttribute("aria-expanded", "false");
  menuBackdrop.hidden = true;
  document.body.classList.remove("menu-open");
}

async function copyText(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(message);
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = value;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand("copy");
    fallback.remove();
    showToast(message);
  }
}

async function shareProfile() {
  const data = {
    title: document.title,
    text: "ì´íê·¼ì ê³µì ìì í¬í¸í´ë¦¬ì¤ë¥¼ íì¸í´ ë³´ì¸ì.",
    url: window.location.href
  };

  if (navigator.share) {
    try {
      await navigator.share(data);
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }

  await copyText(window.location.href, "ííì´ì§ ì£¼ìê° ë³µì¬ëììµëë¤.");
}

function updateScrollState() {
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollable > 0 ? Math.min(100, (scrollTop / scrollable) * 100) : 0;

  if (scrollProgress) scrollProgress.style.width = `${progress}%`;
  siteHeader?.classList.toggle("is-scrolled", scrollTop > 20);
}

function setupRevealAnimation() {
  const targets = $$(".reveal");
  if (!("IntersectionObserver" in window)) {
    targets.forEach((target) => target.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, currentObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        currentObserver.unobserve(entry.target);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
  );

  targets.forEach((target, index) => {
    target.style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
    observer.observe(target);
  });
}

function setupArtworkTilt() {
  const art = $(".hero-art");
  const cards = $$("[data-tilt]");
  if (!art || !cards.length || window.matchMedia("(pointer: coarse)").matches) return;

  const baseTransforms = new Map([
    [$(".cover-main"), "rotate(3.5deg)"],
    [$(".cover-back-one"), "rotate(-10deg)"],
    [$(".cover-back-two"), "rotate(12deg)"]
  ]);

  art.addEventListener("pointermove", (event) => {
    const rect = art.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;

    cards.forEach((card, index) => {
      const depth = 1 - index * 0.18;
      const base = baseTransforms.get(card) || "";
      const rotateX = y * -8 * depth;
      const rotateY = x * 10 * depth;
      const moveX = x * 14 * depth;
      const moveY = y * 10 * depth;
      card.style.transform = `${base} translate3d(${moveX}px, ${moveY}px, 0) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    });
  });

  art.addEventListener("pointerleave", () => {
    cards.forEach((card) => {
      card.style.transform = baseTransforms.get(card) || "";
    });
  });
}

menuButton?.addEventListener("click", () => {
  if (mobileMenu?.classList.contains("is-open")) closeMenu();
  else openMenu();
});

menuClose?.addEventListener("click", closeMenu);
menuBackdrop?.addEventListener("click", closeMenu);
$$(".mobile-menu a").forEach((link) => link.addEventListener("click", closeMenu));

shareButton?.addEventListener("click", shareProfile);

copyEmailButton?.addEventListener("click", () => {
  const email = copyEmailButton.dataset.copy;
  if (email) copyText(email, "ì´ë©ì¼ ì£¼ìê° ë³µì¬ëììµëë¤.");
});

backToTop?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && mobileMenu?.classList.contains("is-open")) {
    closeMenu();
  }
});

window.addEventListener("scroll", updateScrollState, { passive: true });
window.addEventListener("resize", updateScrollState);

if (currentYear) currentYear.textContent = String(new Date().getFullYear());

setupRevealAnimation();
setupArtworkTilt();
updateScrollState();
