/* =========================================================
   Trabalho Digno — mapa público
   Os locais vêm de data/denuncias.js, que é atualizado
   pelo painel de controle (aberto pelo "·" do rodapé).
   ========================================================= */

const DATA_SCRIPT = "data/denuncias.js";
const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const severityStyle = {
  moderada: { label: "Moderada", legend: "low" },
  grave: { label: "Grave", legend: "medium" },
  muito_grave: { label: "Muito grave", legend: "high" }
};

const statusStyle = {
  denunciado: { label: "Denúncia recebida", icon: "◈" },
  apuracao: { label: "Em apuração", icon: "⌕" },
  confirmado: { label: "Caso confirmado", icon: "✓" }
};

const typeLabel = {
  infantil: "Trabalho infantil",
  analogo: "Trabalho análogo à escravidão"
};

let map;
let layers = [];
let currentFilter = "todos";
let locations = [];
let dataLoaded = false;
let loadError = false;

/* ---------- utilidades ---------- */

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

/* ---------- dados ---------- */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => { script.remove(); resolve(); };
    script.onerror = () => { script.remove(); reject(new Error(`Falha ao carregar ${src}`)); };
    document.head.appendChild(script);
  });
}

function cacheBust() {
  return location.protocol === "file:" ? "" : `?t=${Date.now()}`;
}

let currentData = { updatedAt: null, locais: [] };

function setData(data) {
  currentData = {
    updatedAt: data && data.updatedAt ? data.updatedAt : null,
    locais: data && Array.isArray(data.locais) ? data.locais : []
  };

  locations = currentData.locais
    .filter(item => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng)))
    .map(item => ({ ...item, lat: Number(item.lat), lng: Number(item.lng), reports: Number(item.reports) || 0 }));

  loadError = false;
  dataLoaded = true;
  document.getElementById("map-badge").textContent = currentData.updatedAt
    ? `Atualizado em ${formatDate(currentData.updatedAt)}`
    : "Dados do projeto Trabalho Digno";
  renderCompanies(document.getElementById("region-search").value);
}

async function loadData() {
  try {
    window.TRABALHO_DIGNO_DATA = undefined;
    await loadScript(DATA_SCRIPT + cacheBust());
    setData(window.TRABALHO_DIGNO_DATA || { locais: [] });
  } catch (error) {
    console.warn("Não foi possível carregar os dados do mapa:", error);
    loadError = true;
    dataLoaded = true;
    document.getElementById("map-badge").textContent = "Dados indisponíveis";
    renderCompanies(document.getElementById("region-search").value);
  }
}

/* API usada pelo painel de controle para atualizar o mapa na hora */
window.TD = {
  setData,
  getData: () => JSON.parse(JSON.stringify(currentData)),
  loadScript,
  cacheBust,
  TILE_URL,
  TILE_ATTRIBUTION
};

/* ---------- mapa ---------- */

function initMap() {
  const mapElement = document.getElementById("map");

  if (!window.L) {
    mapElement.innerHTML = `
      <div style="display:grid;place-items:center;height:100%;padding:40px;text-align:center;color:#7a5540;background:linear-gradient(135deg,#f4ddcc,#fff6ef)">
        <div><strong style="display:block;color:#4a2410;font-size:22px;margin-bottom:8px">Mapa indisponível</strong>
        Verifique sua conexão com a internet para carregar o mapa do OpenStreetMap.</div>
      </div>`;
    return;
  }

  map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: false,
    minZoom: 3
  }).setView([-15.8, -47.9], 4);

  L.tileLayer(TILE_URL, {
    maxZoom: 19,
    subdomains: "abcd",
    attribution: TILE_ATTRIBUTION
  }).addTo(map);
}

