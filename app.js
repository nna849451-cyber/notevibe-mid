// ==========================================
// NoteVibe - GitHub Pages完結 オンラインMIDI共有アプリ
// ==========================================

// 1. オンライン必須チェック（ネットワーク切断時は操作不可）
function checkOnlineStatus() {
  const overlay = document.getElementById('offline-overlay');
  if (!navigator.onLine) {
    overlay.classList.remove('hidden');
    stopPlayback();
    return false;
  } else {
    overlay.classList.add('hidden');
    return true;
  }
}
window.addEventListener('online', checkOnlineStatus);
window.addEventListener('offline', checkOnlineStatus);
checkOnlineStatus();

// 2. サーバーレス・リアルタイムP2P/リレーデータベース (Gun.js)
// GitHub Pagesだけで世界中のユーザーとデータ同期・公開が可能
const gun = Gun([
  'https://gun-manhattan.herokuapp.com/gun',
  'https://relay.peer.ooo/gun'
]);
const publicTracksNode = gun.get('notevibe_public_midi_tracks_v1');

// デフォルトアイコン生成
const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' fill='%232563eb'/%3E%3Ctext x='50%25' y='56%25' font-size='34' text-anchor='middle' fill='%23ffffff'%3E🎧%3C/text%3E%3C/svg%3E";
const DEFAULT_COVER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%231d4ed8'/%3E%3Cstop offset='100%25' stop-color='%23059669'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='300' height='300' fill='url(%23g)'/%3E%3Ctext x='50%25' y='54%25' font-size='90' text-anchor='middle' fill='%23ffffff'%3E🎹%3C/text%3E%3C/svg%3E";

// アプリ状態
let currentUser = JSON.parse(localStorage.getItem('notevibe_permanent_user') || 'null');
let tracksMap = {}; // id -> trackData
let savedTrackIds = JSON.parse(localStorage.getItem('notevibe_saved_tracks') || '[]');
let currentTab = 'explore';
let activeTrackId = null;
let detailTrackId = null;
let pendingMidiBase64 = null;
let pendingCoverBase64 = DEFAULT_COVER;

// 再生エンジン状態 (Tone.js)
let synth = null;
let scheduledIds = [];
let isPlaying = false;
let currentDuration = 0;
let playbackStartTime = 0;
let progressTimer = null;

// トースト通知
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 3200);
}

// ==========================================
// 3. 永続ログイン＆左上の3点リーダー制御
// ==========================================
function updateAccountUI() {
  const loggedOutView = document.getElementById('logged-out-view');
  const loggedInView = document.getElementById('logged-in-view');
  const signoutBtn = document.getElementById('menu-signout');

  if (currentUser) {
    loggedOutView.classList.add('hidden');
    loggedInView.classList.remove('hidden');
    signoutBtn.classList.remove('hidden');
    document.getElementById('user-display-name').textContent = currentUser.username;
    document.getElementById('user-avatar-img').src = currentUser.avatar || DEFAULT_AVATAR;
  } else {
    loggedOutView.classList.remove('hidden');
    loggedInView.classList.add('hidden');
    signoutBtn.classList.add('hidden');
  }
  updatePlayerBarButtons();
}

// 左上3点リーダーの開閉
document.getElementById('top-menu-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('top-dropdown').classList.toggle('hidden');
});
document.addEventListener('click', () => {
  document.getElementById('top-dropdown').classList.add('hidden');
});

// サインアウト（左上の3点リーダーからのみ実行可能）
document.getElementById('menu-signout').addEventListener('click', () => {
  if (!checkOnlineStatus()) return;
  if (confirm('サインアウトしますか？（次回ログインするまで公開やいいねができなくなります）')) {
    localStorage.removeItem('notevibe_permanent_user');
    currentUser = null;
    updateAccountUI();
    renderTracks();
    showToast('サインアウトしました');
  }
});

