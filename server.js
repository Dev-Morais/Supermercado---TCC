const db = require("./db"); // também carrega o arquivo .env
const express = require("express"), multer = require("multer"), crypto = require("crypto");
const fs = require("fs"), path = require("path");
const K = require("./carrinho"), chat = require("./chat"), M = require("./matcher");
const { erro } = K;

const PORT = process.env.PORT || 8080;
const app = express();
app.use(express.json());
const a = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); // repassa erros das rotas async

/* ---------- Segurança: senha (scrypt) e token assinado (HMAC-SHA256, 7 dias) ---------- */
const SECRET = process.env.SECRET || (() => {
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
  const f = path.join(__dirname, "data", "secret.txt");
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString("hex"));
  return fs.readFileSync(f, "utf8").trim();
})();
const sig = b => crypto.createHmac("sha256", SECRET).update(b).digest("base64url");
const gerar = uid => { const b = uid + "." + (Date.now() + 7 * 864e5); return b + "." + sig(b); };
function validar(t) {
  const p = t.split(".");
  if (p.length !== 3) return null;
  const x = Buffer.from(sig(p[0] + "." + p[1])), c = Buffer.from(p[2]);
  if (x.length !== c.length || !crypto.timingSafeEqual(x, c) || +p[1] < Date.now()) return null;
  return +p[0];
}
const hashSenha = s => { const salt = crypto.randomBytes(16).toString("hex"); return salt + ":" + crypto.scryptSync(s, salt, 64).toString("hex"); };
function confere(s, h) {
  const [salt, hex] = h.split(":"), x = Buffer.from(hex, "hex"), b = crypto.scryptSync(s, salt, 64);
  return x.length === b.length && crypto.timingSafeEqual(x, b);
}

const usuario = uid => db.one("SELECT * FROM usuario WHERE id = $1", [uid]);

// Identifica quem chama: usuário logado (token) ou visitante (cabeçalho X-Visitante).
// Carrinho, chat e envio de feedback funcionam para os dois; perfil, pedido e "meus feedbacks" exigem login.
app.use("/api", a(async (req, res, next) => {
  const h = req.get("Authorization") || "";
  const uid = h.startsWith("Bearer ") ? validar(h.slice(7)) : null;
  req.uid = uid && (await db.one("SELECT 1 AS ok FROM usuario WHERE id = $1", [uid])) ? uid : null;
  req.visitante = (req.get("X-Visitante") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  req.dono = req.uid ? "u:" + req.uid : req.visitante ? "v:" + req.visitante : null;
  if (req.path.startsWith("/auth/") || (req.path === "/produtos" && req.method === "GET")) return next();
  if (req.path.startsWith("/admin")) { // área do administrador
    if (!req.uid) return res.status(401).json({ message: "Sessão expirada. Faça login novamente." });
    if ((await usuario(req.uid)).papel !== "admin") return res.status(403).json({ message: "Acesso restrito a administradores." });
    return next();
  }
  if (req.path.startsWith("/carrinho") || req.path.startsWith("/chat/") || (req.path === "/feedback" && req.method === "POST")) {
    return req.dono ? next() : res.status(401).json({ message: "Não foi possível identificar a sessão." });
  }
  if (!req.uid) return res.status(401).json({ message: "Sessão expirada. Faça login novamente." });
  next();
}));

/* ---------- Conta e perfil ---------- */
const perfil = u => ({ id: u.id, nome: u.nome, email: u.email, telefone: u.telefone, cep: u.cep, cidade: u.cidade, rua: u.rua, numero: u.numero, criadoEm: u.criado_em, papel: u.papel });
async function sessao(req, u) {
  if (req.visitante) await K.migrar("v:" + req.visitante, "u:" + u.id); // leva o carrinho de visitante para a conta
  return { token: gerar(u.id), usuario: perfil(u) };
}

app.post("/api/auth/cadastro", a(async (req, res) => {
  const { nome, email, senha } = req.body || {};
  if (!nome || nome.trim().length < 3) throw erro(400, "Informe seu nome completo.");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) throw erro(400, "E-mail inválido.");
  if (!senha || senha.length < 6) throw erro(400, "A senha deve ter pelo menos 6 caracteres.");
  const em = email.trim().toLowerCase();
  if (await db.one("SELECT 1 AS ok FROM usuario WHERE email = $1", [em])) throw erro(409, "Este e-mail já está cadastrado. Faça login.");
  const u = await db.one("INSERT INTO usuario (nome, email, senha_hash, criado_em) VALUES ($1,$2,$3,$4) RETURNING *", [nome.trim(), em, hashSenha(senha), Date.now()]);
  res.json(await sessao(req, u));
}));

