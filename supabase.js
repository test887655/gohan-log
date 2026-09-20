import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// ログインは端末に覚えておき、期限が切れる前に自動で延ばす。
// （どちらも既定でそうなっているが、消えると困るところなので書いておく）
// storageKey は既定のままにすること。変えると、今覚えているぶんが読めなくなって
// 全員ログインし直しになる
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
