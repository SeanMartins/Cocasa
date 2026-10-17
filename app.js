import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, onSnapshot, writeBatch, query, where, orderBy, serverTimestamp, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

/* ================= UTIL ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const EUR = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const fmt = n => EUR.format(Number(n) || 0);
const fmtPdf = n => (Number(n) || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " EUR";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const localISO = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const today = () => localISO(new Date());
const fmtDate = s => (s ? s.split("-").reverse().join("/") : "");
const daysTo = s => Math.round((new Date(s + "T00:00:00") - new Date(today() + "T00:00:00")) / 86400000);
const round2 = n => Math.round(n * 100) / 100;
const sumAmt = list => list.reduce((a, e) => a + (Number(e.amount) || 0), 0);
function addMonths(ds, n) {
  const [y, m, d] = ds.split("-").map(Number);
  const dt = new Date(y, m - 1 + n, 1);
  const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  dt.setDate(Math.min(d, last));
  return localISO(dt);
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2800);
}

const TYPES = {
  income: { label: "Entrata", icon: "↓", who: "Incassato da", cats: ["Affitto", "Deposito cauzionale", "Rimborso spese", "Altra entrata"] },
  expense: { label: "Spesa", icon: "↑", who: "Pagato da", cats: ["Acquisto immobile", "Imposta di registro", "Notaio", "Pratiche tecniche", "Volture/Allacci", "IMU", "Condominio", "Assicurazione", "Utenze", "Cedolare/Tasse", "Commercialista", "Mutuo", "Arredo", "Altra spesa"] },
  maintenance: { label: "Manutenzione", icon: "🔧", who: "Pagato da", cats: ["Ordinaria", "Straordinaria", "Idraulico", "Elettricista", "Caldaia/Clima", "Imbiancatura", "Elettrodomestici", "Infissi", "Altro"] },
  transfer: { label: "Conguaglio", icon: "⇄", who: "", cats: ["Conguaglio"] }
};
const RECUR = {
  none: { label: "Una tantum", m: 0 }, monthly: { label: "Mensile", m: 1 }, bimonthly: { label: "Bimestrale", m: 2 },
  quarterly: { label: "Trimestrale", m: 3 }, semiannual: { label: "Semestrale", m: 6 }, yearly: { label: "Annuale", m: 12 }
};

// Costi iniziali: fuori dal netto annuale, mostrati come "Investimento"
const CAPEX = ["Acquisto immobile", "Imposta di registro", "Notaio", "Pratiche tecniche", "Volture/Allacci"];
const SPLIT = "_split"; // pagato insieme: ognuno ha versato la sua quota
const isCapex = e => (e.type === "expense" || e.type === "maintenance") && CAPEX.includes(e.category);
const isDeposit = e => e.type === "income" && e.category === "Deposito cauzionale";
const isOper = e => e.type !== "transfer" && !isCapex(e) && !isDeposit(e);

/* ================= STATE ================= */
const S = {
  user: null, props: [], pid: localStorage.getItem("cocasa_pid"), activePid: null,
  entries: [], scheduled: [], tab: "dash", year: String(new Date().getFullYear()), filter: "all"
};
let propUnsub = null, subUnsubs = [];
const prop = () => S.props.find(p => p.id === S.pid);
const members = () => prop()?.members || [];
const fullName = uid => prop()?.memberInfo?.[uid]?.name || "Socio";
const memberName = uid => (uid === SPLIT ? "Insieme" : uid ? fullName(uid).split(" ")[0] : "—");

/* ================= CALCOLI ================= */
// Saldo: positivo = il socio è a credito (ha anticipato più della sua quota)
function computeBalances(p, entries) {
  const bal = {}; p.members.forEach(m => (bal[m] = 0));
  for (const e of entries) {
    const a = Number(e.amount) || 0;
    if (e.type === "transfer") { bal[e.from] = (bal[e.from] || 0) + a; bal[e.to] = (bal[e.to] || 0) - a; continue; }
    if (isDeposit(e) || e.paidBy === SPLIT) continue; // deposito resta a chi lo custodisce; spese pagate insieme già in pari
    const sh = e.shares || p.defaultShares || {};
    for (const m of Object.keys(sh)) {
      const part = a * (Number(sh[m]) || 0) / 100;
      bal[m] = (bal[m] || 0) + (e.type === "income" ? part : -part);
    }
    if (e.paidBy) bal[e.paidBy] = (bal[e.paidBy] || 0) + (e.type === "income" ? -a : a);
  }
  return bal;
}
function settlements(bal) {
  const cred = [], deb = [];
  for (const [m, v] of Object.entries(bal)) { if (v > 0.005) cred.push([m, v]); else if (v < -0.005) deb.push([m, -v]); }
  const out = []; let i = 0, j = 0;
  while (i < deb.length && j < cred.length) {
    const x = Math.min(deb[i][1], cred[j][1]);
    out.push({ from: deb[i][0], to: cred[j][0], amount: round2(x) });
    deb[i][1] -= x; cred[j][1] -= x;
    if (deb[i][1] < 0.005) i++; if (cred[j][1] < 0.005) j++;
  }
  return out.filter(s => s.amount >= 0.01);
}
function memberQuotas(p, list) {
  const q = {}; p.members.forEach(m => (q[m] = { inc: 0, exp: 0 }));
  for (const e of list) {
    if (e.type === "transfer") continue;
    const sh = e.shares || p.defaultShares || {};
    for (const m of Object.keys(sh)) {
      q[m] ??= { inc: 0, exp: 0 };
      const part = (Number(e.amount) || 0) * (Number(sh[m]) || 0) / 100;
      if (e.type === "income") q[m].inc += part; else q[m].exp += part;
    }
  }
  return q;
}
function sharesOk(p) {
  const sh = p.defaultShares || {};
  return Math.abs(p.members.reduce((a, m) => a + (Number(sh[m]) || 0), 0) - 100) < 0.05;
}
function projected12() {
  const end = addMonths(today(), 12); let t = 0;
  for (const s of S.scheduled) {
    if (s.done) continue;
    const m = RECUR[s.recurrence || "none"].m; let d = s.dueDate, g = 0;
    while (d < end && g++ < 400) { t += Number(s.amount) || 0; if (!m) break; d = addMonths(d, m); }
  }
  return t;
}
function reportData(p, year) {
  const all = S.entries.filter(e => e.date?.startsWith(year) && e.type !== "transfer");
  const ye = all.filter(isOper);
  const cap = all.filter(isCapex), capByCat = {};
  cap.forEach(e => (capByCat[e.category] = (capByCat[e.category] || 0) + (Number(e.amount) || 0)));
  const byCat = { income: {}, expense: {}, maintenance: {} };
  ye.forEach(e => { const c = e.category || "Altro"; byCat[e.type][c] = (byCat[e.type][c] || 0) + (Number(e.amount) || 0); });
  const tot = {};
  ["income", "expense", "maintenance"].forEach(t => (tot[t] = sumAmt(ye.filter(e => e.type === t))));
  return { all, ye, byCat, tot, q: memberQuotas(p, ye), cap, capByCat, capTot: sumAmt(cap), capQ: memberQuotas(p, cap), dep: sumAmt(all.filter(isDeposit)) };
}

