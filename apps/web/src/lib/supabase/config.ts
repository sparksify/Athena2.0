// Public Supabase coordinates (the publishable key is safe to expose by
// design; RLS + auth gate all data). Env vars override for other projects.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://baaddaravxmnevmovpad.supabase.co";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "sb_publishable_-1MBd5Ra10V5fNoNZKHihQ_LoYMRIqY";
