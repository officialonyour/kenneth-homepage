"use strict";

// 링크만 바꾸면 카드 연결 주소를 손쉽게 수정할 수 있습니다.
const PROFILE_LINKS = {
  instagram: "https://www.instagram.com/kenneth_beats",
  youtube: "https://youtube.com/channel/UCA05duT3IUBs3Wozk9htniQ",
  spotify: "https://open.spotify.com/artist/6TdOEKyyP53FqBQ50VDvlK",
  appleMusic: "https://music.apple.com/kr/artist/1661635079",
  store: "",
  soundcloud: "",
  melon: ""
};



const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const tabButtons = $$(".tab-button");
const tabPanels = $$(".tab-panel");
const contactModal = $("#contactModal");
const modalClose = $("#modalClose");
const contactTriggers = [$("#contactButton"), $("#profileButton"), $("#drawerContact")].filter(Boolean);
const toast = $("#toast");
const menuButton = $("#menuButton");
const sideDrawer = $("#sideDrawer");
const drawerClose = $("#drawerClose");
const drawerBackdrop = $("#drawerBackdrop");
const searchButton = $("#searchButton");
const searchPanel = $("#searchPanel");
const searchClose = $("#searchClose");
const siteSearch = $("#siteSearch");
const searchMessage = $("#searchMessage");
let toastTimer = null;

function showToast(message) {
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2100);
}

function activateTab(tabName, shouldScroll = false) {
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === tabName;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  tabPanels.forEach((panel) => {
    const isActive = panel.dataset.panel === tabName;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });

  if (shouldScroll) {
    $(".tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function openContactModal() {
  closeDrawer();
  contactModal.classList.add("is-open");
  contactModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  modalClose.focus();
}

function closeContactModal() {
  contactModal.classList.remove("is-open");
  contactModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function openDrawer() {
  closeSearch();
  sideDrawer.classList.add("is-open");
  sideDrawer.setAttribute("aria-hidden", "false");
  drawerBackdrop.hidden = false;
  menuButton.setAttribute("aria-expanded", "true");
}

function closeDrawer() {
  sideDrawer.classList.remove("is-open");
  sideDrawer.setAttribute("aria-hidden", "true");
  drawerBackdrop.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
}

function openSearch() {
  closeDrawer();
  searchPanel.classList.add("is-open");
  searchPanel.setAttribute("aria-hidden", "false");
  searchButton.setAttribute("aria-expanded", "true");
  window.setTimeout(() => siteSearch.focus(), 120);
}

function closeSearch() {
  searchPanel.classList.remove("is-open");
  searchPanel.setAttribute("aria-hidden", "true");
  searchButton.setAttribute("aria-expanded", "false");
  siteSearch.value = "";
  resetSearchResults();
}

function resetSearchResults() {
  $$(".searchable").forEach((item) => item.classList.remove("is-search-hidden"));
  searchMessage.textContent = "카드 제목과 앨범명을 검색할 수 있습니다.";
}

function runSearch() {
  const query = siteSearch.value.trim().toLocaleLowerCase("ko-KR");
  if (!query) {
    resetSearchResults();
    return;
  }

  const items = $$(".searchable");
  let count = 0;
  items.forEach((item) => {
    const haystack = `${item.dataset.search || ""} ${item.textContent || ""}`.toLocaleLowerCase("ko-KR");
    const matched = haystack.includes(query);
    item.classList.toggle("is-search-hidden", !matched);
    if (matched) count += 1;
  });

  searchMessage.textContent = count ? `${count}개의 결과가 있습니다.` : "검색 결과가 없습니다.";
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    const temp = document.createElement("textarea");
    temp.value = text;
    temp.style.position = "fixed";
    temp.style.opacity = "0";
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
    showToast(successMessage);
  }
}

async function sharePage() {
  const shareData = {
    title: document.title,
    text: "이휘근 (Kenneth)님의 음악과 링크를 확인해 보세요.",
    url: window.location.href
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }

  await copyText(window.location.href, "홈페이지 주소가 복사되었습니다.");
}

function applyConfiguredLinks() {
  const linkMap = [
    ["instagram", 'a[href*="instagram.com/kenneth_beats"]'],
    ["youtube", 'a[href*="youtube.com/channel"]'],
    ["spotify", 'a[href*="open.spotify.com/artist"]'],
    ["appleMusic", 'a[href*="music.apple.com"]']
  ];

  linkMap.forEach(([key, selector]) => {
    const element = $(selector);
    if (element && PROFILE_LINKS[key]) element.href = PROFILE_LINKS[key];
  });

  const placeholders = [
    ["store", "KENNETH Beats Store"],
    ["soundcloud", "SoundCloud"],
    ["melon", "Melon"]
  ];

  placeholders.forEach(([key, label]) => {
    const target = $(`.placeholder-link[data-placeholder-message^="${label}"]`);
    if (!target) return;
    const url = PROFILE_LINKS[key];
    if (url) {
      target.href = url;
      target.target = "_blank";
      target.rel = "noreferrer";
      target.classList.remove("placeholder-link");
    }
  });
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});

$$("[data-tab-target]").forEach((button) => {
  button.addEventListener("click", () => {
    activateTab(button.dataset.tabTarget, true);
    closeDrawer();
  });
});

contactTriggers.forEach((button) => button.addEventListener("click", openContactModal));
modalClose.addEventListener("click", closeContactModal);
contactModal.addEventListener("click", (event) => {
  if (event.target === contactModal) closeContactModal();
});

menuButton.addEventListener("click", () => {
  if (sideDrawer.classList.contains("is-open")) closeDrawer();
  else openDrawer();
});
drawerClose.addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);

searchButton.addEventListener("click", () => {
  if (searchPanel.classList.contains("is-open")) closeSearch();
  else openSearch();
});
searchClose.addEventListener("click", closeSearch);
siteSearch.addEventListener("input", runSearch);

$$(".contact-row[data-copy]").forEach((row) => {
  row.addEventListener("click", () => {
    const value = row.dataset.copy;
    const label = value.includes("@") ? "이메일 주소" : "Kakao ID";
    copyText(value, `${label}가 복사되었습니다.`);
  });
});

$$(".placeholder-link").forEach((link) => {
  link.addEventListener("click", (event) => {
    if (link.getAttribute("href") === "#") {
      event.preventDefault();
      showToast(link.dataset.placeholderMessage || "링크를 입력해 주세요.");
    }
  });
});

$$(".like-trigger").forEach((button) => {
  button.addEventListener("click", () => {
    const nextState = !button.classList.contains("is-liked");
    $$(".like-trigger").forEach((item) => item.classList.toggle("is-liked", nextState));
    showToast(nextState ? "좋아요를 눌렀습니다." : "좋아요를 취소했습니다.");
  });
});

$$(".share-trigger").forEach((button) => button.addEventListener("click", sharePage));

$("#notificationButton").addEventListener("click", () => {
  showToast("새 음악 알림 기능을 준비 중입니다.");
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (contactModal.classList.contains("is-open")) closeContactModal();
  if (sideDrawer.classList.contains("is-open")) closeDrawer();
  if (searchPanel.classList.contains("is-open")) closeSearch();
});

applyConfiguredLinks();
activateTab("home");
