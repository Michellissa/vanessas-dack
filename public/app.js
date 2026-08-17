const APP = {
  api: '/api',
  productCard(p) {
    const imgs = p.image && p.image.length ? p.image : [null];
    const badge = this.stockBadge(p);
    return `
      <a class="card" href="/produkt?id=${p.id}">
        <div class="imgwrap">
          ${imgs[0] ? `<img loading="lazy" src="${imgs[0]}" alt="${this.esc(p.manufacturer)} ${this.esc(p.name)}" onerror="this.src='/public/no-image.svg'">` : '<img src="/public/no-image.svg" alt="">'}
        </div>
        <div class="body">
          <div class="mfg">${this.esc(p.manufacturer || '')}</div>
          <div class="name">${this.esc(p.name || '')}</div>
          <div class="dims">${this.esc(p.info || '')}</div>
          <div class="bottom">
            <div class="price">${p.price ? p.price.toLocaleString('sv-SE') + ' kr' : ''}</div>
            ${badge}
          </div>
        </div>
      </a>`;
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
  }
};

function injectHeader(active) {
  const header = document.getElementById('site-header');
  if (!header) return;
  const navItems = [
    ['/dack', 'Däck'],
    ['/falgar', 'Fälgar']
  ];
  header.innerHTML = `
    <div class="topbar">
      <div class="container">
        <span>Alltid fraktfritt! Däck och fälgar till bra priser</span>
        <span>Öppet vardagar 8–17, lördag 10–14</span>
      </div>
    </div>
    <div class="header-inner">
      <a class="logo" href="/">
        <img src="/public/logo.svg" alt="Vanessas Däck" style="height:42px; width:auto;">
      </a>
      <nav class="nav">
        ${navItems.map(([href, label]) => `<a href="${href}" class="${href === active ? 'active' : ''}">${label}</a>`).join('')}
      </nav>
      <a class="cart-link" href="/varukorg" title="Varukorg">
        <span class="cart-icon">🛒</span>
        <span class="cart-badge" style="display:none">0</span>
      </a>
      <a class="account-link" id="account-link" href="/logga-in">Logga in</a>
    </div>
    <div class="searchbar">
      <div class="container">
        <div class="searchbox">
          <input type="text" id="top-search" placeholder="Sök på märke, modell eller dimension..." value="${APP.esc(new URLSearchParams(location.search).get('q') || '')}">
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
  APP.updateCartCount();
  window.doSearch = () => {
    const q = document.getElementById('top-search').value.trim();
    location.href = '/sok?q=' + encodeURIComponent(q);
  };
}

APP.initAccount = async function () {
  const link = document.getElementById('account-link');
  if (!link) return;
  try {
    const r = await fetch('/api/me');
    if (r.ok) {
      const d = await r.json();
      link.textContent = d.user.name.split(' ')[0] + ' · Mina sidor';
      link.href = '/mina-sidor';
      link.title = 'Logga ut';
    }
  } catch (e) {}
};