app.post("/api/auth/login", a(async (req, res) => {
  const { email, senha } = req.body || {};
  const u = email ? await db.one("SELECT * FROM usuario WHERE email = $1", [email.trim().toLowerCase()]) : null;
  if (!u || !senha || !confere(senha, u.senha_hash)) throw erro(401, "E-mail ou senha incorretos.");
  res.json(await sessao(req, u));
}));

app.get("/api/perfil", a(async (req, res) => res.json(perfil(await usuario(req.uid)))));

app.put("/api/perfil", a(async (req, res) => {
  const b = req.body || {}, t = v => (v == null ? "" : String(v).trim());
  if (!b.nome || b.nome.trim().length < 3) throw erro(400, "Informe seu nome completo.");
  const u = await db.one("UPDATE usuario SET nome=$1, telefone=$2, cep=$3, cidade=$4, rua=$5, numero=$6 WHERE id=$7 RETURNING *",
    [b.nome.trim(), t(b.telefone), t(b.cep), t(b.cidade), t(b.rua), t(b.numero), req.uid]);
  res.json(perfil(u));
}));

app.put("/api/perfil/senha", a(async (req, res) => {
  const { atual, nova } = req.body || {}, u = await usuario(req.uid);
  if (!atual || !confere(atual, u.senha_hash)) throw erro(400, "Senha atual incorreta.");
  if (!nova || nova.length < 6) throw erro(400, "A nova senha deve ter pelo menos 6 caracteres.");
  await db.query("UPDATE usuario SET senha_hash = $1 WHERE id = $2", [hashSenha(nova), req.uid]);
  res.status(204).end();
}));

const admins = async () => (await db.one("SELECT COUNT(*) AS c FROM usuario WHERE papel = 'admin'")).c;

app.delete("/api/perfil", a(async (req, res) => {
  if ((await usuario(req.uid)).papel === "admin" && (await admins()) <= 1) throw erro(400, "Você é o único administrador. Promova outra conta antes de excluir esta.");
  await K.limpar(req.dono);
  await db.query("DELETE FROM usuario WHERE id = $1", [req.uid]);
  res.status(204).end();
}));

/* ---------- Catálogo, carrinho e pedido ---------- */
app.get("/api/produtos", a(async (req, res) => res.json((await db.all("SELECT * FROM produto ORDER BY id")).map(K.dto))));

app.get("/api/carrinho", a(async (req, res) => res.json(await K.listar(req.dono))));
app.post("/api/carrinho", a(async (req, res) => {
  const { produtoId, quantidade } = req.body || {};
  res.json(await K.adicionar(req.dono, Number(produtoId), Math.max(1, Number(quantidade) || 1)));
}));
app.put("/api/carrinho/:id", a(async (req, res) => res.json(await K.definir(req.dono, Number(req.params.id), (req.body || {}).quantidade))));
app.delete("/api/carrinho", a(async (req, res) => res.json(await K.limpar(req.dono))));

app.post("/api/pedido", a(async (req, res) => {
  const r = await K.finalizar(req.dono);
  if (r.problemas) return res.status(409).json({ message: "Alguns itens estão sem estoque suficiente.", problemas: r.problemas });
  res.json(r);
}));

/* ---------- Feedback (clientes e visitantes enviam; o administrador responde) ---------- */
const TIPOS_FB = ["elogio", "sugestao", "problema", "duvida"], STATUS_FB = ["novo", "lido", "resolvido"];
const fbDto = f => ({ id: f.id, tipo: f.tipo, nota: f.nota, mensagem: f.mensagem, nome: f.nome, email: f.email, status: f.status, resposta: f.resposta, criadoEm: f.criado_em, respondidoEm: f.respondido_em });
const envios = new Map(); // limite simples contra spam: 5 envios a cada 10 minutos por pessoa

