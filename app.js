import { supabase } from './supabase.js';
import { shrinkImage } from './image.js';

const BUCKET = 'meal-photos';
const MEAL_LABELS = { breakfast: '朝', lunch: '昼', dinner: '夜', snack: '間食' };
const SIGNED_URL_SECONDS = 60 * 60;

const $ = (id) => document.getElementById(id);

const loginScreen = $('screen-login');
const appScreen = $('screen-app');
const loginForm = $('login-form');
const loginButton = $('login-button');
const loginError = $('login-error');
const passwordInput = $('password');

const openFormButton = $('open-form-button');
const mealForm = $('meal-form');
const mealFormTitle = $('meal-form-title');
const photoInput = $('photo');
const photoPreview = $('photo-preview');
const photoHint = $('photo-hint');
const eatenAtInput = $('eaten-at');
const noteInput = $('note');
const saveButton = $('save-button');
const formError = $('form-error');
const timeline = $('timeline');
const timelineStatus = $('timeline-status');

let currentUser = null;
let displayNames = new Map();
let editingMeal = null;

// ---------- 表示用のヘルパー ----------

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
});

function toInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = false;
}

// ホーム画面に追加して使えるようにする（PWA）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((error) => console.error(error));
}

// ---------- ログイン ----------

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  loginButton.disabled = true;
  loginButton.textContent = 'ログイン中…';

  const { error } = await supabase.auth.signInWithPassword({
    email: $('email').value.trim(),
    password: passwordInput.value,
  });

  loginButton.disabled = false;
  loginButton.textContent = 'ログイン';

  if (error) {
    showError(loginError, 'ログインできませんでした。メールアドレスとパスワードを確認してください。');
    console.error(error);
  }
});

$('logout-button').addEventListener('click', () => supabase.auth.signOut());

supabase.auth.onAuthStateChange((_event, session) => {
  // コールバック内で直接awaitすると固まることがあるため、処理を外に出す
  setTimeout(() => handleSession(session), 0);
});

// 画面に戻ってきたら、切れかけのログインと期限つき写真URLを作り直す。
// これがないと、開きっぱなしのまま1時間経ったときに
// 「写真が出ない」「削除や編集が黙って失敗する」が起きる。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentUser) refreshSession();
});

async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  await handleSession(data.session);
}

async function handleSession(session) {
  if (!session) {
    currentUser = null;
    appScreen.hidden = true;
    loginScreen.hidden = false;
    passwordInput.value = '';
    timeline.replaceChildren();
    return;
  }

  currentUser = session.user;
  loginScreen.hidden = true;
  appScreen.hidden = false;

  const { data, error } = await supabase.from('profiles').select('id, display_name');
  if (error) console.error(error);
  displayNames = new Map((data ?? []).map((row) => [row.id, row.display_name]));

  const myName = displayNames.get(currentUser.id) ?? currentUser.email;
  $('greeting').textContent = `${myName} さんとして記録中`;

  await loadTimeline();
}

// ---------- 投稿フォーム ----------

openFormButton.addEventListener('click', () => openForm(null));
$('cancel-button').addEventListener('click', closeForm);

function openForm(meal) {
  editingMeal = meal;
  mealForm.reset();
  formError.hidden = true;
  photoPreview.hidden = true;
  photoHint.hidden = true;

  if (meal) {
    mealFormTitle.textContent = '記録を編集';
    photoHint.textContent = meal.photo_path
      ? '写真を選ばなければ、今の写真のままになります。'
      : '写真なしの記録です。ここで追加できます。';
    photoHint.hidden = false;
    mealForm.querySelector('input[value="' + meal.meal_type + '"]').checked = true;
    eatenAtInput.value = toInputValue(new Date(meal.eaten_at));
    noteInput.value = meal.note ?? '';
  } else {
    mealFormTitle.textContent = '食事を記録';
    photoHint.textContent = '写真なしでも記録できます。';
    photoHint.hidden = false;
    eatenAtInput.value = toInputValue(new Date());
  }

  mealForm.hidden = false;
  openFormButton.hidden = true;
  mealForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeForm() {
  editingMeal = null;
  mealForm.hidden = true;
  openFormButton.hidden = false;
  photoPreview.hidden = true;
}

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) {
    photoPreview.hidden = true;
    return;
  }
  photoPreview.src = URL.createObjectURL(file);
  photoPreview.hidden = false;
});

mealForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.hidden = true;
  saveButton.disabled = true;
  saveButton.textContent = '保存中…';

  try {
    const file = photoInput.files[0];
    let photoPath = editingMeal?.photo_path ?? null;

    if (file) {
      const blob = await shrinkImage(file);
      const path = `${currentUser.id}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg' });
      if (error) throw error;
      photoPath = path;
    }

    const values = {
      photo_path: photoPath,
      note: noteInput.value.trim() || null,
      eaten_at: new Date(eatenAtInput.value).toISOString(),
      meal_type: mealForm.elements.meal_type.value,
    };

    if (editingMeal) {
      const oldPath = editingMeal.photo_path;
      // .select() を付けて、実際に何件更新されたかを確認する。
      // RLSは権限がない場合もログインが切れている場合もエラーを返さず0件を返すため、
      // これがないと失敗に気づけない。
      const { data, error } = await supabase.from('meals').update(values).eq('id', editingMeal.id).select();
      if (error) throw error;
      if (data.length === 0) throw new Error('ログインの有効期限が切れている可能性があります。ログインし直してください。');
      // 写真を差し替えたときは、古い写真を消して容量を節約する
      if (file && oldPath && oldPath !== photoPath) {
        await supabase.storage.from(BUCKET).remove([oldPath]);
      }
    } else {
      const { error } = await supabase.from('meals').insert(values);
      if (error) throw error;
    }

    closeForm();
    await loadTimeline();
  } catch (error) {
    console.error(error);
    showError(formError, `保存できませんでした：${error.message ?? error}`);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = '保存';
  }
});

// ---------- タイムライン ----------

async function loadTimeline() {
  timelineStatus.textContent = '読み込み中…';
  timelineStatus.hidden = false;

  // 期限が切れていればここでトークンが更新される
  await supabase.auth.getSession();

  const { data: meals, error } = await supabase
    .from('meals')
    .select('*')
    .order('eaten_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error(error);
    timelineStatus.textContent = '読み込めませんでした。';
    return;
  }

  if (meals.length === 0) {
    timeline.replaceChildren();
    timelineStatus.textContent = 'まだ記録がありません。「＋ 記録する」から始めましょう。';
    return;
  }

  // 非公開バケットなので、表示には期限つきのURLを発行する。写真なしの記録は対象外。
  const paths = meals.map((meal) => meal.photo_path).filter(Boolean);
  let urls = new Map();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(paths, SIGNED_URL_SECONDS);
    urls = new Map((signed ?? []).map((item) => [item.path, item.signedUrl]));
  }

  timelineStatus.hidden = true;
  timeline.replaceChildren(...meals.map((meal) => renderMeal(meal, urls.get(meal.photo_path))));
}

function renderMeal(meal, photoUrl) {
  const card = document.createElement('article');
  card.className = 'card';

  if (meal.photo_path) {
    const image = document.createElement('img');
    image.className = 'photo';
    image.loading = 'lazy';
    image.alt = meal.note || '食事の写真';
    if (photoUrl) image.src = photoUrl;
    card.append(image);
  } else {
    card.classList.add('no-photo');
  }

  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = `${displayNames.get(meal.user_id) ?? '不明'}・`
    + `${MEAL_LABELS[meal.meal_type]}・${dateFormatter.format(new Date(meal.eaten_at))}`;
  card.append(meta);

  if (meal.note) {
    const note = document.createElement('p');
    note.className = 'note-text';
    note.textContent = meal.note;
    card.append(note);
  }

  if (meal.user_id === currentUser.id) {
    const actions = document.createElement('div');
    actions.className = 'row';

    const editButton = document.createElement('button');
    editButton.className = 'link';
    editButton.textContent = '編集';
    editButton.addEventListener('click', () => openForm(meal));

    const deleteButton = document.createElement('button');
    deleteButton.className = 'link danger';
    deleteButton.textContent = '削除';
    deleteButton.addEventListener('click', () => deleteMeal(meal));

    actions.append(editButton, deleteButton);
    card.append(actions);
  }

  return card;
}

async function deleteMeal(meal) {
  if (!confirm('この記録を削除しますか？')) return;

  // 更新と同じ理由で .select() を付け、0件だったら失敗として扱う
  const { data, error } = await supabase.from('meals').delete().eq('id', meal.id).select();

  if (error) {
    console.error(error);
    alert(`削除できませんでした：${error.message}`);
    return;
  }

  if (data.length === 0) {
    alert('削除できませんでした。ログインの有効期限が切れている可能性があります。もう一度お試しください。');
    await refreshSession();
    return;
  }

  if (meal.photo_path) {
    await supabase.storage.from(BUCKET).remove([meal.photo_path]);
  }
  await loadTimeline();
}
