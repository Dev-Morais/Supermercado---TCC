// Banco PostgreSQL (driver "pg"). Configure com a variável DATABASE_URL (ou no arquivo .env):
//   postgres://USUARIO:SENHA@localhost:5432/superexpress
try { process.loadEnvFile(); } catch (e) { /* sem arquivo .env: usa as variáveis do sistema */ }
const { Pool, Client, types } = require("pg");
const fs = require("fs"), path = require("path");

types.setTypeParser(20, v => parseInt(v, 10));  // BIGINT (COUNT, datas em ms) → número
types.setTypeParser(1700, v => parseFloat(v));  // NUMERIC → número

const URL_BANCO = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/superexpress";
const pool = new Pool({ connectionString: URL_BANCO, max: 10 });
pool.on("error", e => console.error("PostgreSQL:", e.message));

const query = (sql, p) => pool.query(sql, p);
const all = async (sql, p) => (await pool.query(sql, p)).rows;
const one = async (sql, p) => (await pool.query(sql, p)).rows[0] || null;
// Transação: tudo dentro de fn() é confirmado junto (COMMIT) ou desfeito (ROLLBACK)
async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn({ query: (s, p) => c.query(s, p), all: async (s, p) => (await c.query(s, p)).rows, one: async (s, p) => (await c.query(s, p)).rows[0] || null });
    await c.query("COMMIT");
    return r;
  } catch (e) { try { await c.query("ROLLBACK"); } catch (_) {} throw e; }
  finally { c.release(); }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usuario (
  id SERIAL PRIMARY KEY, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha_hash TEXT NOT NULL,
  telefone TEXT NOT NULL DEFAULT '', cep TEXT NOT NULL DEFAULT '', cidade TEXT NOT NULL DEFAULT '', rua TEXT NOT NULL DEFAULT '', numero TEXT NOT NULL DEFAULT '',
  criado_em BIGINT NOT NULL, papel TEXT NOT NULL DEFAULT 'cliente');
CREATE TABLE IF NOT EXISTS produto (
  id SERIAL PRIMARY KEY, base TEXT NOT NULL, variante TEXT NOT NULL DEFAULT '', marca TEXT NOT NULL DEFAULT '', tamanho TEXT NOT NULL DEFAULT '',
  nome TEXT NOT NULL, categoria TEXT NOT NULL, preco DOUBLE PRECISION NOT NULL, preco_antigo DOUBLE PRECISION NOT NULL, icone TEXT,
  estoque DOUBLE PRECISION NOT NULL DEFAULT 0, granel INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS produto_nome_uq ON produto (nome);
CREATE TABLE IF NOT EXISTS item_carrinho (
  id SERIAL PRIMARY KEY, dono TEXT NOT NULL, produto_id INTEGER NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
  quantidade DOUBLE PRECISION NOT NULL, UNIQUE (dono, produto_id));
CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY, usuario_id INTEGER REFERENCES usuario(id) ON DELETE SET NULL, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL, nota INTEGER, mensagem TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'novo', resposta TEXT NOT NULL DEFAULT '',
  criado_em BIGINT NOT NULL, respondido_em BIGINT);
CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback (status, criado_em DESC);
CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);`;

// Se o banco ainda não existe, cria (precisa de um usuário com permissão, como o "postgres")
async function garantirBanco() {
  try { await pool.query("SELECT 1"); return; }
  catch (e) {
    if (e.code !== "3D000") throw e;
    const u = new URL(URL_BANCO), nome = decodeURIComponent(u.pathname.slice(1));
    if (!/^[\w-]+$/.test(nome)) throw new Error(`Nome de banco inválido: ${nome}`);
    u.pathname = "/postgres";
    const c = new Client({ connectionString: u.toString() });
    await c.connect();
    try { await c.query(`CREATE DATABASE "${nome}"`); console.log(`Banco "${nome}" criado no PostgreSQL.`); } finally { await c.end(); }
  }
}

const VERSAO_CATALOGO = 3;
const lerCsv = () => fs.readFileSync(path.join(__dirname, "produtos.csv"), "utf8").split(/\r?\n/).slice(1).filter(l => l.trim()).map(l => {
  const [base, variante, marca, tamanho, categoria, preco, antigo, icone, estoque, granel] = l.split(";");
  const nome = [base, variante, marca].filter(Boolean).join(" ") + (tamanho === "kg" ? " (kg)" : tamanho ? " " + tamanho : "");
  const p = parseFloat(preco);
  return [base, variante, marca, tamanho, nome, categoria, p, antigo ? parseFloat(antigo) : p, icone, parseFloat(estoque) || 0, parseInt(granel) || 0];
});

// Cria as tabelas e carrega o catálogo (produtos.csv). Versões novas do CSV só acrescentam o que falta:
// estoque/preço editados e produtos já existentes não são alterados.
async function iniciar() {
  try { await garantirBanco(); }
  catch (e) {
    const dica = e.code === "ECONNREFUSED" ? "O PostgreSQL não está rodando (ou a porta/endereço está errado)."
      : e.code === "28P01" ? "Usuário ou senha do PostgreSQL incorretos."
      : e.code === "28000" || e.code === "42501" ? "O usuário não tem permissão para esse banco." : e.message;
    throw new Error(`Não foi possível conectar ao PostgreSQL. ${dica}\nConfira a variável DATABASE_URL (arquivo .env). Atual: ${URL_BANCO.replace(/:[^:@/]*@/, ":***@")}`);
  }
  await pool.query(SCHEMA);
  const cfg = await one("SELECT valor FROM config WHERE chave = 'catalogo_versao'");
  const vazio = (await one("SELECT COUNT(*) AS c FROM produto")).c === 0;
  if (vazio || !cfg || +cfg.valor < VERSAO_CATALOGO) {
    await tx(async t => {
      for (const r of lerCsv())
        await t.query(`INSERT INTO produto (base, variante, marca, tamanho, nome, categoria, preco, preco_antigo, icone, estoque, granel)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (nome) DO NOTHING`, r);
      await t.query("INSERT INTO config (chave, valor) VALUES ('catalogo_versao', $1) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor", [String(VERSAO_CATALOGO)]);
    });
  }
}

module.exports = { pool, query, all, one, tx, iniciar };
