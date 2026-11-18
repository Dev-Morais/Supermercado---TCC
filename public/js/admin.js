const $ = id => document.getElementById(id);
const api = Auth.call;
const money = v => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const norm = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let produtos = [], usuarios = [], eu = null;

function toast(t, tipo) { const d = document.createElement("div"); d.className = "toast " + (tipo || ""); d.textContent = t; $("toasts").replaceChildren(d); setTimeout(() => d.remove(), 3200); }

async function resumo() {
  const r = await api("/api/admin/resumo"); if (!r.ok) return;
  const s = r.data;
  $("avisoSenha").hidden = !s.senhaPadrao;
  $("fbBadge").hidden = !s.feedbacksNovos; $("fbBadge").textContent = s.feedbacksNovos;
  $("stats").innerHTML = [["Contas", s.usuarios, ""], ["Produtos", s.produtos, ""], ["Esgotados", s.esgotados, s.esgotados ? "bad" : ""], ["Estoque baixo", s.baixos, s.baixos ? "warn" : ""], ["Feedback novo", s.feedbacksNovos, s.feedbacksNovos ? "warn" : ""]]
    .map(([n, v, c]) => `<div class="stat ${c}"><b>${v}</b><span>${n}</span></div>`).join("");
}

/* ---------- Produtos ---------- */
function renderProdutos() {
  const t = norm($("busca").value.trim()), f = $("filtro").value;
  const lista = produtos.filter(p => (!t || norm(p.nome).includes(t)) && (f === "todos" || (f === "esgotados" ? p.estoque <= 0 : p.estoque > 0 && p.estoque <= 5)));
  $("qtd").textContent = lista.length + " produto(s)";
  $("tbProdutos").innerHTML = lista.map(p => `<tr class="${p.estoque <= 0 ? "zero" : p.estoque <= 5 ? "low" : ""}" data-id="${p.id}">
    <td>${esc(p.icone)} <b>${esc(p.nome)}</b><br><small style="color:var(--muted)">${esc(p.categoria)}</small></td>
    <td data-label="Preço (R$)"><input class="mini" data-f="preco" type="number" step="0.01" min="0.01" value="${p.preco.toFixed(2)}"></td>
    <td data-label="Estoque"><input class="mini" data-f="estoque" type="number" min="0" step="any" value="${Math.round(p.estoque * 100) / 100}"></td>
    <td class="td-acts" data-label=""><div class="acts"><button class="btn pri" data-a="salvar">Salvar</button><button class="btn danger" data-a="excluir" aria-label="Excluir"><i class="fa-regular fa-trash-can"></i></button></div></td></tr>`).join("")
    || `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:30px">Nenhum produto.</td></tr>`;
}
async function carregarProdutos() { const r = await api("/api/produtos"); if (r.ok) { produtos = r.data; renderProdutos(); } }
$("busca").addEventListener("input", renderProdutos); $("filtro").addEventListener("change", renderProdutos);

$("tbProdutos").addEventListener("click", async e => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  const tr = b.closest("tr"), id = +tr.dataset.id, p = produtos.find(x => x.id === id);
  if (b.dataset.a === "salvar") {
    const r = await api("/api/admin/produtos/" + id, "PUT", { estoque: tr.querySelector('[data-f="estoque"]').value, preco: tr.querySelector('[data-f="preco"]').value });
    if (!r.ok) return toast(r.error, "err");
    produtos[produtos.indexOf(p)] = r.data; toast("Salvo: " + r.data.nome, "ok"); renderProdutos(); resumo();
  } else if (confirm(`Excluir “${p.nome}”? Ele sai da loja e de todos os carrinhos.`)) {
    const r = await api("/api/admin/produtos/" + id, "DELETE");
    if (!r.ok) return toast(r.error, "err");
    produtos = produtos.filter(x => x.id !== id); toast("Produto excluído", "ok"); renderProdutos(); resumo();
  }
});

$("novoForm").addEventListener("submit", async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target)); fd.granel = !!fd.granel;
  const r = await api("/api/admin/produtos", "POST", fd);
  if (!r.ok) return toast(r.error, "err");
  e.target.reset(); toast("Produto cadastrado: " + r.data.nome, "ok"); carregarProdutos(); resumo();
});

/* ---------- Contas ---------- */
function renderUsuarios() {
  $("tbUsuarios").innerHTML = usuarios.map(u => `<tr data-id="${u.id}">
    <td><b>${esc(u.nome)}</b>${u.id === eu.id ? ' <span class="badge-admin">você</span>' : ""}</td><td data-label="E-mail">${esc(u.email)}</td>
    <td data-label="Papel"><select class="mini" data-a="papel"><option value="cliente" ${u.papel === "cliente" ? "selected" : ""}>Cliente</option><option value="admin" ${u.papel === "admin" ? "selected" : ""}>Administrador</option></select></td>
    <td data-label="Desde">${new Date(u.criadoEm).toLocaleDateString("pt-BR")}</td>
    <td class="td-acts" data-label=""><div class="acts"><button class="btn" data-a="senha">Redefinir senha</button>${u.id === eu.id ? "" : '<button class="btn danger" data-a="excluir">Excluir</button>'}</div></td></tr>`).join("");
}
async function carregarUsuarios() { const r = await api("/api/admin/usuarios"); if (r.ok) { usuarios = r.data; renderUsuarios(); } }
$("tbUsuarios").addEventListener("change", async e => {
  if (e.target.dataset.a !== "papel") return;
  const id = +e.target.closest("tr").dataset.id;
  const r = await api(`/api/admin/usuarios/${id}/papel`, "PUT", { papel: e.target.value });
  if (!r.ok) toast(r.error, "err"); else toast("Papel atualizado", "ok");
  carregarUsuarios(); resumo();
});
$("tbUsuarios").addEventListener("click", async e => {
  const b = e.target.closest("button[data-a]"); if (!b) return;
  const id = +b.closest("tr").dataset.id, u = usuarios.find(x => x.id === id);
  if (b.dataset.a === "senha") {
    const nova = prompt(`Nova senha para ${u.nome} (mínimo 6 caracteres):`); if (!nova) return;
    const r = await api(`/api/admin/usuarios/${id}/senha`, "PUT", { nova }); toast(r.ok ? "Senha redefinida" : r.error, r.ok ? "ok" : "err");
  } else if (b.dataset.a === "excluir" && confirm(`Excluir a conta de ${u.nome} (${u.email})? Essa ação não pode ser desfeita.`)) {
    const r = await api("/api/admin/usuarios/" + id, "DELETE");
    if (!r.ok) return toast(r.error, "err");
    toast("Conta excluída", "ok"); carregarUsuarios(); resumo();
  }
});

