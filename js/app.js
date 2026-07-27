/* ============================================================
   APP — orquestração, telas e interações
   ============================================================ */
"use strict";

const VERSAO = "1.1.0";

// Acima disso, a duração provavelmente veio de fim/início invertidos.
const LIMITE_DURACAO_SUSPEITA = 16 * 60;

const estado = {
  cfg: null,
  dia: null,
  data: hojeISO(),
  datasComDados: new Set(),
  aba: "registro",
  periodo: "30",
  calAberto: false,
  calMes: null,
};

// ---------------- salvamento (debounce) ----------------
let _saveTimer = null;
function agendarSalvar() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    if (!estado.dia) return;
    await salvarDia(estado.dia);
    estado.datasComDados.add(estado.dia.date);
  }, 350);
}

// ---------------- tema ----------------
async function aplicarTema(tema, persistir = true) {
  const efetivo = tema === "auto"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : tema;
  document.documentElement.dataset.tema = efetivo;
  const ico = document.getElementById("ico-tema");
  ico.innerHTML = efetivo === "dark"
    ? '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'
    : '<circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2M12 20.5v2M3.9 3.9l1.4 1.4M18.7 18.7l1.4 1.4M1.5 12h2M20.5 12h2M3.9 20.1l1.4-1.4M18.7 5.3l1.4-1.4"/>';
  if (persistir) await setCfg("tema", tema);
}

// ---------------- abas ----------------
function trocarAba(nome) {
  estado.aba = nome;
  $$(".tab-pane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + nome));
  $$(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === nome));
  window.scrollTo({ top: 0 });
  if (nome === "analise") renderAnalise();
  if (nome === "config") renderConfig();
}

// ---------------- navegação de data ----------------
async function irPara(iso) {
  estado.data = iso;
  estado.calAberto = false;
  document.getElementById("cal-wrap").classList.add("hidden");
  let d = await carregarDia(iso);
  d = d ? normalizarDia(d, estado.cfg) : criarDiaVazio(iso, estado.cfg);
  estado.dia = d;
  // o sono deste dia começa no "dormir" da véspera
  const vespera = await carregarDia(addDias(iso, -1));
  estado.dormiuOntem = vespera && vespera.sono ? vespera.sono.dormiu || "" : "";
  renderRegistro();
}

// ---------------- KPIs do dia ----------------
function renderKPIs() {
  const r = resumirDia(estado.dia);
  const alvo = r.tempoUtilPrevisto;
  const delta = r.tempoUtil - alvo;
  const cx = document.getElementById("kpis");
  cx.innerHTML = "";
  const kpi = (lab, val, sub, cor) => {
    const box = el("div", { class: "kpi" });
    box.appendChild(el("div", { class: "k-lab", text: lab }));
    box.appendChild(el("div", { class: "k-val mono", text: val, style: cor ? `color:${cor}` : null }));
    if (sub) box.appendChild(el("div", { class: "k-sub", text: sub }));
    return box;
  };
  /* Sono do dia = "dormir" da véspera → "acordar" de hoje.
     O "dormir" registrado hoje conta para o sono de amanhã. */
  const anc = estado.dia.ancoras || {};
  const metaSono = diffMin(anc.dormir, anc.acordar);
  const sonoMin = diffMin(estado.dormiuOntem || "", estado.dia.sono.acordou || "");
  let subSono;
  if (sonoMin !== null) subSono = `de ${formatDuracao(metaSono)} · ${formatDelta(sonoMin - metaSono)}`;
  else if (!estado.dormiuOntem) subSono = "falta o dormir de ontem";
  else subSono = "falta o acordar de hoje";

  cx.appendChild(kpi("Sono", formatDuracao(sonoMin), subSono,
    sonoMin !== null && metaSono !== null && sonoMin >= metaSono ? "var(--ok)" : null));
  cx.appendChild(kpi("Tempo útil", formatDuracao(r.tempoUtil),
    alvo ? `de ${formatDuracao(alvo)} · ${formatDelta(delta)}` : null,
    alvo && r.tempoUtil >= alvo ? "var(--ok)" : null));
  cx.appendChild(kpi("Expediente", formatDuracao(r.expediente),
    r.interrupcoes ? `+${formatDuracao(r.interrupcoes)} interrup.` : null));
  cx.appendChild(kpi("Treino", formatDuracao(r.treino)));
}

