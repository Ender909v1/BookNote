'use strict';

/* =========================================================
   BookNote — local notebook of books, fields and cards.
   Data lives in the browser's IndexedDB on this PC (fast, holds
   images, no size limit worth worrying about). Use "Backup all" /
   "Export" to write a .json file into your Documents folder, and
   "Import" to load it back.
   ========================================================= */

// Set automatically by tools/bump-version.mjs on every commit that changes the app.
// Running copies compare it with version.json on the website and update themselves.
const APP_VERSION = '2026.10.29-223306';
const SITE_URL = 'https://ender909v1.github.io/BookNote/';

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const app = $('#app');

// Search: every typed word must appear somewhere (any order).
const words = q => q.trim().toLowerCase().split(/\s+/).filter(Boolean);
const hasAll = (hay, ws) => ws.every(w => hay.includes(w));
// Escape text and wrap search words in <mark>.
function hl(text, ws) {
  if (!ws.length) return esc(text);
  const re = new RegExp(ws.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  let out = '', last = 0;
  text.replace(re, (m, i) => { out += esc(text.slice(last, i)) + '<mark>' + esc(m) + '</mark>'; last = i + m.length; return m; });
  return out + esc(text.slice(last));
}

const ICON = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  burger: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/></svg>',
  image: '<svg viewBox="0 0 24 24" style="width:32px;height:32px"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
};

/* ---------- storage (IndexedDB) ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('booknote', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('books', { keyPath: 'id' });
        req.result.createObjectStore('images');
      };
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  },
  writing: 0, // saves in progress (an update waits for these before reloading)
  run(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      if (mode === 'readwrite') this.writing++;
      const done = () => { if (mode === 'readwrite') this.writing--; };
      t.oncomplete = () => { done(); resolve(r && r.result); };
      t.onerror = () => { done(); reject(t.error); };
      t.onabort = () => { done(); reject(t.error); };
    });
  },
  allBooks() { return this.run('books', 'readonly', s => s.getAll()); },
  putBook(b) { return this.run('books', 'readwrite', s => s.put(b)); },
  delBook(id) { return this.run('books', 'readwrite', s => s.delete(id)); },
  getImage(id) { return this.run('images', 'readonly', s => s.get(id)); },
  putImage(id, blob) { return this.run('images', 'readwrite', s => s.put(blob, id)); },
  delImages(ids) { return this.run('images', 'readwrite', s => { ids.forEach(id => s.delete(id)); }); },
};

/* Images are stored exactly as added (same file, format and name).
   Library tiles and card rows show a small preview copy ("<id>#thumb"), made the first
   time it is needed, so big photos don't slow the pages down. */
const THUMB = '#thumb';
const imgCache = new Map();
function cacheURL(key, blob) {
  const url = URL.createObjectURL(blob);
  imgCache.set(key, url);
  return url;
}
async function imageURL(id) {
  if (!id) return null;
  if (imgCache.has(id)) return imgCache.get(id);
  const blob = await DB.getImage(id).catch(() => null);
  return blob ? cacheURL(id, blob) : null;
}
async function thumbURL(id) {
  if (!id) return null;
  const key = id + THUMB;
  if (imgCache.has(key)) return imgCache.get(key);
  let thumb = await DB.getImage(key).catch(() => null);
  if (!thumb) {
    const full = await DB.getImage(id).catch(() => null);
    if (!full) return null;
    thumb = await makeThumb(full);
    if (thumb !== full) await DB.putImage(key, thumb).catch(() => {});
  }
  return cacheURL(key, thumb);
}

function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img).finally(() => URL.revokeObjectURL(url));
}
async function makeThumb(blob) {
  if (blob.size < 300e3) return blob;
  try {
    const img = await loadImage(blob);
    const scale = 640 / Math.max(img.naturalWidth, img.naturalHeight);
    if (!(scale < 1)) return blob;
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(b => res(b || blob), 'image/webp', 0.85));
  } catch {
    return blob;
  }
}

async function canShowImage(file) {
  try { await loadImage(file); return true; } catch { return false; }
}
// Saves the original file untouched; throws if the browser can't display it (e.g. HEIC, TIFF).
async function storeImage(file) {
  if (!await canShowImage(file)) throw new Error(`${file.name || 'This image'} can't be shown in the browser (try JPG or PNG)`);
  const id = uid();
  await DB.putImage(id, file);
  return id;
}
async function removeImages(ids) {
  ids = ids.filter(Boolean);
  if (!ids.length) return;
  const keys = ids.flatMap(id => [id, id + THUMB]);
  await DB.delImages(keys);
  keys.forEach(k => { if (imgCache.has(k)) { URL.revokeObjectURL(imgCache.get(k)); imgCache.delete(k); } });
}

function hydrate(root) {
  $$('img[data-img]', root).forEach(async img => {
    const id = img.dataset.img;
    const url = await (img.hasAttribute('data-thumb') ? thumbURL(id) : imageURL(id));
    if (!url) return showMissing(img);
    img.onerror = () => showMissing(img);
    img.src = url;
  });
}
// An image that can't be found: the card falls back to text only, a cover to the title only.
function showMissing(img) {
  if (!img.isConnected) return;
  const card = img.closest('.ccard');
  const tile = img.closest('.tile');
  const viewer = img.closest('.viewer-box');
  if (card) {
    img.closest('.ccard-img').remove();
    card.classList.remove('has-img');
  } else if (tile) {
    tile.querySelector('.tile-name')?.remove();
    const cover = img.closest('.tile-cover');
    cover.classList.add('only-title');
    cover.innerHTML = `<span>${esc(tile.title)}</span>`;
  } else if (viewer) {
    img.closest('.viewer-img').remove();
    viewer.classList.add('no-img');
    viewer.querySelector('[data-v="save-img"]')?.remove();
    viewer.querySelector('.viewer-missing')?.removeAttribute('hidden');
  } else {
    img.remove();
  }
}

const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif', 'image/x-icon': 'ico' };
// Save a stored image back to the PC as a normal file (original name if we have it).
async function saveImageToPC(id, fallbackName) {
  const blob = await DB.getImage(id).catch(() => null);
  if (!blob) return toast('This image is missing.', true);
  const ext = blob.name?.match(/\.([a-z0-9]+)$/i)?.[1] || IMG_EXT[blob.type] || 'png';
  const name = blob.name || `${safeName(fallbackName) || 'image'}.${ext}`;
  await saveFile(name, blob, {
    startIn: 'pictures',
    types: [{ description: 'Image', accept: { [blob.type || 'image/png']: ['.' + ext.toLowerCase()] } }],
  });
}

/* ---------- state ---------- */
const state = {
  books: [], view: null, bookId: null, query: '', page: 1,
  bookUI: new Map(), fieldUI: new Map(),
  scrollPos: new Map(), // 'home' or a book id -> page scroll
  openCard: null,       // { bookId, fid, cid } of the card pop-up, if open
  ready: false,
};
const getBook = id => state.books.find(b => b.id === id);
const bookImageIds = b => [b.cover, ...b.fields.flatMap(f => f.cards.map(c => c.image))].filter(Boolean);

async function saveBook(book) {
  book.updatedAt = Date.now();
  await DB.putBook(book);
}
function normTag(t) {
  return String(t).trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase().slice(0, 40);
}
const cardHay = c => `${c.text}\n${c.note}\n${c.tags.join(' ')}`.toLowerCase();
const bookMatches = (b, ws) =>
  hasAll([b.title.toLowerCase(), ...b.fields.map(f => f.name.toLowerCase() + '\n' + f.cards.map(cardHay).join('\n'))].join('\n'), ws);