// 利用規約・プライバシーポリシー表示
document.getElementById('menu-terms').addEventListener('click', () => {
  document.getElementById('legal-title').textContent = '利用規約';
  document.getElementById('legal-body').innerHTML = `
    <h3>1. オンライン利用原則</h3>
    <p>本サービス「NoteVibe」はオンラインネットワーク環境での利用を前提としています。</p>
    <h3>2. 著作権と公開責任</h3>
    <p>ユーザーは自身が著作権を有する、または公開許諾を得たMIDIデータ（.mid / .midi）および画像のみを公開するものとします。</p>
    <h3>3. 禁止事項と通報</h3>
    <p>公序良俗に反する投稿、権利侵害コンテンツは「通報」機能の対象となり、ネットワーク上で非表示措置がとられる場合があります。</p>
  `;
  document.getElementById('legal-modal').classList.remove('hidden');
});

document.getElementById('menu-privacy').addEventListener('click', () => {
  document.getElementById('legal-title').textContent = 'プライバシーポリシー';
  document.getElementById('legal-body').innerHTML = `
    <h3>1. 取得する情報</h3>
    <p>アカウント作成時に設定されたユーザーID、表示名、アイコン画像、および公開設定されたMIDIメタデータを保存・配信します。</p>
    <h3>2. データの保存先</h3>
    <p>ログイン状態はブラウザのローカルストレージに永続保持され、公開トラック情報は分散オンラインネットワーク上で共有されます。</p>
  `;
  document.getElementById('legal-modal').classList.remove('hidden');
});

// ログイン・アカウント作成モーダル
document.getElementById('open-auth-btn').addEventListener('click', () => {
  if (!checkOnlineStatus()) return;
  document.getElementById('auth-modal').classList.remove('hidden');
});

document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!checkOnlineStatus()) return;

  const userId = document.getElementById('auth-userid').value.trim();
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const avatarFile = document.getElementById('auth-avatar').files[0];

  let avatarBase64 = DEFAULT_AVATAR;
  if (avatarFile) {
    avatarBase64 = await resizeImageToBase64(avatarFile, 160, 160);
  }

  currentUser = {
    userId,
    username,
    passwordHash: btoa(encodeURIComponent(password)),
    avatar: avatarBase64,
    createdAt: Date.now()
  };

  // 一生ログインされる（サインアウトするまで永続保存）
  localStorage.setItem('notevibe_permanent_user', JSON.stringify(currentUser));
  updateAccountUI();
  document.getElementById('auth-modal').classList.add('hidden');
  showToast(`ようこそ、${username}さん！永続ログインが完了しました。`);
});

// アイコン画像変更
document.getElementById('change-avatar-input').addEventListener('change', async (e) => {
  if (!currentUser || !e.target.files[0]) return;
  const newAvatar = await resizeImageToBase64(e.target.files[0], 160, 160);
  currentUser.avatar = newAvatar;
  localStorage.setItem('notevibe_permanent_user', JSON.stringify(currentUser));
  updateAccountUI();
  showToast('アイコンを更新しました！');
});

// 画像リサイズユーティリティ（オンライン同期を高速にするため軽量化）
function resizeImageToBase64(file, maxW, maxH) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxW;
        canvas.height = maxH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, maxW, maxH);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ==========================================
// 4. オンラインデータ受信＆公開同期
// ==========================================
publicTracksNode.map().on((data, id) => {
  if (!data || !data.trackName || data.deleted) {
    delete tracksMap[id];
  } else {
    tracksMap[id] = { ...data, id };
  }
  document.getElementById('peer-status').textContent = `🟢 オンライン同期完了 (${Object.keys(tracksMap).length}曲)`;
  renderTracks();
  if (detailTrackId === id && tracksMap[id]) {
    renderDetailModal(tracksMap[id]);
  }
});

// 初回アクセス時にネットワークが空の場合のサンプルデータ投入（動作確認用）
setTimeout(() => {
  if (Object.keys(tracksMap).length === 0 && navigator.onLine) {
    const demoMidi = createDemoMidiBase64();
    const demoId = 'demo_track_welcome_2026';
    publicTracksNode.get(demoId).put({
      trackName: 'Starlight Arp (Demo)',
      album: 'NoteVibe Launch',
      year: 2026,
      genre: 'エレクトロニカ',
      creator: 'NoteVibe公式',
      ownerId: 'system_official',
      description: 'ブラウザ上でそのまま再生できるサンプルMIDIトラックです。自分のMIDIもアップロードして公開しよう！',
      coverImage: DEFAULT_COVER,
      midiBase64: demoMidi,
      likes: 12,
      reports: 0,
      commentsJson: JSON.stringify([
        { author: 'サウンド好き', text: 'ブラウザだけでMIDIが綺麗に鳴って最高！', time: '2026/11/15' }
      ]),
      updatedAt: Date.now()
    });
  }
}, 1800);

