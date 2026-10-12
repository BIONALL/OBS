/**
 * ============================================================
 * PORTAL SISWA BION — Frontend JavaScript (SPA, GitHub Pages)
 * - Satu halaman, semua tampilan dirender di <main id="app-container">.
 * - Data diambil dari API Google Apps Script lewat fetch() (lihat js/config.js).
 * - Navigasi memakai hash (#smp, #smp/join, #staf) sehingga tombol Back
 *   peramban dan link langsung tetap berfungsi.
 * - Data publik: 1x getPortalData per kunjungan + salinan localStorage
 *   agar beranda tampil instan.
 * ============================================================
 */

// ════════════════════════════════════════════════════════
// BAGIAN 1: KONSTANTA & STATE
// ════════════════════════════════════════════════════════

/** Teks & ikon per jenjang (ubah di sini bila perlu). */
const JENJANG_META = {
  SD:  { nama: 'BION SD',  kelas: 'Kelas 1–6',   desc: 'Pondasi belajar ceria',     icon: 'bi-balloon-fill' },
  SMP: { nama: 'BION SMP', kelas: 'Kelas 7, 8, 9', desc: 'Penguatan konsep & nalar', icon: 'bi-lightbulb-fill' },
  SMA: { nama: 'BION SMA', kelas: 'Kelas 10–12', desc: 'Persiapan UTBK & SNBP',    icon: 'bi-award-fill' }
};
const JENJANG_LIST = ['SD', 'SMP', 'SMA'];

/** Ikon & deskripsi per submenu (kode = bagian setelah tanda '-' pada id). */
const SUBMENU_META = {
  JOIN:    { icon: 'bi-camera-video-fill',    desc: 'Link kelas online & jadwal bimbel' },
  HADIR:   { icon: 'bi-clipboard2-check-fill', desc: 'Catatan kehadiran siswa' },
  TRYOUT:  { icon: 'bi-clipboard-data-fill', desc: 'Hasil tryout & tes IQ' },
  BOOKING: { icon: 'bi-calendar2-check-fill', desc: 'Jadwal konsultasi & psikotes' },
  BULANAN: { icon: 'bi-journal-richtext',     desc: 'Rapor evaluasi berkala' },
  INFO:    { icon: 'bi-megaphone-fill',       desc: 'Informasi libur & agenda' },
  KONTAK:  { icon: 'bi-headset',              desc: 'Bantuan operator & CS' }
};

const FRAME_TIMEOUT_MS = 10000;  // PRD FR-03
const MAKS_BERKAS = 5 * 1024 * 1024;
const LS_DATA = 'bion_portal_data_v1';
const LS_THEME = 'bion_theme';
const LS_LAST = 'bion_last_jenjang';

const State = {
  data: null,              // hasil getPortalData()
  route: { name: 'beranda', params: {} },
  staff: null,             // sesi staf
  token: '',               // token sesi login staf
  staffData: null,         // hasil getStaffData()
  staffTab: 'ringkasan',
  staffEdit: null,         // objek yang sedang diedit di panel
  staffFilter: { pengumuman: 'Semua', link: 'SD', kontak: 'SD' },
  frameTimer: null,
  charts: {}
};

// ════════════════════════════════════════════════════════
// BAGIAN 2: UTILITAS
// ════════════════════════════════════════════════════════

const $ = (sel, root = document) => root.querySelector(sel);
const app = () => document.getElementById('app-container');

/** Escape HTML — semua teks dari database WAJIB lewat fungsi ini. */
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Escape lalu ubah URL https menjadi tautan aman (tab baru). */
const linkify = (text) => esc(text).replace(/https:\/\/[^\s<]+/g,
  (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);

const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* mode privat */ } };

const ssGet = (k) => { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } };
const ssSet = (k, v) => { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch (e) {} };
const SS_TOKEN = 'bion_staf_token';

/** Batas tunggu respons API. Unggah berkas diberi waktu lebih lama. */
const API_TIMEOUT_MS = 30000;
const API_TIMEOUT_UPLOAD_MS = 90000;

/** Ubah respons fetch menjadi objek { success, data, message }. */
async function bacaJson(res) {
  const teks = await res.text();
  try { return JSON.parse(teks); }
  catch (e) {
    // GAS mengirim halaman HTML (bukan JSON) bila deployment tidak bisa diakses publik
    throw new Error(/<html/i.test(teks)
      ? 'Server API menolak akses. Pastikan deployment Apps Script diatur "Who has access: Anyone".'
      : 'Respons server tidak dapat dibaca.');
  }
}

/**
 * Panggil API Google Apps Script.
 * - getPortalData → GET (ringan, tanpa body)
 * - aksi lain     → POST text/plain berisi { action, args } (text/plain = tanpa CORS preflight)
 */
async function callServer(fn, ...args) {
  const url = (window.BION_CONFIG && BION_CONFIG.GAS_URL) || '';
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url) || /GANTI_DENGAN/.test(url)) {
    throw new Error('Alamat API belum diatur. Isi GAS_URL di file js/config.js dengan URL /exec dari Apps Script.');
  }
  const besar = args.some(a => a && typeof a === 'object' && (a.foto || a.pdf));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), besar ? API_TIMEOUT_UPLOAD_MS : API_TIMEOUT_MS);
  try {
    const res = fn === 'getPortalData'
      ? await fetch(`${BION_CONFIG.GAS_URL}?action=getPortalData`, { signal: ctrl.signal })
      : await fetch(BION_CONFIG.GAS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: fn, args }),
          signal: ctrl.signal
        });
    return await bacaJson(res);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Server terlalu lama merespons. Periksa koneksi lalu coba lagi.');
    if (err instanceof TypeError) throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Panggil fungsi staf di server — token sesi selalu dikirim sebagai argumen pertama. */
function callStaff(fn, ...args) {
  return callServer(fn, State.token, ...args).then(res => {
    if (res && !res.success && /Sesi berakhir|Akses ditolak/.test(res.message || '')) {
      setToken(''); State.staff = null; State.staffData = null;
      if (State.route.name === 'staf') renderLogin(res.message);
    }
    return res;
  });
}
function setToken(t) { State.token = t || ''; ssSet(SS_TOKEN, State.token); }

/** Ambil ID berkas dari URL Google Drive. */
function driveId(url) {
  const m = String(url || '').match(/\/d\/([\w-]{20,})/) || String(url || '').match(/[?&]id=([\w-]{20,})/);
  return m ? m[1] : '';
}
const driveThumb = (url, w = 800) => { const id = driveId(url); return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w${w}` : esc(url); };
const drivePreview = (url) => { const id = driveId(url); return id ? `https://drive.google.com/file/d/${id}/preview` : url; };
const driveDownload = (url) => { const id = driveId(url); return id ? `https://drive.google.com/uc?export=download&id=${id}` : url; };

/** Format tanggal Indonesia: "Hari ini, 08.30" / "Kemarin" / "12 Okt 2026". */
function fmtTanggal(iso, withTime = true) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return withTime ? `Hari ini, ${jam}` : 'Hari ini';
  if (diff === 1) return 'Kemarin';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function waLink(nomor, jenjang) {
  const pesan = jenjang ? `Halo, saya ingin bertanya mengenai BION ${jenjang}.` : 'Halo, saya ingin bertanya/melaporkan kendala terkait aplikasi Portal Siswa BION.';
  return `https://wa.me/${encodeURIComponent(nomor)}?text=${encodeURIComponent(pesan)}`;
}

function menuKode(id) { return String(id).split('-').pop(); }
function menuFor(j) { return (State.data ? State.data.menu : []).filter(m => m.jenjang === j); }
function pengumumanFor(j) {
  const list = State.data ? State.data.pengumuman : [];
  return j ? list.filter(p => p.jenjang === 'Semua' || p.jenjang === j) : list;
}
function kontakFor(j) { return (State.data ? State.data.kontak : []).filter(k => !j || k.jenjang === j); }

/** Muat skrip CDN hanya saat dibutuhkan (Chart.js untuk panel staf). */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Gagal memuat ' + src));
    document.head.appendChild(s);
  });
}

// ════════════════════════════════════════════════════════
// BAGIAN 3: TOAST, MODAL, KONFIRMASI, LOADING TOMBOL
// ════════════════════════════════════════════════════════

function showToast(title, message, type = 'info') {
  const map = {
    success: ['bi-check-circle-fill', 'var(--success)'],
    danger: ['bi-x-octagon-fill', 'var(--danger)'],
    warning: ['bi-exclamation-triangle-fill', 'var(--warning)'],
    info: ['bi-info-circle-fill', 'var(--smp)']
  };
  const [icon, color] = map[type] || map.info;
  const el = document.getElementById('appToast');
  el.style.setProperty('--toast-c', color);
  $('#toastIcon').className = 'bi ' + icon;
  $('#toastTitle').textContent = title;
  $('#toastBody').textContent = message;
  bootstrap.Toast.getOrCreateInstance(el, { delay: type === 'danger' ? 7000 : 4000 }).show();
}

const modal = (id) => bootstrap.Modal.getOrCreateInstance(document.getElementById(id));

function confirmDialog(title, text, okLabel = 'Ya, lanjutkan') {
  return new Promise((resolve) => {
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    const ok = $('#confirmOk');
    ok.textContent = okLabel;
    let decided = false;
    ok.onclick = () => { decided = true; modal('confirmModal').hide(); resolve(true); };
    document.getElementById('confirmModal').addEventListener('hidden.bs.modal', () => { if (!decided) resolve(false); }, { once: true });
    modal('confirmModal').show();
  });
}

/** Jalankan aksi async dengan spinner di tombol. */
async function withBtn(btn, label, task) {
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin-inline"></span> ${label}`; }
  try { return await task(); }
  finally { if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = original; } }
}

// ════════════════════════════════════════════════════════
// BAGIAN 4: TEMA (DARK MODE) & IDENTITAS
// ════════════════════════════════════════════════════════

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('#themeIcon').className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
  Object.values(State.charts).forEach(c => { try { styleChart(c); c.update(); } catch (e) {} });
}
function toggleDarkMode() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  lsSet(LS_THEME, next);
  applyTheme(next);
}

function applyIdentity() {
  if (!State.data) return;
  const a = State.data.app;
  const nama = a.nama || 'Portal Siswa BION';
  document.title = nama;
  $('#brandTagline').textContent = a.tagline || 'Bintang Pelajar Online';
  if (a.logoUrl) $('#brandMark').innerHTML = `<img src="${esc(a.logoUrl)}" alt="Logo BION">`;
}

