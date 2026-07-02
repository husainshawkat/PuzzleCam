import { supabase, BUCKET, TABLE, isSupabaseConfigured } from "./supabaseClient.js";

const loginScreen = document.getElementById("loginScreen");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");
const adminEmailLabel = document.getElementById("adminEmailLabel");
const photoGrid = document.getElementById("photoGrid");
const emptyState = document.getElementById("emptyState");
const totalCount = document.getElementById("totalCount");
const refreshBtn = document.getElementById("refreshBtn");

let realtimeChannel = null;

function showLogin() {
  loginScreen.classList.remove("hidden");
  dashboard.classList.add("hidden");
}

function showDashboard() {
  loginScreen.classList.add("hidden");
  dashboard.classList.remove("hidden");
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  loginError.textContent = "";

  const formData = new FormData(loginForm);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  const submitBtn = loginForm.querySelector(".primary-btn");
  submitBtn.disabled = true;
  submitBtn.textContent = "logging in…";

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  submitBtn.disabled = false;
  submitBtn.textContent = "log in";

  if (error) {
    loginError.textContent = "invalid credentials or unauthorized account.";
    return;
  }

  onAuthenticated(data.session);
}

async function handleLogout() {
  await supabase.auth.signOut();
  teardownRealtime();
  loginForm.reset();
  showLogin();
}

function onAuthenticated(session) {
  adminEmailLabel.textContent = session.user.email;
  showDashboard();
  loadCaptures();
  setupRealtime();
}

function renderCaptures(rows) {
  photoGrid.innerHTML = "";
  totalCount.textContent = String(rows.length);
  emptyState.classList.toggle("hidden", rows.length > 0);

  for (const row of rows) {
    const card = document.createElement("div");
    card.className = "photo-card";

    const img = document.createElement("img");
    img.src = row.image_url;
    img.alt = `capture from ${formatDate(row.created_at)}`;
    img.loading = "lazy";

    const meta = document.createElement("div");
    meta.className = "photo-meta";

    const dateSpan = document.createElement("span");
    dateSpan.textContent = formatDate(row.created_at);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "photo-delete";
    delBtn.textContent = "delete";
    delBtn.addEventListener("click", () => deleteCapture(row));

    meta.appendChild(dateSpan);
    meta.appendChild(delBtn);
    card.appendChild(img);
    card.appendChild(meta);
    photoGrid.appendChild(card);
  }
}

async function loadCaptures() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[Admin] Error loading captures:", error);
    return;
  }
  renderCaptures(data || []);
}

async function deleteCapture(row) {
  const confirmed = window.confirm("Delete this capture permanently? This action cannot be undone.");
  if (!confirmed) return;

  const { error: storageError } = await supabase.storage.from(BUCKET).remove([row.storage_path]);
  if (storageError) {
    console.warn("[Admin] Could not delete the file from the bucket:", storageError);
  }

  const { error: dbError } = await supabase.from(TABLE).delete().eq("id", row.id);
  if (dbError) {
    console.error("[Admin] Could not delete the row:", dbError);
    window.alert("Could not delete the capture. Check the console for more details.");
    return;
  }

  loadCaptures();
}

function setupRealtime() {
  teardownRealtime();
  realtimeChannel = supabase
    .channel("captures-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, () => {
      loadCaptures();
    })
    .subscribe();
}

function teardownRealtime() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

async function init() {
  if (!isSupabaseConfigured()) {
    loginError.textContent =
      "Supabase is not configured yet. Fill in js/supabase-config.js.";
    return;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    onAuthenticated(session);
  } else {
    showLogin();
  }

  supabase.auth.onAuthStateChange((_event, newSession) => {
    if (!newSession) {
      teardownRealtime();
      showLogin();
    }
  });
}

loginForm.addEventListener("submit", handleLogin);
logoutBtn.addEventListener("click", handleLogout);
refreshBtn.addEventListener("click", loadCaptures);

init();
