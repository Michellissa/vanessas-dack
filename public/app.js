const APP = {
  api: '/api',
  productCache: {},
  hash(s) {
    let h = 0;
    s = String(s);
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    return h;
  },
  settingsCache: null,
  getSettings() {
    if (this.settingsCache) return Promise.resolve(this.settingsCache);
    return fetch('/api/settings').then(r => r.json()).then(d => {
      this.settingsCache = (d && d.settings) || {};
      return this.settingsCache;
    }).catch(() => ({}));
  },
  ratingFor(id) {
    return Math.round((4.3 + (this.hash(id) % 8) / 10) * 10) / 10;
  },
  ratingHTML(id) {
    const r = this.ratingFor(id);
    const pct = Math.round(r / 5 * 100);
    return `<span class="stars" title="${r.toFixed(1)} av 5"><span class="stars-row"><span class="stars-bg">★★★★★</span><span class="stars-fill" style="width:${pct}%">★★★★★</span></span><span class="stars-num">${r.toFixed(1)}</span></span>`;
  },
  cacheProducts(products) {
    (products || []).forEach(p => { this.productCache[p.id] = p; });
  },
  quickAdd(btn, id) {
    const p = this.productCache[id];
    if (!p) return;
    this.addToCart(p, 1);
    const old = btn.innerHTML;
    btn.classList.add('added');
    btn.textContent = 'Tillagd';
    setTimeout(() => { btn.classList.remove('added'); btn.innerHTML = old; }, 1600);
  },
  productCard(p) {
    const imgs = p.image && p.image.length ? p.image : [null];
    const badge = this.stockBadge(p);
    return `
      <div class="card reveal">
        <a class="imgwrap" href="/produkt?id=${p.id}">
          ${imgs[0] ? `<img loading="lazy" src="${imgs[0]}" alt="${this.esc(p.manufacturer)} ${this.esc(p.name)}" onerror="this.src='/public/no-image.svg'">` : '<img src="/public/no-image.svg" alt="">'}
          ${badge}
        </a>
        <div class="body">
          <div class="mfg">${this.esc(p.manufacturer || '')}</div>
          <a class="name" href="/produkt?id=${p.id}">${this.esc(p.name || '')}</a>
          <div class="dims">${this.esc(p.info || '')}</div>
          ${this.ratingHTML(p.id)}
          <div class="bottom">
            <div class="price">${p.price ? p.price.toLocaleString('sv-SE') + ' kr' : ''}</div>
            <button class="btn add" onclick="APP.quickAdd(this, ${p.id})">Lägg i varukorg</button>
          </div>
        </div>
      </div>`;
  },
  stockBadge(p) {
    if (p.stock > 0) return `<span class="badge b-green">${p.stock} i butik</span>`;
    if (p.external_stock > 0) return `<span class="badge b-orange">Extern: ${p.external_stock}</span>`;
    return '<span class="badge b-red">Beställningsvara</span>';
  },
  esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  },
  qs(params) {
    return new URLSearchParams(params).toString();
  },
  money(n) {
    return n ? n.toLocaleString('sv-SE') + ' kr' : '';
  },
  CART_KEY: 'vd_cart',
  getCart() {
    try {
      return JSON.parse(localStorage.getItem(this.CART_KEY)) || [];
    } catch {
      return [];
    }
  },
  saveCart(cart) {
    localStorage.setItem(this.CART_KEY, JSON.stringify(cart));
    this.updateCartCount();
  },
  addToCart(product, qty) {
    const cart = this.getCart();
    const found = cart.find(i => i.id === product.id);
    if (found) {
      found.qty = Math.min(found.qty + (qty || 1), 50);
    } else {
      cart.push({
        id: product.id,
        manufacturer: product.manufacturer,
        name: product.name,
        info: product.info,
        price: product.price,
        image: product.image && product.image.length ? product.image[0] : '/public/no-image.svg',
        qty: qty || 1
      });
    }
    this.saveCart(cart);
  },
  updateCartQty(id, qty) {
    const cart = this.getCart();
    const found = cart.find(i => i.id === id);
    if (found) {
      found.qty = Math.min(Math.max(qty, 1), 50);
      this.saveCart(cart);
    }
  },
  removeFromCart(id) {
    this.saveCart(this.getCart().filter(i => i.id !== id));
  },
  clearCart() {
    this.saveCart([]);
  },
  cartCount() {
    return this.getCart().reduce((s, i) => s + i.qty, 0);
  },
  cartTotal() {
    return this.getCart().reduce((s, i) => s + (i.price || 0) * i.qty, 0);
  },
  updateCartCount() {
    document.querySelectorAll('.cart-badge').forEach(b => {
      const n = this.cartCount();
      b.textContent = n;
      b.style.display = n ? 'inline-flex' : 'none';
    });
  },
  revealObserver: null,
  reveal() {
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));
      return;
    }
    if (!this.revealObserver) {
      this.revealObserver = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            this.revealObserver.unobserve(e.target);
          }
        });
      }, { threshold: 0.08 });
    }
    document.querySelectorAll('.reveal:not(.in)').forEach(el => this.revealObserver.observe(el));
  },
  initAccount: async function () {
    const links = document.querySelectorAll('.account-link');
    if (!links.length) return;
    try {
      const r = await fetch('/api/me');
      if (r.ok) {
        const d = await r.json();
        links.forEach(l => {
          l.textContent = d.user.name.split(' ')[0] + ' · Mina sidor';
          l.href = '/mina-sidor';
          l.title = 'Logga ut';
        });
      }
    } catch (e) {}
  }
};