// Book-wide search & filter (the bar under the book title).
function bookUI(bid) {
  if (!state.bookUI.has(bid)) state.bookUI.set(bid, { q: '', tags: new Set(), field: '' });
  return state.bookUI.get(bid);
}
const bookFiltering = g => !!(words(g.q).length || g.tags.size || g.field);
// Per-field search & tag filter (inside each field).
function fieldUI(fid) {
  if (!state.fieldUI.has(fid)) state.fieldUI.set(fid, { q: '', tags: new Set() });
  return state.fieldUI.get(fid);
}
// Every tag in a book: the ones used on cards plus ones added from a filter (book.tags).
// count = cards using it in the whole book; unused added tags can be deleted.
function allTags(book) {
  const counts = new Map((book.tags || []).map(t => [t, 0]));
  book.fields.forEach(f => f.cards.forEach(c => c.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1))));
  return [...counts].map(([tag, count]) => ({ tag, count, removable: count === 0 })).sort((a, b) => a.tag.localeCompare(b.tag));
}
async function addBookTag(book, tag) {
  if (allTags(book).some(x => x.tag === tag)) return;
  book.tags = [...(book.tags || []), tag];
  await saveBook(book);
  toast(`Added #${tag}. You can now pick it on cards.`);
}
async function removeBookTag(book, tag) {
  book.tags = (book.tags || []).filter(t => t !== tag);
  await saveBook(book);
}
// Cards of a field that pass the book-wide filter, plus (when local) the field's own filter.
// Book-wide words may also match the field's name, e.g. "characters hero".
function filteredCards(book, f, local = true) {
  const g = bookUI(book.id), ui = fieldUI(f.id);
  const gw = words(g.q), fw = local ? words(ui.q) : [];
  const tags = local ? [...g.tags, ...ui.tags] : [...g.tags];
  const name = f.name.toLowerCase();
  return f.cards.filter(c => {
    const hay = cardHay(c);
    return hasAll(name + '\n' + hay, gw) && hasAll(hay, fw) && tags.every(t => c.tags.includes(t));
  });
}

/* ---------- small UI pieces: toast, menu, dialogs ---------- */
let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 2800);
}

let menuEl = null;
function closeMenu() { menuEl?.remove(); menuEl = null; }
function openMenu(anchor, items) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  for (const [label, fn, danger] of items) {
    const b = document.createElement('button');
    b.textContent = label;
    if (danger) b.className = 'danger';
    b.addEventListener('click', e => { e.stopPropagation(); closeMenu(); fn(); });
    m.append(b);
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  let left = r.right - m.offsetWidth;
  if (left < 8) left = r.left;
  let top = r.bottom + 6;
  if (top + m.offsetHeight > innerHeight - 8) top = r.top - m.offsetHeight - 6;
  m.style.left = left + 'px';
  m.style.top = Math.max(8, top) + 'px';
  menuEl = m;
}
// A click outside an open menu only closes it; it doesn't also open whatever is underneath.
let swallowClick = false;
document.addEventListener('pointerdown', e => {
  if (menuEl && !menuEl.contains(e.target)) { closeMenu(); swallowClick = true; setTimeout(() => { swallowClick = false; }, 600); }
}, true);
document.addEventListener('click', e => {
  if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); }
}, true);
window.addEventListener('scroll', closeMenu, true);
window.addEventListener('resize', closeMenu);

/* Tag dropdown: pick existing tags (multi-select) or type to match; "+ Add" when nothing matches.
   o = { options() -> [{tag, count, locked?, removable?}], selected() -> Set,
         onToggle(tag), onAdd(tag), onRemove?(tag) } */
let dropEl = null;
function closeDropdown() {
  if (!dropEl) return;
  dropEl.cleanup();
  dropEl.remove();
  dropEl = null;
}
function tagDropdown(anchor, o) {
  if (dropEl?.anchor === anchor) return closeDropdown(); // clicking the button again closes it
  closeDropdown();
  closeMenu();
  const el = document.createElement('div');
  el.className = 'dropdown';
  el.anchor = anchor;
  el.innerHTML = `
    <div class="dd-search">${ICON.search}<input placeholder="Search or add a tag…" autocomplete="off"></div>
    <div class="dd-list"></div>`;
  // Inside a modal dialog the dropdown must live in the dialog, or it would sit behind it.
  (anchor.closest('dialog') || document.body).append(el);
  const input = $('input', el);
  const list = $('.dd-list', el);
  let rows = [];
  let active = 0;

  const position = () => {
    const r = anchor.getBoundingClientRect();
    const w = Math.min(320, Math.max(260, r.width));
    el.style.width = w + 'px';
    el.style.left = clamp(r.left, 8, innerWidth - w - 8) + 'px';
    const h = el.offsetHeight;
    let top = r.bottom + 6;
    if (top + h > innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    el.style.top = top + 'px';
  };
  const draw = () => {
    const q = normTag(input.value);
    const sel = o.selected();
    const opts = o.options();
    rows = opts.filter(x => !q || x.tag.includes(q));
    // "+ Add" is always offered; if the tag already exists it just picks that one.
    if (q) rows.push({ tag: q, add: true, exists: opts.some(x => x.tag === q) });
    active = clamp(active, 0, Math.max(0, rows.length - 1));
    list.innerHTML = rows.length
      ? rows.map((r, i) => r.add
        ? `<button type="button" class="dd-item add ${i === active ? 'active' : ''}" data-i="${i}">${ICON.plus}<span class="t">Add “#${esc(r.tag)}”</span></button>`
        : `<button type="button" class="dd-item ${sel.has(r.tag) ? 'on' : ''} ${i === active ? 'active' : ''}" data-i="${i}"
             ${r.locked ? 'disabled title="Already filtered for the whole book"' : ''}>
             <span class="check">${sel.has(r.tag) ? ICON.check : ''}</span>
             <span class="t">#${esc(r.tag)}</span>
             <span class="n">${r.count}</span>
             ${o.onRemove && r.removable ? `<span class="rm" data-rm title="Delete this unused tag">×</span>` : ''}
           </button>`).join('')
      : `<div class="dd-empty">${opts.length ? 'No match' : 'No tags yet. Type a name to add one.'}</div>`;
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    position();
  };
  const choose = async (i, removing = false) => {
    const r = rows[i];
    if (!r || (r.locked && !removing)) return;
    if (removing) await o.onRemove(r.tag);
    else if (r.add) {
      if (!r.exists) await o.onAdd(r.tag);
      else if (!o.selected().has(r.tag)) await o.onToggle(r.tag); // never un-picks it
      input.value = '';
    }
    else await o.onToggle(r.tag);
    if (dropEl === el) { draw(); input.focus(); }
  };

  list.addEventListener('pointerdown', e => e.preventDefault()); // keep focus in the search box
  list.addEventListener('click', e => {
    const b = e.target.closest('.dd-item');
    if (b) choose(+b.dataset.i, !!e.target.closest('[data-rm]'));
  });
  input.addEventListener('input', () => { active = 0; draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, rows.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDropdown(); anchor.focus(); }
  });

  const onDown = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeDropdown(); };
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('scroll', position, true);
  window.addEventListener('resize', position);
  el.cleanup = () => {
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('scroll', position, true);
    window.removeEventListener('resize', position);
  };
  el.redraw = draw;
  dropEl = el;
  draw();
  input.focus();
}

function openModal(html, cls = '') {
  const d = document.createElement('dialog');
  d.className = 'modal ' + cls;
  d.innerHTML = html;
  document.body.append(d);
  d.showModal();
  d.addEventListener('close', () => { if (dropEl && d.contains(dropEl)) closeDropdown(); d.remove(); });
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
  return d;
}

function ask(title, value = '', placeholder = '') {
  return new Promise(resolve => {
    let result = null;
    const d = openModal(`
      <form class="box">
        <h3>${esc(title)}</h3>
        <input class="text-input" name="v" maxlength="120" autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(value)}">
        <p class="err"></p>
        <div class="row-end">
          <button type="button" class="btn ghost" data-cancel>Cancel</button>
          <button class="btn primary">Save</button>
        </div>
      </form>`);
    const input = $('input', d);
    input.select();
    $('[data-cancel]', d).onclick = () => d.close();
    $('form', d).addEventListener('submit', e => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) { $('.err', d).textContent = 'A name is required.'; input.focus(); return; }
      result = v;
      d.close();
    });
    d.addEventListener('close', () => resolve(result));
  });
}

