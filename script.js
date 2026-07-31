"use strict";

const SITE_DATA = {
  profile: {
    name: "KENNETH",
    email: "kenneth.whee@gmail.com"
  },
  links: {
    spotify: "https://open.spotify.com/artist/6TdOEKyyP53FqBQ50VDvlK",
    appleMusic: "https://music.apple.com/kr/artist/1661635079",
    youtube: "https://youtube.com/channel/UCA05duT3IUBs3Wozk9htniQ",
    instagram: "https://www.instagram.com/kenneth_beats",
    soundcloud: "#",
    beatstars: "#",
    onyour: "https://onyour-homepage.pages.dev",
    contact: "mailto:kenneth.whee@gmail.com"
  },
  releases: [
    {
      id: "dsm",
      title: "dsm",
      year: "2024",
      subtitle: "KENNETH · 2024",
      image: "assets/dsm.jpg",
      isLatest: true,
      platformLinks: {
        spotify: "https://open.spotify.com/artist/6TdOEKyyP53FqBQ50VDvlK",
        appleMusic: "https://music.apple.com/kr/artist/1661635079",
        youtube: "https://youtube.com/channel/UCA05duT3IUBs3Wozk9htniQ"
      }
    },
    {
      id: "alive",
      title: "ALIVE",
      year: "2023",
      subtitle: "KENNETH · 2023",
      image: "assets/alive.jpg",
      platformLinks: {
        spotify: "https://open.spotify.com/artist/6TdOEKyyP53FqBQ50VDvlK",
        appleMusic: "https://music.apple.com/kr/artist/1661635079",
        youtube: "https://youtube.com/channel/UCA05duT3IUBs3Wozk9htniQ"
      }
    },
    {
      id: "side-by-side",
      title: "SIDE BY SIDE",
      year: "2024",
      subtitle: "KENNETH · 2024",
      image: "assets/side-by-side.jpg",
      platformLinks: {
        spotify: "https://open.spotify.com/artist/6TdOEKyyP53FqBQ50VDvlK",
        appleMusic: "https://music.apple.com/kr/artist/1661635079",
        youtube: "https://youtube.com/channel/UCA05duT3IUBs3Wozk9htniQ"
      }
    },
    {
      id: "step-in",
      title: "STEP IN",
      year: "2025",
      subtitle: "KENNETH · 2025",
      image: "assets/step-in.jpg",
      platformLinks: {
        spotify: "https://open.spotify.com/artist/6TdOEKyyP53FqBQ50VDvlK",
        appleMusic: "https://music.apple.com/kr/artist/1661635079",
        youtube: "https://youtube.com/channel/UCA05duT3IUBs3Wozk9htniQ"
      }
    }
  ],
  latestVideo: {
    title: "KENNETH - SIDE BY SIDE (OFFICIAL M/V)",
    thumbnail: "assets/side-by-side.jpg",
    url: "https://youtube.com/channel/UCA05duT3IUBs3Wozk9htniQ"
  }
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const latestReleaseWrap = $("#latestReleaseWrap");
const worksGrid = $("#worksGrid");
const videoThumbWrap = $("#videoThumbWrap");
const videoTitleText = $("#videoTitleText");
const toast = $("#toast");
const heroListenButton = $("#heroListenButton");
const beatstarsButton = $("#beatstarsButton");
const viewAllWorksButton = $("#viewAllWorksButton");
const videoLinkButton = $("#videoLinkButton");
const onyourLinkButton = $("#onyourLinkButton");
const menuButton = $("#menuButton");
const mobileDrawer = $("#mobileDrawer");
const drawerClose = $("#drawerClose");
const drawerBackdrop = $("#drawerBackdrop");
let toastTimer = null;

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2100);
}

function bindSafeLink(element, url, emptyMessage) {
  if (!element) return;
  if (!url || url === "#") {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      showToast(emptyMessage || "링크를 입력해 주세요.");
    });
    return;
  }
  element.href = url;
}