// ════════════════════════════════════════════════════════
// BAGIAN 5: ROUTER SPA (tanpa ?page=, Back peramban tetap jalan)
// ════════════════════════════════════════════════════════

/** Ubah rute menjadi hash pendek, contoh: "smp/join", "pengumuman/sd". */
function routeToHash(r) {
  const p = r.params || {};
  if (r.name === 'jenjang') return p.j.toLowerCase();
  if (r.name === 'layanan') return `${p.j.toLowerCase()}/${menuKode(p.id).toLowerCase()}`;
  if (r.name === 'pengumuman' || r.name === 'kontak') return r.name + (p.j ? '/' + p.j.toLowerCase() : '');
  if (r.name === 'staf') return 'staf';
  if (r.name === 'join') return 'join';
  return '';
}
function hashToRoute(hash) {
  const parts = String(hash || '').replace(/^#/, '').toLowerCase().split('/').filter(Boolean);
  const J = (s) => JENJANG_LIST.find(j => j.toLowerCase() === s);
  if (!parts.length) return { name: 'beranda', params: {} };
  if (J(parts[0])) {
    const j = J(parts[0]);
    return parts[1] ? { name: 'layanan', params: { j, id: `${j}-${parts[1].toUpperCase()}` } } : { name: 'jenjang', params: { j } };
  }
  if (parts[0] === 'pengumuman' || parts[0] === 'kontak') return { name: parts[0], params: { j: J(parts[1] || '') || '' } };
  if (parts[0] === 'staf') return { name: 'staf', params: {} };
  if (parts[0] === 'join') return { name: 'join', params: {} };
  return { name: 'beranda', params: {} };
}

/**
 * SATU-SATUNYA cara berpindah halaman di aplikasi ini.
 * @param {string} name  beranda | jenjang | layanan | pengumuman | kontak | staf
 * @param {object} params contoh { j: 'SMP', id: 'SMP-JOIN' }
 * @param {object} opts   { replace: true } untuk tidak menambah riwayat
 */
function navigateTo(name, params = {}, opts = {}) {
  State.route = { name, params };
  if (!opts.fromHistory) {
    const hash = routeToHash(State.route);
    const url = location.pathname + location.search + (hash ? '#' + hash : '');
    try { history[opts.replace ? 'replaceState' : 'pushState'](State.route, '', url); } catch (e) {}
  }
  render();
  window.scrollTo(0, 0);
}

function goBack(fallback = 'beranda', params = {}) {
  // Kembali secara logis (tidak bergantung pada riwayat peramban)
  navigateTo(fallback, params);
}

/** Render ulang halaman sesuai State.route. */
function render() {
  clearTimeout(State.frameTimer);
  destroyCharts();
  const { name, params } = State.route;
  const j = params.j || (name === 'layanan' ? String(params.id).split('-')[0] : '');
  document.body.dataset.jenjang = ['jenjang', 'layanan'].includes(name) || (['pengumuman', 'kontak'].includes(name) && j) ? j : '';
  document.body.classList.toggle('mode-frame', false);

  // Tandai menu navigasi aktif
  const navKey = ['pengumuman', 'kontak'].includes(name) ? name : (name === 'staf' ? '' : 'beranda');
  document.querySelectorAll('[data-nav]').forEach(b => {
    const on = b.dataset.nav === navKey;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#fabCs').style.display = name === 'staf' ? 'none' : '';

  if (!State.data && name !== 'staf') return; // skeleton tetap tampil sampai data siap

  const views = { beranda: viewBeranda, join: viewJoin, jenjang: viewJenjang, layanan: viewLayanan, pengumuman: viewPengumuman, kontak: viewKontak, staf: viewStaf };
  (views[name] || viewBeranda)(params);
}

// ════════════════════════════════════════════════════════
// BAGIAN 6: VIEW PUBLIK
// ════════════════════════════════════════════════════════

/** Kartu pengumuman (dipakai di beranda, halaman pengumuman, pratinjau staf). */
function annCard(p, opts = {}) {
  const tag = p.jenjang === 'Semua' ? 'Semua Jenjang' : 'BION ' + p.jenjang;
  const click = opts.preview ? '' : `onclick="openPengumuman('${esc(p.id)}')"`;
  return `
    <article class="card-x ann-card ${opts.preview ? '' : 'card-click'}" ${click} ${opts.preview ? '' : 'role="button" tabindex="0"'}
      onkeydown="if(event.key==='Enter')this.click()">
      ${p.foto ? `<img class="ann-thumb" loading="lazy" src="${opts.localFoto || driveThumb(p.foto)}" alt="">` : ''}
      <div class="ann-meta">
        <span class="pill t-${esc(p.jenjang)}">${esc(tag)}</span>
        ${p.pdf ? '<span class="pill"><i class="bi bi-paperclip"></i> PDF</span>' : ''}
        <span class="ann-date">${esc(fmtTanggal(p.tanggal))}</span>
      </div>
      <h3 class="ann-title">${esc(p.judul)}</h3>
      <p class="ann-body">${esc(p.isi)}</p>
      <div class="ann-foot">
        <span>${p.pdf ? '<i class="bi bi-file-earmark-pdf"></i> Lampiran tersedia' : '&nbsp;'}</span>
        <span class="read">Baca selengkapnya <i class="bi bi-arrow-right"></i></span>
      </div>
    </article>`;
}

function emptyState(icon, title, text, action = '') {
  return `<div class="card-x empty"><div class="empty-illus"><i class="bi ${icon}"></i></div>
    <h2 class="h-md">${title}</h2><p>${text}</p>${action}</div>`;
}

function siapCount(j) {
  return menuFor(j).filter(m => m.url || ['INFO', 'KONTAK'].includes(menuKode(m.id))).length;
}

function viewBeranda() {
  const last = lsGet(LS_LAST); // pengingat jenjang terakhir yang dibuka di perangkat ini
  const ann = pengumumanFor('').slice(0, 4);
  app().innerHTML = `
  <div class="container-app">
    <section class="hero" aria-labelledby="heroTitle">
      <span class="hero-badge"><i class="bi bi-patch-check-fill"></i> Satu pintu layanan BION</span>
      <div class="hero-icon" aria-hidden="true"><i class="bi bi-book-half"></i></div>
      <h1 class="h-hero" id="heroTitle">Akses Mudah Belajar Online BION</h1>
      <p>Halo Ayah, Bunda &amp; Siswa! Pilih jenjang untuk membuka jadwal kelas, rekap kehadiran, laporan tryout, dan laporan bulanan dalam satu tempat.</p>
      <div class="hero-actions">
        ${last ? `<button class="hero-btn" onclick="navigateTo('jenjang',{j:'${last}'})"><i class="bi bi-arrow-right-circle-fill"></i> Lanjut ke BION ${last}</button>` : ''}
        <button class="hero-btn ${last ? 'ghost' : ''}" onclick="navigateTo('join')"><i class="bi bi-camera-video-fill"></i> Join Kelas Sekarang</button>
        ${last ? '' : `<button class="hero-btn ghost" onclick="document.getElementById('pilihJenjang').scrollIntoView({behavior:'smooth'})"><i class="bi bi-grid-fill"></i> Pilih Jenjang</button>`}
      </div>
    </section>

    <button type="button" class="card-x card-click join-card" onclick="navigateTo('join')">
      <span class="join-icon"><i class="bi bi-camera-video-fill"></i></span>
      <span class="join-text"><span class="label-sm join-tag">Akses cepat</span>
        <span class="join-title">Join Kelas / Cari Jadwal</span>
        <span class="join-desc">Langsung masuk kelas online. Pilih SD, SMP, atau SMA di langkah berikutnya.</span></span>
      <i class="bi bi-arrow-right join-arrow" aria-hidden="true"></i>
    </button>

    <div class="section-head" id="pilihJenjang">
      <div><h2 class="h-lg">Pilih Jenjang</h2><p class="body-sm">Ketuk jenjang Ananda untuk melihat layanannya</p></div>
    </div>
    <div class="grid-3">
      ${JENJANG_LIST.map(j => {
        const m = JENJANG_META[j];
        return `<button type="button" class="card-x card-click jenjang-card t-${j} ${last === j ? 'last' : ''}" onclick="openJenjang('${j}')" aria-label="Buka ${m.nama}">
          ${last === j ? '<span class="pill t-' + j + ' jc-last" style="font-size:10px">Terakhir</span><span class="jc-icon" style="margin-top:1.4rem">' : '<span class="jc-icon">'}<i class="bi ${m.icon}"></i></span>
          <i class="bi bi-arrow-right jc-arrow" aria-hidden="true"></i>
          <span class="label-sm jc-kelas">${m.kelas}</span>
          <div class="jc-name">${j}</div>
          <div class="jc-desc">${m.desc}</div>
          <div class="jc-meta"><i class="bi bi-check2-circle"></i> ${siapCount(j)} dari ${menuFor(j).length} layanan siap</div>
        </button>`;
      }).join('')}
    </div>

    <div class="section-head">
      <div><h2 class="h-lg">Pengumuman Terbaru</h2><p class="body-sm">Informasi resmi dari Bintang Pelajar Online</p></div>
      ${ann.length ? `<button class="link-btn" onclick="navigateTo('pengumuman')">Lihat semua</button>` : ''}
    </div>
    ${ann.length ? `<div class="ann-list grid">${ann.map(p => annCard(p)).join('')}</div>`
      : emptyState('bi-megaphone', 'Belum ada pengumuman', 'Pengumuman terbaru dari staf BION akan muncul di sini.')}
  </div>`;
}

/** Halaman akses cepat Join Kelas: pilih SD / SMP / SMA lalu langsung buka layanannya. */
function viewJoin() {
  app().innerHTML = `
  <div class="container-app">
    <section class="tier-banner join-banner" aria-labelledby="joinTitle">
      <button class="back" onclick="navigateTo('beranda')"><i class="bi bi-arrow-left"></i> Beranda</button>
      <h1 class="h-hero" id="joinTitle">Join Kelas / Cari Jadwal</h1>
      <p>Pilih jenjang Ananda untuk langsung masuk ke kelas online & jadwal bimbel.</p>
      <i class="bi bi-camera-video-fill tb-icon" aria-hidden="true"></i>
    </section>
    <div class="join-list">
      ${JENJANG_LIST.map(j => {
        const m = JENJANG_META[j];
        const item = menuFor(j).find(x => menuKode(x.id) === 'JOIN');
        const ada = item && item.url;
        return `<button type="button" class="card-x card-click join-pick t-${j}" onclick="openJoin('${j}')">
          <span class="jc-icon"><i class="bi ${m.icon}"></i></span>
          <span class="flex-grow-1 text-start"><span class="label-sm d-block" style="color:var(--c)">${m.kelas}</span>
            <span class="join-pick-name">${m.nama}</span></span>
          ${ada ? '<span class="pill pill-ok"><span class="dot"></span> Tersedia</span>' : '<span class="pill pill-wait">Segera</span>'}
          <i class="bi bi-chevron-right text-muted" aria-hidden="true"></i>
        </button>`;
      }).join('')}
    </div>
  </div>`;
}
function openJoin(j) {
  lsSet(LS_LAST, j);
  navigateTo('layanan', { j, id: j + '-JOIN', from: 'join' });
}

function openJenjang(j) {
  lsSet(LS_LAST, j);
  navigateTo('jenjang', { j });
}

function viewJenjang({ j }) {
  if (!JENJANG_META[j]) return navigateTo('beranda', {}, { replace: true });
  const m = JENJANG_META[j];
  const ann = pengumumanFor(j).slice(0, 2);
  app().innerHTML = `
  <div class="container-app">
    <section class="tier-banner" aria-labelledby="tierTitle">
      <button class="back" onclick="navigateTo('beranda')"><i class="bi bi-arrow-left"></i> Beranda</button>
      <span class="label-sm d-block" style="opacity:.85">${m.kelas}</span>
      <h1 class="h-hero" id="tierTitle">${m.nama}</h1>
      <p>${m.desc}. Pilih layanan di bawah ini.</p>
      <i class="bi ${m.icon} tb-icon" aria-hidden="true"></i>
    </section>

    <div class="tier-switch" role="tablist" aria-label="Ganti jenjang">
      ${JENJANG_LIST.map(x => `<button class="chip t-${x} ${x === j ? 'active' : ''}" role="tab" aria-selected="${x === j}" onclick="openJenjang('${x}')"><span class="dot"></span>BION ${x}</button>`).join('')}
    </div>

    <div class="section-head">
      <div><h2 class="h-lg">Menu Layanan</h2><p class="body-sm">Layanan harian belajar & administrasi</p></div>
      <span class="pill t-${j}">${siapCount(j)}/${menuFor(j).length} siap</span>
    </div>
    <div class="grid-menu">
      ${menuFor(j).map(item => {
        const kode = menuKode(item.id);
        const meta = SUBMENU_META[kode] || { icon: 'bi-grid', desc: '' };
        const native = ['INFO', 'KONTAK'].includes(kode);
        const ready = !!item.url || native;
        let pill = ready ? '<span class="pill pill-ok mc-pill"><span class="dot"></span> Tersedia</span>' : '<span class="pill pill-wait mc-pill">Segera</span>';
        if (kode === 'INFO' && !item.url) { const n = pengumumanFor(j).length; pill = n ? `<span class="pill t-${j} mc-pill">${n} info</span>` : pill; }
        if (kode === 'KONTAK' && !item.url) { const n = kontakFor(j).length; pill = n ? '<span class="pill pill-ok mc-pill"><span class="dot"></span> Online</span>' : '<span class="pill pill-wait mc-pill">Segera</span>'; }
        return `<button type="button" class="card-x card-click menu-card ${ready ? '' : 'is-soon'}" onclick="openLayanan('${esc(item.id)}')">
          <span class="mc-top"><span class="mc-icon"><i class="bi ${meta.icon}"></i></span>${pill}</span>
          <span><span class="mc-title d-block">${esc(item.submenu).split('/').join('/<wbr>')}</span><span class="mc-desc d-block">${meta.desc}</span></span>
        </button>`;
      }).join('')}
    </div>

    ${ann.length ? `
    <div class="section-head">
      <div><h2 class="h-lg">Info ${esc(m.nama)}</h2><p class="body-sm">Pengumuman untuk jenjang ini</p></div>
      <button class="link-btn" onclick="navigateTo('pengumuman',{j:'${j}'})">Lihat semua</button>
    </div>
    <div class="ann-list grid">${ann.map(p => annCard(p)).join('')}</div>` : ''}
  </div>`;
}

/** Kode onclick tombol kembali dari halaman layanan. */
function backJs(j, from) { return from === 'join' ? "navigateTo('join')" : `navigateTo('jenjang',{j:'${j}'})`; }

/** Klik kartu submenu: halaman bawaan (Pengumuman/Kontak) atau iframe. */
function openLayanan(id) {
  const item = State.data.menu.find(m => m.id === id);
  if (!item) return;
  const kode = menuKode(id);
  if (!item.url && kode === 'INFO') return navigateTo('pengumuman', { j: item.jenjang });
  if (!item.url && kode === 'KONTAK') return navigateTo('kontak', { j: item.jenjang });
  navigateTo('layanan', { j: item.jenjang, id });
}

function viewLayanan({ id, from }) {
  const item = State.data.menu.find(m => m.id === id);
  if (!item) return navigateTo('beranda', {}, { replace: true });
  const j = item.jenjang;
  const kode = menuKode(id);
  if (!item.url && kode === 'INFO') return navigateTo('pengumuman', { j }, { replace: true });
  if (!item.url && kode === 'KONTAK') return navigateTo('kontak', { j }, { replace: true });

  // FR-04: belum ada link → "sedang dalam pengembangan"
  if (!item.url) {
    app().innerHTML = `
    <div class="container-app">
      <div class="tier-switch mb-2"><button class="chip" onclick="${backJs(j, from)}"><i class="bi bi-arrow-left"></i> ${from === 'join' ? 'Pilih jenjang' : 'BION ' + j}</button></div>
      ${emptyState('bi-tools', 'Menu ini sedang dalam pengembangan',
        `Layanan <b>${esc(item.submenu)}</b> untuk BION ${j} belum tersedia. Silakan cek kembali nanti atau hubungi staf kami.`,
        `<div class="d-flex gap-2 justify-content-center flex-wrap">
          <button class="btn-brand" onclick="${backJs(j, from)}"><i class="bi bi-grid"></i> Menu lain</button>
          <button class="btn-wa" onclick="openCsSheet('${j}')"><i class="bi bi-whatsapp"></i> Tanya staf</button></div>`)}
    </div>`;
    return;
  }

  // FR-03: tampilkan di iframe + tombol Kembali & Buka di tab baru
  document.body.classList.add('mode-frame');
  const url = esc(item.url);
  app().innerHTML = `
  <div class="frame-shell">
    <div class="frame-bar">
      <button class="frame-btn icon" onclick="${backJs(j, from)}" aria-label="Kembali"><i class="bi bi-arrow-left"></i></button>
      <div class="frame-title"><span class="ft-sub">BION ${j}</span><span class="ft-main">${esc(item.submenu)}</span></div>
      <a class="frame-btn" href="${url}" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right"></i><span class="d-none d-sm-inline">Buka di tab baru</span><span class="d-sm-none">Tab baru</span></a>
    </div>
    <div class="frame-wrap">
      <div class="frame-loading" id="frameLoading"><div class="loader-ring"></div><div class="fw-semibold">Memuat ${esc(item.submenu)}…</div><div class="body-sm">Halaman pertama kali bisa butuh beberapa detik.</div></div>
      <iframe id="layananFrame" title="${esc(item.submenu)} BION ${j}" src="${url}"
        allow="clipboard-write; fullscreen; camera; microphone; autoplay" referrerpolicy="no-referrer-when-downgrade"></iframe>
      <div class="frame-help" id="frameHelp">
        <div class="card-x fh-card">
          <div class="empty-illus" style="width:72px;height:72px;font-size:30px"><i class="bi bi-wifi-off"></i></div>
          <h2 class="h-md">Halaman belum tampil?</h2>
          <p class="body-sm my-2">Beberapa layanan meminta login Google atau diblokir peramban saat dibuka di dalam portal. Buka di tab baru agar tampil normal.</p>
          <div class="d-flex gap-2 justify-content-center flex-wrap mt-3">
            <a class="btn-brand text-decoration-none" href="${url}" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right"></i> Buka di tab baru</a>
            <button class="btn-soft" onclick="document.getElementById('frameHelp').classList.remove('show')">Tetap di sini</button>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  const frame = $('#layananFrame');
  frame.addEventListener('load', () => {
    clearTimeout(State.frameTimer);
    const ld = $('#frameLoading'); if (ld) ld.remove();
  });
  State.frameTimer = setTimeout(() => {
    const ld = $('#frameLoading'); if (ld) ld.remove();
    const help = $('#frameHelp'); if (help) help.classList.add('show');
  }, FRAME_TIMEOUT_MS);
}

function viewPengumuman({ j = '' }) {
  const list = pengumumanFor(j);
  app().innerHTML = `
  <div class="container-app">
    <div class="section-head" style="margin-top:1.25rem">
      <div><h1 class="h-lg">Pengumuman</h1><p class="body-sm">${j ? 'Untuk BION ' + j + ' & semua jenjang' : 'Semua informasi resmi BION'}</p></div>
    </div>
    <div class="chip-row mb-3" role="tablist" aria-label="Filter jenjang">
      <button class="chip t-Semua ${!j ? 'active' : ''}" onclick="navigateTo('pengumuman',{},{replace:true})">Semua</button>
      ${JENJANG_LIST.map(x => `<button class="chip t-${x} ${j === x ? 'active' : ''}" onclick="navigateTo('pengumuman',{j:'${x}'},{replace:true})"><span class="dot"></span>BION ${x}</button>`).join('')}
    </div>
    ${list.length ? `<div class="ann-list grid">${list.map(p => annCard(p)).join('')}</div>`
      : emptyState('bi-megaphone', 'Belum ada pengumuman', j ? `Belum ada pengumuman untuk BION ${j}.` : 'Pengumuman akan tampil di sini.')}
  </div>`;
}

function openPengumuman(id) {
  const p = (State.data.pengumuman || []).find(x => x.id === id)
    || (State.staffData ? State.staffData.pengumuman.find(x => x.id === id) : null);
  if (!p) return;
  $('#detailTitle').textContent = p.judul;
  $('#detailBody').innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
      <span class="pill t-${esc(p.jenjang)}">${p.jenjang === 'Semua' ? 'Semua Jenjang' : 'BION ' + esc(p.jenjang)}</span>
      <span class="body-sm"><i class="bi bi-calendar3"></i> ${esc(fmtTanggal(p.tanggal))}</span>
    </div>
    ${p.foto ? `<img class="detail-img" src="${driveThumb(p.foto, 1200)}" alt="Foto pengumuman" onclick="previewFoto('${esc(p.foto)}','${esc(p.judul).replace(/'/g, '')}')">` : ''}
    <div class="detail-text">${linkify(p.isi)}</div>
    ${p.pdf ? `<div class="pdf-row"><i class="bi bi-file-earmark-pdf-fill"></i>
      <div class="flex-grow-1"><div class="fw-bold">Lampiran PDF</div><div class="body-sm">Lihat atau unduh dokumen</div></div>
      <button class="btn-soft btn-xs" onclick="previewPdf('${esc(p.pdf)}','${esc(p.judul).replace(/'/g, '')}')"><i class="bi bi-eye"></i> Lihat</button>
      <a class="btn-brand btn-xs text-decoration-none" href="${esc(driveDownload(p.pdf))}" target="_blank" rel="noopener"><i class="bi bi-download"></i></a></div>` : ''}`;
  modal('detailModal').show();
}

/** Pratinjau foto ukuran penuh dalam modal (bukan tab baru). */
function previewFoto(url, judul) {
  $('#previewTitle').textContent = judul || 'Foto';
  $('#previewBody').innerHTML = `<img src="${driveThumb(url, 2000)}" alt="${esc(judul)}">`;
  $('#previewDownload').href = driveDownload(url);
  modal('previewModal').show();
}
function previewPdf(url, judul) {
  $('#previewTitle').textContent = (judul || 'Dokumen') + ' (PDF)';
  $('#previewBody').innerHTML = `<iframe src="${esc(drivePreview(url))}" title="Pratinjau PDF" allow="autoplay"></iframe>`;
  $('#previewDownload').href = driveDownload(url);
  modal('previewModal').show();
}
document.addEventListener('hidden.bs.modal', (e) => { if (e.target.id === 'previewModal') $('#previewBody').innerHTML = ''; });

function contactCard(k) {
  const umum = !JENJANG_LIST.includes(k.jenjang);
  return `<div class="card-x contact-card t-${umum ? 'Semua' : esc(k.jenjang)}">
    <div class="contact-avatar">${umum ? '<i class="bi bi-headset"></i>' : esc(k.jenjang)}</div>
    <div class="min-w-0"><div class="cc-name">${esc(k.nama)}</div><div class="cc-num">${umum ? 'Pengembang aplikasi' : 'BION ' + esc(k.jenjang)} · +${esc(k.wa)}</div></div>
    <a class="btn-wa" href="${waLink(k.wa, umum ? '' : k.jenjang)}" target="_blank" rel="noopener" aria-label="Hubungi ${esc(k.nama)} via WhatsApp">
      <i class="bi bi-whatsapp"></i><span class="d-none d-sm-inline">Hubungi</span></a>
  </div>`;
}

function viewKontak({ j = '' }) {
  const groups = (j ? [j] : JENJANG_LIST).map(x => ({ j: x, list: kontakFor(x) }));
  app().innerHTML = `
  <div class="container-app">
    <div class="section-head" style="margin-top:1.25rem">
      <div><h1 class="h-lg">Kontak Staf</h1><p class="body-sm">Ketuk tombol WhatsApp untuk mulai bertanya</p></div>
    </div>
    <div class="chip-row mb-2" role="tablist" aria-label="Filter jenjang">
      <button class="chip t-Semua ${!j ? 'active' : ''}" onclick="navigateTo('kontak',{},{replace:true})">Semua</button>
      ${JENJANG_LIST.map(x => `<button class="chip t-${x} ${j === x ? 'active' : ''}" onclick="navigateTo('kontak',{j:'${x}'},{replace:true})"><span class="dot"></span>BION ${x}</button>`).join('')}
    </div>
    ${groups.map(g => `
      <div class="contact-group-title t-${g.j}"><span class="pill t-${g.j}">BION ${g.j}</span><span class="body-sm">${g.list.length} kontak</span></div>
      ${g.list.length ? `<div class="contact-grid">${g.list.map(contactCard).join('')}</div>`
        : `<div class="card-x p-3 body-sm"><i class="bi bi-info-circle"></i> Kontak staff belum tersedia untuk BION ${g.j}.</div>`}
    `).join('')}
  </div>`;
}

/** Bottom sheet "Tanya CS": kontak jenjang aktif ditampilkan paling atas. */
function openCsSheet(jPrioritas) {
  if (!State.data) return;
  const aktif = jPrioritas || document.body.dataset.jenjang || lsGet(LS_LAST) || '';
  const urut = aktif ? [aktif].concat(JENJANG_LIST.filter(x => x !== aktif)) : JENJANG_LIST;
  const cs = State.data.app.csWhatsApp;
  let html = urut.map(x => {
    const list = kontakFor(x);
    return list.length ? `<div class="contact-group-title"><span class="pill t-${x}">BION ${x}</span></div>
      <div class="contact-grid" style="grid-template-columns:1fr">${list.map(contactCard).join('')}</div>` : '';
  }).join('');
  if (cs) html += `<div class="contact-group-title"><span class="pill">Pengembang Aplikasi</span></div>
    <div class="contact-grid" style="grid-template-columns:1fr">${contactCard({ jenjang: 'Umum', nama: 'Hubungi Pengembang Aplikasi', wa: cs })}</div>`;
  $('#csBody').innerHTML = html || '<p class="body-sm mb-0">Kontak staf belum tersedia.</p>';
  modal('csModal').show();
}

// ════════════════════════════════════════════════════════
// BAGIAN 7: MUAT DATA PORTAL (localStorage → server)
// ════════════════════════════════════════════════════════

function loadPortalData(silent = false) {
  return callServer('getPortalData').then(res => {
    if (!res || !res.success) throw new Error(res ? res.message : 'Respons kosong');
    State.data = res.data;
    lsSet(LS_DATA, JSON.stringify(res.data));
    applyIdentity();
    // Jangan muat ulang iframe yang sedang dibuka pengguna / panel staf
    const skip = (State.route.name === 'layanan' && $('#layananFrame')) || State.route.name === 'staf';
    if (!skip) render();
  }).catch(err => {
    if (!State.data) {
      app().innerHTML = `<div class="container-app py-4">${emptyState('bi-cloud-slash', 'Portal gagal dimuat',
        'Periksa koneksi internet Anda lalu coba lagi. ' + esc(err.message),
        '<button class="btn-brand" onclick="location.reload()"><i class="bi bi-arrow-clockwise"></i> Coba lagi</button>')}</div>`;
    } else if (!silent) {
      showToast('Mode offline', 'Menampilkan data terakhir yang tersimpan.', 'warning');
    }
  });
}

// ════════════════════════════════════════════════════════
// BAGIAN 8: PANEL STAF
// ════════════════════════════════════════════════════════

function viewStaf() {
  if (State.staff && State.staffData) return renderStaffPanel();
  if (!State.token) State.token = ssGet(SS_TOKEN);
  app().innerHTML = `<div class="container-app py-5 text-center"><div class="loader-ring mx-auto"></div><p class="body-sm mt-3">Memeriksa sesi staf…</p></div>`;
  callServer('getStaffSession', State.token).then(res => {
    if (State.route.name !== 'staf') return;
    if (!res.success) { setToken(''); return renderLogin(res.message); }
    setToken(res.data.token);
    State.staff = res.data;
    return loadStaffData();
  }).catch(err => renderLogin(err.message));
}

/** Form login staf: email + kata sandi yang diatur Admin Utama di menu Kelola Staf. */
function renderLogin(pesan) {
  app().innerHTML = `<div class="container-app"><div class="card-x denied" style="text-align:left">
    <div class="empty-illus"><i class="bi bi-shield-lock-fill"></i></div>
    <h1 class="h-md text-center">Masuk Panel Staf</h1>
    <p class="body-sm text-center mt-1 mb-3">Hanya akun yang terdaftar & aktif di menu <b>Kelola Staf</b> yang dapat masuk.</p>
    ${pesan ? `<div class="pill pill-arsip d-flex mb-3" style="white-space:normal;border-radius:12px;padding:.6rem .85rem"><i class="bi bi-info-circle"></i> ${esc(pesan)}</div>` : ''}
    <form id="formLogin" novalidate onsubmit="submitLogin(event)">
      <label class="form-label" for="lgEmail">Email</label>
      <input type="email" class="form-control mb-3" id="lgEmail" name="email" required autocomplete="username" placeholder="nama@contoh.com">
      <label class="form-label" for="lgPass">Kata sandi</label>
      <div class="d-flex gap-2 mb-3">
        <input type="password" class="form-control" id="lgPass" name="password" required minlength="8" autocomplete="current-password">
        <button type="button" class="btn-soft" style="min-width:44px" onclick="const i=$('#lgPass');i.type=i.type==='password'?'text':'password'" aria-label="Tampilkan kata sandi"><i class="bi bi-eye"></i></button>
      </div>
      <button type="submit" class="btn-brand w-100" id="btnLogin"><i class="bi bi-box-arrow-in-right"></i> Masuk</button>
    </form>
    <p class="body-sm text-center mt-3 mb-0">Lupa kata sandi? Hubungi Admin Utama untuk mengatur ulang.</p>
    <div class="text-center mt-3"><button class="btn-soft btn-xs" onclick="navigateTo('beranda')"><i class="bi bi-house"></i> Kembali ke beranda</button></div>
  </div></div>`;
  setTimeout(() => { const e = $('#lgEmail'); if (e) e.focus(); }, 50);
}

function submitLogin(ev) {
  ev.preventDefault();
  const f = ev.target;
  f.querySelectorAll('.form-control').forEach(x => x.classList.toggle('is-invalid', !x.checkValidity()));
  if (!f.checkValidity()) return showToast('Periksa isian', 'Masukkan email dan kata sandi (min. 8 karakter).', 'warning');
  withBtn($('#btnLogin'), 'Memeriksa…', () => callServer('loginStaff', f.email.value.trim(), f.password.value).then(res => {
    if (!res.success) { showToast('Gagal masuk', res.message, 'danger'); f.password.value = ''; return; }
    setToken(res.data.token);
    State.staff = res.data;
    showToast('Berhasil', res.message, 'success');
    return loadStaffData();
  })).catch(e => showToast('Error', e.message, 'danger'));
}

function logoutStaf() {
  const t = State.token;
  setToken(''); State.staff = null; State.staffData = null; State.staffTab = 'ringkasan';
  callServer('logoutStaff', t).catch(() => {});
  showToast('Keluar', 'Anda telah keluar dari panel staf.', 'info');
  renderLogin('');
}

function loadStaffData() {
  return callStaff('getStaffData').then(res => {
    if (!res.success) throw new Error(res.message);
    State.staffData = res.data;
    if (State.route.name === 'staf') renderStaffPanel();
  }).catch(err => {
    showToast('Gagal memuat panel', err.message, 'danger');
    State.staff = null; State.staffData = null;
    renderLogin(err.message);
  });
}

/** Setelah menyimpan: muat ulang data panel + data portal publik. */
async function afterSave(res) {
  if (!res || !res.success) { showToast('Gagal', res ? res.message : 'Tidak ada respons', 'danger'); return false; }
  showToast('Berhasil', res.message, 'success');
  State.staffEdit = null;
  await Promise.all([loadStaffData(), loadPortalData(true)]);
  return true;
}

const STAFF_TABS = [
  { id: 'ringkasan', label: 'Ringkasan', icon: 'bi-speedometer2' },
  { id: 'pengumuman', label: 'Pengumuman', icon: 'bi-megaphone' },
  { id: 'link', label: 'Link Menu', icon: 'bi-link-45deg' },
  { id: 'kontak', label: 'Kontak', icon: 'bi-whatsapp' },
  { id: 'staf', label: 'Kelola Staf', icon: 'bi-people', admin: true },
  { id: 'pengaturan', label: 'Pengaturan', icon: 'bi-gear', admin: true },
  { id: 'akun', label: 'Akun Saya', icon: 'bi-person-circle' }
];
const isAdmin = () => State.staff && State.staff.peran === 'Admin Utama';

function setStaffTab(tab) { State.staffTab = tab; State.staffEdit = null; renderStaffPanel(); }

function renderStaffPanel() {
  destroyCharts();
  const s = State.staff;
  const tabs = STAFF_TABS.filter(t => !t.admin || isAdmin());
  if (!tabs.find(t => t.id === State.staffTab)) State.staffTab = 'ringkasan';
  app().innerHTML = `
  <div class="container-app">
    <div class="staff-head">
      <div class="staff-user"><span class="av">${esc((s.nama || s.email).charAt(0).toUpperCase())}</span>
        <div><div class="fw-bold">${esc(s.nama)}</div><div class="body-sm">${esc(s.email)} · ${esc(s.peran)}</div></div></div>
      <div class="d-flex gap-2">
        <button class="btn-soft btn-xs" onclick="refreshCache(this)"><i class="bi bi-arrow-repeat"></i> Segarkan portal</button>
        <button class="btn-soft btn-xs" onclick="navigateTo('beranda')"><i class="bi bi-eye"></i> Lihat portal</button>
        <button class="btn-danger-soft btn-xs" onclick="logoutStaf()"><i class="bi bi-box-arrow-right"></i> Keluar</button>
      </div>
    </div>
    <div class="staff-tabs" role="tablist">
      ${tabs.map(t => `<button class="staff-tab ${State.staffTab === t.id ? 'active' : ''}" role="tab" aria-selected="${State.staffTab === t.id}" onclick="setStaffTab('${t.id}')"><i class="bi ${t.icon}"></i>${t.label}</button>`).join('')}
    </div>
    <div id="staffBody"></div>
  </div>`;
  const body = $('#staffBody');
  ({ ringkasan: tabRingkasan, pengumuman: tabPengumuman, link: tabLink, kontak: tabKontak, staf: tabStaf, pengaturan: tabPengaturan, akun: tabAkun }[State.staffTab])(body);
}

function refreshCache(btn) {
  withBtn(btn, 'Menyegarkan…', () => callStaff('refreshPortalCache').then(afterSave))
    .catch(e => showToast('Error', e.message, 'danger'));
}

// ── Tab: Ringkasan (KPI + grafik + insight) ──
function tabRingkasan(el) {
  const r = State.staffData.ringkasan;
  const siap = JENJANG_LIST.reduce((n, j) => n + r.perJenjang[j].linkTersedia, 0);
  const total = JENJANG_LIST.reduce((n, j) => n + r.perJenjang[j].linkTotal, 0);
  el.innerHTML = `
    <div class="kpi-grid">
      <div class="card-x kpi t-SMP"><div class="kpi-ic"><i class="bi bi-megaphone-fill"></i></div><div class="kpi-val">${r.totalTayang}</div><div class="kpi-lbl">Pengumuman tayang</div></div>
      <div class="card-x kpi t-SD"><div class="kpi-ic"><i class="bi bi-archive-fill"></i></div><div class="kpi-val">${r.totalArsip}</div><div class="kpi-lbl">Pengumuman arsip</div></div>
      <div class="card-x kpi t-SMA"><div class="kpi-ic"><i class="bi bi-link-45deg"></i></div><div class="kpi-val">${siap}/${total}</div><div class="kpi-lbl">Layanan berlink</div></div>
      <div class="card-x kpi"><div class="kpi-ic" style="color:var(--wa)"><i class="bi bi-whatsapp"></i></div><div class="kpi-val">${r.totalKontak}</div><div class="kpi-lbl">Kontak WA aktif</div></div>
    </div>
    <div class="row g-3 mt-1">
      <div class="col-lg-7"><div class="card-x chart-box"><h2 class="h-sm mb-2">Kesiapan per jenjang</h2><canvas id="chartJenjang" aria-label="Grafik kesiapan layanan per jenjang" role="img"></canvas></div></div>
      <div class="col-lg-5"><div class="insight"><h3><i class="bi bi-stars"></i> Analisis otomatis</h3><ul>${r.insight.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div></div>
    </div>`;
  loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js').then(() => {
    const ctx = $('#chartJenjang'); if (!ctx) return;
    const cs = getComputedStyle(document.documentElement);
    State.charts.jenjang = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: JENJANG_LIST.map(j => 'BION ' + j),
        datasets: [
          { label: 'Layanan berlink', data: JENJANG_LIST.map(j => r.perJenjang[j].linkTersedia), backgroundColor: JENJANG_LIST.map(j => cs.getPropertyValue('--' + j.toLowerCase()).trim()), borderRadius: 8 },
          { label: 'Kontak WA', data: JENJANG_LIST.map(j => r.perJenjang[j].kontak), backgroundColor: '#25D366', borderRadius: 8 },
          { label: 'Pengumuman tayang', data: JENJANG_LIST.map(j => r.perJenjang[j].pengumuman), backgroundColor: '#94A3B8', borderRadius: 8 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: true, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } } }
    });
    styleChart(State.charts.jenjang); State.charts.jenjang.update();
  }).catch(e => showToast('Grafik', e.message, 'warning'));
}
function styleChart(chart) {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const txt = dark ? '#CBD5E1' : '#475569', grid = dark ? 'rgba(148,163,184,.15)' : 'rgba(148,163,184,.25)';
  chart.options.plugins.legend.labels = { color: txt, font: { family: 'Plus Jakarta Sans' } };
  ['x', 'y'].forEach(a => { chart.options.scales[a].ticks.color = txt; chart.options.scales[a].grid = { color: grid }; });
}
function destroyCharts() { Object.values(State.charts).forEach(c => { try { c.destroy(); } catch (e) {} }); State.charts = {}; }