function confirmBox(message, okText = 'Delete') {
  return new Promise(resolve => {
    let ok = false;
    const d = openModal(`
      <div class="box">
        <h3>Are you sure?</h3>
        <p>${esc(message)}</p>
        <div class="row-end">
          <button class="btn ghost" data-no>Cancel</button>
          <button class="btn primary" data-yes>${esc(okText)}</button>
        </div>
      </div>`);
    $('[data-no]', d).onclick = () => d.close();
    $('[data-yes]', d).onclick = () => { ok = true; d.close(); };
    $('[data-yes]', d).focus();
    d.addEventListener('close', () => resolve(ok));
  });
}

function pickFiles(accept, multiple = false) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    inp.addEventListener('change', () => resolve([...inp.files]));
    inp.addEventListener('cancel', () => resolve([]));
    inp.click();
  });
}

/* ---------- routing ---------- */
function route() {
  closeMenu();
  closeDropdown();
  $$('dialog[open]').forEach(d => d.close());
  rememberScroll();
  const m = location.hash.match(/^#\/book\/(.+)$/);
  const book = m && getBook(decodeURIComponent(m[1]));
  if (book) renderBook(book);
  else {
    if (m) history.replaceState(null, '', '#/');
    renderHome();
  }
  window.scrollTo(0, state.scrollPos.get(viewKey()) || 0);
}
window.addEventListener('hashchange', route);

/* ---------- remember where you left off ----------
   The page, searches, filters, scroll positions and the open card are kept in this
   browser's localStorage, so reopening the app brings you back to the same spot. */
const UI_KEY = 'booknote.ui';
const viewKey = () => (state.view === 'book' ? state.bookId : state.view);
function rememberScroll() {
  const k = viewKey();
  if (k) state.scrollPos.set(k, Math.round(scrollY));
}

function loadUI() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(UI_KEY)); } catch { /* no saved spot */ }
  if (!s || typeof s !== 'object') return null;
  state.query = String(s.query || '');
  state.page = Number(s.page) || 1;
  for (const [k, y] of Object.entries(s.scroll || {})) state.scrollPos.set(k, Number(y) || 0);
  for (const [bid, b] of Object.entries(s.books || {})) {
    state.bookUI.set(bid, { q: String(b.q || ''), tags: new Set(b.tags || []), field: String(b.field || '') });
    for (const [fid, f] of Object.entries(b.fields || {})) {
      state.fieldUI.set(fid, { q: String(f.q || ''), tags: new Set(f.tags || []), x: Number(f.x) || 0 });
    }
  }
  state.openCard = s.openCard || null;
  return s;
}

function saveUI() {
  if (!state.ready) return; // never overwrite the saved spot before it has been restored
  rememberScroll();
  const books = {};
  for (const b of state.books) {
    const g = state.bookUI.get(b.id);
    const fields = {};
    for (const f of b.fields) {
      const ui = state.fieldUI.get(f.id);
      if (ui && (ui.q || ui.tags.size || ui.x)) fields[f.id] = { q: ui.q, tags: [...ui.tags], x: ui.x || 0 };
    }
    if ((g && bookFiltering(g)) || Object.keys(fields).length) {
      books[b.id] = { q: g?.q || '', tags: [...(g?.tags || [])], field: g?.field || '', fields };
    }
  }
  const scroll = Object.fromEntries([...state.scrollPos].filter(([k]) => k === 'home' || getBook(k)));
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({
      hash: location.hash, query: state.query, page: state.page, scroll, books, openCard: state.openCard,
    }));
  } catch { /* storage blocked: just don't remember */ }
}

let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveUI, 400);
}
['click', 'input', 'change', 'keyup'].forEach(t => document.addEventListener(t, scheduleSave, true));
document.addEventListener('scroll', e => {
  const row = e.target instanceof Element && e.target.matches('.row') ? e.target : null;
  if (row) fieldUI(row.closest('.field').dataset.fid).x = Math.round(row.scrollLeft);
  scheduleSave();
}, true);
window.addEventListener('hashchange', scheduleSave);
window.addEventListener('pagehide', saveUI);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveUI(); });
const goHome = () => { location.hash = '#/'; };
const openBook = book => { location.hash = '#/book/' + encodeURIComponent(book.id); };
function refresh() {
  if (state.view === 'home') renderGrid();
  else if (getBook(state.bookId)) renderBook(getBook(state.bookId));
  else goHome();
}

/* =========================================================
   Library (front page)
   ========================================================= */
const PER_PAGE = 12; // 4 per row x 3 rows; the "+" tile takes the first slot

function renderHome() {
  state.view = 'home';
  state.bookId = null;
  document.title = 'BookNote';
  app.innerHTML = `
    <header class="topbar">
      <label class="search">${ICON.search}
        <input id="homeSearch" type="search" placeholder="Search saved data…" value="${esc(state.query)}" autocomplete="off">
      </label>
      <h1 class="brand"><img src="icons/logo.svg" alt="">BookNote</h1>
      <div class="top-actions">
        <button class="btn primary" data-act="install" data-install ${installPrompt ? '' : 'hidden'} title="Install BookNote as an app on this device">Install app</button>
        <a class="btn ghost" href="download.html" title="Install on PC or Android, or download for offline use">Get app</a>
        <button class="btn ghost" data-act="import" title="Load a .json file exported from BookNote">Import</button>
        <button class="btn ghost" data-act="backup" title="Save everything as a .json file">Backup all</button>
      </div>
    </header>
    <main class="library"><div class="grid" id="grid"></div></main>
    <nav class="pager" id="pager"></nav>
    <p class="app-version">BookNote version ${esc(APP_VERSION)}</p>`;
  $('#homeSearch').addEventListener('input', e => { state.query = e.target.value; state.page = 1; renderGrid(); });
  renderGrid();
}

function renderGrid() {
  const ws = words(state.query);
  const list = state.books.filter(b => !ws.length || bookMatches(b, ws)).sort((a, b) => b.createdAt - a.createdAt);
  const per = PER_PAGE - 1;
  const last = Math.max(1, Math.ceil(list.length / per));
  state.page = clamp(state.page, 1, last);
  const items = list.slice((state.page - 1) * per, state.page * per);

  $('#grid').innerHTML =
    `<button class="tile tile-add" data-act="add" title="Create new or import from PC">${ICON.plus}<span>New</span></button>` +
    items.map(tileHTML).join('') +
    (ws.length && !list.length ? `<p class="empty">Nothing matches “${esc(state.query)}”.</p>` : '');
  hydrate($('#grid'));

  $('#pager').innerHTML = `
    <button class="icon-btn" data-act="prev" title="Previous page" ${state.page <= 1 ? 'disabled' : ''}>${ICON.left}</button>
    <input id="pageInput" type="number" min="1" max="${last}" value="${state.page}" aria-label="Current page">
    <span class="sep">/</span><span class="last">${last}</span>
    <button class="icon-btn" data-act="next" title="Next page" ${state.page >= last ? 'disabled' : ''}>${ICON.right}</button>`;
  const pi = $('#pageInput');
  const go = () => {
    const n = parseInt(pi.value, 10);
    if (Number.isFinite(n)) state.page = clamp(n, 1, last);
    renderGrid();
  };
  pi.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  pi.addEventListener('change', go);
}

function tileHTML(b) {
  const body = b.cover
    ? `<div class="tile-cover"><img data-img="${b.cover}" data-thumb alt="" decoding="async"></div><div class="tile-name">${esc(b.title)}</div>`
    : `<div class="tile-cover only-title"><span>${esc(b.title)}</span></div>`;
  return `<div class="tile" data-id="${b.id}" data-act="open" tabindex="0" title="${esc(b.title)}">
    ${body}
    <button class="dots" data-act="book-menu" title="Options">${ICON.dots}</button>
  </div>`;
}

