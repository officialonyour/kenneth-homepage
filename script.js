"use strict";

const DEFAULT_DATA = {
  settings: {
    display_name: "이휘근",
    english_name: "HWEGEUN",
    role: "HIPHOP / EDM PRODUCER",
    eyebrow: "BEAT · VIBE · ENERGY",
    hero_statement: "감정은 깊게,\n드롭은 강하게.",
    hero_description: "힙합의 무게감과 EDM의 에너지를 하나의 사운드로 설계합니다.",
    contact_email: "kenneth.whee@gmail.com",
    accent_color: "#ff5d2e",
    accent_color_2: "#6af7df",
    spotify_url: "https://open.spotify.com/artist/6TdOEKyyP53FqBQ50VDvlK",
    apple_music_url: "https://music.apple.com/kr/artist/1661635079",
    youtube_url: "https://youtube.com/channel/UCA05duT3IUBs3Wozk9htniQ",
    instagram_url: "https://www.instagram.com/knth_whee",
    melon_url: "",
    soundcloud_url: "",
    beatstars_url: "",
    onyour_url: "https://onyour-homepage.pages.dev/"
  },
  releases: [
    {
      id: 1,
      title: "Side by Side",
      release_type: "Single",
      release_date: "2026-05-01",
      genre: "HIPHOP / EDM",
      description: "현재 가장 선명한 이휘근의 사운드.",
      track_count: 1,
      cover_url: "/assets/side-by-side.jpg",
      primary_url: "",
      spotify_url: "",
      apple_music_url: "",
      melon_url: "",
      youtube_url: "",
      soundcloud_url: "",
      beatstars_url: "",
      is_featured: 1,
      sort_order: 1
    },
    {
      id: 2,
      title: "STEP IN",
      release_type: "Single",
      release_date: "2026-02-27",
      genre: "HIPHOP",
      description: "차가운 질감과 추진력을 담은 싱글.",
      track_count: 1,
      cover_url: "/assets/step-in.jpg",
      primary_url: "",
      spotify_url: "",
      apple_music_url: "",
      melon_url: "",
      youtube_url: "",
      soundcloud_url: "",
      beatstars_url: "",
      is_featured: 0,
      sort_order: 2
    },
    {
      id: 3,
      title: "Alive",
      release_type: "Single",
      release_date: "2026-01-09",
      genre: "HIPHOP / EDM",
      description: "두 곡으로 이어지는 에너지와 생동감.",
      track_count: 2,
      cover_url: "/assets/alive.jpg",
      primary_url: "",
      spotify_url: "",
      apple_music_url: "",
      melon_url: "",
      youtube_url: "",
      soundcloud_url: "",
      beatstars_url: "",
      is_featured: 0,
      sort_order: 3
    },
    {
      id: 4,
      title: "dsm",
      release_type: "Single",
      release_date: "2025-12-12",
      genre: "EDM",
      description: "차갑고 넓은 공간감 위에 쌓은 강한 드롭.",
      track_count: 1,
      cover_url: "/assets/dsm.jpg",
      primary_url: "",
      spotify_url: "",
      apple_music_url: "",
      melon_url: "",
      youtube_url: "",
      soundcloud_url: "",
      beatstars_url: "",
      is_featured: 0,
      sort_order: 4
    }
  ],
  videos: []
};

const PLATFORM_KEYS = [
  ["spotify_url", "Spotify", "STREAM"],
  ["apple_music_url", "Apple Music", "LISTEN"],
  ["youtube_url", "YouTube", "WATCH"],
  ["instagram_url", "Instagram", "FOLLOW"],
  ["melon_url", "Melon", "LISTEN"],
  ["soundcloud_url", "SoundCloud", "STREAM"],
  ["beatstars_url", "BeatStars", "BUY BEATS"]
];

const RELEASE_LINKS = [
  ["primary_url", "Listen", true],
  ["spotify_url", "Spotify"],
  ["apple_music_url", "Apple Music"],
  ["melon_url", "Melon"],
  ["youtube_url", "YouTube"],
  ["soundcloud_url", "SoundCloud"],
  ["beatstars_url", "BeatStars"]
];

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

let siteData = structuredClone(DEFAULT_DATA);
let toastTimer = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value, window.location.origin);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date).replaceAll(". ", ".").replace(/\.$/, "");
}

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function normalizeData(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    settings: { ...DEFAULT_DATA.settings, ...(source.settings || {}) },
    releases: Array.isArray(source.releases) && source.releases.length
      ? source.releases
      : DEFAULT_DATA.releases,
    videos: Array.isArray(source.videos) ? source.videos : []
  };
}

