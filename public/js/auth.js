// Sessão e chamadas à API. Visitantes recebem um identificador próprio (carrinho e chat funcionam sem login).
const Auth = (() => {
  const TK = "se_token", US = "se_user", VI = "se_visitante";
  const token = () => localStorage.getItem(TK);
  const visitante = () => {
    let v = localStorage.getItem(VI);
    if (!v) { v = ((typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2) + Date.now()).replace(/[^a-zA-Z0-9]/g, "").slice(0, 32); localStorage.setItem(VI, v); }
    return v;
  };
  const clear = () => { localStorage.removeItem(TK); localStorage.removeItem(US); };
  const toFront = p => ({ id: p.id, name: p.nome, email: p.email, phone: p.telefone || "", cep: p.cep || "", city: p.cidade || "", street: p.rua || "", number: p.numero || "", createdAt: p.criadoEm, role: p.papel || "cliente" });
  const cache = u => localStorage.setItem(US, JSON.stringify(u));
  const current = () => { if (!token()) return null; try { return JSON.parse(localStorage.getItem(US)); } catch { return null; } };

  async function call(url, method = "GET", body) {
    try {
      const isForm = typeof FormData !== "undefined" && body instanceof FormData;
      const headers = { "X-Visitante": visitante() };
      if (body && !isForm) headers["Content-Type"] = "application/json";
      if (token()) headers.Authorization = "Bearer " + token();
      const r = await fetch(url, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
      const data = await r.json().catch(() => null);
      if (r.status === 401 && token() && !url.startsWith("/api/auth/")) {
        clear();
        if (!document.body.hasAttribute("data-public")) location.href = "index.html";
      }
      return r.ok ? { ok: true, status: r.status, data } : { ok: false, status: r.status, error: (data && data.message) || "Erro inesperado.", data };
    } catch {
      return { ok: false, status: 0, error: "Não foi possível falar com o servidor. Ele está rodando?" };
    }
  }
  async function entrar(url, body) {
    const r = await call(url, "POST", body);
    if (!r.ok) return r;
    localStorage.setItem(TK, r.data.token);
    cache(toFront(r.data.usuario));
    return { ok: true };
  }
  const register = ({ name, email, password }) => entrar("/api/auth/cadastro", { nome: name, email, senha: password });
  const login = (email, password) => entrar("/api/auth/login", { email, senha: password });
  async function refresh() {
    const r = await call("/api/perfil");
    if (!r.ok) return current();
    const u = toFront(r.data); cache(u); return u;
  }
  async function update(f) {
    const r = await call("/api/perfil", "PUT", { nome: f.name, telefone: f.phone, cep: f.cep, cidade: f.city, rua: f.street, numero: f.number });
    if (r.ok) cache(toFront(r.data));
    return r;
  }
  const changePassword = (atual, nova) => call("/api/perfil/senha", "PUT", { atual, nova });
  const logout = () => { clear(); location.href = "index.html"; };
  async function remove() { const r = await call("/api/perfil", "DELETE"); if (r.ok) logout(); return r; }
  return { current, token, register, login, refresh, update, changePassword, logout, remove, call };
})();

// <body data-private> exige login; <body data-guest> manda quem já entrou para a loja.
(() => {
  const u = Auth.current(), b = document.body;
  if (b.hasAttribute("data-private") && !u) location.replace("index.html");
  if (b.hasAttribute("data-guest") && u) location.replace("/");
})();
