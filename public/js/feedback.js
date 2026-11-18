const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TIPO = { elogio: ["👍", "Elogio"], sugestao: ["💡", "Sugestão"], problema: ["⚠️", "Problema"], duvida: ["❓", "Dúvida"] };
const STATUS = { novo: "Enviado", lido: "Em análise", resolvido: "Respondido" };
const NOTAS = ["", "Muito ruim", "Ruim", "Regular", "Bom", "Excelente"];
let nota = 0;
const user = Auth.current();

function aviso(texto, ok) { const a = $("fbMsg"); a.textContent = texto; a.className = "alert" + (ok ? " info" : ""); a.hidden = false; a.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
function pintar(n) { document.querySelectorAll("#estrelas button").forEach(b => b.classList.toggle("on", +b.dataset.n <= n)); }
$("estrelas").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  nota = nota === +b.dataset.n ? 0 : +b.dataset.n; // clicar de novo na mesma estrela limpa a nota
  pintar(nota); $("notaTxt").textContent = nota ? `${nota} de 5 · ${NOTAS[nota]}` : "Toque nas estrelas para avaliar";
});
$("estrelas").addEventListener("mouseover", e => { const b = e.target.closest("button"); if (b) pintar(+b.dataset.n); });
$("estrelas").addEventListener("mouseleave", () => pintar(nota));
$("mensagem").addEventListener("input", e => { $("cont").textContent = e.target.value.length; });

if (user) { // logado: nome e e-mail vêm da conta
  $("contato").hidden = true; $("como").hidden = false; $("como").textContent = `Enviando como ${user.name} (${user.email}).`;
}

async function meus() {
  const box = $("listaMeus");
  if (!user) { box.innerHTML = `<p class="dica">Para acompanhar as respostas da nossa equipe, <a href="index.html" style="color:var(--brand-d);font-weight:700">entre na sua conta</a>.</p>`; return; }
  const r = await Auth.call("/api/feedback/meus");
  if (!r.ok) { box.innerHTML = `<p class="dica">${esc(r.error)}</p>`; return; }
  box.innerHTML = r.data.length ? r.data.map(f => `<article class="fb-item">
      <div class="fb-top"><span>${TIPO[f.tipo][0]} <b>${TIPO[f.tipo][1]}</b>${f.nota ? ` · <span class="stars-ro">${"★".repeat(f.nota)}${"☆".repeat(5 - f.nota)}</span>` : ""}</span><span class="st st-${f.status}">${STATUS[f.status]}</span></div>
      <p>${esc(f.mensagem)}</p><small class="dica">${new Date(f.criadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</small>
      ${f.resposta ? `<div class="resp"><b>Resposta da equipe</b><p>${esc(f.resposta)}</p></div>` : ""}</article>`).join("")
    : `<p class="dica">Você ainda não enviou nenhum feedback.</p>`;
}

$("fbForm").addEventListener("submit", async e => {
  e.preventDefault(); $("fbMsg").hidden = true;
  const mensagem = $("mensagem").value.trim();
  if (mensagem.length < 5) return aviso("Escreva pelo menos 5 caracteres na mensagem.");
  const b = $("enviar"); b.disabled = true;
  const r = await Auth.call("/api/feedback", "POST", { tipo: document.querySelector('input[name="tipo"]:checked').value, nota: nota || null, mensagem, nome: $("nome").value, email: $("email").value });
  b.disabled = false;
  if (!r.ok) return aviso(r.error);
  $("mensagem").value = ""; $("cont").textContent = "0"; nota = 0; pintar(0); $("notaTxt").textContent = "Toque nas estrelas para avaliar";
  aviso("Obrigado! Recebemos o seu feedback.", true); meus();
});
meus();
