"use strict";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

let adminData = {
  settings: {},
  releases: []
};

let toastTimer = null;

function showToast(message) {
  const toast = $("#toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");

  toastTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      Accept: "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || `요청 실패 (${response.status})`);
    error.status = response.status;
    throw error;
  }

  return data;
}

function setView(isLoggedIn) {
  $("#loginView").hidden = isLoggedIn;
  $("#dashboardView").hidden = !isLoggedIn;
}

function formToObject(form) {
  const formData = new FormData(form);
  return Object.fromEntries(formData.entries());
}

function setFormValues(form, values) {
  Object.entries(values || {}).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (!field) return;

    if (field.type === "checkbox") {
      field.checked = Number(value) === 1 || value === true;
    } else {
      field.value = value ?? "";
    }
  });
}

function renderPreview(previewId, url) {
  const preview = document.getElementById(previewId);
  if (!preview) return;

  preview.innerHTML = url
    ? `<img src="${url}" alt="" />`
    : `<span>업로드된 이미지 없음</span>`;
}

function renderAllPreviews(
  settings
) {
  renderPreview(
    "headerBannerPreview",
    settings.header_banner_url
  );

  renderPreview(
    "heroPreview",
    settings.hero_image_url
  );

  renderPreview(
    "videoPreview",
    settings.video_thumbnail_url
  );

  renderPreview(
    "onyourPreview",
    settings.onyour_image_url
  );
}

function activateTab(tabName) {
  $$(".tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tabName);
  });

  $$(".tab-panel").forEach((panel) => {
    panel.classList.toggle(
      "is-active",
      panel.dataset.panel === tabName
    );
  });
}

function fillSettingsForms(
  settings
) {
  const profileFields = [
    "display_name",
    "role",
    "hero_eyebrow",
    "hero_title",
    "hero_description",
    "header_banner_url",
    "hero_image_url",
    "contact_email",
    "accent_color"
  ];

  const mediaFields = [
    "spotify_url",
    "apple_music_url",
    "youtube_url",
    "instagram_url",
    "melon_url",
    "soundcloud_url",
    "beatstars_url",
    "video_title",
    "video_url",
    "video_thumbnail_url",
    "onyour_title",
    "onyour_description",
    "onyour_url",
    "onyour_image_url"
  ];

  setFormValues(
    $("#profileForm"),
    Object.fromEntries(
      profileFields.map(
        (key) => [
          key,
          settings[key]
        ]
      )
    )
  );

  setFormValues(
    $("#mediaForm"),
    Object.fromEntries(
      mediaFields.map(
        (key) => [
          key,
          settings[key]
        ]
      )
    )
  );

  renderAllPreviews(
    settings
  );
}

function releaseCoverMarkup(release) {
  return release.cover_url
    ? `<img src="${release.cover_url}" alt="" />`
    : "NO COVER";
}

function renderReleaseList() {
  const container = $("#releaseAdminList");
  const releases = [...adminData.releases].sort((a, b) => {
    return Number(a.sort_order) - Number(b.sort_order);
  });

  if (!releases.length) {
    container.innerHTML = `<div class="empty-message">등록된 음원이 없습니다.</div>`;
    return;
  }

  container.innerHTML = releases
    .map(
      (release) => `
        <article class="release-admin-item">
          <div class="release-admin-cover">
            ${releaseCoverMarkup(release)}
          </div>

          <div class="release-admin-copy">
            <strong>${release.title || "Untitled"}</strong>
            <span>
              ${release.release_date || "날짜 없음"}
              ${Number(release.is_featured) === 1 ? " · FEATURED" : ""}
              ${Number(release.is_published) === 0 ? " · 비공개" : ""}
            </span>
          </div>

          <div class="release-admin-actions">
            <button type="button" data-edit-release="${release.id}">수정</button>
            <button
              class="delete-button"
              type="button"
              data-delete-release="${release.id}"
            >
              삭제
            </button>
          </div>
        </article>
      `
    )
    .join("");

  $$("[data-edit-release]", container).forEach((button) => {
    button.addEventListener("click", () => {
      editRelease(Number(button.dataset.editRelease));
    });
  });

  $$("[data-delete-release]", container).forEach((button) => {
    button.addEventListener("click", () => {
      deleteRelease(Number(button.dataset.deleteRelease));
    });
  });
}

function resetReleaseForm() {
  const form = $("#releaseForm");
  form.reset();
  form.elements.namedItem("id").value = "";
  form.elements.namedItem("is_published").checked = true;
  form.elements.namedItem("sort_order").value = "0";
  form.elements.namedItem("cover_url").value = "";
  $("#releaseFormTitle").textContent = "음원 추가";
  renderPreview("coverPreview", "");
}