// ==========================================
// 5. .midi / .mid ファイル選択 & 設定書き込み（作成者専用）
// ==========================================
document.getElementById('midi-file-input').addEventListener('change', (e) => {
  if (!checkOnlineStatus()) return;
  if (!currentUser) {
    alert('MIDIを公開するには先に「ログイン・アカウント作成」を行ってください。');
    document.getElementById('auth-modal').classList.remove('hidden');
    e.target.value = '';
    return;
  }
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    pendingMidiBase64 = ev.target.result; // data:audio/midi;base64,...
    openSettingsModalForNew(file.name.replace(/\.(mid|midi)$/i, ''));
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

function openSettingsModalForNew(defaultTitle) {
  document.getElementById('edit-track-id').value = '';
  document.getElementById('meta-track').value = defaultTitle || '無題のMIDI';
  document.getElementById('meta-album').value = 'オリジナルシングル';
  document.getElementById('meta-year').value = new Date().getFullYear();
  document.getElementById('meta-genre').value = 'インストゥルメンタル';
  document.getElementById('meta-creator').value = currentUser.username;
  document.getElementById('meta-description').value = '';
  pendingCoverBase64 = DEFAULT_COVER;
  const preview = document.getElementById('meta-image-preview');
  preview.src = DEFAULT_COVER;
  preview.classList.remove('hidden');
  document.getElementById('settings-modal').classList.remove('hidden');
}

// 既存トラックの設定書き込み（作成者本人のみ許可）
function openSettingsModalForEdit(track) {
  if (!currentUser || track.ownerId !== currentUser.userId) {
    alert('⛔ 設定書き込みは作成者本人のみ実行できます！');
    return;
  }
  document.getElementById('edit-track-id').value = track.id;
  document.getElementById('meta-track').value = track.trackName;
  document.getElementById('meta-album').value = track.album;
  document.getElementById('meta-year').value = track.year;
  document.getElementById('meta-genre').value = track.genre;
  document.getElementById('meta-creator').value = track.creator;
  document.getElementById('meta-description').value = track.description || '';
  pendingMidiBase64 = track.midiBase64;
  pendingCoverBase64 = track.coverImage || DEFAULT_COVER;
  const preview = document.getElementById('meta-image-preview');
  preview.src = pendingCoverBase64;
  preview.classList.remove('hidden');
  document.getElementById('settings-modal').classList.remove('hidden');
}

document.getElementById('meta-image-file').addEventListener('change', async (e) => {
  if (!e.target.files[0]) return;
  pendingCoverBase64 = await resizeImageToBase64(e.target.files[0], 300, 300);
  const preview = document.getElementById('meta-image-preview');
  preview.src = pendingCoverBase64;
  preview.classList.remove('hidden');
});

// 設定書き込み＆オンライン公開保存
document.getElementById('settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!checkOnlineStatus()) return;
  if (!currentUser) return;

  const editId = document.getElementById('edit-track-id').value;
  if (editId && tracksMap[editId] && tracksMap[editId].ownerId !== currentUser.userId) {
    alert('⛔ 作成者以外の設定書き込みは禁止されています。');
    return;
  }

  const trackId = editId || ('track_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  const existing = tracksMap[trackId] || {};

  const payload = {
    trackName: document.getElementById('meta-track').value.trim(),
    album: document.getElementById('meta-album').value.trim(),
    year: Number(document.getElementById('meta-year').value),
    genre: document.getElementById('meta-genre').value.trim(),
    creator: document.getElementById('meta-creator').value.trim(),
    ownerId: currentUser.userId,
    description: document.getElementById('meta-description').value.trim(),
    coverImage: pendingCoverBase64,
    midiBase64: pendingMidiBase64,
    likes: existing.likes || 0,
    reports: existing.reports || 0,
    commentsJson: existing.commentsJson || '[]',
    updatedAt: Date.now()
  };

  // Gun.jsネットワークへ書き込み（みんなに公開）
  publicTracksNode.get(trackId).put(payload);
  tracksMap[trackId] = { ...payload, id: trackId };

  document.getElementById('settings-modal').classList.add('hidden');
  renderTracks();
  showToast('🌐 設定を書き込み、みんなにオンライン公開しました！');
});

// ==========================================
// 6. トラック一覧レンダリング＆検索・タブ切替
// ==========================================
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    document.getElementById('page-title').textContent =
      currentTab === 'explore' ? 'みんなの公開MIDIトラック' : 'セーブしたお気に入りトラック';
    renderTracks();
  });
});

