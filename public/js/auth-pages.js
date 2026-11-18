const $ = id => document.getElementById(id);
const msg = $("formMsg");
const show = (t, info) => { msg.textContent = t; msg.className = "alert" + (info ? " info" : ""); msg.hidden = false; };
const pw = $("password"), pw2 = $("confirmPassword");

$("eye").addEventListener("click", () => {
  const ver = pw.type === "password";
  pw.type = ver ? "text" : "password"; if (pw2) pw2.type = pw.type;
  $("eye").innerHTML = `<i class="fa-solid ${ver ? "fa-eye-slash" : "fa-eye"}"></i>`;
});

const login = $("loginForm"), reg = $("registerForm");
if ($("forgot")) $("forgot").addEventListener("click", e => { e.preventDefault(); show("A recuperação de senha ainda não está disponível nesta versão.", true); });

if (login) login.addEventListener("submit", async e => {
  e.preventDefault(); msg.hidden = true;
  const b = login.querySelector(".btn.pri"); b.disabled = true;
  const r = await Auth.login($("email").value, pw.value);
  if (r.ok) return (location.href = "/");
  b.disabled = false; show(r.error);
});

if (reg) reg.addEventListener("submit", async e => {
  e.preventDefault(); msg.hidden = true;
  const name = $("name").value.trim();
  if (name.length < 3) return show("Informe seu nome completo.");
  if (pw.value.length < 6) return show("A senha deve ter pelo menos 6 caracteres.");
  if (pw.value !== pw2.value) return show("As senhas não coincidem.");
  const b = reg.querySelector(".btn.pri"); b.disabled = true;
  const r = await Auth.register({ name, email: $("email").value.trim(), password: pw.value });
  if (r.ok) return (location.href = "/");
  b.disabled = false; show(r.error);
});
