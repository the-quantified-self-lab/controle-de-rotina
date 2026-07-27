/* ============================================================
   GOOGLE OAUTH + SINCRONIZAÇÃO COM GOOGLE SHEETS

   Fluxo de autenticação: OAuth 2.0 implícito por REDIRECIONAMENTO de
   página inteira (não popup). Motivo: no iOS, um PWA rodando em modo
   standalone (adicionado à Tela de Início) trata window.open de forma
   errática e o postMessage de volta ao opener costuma falhar. Um
   redirect de topo funciona sempre.

   O token de acesso vive ~1h e fica só em sessionStorage. Não há
   refresh token (impossível com segurança em app 100% client-side),
   então de tempos em tempos o Google pede reautorização — normalmente
   sem nova tela de consentimento, apenas um flash de redirecionamento.
   ============================================================ */
"use strict";

const GOOGLE_CLIENT_ID = "159007664242-qn35k6nvj2rnksp1itej00bn6osr41vn.apps.googleusercontent.com";
const SHEET_ID_PADRAO = "12H-vD-WP3p_DBYkXhjArs7X7eh1J6ldGl3zg25GrsCk";
const ABA_PADRAO = "Registros";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const TOKEN_KEY = "cr_gtoken";
const STATE_KEY = "cr_oauth_state";
const RETOMAR_KEY = "cr_oauth_retomar";

// ---------- token ----------
function lerToken() {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!t.access_token || Date.now() >= t.expira_em - 60_000) { sessionStorage.removeItem(TOKEN_KEY); return null; }
    return t;
  } catch { return null; }
}
const gravarToken = (access_token, expires_in) =>
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify({
    access_token, expira_em: Date.now() + (Number(expires_in) || 3600) * 1000,
  }));
const estaLogado = () => !!lerToken();
function sairDaConta() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(STATE_KEY);
}

// URI de redirecionamento = a própria página, sem query/hash.
const redirectURI = () => location.origin + location.pathname;

function iniciarLogin(retomarEm) {
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  sessionStorage.setItem(STATE_KEY, state);
  if (retomarEm) sessionStorage.setItem(RETOMAR_KEY, retomarEm);
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectURI(),
    response_type: "token",
    scope: SCOPE,
    state,
    include_granted_scopes: "true",
    prompt: "",
  });
  location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}

/* Lê o retorno do OAuth no fragmento (#access_token=...). Deve ser
   chamado logo no boot. Retorna {ok, erro, retomar}. */
function capturarRetornoOAuth() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  if (!hash) return { ok: false };
  const p = new URLSearchParams(hash);
  const tokenRecebido = p.get("access_token");
  const erro = p.get("error");
  if (!tokenRecebido && !erro) return { ok: false };

  history.replaceState(null, "", redirectURI() + location.search);
  const retomar = sessionStorage.getItem(RETOMAR_KEY);
  sessionStorage.removeItem(RETOMAR_KEY);

  if (erro) return { ok: false, erro, retomar };
  if (p.get("state") !== sessionStorage.getItem(STATE_KEY)) {
    return { ok: false, erro: "state_invalido", retomar };
  }
  sessionStorage.removeItem(STATE_KEY);
  gravarToken(tokenRecebido, p.get("expires_in"));
  return { ok: true, retomar };
}

// ---------- chamadas à API ----------
async function apiSheets(caminho, opts = {}) {
  const t = lerToken();
  if (!t) throw new Error("NAO_AUTENTICADO");
  const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + caminho, {
    ...opts,
    headers: { Authorization: "Bearer " + t.access_token, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (res.status === 401 || res.status === 403) {
    const corpo = await res.text();
    sessionStorage.removeItem(TOKEN_KEY);
    throw new Error(res.status === 401 ? "NAO_AUTENTICADO" : "SEM_PERMISSAO: " + corpo.slice(0, 300));
  }
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/* Garante que a aba existe; cria se faltar. */
async function garantirAba(sheetId, aba) {
  const meta = await apiSheets(`${sheetId}?fields=sheets.properties(title,sheetId)`);
  const achou = (meta.sheets || []).some((s) => s.properties.title === aba);
  if (achou) return;
  await apiSheets(`${sheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: aba } } }] }),
  });
}

/* Sincroniza: substitui todo o conteúdo da aba pelos dados locais.
   Operação idempotente — o app local é a fonte da verdade. */
async function sincronizarSheets({ sheetId, aba } = {}) {
  sheetId = sheetId || SHEET_ID_PADRAO;
  aba = aba || ABA_PADRAO;

  const dias = await listarDias();
  const valores = [CSV_HEADER].concat(montarLinhasCSV(dias).map((l) => l.map((v) => (v === null || v === undefined ? "" : String(v)))));

  await garantirAba(sheetId, aba);
  const alvo = encodeURIComponent(`${aba}!A:S`);
  await apiSheets(`${sheetId}/values/${alvo}:clear`, { method: "POST", body: "{}" });
  await apiSheets(
    `${sheetId}/values/${encodeURIComponent(`${aba}!A1`)}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: valores }) }
  );

  const quando = new Date().toISOString();
  await setCfg("ultima_sync", quando);
  return { dias: dias.length, linhas: valores.length - 1, quando };
}