document.getElementById('search-input').addEventListener('input', renderTracks);

function renderTracks() {
  const grid = document.getElementById('tracks-grid');
  const emptyState = document.getElementById('empty-state');
  const query = document.getElementById('search-input').value.toLowerCase().trim();

  let list = Object.values(tracksMap).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (currentTab === 'saved') {
    list = list.filter((t) => savedTrackIds.includes(t.id));
  }

  if (query) {
    list = list.filter((t) =>
      (t.trackName || '').toLowerCase().includes(query) ||
      (t.album || '').toLowerCase().includes(query) ||
      (t.genre || '').toLowerCase().includes(query) ||
      (t.creator || '').toLowerCase().includes(query)
    );
  }

  grid.innerHTML = '';
  if (list.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  list.forEach((track) => {
    const comments = safeParseComments(track.commentsJson);
    const isOwner = currentUser && track.ownerId === currentUser.userId;
    const card = document.createElement('div');
    card.className = 'track-card';
    card.innerHTML = `
      <div class="card-cover-wrap">
        <img src="${track.coverImage || DEFAULT_COVER}" alt="${escapeHtml(track.trackName)}" class="card-cover" />
        <button class="card-play-fab">▶ 再生</button>
      </div>
      <div class="card-title">${escapeHtml(track.trackName)}</div>
      <div class="card-meta">${escapeHtml(track.creator)} • ${escapeHtml(track.album)}</div>
      <div class="card-tags">
        <span class="tag">${escapeHtml(track.genre)}</span>
        <span class="tag">${track.year}</span>
        ${isOwner ? '<span class="tag" style="background:#1d4ed8;color:#fff;">あなたの曲</span>' : ''}
      </div>
      <div class="card-footer">
        <span>❤️ ${track.likes || 0} &nbsp; 💬 ${comments.length}</span>
        <span>${savedTrackIds.includes(track.id) ? '🔖 セーブ済' : ''}</span>
      </div>
    `;

    card.querySelector('.card-play-fab').addEventListener('click', (e) => {
      e.stopPropagation();
      playTrack(track.id);
    });

    card.addEventListener('click', () => {
      openDetailModal(track.id);
    });

    grid.appendChild(card);
  });
}

// ==========================================
// 7. MIDI再生エンジン (Tone.js + @tonejs/midi)
// ==========================================
async function playTrack(trackId) {
  if (!checkOnlineStatus()) return;
  const track = tracksMap[trackId];
  if (!track || !track.midiBase64) return;

  activeTrackId = trackId;
  updatePlayerBarInfo(track);

  await Tone.start();
  stopPlayback();

  try {
    const base64Part = track.midiBase64.split(',')[1];
    const binaryStr = atob(base64Part);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const midi = new Midi(bytes.buffer);
    currentDuration = midi.duration || 10;
    document.getElementById('total-time').textContent = formatTime(currentDuration);

    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.02, decay: 0.2, sustain: 0.4, release: 0.8 }
    }).toDestination();

    const now = Tone.now() + 0.1;
    playbackStartTime = now;
    isPlaying = true;
    document.getElementById('player-play-btn').textContent = '⏸ 一時停止';

    midi.tracks.forEach((t) => {
      t.notes.forEach((note) => {
        const id = Tone.Transport.schedule((time) => {
          synth.triggerAttackRelease(note.name, note.duration, time, note.velocity);
        }, note.time);
        scheduledIds.push(id);
      });
    });

    Tone.Transport.seconds = 0;
    Tone.Transport.start();

    progressTimer = setInterval(() => {
      if (!isPlaying) return;
      const elapsed = Tone.Transport.seconds;
      const pct = Math.min(100, (elapsed / currentDuration) * 100);
      document.getElementById('seek-bar').value = pct;
      document.getElementById('current-time').textContent = formatTime(elapsed);
      if (elapsed >= currentDuration + 0.5) {
        stopPlayback();
      }
    }, 200);
  } catch (err) {
    console.error(err);
    showToast('MIDIの解析再生中にエラーが発生しました');
  }
}

