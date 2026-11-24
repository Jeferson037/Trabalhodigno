/* =========================================================
   Trabalho Digno — painel de controle (dentro do index.html)

   • Aberto pelo "·" do rodapé ou pelo endereço  …/#painel
   • Protegido por senha (só o hash PBKDF2 fica no código)
   • O token do GitHub é guardado CRIPTOGRAFADO com a senha
     em data/acesso.js — sem a senha ninguém consegue publicar.
   • As alterações são gravadas em data/denuncias.js
   ========================================================= */

(() => {
  const DATA_PATH = "data/denuncias.js";
  const ACCESS_PATH = "data/acesso.js";
  const DRAFT_KEY = "tdPainelDraft";
  const KDF_ITERATIONS = 250000;

  // Hash PBKDF2-SHA256 da senha do painel (a senha em si não fica no código)
  const AUTH = {
    salt: "b6eb0442fc9a6e8eb8ab6812a1af413b",
    iterations: 250000,
    hash: "7ecf1c55837dd6f3e0544441f4e5e66839277bd1da909e41ad6556e7986181b0"
  };

  const STATES = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
  const SEVERITY = {
    moderada: { label: "Moderada", color: "#f7a35c" },
    grave: { label: "Grave", color: "#ed741f" },
    muito_grave: { label: "Muito grave", color: "#b9380b" }
  };
  const STATUS = { denunciado: "Denúncia recebida", apuracao: "Em apuração", confirmado: "Caso confirmado" };
  const TYPE = { infantil: "Trabalho infantil", analogo: "Trabalho análogo à escravidão" };

  const state = { locais: [], updatedAt: null, sha: null, dirty: false };
  const session = { password: null, unlocked: false };
  let config = { owner: "", repo: "", branch: "main", token: "" };
  let map, pickMarker, savedLayer;

  const $ = id => document.getElementById(id);
  const textEncoder = new TextEncoder();

  /* ---------------- utilidades ---------------- */

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  const normalize = text => String(text ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const newId = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const today = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };

  const hexToBytes = hex => new Uint8Array(hex.match(/../g).map(byte => parseInt(byte, 16)));
  const bytesToHex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
  function bytesToBase64(buffer) {
    let binary = "";
    new Uint8Array(buffer).forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }
  const base64ToBytes = b64 => Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0));
  const textToBase64 = text => bytesToBase64(textEncoder.encode(text));
  const base64ToText = b64 => new TextDecoder().decode(base64ToBytes(b64));

  let toastTimer;
  function toast(message, type = "info") {
    const el = $("toast");
    el.textContent = message;
    el.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = "toast"; }, 4500);
  }

  function setSync(text, kind) {
    $("sync-pill").textContent = text;
    $("sync-pill").className = `sync-pill ${kind || ""}`;
  }

  function sanitizeList(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter(item => item && item.name && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng)))
      .map(item => ({
        id: item.id || newId(),
        name: String(item.name),
        address: String(item.address || ""),
        city: String(item.city || ""),
        state: String(item.state || ""),
        lat: Number(item.lat),
        lng: Number(item.lng),
        type: TYPE[item.type] ? item.type : "infantil",
        severity: SEVERITY[item.severity] ? item.severity : "moderada",
        status: STATUS[item.status] ? item.status : "denunciado",
        reports: Math.max(0, parseInt(item.reports, 10) || 0),
        date: String(item.date || ""),
        description: String(item.description || "")
      }));
  }

  /* data/*.js usa o formato:  window.NOME = { ...json... };  */
  function parseDataScript(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("Arquivo em formato inválido.");
    return JSON.parse(text.slice(start, end + 1));
  }

  function buildDataScript(data) {
    return "// Arquivo gerado pelo painel de controle do Trabalho Digno.\n" +
      `window.TRABALHO_DIGNO_DATA = ${JSON.stringify(data, null, 2)};\n`;
  }

  function buildAccessScript(access) {
    return "// Token do GitHub criptografado com a senha do painel (AES-GCM + PBKDF2).\n" +
      "// Sem a senha este conteúdo não pode ser usado.\n" +
      `window.TRABALHO_DIGNO_ACESSO = ${JSON.stringify(access, null, 2)};\n`;
  }

  /* ---------------- criptografia ---------------- */

  async function passwordKey(password) {
    return crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits", "deriveKey"]);
  }

  async function checkPassword(password) {
    const key = await passwordKey(password);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: hexToBytes(AUTH.salt), iterations: AUTH.iterations, hash: "SHA-256" }, key, 256
    );
    const hex = bytesToHex(bits);
    let diff = hex.length ^ AUTH.hash.length;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ AUTH.hash.charCodeAt(i);
    return diff === 0;
  }

  async function aesKey(password, salt, iterations) {
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      await passwordKey(password),
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptToken(token, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await aesKey(password, salt, KDF_ITERATIONS);
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, textEncoder.encode(token));
    return { salt: bytesToHex(salt), iv: bytesToHex(iv), iterations: KDF_ITERATIONS, data: bytesToBase64(data) };
  }

  async function decryptToken(box, password) {
    const key = await aesKey(password, hexToBytes(box.salt), box.iterations || KDF_ITERATIONS);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(box.iv) }, key, base64ToBytes(box.data));
    return new TextDecoder().decode(plain);
  }

  /* ---------------- login ---------------- */

  function openLogin() {
    if (session.unlocked) { openAdmin(); return; }
    const modal = $("login-modal");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    $("login-message").className = "form-message";
    setTimeout(() => $("login-password").focus(), 80);
  }

  function closeLogin() {
    const modal = $("login-modal");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    $("login-password").value = "";
    if (!$("admin").classList.contains("open")) document.body.style.overflow = "";
    if (location.hash === "#painel") history.replaceState(null, "", location.pathname + location.search);
  }

  function setupLogin() {
    document.querySelectorAll("[data-open-admin]").forEach(link => link.addEventListener("click", event => {
      event.preventDefault();
      openLogin();
    }));
    document.querySelectorAll("[data-close-login]").forEach(btn => btn.addEventListener("click", closeLogin));
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && $("login-modal").classList.contains("open")) closeLogin();
    });

    $("login-toggle").addEventListener("click", () => {
      const input = $("login-password");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      $("login-toggle").textContent = show ? "Ocultar" : "Mostrar";
    });

    $("login-form").addEventListener("submit", async event => {
      event.preventDefault();
      const message = $("login-message");
      const button = $("login-submit");
      const password = $("login-password").value;

      if (!window.crypto || !crypto.subtle) {
        message.textContent = "Este navegador bloqueou a verificação segura. Abra o site pelo endereço do GitHub Pages (https).";
        message.className = "form-message error";
        return;
      }

      button.disabled = true;
      button.textContent = "Verificando…";
      try {
        if (!(await checkPassword(password))) {
          await new Promise(resolve => setTimeout(resolve, 600));
          message.textContent = "Senha incorreta.";
          message.className = "form-message error";
          $("login-password").select();
          return;
        }
        session.password = password;
        session.unlocked = true;
        closeLogin();
        await openAdmin();
      } catch (error) {
        console.error(error);
        message.textContent = "Não foi possível verificar a senha neste navegador.";
        message.className = "form-message error";
      } finally {
        button.disabled = false;
        button.textContent = "Entrar";
      }
    });

    if (location.hash === "#painel") openLogin();
    window.addEventListener("hashchange", () => { if (location.hash === "#painel") openLogin(); });
  }

  /* ---------------- painel (abrir / fechar) ---------------- */

  async function openAdmin() {
    const admin = $("admin");
    admin.classList.add("open");
    admin.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    if (!map) initMap();
    setTimeout(() => map && map.invalidateSize(), 60);

    if (!admin.dataset.loaded) {
      admin.dataset.loaded = "1";
      await loadAccess();
      await loadPublished();
    }
  }

  function logout() {
    if (state.dirty && !confirm("Há alterações não publicadas (elas ficam salvas como rascunho neste navegador). Sair mesmo assim?")) return;
    session.password = null;
    session.unlocked = false;
    config.token = "";
    const admin = $("admin");
    admin.classList.remove("open");
    admin.setAttribute("aria-hidden", "true");
    delete admin.dataset.loaded;
    document.body.style.overflow = "";
    resetForm();
  }

  /* ---------------- conexão com o GitHub ---------------- */

  function detectRepo() {
    const host = location.hostname;
    if (!host.endsWith(".github.io")) return {};
    const owner = host.split(".")[0];
    const first = location.pathname.split("/").filter(Boolean)[0];
    return { owner, repo: first && !first.endsWith(".html") ? first : host };
  }

  const hasGitHub = () => Boolean(config.owner && config.repo && config.branch && config.token);

  async function loadAccess() {
    const detected = detectRepo();
    config = { owner: detected.owner || "", repo: detected.repo || "", branch: "main", token: "" };

    try {
      window.TRABALHO_DIGNO_ACESSO = undefined;
      await window.TD.loadScript(ACCESS_PATH + window.TD.cacheBust());
      const access = window.TRABALHO_DIGNO_ACESSO;
      if (access && access.token) {
        config.owner = access.owner || config.owner;
        config.repo = access.repo || config.repo;
        config.branch = access.branch || "main";
        config.token = await decryptToken(access.token, session.password);
      }
    } catch (error) {
      // sem data/acesso.js (primeira vez) ou falha ao descriptografar
      if (error && error.name === "OperationError") toast("Não foi possível abrir o token salvo. Configure a conexão de novo.", "error");
    }
    renderGhCard();
  }

  function renderGhCard(editing = false) {
    const connected = hasGitHub() && !editing;
    $("gh-connected").hidden = !connected;
    $("gh-form").hidden = connected;
    $("gh-cancel").hidden = !hasGitHub();
    $("gh-owner").value = config.owner;
    $("gh-repo").value = config.repo;
    $("gh-branch").value = config.branch || "main";
    $("gh-token").value = "";

    const label = $("gh-summary-status");
    if (hasGitHub()) {
      $("gh-connected-repo").textContent = `${config.owner}/${config.repo} (${config.branch})`;
      label.textContent = `Conectado a ${config.owner}/${config.repo}`;
      label.className = "ok";
    } else {
      label.textContent = "Não configurada — necessária para publicar direto daqui";
      label.className = "";
    }
    $("gh-card").open = editing || !hasGitHub();
  }

  function ghFetch(url, options = {}, token = config.token) {
    return fetch(url, {
      ...options,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.headers || {})
      }
    });
  }

  const contentsUrl = (path, cfg = config) => `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;

  async function ghGetFile(path, cfg = config) {
    const res = await ghFetch(`${contentsUrl(path, cfg)}?ref=${encodeURIComponent(cfg.branch)}&t=${Date.now()}`, {}, cfg.token);
    if (res.status === 404) return { sha: null, text: null };
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
    const file = await res.json();
    return { sha: file.sha, text: base64ToText(file.content || "") };
  }

  async function ghPutFile(path, text, message, cfg = config) {
    const send = sha => ghFetch(contentsUrl(path, cfg), {
      method: "PUT",
      body: JSON.stringify({ message, content: textToBase64(text), branch: cfg.branch, ...(sha ? { sha } : {}) })
    }, cfg.token);

    const current = await ghGetFile(path, cfg);
    let res = await send(current.sha);
    if (res.status === 409 || res.status === 422) {
      const latest = await ghGetFile(path, cfg);
      res = await send(latest.sha);
    }
    if (!res.ok) {
      const info = await res.json().catch(() => ({}));
      throw new Error(info.message || `GitHub respondeu ${res.status}`);
    }
    const result = await res.json();
    return result.content && result.content.sha;
  }

  function setupGhForm() {
    $("gh-change").addEventListener("click", () => renderGhCard(true));
    $("gh-cancel").addEventListener("click", () => renderGhCard(false));

    $("gh-form").addEventListener("submit", async event => {
      event.preventDefault();
      const cfg = {
        owner: $("gh-owner").value.trim(),
        repo: $("gh-repo").value.trim(),
        branch: $("gh-branch").value.trim() || "main",
        token: $("gh-token").value.trim()
      };
      if (!cfg.owner || !cfg.repo || !cfg.token) {
        toast("Preencha usuário, repositório e token.", "error");
        return;
      }

      const button = $("gh-submit");
      button.disabled = true;
      button.textContent = "Conectando…";
      try {
        const res = await ghFetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, {}, cfg.token);
        if (!res.ok) throw new Error(res.status === 404 ? "repositório não encontrado ou token sem acesso a ele." : `GitHub respondeu ${res.status}.`);
        const repo = await res.json();
        if (repo.permissions && !repo.permissions.push) throw new Error("o token não tem permissão de escrita neste repositório.");

        const access = {
          owner: cfg.owner,
          repo: cfg.repo,
          branch: cfg.branch,
          token: await encryptToken(cfg.token, session.password)
        };
        await ghPutFile(ACCESS_PATH, buildAccessScript(access), "Atualiza acesso do painel", cfg);

        config = cfg;
        renderGhCard(false);
        toast("Conexão salva. A partir de agora basta a senha para publicar.", "success");
        await loadPublished();
      } catch (error) {
        toast(`Falha na conexão: ${error.message}`, "error");
      } finally {
        button.disabled = false;
        button.textContent = "Conectar e salvar";
      }
    });
  }

  /* ---------------- carregar / publicar ---------------- */

  async function loadPublished() {
    setSync("Carregando…");
    try {
      let data;
      if (hasGitHub()) {
        const file = await ghGetFile(DATA_PATH);
        state.sha = file.sha;
        data = file.text ? parseDataScript(file.text) : { locais: [] };
      } else {
        data = window.TD.getData();
      }
      state.locais = sanitizeList(data.locais);
      state.updatedAt = data.updatedAt || null;
      setDirty(false, { keepDraft: true });
      setSync(state.updatedAt ? `Publicado em ${new Date(state.updatedAt).toLocaleString("pt-BR")}` : "Nada publicado ainda", "ok");
    } catch (error) {
      console.warn(error);
      state.locais = sanitizeList(window.TD.getData().locais);
      setSync("Usando os dados exibidos no site", "error");
    }
    renderAll();
    checkDraft();
  }

  async function publish() {
    if (!hasGitHub()) {
      renderGhCard(true);
      $("gh-card").scrollIntoView({ behavior: "smooth", block: "start" });
      toast("Configure a publicação no GitHub — ou use “Baixar arquivo” e envie-o para a pasta data/ do repositório.", "error");
      return;
    }

    const button = $("publish-btn");
    button.disabled = true;
    button.textContent = "Publicando…";
    try {
      const data = { updatedAt: new Date().toISOString(), locais: state.locais };
      state.sha = await ghPutFile(DATA_PATH, buildDataScript(data), `Atualiza endereços denunciados (${state.locais.length} locais)`);
      state.updatedAt = data.updatedAt;
      setDirty(false);
      window.TD.setData(data);
      setSync(`Publicado em ${new Date(data.updatedAt).toLocaleString("pt-BR")}`, "ok");
      toast("Publicado! O mapa deste navegador já foi atualizado; para os visitantes leva cerca de 1 minuto.", "success");
    } catch (error) {
      toast(`Não foi possível publicar: ${error.message}`, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Publicar no site";
    }
  }

  /* ---------------- rascunho local ---------------- */

  function setDirty(value, { keepDraft = false } = {}) {
    state.dirty = value;
    $("publish-state").textContent = value ? "● Alterações não publicadas" : "Tudo publicado";
    $("publish-state").classList.toggle("pending", value);
    try {
      if (value) localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), locais: state.locais }));
      else if (!keepDraft) localStorage.removeItem(DRAFT_KEY);
    } catch { /* armazenamento indisponível */ }
  }

  function checkDraft() {
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { draft = null; }
    const banner = $("draft-banner");
    if (!draft || !Array.isArray(draft.locais) || JSON.stringify(draft.locais) === JSON.stringify(state.locais)) {
      banner.hidden = true;
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignora */ }
      return;
    }
    banner.hidden = false;
    $("draft-restore").onclick = () => {
      state.locais = sanitizeList(draft.locais);
      setDirty(true);
      renderAll();
      banner.hidden = true;
      toast("Rascunho restaurado. Lembre de publicar.", "info");
    };
    $("draft-discard").onclick = () => {
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignora */ }
      banner.hidden = true;
    };
  }

  /* ---------------- mapa do painel ---------------- */

  function initMap() {
    if (!window.L) {
      $("panel-map").innerHTML = '<p class="table-empty">Mapa indisponível. Verifique sua conexão.</p>';
      return;
    }
    map = L.map("panel-map", { minZoom: 3 }).setView([-15.8, -47.9], 4);
    L.tileLayer(window.TD.TILE_URL, {
      maxZoom: 19,
      subdomains: "abcd",
      attribution: window.TD.TILE_ATTRIBUTION
    }).addTo(map);
    savedLayer = L.layerGroup().addTo(map);
    map.on("click", event => setPoint(event.latlng.lat, event.latlng.lng, false));
    renderSavedMarkers();
  }

  function setPoint(lat, lng, fly = true) {
    $("loc-lat").value = lat.toFixed(6);
    $("loc-lng").value = lng.toFixed(6);
    $("coords-label").textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    $("coords-label").classList.add("set");
    if (!map) return;

    if (!pickMarker) {
      pickMarker = L.marker([lat, lng], {
        draggable: true,
        icon: L.divIcon({
          className: "company-marker-wrap",
          html: '<div class="company-marker pick"><span>＋</span></div>',
          iconSize: [42, 42],
          iconAnchor: [21, 42]
        })
      }).addTo(map);
      pickMarker.on("dragend", () => {
        const p = pickMarker.getLatLng();
        setPoint(p.lat, p.lng, false);
      });
    } else {
      pickMarker.setLatLng([lat, lng]);
    }
    if (fly) map.setView([lat, lng], Math.max(map.getZoom(), 15));
  }

  function clearPoint() {
    $("loc-lat").value = "";
    $("loc-lng").value = "";
    $("coords-label").textContent = "Sem localização — busque o endereço ou clique no mapa";
    $("coords-label").classList.remove("set");
    if (pickMarker && map) { map.removeLayer(pickMarker); pickMarker = null; }
  }

  function renderSavedMarkers() {
    if (!savedLayer) return;
    savedLayer.clearLayers();
    const editingId = $("loc-id").value;
    state.locais.forEach(item => {
      if (item.id === editingId) return;
      L.circleMarker([item.lat, item.lng], {
        radius: 7, color: "#fff", weight: 2, fillColor: SEVERITY[item.severity].color, fillOpacity: .95
      })
        .bindTooltip(escapeHTML(item.name))
        .on("click", () => startEdit(item.id))
        .addTo(savedLayer);
    });
  }

  async function searchAddress(query) {
    // 1ª opção: Nominatim (OpenStreetMap). Reserva: Photon (Komoot).
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const results = await res.json();
        if (results[0]) return { lat: Number(results[0].lat), lng: Number(results[0].lon) };
        return null;
      }
    } catch { /* tenta a reserva */ }

    const res = await fetch(`https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`serviço de busca respondeu ${res.status}.`);
    const result = (await res.json()).features?.[0];
    return result ? { lat: result.geometry.coordinates[1], lng: result.geometry.coordinates[0] } : null;
  }

  async function geocode() {
    const address = $("loc-address").value.trim();
    const city = $("loc-city").value.trim();
    const uf = $("loc-state").value;
    if (!city || !uf) {
      showFormMessage("Preencha pelo menos a cidade e o estado para localizar.", "error");
      return;
    }

    const button = $("locate-btn");
    button.disabled = true;
    button.textContent = "Buscando…";
    try {
      let result = address ? await searchAddress(`${address}, ${city}, ${uf}, Brasil`) : null;
      let approximate = false;
      if (!result) {
        result = await searchAddress(`${city}, ${uf}, Brasil`);
        approximate = Boolean(address);
      }
      if (!result) throw new Error("endereço não encontrado.");

      setPoint(result.lat, result.lng);
      showFormMessage(
        approximate
          ? "Endereço exato não encontrado: o marcador foi colocado no centro da cidade. Ajuste clicando no mapa."
          : "Localização encontrada. Confira o marcador e ajuste se necessário.",
        approximate ? "error" : "success"
      );
    } catch (error) {
      showFormMessage(`Não foi possível localizar: ${error.message} Clique no mapa para marcar manualmente.`, "error");
    } finally {
      button.disabled = false;
      button.textContent = "⌖ Localizar no mapa";
    }
  }

  /* ---------------- formulário de cadastro ---------------- */

  function showFormMessage(text, type) {
    $("loc-message").textContent = text;
    $("loc-message").className = `form-message ${type || ""}`;
  }

  function resetForm() {
    $("location-form").reset();
    $("loc-id").value = "";
    $("loc-date").value = today();
    $("loc-reports").value = 1;
    $("form-title").textContent = "Cadastrar endereço";
    $("form-submit").textContent = "Adicionar endereço";
    $("form-cancel").hidden = true;
    showFormMessage("", "");
    clearPoint();
    renderAll();
  }

  function startEdit(id) {
    const item = state.locais.find(entry => entry.id === id);
    if (!item) return;
    $("loc-id").value = item.id;
    $("loc-name").value = item.name;
    $("loc-address").value = item.address;
    $("loc-city").value = item.city;
    $("loc-state").value = item.state;
    $("loc-type").value = item.type;
    $("loc-status").value = item.status;
    document.querySelector(`input[name="loc-severity"][value="${item.severity}"]`).checked = true;
    $("loc-reports").value = item.reports;
    $("loc-date").value = item.date;
    $("loc-description").value = item.description;
    $("form-title").textContent = "Editar endereço";
    $("form-submit").textContent = "Salvar alterações";
    $("form-cancel").hidden = false;
    showFormMessage("", "");
    setPoint(item.lat, item.lng);
    renderAll();
    $("location-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setupForm() {
    $("loc-state").innerHTML = '<option value="">UF</option>' + STATES.map(uf => `<option>${uf}</option>`).join("");
    $("loc-date").value = today();
    $("locate-btn").addEventListener("click", geocode);
    $("form-cancel").addEventListener("click", resetForm);
    $("form-reset").addEventListener("click", event => { event.preventDefault(); resetForm(); });

    $("location-form").addEventListener("submit", event => {
      event.preventDefault();
      const entry = {
        id: $("loc-id").value || newId(),
        name: $("loc-name").value.trim(),
        address: $("loc-address").value.trim(),
        city: $("loc-city").value.trim(),
        state: $("loc-state").value,
        lat: parseFloat($("loc-lat").value),
        lng: parseFloat($("loc-lng").value),
        type: $("loc-type").value,
        severity: document.querySelector('input[name="loc-severity"]:checked').value,
        status: $("loc-status").value,
        reports: Math.max(0, parseInt($("loc-reports").value, 10) || 0),
        date: $("loc-date").value,
        description: $("loc-description").value.trim()
      };

      if (!entry.name || !entry.city || !entry.state) {
        showFormMessage("Preencha nome, cidade e estado.", "error");
        return;
      }
      if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lng)) {
        showFormMessage("Defina a localização: use “Localizar no mapa” ou clique no mapa.", "error");
        return;
      }

      const index = state.locais.findIndex(item => item.id === entry.id);
      if (index >= 0) state.locais[index] = entry;
      else state.locais.unshift(entry);
      setDirty(true);
      toast(index >= 0 ? "Endereço atualizado. Publique para enviar ao site." : "Endereço adicionado. Publique para enviar ao site.", "success");
      resetForm();
    });
  }

  /* ---------------- lista ---------------- */

  function renderList() {
    const term = normalize($("list-search").value.trim());
    const editingId = $("loc-id").value;
    const rows = state.locais.filter(item =>
      !term || normalize(`${item.name} ${item.address} ${item.city} ${item.state}`).includes(term)
    );

    $("list-count").textContent = state.locais.length;
    $("list-empty").hidden = rows.length > 0;
    $("list-empty").textContent = state.locais.length ? "Nenhum resultado para o filtro." : "Nenhum endereço cadastrado.";
    $("list-body").innerHTML = rows.map(item => `
      <tr class="${item.id === editingId ? "editing" : ""}">
        <td><strong>${escapeHTML(item.name)}</strong>${item.address ? `<small>${escapeHTML(item.address)}</small>` : ""}</td>
        <td>${escapeHTML(item.city)}${item.state ? ` — ${escapeHTML(item.state)}` : ""}</td>
        <td><span class="popup-tag ${item.type}">${item.type === "infantil" ? "Infantil" : "Análogo à escravidão"}</span></td>
        <td><span class="sev-pill sev-${item.severity}">${SEVERITY[item.severity].label}</span></td>
        <td><span class="status-pill status-${item.status}">${STATUS[item.status]}</span></td>
        <td class="num">${item.reports}</td>
        <td class="row-actions">
          <button type="button" class="link-btn" data-edit="${item.id}">Editar</button>
          <button type="button" class="link-btn danger" data-delete="${item.id}">Excluir</button>
        </td>
      </tr>
    `).join("");
  }

  function setupList() {
    $("list-search").addEventListener("input", renderList);
    $("list-body").addEventListener("click", event => {
      const { edit, delete: remove } = event.target.dataset;
      if (edit) startEdit(edit);
      if (remove) {
        const item = state.locais.find(entry => entry.id === remove);
        if (!item || !confirm(`Excluir “${item.name}”?`)) return;
        state.locais = state.locais.filter(entry => entry.id !== remove);
        if ($("loc-id").value === remove) resetForm();
        setDirty(true);
        renderAll();
        toast("Endereço excluído. Publique para atualizar o site.", "info");
      }
    });
  }

  function renderAll() {
    renderList();
    renderSavedMarkers();
  }

  /* ---------------- importar / exportar ---------------- */

  function setupFileActions() {
    $("download-btn").addEventListener("click", () => {
      const text = buildDataScript({ updatedAt: new Date().toISOString(), locais: state.locais });
      const blob = new Blob([text], { type: "text/javascript" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "denuncias.js";
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      toast("Arquivo baixado. Substitua data/denuncias.js no repositório para atualizar o site.", "info");
    });

    $("import-file").addEventListener("change", async event => {
      const file = event.target.files[0];
      event.target.value = "";
      if (!file) return;
      try {
        const data = parseDataScript(await file.text());
        const list = sanitizeList(Array.isArray(data) ? data : data.locais);
        if (!confirm(`Substituir a lista atual por ${list.length} endereço(s) do arquivo?`)) return;
        state.locais = list;
        setDirty(true);
        resetForm();
        toast("Arquivo importado. Publique para enviar ao site.", "success");
      } catch {
        toast("Arquivo inválido. Use um denuncias.js baixado por este painel.", "error");
      }
    });

    $("publish-btn").addEventListener("click", publish);
    $("admin-logout").addEventListener("click", logout);

    window.addEventListener("beforeunload", event => {
      if (state.dirty) { event.preventDefault(); event.returnValue = ""; }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupLogin();
    setupGhForm();
    setupForm();
    setupList();
    setupFileActions();
  });
})();
