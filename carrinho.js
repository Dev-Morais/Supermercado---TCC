// Carrinho (de usuário "u:ID" ou de visitante "v:ID") e checagem de estoque. Tudo assíncrono (PostgreSQL).
const db = require("./db");
const erro = (status, message) => Object.assign(new Error(message), { status });

const produto = id => db.one("SELECT * FROM produto WHERE id = $1", [id]);
const dto = p => {
  const d = p.preco_antigo > p.preco ? Math.round((1 - p.preco / p.preco_antigo) * 100) : 0;
  return { id: p.id, base: p.base, variante: p.variante, marca: p.marca, tamanho: p.tamanho, nome: p.nome, categoria: p.categoria,
    preco: p.preco, precoAntigo: p.preco_antigo, desconto: d > 0 ? `-${d}%` : "", icone: p.icone, estoque: p.estoque, granel: !!p.granel };
};

const listar = dono => db.all(
  `SELECT p.id AS "produtoId", p.nome, p.preco, p.icone, p.estoque, p.granel, i.quantidade FROM item_carrinho i
   JOIN produto p ON p.id = i.produto_id WHERE i.dono = $1 ORDER BY i.id`, [dono]);

// Define a quantidade (0 remove). Não permite passar do estoque.
async function definir(dono, pid, qtd) {
  const p = await produto(pid);
  if (!p) throw erro(404, "Produto não encontrado.");
  qtd = Math.max(0, Math.min(Number(qtd) || 0, 99));
  qtd = p.granel ? Math.round(qtd * 20) / 20 : Math.floor(qtd); // por kg: passos de 50 g; demais: unidades inteiras
  if (qtd > 0 && p.estoque <= 0) throw erro(409, `“${p.nome}” está esgotado.`);
  if (qtd > p.estoque) throw erro(409, `Só temos ${p.granel ? Math.round(p.estoque * 100) / 100 + " kg" : p.estoque + " unidade(s)"} de “${p.nome}”.`);
  if (qtd === 0) await db.query("DELETE FROM item_carrinho WHERE dono = $1 AND produto_id = $2", [dono, pid]);
  else await db.query(`INSERT INTO item_carrinho (dono, produto_id, quantidade) VALUES ($1,$2,$3)
    ON CONFLICT (dono, produto_id) DO UPDATE SET quantidade = EXCLUDED.quantidade`, [dono, pid, qtd]);
  return listar(dono);
}
async function adicionar(dono, pid, qtd) {
  const r = await db.one("SELECT quantidade AS q FROM item_carrinho WHERE dono = $1 AND produto_id = $2", [dono, pid]);
  return definir(dono, pid, (r ? r.q : 0) + qtd);
}
const limpar = async dono => { await db.query("DELETE FROM item_carrinho WHERE dono = $1", [dono]); return []; };

// Ao entrar na conta, leva o carrinho de visitante para o carrinho do usuário
async function migrar(de, para) {
  for (const i of await listar(de)) {
    try { await adicionar(para, i.produtoId, Math.min(i.quantidade, Math.max(i.estoque, 0))); } catch (e) { /* sem estoque: ignora */ }
  }
  await limpar(de);
}

// Finaliza: confere o estoque, baixa as quantidades (em transação) e esvazia o carrinho
async function finalizar(dono) {
  const its = await listar(dono);
  if (!its.length) throw erro(400, "Seu carrinho está vazio.");
  const problemas = its.filter(i => i.estoque <= 0 || i.quantidade > i.estoque);
  if (problemas.length) return { problemas };
  await db.tx(async t => {
    for (const i of its) {
      // a condição "estoque >= qtd" impede vender o que acabou de sair (compras simultâneas)
      const r = await t.query("UPDATE produto SET estoque = GREATEST(0, ROUND((estoque - $1)::numeric, 3)) WHERE id = $2 AND estoque >= $1", [i.quantidade, i.produtoId]);
      if (r.rowCount === 0) throw erro(409, `“${i.nome}” ficou sem estoque suficiente. Confira o carrinho.`);
    }
    await t.query("DELETE FROM item_carrinho WHERE dono = $1", [dono]);
  });
  return { numero: Date.now().toString(36).toUpperCase(), itens: its.length, total: +its.reduce((a, i) => a + i.preco * i.quantidade, 0).toFixed(2) };
}
module.exports = { erro, produto, dto, listar, definir, adicionar, limpar, migrar, finalizar };
