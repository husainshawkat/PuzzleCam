import { adminSignIn, adminSignOut, getSession, isCurrentUserAdmin, adminListUploads, adminStats, deleteUpload, getSignedUrl, onAuthChange } from './supabase.js';

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('error', isError);
  toastEl.classList.add('glass', 'show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

let page = 0;
const pageSize = 12;
let searchTerm = '';

async function boot() {
  const session = await getSession();
  if (session && await isCurrentUserAdmin()) {
    showDashboard();
  } else {
    showLogin();
  }
}
boot();

function showLogin() {
  loginView.classList.remove('hidden');
  dashboardView.classList.add('hidden');
}
async function showDashboard() {
  loginView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  await Promise.all([loadStats(), loadTable()]);
}

/* ---------- LOGIN ---------- */
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    await adminSignIn(document.getElementById('email').value.trim(), document.getElementById('password').value);
    await showDashboard();
  } catch (err) {
    errEl.textContent = err.message || 'Invalid credentials.';
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In';
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await adminSignOut();
  showLogin();
});

/* ---------- STATS ---------- */
async function loadStats() {
  try {
    const { images, videos, storage, total } = await adminStats();
    document.getElementById('stat-images').textContent = images;
    document.getElementById('stat-videos').textContent = videos;
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-storage').textContent = formatBytes(storage);
  } catch (e) { toast('Failed to load stats', true); }
}
function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/* ---------- TABLE ---------- */
async function loadTable() {
  const tbody = document.getElementById('uploads-tbody');
  const emptyState = document.getElementById('empty-state');
  tbody.innerHTML = '';
  try {
    const { rows, total } = await adminListUploads({ search: searchTerm, page, pageSize });
    emptyState.classList.toggle('hidden', rows.length > 0);
    document.getElementById('page-label').textContent = `Page ${page + 1} of ${Math.max(1, Math.ceil(total / pageSize))}`;
    document.getElementById('prev-page').disabled = page === 0;
    document.getElementById('next-page').disabled = (page + 1) * pageSize >= total;

    for (const row of rows) {
      const tr = document.createElement('tr');
      const signedUrl = await getSignedUrl(row.file_path, 600).catch(() => '');
      tr.innerHTML = `
        <td>${row.file_type === 'image'
          ? `<img class="row-thumb" src="${signedUrl}" loading="lazy" alt="">`
          : `<video class="row-thumb" src="${signedUrl}" muted></video>`}</td>
        <td>${escapeHtml(row.file_name)}</td>
        <td><span class="type-badge ${row.file_type}">${row.file_type}</span></td>
        <td>${formatBytes(row.file_size)}</td>
        <td title="${row.user_id}">${row.user_id.slice(0, 8)}…</td>
        <td>${new Date(row.created_at).toLocaleString()}</td>
        <td class="row-actions">
          <button data-action="preview" title="Preview">👁</button>
          <button data-action="download" title="Download">⬇</button>
          <button data-action="delete" class="danger" title="Delete">✕</button>
        </td>`;
      tr.querySelector('[data-action="preview"]').addEventListener('click', () => openPreview(signedUrl, row.file_type));
      tr.querySelector('[data-action="download"]').addEventListener('click', () => downloadFile(signedUrl, row.file_name));
      tr.querySelector('[data-action="delete"]').addEventListener('click', () => handleDelete(row));
      tbody.appendChild(tr);
    }
  } catch (e) {
    toast('Failed to load uploads', true);
  }
}
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

document.getElementById('search-btn').addEventListener('click', () => {
  searchTerm = document.getElementById('search-input').value.trim();
  page = 0;
  loadTable();
});
document.getElementById('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('search-btn').click();
});
document.getElementById('refresh-btn').addEventListener('click', () => { loadStats(); loadTable(); });
document.getElementById('prev-page').addEventListener('click', () => { if (page > 0) { page--; loadTable(); } });
document.getElementById('next-page').addEventListener('click', () => { page++; loadTable(); });

async function handleDelete(row) {
  if (!confirm(`Delete "${row.file_name}"? This cannot be undone.`)) return;
  try {
    await deleteUpload(row);
    toast('File deleted');
    loadStats(); loadTable();
  } catch (e) { toast('Delete failed', true); }
}
function downloadFile(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.target = '_blank';
  a.click();
}

/* ---------- PREVIEW MODAL ---------- */
const previewModal = document.getElementById('preview-modal');
function openPreview(url, type) {
  const wrap = document.getElementById('preview-media-wrap');
  wrap.innerHTML = '';
  const el = document.createElement(type === 'image' ? 'img' : 'video');
  el.src = url;
  if (type === 'video') { el.controls = true; el.autoplay = true; }
  wrap.appendChild(el);
  document.getElementById('modal-download').href = url;
  previewModal.classList.remove('hidden');
}
document.getElementById('modal-close').addEventListener('click', () => previewModal.classList.add('hidden'));

onAuthChange((session) => { if (!session) showLogin(); });
