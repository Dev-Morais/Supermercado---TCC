const $ = id => document.getElementById(id);
const money = v => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const norm = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = Auth.call;
const CATS = [["all", "Todos", "fa-border-all"], ["hortifruti", "Hortifrúti", "fa-apple-whole"], ["padaria", "Padaria", "fa-bread-slice"],
  ["carnes", "Carnes", "fa-drumstick-bite"], ["laticinios", "Laticínios", "fa-cheese"], ["bebidas", "Bebidas", "fa-wine-bottle"], ["mercearia", "Mercearia", "fa-jar"], ["fav", "Favoritos", "fa-heart"]];
let produtos = [], carrinho = [], cat = "all", termo = "";

function toast(texto, tipo) {
  const t = document.createElement("div");
  t.className = "toast " + (tipo || ""); t.textContent = texto;
  $("toasts").replaceChildren(t); setTimeout(() => t.remove(), 3200);
}

/* ---------- Favoritos e quantidades ---------- */
let favs; try { favs = new Set(JSON.parse(localStorage.getItem("se_favs") || "[]")); } catch { favs = new Set(); }
const salvarFavs = () => { try { localStorage.setItem("se_favs", JSON.stringify([...favs])); } catch {} };
const fmtN = (v, d) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtQtd = (granel, q) => granel ? fmtN(q, 3) + " KG" : String(q);          // 1,000 KG  |  2
const passo = granel => (granel ? 0.1 : 1);                                       // por kg: de 100 em 100 g
const arred = v => Math.round(v * 100) / 100;
const noCarrinho = id => { const i = carrinho.find(x => x.produtoId === id); return i ? i.quantidade : 0; };
const pct = p => (p.precoAntigo > p.preco ? (1 - p.preco / p.precoAntigo) * 100 : 0);

/* ---------- Vitrine ---------- */
function renderChips() {
  const n = id => id === "all" ? produtos.length : id === "fav" ? produtos.filter(p => favs.has(p.id)).length : produtos.filter(p => p.categoria === id).length;
  $("chips").innerHTML = CATS.map(([id, nome, ic]) =>
    `<button class="chip ${id === cat ? "on" : ""}" data-cat="${id}"><i class="fa-${id === "fav" ? "regular" : "solid"} ${ic}"></i>${nome}<small>${n(id)}</small></button>`).join("");
}
// Controle do card: botão "Adicionar" ou seletor − quantidade + (igual ao carrinho)
function controle(p) {
  if (p.estoque <= 0) return `<button class="btn add-off" disabled>Indisponível</button>`;
  const q = noCarrinho(p.id);
  if (!q) return `<button class="btn add-btn" data-add="${p.id}">Adicionar ao carrinho</button>`;
  return `<div class="stepper"><button data-step="-1" data-id="${p.id}" aria-label="Diminuir">−</button><span>${fmtQtd(p.granel, q)}</span><button data-step="1" data-id="${p.id}" aria-label="Aumentar">+</button></div>`;
}
function card(p) {
  const esg = p.estoque <= 0, baixo = !esg && p.estoque <= 5, d = pct(p), fav = favs.has(p.id);
  const lim = p.granel ? `Limitado a ${Math.floor(p.estoque)} kg` : `Limitado a ${Math.min(Math.floor(p.estoque), 99)} unidades`;
  return `<article class="card ${esg ? "off" : ""}" data-id="${p.id}">
    ${d > 0 ? `<span class="badge-desc">${fmtN(d, 2)}%<span class="dtxt"> DESCONTO</span></span>` : ""}
    <button class="fav ${fav ? "on" : ""}" data-fav="${p.id}" aria-label="Favoritar"><i class="fa-${fav ? "solid" : "regular"} fa-heart"></i></button>
    <div class="thumb">${esc(p.icone)}</div>
    ${esg ? `<span class="tag out">Esgotado</span>` : baixo ? `<span class="tag low">Restam ${fmtN(p.estoque, p.granel ? 1 : 0)}${p.granel ? " kg" : ""}</span>` : `<span class="info-pill">${p.granel ? "Preço por kg" : esc(p.tamanho || "Unidade")}</span>`}
    <h3>${esc(p.nome)}</h3>
    <div class="prices">${p.precoAntigo > p.preco ? `<s>${money(p.precoAntigo)}</s>` : ""}<b><i>R$</i>${fmtN(p.preco, 2)}</b></div>
    <div class="ctl">${controle(p)}</div>
    <small class="lim">* ${lim}</small>${p.granel ? `<small class="lim"><b>${money(p.preco)}</b>/Kg</small>` : ""}</article>`;
}
function renderGrade() {
  const lista = produtos.filter(p => (cat === "all" || (cat === "fav" ? favs.has(p.id) : p.categoria === cat)) && (!termo || norm(p.nome).includes(termo)));
  $("grade").innerHTML = lista.length ? lista.map(card).join("") : `<p class="vazio">${cat === "fav" && !termo ? "Toque no coração de um produto para guardá-lo aqui." : "Nenhum produto encontrado."}</p>`;
  const nomeCat = (CATS.find(c => c[0] === cat) || [])[1];
  $("titulo").textContent = termo ? `Resultados para “${$("busca").value.trim()}”` : nomeCat === "Todos" ? "Todos os produtos" : nomeCat;
  $("contagem").textContent = lista.length + " produto(s)";
  renderChips();
}
function atualizarCards(antigo, novo) { // atualiza só os cards cuja quantidade mudou
  const mapa = l => new Map(l.map(i => [i.produtoId, i.quantidade])), a = mapa(antigo), b = mapa(novo);
  new Set([...a.keys(), ...b.keys()]).forEach(id => {
    if (a.get(id) === b.get(id)) return;
    const p = produtos.find(x => x.id === id), el = document.querySelector(`.card[data-id="${id}"] .ctl`);
    if (p && el) el.innerHTML = controle(p);
  });
}
// Cliques rápidos em − / +: cada clique parte da quantidade que o usuário já pediu e os envios saem em ordem
const alvo = new Map(), cadeia = new Map();
const qtdAtual = id => (alvo.has(id) ? alvo.get(id) : noCarrinho(id));
function mudarQtd(id, nova) {
  alvo.set(id, nova);
  const p = (cadeia.get(id) || Promise.resolve()).then(async () => {
    const r = await mudar(await api("/api/carrinho/" + id, "PUT", { quantidade: nova }));
    if (cadeia.get(id) === p) { alvo.delete(id); cadeia.delete(id); }
    return r;
  });
  cadeia.set(id, p); return p;
}
function setCarrinho(lista) { const antigo = carrinho; carrinho = lista; renderCarrinho(); atualizarCards(antigo, carrinho); }