/* ---------- book-level actions ---------- */
async function newBook() {
  const title = await ask('New book', '', 'Name');
  if (!title) return;
  const now = Date.now();
  const book = { id: uid(), title, cover: null, fields: [], tags: [], createdAt: now, updatedAt: now };
  await saveBook(book);
  state.books.push(book);
  openBook(book);
}

async function renameBook(book) {
  const title = await ask('Rename', book.title);
  if (!title || title === book.title) return;
  book.title = title;
  await saveBook(book);
  if (state.view === 'book') { $('#bookTitle').textContent = title; document.title = title + ' · BookNote'; }
  else renderGrid();
}

async function setCover(book) {
  const [file] = await pickFiles('image/*');
  if (!file) return;
  let id;
  try { id = await storeImage(file); } catch (err) { return toast(err.message, true); }
  await removeImages([book.cover]);
  book.cover = id;
  await saveBook(book);
  refreshCover(book);
}

async function removeCover(book) {
  await removeImages([book.cover]);
  book.cover = null;
  await saveBook(book);
  refreshCover(book);
}

function refreshCover(book) {
  if (state.view === 'book') $('#coverBtn').textContent = book.cover ? 'Cover' : 'Add cover';
  else renderGrid();
}

async function deleteBook(book) {
  if (!await confirmBox(`Delete “${book.title}” and everything inside it? This cannot be undone.`)) return;
  await removeImages(bookImageIds(book));
  await DB.delBook(book.id);
  state.books = state.books.filter(b => b !== book);
  if (state.view === 'book') goHome(); else renderGrid();
  toast('Deleted');
}

function bookMenu(anchor, book) {
  openMenu(anchor, [
    ['Open', () => openBook(book)],
    ['Rename', () => renameBook(book)],
    [book.cover ? 'Change cover' : 'Add cover', () => setCover(book)],
    ...(book.cover ? [
      ['Save cover image', () => saveImageToPC(book.cover, book.title + ' cover')],
      ['Remove cover', () => removeCover(book)],
    ] : []),
    ['Export to PC', () => exportBooks([book], fileName(book.title))],
    ['Delete', () => deleteBook(book), true],
  ]);
}