document.querySelector(".tabs").addEventListener("click", e => {
  const b = e.target.closest("[data-tab]"); if (!b) return;
  document.querySelectorAll(".tabs .chip").forEach(c => c.classList.toggle("on", c === b));
  $("aba-produtos").hidden = b.dataset.tab !== "produtos"; $("aba-usuarios").hidden = b.dataset.tab !== "usuarios";
  $("aba-feedback").hidden = b.dataset.tab !== "feedback"; if (b.dataset.tab === "feedback") carregarFb();
});

/* ---------- Feedback ---------- */
const TIPO_FB = { elogio: ["👍", "Elogio"], sugestao: ["💡", "Sugestão"], problema: ["⚠️", "Problema"], duvida: ["❓", "Dúvida"] };
const STATUS_TXT = { novo: "Novo", lido: "Em análise", resolvido: "Respondido" };
const estrelas = n => (n ? "★".repeat(n) + "☆".repeat(5 - n) : "sem nota");
async function carregarFb() {
  const q = new URLSearchParams(); if ($("fbStatus").value) q.set("status", $("fbStatus").value); if ($("fbTipo").value) q.set("tipo", $("fbTipo").value);
  const r = await api("/api/admin/feedback?" + q); if (!r.ok) return toast(r.error, "err");
  const { itens, resumo: rs } = r.data;
  $("fbResumo").textContent = `${rs.total} no total · ${rs.novos} novo(s) · nota média ${rs.media == null ? "—" : String(rs.media).replace(".", ",")}`;
  $("listaFb").innerHTML = itens.map(f => `<article class="fb-card" data-id="${f.id}">
    <header><span class="fb-tipo">${TIPO_FB[f.tipo][0]} ${TIPO_FB[f.tipo][1]}</span><span class="stars-ro" title="Nota">${estrelas(f.nota)}</span><span class="st st-${f.status}">${STATUS_TXT[f.status]}</span></header>
    <p class="fb-msg">${esc(f.mensagem)}</p>
    <small class="fb-quem">${esc(f.nome || "Visitante")}${f.email ? " · " + esc(f.email) : ""} · ${new Date(f.criadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</small>
    <textarea class="f-input" rows="2" maxlength="1000" placeholder="Escreva uma resposta para o cliente...">${esc(f.resposta)}</textarea>
    <div class="acts"><select class="mini" data-a="status">${Object.entries(STATUS_TXT).map(([v, t]) => `<option value="${v}" ${f.status === v ? "selected" : ""}>${t}</option>`).join("")}</select>
      <button class="btn pri" data-a="responder">Salvar resposta</button><button class="btn danger" data-a="excluir" aria-label="Excluir"><i class="fa-regular fa-trash-can"></i></button></div></article>`).join("")
    || `<p class="vazio-fb">Nenhum feedback por aqui.</p>`;
}
$("fbStatus").addEventListener("change", carregarFb); $("fbTipo").addEventListener("change", carregarFb);
$("listaFb").addEventListener("change", async e => {
  if (e.target.dataset.a !== "status") return;
  const r = await api("/api/admin/feedback/" + e.target.closest(".fb-card").dataset.id, "PUT", { status: e.target.value });
  toast(r.ok ? "Status atualizado" : r.error, r.ok ? "ok" : "err"); carregarFb(); resumo();
});
$("listaFb").addEventListener("click", async e => {
  const b = e.target.closest("button[data-a]"); if (!b) return;
  const card = b.closest(".fb-card"), id = card.dataset.id;
  if (b.dataset.a === "responder") {
    const resposta = card.querySelector("textarea").value.trim(); if (!resposta) return toast("Escreva a resposta antes de salvar", "err");
    const r = await api("/api/admin/feedback/" + id, "PUT", { resposta }); toast(r.ok ? "Resposta salva" : r.error, r.ok ? "ok" : "err");
  } else if (confirm("Excluir este feedback?")) {
    const r = await api("/api/admin/feedback/" + id, "DELETE"); toast(r.ok ? "Feedback excluído" : r.error, r.ok ? "ok" : "err");
  } else return;
  carregarFb(); resumo();
});

(async () => {
  eu = await Auth.refresh();
  if (!eu || eu.role !== "admin") return location.replace("/");
  await Promise.all([resumo(), carregarProdutos(), carregarUsuarios()]);
})();