/* ================= AUTH ================= */
$("#btnLogin").onclick = async () => {
  const pr = new GoogleAuthProvider();
  try { await signInWithPopup(auth, pr); }
  catch (e) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) await signInWithRedirect(auth, pr);
    else if (e.code !== "auth/popup-closed-by-user") toast(e.message);
  }
};
getRedirectResult(auth).catch(e => toast(e.message));

onAuthStateChanged(auth, async u => {
  stopAll();
  S.user = u;
  $("#login").classList.toggle("hidden", !!u);
  $("#app").classList.toggle("hidden", !u);
  if (!u) return;
  await acceptInvite(u);
  subscribeProps();
});

function stopAll() {
  propUnsub?.(); propUnsub = null;
  subUnsubs.forEach(f => f()); subUnsubs = [];
  S.props = []; S.entries = []; S.scheduled = []; S.activePid = null;
}

async function acceptInvite(u) {
  const email = (u.email || "").toLowerCase(); if (!email) return false;
  try {
    const ref = doc(db, "invites", email);
    const snap = await getDoc(ref);
    if (!snap.exists()) return false;
    const { pid } = snap.data();
    await updateDoc(doc(db, "properties", pid), {
      members: arrayUnion(u.uid),
      pendingInvites: arrayRemove(email),
      [`memberInfo.${u.uid}`]: { name: u.displayName || email, email }
    });
    await deleteDoc(ref);
    S.pid = pid; localStorage.setItem("cocasa_pid", pid);
    toast("Sei stato aggiunto all'immobile ✓");
    return true;
  } catch (e) { console.warn(e); return false; }
}

function subscribeProps() {
  const q = query(collection(db, "properties"), where("members", "array-contains", S.user.uid));
  propUnsub = onSnapshot(q, snap => {
    S.props = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    if (!S.props.length) { subUnsubs.forEach(f => f()); subUnsubs = []; S.activePid = null; renderOnboarding(); return; }
    if (!prop()) S.pid = S.props[0].id;
    if (S.activePid !== S.pid) selectProp(S.pid);
    else { renderPropSelect(); render(); }
  }, err => toast("Errore: " + err.message));
}