$("chips").addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (b) { cat = b.dataset.cat; renderGrade(); } });
$("busca").addEventListener("input", e => { termo = norm(e.target.value.trim()); renderGrade(); });
$("grade").addEventListener("click", async e => {
  const a = e.target.closest("[data-add]"); if (a) return adicionar(+a.dataset.add);
  const s = e.target.closest("[data-step]");
  if (s) { const id = +s.dataset.id, p = produtos.find(x => x.id === id); return mudarQtd(id, arred(qtdAtual(id) + +s.dataset.step * passo(p.granel))); }
  const f = e.target.closest("[data-fav]");
  if (f) {
    const id = +f.dataset.fav; if (favs.has(id)) favs.delete(id); else favs.add(id); salvarFavs();
    if (cat === "fav") renderGrade(); else { f.classList.toggle("on", favs.has(id)); f.innerHTML = `<i class="fa-${favs.has(id) ? "solid" : "regular"} fa-heart"></i>`; renderChips(); }
  }
});

/* ---------- Carrinho ---------- */
const problema = i => i.estoque <= 0 ? "Esgotado" : i.quantidade > i.estoque ? `Só ${fmtN(i.estoque, i.granel ? 1 : 0)}${i.granel ? " kg" : ""} em estoque` : "";
function renderCarrinho() {
  $("badge").textContent = carrinho.length;
  $("total").textContent = money(carrinho.reduce((a, i) => a + i.preco * i.quantidade, 0));
  $("aviso").hidden = !carrinho.some(problema);
  $("itens").innerHTML = carrinho.length ? carrinho.map(i => `<div class="item">
      <div class="ico">${esc(i.icone)}</div>
      <div class="info"><b>${esc(i.nome)}</b><small>${money(i.preco)}${i.granel ? "/kg" : ""} · ${money(i.preco * i.quantidade)}</small>${problema(i) ? `<span class="warn">⚠ ${problema(i)}</span>` : ""}</div>
      <div class="qty"><button data-a="menos" data-id="${i.produtoId}" aria-label="Diminuir">−</button><span>${fmtQtd(i.granel, i.quantidade)}</span><button data-a="mais" data-id="${i.produtoId}" aria-label="Aumentar">+</button></div>
      <button class="icon-btn" data-a="rem" data-id="${i.produtoId}" aria-label="Remover"><i class="fa-regular fa-trash-can"></i></button></div>`).join("")
    : `<div class="vazio-c"><i class="fa-solid fa-basket-shopping"></i><p>Seu carrinho está vazio.</p></div>`;
}
async function mudar(r) { if (r.ok) { setCarrinho(r.data); return true; } toast(r.error, "err"); return false; }
async function adicionar(id) { if (await mudar(await api("/api/carrinho", "POST", { produtoId: id, quantidade: 1 }))) toast("Adicionado ao carrinho", "ok"); }
$("itens").addEventListener("click", async e => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  const id = +b.dataset.id, it = carrinho.find(i => i.produtoId === id); if (!it) return;
  const q = b.dataset.a === "mais" ? arred(qtdAtual(id) + passo(it.granel)) : b.dataset.a === "menos" ? arred(qtdAtual(id) - passo(it.granel)) : 0;
  mudarQtd(id, q);
});
const gaveta = on => { $("gaveta").classList.toggle("on", on); $("scrim").classList.toggle("on", on); };
$("abrirCarrinho").onclick = () => gaveta(true);
$("fecharCarrinho").onclick = $("scrim").onclick = () => gaveta(false);
$("resolver").onclick = () => { gaveta(false); abrirChat(); conferir(); };