const NAV_ITEMS = [
  ['/dack', 'Däck'],
  ['/falgar', 'Fälgar'],
  ['/dack?season=dubb', 'Vinterdäck'],
  ['/dack?season=sommar', 'Sommardäck'],
  ['/kontakta-oss', 'Montering']
];

function injectHeader(active) {
  const header = document.getElementById('site-header');
  if (!header) return;
  APP.getSettings().then(s => {
    const el = document.getElementById('topbar-hours');
    if (el && s.openingHours) el.textContent = s.openingHours;
  });
  header.innerHTML = `
    <div class="topbar">
      <div class="container">
        <span>Alltid fraktfritt! Däck och fälgar till bra priser</span>
        <span id="topbar-hours">Öppet vardagar 9–17</span>
      </div>
    </div>
    <div class="header-inner">
      <a class="logo" href="/">
        <img src="/public/logo.svg" alt="Vanessas Däck">
      </a>
      <nav class="nav" id="main-nav">
        ${NAV_ITEMS.map(([href, label]) => `<a href="${href}" class="${active === href || (active === '/dack' && href === '/dack') || (active === '/falgar' && href === '/falgar') ? 'active' : ''}">${label}</a>`).join('')}
      </nav>
      <div class="header-actions">
        <button class="icon-btn" title="Sök" onclick="focusSearch()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>
        </button>
        <a class="account-link" id="account-link" href="/logga-in">Logga in</a>
        <a class="cart-link" href="/varukorg" title="Varukorg">
          <svg class="cart-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"></circle><circle cx="19" cy="21" r="1"></circle><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path></svg>
          <span class="cart-badge" style="display:none">0</span>
        </a>
        <button class="burger" id="burger" aria-label="Meny" onclick="toggleMenu()">
          <span></span><span></span><span></span>
        </button>
      </div>
    </div>
    <div class="mobile-menu" id="mobile-menu">
      <div class="mm-search"><div class="searchbox">
        <input type="text" id="mm-search" placeholder="Sök på märke, modell, dimension eller artikelnummer..." value="${APP.esc(new URLSearchParams(location.search).get('q') || '')}">
        <button onclick="doSearch()">Sök</button>
      </div></div>
      ${NAV_ITEMS.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}
      <a href="/logga-in" class="mm-account" id="mm-account-link">Logga in</a>
    </div>
    <div class="searchbar" id="searchbar">
      <div class="container">
        <div class="searchbox">
          <input type="text" id="top-search" placeholder="Sök på märke, modell, dimension eller artikelnummer..." value="${APP.esc(new URLSearchParams(location.search).get('q') || '')}">
          <button onclick="doSearch()">Sök</button>
        </div>
      </div>
    </div>`;
  const input = document.getElementById('top-search');
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') doSearch();
    });
  }
  const mmInput = document.getElementById('mm-search');
  if (mmInput) {
    mmInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') doSearch();
    });
  }
  const acc = document.getElementById('account-link');
  const mmAcc = document.getElementById('mm-account-link');
  if (mmAcc) {
    mmAcc.addEventListener('click', () => document.getElementById('site-header').classList.remove('menu-open'));
  }
  APP.updateCartCount();
  window.doSearch = () => {
    const mm = window.matchMedia('(max-width: 900px)').matches ? document.getElementById('mm-search') : null;
    const input = mm || document.getElementById('top-search');
    const q = input ? input.value.trim() : '';
    location.href = '/sok?q=' + encodeURIComponent(q);
  };
}