app.post("/api/feedback", a(async (req, res) => {
  const b = req.body || {}, t = v => (v == null ? "" : String(v).trim());
  const tipo = t(b.tipo), mensagem = t(b.mensagem);
  if (!TIPOS_FB.includes(tipo)) throw erro(400, "Escolha o tipo do feedback.");
  if (mensagem.length < 5) throw erro(400, "Escreva pelo menos 5 caracteres na mensagem.");
  if (mensagem.length > 1000) throw erro(400, "A mensagem pode ter no máximo 1000 caracteres.");
  let nota = null;
  if (b.nota != null && b.nota !== "") { nota = Number(b.nota); if (!Number.isInteger(nota) || nota < 1 || nota > 5) throw erro(400, "A nota deve ser de 1 a 5."); }
  let nome = t(b.nome).slice(0, 80), email = t(b.email).slice(0, 120).toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw erro(400, "E-mail inválido.");
  if (req.uid) { const u = await usuario(req.uid); nome = u.nome; email = u.email; }
  const agora = Date.now(), recentes = (envios.get(req.dono) || []).filter(x => agora - x < 600000);
  if (recentes.length >= 5) throw erro(429, "Você enviou muitos feedbacks em pouco tempo. Tente novamente em alguns minutos.");
  envios.set(req.dono, [...recentes, agora]);
  const f = await db.one("INSERT INTO feedback (usuario_id, nome, email, tipo, nota, mensagem, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [req.uid, nome, email, tipo, nota, mensagem, agora]);
  res.status(201).json({ id: f.id });
}));

app.get("/api/feedback/meus", a(async (req, res) =>
  res.json((await db.all("SELECT * FROM feedback WHERE usuario_id = $1 ORDER BY criado_em DESC LIMIT 50", [req.uid])).map(fbDto))));

/* ---------- Administração (somente papel "admin") ---------- */
const adm = express.Router();
const CATEGORIAS = ["hortifruti", "padaria", "carnes", "laticinios", "bebidas", "mercearia"];
const decimal = (v, min, campo) => { const n = Number(v); if (!Number.isFinite(n) || n < min) throw erro(400, `${campo} inválido.`); return Math.round(n * 100) / 100; };
const alvo = async id => { const u = await usuario(Number(id)); if (!u) throw erro(404, "Usuário não encontrado."); return u; };
const contar = async sql => (await db.one(sql)).c;

adm.get("/resumo", a(async (req, res) => {
  res.json({ senhaPadrao: confere("123456", (await usuario(req.uid)).senha_hash), usuarios: await contar("SELECT COUNT(*) AS c FROM usuario"), admins: await admins(),
    produtos: await contar("SELECT COUNT(*) AS c FROM produto"), esgotados: await contar("SELECT COUNT(*) AS c FROM produto WHERE estoque <= 0"),
    baixos: await contar("SELECT COUNT(*) AS c FROM produto WHERE estoque > 0 AND estoque <= 5"), feedbacksNovos: await contar("SELECT COUNT(*) AS c FROM feedback WHERE status = 'novo'") });
}));

adm.get("/usuarios", a(async (req, res) => res.json((await db.all("SELECT * FROM usuario ORDER BY id")).map(u => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel, criadoEm: u.criado_em })))));

adm.put("/usuarios/:id/papel", a(async (req, res) => {
  const u = await alvo(req.params.id), papel = (req.body || {}).papel;
  if (!["cliente", "admin"].includes(papel)) throw erro(400, "Papel inválido.");
  if (u.papel === "admin" && papel !== "admin" && (await admins()) <= 1) throw erro(400, "Precisa existir pelo menos um administrador.");
  await db.query("UPDATE usuario SET papel = $1 WHERE id = $2", [papel, u.id]);
  res.status(204).end();
}));