/* ---------- export / import ---------- */
const safeName = s => String(s).replace(/[\\/:*?"<>|\r\n]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
const fileName = title => (safeName(title) || 'book') + '.json';

function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
function dataURLToBlob(url) {
  const [head, data] = url.split(',');
  const mime = (head.match(/^data:([^;,]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const JSON_TYPES = [{ description: 'BookNote data', accept: { 'application/json': ['.json'] } }];
async function saveFile(name, blob, { startIn = 'documents', types = JSON_TYPES } = {}) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await showSaveFilePicker({ suggestedName: name, startIn, types });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      toast('Saved ' + handle.name);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('Save picker failed, falling back to download', err);
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Downloaded ' + name);
}

async function exportBooks(books, name) {
  if (!books.length) return toast('Nothing to back up yet.');
  const images = {};
  const imageNames = {};
  for (const id of books.flatMap(bookImageIds)) {
    const blob = await DB.getImage(id);
    if (!blob) continue;
    images[id] = await blobToDataURL(blob);
    if (blob.name) imageNames[id] = blob.name;
  }
  const payload = { app: 'booknote', version: 1, exportedAt: new Date().toISOString(), books, images, imageNames };
  await saveFile(name, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
}

async function importFromPC() {
  const files = await pickFiles('.json,application/json', true);
  let count = 0;
  for (const file of files) {
    try {
      const data = JSON.parse(await file.text());
      if (data?.app !== 'booknote' || !Array.isArray(data.books)) throw new Error('not a BookNote file');
      for (const src of data.books) { await importBook(src, data.images || {}, data.imageNames || {}, count); count++; }
    } catch (err) {
      toast(`Could not import ${file.name}: ${err.message}`, true);
    }
  }
  if (!count) return;
  toast(`Imported ${count} book${count > 1 ? 's' : ''}`);
  state.page = 1;
  if (state.view === 'home') renderGrid(); else goHome();
}

// Imported books always get fresh ids, so importing never overwrites existing data.
async function importBook(src, images, imageNames, order) {
  const idMap = new Map();
  const img = async oldId => {
    if (!oldId || typeof images[oldId] !== 'string') return null;
    if (!idMap.has(oldId)) {
      const id = uid();
      const blob = dataURLToBlob(images[oldId]);
      const name = imageNames[oldId];
      await DB.putImage(id, typeof name === 'string' ? new File([blob], name, { type: blob.type }) : blob);
      idMap.set(oldId, id);
    }
    return idMap.get(oldId);
  };
  const now = Date.now() + order;
  const book = {
    id: uid(), title: String(src.title || 'Untitled'), cover: await img(src.cover), fields: [],
    tags: Array.isArray(src.tags) ? [...new Set(src.tags.map(normTag).filter(Boolean))] : [],
    createdAt: now, updatedAt: now,
  };
  for (const f of Array.isArray(src.fields) ? src.fields : []) {
    const field = { id: uid(), name: String(f.name || 'Field'), cards: [] };
    for (const c of Array.isArray(f.cards) ? f.cards : []) {
      field.cards.push({
        id: uid(),
        text: String(c.text || ''),
        note: String(c.note || ''),
        tags: Array.isArray(c.tags) ? [...new Set(c.tags.map(normTag).filter(Boolean))] : [],
        image: await img(c.image),
        createdAt: c.createdAt || now,
      });
    }
    book.fields.push(field);
  }
  await DB.putBook(book);
  state.books.push(book);
}

/* =========================================================
   Book editor
   ========================================================= */
function renderBook(book) {
  state.view = 'book';
  state.bookId = book.id;
  document.title = book.title + ' · BookNote';
  const g = bookUI(book.id);
  app.innerHTML = `
    <div class="sticky-head">
      <header class="topbar">
        <div><button class="btn ghost" data-act="home">${ICON.left} Library</button></div>
        <div class="title-wrap">
          <button class="icon-btn" data-act="rename" title="Rename">${ICON.pencil}</button>
          <h1 class="book-title" id="bookTitle">${esc(book.title)}</h1>
        </div>
        <div class="top-actions">
          <button class="btn ghost" id="coverBtn" data-act="cover">${book.cover ? 'Cover' : 'Add cover'}</button>
          <button class="btn ghost" data-act="export">Export to PC</button>
          <button class="icon-btn" data-act="book-menu-top" title="More">${ICON.dots}</button>
        </div>
      </header>
      <div class="book-tools">
        <label class="search">${ICON.search}
          <input id="bookSearch" type="search" placeholder="Search all fields…" value="${esc(g.q)}" autocomplete="off" title="Shortcut: /">
        </label>
        <select id="fieldFilter" class="select" title="Show one field"></select>
        <button class="btn dd-btn" id="tagFilterBtn" data-act="tag-filter" title="Filter by tags">${ICON.tag}<span class="lbl-txt">Tags</span>${ICON.down}</button>
        <div class="gtags" id="gtags"></div>
        <span class="result" id="resultInfo"></span>
        <button class="btn ghost" id="clearAll" data-act="clear-all" hidden>Clear</button>
      </div>
    </div>
    <main class="fields" id="fields">
      ${book.fields.map(fieldHTML).join('')}
      <div class="no-results" id="noResults" hidden>
        <p>Nothing in this book matches.</p>
        <button class="btn" data-act="clear-all">Clear search &amp; filters</button>
      </div>
      <button class="add-field" data-act="add-field">${ICON.plus}<span>Add field</span></button>
    </main>`;
  refreshBookView(book);
  for (const f of book.fields) {
    const x = fieldUI(f.id).x;
    if (x) $(`.field[data-fid="${f.id}"] .row`).scrollLeft = x;
  }
}

// Field picker, tag dropdown button and the chosen tag chips in the book-wide filter bar.
function renderTools(book) {
  const g = bookUI(book.id);
  const known = new Set(allTags(book).map(x => x.tag));
  for (const t of [...g.tags]) if (!known.has(t)) g.tags.delete(t);
  if (g.field && !book.fields.some(f => f.id === g.field)) g.field = '';

  const sel = $('#fieldFilter');
  sel.innerHTML = `<option value="">All fields</option>` +
    book.fields.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  sel.value = g.field;

  $('#tagFilterBtn .lbl-txt').textContent = g.tags.size ? `Tags (${g.tags.size})` : 'Tags';
  $('#tagFilterBtn').classList.toggle('on', g.tags.size > 0);
  $('#gtags').innerHTML = [...g.tags].sort().map(t =>
    `<button class="chip on" data-act="gtag" data-tag="${esc(t)}" title="Remove filter">#${esc(t)} ×</button>`).join('');
}

function openBookTagFilter(anchor, book) {
  const g = bookUI(book.id);
  tagDropdown(anchor, {
    options: () => allTags(book),
    selected: () => g.tags,
    onToggle: t => { g.tags.has(t) ? g.tags.delete(t) : g.tags.add(t); refreshBookView(book); },
    onAdd: async t => { await addBookTag(book, t); refreshBookView(book); },
    onRemove: async t => { await removeBookTag(book, t); g.tags.delete(t); refreshBookView(book); },
  });
}

// Same dropdown for one field: counts are for this field; tags already filtered book-wide are locked on.
function openFieldTagFilter(anchor, book, field) {
  const g = bookUI(book.id);
  const ui = fieldUI(field.id);
  tagDropdown(anchor, {
    options: () => allTags(book).map(x => ({
      ...x,
      count: field.cards.filter(c => c.tags.includes(x.tag)).length,
      locked: g.tags.has(x.tag),
    })),
    selected: () => new Set([...ui.tags, ...g.tags]),
    onToggle: t => { ui.tags.has(t) ? ui.tags.delete(t) : ui.tags.add(t); renderRow(book, field); },
    onAdd: async t => { await addBookTag(book, t); refreshBookView(book); },
    onRemove: async t => { await removeBookTag(book, t); ui.tags.delete(t); refreshBookView(book); },
  });
}

// Show/hide fields and redraw rows for the current book-wide filter.
function applyBookFilter(book) {
  const g = bookUI(book.id);
  const active = bookFiltering(g);
  let cards = 0, fields = 0, total = 0;
  for (const f of book.fields) {
    total += f.cards.length;
    const n = filteredCards(book, f, false).length;
    const show = g.field ? f.id === g.field : (!active || n > 0);
    const sec = $(`.field[data-fid="${f.id}"]`);
    if (sec) sec.hidden = !show;
    if (!show) continue;
    fields++;
    cards += n;
    renderRow(book, f);
  }
  const s = n => (n === 1 ? '' : 's');
  $('#resultInfo').textContent = active
    ? `${cards} card${s(cards)} in ${fields} field${s(fields)}`
    : `${total} card${s(total)} · ${book.fields.length} field${s(book.fields.length)}`;
  $('#clearAll').hidden = !active;
  $('#noResults').hidden = !(active && fields === 0);
}

function refreshBookView(book) {
  renderTools(book);
  applyBookFilter(book);
}

function clearBookFilter(book) {
  const g = bookUI(book.id);
  g.q = '';
  g.tags.clear();
  g.field = '';
  const input = $('#bookSearch');
  if (input) input.value = '';
  refreshBookView(book);
}

function fieldHTML(f) {
  const ui = fieldUI(f.id);
  return `<section class="field" data-fid="${f.id}">
    <div class="field-head">
      <button class="drag-handle" title="Hold and drag to move this field (or use ↑ ↓)" aria-label="Move field">${ICON.burger}</button>
      <h2 class="field-name">${esc(f.name)}</h2>
      <span class="count"></span>
      <div class="field-tools">
        <label class="search sm">${ICON.search}
          <input type="search" class="fsearch" placeholder="Search cards…" value="${esc(ui.q)}" autocomplete="off">
        </label>
        <button class="btn dd-btn sm" data-act="field-tag-filter" title="Filter this field by tags">${ICON.tag}<span class="lbl-txt">Tags</span>${ICON.down}</button>
        <button class="icon-btn" data-act="field-menu" title="Field options">${ICON.dots}</button>
      </div>
    </div>
    <div class="tagbar"></div>
    <div class="row"></div>
  </section>`;
}

function renderRow(book, f) {
  const sec = $(`.field[data-fid="${f.id}"]`);
  if (!sec) return;
  const g = bookUI(book.id);
  const ui = fieldUI(f.id);
  const known = new Set(allTags(book).map(x => x.tag));
  for (const t of [...ui.tags]) if (!known.has(t)) ui.tags.delete(t);
  const cards = filteredCards(book, f);
  const marks = [...words(g.q), ...words(ui.q)];

  const total = f.cards.length;
  sec.querySelector('.count').textContent =
    (cards.length === total ? total : `${cards.length} of ${total}`) + (total === 1 ? ' card' : ' cards');

  const btn = sec.querySelector('[data-act="field-tag-filter"]');
  btn.querySelector('.lbl-txt').textContent = ui.tags.size ? `Tags (${ui.tags.size})` : 'Tags';
  btn.classList.toggle('on', ui.tags.size > 0);
  const globalTags = [...g.tags].filter(t => !ui.tags.has(t)).sort();
  sec.querySelector('.tagbar').innerHTML = ui.tags.size || globalTags.length
    ? `<span class="tagbar-label">Filter:</span>` +
      globalTags.map(t => `<span class="chip on global" title="Filtered for the whole book">#${esc(t)}</span>`).join('') +
      [...ui.tags].sort().map(t => `<button class="chip on" data-act="tag" data-tag="${esc(t)}" title="Remove filter">#${esc(t)} ×</button>`).join('') +
      (ui.tags.size ? `<button class="chip clear" data-act="clear-tags">Clear</button>` : '')
    : '';

  const row = sec.querySelector('.row');
  row.innerHTML =
    `<button class="ccard ccard-add" data-act="add-card">${ICON.plus}<span>New card</span></button>` +
    cards.map(c => cardHTML(c, marks)).join('') +
    (!cards.length && total ? `<p class="row-empty">No cards match.</p>` : '');
  hydrate(row);
}

function cardHTML(c, marks = []) {
  return `<div class="ccard ${c.image ? 'has-img' : ''}" data-cid="${c.id}" data-act="view-card" tabindex="0">
    ${c.image ? `<div class="ccard-img"><img data-img="${c.image}" data-thumb alt="" loading="lazy" decoding="async"></div>` : ''}
    <div class="ccard-body">
      <p class="ccard-text">${hl(c.text, marks)}</p>
      ${c.note ? `<p class="ccard-note">${hl(c.note, marks)}</p>` : ''}
    </div>
    ${c.tags.length ? `<div class="ccard-tags">${c.tags.map(t => `<span class="chip sm">#${esc(t)}</span>`).join('')}</div>` : ''}
  </div>`;
}

/* ---------- field actions ---------- */
async function addField(book) {
  const name = await ask('New field', '', 'Field name (required)');
  if (!name) return;
  const field = { id: uid(), name, cards: [] };
  book.fields.push(field);
  await saveBook(book);
  // A new empty field would be hidden by an active search, so start clean.
  const g = bookUI(book.id);
  g.q = '';
  g.tags.clear();
  g.field = '';
  renderBook(book);
  $(`.field[data-fid="${field.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function fieldMenu(anchor, book, field) {
  openMenu(anchor, [
    ['Rename field', async () => {
      const name = await ask('Rename field', field.name);
      if (!name) return;
      field.name = name;
      await saveBook(book);
      $(`.field[data-fid="${field.id}"] .field-name`).textContent = name;
      refreshBookView(book);
    }],
    ['Delete field', async () => {
      if (!await confirmBox(`Delete field “${field.name}” and its ${field.cards.length} card(s)?`)) return;
      await removeImages(field.cards.map(c => c.image));
      book.fields = book.fields.filter(f => f !== field);
      state.fieldUI.delete(field.id);
      await saveBook(book);
      renderBook(book);
    }, true],
  ]);
}

/* ---------- reorder fields: hold the ☰ handle and drag up/down ----------
   Uses pointer events so it works with a mouse and with touch (Android). */
const visibleFields = () => $$('#fields > .field').filter(s => !s.hidden);

async function saveFieldOrder(book) {
  const ids = $$('#fields > .field').map(s => s.dataset.fid);
  if (ids.join() === book.fields.map(f => f.id).join()) return;
  book.fields = ids.map(id => book.fields.find(f => f.id === id));
  await saveBook(book);
  renderTools(book); // keeps the field picker in the same order
}

// Move `sec` in the page and slide the other fields to their new places.
function slideMove(sec, move) {
  const others = visibleFields().filter(s => s !== sec);
  others.forEach(s => s.getAnimations().forEach(a => a.finish()));
  const before = new Map(others.map(s => [s, s.getBoundingClientRect().top]));
  move();
  for (const s of others) {
    const d = before.get(s) - s.getBoundingClientRect().top;
    if (d) s.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: 160, easing: 'ease-out' });
  }
}

app.addEventListener('pointerdown', e => {
  const handle = e.target.closest('.drag-handle');
  const book = getBook(state.bookId);
  const sec = handle?.closest('.field');
  if (!sec || !book || e.button > 0) return;
  e.preventDefault();
  closeMenu();
  closeDropdown();
  handle.setPointerCapture(e.pointerId);

  const list = $('#fields');
  const grab = e.clientY - sec.getBoundingClientRect().top;
  let lastY = e.clientY;
  let shift = 0;
  let raf = 0;
  sec.classList.add('dragging');
  list.classList.add('reordering');
  document.body.classList.add('grabbing');

  // Keep the field under the finger, and swap it with a neighbour once it passes the neighbour's middle.
  const place = () => {
    const natural = sec.getBoundingClientRect().top - shift;
    shift = lastY - grab - natural;
    sec.style.transform = `translateY(${shift}px)`;
    const mid = lastY - grab + sec.offsetHeight / 2;
    const vis = visibleFields();
    const i = vis.indexOf(sec);
    const prev = vis[i - 1], next = vis[i + 1];
    const middle = s => s.getBoundingClientRect().top + s.offsetHeight / 2;
    if (prev && mid < middle(prev)) slideMove(sec, () => prev.before(sec));
    else if (next && mid > middle(next)) slideMove(sec, () => next.after(sec));
    else return;
    const moved = sec.getBoundingClientRect().top - shift;
    shift = lastY - grab - moved;
    sec.style.transform = `translateY(${shift}px)`;
  };
  // Scroll the page when dragging near the top or bottom edge.
  const edgeScroll = () => {
    const top = ($('.sticky-head')?.getBoundingClientRect().bottom || 0) + 40;
    const bottom = innerHeight - 40;
    const v = lastY < top ? lastY - top : lastY > bottom ? lastY - bottom : 0;
    if (v) { scrollBy(0, clamp(v / 2, -24, 24)); place(); }
    raf = requestAnimationFrame(edgeScroll);
  };
  raf = requestAnimationFrame(edgeScroll);

  const onMove = ev => { lastY = ev.clientY; place(); };
  const onEnd = () => {
    cancelAnimationFrame(raf);
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onEnd);
    handle.removeEventListener('pointercancel', onEnd);
    if (shift) sec.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }], { duration: 160, easing: 'ease-out' });
    sec.style.transform = '';
    sec.classList.remove('dragging');
    list.classList.remove('reordering');
    document.body.classList.remove('grabbing');
    saveFieldOrder(book);
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onEnd);
  handle.addEventListener('pointercancel', onEnd);
});

// Keyboard: focus the ☰ handle and press ↑ / ↓.
app.addEventListener('keydown', e => {
  if (!e.target.matches('.drag-handle') || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const book = getBook(state.bookId);
  const sec = e.target.closest('.field');
  const vis = visibleFields();
  const i = vis.indexOf(sec);
  const target = vis[e.key === 'ArrowUp' ? i - 1 : i + 1];
  if (!target) return;
  slideMove(sec, () => (e.key === 'ArrowUp' ? target.before(sec) : target.after(sec)));
  e.target.focus();
  sec.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  saveFieldOrder(book);
});

/* ---------- card editor ---------- */
function editCard(book, field, card) {
  return new Promise(resolve => {
    const isNew = !card;
    let saved = null;
    let pending = null;      // new image Blob waiting to be saved
    let pendingURL = null;
    let removeImg = false;
    const tags = [...(card?.tags || [])];

    const d = openModal(`
      <form class="box card-form">
        <h3>${isNew ? 'New card' : 'Edit card'} <span class="opt">in ${esc(field.name)}</span></h3>
        <div class="drop" tabindex="0"></div>
        <label class="lbl">Text <textarea name="text" rows="4" placeholder="Write something…"></textarea></label>
        <label class="lbl">Note <span class="opt">optional</span><textarea name="note" rows="3" placeholder="Extra notes…"></textarea></label>
        <div class="lbl">Tags <span class="opt">optional · pick existing or type to add</span>
          <div class="tag-input" tabindex="0" role="button" aria-label="Choose tags">
            <span class="tag-chips"></span>
            <span class="tag-ph">${ICON.plus} Add tag</span>
            <span class="tag-caret">${ICON.down}</span>
          </div>
        </div>
        <p class="err"></p>
        <div class="row-end">
          <button type="button" class="btn ghost" data-cancel>Cancel</button>
          <button class="btn primary">Save</button>
        </div>
      </form>`, 'wide');

    const form = $('form', d);
    const drop = $('.drop', d);
    const tagBox = $('.tag-input', d);
    form.elements.text.value = card?.text || '';
    form.elements.note.value = card?.note || '';

    const drawDrop = async () => {
      const url = pending ? pendingURL : (!removeImg && card?.image ? await imageURL(card.image) : null);
      const missing = !url && !pending && !removeImg && !!card?.image;
      drop.classList.toggle('filled', !!url);
      drop.innerHTML = url
        ? `<img src="${url}" alt=""><button type="button" class="icon-btn remove" title="Remove image">${ICON.close}</button>`
        : missing
          ? `<div>${ICON.image}<div>This card's image is missing.<br>Click, drop or paste to add it again.</div></div>`
          : `<div>${ICON.image}<div>Click, drop or paste an image <span class="opt">(optional)</span></div></div>`;
    };
    const setFile = async file => {
      if (!file || !file.type.startsWith('image/')) return;
      if (!await canShowImage(file)) return toast(`${file.name || 'This image'} can't be shown in the browser (try JPG or PNG)`, true);
      if (pendingURL) URL.revokeObjectURL(pendingURL);
      pending = file;
      pendingURL = URL.createObjectURL(file);
      drawDrop();
    };
    drop.addEventListener('click', async e => {
      if (e.target.closest('.remove')) {
        if (pendingURL) URL.revokeObjectURL(pendingURL);
        pending = pendingURL = null;
        removeImg = true;
        return drawDrop();
      }
      const [file] = await pickFiles('image/*');
      setFile(file);
    });
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drop.click(); } });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); setFile(e.dataTransfer.files[0]); });
    d.addEventListener('paste', e => {
      const file = [...e.clipboardData.files].find(f => f.type.startsWith('image/'));
      if (file) { e.preventDefault(); setFile(file); }
    });

    const drawTags = () => {
      $('.tag-chips', d).innerHTML = tags.map((t, i) =>
        `<span class="chip">#${esc(t)}<button type="button" data-i="${i}" title="Remove">×</button></span>`).join('');
      if (dropEl?.anchor === tagBox) dropEl.redraw();
    };
    const toggleTag = t => {
      const i = tags.indexOf(t);
      i >= 0 ? tags.splice(i, 1) : tags.push(t);
      drawTags();
    };
    const openTags = () => tagDropdown(tagBox, {
      // Book tags, plus any new ones added to this card that aren't saved yet.
      options: () => {
        const list = allTags(book);
        tags.filter(t => !list.some(x => x.tag === t)).forEach(t => list.push({ tag: t, count: 0 }));
        return list.sort((a, b) => a.tag.localeCompare(b.tag));
      },
      selected: () => new Set(tags),
      onToggle: toggleTag,
      onAdd: toggleTag,
    });
    tagBox.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (b) { tags.splice(+b.dataset.i, 1); drawTags(); return; }
      openTags();
    });
    tagBox.addEventListener('keydown', e => {
      if (e.target === tagBox && ['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); openTags(); }
    });

    $('[data-cancel]', d).onclick = () => d.close();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const text = form.elements.text.value.trim();
      if (!text) { $('.err', d).textContent = 'Please write some text for this card.'; form.elements.text.focus(); return; }

      let image = card?.image || null;
      if (pending) {
        let id;
        try { id = await storeImage(pending); } catch (err) { $('.err', d).textContent = err.message; return; }
        await removeImages([image]);
        image = id;
      } else if (removeImg && image) {
        await removeImages([image]);
        image = null;
      }
      const data = { text, note: form.elements.note.value.trim(), tags: [...tags], image };
      if (isNew) {
        card = { id: uid(), createdAt: Date.now(), ...data };
        field.cards.unshift(card);
      } else {
        Object.assign(card, data);
      }
      await saveBook(book);
      saved = card;
      d.close();
    });
    d.addEventListener('close', () => {
      if (pendingURL) URL.revokeObjectURL(pendingURL);
      resolve(saved);
    });

    drawDrop();
    drawTags();
    form.elements.text.focus();
  });
}

