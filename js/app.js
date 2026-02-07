/**
 * CardPerks — Main Application
 *
 * Loads offer data from JSON files in /data and renders the coupon grid.
 * Supports filtering by issuer, category, search, and sorting.
 */

// ── Issuer Config ──
const ISSUERS = {
  amex:     { name: "American Express", color: "var(--amex-bg)",    lightBg: "var(--amex-light)",    abbr: "AMEX" },
  chase:    { name: "Chase",            color: "var(--chase-bg)",   lightBg: "var(--chase-light)",   abbr: "CHASE" },
  bofa:     { name: "Bank of America",  color: "var(--bofa-bg)",    lightBg: "var(--bofa-light)",    abbr: "BofA" },
  capone:   { name: "Capital One",      color: "var(--capone-bg)",  lightBg: "var(--capone-light)",  abbr: "C1" },
  citi:     { name: "Citi",             color: "var(--citi-bg)",    lightBg: "var(--citi-light)",    abbr: "CITI" },
  discover: { name: "Discover",         color: "var(--discover-bg)",lightBg: "var(--discover-light)",abbr: "DISC" },
  usbank:   { name: "US Bank",          color: "var(--usbank-bg)",  lightBg: "var(--usbank-light)",  abbr: "USB" },
  wells:    { name: "Wells Fargo",      color: "var(--wells-bg)",   lightBg: "var(--wells-light)",   abbr: "WF" },
};

const ISSUER_ORDER = ["amex", "chase", "bofa", "capone", "citi", "discover", "usbank", "wells"];

// Data sources to load
const DATA_FILES = [
  { file: "data/amex-offers.json", issuer: "amex" },
  { file: "data/chase-offers.json", issuer: "chase" },
  { file: "data/bofa-offers.json", issuer: "bofa" },
  // { file: "data/capone-offers.json", issuer: "capone" },
  // { file: "data/citi-offers.json", issuer: "citi" },
  // { file: "data/discover-offers.json", issuer: "discover" },
  // { file: "data/usbank-offers.json", issuer: "usbank" },
  // { file: "data/wells-offers.json", issuer: "wells" },
];

// ── State ──
let allOffers = [];
let activeIssuer = "all";
let activeCategory = "all";
let searchQuery = "";
let sortMode = "value-desc";
let dataMetadata = {};

// ── DOM refs ──
const mainEl = document.getElementById("main-content");
const countEl = document.getElementById("result-count");
const updateDateEl = document.getElementById("update-date");
const dataDateEl = document.getElementById("data-date");
const searchInput = document.getElementById("search");
const sortSelect = document.getElementById("sort-select");
const modalOverlay = document.getElementById("modal-overlay");
const modalContent = document.getElementById("modal-content");

// ── Date Helpers ──
const today = new Date();

function daysUntil(dateStr) {
  const d = new Date(dateStr);
  return Math.ceil((d - today) / (1000 * 60 * 60 * 24));
}

function formatExpiry(dateStr) {
  const days = daysUntil(dateStr);
  const d = new Date(dateStr);
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (days < 0) return { text: "Expired", soon: true };
  if (days <= 14) return { text: `Expires ${label} (${days}d left)`, soon: true };
  return { text: `Expires ${label}`, soon: false };
}

// ── Data Loading ──
async function loadData() {
  mainEl.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading offers...</p>
    </div>`;

  const results = await Promise.allSettled(
    DATA_FILES.map(async ({ file, issuer }) => {
      const res = await fetch(file);
      if (!res.ok) throw new Error(`Failed to load ${file}`);
      const data = await res.json();
      dataMetadata[issuer] = {
        lastUpdated: data.lastUpdated,
        source: data.source,
      };
      return data.offers.map((o) => ({ ...o, issuer, issuerName: data.issuerName }));
    })
  );

  allOffers = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allOffers.push(...result.value);
    }
  }

  // Filter out expired offers (older than 7 days past expiry for grace period)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  allOffers = allOffers.filter((o) => new Date(o.expiry) >= cutoff);

  // Update header date
  const dates = Object.values(dataMetadata).map((m) => m.lastUpdated).sort();
  const latestDate = dates[dates.length - 1];
  if (updateDateEl) {
    updateDateEl.textContent = new Date(latestDate).toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });
  }
  if (dataDateEl) {
    dataDateEl.textContent = latestDate;
  }

  // Dynamically enable issuer pills based on loaded data
  updateIssuerPills();

  render();
}

// ── Enable only issuer pills that have data ──
function updateIssuerPills() {
  const loadedIssuers = new Set(allOffers.map((o) => o.issuer));
  document.querySelectorAll("#issuer-filters .pill[data-issuer]").forEach((pill) => {
    const issuer = pill.dataset.issuer;
    if (issuer === "all") return;
    if (!loadedIssuers.has(issuer)) {
      pill.style.opacity = "0.4";
      pill.style.pointerEvents = "none";
      pill.title = "Coming soon";
    }
  });
}

// ── Filter & Sort ──
function getFiltered() {
  let list = allOffers.filter((c) => {
    if (activeIssuer !== "all" && c.issuer !== activeIssuer) return false;
    if (activeCategory !== "all" && c.category !== activeCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const haystack = `${c.merchant} ${c.issuerName} ${c.description} ${c.category} ${c.value}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  list.sort((a, b) => {
    switch (sortMode) {
      case "value-desc": return b.valueNum - a.valueNum;
      case "value-asc":  return a.valueNum - b.valueNum;
      case "expiry-asc": return new Date(a.expiry) - new Date(b.expiry);
      case "newest":     return (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0);
      case "alpha":      return a.merchant.localeCompare(b.merchant);
      default: return 0;
    }
  });

  return list;
}

