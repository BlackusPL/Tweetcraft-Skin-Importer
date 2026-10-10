// ==UserScript==
// @name            Tweetcraft Skin Painter
// @author          BlackusPL
// @namespace       https://darknessair.ovh
// @version         1.0.1
// @source          https://github.com/BlackusPL/Tweetcraft-Skin-Importer
// @updateURL       https://github.com/BlackusPL/Tweetcraft-Skin-Importer/raw/main/Tweetcraft-Skin-Painter.pl.meta.js
// @downloadURL     https://github.com/BlackusPL/Tweetcraft-Skin-Importer/raw/main/Tweetcraft-Skin-Painter.pl.user.js
// @description     Throw in a PNG with a skin (drag or select) and the script will immediately paint the entire character (front + back) and replace the skin in the game.
// @description:pl  Wrzuć PNG ze skinem (przeciągnij lub wybierz), a skrypt od razu namaluje całą postać (przód + tył) i podmieni skin w grze.
// @icon            https://www.google.com/s2/favicons?sz=64&domain=tweetcraft.jai.vin
// @match           https://tweetcraft.jai.vin
// @run-at          document-start
// @grant           none
// ==/UserScript==

(function () {
  'use strict';

  const words = {
	hook_img: '[TSP] hook img nie zadziałał',
	hook_fetch: '[TSP] hook fetch nie zadziałał',
    panel: [
        'Przeciągnij tu plik <b>PNG</b> ze skinem<br>albo kliknij, żeby wybrać',
        ' Od razu przeładuj stronę po wgraniu (żeby gra użyła skina)',
        'Zastosuj w grze',
        'Usuń skin',
        'Wykryte obrazy w grze (wybór tekstury skina)',
        'Brak – obrazy pojawią się po załadowaniu gry.',
        'Wróć do automatycznego wykrywania',
        'Upuść PNG ze skinem'
    ],
    skin_size_warn: ['Zły rozmiar','skin musi mieć wymiar 64×64 lub 64×32'],
    not_image: 'To nie jest plik PNG.',
    skin_painted: [
        'Postać namalowana',
        'stary format 64×32',
        'klasyczny / Steve',
        'Skin zapisany'
    ],
    skin_saved: 'Skin zapisany – przeładowuję grę…',
    unable_to_load: 'Nie udało się wczytać skina.',
	filefirst: 'Najpierw wgraj plik PNG.',
	skin_removed: 'Skin usunięty. Przeładuj stronę, żeby wrócić do domyślnego.',
	default_detect: 'Przywrócono automatyczne wykrywanie.',
    skin_matches: 'Pasują wymiarem do skina',
    no_sizes: 'Brak obrazów 64×64 / 64×32',
    others: 'Pozostałe',
    use: 'użyj',
	texture_selected: 'Wybrano teksturę docelową. Przeładowuję…',
	skin_loaded: 'Wczytano zapisany skin.'
  };

  /* ------------------------------------------------------------------ *
   *  Pamięć (localStorage z try/catch)
   * ------------------------------------------------------------------ */
  const KEY_SKIN = 'tcs_skin';
  const KEY_TARGET = 'tcs_target';
  const KEY_AUTO = 'tcs_autoreload';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  /* ------------------------------------------------------------------ *
   *  Wykrywanie / podmiana tekstury skina w grze
   * ------------------------------------------------------------------ */
  // Domyślnie podmieniamy każdy PNG o nazwie zawierającej skin/steve/alex/player/char...
  const NAME_RE = /(skin|steve|alex|player|char(acter)?)[^\/?#]*\.png/i;
  const seen = new Map(); // url -> {w, h}
  const listeners = new Set();

  const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return String(u); } };
  const strip = (u) => abs(u).split('#')[0].split('?')[0];
  const isSkinShape = (w, h) => w >= 64 && w % 64 === 0 && (h === w || h === w / 2);

  function isTarget(url) {
    if (!store.get(KEY_SKIN)) return false;
    if (!url || /^(data|blob):/i.test(url)) return false;
    const target = store.get(KEY_TARGET);
    return target ? strip(url) === target : NAME_RE.test(strip(url));
  }

  function note(url, w, h) {
    if (!url || /^(data|blob):/i.test(url)) return;
    const key = strip(url);
    if (!seen.has(key)) {
      seen.set(key, { w, h });
      listeners.forEach((fn) => fn());
    }
  }

  function dataURLToBlob(dataURL) {
    const [head, b64] = dataURL.split(',');
    const mime = (head.match(/:(.*?);/) || [])[1] || 'image/png';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // --- hook: <img>.src
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    const swap = (img, v) => {
      let val = v;
      try {
        if (typeof v === 'string') {
          if (isTarget(v)) val = store.get(KEY_SKIN);
          else {
            img.addEventListener('load', () => note(v, img.naturalWidth, img.naturalHeight), { once: true });
          }
        }
      } catch (e) { /* ignore */ }
      return val;
    };
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      enumerable: desc.enumerable,
      get() { return desc.get.call(this); },
      set(v) { desc.set.call(this, swap(this, v)); },
    });
    const origSetAttr = HTMLImageElement.prototype.setAttribute;
    HTMLImageElement.prototype.setAttribute = function (name, v) {
      if (String(name).toLowerCase() === 'src') v = swap(this, v);
      return origSetAttr.call(this, name, v);
    };
  } catch (e) { console.warn(words.hook_img, e); }

  // --- hook: fetch (TextureLoader / ImageBitmapLoader / własne loadery)
  try {
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input && input.url;
      try {
        if (url && isTarget(url)) {
          const blob = dataURLToBlob(store.get(KEY_SKIN));
          return Promise.resolve(new Response(blob, { status: 200, headers: { 'Content-Type': 'image/png' } }));
        }
      } catch (e) { /* ignore */ }
      const p = origFetch.apply(this, arguments);
      try {
        if (url && /\.png$/i.test(strip(url))) {
          p.then((r) => r.clone().arrayBuffer().then((buf) => {
            if (buf.byteLength > 24) {
              const dv = new DataView(buf);
              note(url, dv.getUint32(16), dv.getUint32(20));
            }
          })).catch(() => {});
        }
      } catch (e) { /* ignore */ }
      return p;
    };
  } catch (e) { console.warn(words.hook_fetch, e); }

  /* ------------------------------------------------------------------ *
   *  Rysowanie całej postaci ze skina (przód + tył)
   * ------------------------------------------------------------------ */
  function drawCharacter(canvas, img, S) {
    const k = img.width / 64;                 // skala dla skinów HD
    const legacy = img.height < img.width;    // 64x32
    // wykrycie slim (Alex): ostatnia kolumna przedniej ściany ręki jest przezroczysta
    let slim = false;
    if (!legacy) {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(47 * k, 20 * k, k, 12 * k).data;
      let opaque = false;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { opaque = true; break; }
      slim = !opaque;
    }
    const aw = slim ? 3 : 4;
    const W = 16, GAP = 4, H = 32;
    canvas.width = (W * 2 + GAP) * S;
    canvas.height = H * S;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const blit = (sx, sy, w, h, ox, dx, dy, flip) => {
      ctx.save();
      if (flip) {
        ctx.translate((ox + dx + w) * S, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, sx * k, sy * k, w * k, h * k, 0, dy * S, w * S, h * S);
      } else {
        ctx.drawImage(img, sx * k, sy * k, w * k, h * k, (ox + dx) * S, dy * S, w * S, h * S);
      }
      ctx.restore();
    };

    const view = (back, ox) => {
      const bases = [];
      const overlays = [];
      const xL = 4 - aw, xR = 12;                 // ręce (lewa/prawa strona w widoku)
      const D = aw + 4;                            // przesunięcie przód -> tył dla ręki

      if (!back) {
        bases.push([8, 8, 8, 8, 4, 0], [20, 20, 8, 12, 4, 8]);
        overlays.push([40, 8, 8, 8, 4, 0]);
        if (!legacy) overlays.push([20, 36, 8, 12, 4, 8]);
        // ręce
        bases.push([44, 20, aw, 12, xL, 8]);
        if (legacy) bases.push([44, 20, aw, 12, xR, 8, true]);
        else {
          bases.push([36, 52, aw, 12, xR, 8]);
          overlays.push([44, 36, aw, 12, xL, 8], [52, 52, aw, 12, xR, 8]);
        }
        // nogi
        bases.push([4, 20, 4, 12, 4, 20]);
        if (legacy) bases.push([4, 20, 4, 12, 8, 20, true]);
        else {
          bases.push([20, 52, 4, 12, 8, 20]);
          overlays.push([4, 36, 4, 12, 4, 20], [4, 52, 4, 12, 8, 20]);
        }
      } else {
        bases.push([24, 8, 8, 8, 4, 0], [32, 20, 8, 12, 4, 8]);
        overlays.push([56, 8, 8, 8, 4, 0]);
        if (!legacy) overlays.push([32, 36, 8, 12, 4, 8]);
        // ręce (w widoku z tyłu lewa ręka postaci jest po lewej)
        if (legacy) {
          bases.push([44 + D, 20, aw, 12, xL, 8, true], [44 + D, 20, aw, 12, xR, 8]);
        } else {
          bases.push([36 + D, 52, aw, 12, xL, 8], [44 + D, 20, aw, 12, xR, 8]);
          overlays.push([52 + D, 52, aw, 12, xL, 8], [44 + D, 36, aw, 12, xR, 8]);
        }
        // nogi
        if (legacy) {
          bases.push([12, 20, 4, 12, 4, 20, true], [12, 20, 4, 12, 8, 20]);
        } else {
          bases.push([28, 52, 4, 12, 4, 20], [12, 20, 4, 12, 8, 20]);
          overlays.push([12, 52, 4, 12, 4, 20], [12, 36, 4, 12, 8, 20]);
        }
      }
      bases.forEach((p) => blit(p[0], p[1], p[2], p[3], ox, p[4], p[5], p[6]));
      overlays.forEach((p) => blit(p[0], p[1], p[2], p[3], ox, p[4], p[5], p[6]));
    };

    view(false, 0);
    view(true, W + GAP);
    return { slim, legacy };
  }

  /* ------------------------------------------------------------------ *
   *  Interfejs (Shadow DOM, żeby nie kolidować ze stroną)
   * ------------------------------------------------------------------ */
  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
  }

  function buildUI() {
    if (document.getElementById('tsp-host')) return;
    const host = document.createElement('div');
    host.id = 'tsp-host';
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        *{box-sizing:border-box;font-family:system-ui,Segoe UI,Roboto,sans-serif}
        .fab{position:fixed;left:12px;bottom:12px;width:44px;height:44px;border-radius:12px;border:2px solid #fff3;
             background:#1b1b1f;color:#fff;font-size:22px;cursor:pointer;box-shadow:0 4px 14px #0008}
        .panel{position:fixed;left:12px;bottom:64px;width:340px;max-width:calc(100vw - 24px);max-height:calc(100vh - 90px);
               overflow:auto;background:#17171bf2;color:#eee;border:1px solid #fff2;border-radius:14px;padding:14px;
               box-shadow:0 10px 30px #000a;display:none}
        .panel.open{display:block}
        h3{margin:0 0 10px;font-size:15px}
        .drop{border:2px dashed #fff4;border-radius:12px;padding:16px;text-align:center;font-size:13px;color:#bbb;cursor:pointer}
        .drop.hover{border-color:#6cf;background:#6cf2;color:#fff}
        canvas{display:block;margin:12px auto 4px;image-rendering:pixelated;max-width:100%;
               background:repeating-conic-gradient(#2a2a30 0 25%,#222228 0 50%) 50%/16px 16px;border-radius:8px}
        .row{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
        button.b{flex:1;padding:8px 10px;border:0;border-radius:8px;background:#3a7bd5;color:#fff;font-size:13px;cursor:pointer}
        button.b.sec{background:#34343c}
        label{font-size:12px;color:#bbb;display:flex;gap:6px;align-items:center;margin-top:8px}
        .st{font-size:12px;color:#9c9;margin-top:6px;min-height:16px}
        .st.err{color:#f88}
        details{margin-top:10px;font-size:12px;color:#aaa}
        .cand{display:flex;justify-content:space-between;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid #fff1}
        .cand span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
        .cand button{padding:3px 8px;font-size:11px;border:0;border-radius:6px;background:#34343c;color:#fff;cursor:pointer}
        .overlay{position:fixed;inset:0;background:#0009;color:#fff;display:none;align-items:center;justify-content:center;
                 font-size:22px;pointer-events:none}
        .overlay.on{display:flex}
      </style>
      <button class="fab" title="Skin Painter">🎨</button>
      <div class="panel">
        <h3>🎨 Tweetcraft Skin Painter</h3>
        <div class="drop">${words.panel[0]}</div>
        <input type="file" accept="image/png" hidden>
        <canvas width="10" height="10"></canvas>
        <div class="st"></div>
        <label><input type="checkbox" class="auto">${words.panel[1]}</label>
        <div class="row">
          <button class="b apply">${words.panel[2]}</button>
          <button class="b sec clear">${words.panel[3]}</button>
        </div>
        <details>
          <summary>${words.panel[4]}</summary>
          <div class="cands">${words.panel[5]}</div>
          <div class="row"><button class="b sec resetTarget">${words.panel[6]}</button></div>
        </details>
      </div>
      <div class="overlay">${words.panel[7]}</div>
    `;
    (document.documentElement || document.body).appendChild(host);

    const $ = (s) => root.querySelector(s);
    const panel = $('.panel'), fab = $('.fab'), drop = $('.drop'), input = $('input[type=file]');
    const canvas = $('canvas'), st = $('.st'), auto = $('.auto'), overlay = $('.overlay');

    auto.checked = store.get(KEY_AUTO) !== '0';
    auto.addEventListener('change', () => store.set(KEY_AUTO, auto.checked ? '1' : '0'));

    // nie przepuszczamy zdarzeń do gry (sterowanie, pointer lock itd.)
    ['keydown', 'keyup', 'keypress', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click',
     'wheel', 'touchstart', 'touchend', 'contextmenu'].forEach((ev) =>
      panel.addEventListener(ev, (e) => e.stopPropagation()));
    fab.addEventListener('click', (e) => { e.stopPropagation(); panel.classList.toggle('open'); });

    const say = (msg, err) => { st.textContent = msg; st.className = 'st' + (err ? ' err' : ''); };

    async function showSkin(dataURL) {
      const img = await loadImage(dataURL);
      if (!isSkinShape(img.width, img.height)) {
        throw new Error(`${words.skin_size_warn[0]} ${img.width}×${img.height} – ${words.skin_size_warn[1]}.`);
      }
      const S = Math.max(4, Math.floor(300 / 36));
      const info = drawCharacter(canvas, img, S);
      return info;
    }

    async function handleFile(file) {
      if (!file) return;
      if (file.type !== 'image/png' && !/\.png$/i.test(file.name)) { say(words.not_image, true); return; }
      const dataURL = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      try {
        const info = await showSkin(dataURL);
        store.set(KEY_SKIN, dataURL);
        panel.classList.add('open');
        say(`${words.skin_painted[0]} (${info.legacy ? words.skin_painted[1] : info.slim ? 'slim / Alex' : words.skin_painted[2]}). ${words.skin_painted[3]}.`);
        if (auto.checked) { say(words.skin_saved); setTimeout(() => location.reload(), 500); }
      } catch (e) { say(e.message || words.unable_to_load, true); }
    }

    drop.addEventListener('click', () => input.click());
    input.addEventListener('change', () => handleFile(input.files[0]));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('hover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('hover'));

    // upuszczenie pliku w dowolnym miejscu strony
    let dragDepth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; overlay.classList.add('on'); } }, true);
    window.addEventListener('dragleave', (e) => {
      if (hasFiles(e)) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) overlay.classList.remove('on'); }
    }, true);
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); }, true);
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); e.stopPropagation();
      dragDepth = 0; overlay.classList.remove('on'); drop.classList.remove('hover');
      handleFile(e.dataTransfer.files[0]);
    }, true);

    $('.apply').addEventListener('click', () => {
      if (!store.get(KEY_SKIN)) { say(words.filefirst, true); return; }
      location.reload();
    });
    $('.clear').addEventListener('click', () => {
      store.del(KEY_SKIN);
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      say(words.skin_removed);
    });
    $('.resetTarget').addEventListener('click', () => { store.del(KEY_TARGET); renderCands(); say(words.default_detect); });

    function renderCands() {
      const box = $('.cands');
      const target = store.get(KEY_TARGET);
      const items = [...seen.entries()].filter(([, v]) => isSkinShape(v.w, v.h));
      const rest = [...seen.entries()].filter(([, v]) => !isSkinShape(v.w, v.h)).slice(0, 15);
      if (!items.length && !rest.length) return;
      const row = ([url, v]) => {
        const name = url.split('/').slice(-2).join('/');
        const on = target === url;
        return `<div class="cand"><span title="${url}">${on ? '✔ ' : ''}${name} (${v.w}×${v.h})</span>
                <button data-url="${url}">${words.use}</button></div>`;
      };
      box.innerHTML =
        (items.length ? `<b>${words.skin_matches}:</b>` + items.map(row).join('') : `<i>${words.no_sizes}.</i>`) +
        (rest.length ? `<div style="margin-top:8px"><b>${words.others}:</b></div>` + rest.map(row).join('') : '');
      box.querySelectorAll('button[data-url]').forEach((b) =>
        b.addEventListener('click', () => {
          store.set(KEY_TARGET, b.dataset.url);
          say(words.texture_selected);
          setTimeout(() => location.reload(), 400);
        }));
    }
    listeners.add(renderCands);
    renderCands();

    // pokaż zapisany skin przy starcie
    const saved = store.get(KEY_SKIN);
    if (saved) showSkin(saved).then(() => say(words.skin_loaded)).catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI);
  else buildUI();
})();