// ── Tab: Pengumuman (FR-08) ──
function tabPengumuman(el) {
  if (State.staffEdit && State.staffEdit.type === 'pengumuman') return formPengumuman(el, State.staffEdit.item);
  const f = State.staffFilter.pengumuman;
  const list = State.staffData.pengumuman.filter(p => f === 'Semua' || p.status === f);
  el.innerHTML = `
    <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-3">
      <div class="chip-row">${['Semua', 'Tayang', 'Arsip'].map(x => `<button class="chip ${f === x ? 'active' : ''}" onclick="State.staffFilter.pengumuman='${x}';renderStaffPanel()">${x}</button>`).join('')}</div>
      <button class="btn-brand" onclick="editItem('pengumuman', null)"><i class="bi bi-plus-lg"></i> Buat pengumuman</button>
    </div>
    ${list.length ? `<div class="row-list">${list.map(p => `
      <div class="card-x row-item">
        <div class="ri-main">
          <div class="d-flex gap-2 align-items-center mb-1 flex-wrap">
            <span class="pill t-${esc(p.jenjang)}">${esc(p.jenjang)}</span>
            <span class="pill ${p.status === 'Tayang' ? 'pill-ok' : 'pill-arsip'}">${esc(p.status)}</span>
            ${new Date(p.tanggal) > new Date() ? '<span class="pill pill-wait"><i class="bi bi-clock"></i> Terjadwal</span>' : ''}
            ${p.foto ? '<i class="bi bi-image text-muted" title="Ada foto"></i>' : ''}${p.pdf ? '<i class="bi bi-file-earmark-pdf text-muted" title="Ada PDF"></i>' : ''}
          </div>
          <div class="ri-title">${esc(p.judul)}</div>
          <div class="ri-sub">${esc(fmtTanggal(p.tanggal))} · diubah ${esc(p.diubah_oleh || p.dibuat_oleh)}</div>
        </div>
        <div class="ri-actions">
          <button class="btn-soft btn-xs" onclick="editItem('pengumuman','${esc(p.id)}')"><i class="bi bi-pencil"></i> Ubah</button>
          <button class="btn-soft btn-xs" onclick="toggleStatusPengumuman('${esc(p.id)}','${p.status === 'Tayang' ? 'Arsip' : 'Tayang'}',this)">
            <i class="bi ${p.status === 'Tayang' ? 'bi-archive' : 'bi-broadcast'}"></i> ${p.status === 'Tayang' ? 'Arsipkan' : 'Tayangkan'}</button>
          <button class="btn-danger-soft btn-xs" onclick="hapusPengumuman('${esc(p.id)}')" aria-label="Hapus"><i class="bi bi-trash"></i></button>
        </div>
      </div>`).join('')}</div>` : emptyState('bi-megaphone', 'Belum ada pengumuman', 'Klik "Buat pengumuman" untuk menambahkan.')}`;
}