// ── Render ──
function render() {
  const filtered = getFiltered();
  countEl.innerHTML = `Showing <strong>${filtered.length}</strong> of ${allOffers.length} offers`;

  if (filtered.length === 0) {
    mainEl.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/>
        </svg>
        <h3>No offers found</h3>
        <p>Try adjusting your search or filters.</p>
      </div>`;
    return;
  }

  // Group by issuer
  const grouped = {};
  filtered.forEach((c) => {
    if (!grouped[c.issuer]) grouped[c.issuer] = [];
    grouped[c.issuer].push(c);
  });

  let html = "";

  ISSUER_ORDER.forEach((key) => {
    if (!grouped[key]) return;
    const info = ISSUERS[key];
    const items = grouped[key];
    const meta = dataMetadata[key];

    html += `<section class="issuer-section">
      <div class="issuer-header">
        <div class="issuer-badge" style="background:${info.color}">${info.abbr}</div>
        <h2>${info.name}</h2>
        <div class="offer-count">${items.length} offer${items.length !== 1 ? "s" : ""}${meta ? ` &middot; Updated ${meta.lastUpdated}` : ""}</div>
      </div>
      <div class="coupon-grid">`;

    items.forEach((c) => {
      const exp = formatExpiry(c.expiry);
      html += `
        <div class="coupon-card" onclick="openModal('${c.id}')">
          <div class="card-top">
            <div class="merchant-logo" style="background:${info.lightBg}">${c.emoji}</div>
            <div class="offer-info">
              <div class="merchant-name">${escapeHtml(c.merchant)}</div>
              <div class="offer-value">${escapeHtml(c.value)}</div>
            </div>
          </div>
          <div class="card-body">
            <p class="description">${escapeHtml(c.description)}</p>
          </div>
          <div class="card-footer">
            <div class="tags">
              <span class="tag tag-issuer">${info.abbr}</span>
              <span class="tag tag-category">${c.category}</span>
              ${c.isNew ? '<span class="tag tag-new">New</span>' : ""}
              ${c.isHot ? '<span class="tag tag-hot">Hot</span>' : ""}
            </div>
            <span class="expiry${exp.soon ? " expiring-soon" : ""}">${exp.text}</span>
          </div>
          <div class="card-action">
            <button class="btn-activate">View Details</button>
          </div>
        </div>`;
    });

    html += `</div></section>`;
  });

  mainEl.innerHTML = html;
}

// ── Security: HTML escaping ──
function escapeHtml(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// ── Modal ──
function openModal(id) {
  const c = allOffers.find((x) => x.id === id);
  if (!c) return;
  const info = ISSUERS[c.issuer];
  const exp = formatExpiry(c.expiry);

  modalContent.innerHTML = `
    <button class="modal-close" onclick="closeModal()">&times;</button>
    <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.5rem;">
      <div class="merchant-logo" style="background:${info.lightBg};width:52px;height:52px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;">${c.emoji}</div>
      <div>
        <h3 style="margin:0">${escapeHtml(c.merchant)}</h3>
        <span style="font-size:.85rem;color:var(--text-muted)">${escapeHtml(c.issuerName)}</span>
      </div>
    </div>
    <div class="modal-value">${escapeHtml(c.value)}</div>
    <p class="modal-desc">${escapeHtml(c.description)}</p>
    <div class="modal-details">
      <span>Category:</span> ${c.category.charAt(0).toUpperCase() + c.category.slice(1)}<br>
      <span>Min. Spend:</span> ${escapeHtml(c.minSpend)}<br>
      <span>Max Reward:</span> ${escapeHtml(c.maxReward)}<br>
      <span>Expiry:</span> <span class="${exp.soon ? "expiring-soon" : ""}">${exp.text}</span><br>
      <span>Terms:</span> ${escapeHtml(c.terms)}
    </div>
    ${c.sourceUrl ? `<div class="modal-source">Source: <a href="${escapeHtml(c.sourceUrl)}" target="_blank" rel="noopener noreferrer">${new URL(c.sourceUrl).hostname}</a></div>` : ""}
    <button class="modal-cta" onclick="closeModal()">Got It</button>`;

  modalOverlay.classList.add("open");
}

function closeModal() {
  modalOverlay.classList.remove("open");
}

// ── Event Listeners ──
document.getElementById("issuer-filters").addEventListener("click", (e) => {
  const btn = e.target.closest(".pill");
  if (!btn || btn.style.pointerEvents === "none") return;
  document.querySelectorAll("#issuer-filters .pill").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  activeIssuer = btn.dataset.issuer;
  render();
});

document.getElementById("category-filters").addEventListener("click", (e) => {
  const btn = e.target.closest(".cat-pill");
  if (!btn) return;
  document.querySelectorAll("#category-filters .cat-pill").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  activeCategory = btn.dataset.cat;
  render();
});

searchInput.addEventListener("input", (e) => {
  searchQuery = e.target.value;
  render();
});

sortSelect.addEventListener("change", (e) => {
  sortMode = e.target.value;
  render();
});

modalOverlay.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// ── Init ──
loadData();