/* ---------- card viewer (pop-up) ---------- */
function viewCard(book, field, cid) {
  let list = filteredCards(book, field);
  if (!list.some(c => c.id === cid)) list = field.cards;
  let idx = list.findIndex(c => c.id === cid);
  if (idx < 0) return;
  const marks = [...words(bookUI(book.id).q), ...words(fieldUI(field.id).q)];
  const d = openModal('', 'viewer');

  const draw = () => {
    const c = list[idx];
    d.innerHTML = `<div class="viewer-box ${c.image ? '' : 'no-img'}">
      <button class="icon-btn close" data-v="close" title="Close">${ICON.close}</button>
      ${c.image ? `<div class="viewer-img"><img data-img="${c.image}" alt=""></div>` : ''}
      <div class="viewer-info">
        <div class="viewer-meta">${esc(field.name)} · ${idx + 1} / ${list.length}</div>
        ${c.image ? `<div class="viewer-missing" hidden>${ICON.image}<span>This card's image is missing.</span>
          <button class="btn sm" data-v="reattach">Add image again</button></div>` : ''}
        <div class="viewer-text">${hl(c.text, marks)}</div>
        ${c.note ? `<div class="viewer-note"><h4>Note</h4><p>${hl(c.note, marks)}</p></div>` : ''}
        ${c.tags.length ? `<div class="viewer-tags">${c.tags.map(t =>
          `<button class="chip" data-v="tag" data-tag="${esc(t)}" title="Show all cards in this book with this tag">#${esc(t)}</button>`).join('')}</div>` : ''}
        <div class="viewer-actions">
          <button class="icon-btn" data-v="prev" title="Previous (←)" ${idx <= 0 ? 'disabled' : ''}>${ICON.left}</button>
          <button class="icon-btn" data-v="next" title="Next (→)" ${idx >= list.length - 1 ? 'disabled' : ''}>${ICON.right}</button>
          <span class="spacer"></span>
          ${c.image ? `<button class="btn" data-v="save-img" title="Save the original image file to your PC">${ICON.download} Save image</button>` : ''}
          <button class="btn" data-v="edit">${ICON.pencil} Edit</button>
          <button class="btn danger" data-v="delete">Delete</button>
        </div>
      </div>
    </div>`;
    hydrate(d);
    state.openCard = { bookId: book.id, fid: field.id, cid: c.id };
    scheduleSave();
  };
  d.addEventListener('close', () => { state.openCard = null; scheduleSave(); });
  const move = step => { const n = clamp(idx + step, 0, list.length - 1); if (n !== idx) { idx = n; draw(); } };

  d.addEventListener('click', async e => {
    const b = e.target.closest('[data-v]');
    if (!b || b.disabled) return;
    const c = list[idx];
    switch (b.dataset.v) {
      case 'close': d.close(); break;
      case 'prev': move(-1); break;
      case 'next': move(1); break;
      case 'edit':
        if (await editCard(book, field, c)) { draw(); refreshBookView(book); }
        break;
      case 'delete':
        if (!await confirmBox('Delete this card?')) return;
        await removeImages([c.image]);
        field.cards = field.cards.filter(x => x !== c);
        await saveBook(book);
        refreshBookView(book);
        d.close();
        break;
      case 'save-img':
        saveImageToPC(c.image, c.text.split('\n')[0].slice(0, 40));
        break;
      case 'reattach': {
        const [file] = await pickFiles('image/*');
        if (!file) return;
        let id;
        try { id = await storeImage(file); } catch (err) { return toast(err.message, true); }
        await removeImages([c.image]);
        c.image = id;
        await saveBook(book);
        draw();
        refreshBookView(book);
        toast('Image added');
        break;
      }
      case 'tag':
        bookUI(book.id).tags.add(b.dataset.tag);
        d.close();
        refreshBookView(book);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
    }
  });
  d.addEventListener('keydown', e => {
    if (e.target !== d && e.target.closest('textarea, input')) return;
    if (e.key === 'ArrowLeft') move(-1);
    if (e.key === 'ArrowRight') move(1);
  });
  draw();
}

