// Copia os dados da versão antiga (SQLite, data/superexpress.db) para o PostgreSQL:
// contas de usuário (mantendo as senhas) e estoque/preços editados dos produtos.
// Uso:  node migrar-sqlite.js            (precisa do Node 22.5+; pode rodar mais de uma vez sem duplicar)
const fs = require("fs"), path = require("path"), db = require("./db");
const arquivo = process.argv[2] || path.join(__dirname, "data", "superexpress.db");
if (!fs.existsSync(arquivo)) { console.log("Arquivo SQLite não encontrado: " + arquivo); process.exit(1); }
(async () => {
  const { DatabaseSync } = require("node:sqlite");
  const lite = new DatabaseSync(arquivo, { readOnly: true });
  await db.iniciar();
  let us = 0, ps = 0;
  for (const u of lite.prepare("SELECT * FROM usuario ORDER BY id").all()) {
    const r = await db.query(`INSERT INTO usuario (id, nome, email, senha_hash, telefone, cep, cidade, rua, numero, criado_em, papel)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (email) DO NOTHING`,
      [u.id, u.nome, u.email, u.senha_hash, u.telefone || "", u.cep || "", u.cidade || "", u.rua || "", u.numero || "", u.criado_em, u.papel || "cliente"]);
    us += r.rowCount;
  }
  await db.query("SELECT setval(pg_get_serial_sequence('usuario','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM usuario), 1))");
  for (const p of lite.prepare("SELECT nome, preco, preco_antigo, estoque FROM produto").all()) {
    const r = await db.query("UPDATE produto SET preco = $1, preco_antigo = $2, estoque = $3 WHERE nome = $4", [p.preco, p.preco_antigo, p.estoque, p.nome]);
    ps += r.rowCount;
  }
  console.log(`Migração concluída: ${us} conta(s) copiada(s) e ${ps} produto(s) com estoque/preço atualizados.`);
  await db.pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