adm.put("/usuarios/:id/senha", a(async (req, res) => {
  const u = await alvo(req.params.id), nova = (req.body || {}).nova;
  if (!nova || nova.length < 6) throw erro(400, "A nova senha deve ter pelo menos 6 caracteres.");
  await db.query("UPDATE usuario SET senha_hash = $1 WHERE id = $2", [hashSenha(nova), u.id]);
  res.status(204).end();
}));

adm.delete("/usuarios/:id", a(async (req, res) => {
  const u = await alvo(req.params.id);
  if (u.id === req.uid) throw erro(400, "Para excluir a sua própria conta, use a página de perfil.");
  if (u.papel === "admin" && (await admins()) <= 1) throw erro(400, "Não é possível excluir o único administrador.");
  await K.limpar("u:" + u.id);
  await db.query("DELETE FROM usuario WHERE id = $1", [u.id]);
  res.status(204).end();
}));

adm.put("/produtos/:id", a(async (req, res) => {
  const p = await K.produto(Number(req.params.id)), b = req.body || {};
  if (!p) throw erro(404, "Produto não encontrado.");
  const estoque = b.estoque == null ? p.estoque : decimal(b.estoque, 0, "Estoque");
  const preco = b.preco == null ? p.preco : decimal(b.preco, 0.01, "Preço");
  const antigo = b.precoAntigo == null ? Math.max(p.preco_antigo, preco) : decimal(b.precoAntigo, 0.01, "Preço antigo");
  await db.query("UPDATE produto SET estoque = $1, preco = $2, preco_antigo = $3 WHERE id = $4", [estoque, preco, Math.max(antigo, preco), p.id]);
  res.json(K.dto(await K.produto(p.id)));
}));

