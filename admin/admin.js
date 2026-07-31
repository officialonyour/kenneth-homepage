"use strict";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

let adminData = { settings: {}, releases: [], videos: [] };
let toastTimer = null;

function showToast(message) {
  const toast = $("#adminToast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const init = {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(options.headers || {}) },
    ...options
  };
  const response = await fetch(path, init);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : { message: await response.text() };

  if (!response.ok) {
    const error = new Error(payload.message || `요청 실패 (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

function formToObject(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  $$('input[type="checkbox"]', form).forEach((input) => {
    data[input.name] = input.checked ? 1 : 0;
  });
  return data;
}

function fillForm(form, values = {}) {
  [...form.elements].forEach((field) => {
    if (!field.name) return;
    const value = values[field.name] ?? "";
    if (field.type === "checkbox") field.checked = Number(value) === 1 || value === true;
    else field.value = value;
  });
}

function openAdmin() {
  $("#loginScreen").hidden = true;
  $("#adminApp").hidden = false;
}

function openLogin() {
  $("#adminApp").hidden = true;
  $("#loginScreen").hidden = false;
}

async function initialize() {
  try {
    await loadAdminData();
    openAdmin();
  } catch (error) {
    if (error.status === 401) openLogin();
    else {
      openLogin();
      $("#loginMessage").textContent = error.message;
    }
  }
}

async function loadAdminData() {
  adminData = await api("/api/admin/data");
  renderAll();
}

function renderAll() {
  fillForm($("#settingsForm"), adminData.settings);
  renderReleaseList();
  renderVideoList();
}

function activatePanel(id) {
  $$(".admin-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.panel === id));
  $$(".admin-panel").forEach((panel) => {
    const active = panel.id === id;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
}

function renderReleaseList() {
  const list = $("#releaseList");
  const releases = [...adminData.releases].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  if (!releases.length) {
    list.innerHTML = `<div class="manage-item"><div class="manage-item-copy"><strong>등록된 음원이 없습니다.</strong><span>새 음원을 추가해 주세요.</span></div></div>`;
    return;
  }

  list.innerHTML = releases.map((release) => `
    <article class="manage-item">
      <img src="${escapeHtml(release.cover_url || "/assets/profile-logo.png")}" alt="" />
      <div class="manage-item-copy">
        <strong>${escapeHtml(release.title)}</strong>
        <span>${escapeHtml(release.release_type || "RELEASE")} · ${escapeHtml(release.release_date || "날짜 없음")}${Number(release.is_featured) ? " · 대표" : ""}</span>
      </div>
      <div class="manage-item-actions">
        <button type="button" data-edit-release="${Number(release.id)}">수정</button>
        <button class="delete" type="button" data-delete-release="${Number(release.id)}">삭제</button>
      </div>
    </article>
  `).join("");

  $$('[data-edit-release]', list).forEach((button) => {
    button.addEventListener("click", () => editRelease(Number(button.dataset.editRelease)));
  });
  $$('[data-delete-release]', list).forEach((button) => {
    button.addEventListener("click", () => deleteRelease(Number(button.dataset.deleteRelease)));
  });
}

function renderVideoList() {
  const list = $("#videoList");
  const videos = [...adminData.videos].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  if (!videos.length) {
    list.innerHTML = `<div class="manage-item"><div class="manage-item-copy"><strong>등록된 영상이 없습니다.</strong><span>YouTube 링크를 추가해 주세요.</span></div></div>`;
    return;
  }

  list.innerHTML = videos.map((video) => `
    <article class="manage-item">
      <img src="${escapeHtml(video.thumbnail_url || "/assets/profile-logo.png")}" alt="" />
      <div class="manage-item-copy">
        <strong>${escapeHtml(video.title)}</strong>
        <span>${escapeHtml(video.published_at || "날짜 없음")}${Number(video.is_featured) ? " · 대표" : ""}</span>
      </div>
      <div class="manage-item-actions">
        <button type="button" data-edit-video="${Number(video.id)}">수정</button>
        <button class="delete" type="button" data-delete-video="${Number(video.id)}">삭제</button>
      </div>
    </article>
  `).join("");

  $$('[data-edit-video]', list).forEach((button) => {
    button.addEventListener("click", () => editVideo(Number(button.dataset.editVideo)));
  });
  $$('[data-delete-video]', list).forEach((button) => {
    button.addEventListener("click", () => deleteVideo(Number(button.dataset.deleteVideo)));
  });
}

function resetReleaseForm() {
  const form = $("#releaseForm");
  form.reset();
  fillForm(form, {
    id: "",
    release_type: "Single",
    track_count: 1,
    sort_order: adminData.releases.length + 1,
    is_featured: 0,
    cover_url: ""
  });
  $("#releaseCoverPreview").src = "/assets/profile-logo.png";
  $("#releaseFormTitle").textContent = "새 음원";
  $("#uploadStatus").textContent = "";
  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function editRelease(id) {
  const release = adminData.releases.find((item) => Number(item.id) === id);
  if (!release) return;
  const form = $("#releaseForm");
  fillForm(form, release);
  $("#releaseCoverPreview").src = release.cover_url || "/assets/profile-logo.png";
  $("#releaseFormTitle").textContent = `음원 수정 · ${release.title}`;
  $("#uploadStatus").textContent = "";
  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteRelease(id) {
  const release = adminData.releases.find((item) => Number(item.id) === id);
  if (!release || !confirm(`‘${release.title}’ 음원을 삭제할까요?`)) return;
  try {
    await api(`/api/admin/releases/${id}`, { method: "DELETE" });
    showToast("음원이 삭제되었습니다.");
    await loadAdminData();
  } catch (error) {
    showToast(error.message);
  }
}

function resetVideoForm() {
  const form = $("#videoForm");
  form.reset();
  fillForm(form, { id: "", sort_order: adminData.videos.length + 1, is_featured: 1 });
  $("#videoFormTitle").textContent = "새 영상";
  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function editVideo(id) {
  const video = adminData.videos.find((item) => Number(item.id) === id);
  if (!video) return;
  const form = $("#videoForm");
  fillForm(form, video);
  $("#videoFormTitle").textContent = `영상 수정 · ${video.title}`;
  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteVideo(id) {
  const video = adminData.videos.find((item) => Number(item.id) === id);
  if (!video || !confirm(`‘${video.title}’ 영상을 삭제할까요?`)) return;
  try {
    await api(`/api/admin/videos/${id}`, { method: "DELETE" });
    showToast("영상이 삭제되었습니다.");
    await loadAdminData();
  } catch (error) {
    showToast(error.message);
  }
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  const password = $("#adminPassword").value;
  button.disabled = true;
  $("#loginMessage").textContent = "";
  try {
    await api("/api/login", jsonOptions("POST", { password }));
    $("#adminPassword").value = "";
    await loadAdminData();
    openAdmin();
    showToast("관리자 로그인이 완료되었습니다.");
  } catch (error) {
    $("#loginMessage").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#logoutButton").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  openLogin();
});

$$(".admin-tab").forEach((button) => {
  button.addEventListener("click", () => activatePanel(button.dataset.panel));
});

$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const result = await api("/api/admin/settings", jsonOptions("POST", formToObject(event.currentTarget)));
    adminData.settings = result.settings;
    fillForm(event.currentTarget, result.settings);
    showToast("홈페이지 기본 정보가 저장되었습니다.");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

$("#newReleaseButton").addEventListener("click", resetReleaseForm);
$("#closeReleaseForm").addEventListener("click", () => $("#releaseForm").hidden = true);

$("#releaseForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = formToObject(form);
  data.track_count = Number(data.track_count || 1);
  data.sort_order = Number(data.sort_order || 0);
  const id = Number(data.id || 0);
  delete data.id;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    if (id) await api(`/api/admin/releases/${id}`, jsonOptions("PUT", data));
    else await api("/api/admin/releases", jsonOptions("POST", data));
    showToast(id ? "음원이 수정되었습니다." : "새 음원이 추가되었습니다.");
    form.hidden = true;
    await loadAdminData();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

$("#previewLinkButton").addEventListener("click", async () => {
  const form = $("#releaseForm");
  const url = form.elements.primary_url.value.trim();
  if (!url) {
    showToast("먼저 앨범 대표 링크를 입력해 주세요.");
    return;
  }
  const button = $("#previewLinkButton");
  button.disabled = true;
  button.textContent = "가져오는 중...";
  try {
    const preview = await api("/api/admin/link-preview", jsonOptions("POST", { url }));
    if (preview.title && !form.elements.title.value.trim()) form.elements.title.value = preview.title;
    if (preview.image) {
      form.elements.cover_url.value = preview.image;
      $("#releaseCoverPreview").src = preview.image;
    }
    showToast(preview.image ? "링크에서 앨범 정보를 가져왔습니다." : "제목은 확인했지만 자켓 이미지는 찾지 못했습니다.");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "링크에서 제목·자켓 가져오기";
  }
});

$("#releaseCoverFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const status = $("#uploadStatus");
  status.textContent = "R2에 업로드 중...";
  try {
    const formData = new FormData();
    formData.append("file", file);
    const result = await api("/api/admin/upload", { method: "POST", body: formData });
    $("#releaseForm").elements.cover_url.value = result.url;
    $("#releaseCoverPreview").src = result.url;
    status.textContent = "업로드 완료";
    showToast("앨범 자켓이 R2에 업로드되었습니다.");
  } catch (error) {
    status.textContent = "업로드 실패";
    showToast(error.message);
  } finally {
    event.target.value = "";
  }
});

$("#newVideoButton").addEventListener("click", resetVideoForm);
$("#closeVideoForm").addEventListener("click", () => $("#videoForm").hidden = true);

$("#videoForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = formToObject(form);
  data.sort_order = Number(data.sort_order || 0);
  const id = Number(data.id || 0);
  delete data.id;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    if (id) await api(`/api/admin/videos/${id}`, jsonOptions("PUT", data));
    else await api("/api/admin/videos", jsonOptions("POST", data));
    showToast(id ? "영상이 수정되었습니다." : "새 영상이 추가되었습니다.");
    form.hidden = true;
    await loadAdminData();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

initialize();