$("finalizar").onclick = async () => {
  if (!carrinho.length) return toast("Seu carrinho está vazio", "err");
  if (!Auth.current()) { toast("Entre na sua conta para finalizar", "err"); return setTimeout(() => (location.href = "index.html"), 900); }
  const r = await api("/api/pedido", "POST");
  if (r.ok) {
    setCarrinho([]); carregarProdutos();
    $("itens").innerHTML = `<div class="sucesso"><i class="fa-solid fa-circle-check"></i><h4>Pedido ${esc(r.data.numero)} confirmado!</h4><p>${r.data.itens} item(ns) · ${money(r.data.total)}</p><button class="btn pri" id="seguir">Continuar comprando</button></div>`;
    $("seguir").onclick = () => { gaveta(false); renderCarrinho(); };
  } else if (r.status === 409) { toast(r.error, "err"); gaveta(false); abrirChat(); conferir(); }
  else toast(r.error, "err");
};

/* ---------- Assistente ---------- */
const msgs = $("msgs");
function bolha(quem, texto, extra) {
  const d = document.createElement("div"); d.className = "msg " + quem;
  const b = document.createElement("div"); b.className = "bolha"; b.textContent = texto; d.append(b);
  if (extra) b.after(extra);
  msgs.append(d); msgs.scrollTop = msgs.scrollHeight; return d;
}
function digitando(on) {
  const ex = msgs.querySelector(".typing"); if (ex) ex.remove();
  if (!on) return;
  const d = document.createElement("div"); d.className = "msg bot typing"; d.innerHTML = '<div class="bolha"><i></i><i></i><i></i></div>';
  msgs.append(d); msgs.scrollTop = msgs.scrollHeight;
}
function renderPergunta(p) {
  const box = document.createElement("div"); box.className = "opcoes";
  const travar = el => { box.classList.add("done"); box.querySelectorAll("button").forEach(b => (b.disabled = true)); el.classList.add("sel"); };
  p.opcoes.forEach(o => {
    const b = document.createElement("button"); b.type = "button"; b.className = "op";
    b.innerHTML = `${o.icone ? `<span class="op-i">${esc(o.icone)}</span>` : ""}<span class="op-t"><b>${esc(o.rotulo)}</b>${o.detalhe ? `<small>${esc(o.detalhe)}</small>` : ""}</span>`;
    b.onclick = () => { travar(b); bolha("user", o.rotulo); enviar("/api/chat/escolha", o.peso != null ? { peso: o.peso } : o.valor != null ? { valor: o.valor } : { produtoId: o.id }); };
    box.append(b);
  });
  if (p.acoes && p.acoes.length) {
    const row = document.createElement("div"); row.className = "acoes";
    p.acoes.forEach(a => {
      const b = document.createElement("button"); b.type = "button"; b.className = "pill" + (a.acao === "remover" ? " danger" : ""); b.textContent = a.rotulo;
      b.onclick = () => { travar(b); bolha("user", a.rotulo); enviar("/api/chat/escolha", { acao: a.acao }); };
      row.append(b);
    });
    box.append(row);
  }
  bolha("bot", p.texto, box);
}
function mostrar(res) {
  (res.mensagens || []).forEach(m => bolha("bot", m));
  if (res.pergunta) renderPergunta(res.pergunta);
  else if (res.concluido) {
    const row = document.createElement("div"); row.className = "acoes"; row.style.marginTop = "6px";
    const b = document.createElement("button"); b.className = "pill"; b.innerHTML = "🛒 Ver carrinho"; b.onclick = () => gaveta(true);
    row.append(b); msgs.lastElementChild.append(row);
  }
}
async function enviar(url, body) {
  digitando(true);
  const r = await api(url, "POST", body);
  digitando(false);
  if (r.ok) mostrar(r.data); else bolha("bot", r.error);
  const c = await api("/api/carrinho"); if (c.ok) { setCarrinho(c.data); }
  return r;
}
function conferir() { bolha("user", "Conferir estoque do carrinho"); enviar("/api/chat/verificar", {}); }