function stopPlayback() {
  Tone.Transport.stop();
  Tone.Transport.cancel();
  scheduledIds = [];
  if (synth) {
    synth.dispose();
    synth = null;
  }
  isPlaying = false;
  clearInterval(progressTimer);
  document.getElementById('player-play-btn').textContent = '▶ 再生';
  document.getElementById('seek-bar').value = 0;
  document.getElementById('current-time').textContent = '0:00';
}

document.getElementById('player-play-btn').addEventListener('click', () => {
  if (!activeTrackId) {
    const first = Object.keys(tracksMap)[0];
    if (first) playTrack(first);
    return;
  }
  if (isPlaying) {
    Tone.Transport.pause();
    isPlaying = false;
    document.getElementById('player-play-btn').textContent = '▶ 再生';
  } else {
    if (Tone.Transport.seconds > 0) {
      Tone.Transport.start();
      isPlaying = true;
      document.getElementById('player-play-btn').textContent = '⏸ 一時停止';
    } else {
      playTrack(activeTrackId);
    }
  }
});

document.getElementById('player-stop-btn').addEventListener('click', stopPlayback);

function updatePlayerBarInfo(track) {
  document.getElementById('player-cover').src = track.coverImage || DEFAULT_COVER;
  document.getElementById('player-title').textContent = track.trackName;
  document.getElementById('player-artist').textContent = `${track.creator} — ${track.album}`;
  document.getElementById('player-submeta').textContent = `${track.genre} (${track.year})`;
  updatePlayerBarButtons();
}

function updatePlayerBarButtons() {
  const track = tracksMap[activeTrackId];
  const editBtn = document.getElementById('player-edit-btn');
  if (!track) {
    editBtn.classList.add('hidden');
    return;
  }
  document.getElementById('player-like-count').textContent = track.likes || 0;
  const saveBtn = document.getElementById('player-save-btn');
  saveBtn.textContent = savedTrackIds.includes(track.id) ? '🔖 セーブ済' : '🔖 セーブ';
  saveBtn.classList.toggle('active', savedTrackIds.includes(track.id));

  if (currentUser && track.ownerId === currentUser.userId) {
    editBtn.classList.remove('hidden');
  } else {
    editBtn.classList.add('hidden');
  }
}

// ==========================================
// 8. いいね・通報・セーブ・コメント反応
// ==========================================
function toggleLike(trackId) {
  if (!checkOnlineStatus()) return;
  if (!currentUser) {
    alert('いいねするにはログイン・アカウント作成が必要です');
    return;
  }
  const track = tracksMap[trackId];
  if (!track) return;

  const likedKey = `notevibe_liked_${currentUser.userId}_${trackId}`;
  const already = localStorage.getItem(likedKey) === '1';
  const newLikes = Math.max(0, (track.likes || 0) + (already ? -1 : 1));

  if (already) localStorage.removeItem(likedKey);
  else localStorage.setItem(likedKey, '1');

  publicTracksNode.get(trackId).get('likes').put(newLikes);
  track.likes = newLikes;
  updatePlayerBarButtons();
  renderTracks();
  if (detailTrackId === trackId) renderDetailModal(track);
  showToast(already ? 'いいねを取り消しました' : '❤️ いいねを送りました！');
}

function toggleSave(trackId) {
  if (!checkOnlineStatus()) return;
  if (!trackId) return;
  if (savedTrackIds.includes(trackId)) {
    savedTrackIds = savedTrackIds.filter((id) => id !== trackId);
    showToast('セーブを解除しました');
  } else {
    savedTrackIds.push(trackId);
    showToast('🔖 お気に入りにセーブしました！');
  }
  localStorage.setItem('notevibe_saved_tracks', JSON.stringify(savedTrackIds));
  updatePlayerBarButtons();
  renderTracks();
  if (detailTrackId === trackId && tracksMap[trackId]) {
    renderDetailModal(tracksMap[trackId]);
  }
}