function editRelease(id) {
  const release = adminData.releases.find((item) => Number(item.id) === id);
  if (!release) return;

  setFormValues($("#releaseForm"), release);
  $("#releaseFormTitle").textContent = "음원 수정";
  renderPreview("coverPreview", release.cover_url);

  activateTab("releases");
  $("#releaseForm").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

async function deleteRelease(id) {
  if (!window.confirm("이 음원을 삭제할까요?")) return;

  try {
    await api(`/api/admin/releases/${id}`, {
      method: "DELETE"
    });

    adminData.releases = adminData.releases.filter(
      (release) => Number(release.id) !== id
    );

    renderReleaseList();
    resetReleaseForm();
    showToast("음원을 삭제했습니다.");
  } catch (error) {
    showToast(error.message);
  }
}

async function uploadImage(file, folder) {
  if (!file) return "";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("folder", folder);

  const result = await api("/api/admin/upload", {
    method: "POST",
    body: formData
  });

  return result.url;
}

function bindUploadBoxes() {
  $$("[data-upload-box]").forEach((box) => {
    const fileInput = $("input[type='file']", box);
    const form = box.closest("form");
    const urlField = form.elements.namedItem(box.dataset.urlInput);
    const previewId = box.dataset.preview;
    const folder = box.dataset.folder;

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      box.classList.add("is-uploading");
      showToast("이미지를 업로드하고 있습니다.");

      try {
        const url = await uploadImage(file, folder);
        urlField.value = url;
        renderPreview(previewId, url);
        showToast("이미지 업로드가 완료되었습니다.");
      } catch (error) {
        showToast(error.message);
      } finally {
        box.classList.remove("is-uploading");
        fileInput.value = "";
      }
    });
  });
}

async function loadAdminData() {
  const [settingsResult, releasesResult] = await Promise.all([
    api("/api/admin/settings"),
    api("/api/admin/releases")
  ]);

  adminData.settings = settingsResult.settings || {};
  adminData.releases = releasesResult.releases || [];

  fillSettingsForms(adminData.settings);
  renderReleaseList();
}

async function saveSettings(form, fieldGroup) {
  const values = formToObject(form);
  const nextSettings = {
    ...adminData.settings,
    ...values
  };

  const result = await api("/api/admin/settings", {
    method: "PUT",
    body: JSON.stringify(nextSettings)
  });

  adminData.settings = result.settings;
  fillSettingsForms(adminData.settings);
  showToast(`${fieldGroup} 설정을 저장했습니다.`);
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        password: $("#passwordInput").value
      })
    });

    $("#passwordInput").value = "";
    setView(true);
    await loadAdminData();
    showToast("로그인했습니다.");
  } catch (error) {
    showToast(error.message);
  }
});

$("#logoutButton").addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", { method: "POST" });
  } finally {
    setView(false);
    showToast("로그아웃했습니다.");
  }
});

$("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await saveSettings(event.currentTarget, "프로필");
  } catch (error) {
    showToast(error.message);
  }
});

$("#mediaForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await saveSettings(event.currentTarget, "영상·링크");
  } catch (error) {
    showToast(error.message);
  }
});

$("#releaseForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const form = event.currentTarget;
  const values = formToObject(form);
  const id = values.id;

  values.is_featured = form.elements.namedItem("is_featured").checked ? 1 : 0;
  values.is_published = form.elements.namedItem("is_published").checked ? 1 : 0;
  values.sort_order = Number(values.sort_order || 0);

  try {
    const result = await api(
      id ? `/api/admin/releases/${id}` : "/api/admin/releases",
      {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(values)
      }
    );

    if (id) {
      adminData.releases = adminData.releases.map((release) =>
        Number(release.id) === Number(id) ? result.release : release
      );
    } else {
      adminData.releases.push(result.release);
    }

    if (Number(result.release.is_featured) === 1) {
      adminData.releases = adminData.releases.map((release) => ({
        ...release,
        is_featured:
          Number(release.id) === Number(result.release.id) ? 1 : 0
      }));
    }

    renderReleaseList();
    resetReleaseForm();
    showToast(id ? "음원을 수정했습니다." : "음원을 추가했습니다.");
  } catch (error) {
    showToast(error.message);
  }
});

$("#resetReleaseButton").addEventListener("click", resetReleaseForm);

$$(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    activateTab(button.dataset.tab);
  });
});

async function initialize() {
  bindUploadBoxes();

  try {
    await api("/api/admin/session");
    setView(true);
    await loadAdminData();
  } catch (error) {
    setView(false);
  }
}

initialize();