function createCompanyIcon(company) {
  const severity = severityStyle[company.severity] ? company.severity : "moderada";
  return L.divIcon({
    className: "company-marker-wrap",
    html: `<div class="company-marker ${escapeHTML(company.type)} sev-${severity}"><span>!</span></div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 42],
    popupAnchor: [0, -43]
  });
}

function getVisibleCompanies(searchTerm = "") {
  const normalizedSearch = normalize(searchTerm.trim());
  return locations.filter(company => {
    const matchesType = currentFilter === "todos" || company.type === currentFilter;
    const searchableText = normalize(`${company.name} ${company.address} ${company.city} ${company.state}`);
    const matchesSearch = !normalizedSearch || searchableText.includes(normalizedSearch);
    return matchesType && matchesSearch;
  });
}

function popupHTML(company) {
  const severity = severityStyle[company.severity] || severityStyle.moderada;
  const status = statusStyle[company.status] || statusStyle.denunciado;
  const place = [company.city, company.state].filter(Boolean).join(" — ");
  const date = formatDate(company.date);

  return `
    <div class="popup-card">
      <span class="popup-tag ${escapeHTML(company.type)}">${escapeHTML(typeLabel[company.type] || "Situação irregular")}</span>
      <div class="popup-status status-${escapeHTML(company.status || "denunciado")}">${status.icon} ${status.label}</div>
      <h4>${escapeHTML(company.name)}</h4>
      ${company.address ? `<span class="popup-location">${escapeHTML(company.address)}</span>` : ""}
      ${place ? `<span class="popup-location popup-city">${escapeHTML(place)}</span>` : ""}
      ${company.description ? `<p>${escapeHTML(company.description)}</p>` : ""}
      <div class="popup-meta"><span>Gravidade: ${severity.label}</span><span>${company.reports} relato(s)</span></div>
      ${date ? `<span class="popup-location">Registrado em ${date}</span>` : ""}
    </div>
  `;
}

function renderCompanies(searchTerm = "") {
  const visibleCompanies = getVisibleCompanies(searchTerm);
  updateStats(visibleCompanies);
  updateEmptyState(visibleCompanies, searchTerm);

  if (!map) return;
  layers.forEach(layer => map.removeLayer(layer));
  layers = [];

  visibleCompanies.forEach(company => {
    const marker = L.marker([company.lat, company.lng], {
      icon: createCompanyIcon(company),
      title: company.name
    }).addTo(map);

    marker.bindPopup(popupHTML(company));
    layers.push(marker);
  });

  if (visibleCompanies.length && searchTerm.trim()) {
    const bounds = L.latLngBounds(visibleCompanies.map(company => [company.lat, company.lng]));
    map.fitBounds(bounds.pad(.6), { maxZoom: 13 });
  }
}

function updateEmptyState(visibleCompanies, searchTerm) {
  const box = document.getElementById("map-empty");
  if (!dataLoaded || visibleCompanies.length) {
    box.hidden = true;
    return;
  }

  let title = "Nenhum resultado";
  let text = "Nenhum local corresponde aos filtros selecionados.";

  if (loadError) {
    title = "Não foi possível carregar os dados";
    text = "Verifique se a pasta data/ (com o arquivo denuncias.js) foi enviada junto com o site.";
  } else if (!locations.length) {
    title = "Nenhum endereço cadastrado ainda";
    text = "Os locais aparecerão aqui assim que forem analisados pela equipe.";
  } else if (searchTerm.trim()) {
    text = `Nenhum local encontrado para “${escapeHTML(searchTerm.trim())}”.`;
  }

  box.innerHTML = `<strong>${title}</strong><span>${text}</span>`;
  box.hidden = false;
}

/* ---------- métricas ---------- */

function animateNumber(element, target) {
  const start = Number(element.dataset.value || element.textContent) || 0;
  element.dataset.value = target;
  if (start === target) {
    element.textContent = target.toLocaleString("pt-BR");
    return;
  }

  const duration = 650;
  const startTime = performance.now();

  const step = now => {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = Math.round(start + (target - start) * eased).toLocaleString("pt-BR");
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function updateStats(visibleCompanies) {
  const totals = {
    addresses: visibleCompanies.length,
    reports: visibleCompanies.reduce((sum, item) => sum + (item.reports || 0), 0),
    confirmed: visibleCompanies.filter(item => item.status === "confirmado").length,
    critical: visibleCompanies.filter(item => item.severity === "muito_grave").length
  };

  animateNumber(document.getElementById("stat-addresses"), totals.addresses);
  animateNumber(document.getElementById("stat-reports"), totals.reports);
  animateNumber(document.getElementById("stat-confirmed"), totals.confirmed);
  animateNumber(document.getElementById("stat-critical"), totals.critical);
}

/* ---------- filtros ---------- */

function setupFilters() {
  document.querySelectorAll(".filter").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach(item => item.classList.remove("active"));
      button.classList.add("active");
      currentFilter = button.dataset.filter;
      renderCompanies(document.getElementById("region-search").value);
    });
  });

  const searchInput = document.getElementById("region-search");
  searchInput.addEventListener("input", () => renderCompanies(searchInput.value));
}

/* ---------- formulário de relato (Google Forms) ---------- */

function setupModal() {
  const modal = document.getElementById("report-modal");
  const iframe = document.getElementById("report-iframe");
  const loading = document.getElementById("form-loading");

  iframe.addEventListener("load", () => {
    if (iframe.src) loading.hidden = true;
  });

  const openModal = () => {
    if (!iframe.src) iframe.src = iframe.dataset.src;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    setTimeout(() => modal.querySelector(".modal-close").focus(), 80);
  };

  const closeModal = () => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  };

  document.querySelectorAll("[data-open-report]").forEach(button => button.addEventListener("click", openModal));
  document.querySelectorAll("[data-close-report]").forEach(button => button.addEventListener("click", closeModal));

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("open")) closeModal();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  setupFilters();
  setupModal();
  loadData();
});