function reportTrack(trackId) {
  if (!checkOnlineStatus()) return;
  const track = tracksMap[trackId];
  if (!track) return;
  const reason = prompt(`「${track.trackName}」を通報する理由を入力してください（著作権侵害・不適切な内容など）:`);
  if (!reason) return;

  const newReports = (track.reports || 0) + 1;
  publicTracksNode.get(trackId).get('reports').put(newReports);
  track.reports = newReports;
  showToast('🚨 通報を受け付けました。ご協力ありがとうございます。');
}

// プレイヤーバーの反応ボタン
document.getElementById('player-like-btn').addEventListener('click', () => activeTrackId && toggleLike(activeTrackId));
document.getElementById('player-save-btn').addEventListener('click', () => activeTrackId && toggleSave(activeTrackId));
document.getElementById('player-report-btn').addEventListener('click', () => activeTrackId && reportTrack(activeTrackId));
document.getElementById('player-edit-btn').addEventListener('click', () => {
  if (activeTrackId && tracksMap[activeTrackId]) openSettingsModalForEdit(tracksMap[activeTrackId]);
});

// 詳細モーダル
function openDetailModal(trackId) {
  const track = tracksMap[trackId];
  if (!track) return;
  detailTrackId = trackId;
  renderDetailModal(track);
  document.getElementById('detail-modal').classList.remove('hidden');
}

function renderDetailModal(track) {
  document.getElementById('detail-title').textContent = track.trackName;
  document.getElementById('detail-cover').src = track.coverImage || DEFAULT_COVER;
  document.getElementById('detail-genre').textContent = track.genre;
  document.getElementById('detail-year').textContent = track.year;
  document.getElementById('detail-album').textContent = track.album;
  document.getElementById('detail-creator').textContent = track.creator;
  document.getElementById('detail-desc').textContent = track.description || '説明はありません。';
  document.getElementById('detail-likes').textContent = track.likes || 0;

  const saveBtn = document.getElementById('detail-save-btn');
  saveBtn.textContent = savedTrackIds.includes(track.id) ? '🔖 セーブ済' : '🔖 セーブ';

  const editBtn = document.getElementById('detail-edit-btn');
  if (currentUser && track.ownerId === currentUser.userId) {
    editBtn.classList.remove('hidden');
  } else {
    editBtn.classList.add('hidden');
  }

  const comments = safeParseComments(track.commentsJson);
  const listEl = document.getElementById('comments-list');
  listEl.innerHTML = comments.length
    ? comments.map((c) => `
        <div class="comment-item">
          <span class="comment-author">${escapeHtml(c.author)}</span>
          <span class="comment-time">${escapeHtml(c.time)}</span>
          <div>${escapeHtml(c.text)}</div>
        </div>
      `).join('')
    : '<p style="font-size:12px;color:#9ca3af;">まだコメントはありません。最初の反応を書こう！</p>';
}

document.getElementById('detail-play-btn').addEventListener('click', () => detailTrackId && playTrack(detailTrackId));
document.getElementById('detail-like-btn').addEventListener('click', () => detailTrackId && toggleLike(detailTrackId));
document.getElementById('detail-save-btn').addEventListener('click', () => detailTrackId && toggleSave(detailTrackId));
document.getElementById('detail-report-btn').addEventListener('click', () => detailTrackId && reportTrack(detailTrackId));
document.getElementById('detail-edit-btn').addEventListener('click', () => {
  if (detailTrackId && tracksMap[detailTrackId]) {
    document.getElementById('detail-modal').classList.add('hidden');
    openSettingsModalForEdit(tracksMap[detailTrackId]);
  }
});

document.getElementById('comment-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!checkOnlineStatus()) return;
  if (!currentUser) {
    alert('コメントを投稿するにはログイン・アカウント作成を行ってください');
    return;
  }
  const track = tracksMap[detailTrackId];
  if (!track) return;

  const input = document.getElementById('comment-input');
  const text = input.value.trim();
  if (!text) return;

  const comments = safeParseComments(track.commentsJson);
  comments.unshift({
    author: currentUser.username,
    text,
    time: new Date().toLocaleString('ja-JP')
  });

  const jsonStr = JSON.stringify(comments);
  publicTracksNode.get(detailTrackId).get('commentsJson').put(jsonStr);
  track.commentsJson = jsonStr;
  input.value = '';
  renderDetailModal(track);
  renderTracks();
  showToast('💬 反応コメントを公開しました！');
});