// ---------------- sono ----------------
function renderSono() {
  const cx = document.getElementById("sono-campos");
  cx.innerHTML = "";
  const anc = estado.dia.ancoras || {};
  [["acordou", "Acordar", anc.acordar], ["dormiu", "Dormir", anc.dormir]]
    .forEach(([k, label, meta]) => {
      const linha = el("div", { class: "tempos", style: "margin-bottom:10px" });
      const campo = el("div", { class: "campo-hora", style: "grid-column:1/3" });
      campo.appendChild(el("label", { text: `${label} · meta ${meta || "—"}` }));
      const inp = el("input", {
        type: "text", class: "hora", inputmode: "numeric", maxlength: "5",
        placeholder: "--:--", value: estado.dia.sono[k] || "",
      });
      const info = el("div", { class: "dur-chip", style: "margin:0" });
      const atualizarInfo = () => {
        const dv = desvioCircular(estado.dia.sono[k], meta);
        info.innerHTML = "";
        if (dv === null) { info.appendChild(el("span", { class: "muted tiny", text: "—" })); return; }
        const dentro = Math.abs(dv) <= 15;
        info.appendChild(el("span", {
          class: "delta " + (dentro ? "neg" : "pos"),
          text: dv === 0 ? "no horário" : formatDelta(dv),
        }));
      };
      inp.addEventListener("input", () => {
        inp.value = mascaraHora(inp.value);
        estado.dia.sono[k] = inp.value;
        atualizarInfo(); renderKPIs(); agendarSalvar();
      });
      campo.appendChild(inp);
      linha.appendChild(campo);
      const agora = el("button", { class: "btn-agora", text: "agora" });
      agora.addEventListener("click", () => {
        estado.dia.sono[k] = horaAgora(); inp.value = estado.dia.sono[k];
        atualizarInfo(); renderKPIs(); agendarSalvar();
      });
      linha.appendChild(agora);
      cx.appendChild(linha);
      cx.appendChild(el("div", { style: "margin:-4px 0 12px 2px" }, [info]));
      atualizarInfo();
    });
}

// ---------------- chave mestra ----------------
function renderChaveMestra() {
  const ch = estado.dia.chave_mestra;
  const card = document.getElementById("card-chave");
  const box = document.getElementById("chave-detalhes");
  document.getElementById("chave-ativa").checked = !!ch.ativa;
  card.classList.toggle("ativo", !!ch.ativa);
  box.classList.toggle("hidden", !ch.ativa);
  if (!ch.ativa) return;
  box.innerHTML = "";
  const sel = el("select", {}, [
    el("option", { value: "dia_inteiro", text: "Dia inteiro", selected: ch.tipo === "dia_inteiro" }),
    el("option", { value: "janela", text: "Janela específica", selected: ch.tipo === "janela" }),
  ]);
  sel.addEventListener("change", () => { ch.tipo = sel.value; renderChaveMestra(); agendarSalvar(); });
  box.appendChild(sel);
  if (ch.tipo === "janela") {
    const g = el("div", { class: "tempos", style: "margin-top:8px" });
    ["inicio", "fim"].forEach((k) => {
      const c = el("div", { class: "campo-hora" });
      c.appendChild(el("label", { text: k === "inicio" ? "De" : "Até" }));
      const i = el("input", { type: "text", class: "hora", inputmode: "numeric", maxlength: "5", placeholder: "--:--", value: ch[k] || "" });
      i.addEventListener("input", () => { i.value = mascaraHora(i.value); ch[k] = i.value; agendarSalvar(); });
      c.appendChild(i); g.appendChild(c);
    });
    g.appendChild(el("span"));
    box.appendChild(g);
  }
  const motivo = el("input", { type: "text", placeholder: "Motivo da exceção", value: ch.motivo || "", style: "margin-top:8px" });
  motivo.addEventListener("input", () => { ch.motivo = motivo.value; agendarSalvar(); });
  box.appendChild(motivo);
}

