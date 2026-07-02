import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_BUCKET,
  SUPABASE_TABLE,
} from "./supabase-config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const BUCKET = SUPABASE_BUCKET;
export const TABLE = SUPABASE_TABLE;

export function isSupabaseConfigured() {
  return (
    !!SUPABASE_URL &&
    !SUPABASE_URL.includes("TU-PROYECTO") &&
    !!SUPABASE_ANON_KEY &&
    !SUPABASE_ANON_KEY.includes("TU-CLAVE")
  );
}