// ==========================================
// 9. 「.midファイルを作る」オンラインMIDIメーカー
// ==========================================
const NOTES = ['C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4'];
const STEPS = 16;
let seqGridState = Array.from({ length: NOTES.length }, () => Array(STEPS).fill(false));

function initSequencerUI() {
  const grid = document.getElementById('sequencer-grid');
  grid.innerHTML = '';
  NOTES.forEach((note, rIdx) => {
    const label = document.createElement('div');
    label.className = 'seq-label';
    label.textContent = note;
    grid.appendChild(label);

    for (let cIdx = 0; cIdx < STEPS; cIdx++) {
      const cell = document.createElement('div');
      cell.className = 'seq-cell' + (seqGridState[rIdx][cIdx] ? ' active' : '');
      cell.addEventListener('click', () => {
        seqGridState[rIdx][cIdx] = !seqGridState[rIdx][cIdx];
        cell.classList.toggle('active');
      });
      grid.appendChild(cell);
    }
  });
}

document.getElementById('open-maker-btn').addEventListener('click', () => {
  if (!checkOnlineStatus()) return;
  initSequencerUI();
  document.getElementById('maker-modal').classList.remove('hidden');
});

document.getElementById('maker-clear-btn').addEventListener('click', () => {
  seqGridState = Array.from({ length: NOTES.length }, () => Array(STEPS).fill(false));
  initSequencerUI();
});

function buildMidiFromSequencer() {
  const bpm = Number(document.getElementById('maker-bpm').value) || 120;
  const midi = new Midi();
  midi.header.setTempo(bpm);
  const track = midi.addTrack();
  const stepSec = 60 / bpm / 2; // 8分音符

  for (let c = 0; c < STEPS; c++) {
    for (let r = 0; r < NOTES.length; r++) {
      if (seqGridState[r][c]) {
        track.addNote({
          name: NOTES[r],
          time: c * stepSec,
          duration: stepSec * 0.9,
          velocity: 0.85
        });
      }
    }
  }
  const bytes = midi.toArray();
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:audio/midi;base64,' + btoa(binary);
}

document.getElementById('maker-preview-btn').addEventListener('click', async () => {
  await Tone.start();
  const bpm = Number(document.getElementById('maker-bpm').value) || 120;
  const stepSec = 60 / bpm / 2;
  const previewSynth = new Tone.PolySynth(Tone.Synth).toDestination();
  const now = Tone.now();
  for (let c = 0; c < STEPS; c++) {
    for (let r = 0; r < NOTES.length; r++) {
      if (seqGridState[r][c]) {
        previewSynth.triggerAttackRelease(NOTES[r], stepSec * 0.8, now + c * stepSec);
      }
    }
  }
});

document.getElementById('maker-download-btn').addEventListener('click', () => {
  const dataUrl = buildMidiFromSequencer();
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `notevibe_created_${Date.now()}.mid`;
  a.click();
  showToast('.midファイルをダウンロードしました！');
});

document.getElementById('maker-publish-btn').addEventListener('click', () => {
  if (!currentUser) {
    alert('公開するには先にログイン・アカウント作成を行ってください');
    document.getElementById('auth-modal').classList.remove('hidden');
    return;
  }
  pendingMidiBase64 = buildMidiFromSequencer();
  document.getElementById('maker-modal').classList.add('hidden');
  openSettingsModalForNew('オリジナルシーケンス曲');
});

// サンプルMIDI生成
function createDemoMidiBase64() {
  const midi = new Midi();
  const track = midi.addTrack();
  const notes = ['C4', 'E4', 'G4', 'B4', 'C5', 'B4', 'G4', 'E4'];
  notes.forEach((n, idx) => {
    track.addNote({ name: n, time: idx * 0.35, duration: 0.3, velocity: 0.8 });
  });
  const bytes = midi.toArray();
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:audio/midi;base64,' + btoa(binary);
}

// モーダル閉じるボタン共通
document.querySelectorAll('.close-modal, [data-close]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.close || btn.closest('.modal').id;
    document.getElementById(id).classList.add('hidden');
  });
});

// ユーティリティ
function formatTime(sec) {
  const s = Math.floor(sec || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function safeParseComments(jsonStr) {
  try {
    return JSON.parse(jsonStr || '[]');
  } catch {
    return [];
  }
}
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 初期化
updateAccountUI();
renderTracks();