function editItem(type, id) {
  const src = { pengumuman: State.staffData.pengumuman, kontak: State.staffData.kontak }[type] || [];
  State.staffEdit = { type, item: id ? src.find(x => x.id === id) : null };
  renderStaffPanel();
  window.scrollTo({ top: 0 });
}

function toDatetimeLocal(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formPengumuman(el, p) {
  p = p || { judul: '', isi: '', jenjang: 'Semua', status: 'Tayang', tanggal: '', foto: '', pdf: '' };
  State.upload = { foto: null, pdf: null, fotoPreview: '', hapusFoto: false, hapusPdf: false };
  el.innerHTML = `
  <form id="formAnn" class="card-x p-3 p-md-4" novalidate onsubmit="submitPengumuman(event)">
    <div class="d-flex align-items-center gap-2 mb-3">
      <button type="button" class="btn-soft btn-xs" onclick="State.staffEdit=null;renderStaffPanel()"><i class="bi bi-arrow-left"></i></button>
      <h2 class="h-md">${p.id ? 'Ubah pengumuman' : 'Pengumuman baru'}</h2>
    </div>
    <div class="row g-3">
      <div class="col-12"><label class="form-label" for="fJudul">Judul</label>
        <input class="form-control" id="fJudul" name="judul" required minlength="5" maxlength="150" value="${esc(p.judul)}" placeholder="Contoh: Jadwal Tryout Akbar PTS Genap">
        <div class="invalid-feedback">Judul minimal 5 karakter.</div></div>
      <div class="col-12"><label class="form-label" for="fIsi">Isi pengumuman</label>
        <textarea class="form-control" id="fIsi" name="isi" rows="7" required minlength="10" maxlength="5000" placeholder="Tulis isi pengumuman. Link https:// otomatis bisa diklik.">${esc(p.isi)}</textarea>
        <div class="invalid-feedback">Isi minimal 10 karakter.</div></div>
      <div class="col-sm-4"><label class="form-label" for="fJenjang">Jenjang tujuan</label>
        <select class="form-select" id="fJenjang" name="jenjang">${['Semua', ...JENJANG_LIST].map(x => `<option ${p.jenjang === x ? 'selected' : ''} value="${x}">${x === 'Semua' ? 'Semua jenjang' : 'BION ' + x}</option>`).join('')}</select></div>
      <div class="col-sm-4"><label class="form-label" for="fTanggal">Tanggal & jam tayang</label>
        <input type="datetime-local" class="form-control" id="fTanggal" name="tanggal" value="${toDatetimeLocal(p.tanggal)}">
        <div class="form-text">Isi waktu mendatang untuk menjadwalkan.</div></div>
      <div class="col-sm-4"><label class="form-label" for="fStatus">Status</label>
        <select class="form-select" id="fStatus" name="status"><option ${p.status === 'Tayang' ? 'selected' : ''}>Tayang</option><option ${p.status === 'Arsip' ? 'selected' : ''}>Arsip</option></select></div>
      <div class="col-md-6"><label class="form-label">Foto (opsional)</label>
        <div class="upload-box" id="boxFoto">${uploadBoxFoto(p.foto)}</div>
        <input type="file" id="inFoto" accept="image/jpeg,image/png,image/webp" class="d-none" onchange="pilihFoto(this)">
        <div class="form-text">Dikompres otomatis sebelum diunggah (maks. 5 MB).</div></div>
      <div class="col-md-6"><label class="form-label">PDF (opsional)</label>
        <div class="upload-box" id="boxPdf">${uploadBoxPdf(p.pdf)}</div>
        <input type="file" id="inPdf" accept="application/pdf" class="d-none" onchange="pilihPdf(this)">
        <div class="form-text">Maksimal 5 MB.</div></div>
    </div>
    <div id="annPreview" class="mt-3"></div>
    <div class="d-flex gap-2 justify-content-end flex-wrap mt-3">
      <button type="button" class="btn-soft" onclick="pratinjauPengumuman()"><i class="bi bi-eye"></i> Pratinjau</button>
      <button type="submit" class="btn-brand" id="btnSaveAnn"><i class="bi bi-check2-circle"></i> Simpan</button>
    </div>
  </form>`;
  State.editOriginal = p;
}

function uploadBoxFoto(url, localSrc) {
  const has = localSrc || (url && !State.upload.hapusFoto);
  return has ? `<img src="${localSrc || driveThumb(url, 200)}" alt=""><div class="flex-grow-1 body-sm">${localSrc ? 'Foto baru siap diunggah' : 'Foto terpasang'}</div>
      <button type="button" class="btn-soft btn-xs" onclick="$('#inFoto').click()">Ganti</button>
      <button type="button" class="btn-danger-soft btn-xs" onclick="hapusLampiran('foto')" aria-label="Hapus foto"><i class="bi bi-x-lg"></i></button>`
    : `<span class="ub-icon"><i class="bi bi-image"></i></span><div class="flex-grow-1 body-sm">Belum ada foto</div>
      <button type="button" class="btn-soft btn-xs" onclick="$('#inFoto').click()"><i class="bi bi-upload"></i> Pilih</button>`;
}
function uploadBoxPdf(url, localName) {
  const has = localName || (url && !State.upload.hapusPdf);
  return has ? `<span class="ub-icon" style="color:var(--danger)"><i class="bi bi-file-earmark-pdf-fill"></i></span><div class="flex-grow-1 body-sm text-truncate">${esc(localName || 'PDF terpasang')}</div>
      <button type="button" class="btn-soft btn-xs" onclick="$('#inPdf').click()">Ganti</button>
      <button type="button" class="btn-danger-soft btn-xs" onclick="hapusLampiran('pdf')" aria-label="Hapus PDF"><i class="bi bi-x-lg"></i></button>`
    : `<span class="ub-icon"><i class="bi bi-file-earmark-pdf"></i></span><div class="flex-grow-1 body-sm">Belum ada PDF</div>
      <button type="button" class="btn-soft btn-xs" onclick="$('#inPdf').click()"><i class="bi bi-upload"></i> Pilih</button>`;
}
function hapusLampiran(jenis) {
  if (jenis === 'foto') { State.upload.foto = null; State.upload.fotoPreview = ''; State.upload.hapusFoto = true; $('#boxFoto').innerHTML = uploadBoxFoto(''); $('#inFoto').value = ''; }
  else { State.upload.pdf = null; State.upload.hapusPdf = true; $('#boxPdf').innerHTML = uploadBoxPdf(''); $('#inPdf').value = ''; }
}

/** Kompres foto di browser (maks. 1600 px, JPEG 82%) sebelum dikirim ke server. */
function compressImage(file, maxSide = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca foto.'));
    reader.onload = () => { img.src = reader.result; };
    img.onerror = () => reject(new Error('Format foto tidak dikenali.'));
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', quality);
      resolve({ dataUrl, base64: dataUrl.split(',')[1] });
    };
    reader.readAsDataURL(file);
  });
}