adm.post("/produtos", a(async (req, res) => {
  const b = req.body || {}, t = v => (v == null ? "" : String(v).trim());
  if (!t(b.base)) throw erro(400, "Informe o nome do produto.");
  if (!CATEGORIAS.includes(b.categoria)) throw erro(400, "Categoria inválida.");
  const preco = decimal(b.preco, 0.01, "Preço"), antigo = b.precoAntigo ? Math.max(decimal(b.precoAntigo, 0.01, "Preço antigo"), preco) : preco;
  const nome = [t(b.base), t(b.variante), t(b.marca)].filter(Boolean).join(" ") + (t(b.tamanho) === "kg" ? " (kg)" : t(b.tamanho) ? " " + t(b.tamanho) : "");
  if (await db.one("SELECT 1 AS ok FROM produto WHERE nome = $1", [nome])) throw erro(409, "Já existe um produto com esse nome.");
  const p = await db.one(`INSERT INTO produto (base, variante, marca, tamanho, nome, categoria, preco, preco_antigo, icone, estoque, granel)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [t(b.base), t(b.variante), t(b.marca), t(b.tamanho), nome, b.categoria, preco, antigo, t(b.icone) || "🛒", decimal(b.estoque == null ? 0 : b.estoque, 0, "Estoque"), b.granel ? 1 : 0]);
  M.recarregar();
  res.json(K.dto(p));
}));

adm.delete("/produtos/:id", a(async (req, res) => {
  const p = await K.produto(Number(req.params.id));
  if (!p) throw erro(404, "Produto não encontrado.");
  await db.query("DELETE FROM produto WHERE id = $1", [p.id]); // os itens de carrinho somem junto (ON DELETE CASCADE)
  M.recarregar();
  res.status(204).end();
}));

adm.get("/feedback", a(async (req, res) => {
  const { status, tipo } = req.query, cond = [], pr = [];
  if (STATUS_FB.includes(status)) { pr.push(status); cond.push(`status = $${pr.length}`); }
  if (TIPOS_FB.includes(tipo)) { pr.push(tipo); cond.push(`tipo = $${pr.length}`); }
  const itens = await db.all(`SELECT * FROM feedback ${cond.length ? "WHERE " + cond.join(" AND ") : ""} ORDER BY criado_em DESC LIMIT 500`, pr);
  const r = await db.one("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'novo') AS novos, ROUND(AVG(nota)::numeric, 2) AS media FROM feedback");
  res.json({ itens: itens.map(fbDto), resumo: { total: r.total, novos: r.novos, media: r.media } });
}));

adm.put("/feedback/:id", a(async (req, res) => {
  const f = await db.one("SELECT * FROM feedback WHERE id = $1", [Number(req.params.id)]), b = req.body || {};
  if (!f) throw erro(404, "Feedback não encontrado.");
  let status = b.status != null ? String(b.status) : f.status, resposta = f.resposta, respondidoEm = f.respondido_em;
  if (!STATUS_FB.includes(status)) throw erro(400, "Status inválido.");
  if (b.resposta != null) {
    resposta = String(b.resposta).trim().slice(0, 1000);
    if (resposta && resposta !== f.resposta) { respondidoEm = Date.now(); if (b.status == null) status = "resolvido"; }
  }
  await db.query("UPDATE feedback SET status = $1, resposta = $2, respondido_em = $3 WHERE id = $4", [status, resposta, respondidoEm, f.id]);
  res.json(fbDto({ ...f, status, resposta, respondido_em: respondidoEm }));
}));

adm.delete("/feedback/:id", a(async (req, res) => {
  await db.query("DELETE FROM feedback WHERE id = $1", [Number(req.params.id)]);
  res.status(204).end();
}));
app.use("/api/admin", adm);

/* ---------- Chat e OCR ---------- */
let worker = null;
async function ocr(buffer) {
  if (!worker) {
    const { createWorker } = require("tesseract.js");
    const langPath = path.dirname(require.resolve("@tesseract.js-data/por/package.json")) + "/4.0.0_best_int";
    worker = await createWorker("por", 1, { langPath, gzip: true });
  }
  return (await worker.recognize(buffer)).data.text;
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post("/api/chat/mensagem", a(async (req, res) => res.json(await chat.texto(req.dono, (req.body || {}).texto))));
app.post("/api/chat/escolha", a(async (req, res) => res.json(await chat.escolher(req.dono, req.body || {}))));
app.post("/api/chat/verificar", a(async (req, res) => res.json(await chat.verificar(req.dono))));
app.post("/api/chat/imagem", upload.single("arquivo"), a(async (req, res) => {
  if (!req.file) throw erro(400, "Envie uma imagem.");
  let texto;
  try { texto = await ocr(req.file.buffer); }
  catch (e) { console.error("OCR:", e.message); throw erro(503, "OCR indisponível no servidor."); }
  const linhas = texto.split(/\n|;/).map(s => s.trim()).filter(s => s.length > 1);
  if (!linhas.length) return res.json({ mensagens: ["Não consegui ler texto nessa imagem. Tente uma foto mais nítida ou digite a lista."], pergunta: null, concluido: false });
  res.json(await chat.linhasDaImagem(req.dono, linhas, `Li ${linhas.length} linha(s) da imagem. Vou montar o carrinho e pergunto o que ficar em dúvida.`));
}));

/* ---------- Front-end estático e erros ---------- */
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "loja.html")));
app.use(express.static(path.join(__dirname, "public")));
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  res.status(500).json({ message: "Erro interno do servidor." });
});

(async () => {
  try { await db.iniciar(); }
  catch (e) { console.error("\n" + e.message + "\n"); process.exit(1); }
  // Conta de administrador padrão: criada só se ainda não existir nenhum admin (desligue com ADMIN_PADRAO=0).
  if (process.env.ADMIN_PADRAO !== "0" && !(await db.one("SELECT 1 AS ok FROM usuario WHERE papel = 'admin'"))) {
    if (await db.one("SELECT 1 AS ok FROM usuario WHERE email = 'admin@admin'")) await db.query("UPDATE usuario SET papel = 'admin' WHERE email = 'admin@admin'");
    else await db.query("INSERT INTO usuario (nome, email, senha_hash, criado_em, papel) VALUES ($1,$2,$3,$4,'admin')", ["Administrador", "admin@admin", hashSenha("123456"), Date.now()]);
    console.log("⚠  Conta de administrador padrão criada:  e-mail admin@admin  |  senha 123456  (troque a senha no Perfil!)");
  }
  app.listen(PORT, () => console.log(`SuperExpress no ar: http://localhost:${PORT}  (banco: PostgreSQL)`));
})();