// ---------------- interrupções ----------------
function renderInterrupcoes() {
  const cx = document.getElementById("lista-interrup");
  cx.innerHTML = "";
  const lista = estado.dia.interrupcoes;
  if (!lista.length) { cx.appendChild(el("p", { class: "empty", text: "Nenhuma interrupção registrada." })); return; }
  lista.forEach((it) => {
    const row = el("div", { class: "interrup-item" });
    ["inicio", "fim"].forEach((k) => {
      const c = el("div", { class: "campo-hora" });
      c.appendChild(el("label", { text: k === "inicio" ? "Início" : "Fim" }));
      const i = el("input", { type: "text", class: "hora", inputmode: "numeric", maxlength: "5", placeholder: "--:--", value: it[k] || "" });
      i.addEventListener("input", () => {
        i.value = mascaraHora(i.value); it[k] = i.value;
        dur.textContent = formatDuracao(diffMin(it.inicio, it.fim));
        renderKPIs(); agendarSalvar();
      });
      c.appendChild(i); row.appendChild(c);
    });
    const rm = el("button", { class: "icon-btn", "aria-label": "Remover" });
    rm.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    rm.addEventListener("click", () => {
      estado.dia.interrupcoes = estado.dia.interrupcoes.filter((x) => x !== it);
      renderInterrupcoes(); renderKPIs(); agendarSalvar();
    });
    row.appendChild(rm);
    const motivo = el("input", { class: "motivo", type: "text", placeholder: "Motivo (opcional)", value: it.motivo || "" });
    motivo.addEventListener("input", () => { it.motivo = motivo.value; agendarSalvar(); });
    row.appendChild(motivo);
    const dur = el("span", { class: "dur-chip", style: "grid-column:1/-1;margin:0", text: formatDuracao(diffMin(it.inicio, it.fim)) });
    row.appendChild(dur);
    cx.appendChild(row);
  });
}

// ---------------- tarefas ----------------
function atualizarContagemBlocos() {
  const alvo = document.getElementById("contagem-blocos");
  if (!alvo) return;
  const feitos = (estado.dia.tarefas || []).filter((t) => t.inicio && t.fim).length;
  alvo.textContent = `· ${feitos}/${(estado.dia.grade || []).length} preenchidos`;
}

function renderTarefas() {
  const cx = document.getElementById("lista-tarefas");
  cx.innerHTML = "";
  (estado.dia.grade || []).forEach((g) => {
    const t = estado.dia.tarefas.find((x) => x.id === g.id);
    if (!t) return;
    const cor = (CATEGORIAS[g.cat] || { cor: "#94a3b8" }).cor;
    const card = el("div", { class: "tarefa", style: `--cat:${cor}` });
    const marcarPreenchida = () => card.classList.toggle("preenchida", !!(t.inicio && t.fim));

    const top = el("div", { class: "tarefa-top" });
    const esq = el("div", { style: "flex:1;min-width:0" });
    esq.appendChild(el("div", { class: "tarefa-nome", text: g.nome }));
    const planDur = diffMin(g.inicio, g.fim);
    esq.appendChild(el("div", { class: "tarefa-plan", text: `${g.inicio}–${g.fim} · ${formatDuracao(planDur)}` }));
    top.appendChild(esq);
    top.appendChild(el("span", { class: "pill", text: (CATEGORIAS[g.cat] || { label: g.cat }).label }));
    card.appendChild(top);

    const tempos = el("div", { class: "tempos" });
    const inputs = {};
    ["inicio", "fim"].forEach((k) => {
      const c = el("div", { class: "campo-hora" });
      c.appendChild(el("label", { text: k === "inicio" ? "Início" : "Fim" }));
      const i = el("input", {
        type: "text", class: "hora", inputmode: "numeric", maxlength: "5",
        placeholder: "--:--", value: t[k] || "",
      });
      i.addEventListener("input", () => {
        i.value = mascaraHora(i.value); t[k] = i.value;
        atualizarDur(); marcarPreenchida(); atualizarContagemBlocos(); renderKPIs(); agendarSalvar();
      });
      inputs[k] = i; c.appendChild(i); tempos.appendChild(c);
    });
    const btnAgora = el("button", { class: "btn-agora", text: "agora" });
    btnAgora.addEventListener("click", () => {
      // preenche o próximo campo vazio: início primeiro, depois fim
      const alvo = !t.inicio ? "inicio" : "fim";
      t[alvo] = horaAgora(); inputs[alvo].value = t[alvo];
      atualizarDur(); marcarPreenchida(); renderKPIs(); agendarSalvar();
    });
    tempos.appendChild(btnAgora);
    card.appendChild(tempos);

    const chip = el("div", { class: "dur-chip" });
    function atualizarDur() {
      const d = diffMin(t.inicio, t.fim);
      chip.innerHTML = "";
      card.classList.remove("suspeita");
      if (d === null) { chip.appendChild(el("span", { class: "muted", text: "—" })); return; }
      chip.appendChild(el("span", { text: formatDuracao(d) }));
      /* Duração enorme quase sempre significa fim digitado antes do início
         (a regra de virada de meia-noite transforma 19:45→19:42 em 23h57).
         Sinaliza em vez de deixar entrar lixo na análise. */
      if (d > LIMITE_DURACAO_SUSPEITA) {
        card.classList.add("suspeita");
        chip.appendChild(el("span", { class: "alerta-dur", text: "verifique: fim antes do início?" }));
        return;
      }
      if (planDur !== null) {
        const dv = d - planDur;
        chip.appendChild(el("span", { class: "delta " + (dv > 0 ? "pos" : "neg"), text: dv === 0 ? "no previsto" : formatDelta(dv) }));
      }
    }
    atualizarDur(); marcarPreenchida();
    card.appendChild(chip);

    const obsWrap = el("div", { class: "obs-tarefa" });
    const obs = el("input", { type: "text", placeholder: "Observação (opcional)", value: t.obs || "" });
    obs.addEventListener("input", () => { t.obs = obs.value; agendarSalvar(); });
    obsWrap.appendChild(obs);
    card.appendChild(obsWrap);

    cx.appendChild(card);
  });
}

