// iPhoneへの通知（Web Push）。
// 「通知を受け取る」を押すと、この端末の宛先（endpoint と鍵）を push_subscriptions に登録する。
// 送るのは Supabase の Edge Function（supabase/functions/notify）。
// いいね・おいしそう・レシピが知りたい・そうだんの書き込みが入ったときに、相手の端末へ届く。
// iPhone はホーム画面に追加したアプリからでないと通知を受け取れない（iOS 16.4 以上）
import { supabase } from './supabase.js';
import { VAPID_PUBLIC_KEY } from './config.js';

const button = document.getElementById('push-open');

// iPhoneへの通知を受け取る人（表示名）。ほかの人にはボタンを出さない。
// 送る側（supabase/functions/notify）の PUSH_USERS と同じにしておく
const PUSH_USERS = ['eri'];

function supported() {
  return Boolean(VAPID_PUBLIC_KEY) && 'serviceWorker' in navigator
    && 'PushManager' in window && 'Notification' in window;
}

// 鍵は「URLで使える base64」の文字列で持っているので、ブラウザが受け取れる形に直す
function keyBytes(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function setLabel() {
  const on = supported() && Notification.permission === 'granted';
  button.textContent = on ? '通知オン' : '通知を受け取る';
  button.disabled = on;
}

async function subscribe() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(VAPID_PUBLIC_KEY),
    });

  const { endpoint, keys } = subscription.toJSON();
  // 同じ端末でログインし直した人に付け替えられるよう、endpoint で上書きする
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ endpoint, p256dh: keys.p256dh, auth: keys.auth }, { onConflict: 'endpoint' });
  if (error) throw error;
}

button?.addEventListener('click', async () => {
  if (!supported()) {
    alert('この画面では通知を受け取れません。iPhoneでは、Safariの「ホーム画面に追加」から開いたアプリで押してください（iOS 16.4 以上）。');
    return;
  }
  // iPhone は、ボタンを押したその場でしか許可を聞けない
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    alert('通知が許可されませんでした。あとで変えるときは、iPhoneの「設定」→「通知」→「ごはん記録」から。');
    setLabel();
    return;
  }
  try {
    await subscribe();
    alert('通知を受け取れるようになりました。');
  } catch (error) {
    console.error(error);
    alert('登録できませんでした。通信を確認して、もう一度押してください。');
  }
  setLabel();
});

// ログインしたときに呼ぶ。許可済みの端末は宛先を登録し直しておく（宛先が変わることがあるため）
export async function refreshPush(myName) {
  if (!button) return;
  const allowed = PUSH_USERS.includes(myName ?? '');
  button.hidden = !supported() || !allowed;
  if (!supported()) return;
  if (!allowed) {
    // 前に登録していた端末も、宛先から外しておく
    await forgetPush();
    return;
  }
  setLabel();
  if (Notification.permission !== 'granted') return;
  try {
    await subscribe();
  } catch (error) { console.error(error); }
}

// ログアウトの前に呼ぶ。この端末には、もうその人の通知を送らない
export async function forgetPush() {
  if (!supported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  } catch (error) { console.error(error); }
}
