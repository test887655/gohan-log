// つかいかた（チュートリアル）。「パスワードを変える」の右の「？」から開く。
// 中身はここに全部書いてある。説明を足す・直すときはこのファイルだけ直せばよい。
// 絵はアプリの本物の部品（キラキラ・プレゼント・冷蔵庫など）を小さく並べて作っている。
// 写真を用意しなくてよく、見た目（きせかえ）を変えても同じ色で描かれる。

import { setOtherPanel } from './points.js';

const icon = (id, cls = '') => `<svg class="help-icon ${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

// ミニ画面（スマホの画面をまねた枠）
const screen = (inner) => `<div class="help-screen">${inner}</div>`;
// ミニカード（ごはんの記録をまねたもの）
const card = ({ photo = true, tag = '食べ物', type = '朝', bad = false, label = '' }) => `
  <div class="help-card${bad ? ' bad' : ''}">
    <div class="help-card-photo${photo ? '' : ' none'}">${photo ? '📷' : '写真なし'}</div>
    <div class="help-card-body">
      <span class="help-type">${type}</span>
      <span class="help-tag">${tag}</span>
      ${label ? `<span class="help-card-label">${label}</span>` : ''}
    </div>
  </div>`;
const badge = (text, kind = 'ok') => `<span class="help-badge ${kind}">${text}</span>`;

const POINT_TOPICS = [
  {
    title: 'キラキラと星（1日3回）',
    icon: 'sparkle',
    figure: screen(`
      <div class="help-mini-header">ごはん記録 <span class="help-points">12 ${icon('gift')}</span></div>
      <div class="help-slots">
        <div><span>朝</span>5:00〜11:59</div>
        <div><span>昼</span>12:00〜16:59</div>
        <div><span>夜</span>17:00〜翌4:59</div>
      </div>
      <div class="help-sparkle-spot">${icon('sparkle', 'big')} ${badge('+3')}</div>
      <div class="help-days">
        <div>${icon('sparkle')}<small>1日目</small></div>
        <div>${icon('sparkle')}<small>2日目</small></div>
        <div class="star">${icon('star', 'big')}<small>3日目</small></div>
      </div>
      <div class="help-sparkle-spot">${icon('star', 'big')} ${badge('+13')}</div>
    `),
    body: `
      <p>1日に3回、<strong>朝・昼・夜</strong>の時間帯ごとに、ホーム画面のどこかにキラキラ（ダイヤ2つ）が出ます。押すと <strong>3ポイント</strong>。</p>
      <ul>
        <li>朝 5:00〜11:59 ／ 昼 12:00〜16:59 ／ 夜 17:00〜翌4:59</li>
        <li>出る場所は毎回ちがいます。画面をよく探してみてください</li>
        <li>その時間帯のうちに押さないと、そのぶんは消えます（あとから取れません）</li>
        <li>食材リストを開いているあいだは出ません。ホームに戻ると出ます</li>
        <li>貯まったポイントはタイトルの横（プレゼントの箱の左）に出ます</li>
      </ul>
      <p><strong>3日に1回</strong>、キラキラの代わりに<strong>星</strong>が出る日があります。押すと <strong>13ポイント</strong>（キラキラの3＋ボーナス10）。</p>
      <ul>
        <li>星の日は決まっていて、みんな同じ日です</li>
        <li>その日の朝・昼・夜のうち<strong>どれか1つ</strong>だけが星になります。どれになるかは日によって変わります</li>
        <li>星の時間帯を逃しても、ほかの時間帯はふつうのキラキラ（3ポイント）が出ます</li>
      </ul>`,
  },
  {
    title: '3食そろえてボーナス',
    icon: 'photo-icon',
    figure: screen(`
      ${card({ type: '朝' })}
      ${card({ type: '昼' })}
      ${card({ type: '夜' })}
      <div class="help-sparkle-spot">${badge('3食そろった！ +10')}</div>
    `),
    body: `
      <p>1日のうちに <strong>朝・昼・夜</strong> を3つとも記録すると <strong>10ポイント</strong>。1日1回だけです。</p>
      <p>数えるのは次の2つがそろった記録だけです。</p>
      <ul>
        <li><strong>写真つき</strong>であること</li>
        <li>ジャンルに<strong>「食べ物」</strong>が入っていること（「食べ物」＋「飲み物」のように組み合わせてもOK）</li>
      </ul>
      <ul>
        <li>入るのは<strong>今日と昨日</strong>のぶんだけ。夜ごはんを翌朝に付けても大丈夫です</li>
        <li>1日は朝5時に変わります。0:00〜4:59 の記録は前の日の夜として数えます</li>
        <li>3つめを記録した瞬間に「3食そろった！」と出て、ポイントが入ります</li>
      </ul>`,
  },
  {
    title: 'ポイントがつかない例',
    icon: 'photo-icon',
    figure: screen(`
      ${card({ type: '朝', photo: false, bad: true, label: '写真なし' })}
      ${card({ type: '昼', tag: '飲み物', bad: true, label: '飲み物だけ' })}
      ${card({ type: '間食', bad: true, label: '間食は数えない' })}
      <div class="help-sparkle-spot">${badge('ボーナスなし', 'ng')}</div>
    `),
    body: `
      <p>記録はできますが、3食ボーナスには<strong>数えません</strong>。</p>
      <ul>
        <li><strong>写真なし</strong>の記録（例：文字だけで「コーヒー」）</li>
        <li>ジャンルが<strong>「飲み物」だけ</strong>、<strong>「その他」だけ</strong>、または「飲み物」＋「その他」（「食べ物」が入っていない）</li>
        <li><strong>間食</strong>（朝・昼・夜の代わりにはなりません）</li>
        <li><strong>一昨日より前</strong>の日付で記録したもの（あとから過去を埋めても入りません）</li>
        <li>同じ区分を2回（朝を2つ記録しても、昼と夜がなければそろいません）</li>
      </ul>
      <p>キラキラも、その時間帯を過ぎたぶんは取れません。</p>`,
  },
];

const TOPICS = [
  // ポイントの話は多いので、1つにまとめて中で分ける
  { title: 'ポイントのもらい方', icon: 'sparkle', children: POINT_TOPICS },
  {
    title: 'プレゼントの作り方',
    icon: 'gift',
    figure: screen(`
      <div class="help-mini-header">ごはん記録 <span class="help-points tap">12 ${icon('gift')}</span></div>
      <div class="help-mini-sheet">
        <div class="help-sheet-title">プレゼント</div>
        <div class="help-sheet-sub">自分が用意するもの</div>
        <div class="help-gift-row">肩たたき券 <span>30pt</span></div>
        <div class="help-gift-row">好きなおかず1品 <span>50pt</span></div>
        <div class="help-btn">＋ プレゼントを作る</div>
      </div>
    `),
    body: `
      <p>プレゼントは<strong>贈る人が用意して、相手が選ぶ</strong>しくみです。</p>
      <ol>
        <li>タイトルの横のプレゼントの箱（ポイントの数字）を押す</li>
        <li>「＋ プレゼントを作る」を押す</li>
        <li><strong>内容</strong>（例：肩たたき券）と<strong>必要なポイント</strong>を書いて保存</li>
      </ol>
      <ul>
        <li>作ったものは「自分が用意するもの」に並び、相手の画面では「もらえるもの」に出ます</li>
        <li>相手が2人以上いる人は、ポップアップの中の相手の切り替えで「誰に向けたものか」を選んでから作ります</li>
        <li>自分が用意したものは、あとから直したり消したりできます</li>
      </ul>`,
  },
  {
    title: 'プレゼントの交換のしかた',
    icon: 'gift',
    figure: screen(`
      <div class="help-mini-sheet">
        <div class="help-sheet-title">プレゼント</div>
        <div class="help-sheet-sub">もらえるもの</div>
        <div class="help-gift-row theirs">肩たたき券 <span>30pt</span> <em>選ぶ</em></div>
        <div class="help-gift-row theirs">好きなおかず1品 <span>50pt</span> <em>選ぶ</em></div>
      </div>
      <div class="help-sparkle-spot">${badge('42pt → 12pt', 'ng')}</div>
    `),
    body: `
      <ol>
        <li>プレゼントの箱を押して開く</li>
        <li>「もらえるもの」の中から欲しいものの<strong>「選ぶ」</strong>を押す</li>
        <li>必要なポイントが<strong>自分のポイントから減ります</strong>（用意した人は減りません）</li>
      </ol>
      <ul>
        <li>ポイントが足りないものは選べません</li>
        <li>選ぶと、用意した人が次にアプリを開いたときに「◯◯さんが選びました」とお知らせが出ます</li>
        <li>あとは本人どうしで、約束を果たしてください</li>
      </ul>`,
  },
  {
    title: 'きせかえ（見た目を変える）',
    icon: 'flower',
    figure: screen(`
      <div class="help-toolbar">${icon('fridge')} ${icon('bubble')} <span class="help-chip on">きせかえ</span></div>
      <div class="help-themes">
        <span class="s">シンプル</span><span class="a">大人</span><span class="c">かわいい</span>
        <span class="q">水族館</span><span class="z">動物園</span><span class="d">ダーク</span>
      </div>
    `),
    body: `
      <ol>
        <li>冷蔵庫・吹き出しと同じ列の右はしにある<strong>「きせかえ」</strong>を押す</li>
        <li>下に出てくる6つ（シンプル・大人・かわいい・水族館・動物園・ダーク）から選ぶ</li>
      </ol>
      <ul>
        <li>色つきになっているのが今の見た目です</li>
        <li>選んだ見た目は<strong>その端末だけ</strong>に覚えます。相手の画面は変わりません</li>
        <li>水族館と動物園は、画面のふちやすきまに生き物の絵が出ます</li>
      </ul>`,
  },
  {
    title: '食材リストの使い方',
    icon: 'fridge',
    figure: screen(`
      <div class="help-toolbar">${icon('fridge', 'on')} ${icon('bubble')}</div>
      <div class="help-btn">＋ 食材を追加</div>
      <div class="help-ing-row"><b>たまご</b> <span class="near">9/24</span> <i>− 4 ＋</i> ${icon('bubble', 'sm')} ${icon('trash', 'sm')}</div>
      <div class="help-ing-row"><b>牛乳</b> <span>9/28</span> <i>− 1 ＋</i> ${icon('bubble', 'sm')} ${icon('trash', 'sm')}</div>
      <div class="help-ing-row"><b>玉ねぎ</b> <span></span> <i>− 3 ＋</i> ${icon('bubble', 'sm')} ${icon('trash', 'sm')}</div>
    `),
    body: `
      <p>家にある食材を書いておいて、使い忘れを減らすためのリストです。<strong>自分だけ</strong>が見られます。</p>
      <ol>
        <li>タイトルの下の<strong>冷蔵庫</strong>を押して開く</li>
        <li>「＋ 食材を追加」で、名前・数量・単位・賞味期限・保存場所（冷蔵/冷凍/常温）を入れて保存</li>
      </ol>
      <ul>
        <li>賞味期限が近い順に並びます。<strong>3日以内</strong>は色がついて目立ちます</li>
        <li>各行の <strong>−</strong> <strong>＋</strong> で、その場で数を増やしたり減らしたりできます</li>
        <li>名前を押すと直せます。ゴミ箱で消せます（使い切ったら消しましょう）</li>
        <li>吹き出しを押すと、その食材のことを相手に「そうだん」できます（次の項目）</li>
        <li>食材リストを開いているあいだは、キラキラは出ません</li>
      </ul>`,
  },
  {
    title: 'そうだんのしかた',
    icon: 'bubble',
    figure: screen(`
      <div class="help-toolbar">${icon('fridge')} <span class="help-dot-wrap">${icon('bubble', 'on')}<i class="help-dot"></i></span></div>
      <div class="help-chat me">たまご料理教えて！</div>
      <div class="help-chat you">オムレツはどう？ 🍳</div>
      <div class="help-stamps">👍 🙏 😋 🍳 💡 🤔</div>
    `),
    body: `
      <p>食材のことや料理のことを、相手に聞けます。やりとりは<strong>聞いた人と聞かれた人の2人だけ</strong>に見えます。</p>
      <ol>
        <li>食材リストの各行の<strong>吹き出し</strong>を押すと、「◯◯料理教えて！」と聞けます。下に一言足せます</li>
        <li>食材と関係ないことは、冷蔵庫の横の<strong>吹き出し</strong>で開く「そうだん」画面の「＋ 聞きたいことを書く」から</li>
        <li>返事はその場の欄から。スタンプ（👍🙏😋🍳💡🤔）は押すとすぐ送れます</li>
      </ol>
      <ul>
        <li>相手から新しい書き込みがあると、吹き出しに<strong>赤い丸</strong>が出ます。開くと消えます</li>
        <li>自分が始めたそうだんは、ゴミ箱でまとめて消せます（返事も一緒に消えます）</li>
        <li>相手が2人以上いる人は、そのとき選んでいる相手に届きます</li>
      </ul>`,
  },
  {
    title: 'ごはんの画面に戻る',
    icon: 'flower',
    figure: screen(`
      <div class="help-mini-header"><span class="tap-title">${icon('flower')} ごはん記録</span> <span class="help-points">12 ${icon('gift')}</span></div>
      <div class="help-arrow">↑ ここを押す</div>
      <div class="help-btn muted">食材リスト ／ そうだん ／ アルバム ／ お店 ／ お気に入り</div>
    `),
    body: `
      <p>食材リスト・そうだん・アルバム・お店・お気に入りなど、どの画面からでも、左上のタイトル<strong>「ごはん記録」</strong>を押せばごはんの画面に戻れます。</p>
      <ul>
        <li>画面ごとに「戻る」ボタンは置いていません。迷ったらタイトルを押してください</li>
        <li>プレゼントやこの説明のようなポップアップは、右上の「閉じる」で閉じます</li>
      </ul>`,
  },
  {
    title: 'ログアウトのしかた',
    icon: 'door',
    figure: screen(`
      <div class="help-mini-header">ごはん記録 <span class="help-door tap">${icon('door')}</span></div>
      <div class="help-arrow right">押す ↑</div>
      <div class="help-confirm">ログアウトしますか？<div><span>キャンセル</span><span class="ok">OK</span></div></div>
    `),
    body: `
      <ol>
        <li>右上の<strong>灰色の扉</strong>のマークを押す</li>
        <li>「ログアウトしますか？」と出るので OK を押す</li>
      </ol>
      <ul>
        <li>ふだんはログアウトしなくて大丈夫です。ログインしたままにしておけば、次に開いたときもそのまま使えます</li>
        <li>ログアウトすると、次はメールアドレスとパスワードを入れ直します</li>
        <li>パスワードは「◯◯さんとして記録中」の下の「パスワードを変える」から、自分で変えられます</li>
      </ul>`,
  },
];

const topicHtml = (t) => `
  <details class="help-topic">
    <summary>${icon(t.icon, 'head')}<span>${t.title}</span></summary>
    <div class="help-body">
      <figure class="help-fig">${t.figure}</figure>
      ${t.body}
    </div>
  </details>`;

const groupHtml = (g) => `
  <details class="help-topic help-group">
    <summary>${icon(g.icon, 'head')}<span>${g.title}</span></summary>
    <div class="help-group-list">
      ${g.children.map(topicHtml).join('')}
    </div>
  </details>`;

function render() {
  const list = document.getElementById('help-list');
  list.innerHTML = TOPICS.map((t) => (t.children ? groupHtml(t) : topicHtml(t))).join('');
}

const panel = document.getElementById('help-panel');

function openHelp() {
  if (!panel.dataset.ready) {
    render();
    panel.dataset.ready = 'yes';
  }
  // 開くたびに全部たたんで、いちばん上から
  panel.querySelectorAll('details').forEach((d) => { d.open = false; });
  panel.querySelector('.sheet').scrollTop = 0;
  panel.hidden = false;
  setOtherPanel(true);
}

function closeHelp() {
  panel.hidden = true;
  setOtherPanel(false);
}

document.getElementById('help-open').addEventListener('click', openHelp);
document.getElementById('help-close').addEventListener('click', closeHelp);