async function pilihFoto(input) {
  const file = input.files[0]; if (!file) return;
  try {
    const { dataUrl, base64 } = await compressImage(file);
    if (base64.length * 0.75 > MAKS_BERKAS) throw new Error('Foto masih lebih dari 5 MB setelah dikompres.');
    State.upload.foto = { base64, nama: file.name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg' };
    State.upload.fotoPreview = dataUrl; State.upload.hapusFoto = false;
    $('#boxFoto').innerHTML = uploadBoxFoto('', dataUrl);
  } catch (e) { showToast('Foto', e.message, 'warning'); input.value = ''; }
}
function pilihPdf(input) {
  const file = input.files[0]; if (!file) return;
  if (file.type !== 'application/pdf') { showToast('PDF', 'Berkas harus berformat PDF.', 'warning'); input.value = ''; return; }
  if (file.size > MAKS_BERKAS) { showToast('PDF', 'Ukuran PDF maksimal 5 MB.', 'warning'); input.value = ''; return; }
  const r = new FileReader();
  r.onload = () => {
    State.upload.pdf = { base64: r.result.split(',')[1], nama: file.name, mime: 'application/pdf' };
    State.upload.hapusPdf = false;
    $('#boxPdf').innerHTML = uploadBoxPdf('', file.name);
  };
  r.readAsDataURL(file);
}

function bacaFormPengumuman() {
  const f = $('#formAnn');
  f.querySelectorAll('.form-control').forEach(x => x.classList.toggle('is-invalid', !x.checkValidity()));
  if (!f.checkValidity()) return null;
  const tgl = f.tanggal.value ? new Date(f.tanggal.value).toISOString() : new Date().toISOString();
  return { judul: f.judul.value.trim(), isi: f.isi.value.trim(), jenjang: f.jenjang.value, status: f.status.value, tanggal_terbit: tgl };
}

function pratinjauPengumuman() {
  const v = bacaFormPengumuman(); if (!v) return showToast('Periksa form', 'Lengkapi judul dan isi terlebih dahulu.', 'warning');
  const o = State.editOriginal || {};
  const fotoAda = State.upload.fotoPreview || (o.foto && !State.upload.hapusFoto);
  const p = { id: 'preview', judul: v.judul, isi: v.isi, jenjang: v.jenjang, tanggal: v.tanggal_terbit,
    foto: fotoAda ? (o.foto || 'x') : '', pdf: State.upload.pdf || (o.pdf && !State.upload.hapusPdf) ? 'x' : '' };
  $('#annPreview').innerHTML = `<div class="label-sm text-muted mb-2">Pratinjau di portal</div><div class="preview-ann" style="max-width:420px">${annCard(p, { preview: true, localFoto: State.upload.fotoPreview || '' })}</div>`;
}

async function submitPengumuman(ev) {
  ev.preventDefault();
  const v = bacaFormPengumuman();
  if (!v) return showToast('Periksa form', 'Ada isian yang belum valid.', 'warning');
  const o = State.editOriginal || {};
  const payload = Object.assign(v, { id: o.id || '', foto: State.upload.foto, pdf: State.upload.pdf,
    hapusFoto: State.upload.hapusFoto, hapusPdf: State.upload.hapusPdf });
  const label = payload.foto || payload.pdf ? 'Mengunggah…' : 'Menyimpan…';
  await withBtn($('#btnSaveAnn'), label, () => callStaff('savePengumuman', payload).then(afterSave))
    .catch(e => showToast('Error', e.message, 'danger'));
}

function toggleStatusPengumuman(id, status, btn) {
  withBtn(btn, '', () => callStaff('setStatusPengumuman', id, status).then(afterSave))
    .catch(e => showToast('Error', e.message, 'danger'));
}
async function hapusPengumuman(id) {
  if (!await confirmDialog('Hapus pengumuman?', 'Pengumuman beserta foto & PDF-nya akan dihapus permanen.', 'Hapus')) return;
  callStaff('deletePengumuman', id).then(afterSave).catch(e => showToast('Error', e.message, 'danger'));
}

// ── Tab: Link Menu (FR-09) ──
function tabLink(el) {
  const j = State.staffFilter.link;
  const rows = State.staffData.menu.filter(m => m.jenjang === j);
  el.innerHTML = `
    <div class="chip-row mb-3">${JENJANG_LIST.map(x => `<button class="chip t-${x} ${x === j ? 'active' : ''}" onclick="State.staffFilter.link='${x}';renderStaffPanel()"><span class="dot"></span>BION ${x}</button>`).join('')}</div>
    <div class="card-x p-3 mb-3 body-sm"><i class="bi bi-info-circle"></i> Kosongkan link agar menu tampil <b>"sedang dalam pengembangan"</b>.
      Untuk <b>Pengumuman</b> dan <b>Kontak Staff</b>, link kosong berarti portal memakai halaman bawaan (data dari tab Pengumuman & Kontak).</div>
    <div class="row-list">${rows.map(m => `
      <form class="card-x link-row" novalidate onsubmit="simpanLink(event,'${esc(m.id)}')">
        <div class="lr-head">
          <span class="fw-bold">${esc(m.submenu)}</span>
          ${m.url && m.aktif ? '<span class="pill pill-ok"><span class="dot"></span> Tayang</span>' : (['INFO', 'KONTAK'].includes(menuKode(m.id)) && m.aktif ? '<span class="pill">Halaman bawaan</span>' : '<span class="pill pill-wait">Dalam pengembangan</span>')}
          <span class="body-sm ms-auto">${m.diubah_oleh ? 'Diubah ' + esc(m.diubah_oleh) + ' · ' + esc(fmtTanggal(m.diubah_pada)) : ''}</span>
        </div>
        <div class="lr-form">
          <input type="url" class="form-control" name="url" value="${esc(m.url)}" placeholder="https://…" pattern="https://.+" aria-label="Link ${esc(m.submenu)}">
          <div class="form-check form-switch d-flex align-items-center gap-2 m-0 ps-5" style="min-height:44px">
            <input class="form-check-input" type="checkbox" name="aktif" id="ak-${esc(m.id)}" ${m.aktif ? 'checked' : ''}>
            <label class="form-check-label body-sm" for="ak-${esc(m.id)}">Aktif</label></div>
          ${m.url ? `<a class="btn-soft btn-xs text-decoration-none" href="${esc(m.url)}" target="_blank" rel="noopener" title="Uji link"><i class="bi bi-box-arrow-up-right"></i></a>` : ''}
          <button type="submit" class="btn-brand btn-xs"><i class="bi bi-save"></i> Simpan</button>
        </div>
        <div class="invalid-feedback">Link harus diawali https://</div>
      </form>`).join('')}</div>`;
}
function simpanLink(ev, id) {
  ev.preventDefault();
  const f = ev.target, url = f.url.value.trim();
  if (url && !/^https:\/\/\S+$/i.test(url)) { f.url.classList.add('is-invalid'); f.querySelector('.invalid-feedback').style.display = 'block'; return; }
  withBtn(f.querySelector('[type=submit]'), 'Menyimpan…', () => callStaff('saveMenuLink', id, url, f.aktif.checked).then(afterSave))
    .catch(e => showToast('Error', e.message, 'danger'));
}

// ── Tab: Kontak (FR-10) ──
function tabKontak(el) {
  const j = State.staffFilter.kontak;
  const edit = State.staffEdit && State.staffEdit.type === 'kontak' ? (State.staffEdit.item || { jenjang: j, aktif: true }) : null;
  const rows = State.staffData.kontak.filter(k => k.jenjang === j);
  el.innerHTML = `
    <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-3">
      <div class="chip-row">${JENJANG_LIST.map(x => `<button class="chip t-${x} ${x === j ? 'active' : ''}" onclick="State.staffFilter.kontak='${x}';State.staffEdit=null;renderStaffPanel()"><span class="dot"></span>BION ${x}</button>`).join('')}</div>
      <button class="btn-brand" onclick="editItem('kontak', null)"><i class="bi bi-plus-lg"></i> Tambah kontak</button>
    </div>
    ${edit ? `
    <form id="formKontak" class="card-x p-3 mb-3" novalidate onsubmit="simpanKontak(event)">
      <h2 class="h-sm mb-3">${edit.id ? 'Ubah kontak' : 'Kontak baru'}</h2>
      <div class="row g-3">
        <div class="col-md-5"><label class="form-label" for="kNama">Nama kontak</label>
          <input class="form-control" id="kNama" name="nama" required minlength="3" maxlength="80" value="${esc(edit.nama || '')}" placeholder="Contoh: BIKON KELAS 9">
          <div class="invalid-feedback">Minimal 3 karakter.</div></div>
        <div class="col-md-4"><label class="form-label" for="kWa">Nomor WhatsApp</label>
          <input class="form-control" id="kWa" name="wa" required inputmode="tel" value="${esc(edit.wa || '')}" placeholder="0813… atau 62813…" pattern="^(\\+?62|0|8)[0-9\\s-]{7,16}$">
          <div class="form-text">Otomatis diubah ke format 62…</div><div class="invalid-feedback">Nomor tidak valid.</div></div>
        <div class="col-md-3"><label class="form-label" for="kJenjang">Jenjang</label>
          <select class="form-select" id="kJenjang" name="jenjang">${JENJANG_LIST.map(x => `<option ${edit.jenjang === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="col-12 d-flex align-items-center gap-3 flex-wrap">
          <div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" id="kAktif" name="aktif" ${edit.aktif !== false ? 'checked' : ''}><label class="form-check-label" for="kAktif">Tampil di portal</label></div>
          <div class="ms-auto d-flex gap-2"><button type="button" class="btn-soft" onclick="State.staffEdit=null;renderStaffPanel()">Batal</button>
          <button type="submit" class="btn-brand" id="btnSaveKontak"><i class="bi bi-check2-circle"></i> Simpan</button></div>
        </div>
      </div>
    </form>` : ''}
    ${rows.length ? `<div class="row-list">${rows.map((k, i) => `
      <div class="card-x row-item t-${esc(k.jenjang)}">
        <div class="contact-avatar" style="${k.aktif ? '' : 'opacity:.4'}">${i + 1}</div>
        <div class="ri-main"><div class="ri-title">${esc(k.nama)} ${k.aktif ? '' : '<span class="pill pill-wait ms-1">Nonaktif</span>'}</div><div class="ri-sub">+${esc(k.wa)}</div></div>
        <div class="ri-actions">
          <button class="btn-soft btn-xs" ${i === 0 ? 'disabled' : ''} onclick="geserKontak('${esc(k.id)}',-1,this)" aria-label="Naikkan"><i class="bi bi-arrow-up"></i></button>
          <button class="btn-soft btn-xs" ${i === rows.length - 1 ? 'disabled' : ''} onclick="geserKontak('${esc(k.id)}',1,this)" aria-label="Turunkan"><i class="bi bi-arrow-down"></i></button>
          <a class="btn-soft btn-xs text-decoration-none" href="${waLink(k.wa, k.jenjang)}" target="_blank" rel="noopener" aria-label="Uji WhatsApp"><i class="bi bi-whatsapp"></i></a>
          <button class="btn-soft btn-xs" onclick="editItem('kontak','${esc(k.id)}')"><i class="bi bi-pencil"></i> Ubah</button>
          <button class="btn-danger-soft btn-xs" onclick="hapusKontak('${esc(k.id)}')" aria-label="Hapus"><i class="bi bi-trash"></i></button>
        </div>
      </div>`).join('')}</div>` : emptyState('bi-person-lines-fill', 'Belum ada kontak', `Tambahkan kontak WhatsApp untuk BION ${j}.`)}`;
}
function simpanKontak(ev) {
  ev.preventDefault();
  const f = ev.target;
  f.querySelectorAll('.form-control').forEach(x => x.classList.toggle('is-invalid', !x.checkValidity()));
  if (!f.checkValidity()) return;
  const edit = State.staffEdit.item || {};
  const data = { id: edit.id || '', nama: f.nama.value.trim(), wa: f.wa.value.trim(), jenjang: f.jenjang.value, aktif: f.aktif.checked };
  State.staffFilter.kontak = data.jenjang;
  withBtn($('#btnSaveKontak'), 'Menyimpan…', () => callStaff('saveKontak', data).then(afterSave))
    .catch(e => showToast('Error', e.message, 'danger'));
}
function geserKontak(id, arah, btn) {
  withBtn(btn, '', () => callStaff('moveKontak', id, arah).then(afterSave)).catch(e => showToast('Error', e.message, 'danger'));
}
async function hapusKontak(id) {
  if (!await confirmDialog('Hapus kontak?', 'Kontak ini tidak akan tampil lagi di portal.', 'Hapus')) return;
  callStaff('deleteKontak', id).then(afterSave).catch(e => showToast('Error', e.message, 'danger'));
}

// ── Tab: Kelola Staf (FR-11, Admin Utama) ──
function tabStaf(el) {
  const list = State.staffData.staffList || [];
  el.innerHTML = `
    <form class="card-x p-3 mb-3" novalidate onsubmit="simpanStaf(event)">
      <h2 class="h-sm mb-3">Tambah / ubah staf</h2>
      <div class="row g-3 align-items-end">
        <div class="col-md-6 col-lg-3"><label class="form-label" for="sEmail">Email</label>
          <input type="email" class="form-control" id="sEmail" name="email" required placeholder="nama@contoh.com"><div class="invalid-feedback">Email tidak valid.</div></div>
        <div class="col-md-6 col-lg-3"><label class="form-label" for="sNama">Nama</label><input class="form-control" id="sNama" name="nama" maxlength="80"></div>
        <div class="col-md-6 col-lg-2"><label class="form-label" for="sPeran">Peran</label>
          <select class="form-select" id="sPeran" name="peran"><option>Staff</option><option>Admin Utama</option></select></div>
        <div class="col-md-6 col-lg-2"><label class="form-label" for="sPass">Kata sandi</label>
          <input type="text" class="form-control" id="sPass" name="password" minlength="8" autocomplete="off" placeholder="min. 8 karakter"><div class="invalid-feedback">Minimal 8 karakter.</div></div>
        <div class="col-lg-2"><button type="submit" class="btn-brand w-100" id="btnSaveStaf"><i class="bi bi-person-plus"></i> Simpan</button></div>
      </div>
      <div class="form-text mt-2">Hanya email yang terdaftar & <b>Aktif</b> di daftar ini yang bisa masuk Panel Staf. Isi kata sandi untuk staf baru, atau untuk mengatur ulang sandi staf yang lupa. Kosongkan bila hanya mengubah nama/peran.</div>
    </form>
    <div class="row-list">${list.map(s => `
      <div class="card-x row-item">
        <div class="ri-main"><div class="ri-title">${esc(s.nama)} ${s.email === State.staff.email ? '<span class="pill ms-1">Anda</span>' : ''}</div><div class="ri-sub">${esc(s.email)}</div></div>
        <span class="pill ${s.peran === 'Admin Utama' ? 't-SMA' : ''}">${esc(s.peran)}</span>
        <span class="pill ${s.punyaSandi ? '' : 'pill-arsip'}" title="${s.punyaSandi ? 'Bisa masuk dengan email + kata sandi' : 'Belum bisa masuk dengan kata sandi'}"><i class="bi ${s.punyaSandi ? 'bi-key-fill' : 'bi-key'}"></i> ${s.punyaSandi ? 'Sandi diatur' : 'Belum ada sandi'}</span>
        <span class="pill ${s.aktif ? 'pill-ok' : 'pill-wait'}">${s.aktif ? 'Aktif' : 'Nonaktif'}</span>
        <div class="ri-actions">
          <button class="btn-soft btn-xs" onclick='isiFormStaf(${JSON.stringify(s).replace(/'/g, "&#39;")})'><i class="bi bi-pencil"></i></button>
          <button class="btn-soft btn-xs" onclick='toggleStaf(${JSON.stringify(s).replace(/'/g, "&#39;")},this)'>${s.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button>
          ${s.email !== State.staff.email ? `<button class="btn-danger-soft btn-xs" onclick="hapusStaf('${esc(s.email)}')" aria-label="Hapus"><i class="bi bi-trash"></i></button>` : ''}
        </div>
      </div>`).join('')}</div>`;
}
function isiFormStaf(s) { $('#sEmail').value = s.email; $('#sNama').value = s.nama; $('#sPeran').value = s.peran; $('#sPass').value = ''; $('#sPass').focus(); }
function simpanStaf(ev) {
  ev.preventDefault();
  const f = ev.target;
  f.querySelectorAll('.form-control').forEach(x => x.classList.toggle('is-invalid', !x.checkValidity()));
  if (!f.checkValidity()) return;
  const lama = (State.staffData.staffList || []).find(x => x.email === f.email.value.trim().toLowerCase());
  const data = { email: f.email.value.trim(), nama: f.nama.value.trim(), peran: f.peran.value,
    aktif: lama ? lama.aktif : true, password: f.password.value };
  withBtn($('#btnSaveStaf'), 'Menyimpan…', () => callStaff('saveStaff', data).then(afterSave)).catch(e => showToast('Error', e.message, 'danger'));
}
function toggleStaf(s, btn) {
  withBtn(btn, '', () => callStaff('saveStaff', Object.assign({}, s, { aktif: !s.aktif })).then(afterSave)).catch(e => showToast('Error', e.message, 'danger'));
}
async function hapusStaf(email) {
  if (!await confirmDialog('Hapus staf?', `${email} tidak akan bisa membuka panel staf lagi.`, 'Hapus')) return;
  callStaff('deleteStaff', email).then(afterSave).catch(e => showToast('Error', e.message, 'danger'));
}

// ── Tab: Akun Saya (ganti kata sandi sendiri) ──
function tabAkun(el) {
  const me = (State.staffData.staffList || []).find(x => x.email === State.staff.email);
  el.innerHTML = `
    <form class="card-x p-3 p-md-4" style="max-width:520px" novalidate onsubmit="gantiSandi(event)">
      <h2 class="h-sm mb-1">Ganti kata sandi</h2>
      <p class="body-sm mb-3">Kata sandi dipakai untuk masuk ke panel staf dari perangkat & akun Google mana pun.</p>
      <label class="form-label" for="pwLama">Kata sandi lama</label>
      <input type="password" class="form-control mb-1" id="pwLama" name="lama" autocomplete="current-password">
      <div class="form-text mb-3">Kosongkan jika akun Anda belum pernah memiliki kata sandi.</div>
      <label class="form-label" for="pwBaru">Kata sandi baru</label>
      <input type="password" class="form-control mb-3" id="pwBaru" name="baru" required minlength="8" autocomplete="new-password">
      <label class="form-label" for="pwUlang">Ulangi kata sandi baru</label>
      <input type="password" class="form-control mb-3" id="pwUlang" name="ulang" required minlength="8" autocomplete="new-password">
      <div class="invalid-feedback mb-2" id="pwErr">Kata sandi baru tidak sama.</div>
      <button type="submit" class="btn-brand" id="btnPw"><i class="bi bi-key"></i> Simpan kata sandi</button>
    </form>`;
}
function gantiSandi(ev) {
  ev.preventDefault();
  const f = ev.target;
  const sama = f.baru.value === f.ulang.value;
  f.baru.classList.toggle('is-invalid', !f.baru.checkValidity());
  f.ulang.classList.toggle('is-invalid', !sama);
  $('#pwErr').style.display = sama ? 'none' : 'block';
  if (!f.baru.checkValidity() || !sama) return;
  withBtn($('#btnPw'), 'Menyimpan…', () => callStaff('gantiPasswordSaya', f.lama.value, f.baru.value).then(res => {
    showToast(res.success ? 'Berhasil' : 'Gagal', res.message, res.success ? 'success' : 'danger');
    if (res.success) f.reset();
  })).catch(e => showToast('Error', e.message, 'danger'));
}

// ── Tab: Pengaturan (Admin Utama) ──
function tabPengaturan(el) {
  const c = State.staffData.config || {};
  el.innerHTML = `
    <form class="card-x p-3 p-md-4" novalidate onsubmit="simpanPengaturan(event)">
      <h2 class="h-sm mb-3">Identitas & alamat</h2>
      <div class="row g-3">
        <div class="col-md-6"><label class="form-label" for="cNama">Nama aplikasi</label><input class="form-control" id="cNama" name="appName" required maxlength="60" value="${esc(c.appName)}"></div>
        <div class="col-md-6"><label class="form-label" for="cTag">Tagline</label><input class="form-control" id="cTag" name="tagline" maxlength="80" value="${esc(c.tagline)}"></div>
        <div class="col-md-6"><label class="form-label" for="cLogo">URL logo</label><input type="url" class="form-control" id="cLogo" name="logoUrl" pattern="https://.+" value="${esc(c.logoUrl)}" placeholder="https://…">
          <div class="form-text">Logo persegi berlatar putih/transparan. Kosongkan untuk ikon bawaan.</div></div>
        <div class="col-md-6"><label class="form-label" for="cCs">WhatsApp CS umum</label><input class="form-control" id="cCs" name="csWhatsApp" inputmode="tel" value="${esc(c.csWhatsApp)}"></div>
        <div class="col-12"><label class="form-label" for="cStaf">Alamat portal (GitHub Pages)</label><input type="url" class="form-control" id="cStaf" name="staffPanelUrl" pattern="https://.+" value="${esc(c.staffPanelUrl)}" placeholder="https://username.github.io/portal-siswa-bion/">
          <div class="form-text">Catatan alamat resmi portal. Panel staf dibuka dengan menambahkan <code>#staf</code> di akhir alamat ini.</div></div>
      </div>
      <div class="d-flex gap-2 flex-wrap mt-4">
        <a class="btn-soft text-decoration-none" href="${esc(c.spreadsheetUrl)}" target="_blank" rel="noopener"><i class="bi bi-table"></i> Buka database</a>
        <a class="btn-soft text-decoration-none" href="${esc(c.lampiranUrl)}" target="_blank" rel="noopener"><i class="bi bi-folder2-open"></i> Folder lampiran</a>
        <button type="submit" class="btn-brand ms-auto" id="btnSaveCfg"><i class="bi bi-check2-circle"></i> Simpan pengaturan</button>
      </div>
    </form>`;
}
function simpanPengaturan(ev) {
  ev.preventDefault();
  const f = ev.target;
  f.querySelectorAll('.form-control').forEach(x => x.classList.toggle('is-invalid', !x.checkValidity()));
  if (!f.checkValidity()) return showToast('Periksa form', 'Link harus diawali https://', 'warning');
  const data = { appName: f.appName.value.trim(), tagline: f.tagline.value.trim(), logoUrl: f.logoUrl.value.trim(),
    csWhatsApp: f.csWhatsApp.value.trim(), staffPanelUrl: f.staffPanelUrl.value.trim() };
  withBtn($('#btnSaveCfg'), 'Menyimpan…', () => callStaff('saveConfig', data).then(afterSave)).catch(e => showToast('Error', e.message, 'danger'));
}

// ════════════════════════════════════════════════════════
// BAGIAN 9: INISIALISASI
// ════════════════════════════════════════════════════════

/** Tampilkan error JavaScript di layar (bukan hanya di console) agar mudah dilacak. */
function showFatal(msg) {
  if (State.data) return showToast('Error', msg, 'danger');
  const el = app();
  if (el) el.innerHTML = `<div class="container-app py-4"><div class="card-x empty"><div class="empty-illus"><i class="bi bi-bug"></i></div>
    <h2 class="h-md">Portal gagal dimuat</h2><p>${esc(msg)}</p>
    <button class="btn-brand" onclick="location.reload()"><i class="bi bi-arrow-clockwise"></i> Coba lagi</button></div></div>`;
}
window.addEventListener('error', (e) => showFatal((e.message || 'Error') + (e.lineno ? ' (baris ' + e.lineno + ')' : '')));
window.addEventListener('unhandledrejection', (e) => showFatal(String(e.reason && e.reason.message || e.reason)));

function boot() {
  if (boot.done) return; boot.done = true;
  applyTheme(lsGet(LS_THEME) === 'dark' ? 'dark' : 'light');
  $('#footerYear').textContent = new Date().getFullYear();

  // 1) Tampilkan salinan data terakhir (instan, sebelum server merespons)
  const cached = lsGet(LS_DATA);
  if (cached) { try { State.data = JSON.parse(cached); applyIdentity(); } catch (e) {} }

  // 2) Pulihkan rute dari hash (link langsung, misal …/#smp/join)
  State.route = hashToRoute(location.hash);
  try { history.replaceState(State.route, '', location.href); } catch (e) {}

  // 3) Tombol Back/Forward peramban & hash yang diketik manual (keduanya memicu popstate)
  window.addEventListener('popstate', (e) => {
    const r = e.state && e.state.name ? e.state : hashToRoute(location.hash);
    State.route = { name: r.name, params: r.params || {} };
    render();
  });

  render();
  loadPortalData(!!cached);

  // Pengaman: bila server tidak merespons 35 detik, tampilkan tombol coba lagi
  setTimeout(() => { if (!State.data && State.route.name !== 'staf') showFatal('Server lambat merespons. Periksa koneksi lalu coba lagi.'); }, 35000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
