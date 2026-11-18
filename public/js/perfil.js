const $ = id => document.getElementById(id);
const nota = (id, t, ok) => { const n = $(id); n.textContent = t; n.className = "note " + (ok ? "ok" : "err"); };
const maskTel = v => v.replace(/\D/g, "").slice(0, 11).replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
const maskCep = v => v.replace(/\D/g, "").slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");
const iniciais = n => n.trim().split(/\s+/).map(p => p[0]).slice(0, 2).join("").toUpperCase();

(async () => {
  const u = await Auth.refresh();
  if (!u) return;
  $("avatar").textContent = iniciais(u.name); $("pNome").textContent = u.name; $("pEmail").textContent = u.email;
  $("pDesde").textContent = "Cliente desde " + new Date(u.createdAt).toLocaleDateString("pt-BR");
  ["name", "email", "phone", "cep", "city", "street", "number"].forEach(k => $(k).value = u[k] || "");
  $("phone").addEventListener("input", e => e.target.value = maskTel(e.target.value));
  $("cep").addEventListener("input", e => e.target.value = maskCep(e.target.value));

  $("dadosForm").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("name").value.trim();
    if (name.length < 3) return nota("dadosNote", "Informe seu nome completo.", false);
    const r = await Auth.update({ name, phone: $("phone").value, cep: $("cep").value, city: $("city").value, street: $("street").value, number: $("number").value });
    if (!r.ok) return nota("dadosNote", r.error, false);
    $("pNome").textContent = name; $("avatar").textContent = iniciais(name);
    nota("dadosNote", "Dados salvos com sucesso.", true);
  });
  $("senhaForm").addEventListener("submit", async e => {
    e.preventDefault();
    if ($("newPass").value.length < 6) return nota("senhaNote", "A nova senha deve ter pelo menos 6 caracteres.", false);
    if ($("newPass").value !== $("newPass2").value) return nota("senhaNote", "As senhas não coincidem.", false);
    const r = await Auth.changePassword($("oldPass").value, $("newPass").value);
    if (!r.ok) return nota("senhaNote", r.error, false);
    e.target.reset(); nota("senhaNote", "Senha atualizada.", true);
  });
  $("sair").addEventListener("click", Auth.logout);
  $("excluir").addEventListener("click", async () => {
    if (!confirm("Tem certeza? Esta ação não pode ser desfeita.")) return;
    const r = await Auth.remove(); if (!r.ok) nota("senhaNote", r.error, false);
  });
})();