window.focusSearch = () => {
  const mm = document.getElementById('mm-search');
  if (mm && window.matchMedia('(max-width: 900px)').matches) {
    document.getElementById('site-header').classList.add('menu-open');
    mm.focus();
    return;
  }
  const sb = document.getElementById('searchbar');
  if (sb) {
    sb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const i = document.getElementById('top-search');
    if (i) setTimeout(() => i.focus(), 350);
  }
};

window.toggleMenu = () => {
  document.getElementById('site-header').classList.toggle('menu-open');
};

window.addEventListener('scroll', () => {
  const header = document.getElementById('site-header');
  if (!header) return;
  header.classList.toggle('scrolled', window.scrollY > 8);
}, { passive: true });

document.addEventListener('click', e => {
  const header = document.getElementById('site-header');
  if (header && header.classList.contains('menu-open')) {
    if (e.target.closest('.mobile-menu a')) {
      header.classList.remove('menu-open');
    }
  }
});

function injectFooter() {
  document.querySelectorAll('#site-footer').forEach(el => {
    el.classList.add('site');
    el.innerHTML = `
      <div class="container">
        <div class="cols">
          <div class="col-brand">
            <h4>Vanessas Däck</h4>
            <p>Din lokala däck- och fälgbutik i Jordbro. Stort sortiment, professionell montering och alltid fraktfritt – för privatpersoner och företag.</p>
            <div class="social">
              <a href="https://www.facebook.com/Vanessasdack.se" target="_blank" rel="noopener" title="Facebook"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg></a>
              <a href="https://se.trustpilot.com/review/www.vanessasdack.se" target="_blank" rel="noopener" title="Trustpilot"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path></svg></a>
              <a href="https://www.blocket.se/butik/vanessas-dack" target="_blank" rel="noopener" title="Blocket Butik"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg></a>
            </div>
          </div>
          <div>
            <h4>Snabblänkar</h4>
            <a href="/dack">Däck</a>
            <a href="/falgar">Fälgar</a>
            <a href="/dack?season=dubb">Vinterdäck</a>
            <a href="/dack?season=sommar">Sommardäck</a>
            <a href="/dack">Alla produkter</a>
          </div>
          <div>
            <h4>Kundservice</h4>
            <a href="/kontakta-oss">Kontakta oss</a>
            <a href="/bra-att-veta">FAQ</a>
            <a href="/villkor">Leverans</a>
            <a href="/villkor">Returer</a>
            <a href="/villkor">Köpvillkor</a>
          </div>
          <div>
            <h4>Kontakt</h4>
            <a href="tel:0850110232">08-501 10 232</a>
            <a href="mailto:info@vanessasdack.se">info@vanessasdack.se</a>
            <span class="addr">Dåntorpsvägen 33 AB<br>136 50 Jordbro</span>
          </div>
        </div>
        <div class="bottom">
          <span>© ${new Date().getFullYear()} Vanessas Däck AB · Org. nr 556825-1663</span>
          <span>Alltid fraktfritt!</span>
        </div>
      </div>`;
  });
}

if (document.getElementById('site-footer')) {
  injectFooter();
}