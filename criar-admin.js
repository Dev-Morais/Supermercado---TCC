// Cria (ou promove) uma conta de administrador.
// Uso:  node criar-admin.js "Seu Nome" seu@email.com suasenha
const db = require("./db"), crypto = require("crypto");
const [nome, email, senha] = process.argv.slice(2);
if (!nome || !email || !senha || senha.length < 6) {
  console.log('Uso: node criar-admin.js "Seu Nome" seu@email.com suasenha   (senha com pelo menos 6 caracteres)');
  process.exit(1);
}
(async () => {
  await db.iniciar();
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = salt + ":" + crypto.scryptSync(senha, salt, 64).toString("hex");
  const em = email.trim().toLowerCase();
  const u = await db.one("SELECT id FROM usuario WHERE email = $1", [em]);
  if (u) {
    await db.query("UPDATE usuario SET papel = 'admin', senha_hash = $1, nome = $2 WHERE id = $3", [hash, nome.trim(), u.id]);
    console.log(`Conta existente promovida a administrador (senha atualizada): ${em}`);
  } else {
    await db.query("INSERT INTO usuario (nome, email, senha_hash, criado_em, papel) VALUES ($1,$2,$3,$4,'admin')", [nome.trim(), em, hash, Date.now()]);
    console.log(`Administrador criado: ${em}`);
  }
  await db.pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