async function loadData() {
  try {
    const response = await fetch("/api/public", {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    siteData = normalizeData(await response.json());
  } catch (error) {
    console.info("D1 데이터가 없어 기본 데이터로 표시합니다.", error);
    siteData = normalizeData(DEFAULT_DATA);
  }
  renderSite();
}

function applyTheme(settings) {
  const accent = /^#[0-9a-f]{6}$/i.test(settings.accent_color || "")
    ? settings.accent_color
    : DEFAULT_DATA.settings.accent_color;
  const accent2 = /^#[0-9a-f]{6}$/i.test(settings.accent_color_2 || "")
    ? settings.accent_color_2
    : DEFAULT_DATA.settings.accent_color_2;

  const hex = accent.replace("#", "");
  const rgb = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(", ");
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--accent-2", accent2);
  document.documentElement.style.setProperty("--accent-rgb", rgb);
}

function renderSite() {
  const { settings, releases, videos } = siteData;
  const sortedReleases = [...releases].sort((a, b) => {
    if (Number(b.is_featured) !== Number(a.is_featured)) {
      return Number(b.is_featured) - Number(a.is_featured);
    }
    if (Number(a.sort_order) !== Number(b.sort_order)) {
      return Number(a.sort_order) - Number(b.sort_order);
    }
    return String(b.release_date || "").localeCompare(String(a.release_date || ""));
  });
  const featured = sortedReleases.find((item) => Number(item.is_featured) === 1) || sortedReleases[0];

  applyTheme(settings);
  renderBrand(settings, featured);
  renderQuickLinks(settings);
  renderLatest(featured);
  renderReleases(sortedReleases);
  renderVideo(videos, settings);
  renderPlatforms(settings);
  bindGlobalLinks(settings);
  setupReveal();
}

function renderBrand(settings, featured) {
  const displayName = settings.display_name || DEFAULT_DATA.settings.display_name;
  const englishName = settings.english_name || DEFAULT_DATA.settings.english_name;
  const statement = String(settings.hero_statement || "").replaceAll("\n", "<br />");

  $("#brandName").textContent = englishName;
  $("#displayName").textContent = displayName;
  $("#englishName").textContent = englishName;
  $("#roleText").textContent = settings.role;
  $("#heroEyebrow").textContent = settings.eyebrow;
  $("#heroStatement").innerHTML = statement;
  $("#heroDescription").textContent = settings.hero_description;
  $("#footerName").textContent = `${displayName} / ${englishName}`;
  document.title = `${displayName} | ${settings.role}`;

  if (featured?.cover_url) {
    $("#heroCover").src = featured.cover_url;
  }

  const beatStoreUrl = safeUrl(settings.beatstars_url);
  const beatStoreButton = $("#beatStoreButton");
  if (beatStoreUrl) {
    beatStoreButton.href = beatStoreUrl;
    beatStoreButton.target = "_blank";
    beatStoreButton.rel = "noreferrer";
    beatStoreButton.hidden = false;
  } else {
    beatStoreButton.hidden = true;
  }
}

function configureQuickLink(id, url) {
  const element = $(id);
  const valid = safeUrl(url);
  if (!element || !valid) {
    if (element) element.hidden = true;
    return;
  }
  element.href = valid;
  element.hidden = false;
}

function renderQuickLinks(settings) {
  configureQuickLink("#spotifyQuick", settings.spotify_url);
  configureQuickLink("#soundcloudQuick", settings.soundcloud_url);
  configureQuickLink("#beatstarsQuick", settings.beatstars_url);
}

function getReleaseLinks(release) {
  return RELEASE_LINKS
    .map(([key, label, primary]) => ({
      key,
      label,
      primary: Boolean(primary),
      url: safeUrl(release?.[key])
    }))
    .filter((item, index, array) => item.url && array.findIndex((check) => check.url === item.url) === index);
}

function linkButtonHtml(link) {
  return `<a class="platform-pill${link.primary ? " primary" : ""}" href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)} ↗</a>`;
}

function renderLatest(release) {
  if (!release) {
    $("#latestRelease").hidden = true;
    return;
  }

  $("#latestRelease").hidden = false;
  $("#latestCover").src = release.cover_url || "/assets/profile-logo.png";
  $("#latestCover").alt = `${release.title || "최신 음원"} 앨범 자켓`;
  $("#latestTrackCount").textContent = `${String(release.track_count || 1).padStart(2, "0")} TRACK${Number(release.track_count || 1) > 1 ? "S" : ""}`;
  $("#latestType").textContent = String(release.release_type || "RELEASE").toUpperCase();
  $("#latestTitle").textContent = release.title || "Untitled";
  $("#latestMeta").textContent = [formatDate(release.release_date), release.genre].filter(Boolean).join(" · ");
  $("#latestDescription").textContent = release.description || "이휘근의 최신 사운드를 확인하세요.";
  $("#heroCover").src = release.cover_url || "/assets/profile-logo.png";

  const links = getReleaseLinks(release);
  $("#latestActions").innerHTML = links.length
    ? links.slice(0, 4).map(linkButtonHtml).join("")
    : `<button class="platform-pill" type="button" data-no-link>링크 준비중</button>`;

  $("#latestActions [data-no-link]")?.addEventListener("click", () => {
    showToast("관리자 메뉴에서 음원 링크를 등록해 주세요.");
  });
}

function renderReleases(releases) {
  const grid = $("#releaseGrid");
  $("#releaseCount").textContent = String(releases.length).padStart(2, "0");

  grid.innerHTML = releases.map((release) => `
    <button class="release-card" type="button" data-release-id="${Number(release.id)}">
      <span class="release-art">
        <img src="${escapeHtml(release.cover_url || "/assets/profile-logo.png")}" alt="${escapeHtml(release.title)} 앨범 자켓" loading="lazy" />
      </span>
      <span class="release-copy">
        <strong>${escapeHtml(release.title)}</strong>
        <span>${escapeHtml(String(release.release_type || "RELEASE").toUpperCase())} · ${escapeHtml(formatDate(release.release_date))}</span>
      </span>
    </button>
  `).join("");

  $$("[data-release-id]", grid).forEach((button) => {
    button.addEventListener("click", () => {
      const release = releases.find((item) => Number(item.id) === Number(button.dataset.releaseId));
      if (release) openReleaseModal(release);
    });
  });
}

function youtubeId(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (parsed.pathname.startsWith("/shorts/")) return parsed.pathname.split("/")[2] || "";
    if (parsed.pathname.startsWith("/embed/")) return parsed.pathname.split("/")[2] || "";
    return parsed.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

function renderVideo(videos, settings) {
  const section = $("#videoSection");
  const video = [...videos]
    .sort((a, b) => Number(b.is_featured) - Number(a.is_featured) || Number(a.sort_order) - Number(b.sort_order))[0];
  const channel = safeUrl(settings.youtube_url);

  if (channel) {
    $("#youtubeChannelLink").href = channel;
  }

  if (!video) {
    section.hidden = true;
    return;
  }

  const id = youtubeId(video.youtube_url);
  if (!id) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  $("#videoFrame").innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0" title="${escapeHtml(video.title || "최신 뮤직비디오")}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  $("#videoTitle").textContent = video.title || "Latest Music Video";
  $("#videoDate").textContent = formatDate(video.published_at);
}

function renderPlatforms(settings) {
  const platformGrid = $("#platformGrid");
  const items = PLATFORM_KEYS
    .map(([key, label, kicker]) => ({ key, label, kicker, url: safeUrl(settings[key]) }))
    .filter((item) => item.url);

  platformGrid.innerHTML = items.map((item) => `
    <a class="platform-card" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">
      <small>${escapeHtml(item.kicker)}</small>
      <strong>${escapeHtml(item.label)}</strong>
    </a>
  `).join("");
}

function bindGlobalLinks(settings) {
  const onyourUrl = safeUrl(settings.onyour_url);
  if (onyourUrl) $("#onyourLink").href = onyourUrl;

  $("#emailButton").onclick = async () => {
    const email = settings.contact_email || "";
    if (!email) {
      showToast("관리자 메뉴에서 이메일을 등록해 주세요.");
      return;
    }
    try {
      await navigator.clipboard.writeText(email);
    } catch {
      const input = document.createElement("input");
      input.value = email;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    showToast(`이메일이 복사되었습니다: ${email}`);
  };
}

function openReleaseModal(release) {
  const modal = $("#releaseModal");
  $("#modalCover").src = release.cover_url || "/assets/profile-logo.png";
  $("#modalCover").alt = `${release.title || "음원"} 앨범 자켓`;
  $("#modalType").textContent = String(release.release_type || "RELEASE").toUpperCase();
  $("#releaseModalTitle").textContent = release.title || "Untitled";
  $("#modalMeta").textContent = [formatDate(release.release_date), release.genre].filter(Boolean).join(" · ");

  const links = getReleaseLinks(release);
  $("#modalLinks").innerHTML = links.length
    ? links.map(linkButtonHtml).join("")
    : `<button class="platform-pill" type="button" data-no-link>링크 준비중</button>`;
  $("#modalLinks [data-no-link]")?.addEventListener("click", () => showToast("음원 링크가 아직 등록되지 않았습니다."));

  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeReleaseModal() {
  const modal = $("#releaseModal");
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function setupReveal() {
  const targets = $$(".section-reveal");
  if (!("IntersectionObserver" in window)) {
    targets.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });

  targets.forEach((item) => observer.observe(item));
}

async function shareSite() {
  const data = {
    title: document.title,
    text: "이휘근의 음악과 비트를 확인해 보세요.",
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

  try {
    await navigator.clipboard.writeText(window.location.href);
    showToast("홈페이지 주소가 복사되었습니다.");
  } catch {
    showToast("브라우저 주소창에서 링크를 복사해 주세요.");
  }
}

$("#shareButton").addEventListener("click", shareSite);
$("#releaseBackdrop").addEventListener("click", closeReleaseModal);
$("#releaseClose").addEventListener("click", closeReleaseModal);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeReleaseModal();
});

loadData();