// ---------------- calendário ----------------
function renderCalendario() {
  const cx = document.getElementById("cal-conteudo");
  cx.innerHTML = "";
  const { ano, mes } = estado.calMes;
  const nav = el("div", { class: "linha", style: "justify-content:space-between;margin-bottom:8px" });
  const bAnt = el("button", { class: "icon-btn", "aria-label": "Mês anterior" });
  bAnt.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>';
  bAnt.addEventListener("click", () => { navegarMes(-1); });
  const bProx = el("button", { class: "icon-btn", "aria-label": "Próximo mês" });
  bProx.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>';
  bProx.addEventListener("click", () => { navegarMes(1); });
  nav.appendChild(bAnt);
  nav.appendChild(el("strong", { text: `${MESES[mes]} ${ano}` }));
  nav.appendChild(bProx);
  cx.appendChild(nav);

  const grid = el("div", { class: "cal-grid" });
  ["D", "S", "T", "Q", "Q", "S", "S"].forEach((d) => grid.appendChild(el("div", { class: "cal-dow", text: d })));
  const primeiro = new Date(ano, mes, 1).getDay();
  const noMes = new Date(ano, mes + 1, 0).getDate();
  const noAnterior = new Date(ano, mes, 0).getDate();
  const total = Math.ceil((primeiro + noMes) / 7) * 7;

  for (let i = 0; i < total; i++) {
    let dia, mm = mes, aa = ano, fora = false;
    if (i < primeiro) { dia = noAnterior - primeiro + 1 + i; mm--; if (mm < 0) { mm = 11; aa--; } fora = true; }
    else if (i >= primeiro + noMes) { dia = i - primeiro - noMes + 1; mm++; if (mm > 11) { mm = 0; aa++; } fora = true; }
    else dia = i - primeiro + 1;
    const iso = `${aa}-${String(mm + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    const b = el("button", { class: "cal-dia" + (fora ? " fora" : "") + (iso === hojeISO() ? " hoje" : "") + (iso === estado.data ? " sel" : ""), text: String(dia) });
    if (estado.datasComDados.has(iso)) b.appendChild(el("span", { class: "marca" }));
    b.addEventListener("click", () => irPara(iso));
    grid.appendChild(b);
  }
  cx.appendChild(grid);
}
function navegarMes(delta) {
  let { ano, mes } = estado.calMes;
  mes += delta;
  if (mes < 0) { mes = 11; ano--; }
  if (mes > 11) { mes = 0; ano++; }
  estado.calMes = { ano, mes };
  renderCalendario();
}

// ---------------- render da aba Registro ----------------
function renderRegistro() {
  const d = estado.dia;
  document.getElementById("data-titulo").textContent = formatarDataBR(d.date);
  document.getElementById("data-sub").textContent =
    (TIPOS_DIA[d.tipo_dia] || { label: d.tipo_dia }).label + (d.date === hojeISO() ? " · hoje" : "");
  document.getElementById("data-input").value = d.date;

  const sel = document.getElementById("tipo-dia");
  sel.innerHTML = "";
  Object.entries(TIPOS_DIA).forEach(([k, v]) =>
    sel.appendChild(el("option", { value: k, text: v.label, selected: k === d.tipo_dia })));

  document.getElementById("obs-dia").value = d.observacao || "";
  renderKPIs(); renderSono(); renderChaveMestra(); renderInterrupcoes(); renderTarefas();
  atualizarContagemBlocos();
}

/* Troca o tipo de dia: re-snapshota a grade do novo tipo, preservando
   os horários já digitados nos blocos de mesmo id. */
function mudarTipoDia(novo) {
  const d = estado.dia;
  const antigos = {};
  (d.tarefas || []).forEach((t) => { antigos[t.id] = t; });
  d.tipo_dia = novo;
  d.grade = (estado.cfg.grades[novo] || []).map((g) => ({ ...g }));
  d.tarefas = d.grade.map((g) => antigos[g.id] || { id: g.id, inicio: "", fim: "", obs: "" });
  renderRegistro(); agendarSalvar();
}

// ---------------- aba Análise ----------------
async function renderAnalise() {
  const todos = (await listarDias()).map((d) => normalizarDia(d, estado.cfg));
  // índice completo: o sono do 1º dia do período depende da véspera, que
  // pode estar fora do recorte
  const porData = {};
  todos.forEach((d) => { porData[d.date] = d; });
  const dias = filtrarPeriodo(todos, estado.periodo);
  const resumos = vincularSono(dias.map(resumirDia), porData);
  const cx = document.getElementById("analise-conteudo");
  cx.innerHTML = "";

  // KPIs do período
  const kp = document.getElementById("kpis-analise");
  kp.innerHTML = "";
  const utilTotal = resumos.reduce((s, r) => s + r.tempoUtil, 0);
  const expTotal = resumos.reduce((s, r) => s + r.expediente, 0);
  const utilMedio = resumos.length ? utilTotal / resumos.length : 0;
  const utilDesvio = desvioPadrao(resumos.map((r) => r.tempoUtil));
  const kpi = (lab, val, sub) => {
    const b = el("div", { class: "kpi" });
    b.appendChild(el("div", { class: "k-lab", text: lab }));
    b.appendChild(el("div", { class: "k-val mono", text: val }));
    if (sub) b.appendChild(el("div", { class: "k-sub", text: sub }));
    return b;
  };
  const noites = resumos.map((r) => r.sonoMin).filter((v) => v !== null);
  const sonoMedio = media(noites), sonoDesvio = desvioPadrao(noites);
  kp.appendChild(kpi("Dias registrados", String(resumos.length)));
  kp.appendChild(kpi("Tempo útil total", formatDuracao(utilTotal)));
  kp.appendChild(kpi("Média por dia", formatDuracao(utilMedio),
    utilDesvio !== null ? `desvio padrão ${formatDuracao(utilDesvio)}` : null));
  kp.appendChild(kpi("Sono médio", formatDuracao(sonoMedio),
    noites.length ? `${noites.length} ${noites.length === 1 ? "noite" : "noites"}${sonoDesvio !== null ? ` · dp ${formatDuracao(sonoDesvio)}` : ""}` : "sem noites completas"));
  kp.appendChild(kpi("Expediente total", formatDuracao(expTotal)));

  if (!resumos.length) {
    cx.appendChild(el("div", { class: "card" }, [
      el("p", { class: "empty", text: "Nenhum dado no período selecionado. Registre alguns dias na aba Registro." }),
    ]));
    return;
  }

  cx.appendChild(molduraSVG("Tempo útil por dia", graficoTempoUtil(resumos)));
  cx.appendChild(molduraSVG("Horas de sono por noite", graficoSonoHoras(resumos)));
  const cSono = molduraSVG("Regularidade do sono (desvio da meta)", graficoSono(resumos));
  cSono.appendChild(legendaSono());
  cx.appendChild(cSono);
  cx.appendChild(molduraSVG("Horas acumuladas por categoria", graficoCategorias(resumos)));

  // Tabela de estatísticas por bloco
  const stats = estatisticasPorTarefa(dias);
  const card = el("section", { class: "chart-card" });
  card.appendChild(el("h3", { class: "chart-title", text: "Estatísticas por bloco" }));
  const wrap = el("div", { class: "tabela-wrap" });
  const tb = el("table", { class: "stats" });
  tb.appendChild(el("thead", {}, [el("tr", {}, [
    el("th", { text: "Bloco" }), el("th", { text: "n" }), el("th", { text: "Total" }),
    el("th", { text: "Média" }), el("th", { text: "Desv. padrão" }), el("th", { text: "Mediana" }),
    el("th", { text: "Mín" }), el("th", { text: "Máx" }), el("th", { text: "vs. previsto" }),
  ])]));
  const tbody = el("tbody");
  stats.forEach((s) => {
    const cor = (CATEGORIAS[s.cat] || { cor: "#94a3b8" }).cor;
    tbody.appendChild(el("tr", {}, [
      el("td", {}, [el("i", { class: "cat-dot", style: `background:${cor}` }), s.nome]),
      el("td", { class: "mono", text: String(s.n) }),
      el("td", { class: "mono", text: formatDuracao(s.total) }),
      el("td", { class: "mono", text: formatDuracao(s.media) }),
      el("td", { class: "mono", text: s.desvio === null ? "—" : formatDuracao(s.desvio) }),
      el("td", { class: "mono", text: formatDuracao(s.mediana) }),
      el("td", { class: "mono", text: formatDuracao(s.min) }),
      el("td", { class: "mono", text: formatDuracao(s.max) }),
      el("td", { class: "mono delta " + (s.desvioMeta > 0 ? "pos" : "neg"), text: s.desvioMeta === null ? "—" : formatDelta(s.desvioMeta) }),
    ]));
  });
  tb.appendChild(tbody);
  wrap.appendChild(tb);
  card.appendChild(wrap);
  cx.appendChild(card);
}

// ---------------- aba Configuração ----------------
function renderStatusSync() {
  const box = document.getElementById("sync-status");
  const logado = estaLogado();
  box.innerHTML = "";
  box.appendChild(el("span", { class: "dot-status " + (logado ? "dot-on" : "dot-off") }));
  box.appendChild(el("span", { text: logado ? "Conectado ao Google" : "Não conectado" }));
  document.getElementById("btn-login").classList.toggle("hidden", logado);
  document.getElementById("btn-logout").classList.toggle("hidden", !logado);
  getCfg("ultima_sync", null).then((q) => {
    if (!q) return;
    const d = new Date(q);
    box.appendChild(el("div", { class: "tiny muted", style: "margin-top:4px",
      text: `Última sincronização: ${d.toLocaleString("pt-BR")}` }));
  });
}

function renderConfig() {
  document.getElementById("sheet-id-txt").textContent = SHEET_ID_PADRAO;
  document.getElementById("versao-app").textContent = "v" + VERSAO;
  renderStatusSync();

  // âncoras
  const ca = document.getElementById("cfg-ancoras");
  ca.innerHTML = "";
  [["acordar", "Acordar"], ["dormir", "Dormir"]].forEach(([k, lab]) => {
    const c = el("div", { class: "campo-hora", style: "margin-bottom:12px" });
    c.appendChild(el("label", { text: lab }));
    const i = el("input", { type: "text", class: "hora", inputmode: "numeric", maxlength: "5", value: estado.cfg.ancoras[k] || "" });
    i.addEventListener("input", () => {
      i.value = mascaraHora(i.value);
      estado.cfg.ancoras[k] = i.value;
      salvarConfig(estado.cfg);
    });
    c.appendChild(i); ca.appendChild(c);
  });

  // grade por tipo de dia
  const sel = document.getElementById("cfg-tipo-dia");
  if (!sel.dataset.pronto) {
    Object.entries(TIPOS_DIA).forEach(([k, v]) => sel.appendChild(el("option", { value: k, text: v.label })));
    sel.value = estado.dia ? estado.dia.tipo_dia : "util_expediente";
    sel.addEventListener("change", renderGradeConfig);
    sel.dataset.pronto = "1";
  }
  renderGradeConfig();
}

function renderGradeConfig() {
  const tipo = document.getElementById("cfg-tipo-dia").value;
  const lista = estado.cfg.grades[tipo] || [];
  const cx = document.getElementById("cfg-lista");
  cx.innerHTML = "";

  lista.forEach((g, idx) => {
    const row = el("div", { class: "cfg-tarefa" });
    const nome = el("input", { type: "text", value: g.nome, placeholder: "Nome do bloco" });
    nome.addEventListener("input", () => { g.nome = nome.value; salvarConfig(estado.cfg); });
    row.appendChild(nome);

    const acoes = el("div", { class: "linha", style: "gap:4px" });
    const mk = (aria, path, fn) => {
      const b = el("button", { class: "icon-btn", "aria-label": aria, style: "width:32px;height:32px" });
      b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
      b.addEventListener("click", fn);
      return b;
    };
    acoes.appendChild(mk("Subir", '<polyline points="18 15 12 9 6 15"/>', () => {
      if (idx === 0) return;
      [lista[idx - 1], lista[idx]] = [lista[idx], lista[idx - 1]];
      salvarConfig(estado.cfg); renderGradeConfig();
    }));
    acoes.appendChild(mk("Remover", '<path d="M18 6 6 18M6 6l12 12"/>', () => {
      lista.splice(idx, 1); salvarConfig(estado.cfg); renderGradeConfig();
    }));
    row.appendChild(acoes);

    const l2 = el("div", { class: "cfg-linha2" });
    ["inicio", "fim"].forEach((k) => {
      const i = el("input", { type: "text", class: "hora", inputmode: "numeric", maxlength: "5", value: g[k], placeholder: k === "inicio" ? "Início" : "Fim" });
      i.addEventListener("input", () => { i.value = mascaraHora(i.value); g[k] = i.value; salvarConfig(estado.cfg); });
      l2.appendChild(i);
    });
    const cat = el("select");
    Object.entries(CATEGORIAS).forEach(([k, v]) =>
      cat.appendChild(el("option", { value: k, text: v.label, selected: k === g.cat })));
    cat.addEventListener("change", () => { g.cat = cat.value; salvarConfig(estado.cfg); });
    l2.appendChild(cat);
    row.appendChild(l2);
    cx.appendChild(row);
  });

  if (!lista.length) cx.appendChild(el("p", { class: "empty", text: "Nenhum bloco. Adicione o primeiro abaixo." }));
}

// ---------------- sincronização ----------------
async function fazerSync(silencioso = false) {
  if (!estaLogado()) {
    if (!silencioso) iniciarLogin("sync");
    return;
  }
  try {
    if (!silencioso) toast("Sincronizando…");
    const r = await sincronizarSheets({});
    toast(`Sincronizado: ${r.linhas} linhas de ${r.dias} dias.`, "ok");
    if (estado.aba === "config") renderStatusSync();
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.startsWith("NAO_AUTENTICADO")) {
      renderStatusSync();
      if (!silencioso) iniciarLogin("sync");
      else toast("Sessão do Google expirou. Reconecte em Configuração.", "erro");
    } else if (msg.startsWith("SEM_PERMISSAO")) {
      toast("Sem permissão na planilha. Verifique o compartilhamento e os escopos.", "erro");
    } else {
      toast("Falha ao sincronizar: " + msg.slice(0, 90), "erro");
    }
  }
}

// ---------------- boot ----------------
async function boot() {
  // 1) Captura retorno do OAuth antes de qualquer outra coisa
  const ret = capturarRetornoOAuth();

  // 2) Configuração e tema
  estado.cfg = await carregarConfig();
  await aplicarTema(await getCfg("tema", "auto"), false);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", async () => {
    if ((await getCfg("tema", "auto")) === "auto") aplicarTema("auto", false);
  });

  // 3) Dados
  estado.datasComDados = new Set(await listarDatas());
  const params = new URLSearchParams(location.search);
  if (params.get("tab") === "analise") estado.aba = "analise";
  await irPara(hojeISO());
  document.getElementById("sub-topo").textContent =
    `${estado.datasComDados.size} ${estado.datasComDados.size === 1 ? "dia registrado" : "dias registrados"}`;

  ligarEventos();
  trocarAba(estado.aba);

  // 4) Resultado do login + sync automático ao abrir
  if (ret.ok) { toast("Conta Google conectada.", "ok"); renderStatusSync(); }
  else if (ret.erro) toast("Login cancelado ou negado (" + ret.erro + ").", "erro");
  if (estaLogado()) fazerSync(true);

  // 5) Service worker
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("sw.js", { scope: "./" }); }
    catch (e) { console.warn("SW:", e); }
  }
}

function ligarEventos() {
  $$(".tabbar button").forEach((b) => b.addEventListener("click", () => trocarAba(b.dataset.tab)));

  document.getElementById("btn-tema").addEventListener("click", async () => {
    const atual = document.documentElement.dataset.tema;
    await aplicarTema(atual === "dark" ? "light" : "dark");
  });

  document.getElementById("dia-ant").addEventListener("click", () => irPara(addDias(estado.data, -1)));
  document.getElementById("dia-prox").addEventListener("click", () => irPara(addDias(estado.data, 1)));
  document.getElementById("data-titulo").addEventListener("click", () => {
    const i = document.getElementById("data-input");
    i.classList.remove("hidden");
    document.getElementById("data-titulo").classList.add("hidden");
    if (i.showPicker) { try { i.showPicker(); } catch { i.focus(); } } else i.focus();
  });
  document.getElementById("data-input").addEventListener("change", (e) => {
    if (e.target.value) irPara(e.target.value);
    e.target.classList.add("hidden");
    document.getElementById("data-titulo").classList.remove("hidden");
  });
  document.getElementById("btn-cal").addEventListener("click", () => {
    estado.calAberto = !estado.calAberto;
    const w = document.getElementById("cal-wrap");
    w.classList.toggle("hidden", !estado.calAberto);
    if (estado.calAberto) {
      const d = new Date(estado.data + "T00:00:00");
      estado.calMes = { ano: d.getFullYear(), mes: d.getMonth() };
      renderCalendario();
    }
  });

  document.getElementById("tipo-dia").addEventListener("change", (e) => mudarTipoDia(e.target.value));
  document.getElementById("obs-dia").addEventListener("input", (e) => { estado.dia.observacao = e.target.value; agendarSalvar(); });
  document.getElementById("chave-ativa").addEventListener("change", (e) => {
    estado.dia.chave_mestra.ativa = e.target.checked;
    renderChaveMestra(); agendarSalvar();
  });
  document.getElementById("add-interrup").addEventListener("click", () => {
    estado.dia.interrupcoes.push({ id: "int_" + Date.now(), inicio: "", fim: "", motivo: "" });
    renderInterrupcoes(); agendarSalvar();
  });

  $$("#seg-periodo button").forEach((b) => b.addEventListener("click", () => {
    estado.periodo = b.dataset.p;
    $$("#seg-periodo button").forEach((x) => x.classList.toggle("active", x === b));
    renderAnalise();
  }));

  document.getElementById("btn-sync").addEventListener("click", () => fazerSync(false));
  document.getElementById("btn-sync-2").addEventListener("click", () => fazerSync(false));
  document.getElementById("btn-login").addEventListener("click", () => iniciarLogin("sync"));
  document.getElementById("btn-logout").addEventListener("click", () => { sairDaConta(); renderStatusSync(); toast("Desconectado."); });

  document.getElementById("btn-exp-json").addEventListener("click", async () => {
    const n = await exportarJSON(); toast(`Backup JSON baixado (${n} dias).`, "ok");
  });
  document.getElementById("btn-exp-csv").addEventListener("click", async () => {
    const n = await exportarCSV(); toast(`CSV baixado (${n} dias).`, "ok");
  });
  document.getElementById("file-import").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const n = await importarJSON(f);
      estado.cfg = await carregarConfig();
      estado.datasComDados = new Set(await listarDatas());
      await irPara(estado.data);
      toast(`${n} dias importados.`, "ok");
    } catch (err) { toast("Erro ao importar: " + err.message, "erro"); }
    e.target.value = "";
  });

  document.getElementById("cfg-add").addEventListener("click", () => {
    const tipo = document.getElementById("cfg-tipo-dia").value;
    estado.cfg.grades[tipo].push({
      id: "bloco_" + Date.now(), nome: "Novo bloco", inicio: "12:00", fim: "13:00", cat: "tempo_util",
    });
    salvarConfig(estado.cfg); renderGradeConfig();
  });
  document.getElementById("cfg-reset").addEventListener("click", async () => {
    if (!confirm("Restaurar a grade padrão de fábrica? Dias já registrados não são afetados.")) return;
    await resetarConfig();
    estado.cfg = await carregarConfig();
    renderConfig(); toast("Grade restaurada.", "ok");
  });

  // rodapé
  document.getElementById("rodape").innerHTML =
    "<strong>Onde ficam seus dados:</strong> o registro do dia a dia é gravado no " +
    "IndexedDB deste navegador e sincronizado com sua planilha privada no Google Sheets " +
    "(aba <strong>Registros</strong>) ao abrir o app e no botão de sincronizar. " +
    "A planilha é a cópia durável — limpar os dados do site apaga apenas o cache local. " +
    "Use <strong>Exportar JSON</strong> para um backup completo reimportável e " +
    "<strong>Exportar CSV</strong> para análise fora do app.";
}

document.addEventListener("DOMContentLoaded", boot);