/* =========================================================
   Event wiring (one delegated handler for the whole app)
   ========================================================= */
app.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const tile = el.closest('.tile[data-id]');
  const book = state.view === 'book' ? getBook(state.bookId) : tile && getBook(tile.dataset.id);
  const sec = el.closest('.field');
  const field = sec && book?.fields.find(f => f.id === sec.dataset.fid);

  switch (act) {
    // library
    case 'add': openMenu(el, [['Create new', newBook], ['Import from PC…', importFromPC]]); break;
    case 'open': openBook(book); break;
    case 'book-menu': bookMenu(el, book); break;
    case 'prev': state.page--; renderGrid(); break;
    case 'next': state.page++; renderGrid(); break;
    case 'import': importFromPC(); break;
    case 'install': installApp(); break;
    case 'backup': exportBooks(state.books, `booknote-backup-${new Date().toISOString().slice(0, 10)}.json`); break;
    // book editor
    case 'home': goHome(); break;
    case 'rename': renameBook(book); break;
    case 'cover':
      if (!book.cover) setCover(book);
      else openMenu(el, [
        ['Change cover', () => setCover(book)],
        ['Save cover image', () => saveImageToPC(book.cover, book.title + ' cover')],
        ['Remove cover', () => removeCover(book), true],
      ]);
      break;
    case 'export': exportBooks([book], fileName(book.title)); break;
    case 'book-menu-top': openMenu(el, [['Delete book', () => deleteBook(book), true]]); break;
    case 'add-field': addField(book); break;
    case 'field-menu': fieldMenu(el, book, field); break;
    case 'add-card': {
      const card = await editCard(book, field, null);
      if (!card) break;
      refreshBookView(book);
      sec.querySelector('.row').scrollLeft = 0;
      if (!filteredCards(book, field).includes(card)) toast('Card saved, but hidden by the current search or filter');
      break;
    }
    case 'view-card': viewCard(book, field, el.dataset.cid); break;
    case 'tag': {
      const ui = fieldUI(field.id);
      const t = el.dataset.tag;
      ui.tags.has(t) ? ui.tags.delete(t) : ui.tags.add(t);
      renderRow(book, field);
      break;
    }
    case 'clear-tags': fieldUI(field.id).tags.clear(); renderRow(book, field); break;
    case 'gtag': {
      const g = bookUI(book.id);
      const t = el.dataset.tag;
      g.tags.has(t) ? g.tags.delete(t) : g.tags.add(t);
      refreshBookView(book);
      break;
    }
    case 'clear-all': clearBookFilter(book); break;
    case 'tag-filter': openBookTagFilter(el, book); break;
    case 'field-tag-filter': openFieldTagFilter(el, book, field); break;
  }
});

