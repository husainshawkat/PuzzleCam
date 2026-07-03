// ============================================================
// SUPABASE CLIENT + DATA LAYER
// Replace SUPABASE_URL / SUPABASE_ANON_KEY with your project values.
// NEVER put the service_role key in client code.
// ============================================================

const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

const BUCKET = 'media';

// ---------- AUTH ----------

export async function ensureAnonSession() {
  const { data } = await supabase.auth.getSession();
  if (data?.session) return data.session;
  const { data: signInData, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return signInData.session;
}

export async function adminSignIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) {
    await supabase.auth.signOut();
    throw new Error('This account does not have admin access.');
  }
  return data.session;
}

export async function adminSignOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

export async function isCurrentUserAdmin() {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return false;
  const { data, error } = await supabase.from('admins').select('user_id').eq('user_id', uid).maybeSingle();
  if (error) return false;
  return !!data;
}

export function onAuthChange(cb) {
  supabase.auth.onAuthStateChange((_event, session) => cb(session));
}

// ---------- UPLOADS ----------

export async function uploadCapture({ blob, fileType, ext }) {
  const session = await ensureAnonSession();
  const uid = session.user.id;
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `${uid}/${filename}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type,
    upsert: false
  });
  if (upErr) throw upErr;

  const { error: dbErr } = await supabase.from('uploads').insert({
    user_id: uid,
    file_path: path,
    file_name: filename,
    file_type: fileType,
    file_size: blob.size
  });
  if (dbErr) throw dbErr;

  return path;
}

export async function getSignedUrl(path, expiresIn = 3600) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export async function listMyUploads() {
  const { data, error } = await supabase.from('uploads').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function deleteUpload(row) {
  await supabase.storage.from(BUCKET).remove([row.file_path]);
  const { error } = await supabase.from('uploads').delete().eq('id', row.id);
  if (error) throw error;
}

// ---------- ADMIN QUERIES ----------

export async function adminListUploads({ search = '', page = 0, pageSize = 20 } = {}) {
  let query = supabase.from('uploads').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  if (search) query = query.ilike('file_name', `%${search}%`);
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await query.range(from, to);
  if (error) throw error;
  return { rows: data, total: count ?? 0 };
}

export async function adminStats() {
  const { data, error } = await supabase.from('uploads').select('file_type, file_size');
  if (error) throw error;
  const images = data.filter(r => r.file_type === 'image').length;
  const videos = data.filter(r => r.file_type === 'video').length;
  const storage = data.reduce((sum, r) => sum + (r.file_size || 0), 0);
  return { images, videos, storage, total: data.length };
}

export { BUCKET };
