/* ============================================================
   TEMPLATES / GRADES PADRÃO
   Estes são apenas os valores INICIAIS. O usuário pode editar tudo
   no menu Configuração; as grades editadas ficam salvas no IndexedDB.
   Cada dia registrado congela ("snapshot") a grade vigente no momento
   em que foi criado — editar a configuração nunca altera o passado.
   ============================================================ */
"use strict";

const CATEGORIAS = {
  necessidade: { label: "Necessidade", cor: "#f59e0b" },
  tempo_util:  { label: "Tempo Útil",  cor: "#10b981" },
  logistica:   { label: "Logística",   cor: "#f43f5e" },
  expediente:  { label: "Expediente",  cor: "#8b5cf6" },
  treino:      { label: "Treino",      cor: "#06b6d4" },
  descanso:    { label: "Descanso",    cor: "#0ea5e9" },
};

/* Âncoras do dia (editáveis na Configuração).
   "dormir" marca o início do processo de dormir (largar telas, deitar) —
   esse intervalo conta como sono, por isso não há âncora separada de "deitar". */
const ANCORAS_PADRAO = {
  acordar: "07:00",
  dormir:  "22:40",
};

// Dia útil COM expediente — grade base informada pelo usuário.
const GRADE_EXPEDIENTE = [
  { id: "rotina_matinal",         nome: "Rotina matinal + Café da manhã",       inicio: "07:00", fim: "08:00", cat: "necessidade" },
  { id: "util_manha",             nome: "Tempo útil (manhã)",                   inicio: "08:00", fim: "12:00", cat: "tempo_util" },
  { id: "almoco",                 nome: "Almoçar e tirar a mesa",               inicio: "12:00", fim: "12:30", cat: "necessidade" },
  { id: "util_tarde",             nome: "Tempo útil (tarde)",                   inicio: "12:30", fim: "13:30", cat: "tempo_util" },
  { id: "arrumar_trabalho",       nome: "Se arrumar para o trabalho",           inicio: "13:30", fim: "13:40", cat: "logistica" },
  { id: "lanche_pretreino",       nome: "Arrumar lanche da tarde e pré-treino", inicio: "13:40", fim: "13:50", cat: "logistica" },
  { id: "trajeto_ida_trabalho",   nome: "Trajeto de ida para o trabalho",       inicio: "13:50", fim: "14:00", cat: "logistica" },
  { id: "expediente",             nome: "Expediente de trabalho",               inicio: "14:00", fim: "19:20", cat: "expediente" },
  { id: "trajeto_volta_trabalho", nome: "Trajeto de volta para casa",           inicio: "19:20", fim: "19:30", cat: "logistica" },
  { id: "arrumar_academia",       nome: "Se arrumar para a academia",           inicio: "19:30", fim: "19:40", cat: "logistica" },
  { id: "trajeto_ida_academia",   nome: "Trajeto de ida para a academia",       inicio: "19:40", fim: "19:45", cat: "logistica" },
  { id: "treino",                 nome: "Treino",                               inicio: "19:45", fim: "21:00", cat: "treino" },
  { id: "trajeto_volta_academia", nome: "Trajeto de volta para casa",           inicio: "21:00", fim: "21:05", cat: "logistica" },
  { id: "banho",                  nome: "Trocar de roupa e tomar banho",        inicio: "21:05", fim: "21:20", cat: "necessidade" },
  { id: "jantar",                 nome: "Jantar",                               inicio: "21:20", fim: "21:40", cat: "necessidade" },
  { id: "util_noite",             nome: "Tempo útil (noite)",                   inicio: "21:40", fim: "22:40", cat: "tempo_util" },
];

// Dia SEM expediente — o bloco de trabalho e seus trajetos viram Tempo Útil.
const GRADE_LIVRE = [
  { id: "rotina_matinal",         nome: "Rotina matinal + Café da manhã",  inicio: "07:00", fim: "08:00", cat: "necessidade" },
  { id: "util_manha",             nome: "Tempo útil (manhã)",              inicio: "08:00", fim: "12:00", cat: "tempo_util" },
  { id: "almoco",                 nome: "Almoçar e tirar a mesa",          inicio: "12:00", fim: "12:30", cat: "necessidade" },
  { id: "descanso",               nome: "Descanso pós-almoço / lazer",     inicio: "12:30", fim: "13:30", cat: "descanso" },
  { id: "util_tarde",             nome: "Tempo útil (tarde)",              inicio: "13:30", fim: "19:30", cat: "tempo_util" },
  { id: "arrumar_academia",       nome: "Se arrumar para a academia",      inicio: "19:30", fim: "19:40", cat: "logistica" },
  { id: "trajeto_ida_academia",   nome: "Trajeto de ida para a academia",  inicio: "19:40", fim: "19:45", cat: "logistica" },
  { id: "treino",                 nome: "Treino",                          inicio: "19:45", fim: "21:00", cat: "treino" },
  { id: "trajeto_volta_academia", nome: "Trajeto de volta para casa",      inicio: "21:00", fim: "21:05", cat: "logistica" },
  { id: "banho",                  nome: "Trocar de roupa e tomar banho",   inicio: "21:05", fim: "21:20", cat: "necessidade" },
  { id: "jantar",                 nome: "Jantar",                          inicio: "21:20", fim: "21:40", cat: "necessidade" },
  { id: "util_noite",             nome: "Tempo útil (noite)",              inicio: "21:40", fim: "22:40", cat: "tempo_util" },
];

const clonarGrade = (g) => g.map((t) => ({ ...t }));

const TIPOS_DIA = {
  util_expediente:     { label: "Dia útil (com expediente)" },
  util_sem_expediente: { label: "Dia útil (sem expediente / folga / feriado)" },
  sabado:              { label: "Sábado" },
  domingo:             { label: "Domingo" },
};

// Config padrão de fábrica. sabado/domingo nascem iguais ao dia livre e
// podem ser personalizados depois na Configuração.
function configPadrao() {
  return {
    ancoras: { ...ANCORAS_PADRAO },
    grades: {
      util_expediente:     clonarGrade(GRADE_EXPEDIENTE),
      util_sem_expediente: clonarGrade(GRADE_LIVRE),
      sabado:              clonarGrade(GRADE_LIVRE),
      domingo:             clonarGrade(GRADE_LIVRE),
    },
  };
}

function inferirTipoDia(iso) {
  const dow = new Date(iso + "T00:00:00").getDay();
  if (dow === 0) return "domingo";
  if (dow === 6) return "sabado";
  return "util_expediente";
}