let saudou = false;
function abrirChat() {
  $("chat").classList.add("open"); $("fab").hidden = true;
  if (!saudou) { saudou = true; bolha("bot", "Olá! 👋 Mande sua lista (ex.: “leite, arroz 5kg, 2 refri cola”) ou uma foto dela. Eu pergunto o tipo, a marca e o tamanho quando precisar, confiro o estoque e sugiro trocas."); }
  setTimeout(() => $("texto").focus(), 50);
}
$("fab").onclick = $("heroChat").onclick = abrirChat;
$("fecharChat").onclick = () => { $("chat").classList.remove("open"); $("fab").hidden = false; };

$("chatForm").addEventListener("submit", e => {
  e.preventDefault();
  const t = $("texto").value.trim(); if (!t) return;
  bolha("user", t); $("texto").value = ""; $("texto").style.height = "auto";
  enviar("/api/chat/mensagem", { texto: t });
});
$("texto").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("chatForm").requestSubmit(); } });
$("texto").addEventListener("input", e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 110) + "px"; });

document.querySelector(".quick").addEventListener("click", e => {
  const b = e.target.closest("[data-q]"); if (!b) return;
  if (b.dataset.q === "foto") $("arquivo").click();
  else if (b.dataset.q === "estoque") conferir();
  else if (b.dataset.q === "feedback") location.href = "feedback.html";
  else { const t = "2 pt de macarrão, 1 kg de tomate, 2 l de leite, café"; bolha("user", t); enviar("/api/chat/mensagem", { texto: t }); }
});
$("anexo").onclick = () => $("arquivo").click();
$("arquivo").addEventListener("change", async () => {
  const f = $("arquivo").files[0]; $("arquivo").value = ""; if (!f) return;
  bolha("user", "📷 Foto da lista"); digitando(true);
  const fd = new FormData(); fd.append("arquivo", f);
  let r = await api("/api/chat/imagem", "POST", fd);
  if (!r.ok && r.status === 503) { // OCR do servidor indisponível: tenta no navegador
    try {
      if (!window.Tesseract) await new Promise((ok, err) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"; s.onload = ok; s.onerror = err; document.head.append(s); });
      const o = await Promise.race([Tesseract.recognize(f, "por"), new Promise((_, no) => setTimeout(no, 60000))]);
      const t = o.data.text.split("\n").map(s => s.trim()).filter(s => s.length > 1).join("\n");
      digitando(false); if (!t) return bolha("bot", "Não consegui ler texto nessa imagem.");
      return enviar("/api/chat/mensagem", { texto: t });
    } catch { digitando(false); return bolha("bot", "Não consegui ler a imagem. Tente uma foto mais nítida ou digite a lista."); }
  }
  digitando(false);
  if (r.ok) mostrar(r.data); else bolha("bot", r.error);
  const c = await api("/api/carrinho"); if (c.ok) { setCarrinho(c.data); }
});

/* ---------- Início ---------- */
async function carregarProdutos() { const p = await api("/api/produtos"); if (p.ok) { produtos = p.data; renderGrade(); } }
function conta() { const u = Auth.current(); $("adminBtn").hidden = !(u && u.role === "admin"); $("contaBtn").href = u ? "profile.html" : "index.html"; $("contaBtn").lastElementChild.textContent = u ? u.name.split(" ")[0] : "Entrar"; }
(async () => {
  renderCarrinho();
  if (Auth.token()) await Auth.refresh();
  conta();
  const [, c] = await Promise.all([carregarProdutos(), api("/api/carrinho")]);
  if (c.ok) { setCarrinho(c.data); }
})();
