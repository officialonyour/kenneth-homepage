"use strict";

const DEFAULT_DATA = {
  settings: {
    display_name: "KENNETH",
    role: "HIPHOP / EDM PRODUCER",
    hero_eyebrow: "HIPHOP / EDM PRODUCER",
    hero_title: "SOUND\nTHAT MOVES.",
    hero_description: "묵직한 리듬과 선명한 에너지를 설계합니다.",
    hero_image_url: "",
    contact_email: "kenneth.whee@gmail.com",
    accent_color: "#ef7042",
    spotify_url: "https://open.spotify.com/artist/6TdOEKyyP53FqBQ50VDvlK",
    apple_music_url: "https://music.apple.com/kr/artist/1661635079",
    youtube_url: "https://youtube.com/channel/UCA05duT3IUBs3Wozk9htniQ",
    instagram_url: "https://www.instagram.com/kenneth_beats",
    melon_url: "",
    soundcloud_url: "",
    beatstars_url: "",
    onyour_url: "https://onyour-homepage.pages.dev/",
    onyour_title: "ONYOUR",
    onyour_description: "재즈 힙합 프로젝트의 음악과 라이브를 확인하세요.",
    onyour_image_url: "",
    video_title: "",
    video_url: "",
    video_thumbnail_url: ""
  },
  releases: [
    {
      id: 1,
      title: "Side by Side",
      release_type: "Single",
      release_date: "2026-05-01",
      genre: "HIPHOP / EDM",
      description: "",
      cover_url: "",
      primary_url: "",
      spotify_url: "",
      apple_music_url: "",
      melon_url: "",
      youtube_url: "",
      soundcloud_url: "",
      beatstars_url: "",
      is_featured: 1,
      is_published: 1,
      sort_order: 1
    },
    {
      id: 2,
      title: "STEP IN",
      release_type: "Single",
      release_date: "2026-02-27",
      genre: "HIPHOP",
      description: "",
      cover_url: "",
      primary_url: "",
      spotify_url: "",
      apple_music_url: "",
      melon_url: "",
      youtube_url: "",
      soundcloud_url: "",
      beatstars_url: "",
      is_featured: 0,
      is_published: 1,
      sort_order: 2
    },
    {
      id: 3,
      title: "Alive",
      release_type: "Single",
      release_date: "2026-01-09",
      genre: "HIPHOP / EDM",
      description: "",
      cover_url: "",
      primary_url: "",
      spotify_url: "",
      apple_music_url: "",
      melon_url: "",
      youtube_url: "",
      soundcloud_url: "",
      beatstars_url: "",
      is_featured: 0,
      is_published: 1,
      sort_order: 3
    },
    {
      id: 4,
      title: "dsm",
      release_type: "Single",
      release_date: "2025-12-12",
      genre: "EDM",
      description: "",
      cover_url: "",
      primary_url: "",
      spotify_url: "",
      apple_music_url: "",
      melon_url: "",
      youtube_url: "",
      soundcloud_url: "",
      beatstars_url: "",
      is_featured: 0,
      is_published: 1,
      sort_order: 4
    }
  ]
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

let siteData = structuredClone(DEFAULT_DATA);
let worksExpanded = false;
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
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function formatDate(value) {
  if (!value) return "";

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .format(date)
    .replaceAll(". ", ".")
    .replace(/\.$/, "");
}

function imageMarkup(url, alt, placeholderText, className = "") {
  const validUrl = safeUrl(url);

  if (!validUrl) {
    return `
      <div class="image-placeholder ${className}">
        <span>${escapeHtml(placeholderText)}</span>
        <small>관리자에서 업로드</small>
      </div>
    `;
  }

  return `<img src="${escapeHtml(validUrl)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
}

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;

  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");

  toastTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2100);
}

function normalizeData(input) {
  const source = input && typeof input === "object" ? input : {};

  return {
    settings: {
      ...DEFAULT_DATA.settings,
      ...(source.settings || {})
    },
    releases:
      Array.isArray(source.releases) && source.releases.length
        ? source.releases
        : DEFAULT_DATA.releases
  };
}

async function loadSiteData() {
  try {
    const response = await fetch("/api/public", {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error(`API ${response.status}`);
    }

    siteData = normalizeData(await response.json());
  } catch (error) {
    console.info("D1 연결 전에는 기본 데이터로 표시됩니다.", error);
    siteData = normalizeData(DEFAULT_DATA);
  }

  renderSite();
}

function applyTheme(settings) {
  const accent = /^#[0-9a-f]{6}$/i.test(settings.accent_color || "")
    ? settings.accent_color
    : DEFAULT_DATA.settings.accent_color;

  document.documentElement.style.setProperty("--accent", accent);
}

function renderBrand(settings) {
  const name = settings.display_name || "KENNETH";
  const title = String(settings.hero_title || "").trim();

  $("#headerName").textContent = name;
  $("#footerName").textContent = name;
  $("#heroRole").textContent = settings.role || "";
  $("#heroEyebrow").textContent = settings.hero_eyebrow || settings.role || "";
  $("#heroDescription").textContent = settings.hero_description || "";

  $("#heroTitle").innerHTML = escapeHtml(title).replaceAll("\n", "<br />");

  const heroSlot = $("#heroImageSlot");
  heroSlot.innerHTML = imageMarkup(
    settings.hero_image_url,
    `${name} 메인 이미지`,
    "HERO IMAGE"
  );

  document.title = `${name} | ${settings.role || "Producer"}`;
}

function getReleaseLinks(release) {
  const candidates = [
    ["primary_url", "Listen", true],
    ["spotify_url", "Spotify", false],
    ["apple_music_url", "Apple", false],
    ["melon_url", "Melon", false],
    ["youtube_url", "YouTube", false],
    ["soundcloud_url", "SoundCloud", false],
    ["beatstars_url", "BeatStars", false]
  ];

  const seen = new Set();

  return candidates
    .map(([key, label, primary]) => ({
      label,
      primary,
      url: safeUrl(release?.[key])
    }))
    .filter((item) => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
}

function renderLatestRelease(releases) {
  const container = $("#latestReleaseContent");
  const latest =
    releases.find((release) => Number(release.is_featured) === 1) ||
    releases[0];

  if (!latest) {
    container.innerHTML = `<div class="empty-state">관리자에서 최신 음원을 등록해 주세요.</div>`;
    return;
  }

  const links = getReleaseLinks(latest);

  container.innerHTML = `
    <div class="release-cover">
      ${imageMarkup(latest.cover_url, `${latest.title} 앨범 자켓`, "ALBUM COVER")}
    </div>

    <div class="release-copy">
      <p class="release-type">${escapeHtml(
        String(latest.release_type || "RELEASE").toUpperCase()
      )}</p>
      <h3>${escapeHtml(latest.title || "Untitled")}</h3>
      <p class="release-meta">
        ${escapeHtml(
          [formatDate(latest.release_date), latest.genre]
            .filter(Boolean)
            .join(" · ")
        )}
      </p>

      <div class="release-links">
        ${
          links.length
            ? links
                .slice(0, 3)
                .map(
                  (link) => `
                    <a
                      class="pill${link.primary ? " is-primary" : ""}"
                      href="${escapeHtml(link.url)}"
                      target="_blank"
                      rel="noreferrer"
                    >
                      ${escapeHtml(link.label)}
                    </a>
                  `
                )
                .join("")
            : `<button class="pill" type="button" data-empty-link>링크 준비중</button>`
        }
      </div>
    </div>
  `;

  container.querySelector("[data-empty-link]")?.addEventListener("click", () => {
    showToast("관리자에서 음원 링크를 등록해 주세요.");
  });

  const heroListenLink = $("#heroListenLink");
  const primaryLink = links[0]?.url;

  if (primaryLink) {
    heroListenLink.href = primaryLink;
    heroListenLink.target = "_blank";
    heroListenLink.rel = "noreferrer";
  } else {
    heroListenLink.href = "#latestRelease";
    heroListenLink.removeAttribute("target");
  }
}

function renderWorks(releases) {
  const rail = $("#worksRail");

  if (!releases.length) {
    rail.innerHTML = `<div class="empty-state">등록된 음원이 없습니다.</div>`;
    return;
  }

  rail.innerHTML = releases
    .map(
      (release) => `
        <article class="work-card">
          <div class="work-cover">
            ${imageMarkup(
              release.cover_url,
              `${release.title} 앨범 자켓`,
              "COVER",
              "is-small"
            )}
          </div>
          <h3>${escapeHtml(release.title || "Untitled")}</h3>
          <p>${escapeHtml(formatDate(release.release_date))}</p>
        </article>
      `
    )
    .join("");
}

function renderVideo(settings) {
  const container = $("#videoContent");
  const videoUrl = safeUrl(settings.video_url);
  const thumbnailUrl = safeUrl(settings.video_thumbnail_url);

  container.innerHTML = `
    <a
      class="video-thumb"
      href="${escapeHtml(videoUrl || "#")}"
      ${videoUrl ? 'target="_blank" rel="noreferrer"' : ""}
      data-video-link
    >
      ${
        thumbnailUrl
          ? `<img src="${escapeHtml(thumbnailUrl)}" alt="${escapeHtml(
              settings.video_title || "최신 뮤직비디오"
            )}" loading="lazy" />`
          : imageMarkup("", "", "VIDEO THUMBNAIL", "is-small")
      }
      <span class="play-button">▶</span>
    </a>

    <h3>${escapeHtml(settings.video_title || "최신 영상을 등록해 주세요")}</h3>

    <a
      class="line-button"
      href="${escapeHtml(videoUrl || "#")}"
      ${videoUrl ? 'target="_blank" rel="noreferrer"' : ""}
      data-video-link
    >
      영상 보기 <span>↗</span>
    </a>
  `;

  if (!videoUrl) {
    $$("[data-video-link]", container).forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        showToast("관리자에서 YouTube 링크를 등록해 주세요.");
      });
    });
  }
}

function renderOnyour(settings) {
  $("#onyourTitle").textContent = settings.onyour_title || "ONYOUR";
  $("#onyourDescription").textContent =
    settings.onyour_description || "";

  $("#onyourImageSlot").innerHTML = imageMarkup(
    settings.onyour_image_url,
    "ONYOUR",
    "ONYOUR IMAGE",
    "is-small"
  );

  const link = $("#onyourButton");
  const url = safeUrl(settings.onyour_url);

  if (url) {
    link.href = url;
  } else {
    link.href = "#";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showToast("관리자에서 ONYOUR 링크를 등록해 주세요.");
    });
  }
}

function bindOptionalLink(element, url, emptyMessage) {
  const valid = safeUrl(url);

  if (!valid) {
    element.href = "#";
    element.removeAttribute("target");
    element.addEventListener("click", (event) => {
      event.preventDefault();
      showToast(emptyMessage);
    });
    return;
  }

  element.href = valid;
  if (!valid.startsWith("mailto:")) {
    element.target = "_blank";
    element.rel = "noreferrer";
  }
}

function renderLinks(settings) {
  const links = [
    ["Spotify", settings.spotify_url],
    ["Apple Music", settings.apple_music_url],
    ["YouTube", settings.youtube_url],
    ["Instagram", settings.instagram_url],
    ["SoundCloud", settings.soundcloud_url],
    ["BeatStars", settings.beatstars_url],
    ["Melon", settings.melon_url]
  ];

  const linkGrid = $("#linkGrid");

  linkGrid.innerHTML = links
    .map(
      ([label, url]) => `
        <a
          class="link-item"
          href="#"
          data-url="${escapeHtml(url || "")}"
          data-label="${escapeHtml(label)}"
        >
          <span>${escapeHtml(label)}</span>
          <span>↗</span>
        </a>
      `
    )
    .join("");

  const contact = document.createElement("a");
  contact.className = "link-item is-wide";
  contact.innerHTML = `<span>Contact / Collaboration</span><span>↗</span>`;
  linkGrid.append(contact);

  $$(".link-item[data-label]", linkGrid).forEach((element) => {
    bindOptionalLink(
      element,
      element.dataset.url,
      `${element.dataset.label} 링크를 등록해 주세요.`
    );
  });

  bindOptionalLink(
    contact,
    settings.contact_email
      ? `mailto:${settings.contact_email}`
      : "",
    "관리자에서 이메일 주소를 등록해 주세요."
  );

  bindOptionalLink(
    $("#beatstarsButton"),
    settings.beatstars_url,
    "관리자에서 BeatStars 링크를 등록해 주세요."
  );
}

function renderSite() {
  const settings = siteData.settings;
  const releases = [...siteData.releases]
    .filter((release) => Number(release.is_published) !== 0)
    .sort((a, b) => {
      if (Number(b.is_featured) !== Number(a.is_featured)) {
        return Number(b.is_featured) - Number(a.is_featured);
      }

      if (Number(a.sort_order) !== Number(b.sort_order)) {
        return Number(a.sort_order) - Number(b.sort_order);
      }

      return String(b.release_date || "").localeCompare(
        String(a.release_date || "")
      );
    });

  applyTheme(settings);
  renderBrand(settings);
  renderLatestRelease(releases);
  renderWorks(releases);
  renderVideo(settings);
  renderOnyour(settings);
  renderLinks(settings);
}

function openDrawer() {
  $("#drawer").classList.add("is-open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#drawerBackdrop").hidden = false;
  $("#menuButton").setAttribute("aria-expanded", "true");
  document.body.classList.add("is-locked");
}

function closeDrawer() {
  $("#drawer").classList.remove("is-open");
  $("#drawer").setAttribute("aria-hidden", "true");
  $("#drawerBackdrop").hidden = true;
  $("#menuButton").setAttribute("aria-expanded", "false");
  document.body.classList.remove("is-locked");
}

$("#menuButton").addEventListener("click", openDrawer);
$("#drawerClose").addEventListener("click", closeDrawer);
$("#drawerBackdrop").addEventListener("click", closeDrawer);

$$(".drawer-nav a").forEach((link) => {
  link.addEventListener("click", closeDrawer);
});

$("#toggleWorksButton").addEventListener("click", () => {
  worksExpanded = !worksExpanded;
  $("#worksRail").classList.toggle("is-expanded", worksExpanded);
  $("#toggleWorksButton").textContent = worksExpanded ? "CLOSE" : "VIEW ALL";
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
});

loadSiteData();