function selectProp(pid) {
  S.pid = pid; S.activePid = pid; localStorage.setItem("cocasa_pid", pid);
  subUnsubs.forEach(f => f()); subUnsubs = []; S.entries = []; S.scheduled = [];
  subUnsubs.push(onSnapshot(query(collection(db, "properties", pid, "entries"), orderBy("date", "desc")),
    s => { S.entries = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, err => toast(err.message)));
  subUnsubs.push(onSnapshot(query(collection(db, "properties", pid, "scheduled"), orderBy("dueDate")),
    s => { S.scheduled = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, err => toast(err.message)));
  renderPropSelect(); render(true);
}

/* ================= RENDER ================= */
function renderPropSelect() {
  $("#propSel").innerHTML = S.props.map(p => `<option value="${p.id}" ${p.id === S.pid ? "selected" : ""}>${esc(p.name)}</option>`).join("") +
    `<option value="__new">+ Nuovo immobile</option>`;
}
$("#propSel").onchange = e => {
  if (e.target.value === "__new") { e.target.value = S.pid || ""; openNewProp(); }
  else { selectProp(e.target.value); }
};

function render(force) {
  const p = prop(); if (!p) return;
  const a = document.activeElement;
  if (!force && a && $("#view").contains(a) && /INPUT|TEXTAREA/.test(a.tagName)) return; // non cancellare ciò che stai scrivendo
  $("#app").classList.remove("empty");
  $$("nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === S.tab));
  $("#fab").classList.toggle("hidden", !["dash", "moves", "sched"].includes(S.tab));
  const v = { dash: viewDash, moves: viewMoves, sched: viewSched, report: viewReport, settings: viewSettings }[S.tab];
  $("#view").innerHTML = v(p);
}

function renderOnboarding() {
  $("#app").classList.add("empty"); $("#fab").classList.add("hidden");
  $("#view").innerHTML = `
  <div class="card hero">
    <h2>Benvenuto in CoCasa</h2>
    <p class="muted">Gestisci con il tuo socio affitti, spese, manutenzioni e scadenze di un immobile in comproprietà.</p>
    <label>Nome immobile<input id="obName" placeholder="es. Appartamento via Roma"></label>
    <label>Indirizzo<input id="obAddr" placeholder="Via, civico, comune"></label>
    <button class="btn block" data-act="create">Crea immobile</button>
  </div>
  <div class="card">
    <p class="muted small">Ti ha invitato il tuo socio? Assicurati di aver fatto l'accesso con la stessa email dell'invito.</p>
    <button class="btn ghost block" data-act="recheck">Controlla inviti</button>
  </div>
  <p class="muted small" style="text-align:center">Connesso come ${esc(S.user?.email)} · <button class="link" data-act="logout">Esci</button></p>`;
}

const yearsAvail = () => {
  const ys = new Set([String(new Date().getFullYear())]);
  S.entries.forEach(e => e.date && ys.add(e.date.slice(0, 4)));
  return [...ys].sort().reverse();
};
const yearSelect = () => `<select id="yearSel" class="year">${yearsAvail().map(y => `<option ${y === S.year ? "selected" : ""}>${y}</option>`).join("")}</select>`;

function entryRow(e) {
  const t = TYPES[e.type] || TYPES.expense;
  const sign = e.type === "income" ? "+" : e.type === "transfer" ? "" : "−";
  const who = e.type === "transfer" ? `${memberName(e.from)} → ${memberName(e.to)}` : `${t.who} ${memberName(e.paidBy)}`;
  return `<div class="row" data-act="entry" data-id="${e.id}">
    <div class="ico ${e.type}">${t.icon}</div>
    <div class="grow"><div class="t">${esc(e.description || e.category)}</div>
      <div class="s">${fmtDate(e.date)} · ${esc(e.category)} · ${esc(who)}${e.hasReceipt ? " · 📎" : ""}</div></div>
    <div class="amt ${e.type}">${sign}${fmt(e.amount)}</div></div>`;
}
function schedRow(s) {
  const d = daysTo(s.dueDate);
  const cls = s.done ? "done" : d < 0 ? "late" : d <= 7 ? "soon" : "";
  const when = s.done ? `Pagata ${fmtDate(s.paidOn)}` : d < 0 ? `Scaduta da ${-d} gg` : d === 0 ? "Oggi" : `Tra ${d} gg`;
  return `<div class="row ${cls}">
    <div class="grow" data-act="sched" data-id="${s.id}"><div class="t">${esc(s.description)}</div>
      <div class="s">${fmtDate(s.dueDate)} · ${when} · ${RECUR[s.recurrence || "none"].label}</div></div>
    <div class="amt">${fmt(s.amount)}</div>
    ${s.done ? "" : `<button class="btn sm" data-act="paid" data-id="${s.id}" title="Segna pagata">✓</button>`}</div>`;
}

function viewDash(p) {
  const ye = S.entries.filter(e => e.date?.startsWith(S.year) && isOper(e));
  const cap = S.entries.filter(isCapex), capQ = memberQuotas(p, cap);
  const deps = {}; S.entries.filter(isDeposit).forEach(e => (deps[e.paidBy] = (deps[e.paidBy] || 0) + (Number(e.amount) || 0)));
  const inc = sumAmt(ye.filter(e => e.type === "income"));
  const exp = sumAmt(ye.filter(e => e.type === "expense"));
  const man = sumAmt(ye.filter(e => e.type === "maintenance"));
  const net = inc - exp - man;
  const q = memberQuotas(p, ye);
  const st = settlements(computeBalances(p, S.entries));
  const up = S.scheduled.filter(s => !s.done && daysTo(s.dueDate) <= 30);
  return `
  ${sharesOk(p) ? "" : `<div class="warn" data-act="goto" data-tab="settings">⚠️ Le quote predefinite dei soci non sommano al 100%. Tocca per impostarle.</div>`}
  ${p.members.length < 2 ? `<div class="warn" data-act="goto" data-tab="settings">👥 Invita il tuo socio dalle Impostazioni.</div>` : ""}
  <div class="head-row"><h2>Riepilogo</h2>${yearSelect()}</div>
  <div class="kpis">
    <div class="kpi"><span>Entrate</span><b class="pos">${fmt(inc)}</b></div>
    <div class="kpi"><span>Spese</span><b class="neg">${fmt(exp)}</b></div>
    <div class="kpi"><span>Manutenzioni</span><b class="neg">${fmt(man)}</b></div>
    <div class="kpi"><span>Netto</span><b class="${net >= 0 ? "pos" : "neg"}">${fmt(net)}</b></div>
  </div>
  <div class="card"><h3>Netto per socio · ${S.year}</h3>
    ${p.members.map(m => { const x = q[m] || { inc: 0, exp: 0 }; const n = x.inc - x.exp;
      return `<div class="line"><span>${esc(fullName(m))}</span><span class="${n >= 0 ? "pos" : "neg"}">${fmt(n)}</span></div>`; }).join("")}
  </div>
  ${cap.length ? `<div class="card"><h3>Investimento iniziale · ${fmt(sumAmt(cap))}</h3>
    ${p.members.map(m => `<div class="line"><span>${esc(fullName(m))}</span><span>${fmt(capQ[m]?.exp)}</span></div>`).join("")}
    ${Object.entries(deps).map(([m, v]) => `<div class="line"><span class="muted">Deposito cauzionale custodito da ${esc(memberName(m))}</span><span>${fmt(v)}</span></div>`).join("")}
  </div>` : ""}
  <div class="card"><h3>Saldo tra soci</h3>
    ${st.length ? st.map(s => `<div class="line"><span><b>${esc(memberName(s.from))}</b> deve <b>${fmt(s.amount)}</b> a <b>${esc(memberName(s.to))}</b></span>
      <button class="btn sm" data-act="settle" data-from="${s.from}" data-to="${s.to}" data-amount="${s.amount}">Salda</button></div>`).join("")
      : `<p class="muted">Siete in pari ✓</p>`}
  </div>
  <div class="card"><div class="head-row"><h3>Scadenze vicine</h3><button class="link" data-act="goto" data-tab="sched">Tutte</button></div>
    ${up.length ? up.map(schedRow).join("") : `<p class="muted">Nessuna scadenza nei prossimi 30 giorni</p>`}
  </div>
  <div class="card"><div class="head-row"><h3>Ultimi movimenti</h3><button class="link" data-act="goto" data-tab="moves">Tutti</button></div>
    ${S.entries.slice(0, 5).map(entryRow).join("") || `<p class="muted">Ancora nessun movimento. Tocca + per aggiungerne uno.</p>`}
  </div>`;
}

function viewMoves() {
  let list = S.entries.filter(e => e.date?.startsWith(S.year));
  if (S.filter !== "all") list = list.filter(e => e.type === S.filter);
  const chips = [["all", "Tutti"], ["income", "Entrate"], ["expense", "Spese"], ["maintenance", "Manutenzioni"], ["transfer", "Conguagli"]];
  return `<div class="head-row"><h2>Movimenti</h2>${yearSelect()}</div>
  <div class="chips">${chips.map(([k, l]) => `<button class="chip ${S.filter === k ? "on" : ""}" data-act="filter" data-f="${k}">${l}</button>`).join("")}</div>
  <div class="card">${list.map(entryRow).join("") || `<p class="muted">Nessun movimento</p>`}</div>`;
}

function viewSched() {
  const open = S.scheduled.filter(s => !s.done);
  const late = open.filter(s => daysTo(s.dueDate) < 0);
  const soon = open.filter(s => { const d = daysTo(s.dueDate); return d >= 0 && d <= 30; });
  const later = open.filter(s => daysTo(s.dueDate) > 30);
  const done = S.scheduled.filter(s => s.done).sort((a, b) => (b.paidOn || "").localeCompare(a.paidOn || "")).slice(0, 10);
  const sec = (t, l) => (l.length ? `<h3 class="sec">${t}</h3><div class="card">${l.map(schedRow).join("")}</div>` : "");
  return `<h2>Spese previste</h2>
  <div class="kpi wide"><span>Previsto nei prossimi 12 mesi</span><b>${fmt(projected12())}</b></div>
  ${sec("Scadute", late)}${sec("Prossimi 30 giorni", soon)}${sec("Più avanti", later)}${sec("Completate", done)}
  ${S.scheduled.length ? "" : `<div class="card"><p class="muted">Aggiungi IMU, condominio, assicurazione, revisione caldaia… con il tasto +. Quando ne paghi una tocca ✓: viene registrata la spesa e, se ricorrente, spostata alla prossima scadenza.</p></div>`}`;
}

function viewReport(p) {
  const r = reportData(p, S.year);
  const catList = t => Object.entries(r.byCat[t]).sort((a, b) => b[1] - a[1])
    .map(([c, v]) => `<div class="line"><span>${esc(c)}</span><span>${fmt(v)}</span></div>`).join("") || `<p class="muted">—</p>`;
  return `<div class="head-row"><h2>Report</h2>${yearSelect()}</div>
  <div class="card"><h3>Entrate · ${fmt(r.tot.income)}</h3>${catList("income")}</div>
  <div class="card"><h3>Spese · ${fmt(r.tot.expense)}</h3>${catList("expense")}</div>
  <div class="card"><h3>Manutenzioni · ${fmt(r.tot.maintenance)}</h3>${catList("maintenance")}</div>
  ${r.cap.length ? `<div class="card"><h3>Costi iniziali · ${fmt(r.capTot)}</h3>${Object.entries(r.capByCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<div class="line"><span>${esc(c)}</span><span>${fmt(v)}</span></div>`).join("")}
    <p class="muted small">Esclusi dal netto annuale.${r.dep ? ` Depositi cauzionali incassati: ${fmt(r.dep)} (non sono entrate).` : ""}</p></div>` : ""}
  <div class="card"><h3>Per socio</h3>
    <table class="tbl"><tr><th>Socio</th><th>Entrate</th><th>Spese</th><th>Netto</th></tr>
    ${p.members.map(m => { const x = r.q[m] || { inc: 0, exp: 0 };
      return `<tr><td>${esc(memberName(m))}</td><td>${fmt(x.inc)}</td><td>${fmt(x.exp)}</td><td><b>${fmt(x.inc - x.exp)}</b></td></tr>`; }).join("")}
    </table>
    <p class="muted small">Le quote di entrata sono i canoni pro-quota di ciascun socio. Da verificare con il commercialista per la dichiarazione.</p>
  </div>
  <button class="btn block" data-act="pdf">Scarica PDF ${S.year}</button>`;
}

function viewSettings(p) {
  const me = S.user.uid, sh = p.defaultShares || {};
  return `<h2>Impostazioni</h2>
  <div class="card"><h3>Immobile</h3>
    <label>Nome<input id="pName" value="${esc(p.name)}"></label>
    <label>Indirizzo<input id="pAddr" value="${esc(p.address || "")}"></label>
    <button class="btn" data-act="saveProp">Salva</button></div>
  <div class="card"><h3>Soci e quote predefinite</h3>
    ${p.members.map(m => `<div class="share-row"><span>${esc(fullName(m))}<small>${esc(p.memberInfo?.[m]?.email || "")}</small></span>
      <input type="number" inputmode="decimal" step="0.01" min="0" max="100" data-share="${m}" value="${Number(sh[m]) || 0}"><em>%</em></div>`).join("")}
    <p class="muted small">Usate per ogni nuovo movimento; puoi cambiarle voce per voce.</p>
    <button class="btn" data-act="saveShares">Salva quote</button></div>
  <div class="card"><h3>Invita socio</h3>
    <div class="inline"><input id="invEmail" type="email" placeholder="email.socio@gmail.com"><button class="btn" data-act="invite">Invita</button></div>
    <p class="muted small">Il socio apre l'app e accede con Google usando questa email: entra automaticamente.</p>
    ${(p.pendingInvites || []).map(e => `<div class="line"><span>${esc(e)} <small class="muted">in attesa</small></span>
      <button class="link danger" data-act="cancelInvite" data-email="${esc(e)}">Annulla</button></div>`).join("")}
  </div>
  ${p.importedSeed ? "" : `<div class="card"><h3>Dati iniziali</h3>
    <p class="muted small">Carica acquisto, costi iniziali, spese anticipate, affitti luglio–ottobre e scadenze già calcolati. Serve che il socio abbia già fatto l'accesso.</p>
    <button class="btn ghost block" data-act="importSeed">Importa dati iniziali</button></div>`}
  <div class="card"><h3>Il tuo nome</h3>
    <div class="inline"><input id="myName" value="${esc(p.memberInfo?.[me]?.name || "")}"><button class="btn" data-act="saveName">Salva</button></div></div>
  <div class="card"><button class="btn ghost block" data-act="newProp">+ Aggiungi un altro immobile</button></div>
  <div class="card"><p class="muted small">Connesso come ${esc(S.user.email)}</p><button class="btn ghost block" data-act="logout">Esci</button></div>`;
}

/* ================= AZIONI ================= */
$$("nav button").forEach(b => (b.onclick = () => { S.tab = b.dataset.tab; S.filter = "all"; render(true); window.scrollTo(0, 0); }));
$("#fab").onclick = () => (S.tab === "sched" ? openSched() : openEntry());
$("#view").addEventListener("change", ev => { if (ev.target.id === "yearSel") { S.year = ev.target.value; render(true); } });

$("#view").addEventListener("click", async ev => {
  const el = ev.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id, p = prop();
  try {
    switch (act) {
      case "entry": openEntry(S.entries.find(e => e.id === id)); break;
      case "sched": openSched(S.scheduled.find(s => s.id === id)); break;
      case "paid": markPaid(S.scheduled.find(s => s.id === id)); break;
      case "settle": openEntry(null, { type: "transfer", from: el.dataset.from, to: el.dataset.to, amount: Number(el.dataset.amount), category: "Conguaglio", description: "Conguaglio saldo" }); break;
      case "filter": S.filter = el.dataset.f; render(true); break;
      case "goto": S.tab = el.dataset.tab; render(true); window.scrollTo(0, 0); break;
      case "pdf": exportPdf(p, S.year); break;
      case "saveProp": {
        const name = $("#pName").value.trim(); if (!name) return toast("Inserisci un nome");
        await updateDoc(doc(db, "properties", S.pid), { name, address: $("#pAddr").value.trim() }); toast("Salvato ✓"); break;
      }
      case "saveShares": {
        const obj = {}; let tot = 0;
        $$("#view [data-share]").forEach(i => { const v = round2(Number(i.value) || 0); obj[i.dataset.share] = v; tot += v; });
        if (Math.abs(tot - 100) > 0.05) return toast(`Le quote sommano a ${round2(tot)}%, devono fare 100%`);
        await updateDoc(doc(db, "properties", S.pid), { defaultShares: obj }); toast("Quote salvate ✓"); break;
      }
      case "saveName": {
        const name = $("#myName").value.trim(); if (!name) return;
        await updateDoc(doc(db, "properties", S.pid), { [`memberInfo.${S.user.uid}.name`]: name }); toast("Salvato ✓"); break;
      }
      case "invite": {
        const email = $("#invEmail").value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast("Email non valida");
        if (Object.values(p.memberInfo || {}).some(m => m.email === email)) return toast("È già socio");
        await setDoc(doc(db, "invites", email), { pid: S.pid, propertyName: p.name, invitedBy: S.user.uid, createdAt: serverTimestamp() });
        await updateDoc(doc(db, "properties", S.pid), { pendingInvites: arrayUnion(email) });
        toast("Invito creato. Avvisa il tuo socio di aprire l'app ✓"); break;
      }
      case "cancelInvite": {
        const email = el.dataset.email;
        await deleteDoc(doc(db, "invites", email)).catch(() => {});
        await updateDoc(doc(db, "properties", S.pid), { pendingInvites: arrayRemove(email) }); break;
      }
      case "newProp": openNewProp(); break;
      case "importSeed": await importSeed(p); break;
      case "logout": await signOut(auth); break;
      case "create": {
        const name = $("#obName").value.trim(); if (!name) return toast("Inserisci un nome");
        await createProperty(name, $("#obAddr").value.trim()); break;
      }
      case "recheck": if (!(await acceptInvite(S.user))) toast("Nessun invito trovato per " + S.user.email); break;
    }
  } catch (e) { console.error(e); toast(e.message); }
});

async function createProperty(name, address) {
  const u = S.user;
  const ref = await addDoc(collection(db, "properties"), {
    name, address, createdBy: u.uid, members: [u.uid],
    memberInfo: { [u.uid]: { name: u.displayName || u.email, email: (u.email || "").toLowerCase() } },
    defaultShares: { [u.uid]: 100 }, pendingInvites: [], createdAt: serverTimestamp()
  });
  S.tab = "settings";
  selectProp(ref.id);
  toast("Immobile creato. Ora invita il tuo socio ✓");
}

async function importSeed(p) {
  if (p.importedSeed) return toast("Dati già importati");
  const me = S.user.uid, other = p.members.find(m => m !== me);
  if (!other) return toast("Prima il tuo socio deve accedere all'app con l'invito");
  if (!confirm("Importare i movimenti e le scadenze iniziali?")) return;
  const { SEED } = await import("./seed-data.js");
  const sh = { [me]: 50, [other]: 50 };
  const who = w => (w === "me" ? me : w === "both" ? SPLIT : other);
  const b = writeBatch(db), now = serverTimestamp();
  for (const e of SEED.entries) b.set(doc(collection(db, "properties", p.id, "entries")), {
    type: e.type, date: e.date, amount: e.amount, category: e.category, description: e.description, note: e.note || "",
    paidBy: who(e.paidBy), shares: sh, hasReceipt: false, createdAt: now, createdBy: me, updatedAt: now, updatedBy: me
  });
  for (const s of SEED.scheduled) b.set(doc(collection(db, "properties", p.id, "scheduled")), {
    ...s, paidBy: who(s.paidBy), shares: sh, done: false, createdBy: me, updatedAt: now
  });
  b.update(doc(db, "properties", p.id), { importedSeed: true, defaultShares: sh });
  await b.commit();
  S.tab = "dash"; render(true);
  toast(`Importati ${SEED.entries.length} movimenti e ${SEED.scheduled.length} scadenze ✓`);
}

/* ================= MODALI ================= */
function openModal(html) { $("#sheet").innerHTML = html; $("#modal").classList.remove("hidden"); document.body.classList.add("noscroll"); }
function closeModal() { $("#modal").classList.add("hidden"); $("#sheet").innerHTML = ""; document.body.classList.remove("noscroll"); }
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });

const memberSelect = (id, val, split) => `<select id="${id}">${members().map(m => `<option value="${m}" ${m === val ? "selected" : ""}>${esc(fullName(m))}</option>`).join("")}${split && members().length > 1 ? `<option value="${SPLIT}" ${val === SPLIT ? "selected" : ""}>Insieme (ognuno la sua quota)</option>` : ""}</select>`;
const sharesBlock = f => `<div class="field">
  <div class="lbl">Ripartizione <button type="button" class="link" data-x="equal">parti uguali</button><button type="button" class="link" data-x="default">predefinita</button></div>
  ${members().map(m => `<div class="share-row"><span>${esc(fullName(m))}</span><input type="number" inputmode="decimal" step="0.01" data-share="${m}" value="${Number(f.shares?.[m]) || 0}"><em>%</em></div>`).join("")}
  <div class="small muted" id="shareSum"></div></div>`;
const readShares = f => $$("#sheet [data-share]").forEach(i => (f.shares[i.dataset.share] = Number(i.value) || 0));
function updSum() {
  const el = $("#shareSum"); if (!el) return;
  const t = $$("#sheet [data-share]").reduce((a, i) => a + (Number(i.value) || 0), 0);
  el.textContent = `Totale ${round2(t)}%`; el.className = "small " + (Math.abs(t - 100) < 0.05 ? "muted" : "neg");
}
function cleanShares(f) {
  const sh = {}; let tot = 0;
  members().forEach(m => { const v = round2(Number(f.shares?.[m]) || 0); if (v) sh[m] = v; tot += v; });
  if (Math.abs(tot - 100) > 0.05) throw new Error("Le quote devono sommare al 100%");
  return sh;
}
const parseAmount = v => round2(Number(String(v ?? "").replace(",", ".")));

function bindSheet(f, read, draw, actions) {
  const sh = $("#sheet");
  sh.onclick = async ev => {
    const b = ev.target.closest("[data-type],[data-x]"); if (!b) return;
    if (b.dataset.type) { read(); f.type = b.dataset.type; draw(); return; }
    const x = b.dataset.x;
    if (x === "close") return closeModal();
    if (x === "equal") { read(); const ms = members(); ms.forEach(m => (f.shares[m] = round2(100 / ms.length))); return draw(); }
    if (x === "default") { read(); f.shares = { ...(prop().defaultShares || {}) }; return draw(); }
    if (actions[x]) {
      read();
      if (x === "save") {
        b.disabled = true;
        try { await actions.save(); } catch (e) { toast(e.message); b.disabled = false; }
      } else await actions[x](b);
    }
  };
  sh.oninput = ev => { if ("share" in ev.target.dataset) updSum(); };
  updSum();
}

/* ---- Movimento ---- */
function openEntry(existing, prefill = {}, onSaved) {
  const p = prop(); if (!p) return;
  const me = S.user.uid;
  const f = {
    type: "expense", date: today(), amount: "", description: "", category: "", note: "",
    paidBy: me, from: me, to: members().find(m => m !== me) || me,
    shares: { ...(p.defaultShares || {}) }, ...prefill, ...(existing || {})
  };
  f.shares = { ...(f.shares || {}) };

  const read = () => {
    const v = id => $("#" + id)?.value;
    f.amount = v("fAmount"); f.date = v("fDate"); f.category = v("fCat"); f.description = v("fDesc"); f.note = v("fNote");
    if (f.type === "transfer") { f.from = v("fFrom"); f.to = v("fTo"); }
    else { f.paidBy = v("fPaid"); readShares(f); }
  };
  const rcStatus = () => f.receiptData ? "Nuovo allegato pronto ✓"
    : f.hasReceipt && !f.removeReceipt && existing ? `<button type="button" class="link" data-x="viewrc">Vedi allegato</button> · <button type="button" class="link danger" data-x="rmrc">Rimuovi</button>`
    : "Nessun allegato";

  const draw = () => {
    const t = TYPES[f.type];
    if (!t.cats.includes(f.category)) f.category = t.cats[0];
    openModal(`
      <div class="sheet-head"><h3>${existing ? "Modifica" : "Nuovo"} movimento</h3><button class="x" data-x="close">✕</button></div>
      <div class="seg">${Object.entries(TYPES).map(([k, v]) => `<button type="button" class="${k === f.type ? "on" : ""}" data-type="${k}">${v.label}</button>`).join("")}</div>
      <div class="grid2">
        <label>Importo €<input id="fAmount" type="number" inputmode="decimal" step="0.01" value="${esc(f.amount)}"></label>
        <label>Data<input id="fDate" type="date" value="${esc(f.date)}"></label>
      </div>
      <label>Categoria<select id="fCat">${t.cats.map(c => `<option ${c === f.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
      <label>Descrizione<input id="fDesc" value="${esc(f.description)}" placeholder="es. Affitto ottobre"></label>
      ${f.type === "transfer"
        ? `<div class="grid2"><label>Chi paga${memberSelect("fFrom", f.from)}</label><label>A chi${memberSelect("fTo", f.to)}</label></div>
           <p class="muted small">Registra un rimborso tra soci per azzerare il saldo.</p>`
        : `<label>${t.who}${memberSelect("fPaid", f.paidBy, f.type !== "income")}</label>${sharesBlock(f)}`}
      <label>Note<textarea id="fNote" rows="2">${esc(f.note || "")}</textarea></label>
      ${f.type === "transfer" ? "" : `<div class="field"><div class="lbl">Ricevuta / fattura</div>
        <div class="inline"><label class="btn ghost sm file" style="margin:0">📷 Allega<input id="fFile" type="file" accept="image/*,application/pdf" hidden></label>
        <span id="rcStatus" class="small">${rcStatus()}</span></div></div>`}
      <div class="actions">${existing ? `<button class="btn ghost danger" data-x="delete">Elimina</button>` : ""}<button class="btn" data-x="save">Salva</button></div>`);
    bindSheet(f, read, draw, {
      save: async () => { await saveEntry(f, existing); closeModal(); toast("Salvato ✓"); if (onSaved) await onSaved(f); },
      delete: async () => { if (!confirm("Eliminare questo movimento?")) return; await deleteEntry(existing); closeModal(); toast("Eliminato"); },
      viewrc: async () => viewReceipt(existing.id),
      rmrc: async () => { f.removeReceipt = true; f.receiptData = null; draw(); }
    });
    const file = $("#fFile");
    if (file) file.onchange = async () => {
      read(); $("#rcStatus").textContent = "Elaborazione…";
      try { f.receiptData = await fileToDataUrl(file.files[0]); f.removeReceipt = false; }
      catch (e) { toast(e.message); }
      $("#rcStatus").innerHTML = rcStatus();
    };
  };
  draw();
}

async function saveEntry(f, existing) {
  const pid = S.pid, amount = parseAmount(f.amount);
  if (!(amount > 0)) throw new Error("Inserisci un importo valido");
  if (!f.date) throw new Error("Inserisci la data");
  const data = {
    type: f.type, date: f.date, amount, category: f.category || "",
    description: (f.description || "").trim(), note: (f.note || "").trim(),
    createdAt: existing?.createdAt || serverTimestamp(), createdBy: existing?.createdBy || S.user.uid,
    updatedAt: serverTimestamp(), updatedBy: S.user.uid
  };
  if (f.type === "transfer") {
    if (f.from === f.to) throw new Error("Scegli due soci diversi");
    data.from = f.from; data.to = f.to; data.hasReceipt = false;
  } else {
    data.shares = cleanShares(f); data.paidBy = f.paidBy;
    data.hasReceipt = !!f.receiptData || (!!existing?.hasReceipt && !f.removeReceipt);
  }
  const ref = existing ? doc(db, "properties", pid, "entries", existing.id) : doc(collection(db, "properties", pid, "entries"));
  if (f.receiptData && f.type !== "transfer") await setDoc(doc(db, "properties", pid, "receipts", ref.id), { data: f.receiptData, createdAt: serverTimestamp() });
  else if (existing?.hasReceipt && !data.hasReceipt) await deleteDoc(doc(db, "properties", pid, "receipts", ref.id)).catch(() => {});
  await setDoc(ref, data);
}
async function deleteEntry(e) {
  if (e.hasReceipt) await deleteDoc(doc(db, "properties", S.pid, "receipts", e.id)).catch(() => {});
  await deleteDoc(doc(db, "properties", S.pid, "entries", e.id));
}

/* ---- Spesa prevista ---- */
function openSched(existing) {
  const p = prop(); if (!p) return;
  const f = {
    type: "expense", description: "", amount: "", dueDate: today(), recurrence: "yearly", category: "",
    paidBy: S.user.uid, shares: { ...(p.defaultShares || {}) }, ...(existing || {})
  };
  f.shares = { ...(f.shares || {}) };
  const read = () => {
    const v = id => $("#" + id)?.value;
    f.description = v("fDesc"); f.amount = v("fAmount"); f.dueDate = v("fDate"); f.recurrence = v("fRec");
    f.category = v("fCat"); f.paidBy = v("fPaid"); readShares(f);
  };
  const draw = () => {
    const t = TYPES[f.type];
    if (!t.cats.includes(f.category)) f.category = t.cats[0];
    openModal(`
      <div class="sheet-head"><h3>${existing ? "Modifica" : "Nuova"} spesa prevista</h3><button class="x" data-x="close">✕</button></div>
      <div class="seg">${["expense", "maintenance"].map(k => `<button type="button" class="${k === f.type ? "on" : ""}" data-type="${k}">${TYPES[k].label}</button>`).join("")}</div>
      <label>Descrizione<input id="fDesc" value="${esc(f.description)}" placeholder="es. IMU acconto, rata condominio"></label>
      <div class="grid2">
        <label>Importo previsto €<input id="fAmount" type="number" inputmode="decimal" step="0.01" value="${esc(f.amount)}"></label>
        <label>Scadenza<input id="fDate" type="date" value="${esc(f.dueDate)}"></label>
      </div>
      <div class="grid2">
        <label>Ripetizione<select id="fRec">${Object.entries(RECUR).map(([k, v]) => `<option value="${k}" ${k === f.recurrence ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
        <label>Categoria<select id="fCat">${t.cats.map(c => `<option ${c === f.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
      </div>
      <label>Di solito paga${memberSelect("fPaid", f.paidBy, true)}</label>
      ${sharesBlock(f)}
      <div class="actions">${existing ? `<button class="btn ghost danger" data-x="delete">Elimina</button>` : ""}<button class="btn" data-x="save">Salva</button></div>`);
    bindSheet(f, read, draw, {
      save: async () => {
        const amount = parseAmount(f.amount);
        if (!f.description.trim()) throw new Error("Inserisci una descrizione");
        if (!(amount >= 0) || f.amount === "") throw new Error("Inserisci l'importo previsto");
        if (!f.dueDate) throw new Error("Inserisci la scadenza");
        const data = {
          type: f.type, description: f.description.trim(), amount, dueDate: f.dueDate, recurrence: f.recurrence,
          category: f.category, paidBy: f.paidBy, shares: cleanShares(f), done: existing?.done || false,
          createdBy: existing?.createdBy || S.user.uid, updatedAt: serverTimestamp()
        };
        if (existing?.paidOn) data.paidOn = existing.paidOn;
        const ref = existing ? doc(db, "properties", S.pid, "scheduled", existing.id) : doc(collection(db, "properties", S.pid, "scheduled"));
        await setDoc(ref, data); closeModal(); toast("Salvato ✓");
      },
      delete: async () => { if (!confirm("Eliminare questa scadenza?")) return; await deleteDoc(doc(db, "properties", S.pid, "scheduled", existing.id)); closeModal(); }
    });
  };
  draw();
}

function markPaid(s) {
  if (!s) return;
  openEntry(null, {
    type: s.type || "expense", amount: s.amount, description: s.description, category: s.category,
    paidBy: (s.paidBy === SPLIT || members().includes(s.paidBy)) ? s.paidBy : S.user.uid, shares: s.shares || prop().defaultShares, date: today()
  }, async () => {
    const ref = doc(db, "properties", S.pid, "scheduled", s.id);
    const m = RECUR[s.recurrence || "none"].m;
    if (m) await updateDoc(ref, { dueDate: addMonths(s.dueDate, m), lastPaidOn: today() });
    else await updateDoc(ref, { done: true, paidOn: today() });
  });
}

function openNewProp() {
  openModal(`<div class="sheet-head"><h3>Nuovo immobile</h3><button class="x" data-x="close">✕</button></div>
    <label>Nome<input id="nName" placeholder="es. Agriturismo"></label>
    <label>Indirizzo<input id="nAddr"></label>
    <div class="actions"><button class="btn" data-x="save">Crea</button></div>`);
  $("#sheet").onclick = async ev => {
    const b = ev.target.closest("[data-x]"); if (!b) return;
    if (b.dataset.x === "close") return closeModal();
    const name = $("#nName").value.trim(); if (!name) return toast("Inserisci un nome");
    b.disabled = true;
    try { await createProperty(name, $("#nAddr").value.trim()); closeModal(); } catch (e) { toast(e.message); b.disabled = false; }
  };
  $("#sheet").oninput = null;
}

/* ================= RICEVUTE ================= */
const readDataUrl = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
async function fileToDataUrl(file) {
  if (!file) throw new Error("Nessun file");
  if (file.type === "application/pdf") {
    if (file.size > 700 * 1024) throw new Error("PDF troppo grande (max 700 KB): allega una foto");
    return readDataUrl(file);
  }
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Immagine non leggibile")); i.src = URL.createObjectURL(file); });
  for (const [max, q] of [[1600, 0.75], [1200, 0.65], [900, 0.55]]) {
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const d = c.toDataURL("image/jpeg", q);
    if (d.length < 900000) return d;
  }
  throw new Error("Immagine troppo grande");
}
async function viewReceipt(id) {
  const snap = await getDoc(doc(db, "properties", S.pid, "receipts", id));
  if (!snap.exists()) return toast("Allegato non trovato");
  const d = snap.data().data, body = $("#viewerBody");
  if (d.startsWith("data:application/pdf")) {
    const blob = await (await fetch(d)).blob();
    body.innerHTML = `<iframe src="${URL.createObjectURL(blob)}"></iframe>`;
  } else body.innerHTML = `<img src="${d}" alt="Ricevuta">`;
  $("#viewer").classList.remove("hidden");
}
$("#viewerClose").onclick = () => { $("#viewer").classList.add("hidden"); $("#viewerBody").innerHTML = ""; };

/* ================= PDF ================= */
function exportPdf(p, year) {
  if (!window.jspdf) return toast("Libreria PDF non ancora caricata, riprova");
  const { jsPDF } = window.jspdf;
  const d = new jsPDF(); const r = reportData(p, year);
  d.setFontSize(16); d.text(`${p.name} - Report ${year}`, 14, 18);
  d.setFontSize(10); d.setTextColor(110);
  d.text([p.address || "", `Generato il ${fmtDate(today())}`].filter(Boolean), 14, 25);
  d.setTextColor(0);
  let y = 36;
  const tbl = (head, body, opts = {}) => {
    d.autoTable({ startY: y, head: [head], body, theme: "striped", headStyles: { fillColor: [15, 118, 110] }, styles: { fontSize: 9 }, ...opts });
    y = d.lastAutoTable.finalY + 8;
  };
  const net = r.tot.income - r.tot.expense - r.tot.maintenance;
  tbl(["Riepilogo", "Importo"], [["Entrate", fmtPdf(r.tot.income)], ["Spese", fmtPdf(r.tot.expense)], ["Manutenzioni", fmtPdf(r.tot.maintenance)], ["Risultato netto", fmtPdf(net)]], { columnStyles: { 1: { halign: "right" } } });
  const cats = [];
  for (const t of ["income", "expense", "maintenance"]) Object.entries(r.byCat[t]).forEach(([c, v]) => cats.push([TYPES[t].label, c, fmtPdf(v)]));
  if (cats.length) tbl(["Tipo", "Categoria", "Importo"], cats, { columnStyles: { 2: { halign: "right" } } });
  if (r.cap.length) tbl(["Costi iniziali", "Importo"], [...Object.entries(r.capByCat).map(([c, v]) => [c, fmtPdf(v)]), ["Totale", fmtPdf(r.capTot)]], { columnStyles: { 1: { halign: "right" } } });
  tbl(["Socio", "Quota entrate", "Quota spese", "Netto"], p.members.map(m => {
    const x = r.q[m] || { inc: 0, exp: 0 };
    return [fullName(m), fmtPdf(x.inc), fmtPdf(x.exp), fmtPdf(x.inc - x.exp)];
  }), { columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } } });
  const rows = [...r.all].sort((a, b) => a.date.localeCompare(b.date)).map(e => [
    fmtDate(e.date), TYPES[e.type].label, e.category || "", e.description || "", memberName(e.paidBy),
    (e.type === "income" ? "+" : "-") + fmtPdf(e.amount)
  ]);
  if (rows.length) tbl(["Data", "Tipo", "Categoria", "Descrizione", "Chi", "Importo"], rows, { columnStyles: { 5: { halign: "right" } } });
  d.save(`report-${(p.name || "immobile").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${year}.pdf`);
}

/* ================= PWA ================= */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