function renderLatestRelease() {
  const latest = SITE_DATA.releases.find((release) => release.isLatest) || SITE_DATA.releases[0];
  if (!latest) return;

  latestReleaseWrap.innerHTML = `
    <img class="release-art" src="${latest.image}" alt="${latest.title} 앨범 자켓" />
    <div class="release-copy">
      <span class="release-tag">NEW</span>
      <h3 class="release-title">${latest.title}</h3>
      <p class="release-meta">${latest.subtitle}</p>
      <div class="platform-pills">
        <a class="platform-pill is-dark" href="${latest.platformLinks.spotify || '#'}" target="_blank" rel="noreferrer">Spotify</a>
        <a class="platform-pill" href="${latest.platformLinks.appleMusic || '#'}" target="_blank" rel="noreferrer">Apple Music</a>
        <a class="platform-pill" href="${latest.platformLinks.youtube || '#'}" target="_blank" rel="noreferrer">YouTube</a>
      </div>
    </div>
  `;

  if (latest.platformLinks.spotify) heroListenButton.href = latest.platformLinks.spotify;
}

function renderWorks() {
  worksGrid.innerHTML = SITE_DATA.releases.map((release) => `
    <article class="work-card">
      <img src="${release.image}" alt="${release.title} 앨범 자켓" />
      <div class="work-copy">
        <h3 class="work-title">${release.title}</h3>
        <p class="work-year">${release.year}</p>
      </div>
    </article>
  `).join("");
}

function renderVideo() {
  const video = SITE_DATA.latestVideo;
  videoThumbWrap.innerHTML = `
    <a class="video-thumbnail" href="${video.url || '#'}" target="_blank" rel="noreferrer" aria-label="최신 뮤직비디오 보기">
      <img src="${video.thumbnail}" alt="${video.title}" />
      <span class="play-badge">▶</span>
    </a>
  `;
  videoTitleText.textContent = video.title;
  bindSafeLink(videoLinkButton, video.url, "유튜브 링크를 넣어 주세요.");
}

function bindFooterLinks() {
  bindSafeLink($("#soundcloudLink"), SITE_DATA.links.soundcloud, "SoundCloud 링크를 넣어 주세요.");
  bindSafeLink($("#beatstarsLink"), SITE_DATA.links.beatstars, "BeatStars 링크를 넣어 주세요.");
  bindSafeLink($("#spotifyLink"), SITE_DATA.links.spotify, "Spotify 링크를 넣어 주세요.");
  bindSafeLink($("#appleMusicLink"), SITE_DATA.links.appleMusic, "Apple Music 링크를 넣어 주세요.");
  bindSafeLink($("#youtubeLink"), SITE_DATA.links.youtube, "YouTube 링크를 넣어 주세요.");
  bindSafeLink($("#instagramLink"), SITE_DATA.links.instagram, "Instagram 링크를 넣어 주세요.");
  bindSafeLink($("#contactLink"), SITE_DATA.links.contact, "연락처 링크를 넣어 주세요.");

  bindSafeLink(beatstarsButton, SITE_DATA.links.beatstars, "BeatStars 링크를 넣어 주세요.");
  bindSafeLink(onyourLinkButton, SITE_DATA.links.onyour, "ONYOUR 홈페이지 링크를 넣어 주세요.");
}

function openDrawer() {
  mobileDrawer.classList.add("is-open");
  mobileDrawer.setAttribute("aria-hidden", "false");
  drawerBackdrop.hidden = false;
  menuButton.setAttribute("aria-expanded", "true");
}

function closeDrawer() {
  mobileDrawer.classList.remove("is-open");
  mobileDrawer.setAttribute("aria-hidden", "true");
  drawerBackdrop.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
}

menuButton.addEventListener("click", () => {
  if (mobileDrawer.classList.contains("is-open")) closeDrawer();
  else openDrawer();
});
drawerClose.addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);
$$('.drawer-nav a').forEach((anchor) => anchor.addEventListener('click', closeDrawer));

viewAllWorksButton.addEventListener("click", () => {
  document.querySelector("#selectedWorks")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

renderLatestRelease();
renderWorks();
renderVideo();
bindFooterLinks();
