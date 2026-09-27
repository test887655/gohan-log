// Supabaseの接続情報
// この2つは公開されてよい値です（データはRLSで守られています）
export const SUPABASE_URL = 'https://atvrunfaltnkbwhtpoue.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_0H5BpDJyq9IMevrr33Kn5g_apkT9MXN';
// iPhoneへの通知（Web Push）の公開鍵。これも公開されてよい。対になる秘密鍵は Supabase の Edge Function の Secrets にだけ置く
export const VAPID_PUBLIC_KEY = 'BCXC4Edzg0GBCs448zelqDaAyY5m9uu9Nx76NesSiJnCmSjp22PCogxe2gkOyzKu_nhWsEY1EalkaOpGkUbSwLE';