app.addEventListener('input', e => {
  const book = getBook(state.bookId);
  if (!book) return;
  if (e.target.id === 'bookSearch') {
    bookUI(book.id).q = e.target.value;
    applyBookFilter(book);
    return;
  }
  if (!e.target.matches('.fsearch')) return;
  const fid = e.target.closest('.field').dataset.fid;
  const field = book.fields.find(f => f.id === fid);
  fieldUI(fid).q = e.target.value;
  renderRow(book, field);
});

app.addEventListener('change', e => {
  if (e.target.id !== 'fieldFilter') return;
  const book = getBook(state.bookId);
  bookUI(book.id).field = e.target.value;
  applyBookFilter(book);
  window.scrollTo({ top: 0 });
});

// "/" jumps to the search box of the current page.
document.addEventListener('keydown', e => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || $('dialog')) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const input = $('#bookSearch') || $('#homeSearch');
  if (input) { e.preventDefault(); input.focus(); input.select(); }
});

// Enter / Space opens focused tiles and cards from the keyboard.
app.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('div[data-act][tabindex]')) {
    e.preventDefault();
    e.target.click();
  }
});

/* ---------- install as an app (PC + Android) ----------
   On the website (https) the browser can install BookNote like a normal app with its
   own icon and window, and a service worker keeps it working offline. Opening
   index.html straight from a folder skips this. */
let installPrompt = null;
const showInstall = on => $$('[data-install]').forEach(b => { b.hidden = !on; });
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  showInstall(true);
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  showInstall(false);
  toast('BookNote is installed. Find it in your apps.');
});
async function installApp() {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  showInstall(false);
}
if (location.protocol.startsWith('http')) {
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = 'manifest.webmanifest';
  document.head.append(link);
  navigator.serviceWorker?.register('sw.js').catch(err => console.warn('Offline support unavailable', err));
}

/* ---------- forced updates ----------
   Every few minutes (and when the app comes back into view) BookNote asks the website
   for the newest version number. If it changed, the app updates itself and reloads
   right away — it only waits while a card or name is being typed, so nothing is lost.
   Your spot (book, filters, scroll, open card) is restored after the reload. */
let updating = false;

async function latestVersion() {
  const url = location.protocol === 'file:' ? SITE_URL + 'version.json' : 'version.json';
  try {
    const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
    return res.ok ? (await res.json()).version : null;
  } catch {
    return null;
  }
}

async function checkForUpdate() {
  if (updating || APP_VERSION === 'dev' || !navigator.onLine) return;
  const latest = await latestVersion();
  if (!latest || latest === APP_VERSION) return;
  if (location.protocol === 'file:') showUpdateBar(latest, true);
  else forceUpdate(latest);
}

// Banner shown on top of everything (also inside an open dialog, or it would sit behind it).
function showUpdateBar(latest, isFileCopy = false) {
  let bar = $('.update-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'update-bar';
    bar.setAttribute('role', 'status');
  }
  bar.innerHTML = isFileCopy
    ? `A new version of BookNote is out.
       <a href="${SITE_URL}download.html" target="_blank" rel="noopener">Download the update</a>
       or <a href="${SITE_URL}" target="_blank" rel="noopener">use the web app</a>.`
    : `A required update is ready. Save or close what you're editing and BookNote will update.`;
  const host = $('dialog[open]') || document.body;
  if (bar.parentElement !== host) host.append(bar);
}

async function forceUpdate(latest) {
  if (updating) return;
  updating = true;
  // Don't throw away a card, tag or name that is being typed: wait until it's saved or
  // closed, then give that save time to finish before reloading.
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const busy = () => $('dialog[open] form') || DB.writing > 0;
  do {
    while (busy()) {
      if ($('dialog[open] form')) showUpdateBar(latest);
      await sleep(700);
    }
    await sleep(1200);
  } while (busy());
  $('.update-bar')?.remove();
  $$('dialog[open]').forEach(d => d.close());

  const triesKey = 'booknote.updateTries:' + latest;
  let tries = 0;
  try { tries = Number(sessionStorage.getItem(triesKey)) || 0; } catch { /* ignore */ }
  const overlay = document.createElement('div');
  overlay.className = 'update-overlay';
  document.body.append(overlay);
  if (tries >= 2) {
    // The website is still rolling the update out; don't get stuck reloading.
    overlay.innerHTML = `<div><img src="icons/logo.svg" alt=""><h2>Update on its way</h2>
      <p>The new version isn't ready on the server yet. Try again in a few minutes.</p>
      <button class="btn primary" onclick="location.reload()">Try again</button></div>`;
    return;
  }
  overlay.innerHTML = `<div><img src="icons/logo.svg" alt=""><h2>Updating BookNote…</h2>
    <p>Getting the newest version. Your notes are safe.</p><div class="spinner"></div></div>`;
  try { sessionStorage.setItem(triesKey, tries + 1); } catch { /* ignore */ }

  saveUI();
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    // Refresh the browser's copies of the app files so the reload gets the new ones.
    await Promise.all(['./', 'index.html', 'app.js', 'style.css', 'download.html', 'manifest.webmanifest']
      .map(u => fetch(u, { cache: 'reload' }).catch(() => {})));
  } catch { /* reload anyway */ }
  try { sessionStorage.setItem('booknote.updatedTo', latest); } catch { /* ignore */ }
  location.reload();
}

function startUpdateChecks() {
  try {
    if (sessionStorage.getItem('booknote.updatedTo') === APP_VERSION) {
      sessionStorage.removeItem('booknote.updatedTo');
      toast('BookNote was updated to the newest version');
    }
  } catch { /* ignore */ }
  if (APP_VERSION === 'dev') return;
  checkForUpdate();
  setInterval(checkForUpdate, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  window.addEventListener('online', checkForUpdate);
}

/* ---------- start ---------- */
(async function init() {
  try {
    await DB.open();
    state.books = await DB.allBooks();
  } catch (err) {
    app.innerHTML = `<p class="fatal">Could not open local storage: ${esc(err?.message || err)}.<br>
      Try opening this page in Chrome or Edge.</p>`;
    return;
  }
  navigator.storage?.persist?.(); // ask the browser not to clear our data

  // Come back to where you left off: same book, filters, scroll and open card.
  history.scrollRestoration = 'manual';
  const saved = loadUI();
  if (!location.hash && saved?.hash) history.replaceState(null, '', saved.hash);
  route();
  const oc = state.openCard;
  state.openCard = null;
  if (oc && state.view === 'book' && oc.bookId === state.bookId) {
    const book = getBook(oc.bookId);
    const field = book.fields.find(f => f.id === oc.fid);
    if (field?.cards.some(c => c.id === oc.cid)) viewCard(book, field, oc.cid);
  }
  state.ready = true;
  startUpdateChecks();
})();
