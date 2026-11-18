// Assistente de compras: máquina de estados com fila de tarefas por dono do carrinho ("u:ID" ou "v:ID").
//  - "filtrar": refina o pedido passo a passo (tipo → tamanho → marca), ex.: leite → integral/desnatado → Italac
//  - "peso": produtos vendidos por kg sem peso no pedido
//  - "sem_estoque" / "estoque_baixo" / "trocar": oferece trocar por outro produto, levar o que há ou remover
// Tudo é assíncrono (PostgreSQL); as chamadas de um mesmo dono são executadas uma de cada vez.
const db = require("./db"), M = require("./matcher"), K = require("./carrinho");
const brl = v => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const estados = new Map();
const est = d => { if (!estados.has(d)) estados.set(d, { fila: [], mudou: false }); return estados.get(d); };

const ATTRS = [["base", "O que você quer em “{raw}”?"], ["variante", "Qual tipo de {base}?"], ["tamanho", "Qual tamanho (peso)?"], ["marca", "Qual marca?"]];
const kgTxt = q => `${(+q).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`;
const qtdTxt = (p, q) => (p.granel ? kgTxt(q) : `${q} unidade(s)`);
const nomeCurto = p => [p.base, p.variante].filter(Boolean).join(" ");
const PESOS = [0.3, 0.5, 1, 1.5, 2, 3];
const opProduto = p => ({ id: p.id, rotulo: p.nome, detalhe: brl(p.preco) + (p.estoque > 0 && p.estoque <= 3 ? ` · restam ${p.estoque}` : ""), icone: p.icone, preco: p.preco });

// Produtos parecidos e em estoque (mesma base > mesmo tipo > mesma marca > mesmo tamanho > preço próximo)
async function alternativas(p) {
  const rows = await db.all("SELECT * FROM produto WHERE estoque > 0 AND id <> $1 AND categoria = $2", [p.id, p.categoria]);
  return rows.map(x => ({ x, s: (x.base === p.base ? 4 : 0) + (x.variante && x.variante === p.variante ? 2 : 0) + (x.marca && x.marca === p.marca ? 1 : 0)
      + (x.tamanho === p.tamanho ? 1 : 0) + Math.max(0, 1 - Math.abs(x.preco - p.preco) / Math.max(p.preco, 1)) }))
    .sort((a, b) => b.s - a.s).slice(0, 4).map(o => o.x);
}

async function colocar(d, tk, p, qtd, msgs) {
  const s = est(d);
  if (tk.antigo && tk.antigo !== p.id) await K.definir(d, tk.antigo, 0);
  if (tk.carrinho && tk.antigo === p.id) { await K.definir(d, p.id, qtd); msgs.push(`Ajustei “${p.nome}” para ${qtdTxt(p, qtd)}.`); }
  else { await K.adicionar(d, p.id, qtd); msgs.push(p.granel ? `✓ ${nomeCurto(p)} (${kgTxt(qtd)})` : `✓ ${p.nome}${qtd > 1 ? " × " + qtd : ""}`); }
  s.mudou = true;
}

// Confere o estoque atual e adiciona (ou abre a pergunta de estoque)
async function concluir(d, tk, p0, msgs) {
  const p = await K.produto(p0.id), qtd = tk.qtd || 1, s = est(d);
  if (!p) { msgs.push("Esse produto não está mais disponível."); return; }
  const base = { item: tk.item, prod: p, qtd, carrinho: !!tk.carrinho, antigo: tk.antigo || null };
  if (p.estoque <= 0) s.fila.unshift({ ...base, tipo: "sem_estoque" });
  else if (qtd > p.estoque) s.fila.unshift({ ...base, tipo: "estoque_baixo", max: p.estoque });
  else await colocar(d, tk, p, qtd, msgs);
}

// Refina o grupo de produtos; devolve a pergunta, ou null quando resolveu (a tarefa sai da fila)
async function filtrar(d, tk, msgs) {
  const s = est(d);
  const S = (await Promise.all(tk.S.map(p => K.produto(p.id)))).filter(Boolean), vivos = S.filter(p => p.estoque > 0);
  if (!S.length) { s.fila.shift(); msgs.push(`“${tk.item.raw}” não está mais no catálogo.`); return null; }
  if (!vivos.length) {
    s.fila.shift();
    s.fila.unshift({ tipo: "sem_estoque", item: tk.item, prod: S[0], qtd: M.qtd(S[0], tk.item), carrinho: false, antigo: null });
    return null;
  }
  tk.S = vivos;
  for (const [attr, modelo] of ATTRS) {
    const vals = [...new Set(vivos.map(p => p[attr]).filter(Boolean))];
    if (vals.length < 2) continue;
    tk.attr = attr;
    const bases = [...new Set(vivos.map(p => p.base))];
    const texto = modelo.replace("{raw}", tk.item.raw).replace("{base}", bases.length === 1 ? bases[0].toLowerCase() : "produto");
    const opcoes = vals.map(v => {
      const g = vivos.filter(p => p[attr] === v), min = Math.min(...g.map(p => p.preco));
      return { valor: v, rotulo: v, detalhe: g.length > 1 ? `a partir de ${brl(min)}` : brl(min), icone: g[0].icone };
    });
    const acoes = [{ acao: "tanto_faz", rotulo: "Tanto faz (o mais barato)" }];
    if (s.fila.filter(t => t.tipo === "filtrar").length > 1) acoes.push({ acao: "tanto_faz_todos", rotulo: "Tanto faz para todos os itens" });
    acoes.push({ acao: "pular", rotulo: "Pular item" });
    return { tipo: "filtro", texto, opcoes, acoes };
  }
  if (vivos[0].granel && !tk.item.z) { // vendido por kg e sem peso no pedido: pergunta quantos kg
    tk.tipo = "peso"; tk.prod = vivos[0];
    return perguntaPeso(tk);
  }
  s.fila.shift();
  await concluir(d, { item: tk.item, qtd: M.qtd(vivos[0], tk.item) }, vivos[0], msgs);
  return null;
}

async function perguntaPeso(tk) {
  const p = (await K.produto(tk.prod.id)) || tk.prod;
  const opcoes = PESOS.filter(kg => kg <= p.estoque).map(kg => ({ peso: kg, rotulo: kg < 1 ? `${Math.round(kg * 1000)} g` : kgTxt(kg), detalhe: brl(p.preco * kg), icone: p.icone }));
  return { tipo: "peso", texto: `Quantos kg de ${nomeCurto(p).toLowerCase()} você quer? (${brl(p.preco)}/kg) Escolha ou digite, por exemplo “700g” ou “1,5 kg”.`,
    opcoes, acoes: [{ acao: "pular", rotulo: "Pular item" }] };
}

// "Tanto faz": o mais barato entre os que têm estoque suficiente para a quantidade pedida
const maisBarato = (S, item) => [...S].sort((a, b) => (a.estoque >= M.qtd(a, item) ? 0 : 1) - (b.estoque >= M.qtd(b, item) ? 0 : 1) || a.preco - b.preco)[0];

async function perguntaEstoque(tk) {
  if (tk.tipo === "estoque_baixo") return { tipo: "estoque_baixo", opcoes: [],
    texto: `⚠️ Só temos ${qtdTxt(tk.prod, Math.round(tk.max * 100) / 100)} de “${tk.prod.nome}” (você pediu ${qtdTxt(tk.prod, tk.qtd)}). O que prefere?`,
    acoes: [{ acao: "adicionar_max", rotulo: `Levar ${tk.prod.granel ? kgTxt(Math.round(tk.max * 100) / 100) : tk.max}` }, { acao: "trocar", rotulo: "Trocar por outro" }, { acao: "remover", rotulo: "Remover" }] };
  const alts = (await alternativas(tk.prod)).map(opProduto);
  return { tipo: tk.tipo, opcoes: alts, acoes: [{ acao: "remover", rotulo: tk.carrinho ? "Remover do carrinho" : "Remover da lista" }],
    texto: tk.tipo === "trocar" ? `Escolha um produto para trocar por “${tk.prod.nome}”:` : `⚠️ “${tk.prod.nome}” está esgotado. Quer trocar por outro produto ou remover?` };
}

function juntar(msgs) {
  const add = msgs.filter(m => m.startsWith("✓ ")).map(m => m.slice(2));
  const outros = msgs.filter(m => !m.startsWith("✓ "));
  return add.length ? [`Adicionado ao carrinho: ${add.join(", ")}.`, ...outros] : outros;
}

async function avancar(d, msgs) {
  const s = est(d);
  for (;;) {
    const tk = s.fila[0];
    if (!tk) {
      const fim = s.mudou;
      if (fim) { msgs.push("Pronto! Confira o carrinho e finalize quando quiser."); s.mudou = false; }
      return { mensagens: juntar(msgs), pergunta: null, concluido: fim };
    }
    if (tk.tipo === "filtrar") {
      const p = await filtrar(d, tk, msgs);
      if (p) return { mensagens: juntar(msgs), pergunta: p, concluido: false };
      continue;
    }
    return { mensagens: juntar(msgs), pergunta: tk.tipo === "peso" ? await perguntaPeso(tk) : await perguntaEstoque(tk), concluido: false };
  }
}

async function novaTarefa(linha) {
  const it = M.parse(linha);
  if (!it.t) return null;
  const r = await M.buscar(it);
  return r.cands.length ? { tipo: "filtrar", item: it, S: r.cands } : null;
}

async function processar(d, linhas, msgs) {
  const s = est(d);
  let n = 0;
  for (const l of linhas) {
    const t = await novaTarefa(l);
    if (t) { s.fila.push(t); n++; } else msgs.push(`Não encontrei “${l}” no catálogo.`);
  }
  if (!n && !msgs.length) msgs.push("Não entendi nenhum item. Tente: “2 arroz, leite, 1kg tomate”.");
  return avancar(d, msgs);
}

async function escolher(d, { valor, produtoId, acao, peso }) {
  const s = est(d), tk = s.fila[0], msgs = [];
  if (!tk) return { mensagens: ["Não há nenhuma pergunta pendente."], pergunta: null, concluido: false };

  if (acao === "pular") { s.fila.shift(); msgs.push("Ok, item ignorado."); }
  else if (acao === "remover") {
    s.fila.shift();
    if (tk.carrinho) { await K.definir(d, tk.prod.id, 0); s.mudou = true; }
    msgs.push(`Removi “${tk.prod ? tk.prod.nome : tk.item.raw}” ${tk.carrinho ? "do carrinho" : "da lista"}.`);
  }
  else if (acao === "trocar" && tk.tipo === "estoque_baixo") tk.tipo = "trocar";
  else if (acao === "adicionar_max" && tk.tipo === "estoque_baixo") {
    s.fila.shift();
    const p = await K.produto(tk.prod.id), q = p ? Math.min(tk.max, p.estoque) : 0;
    if (q > 0) await colocar(d, tk, p, q, msgs); else s.fila.unshift({ ...tk, tipo: "sem_estoque" });
  }
  else if (peso != null && tk.tipo === "peso") {
    const kg = Math.round(Number(peso) * 20) / 20;
    if (!(kg >= 0.05 && kg <= 99)) msgs.push("Peso inválido. Tente algo como 500g ou 1,5 kg.");
    else { s.fila.shift(); await concluir(d, { item: tk.item, qtd: kg }, tk.prod, msgs); }
  }
  else if (acao === "tanto_faz_todos") { // resolve de uma vez o mais barato de todos os itens pendentes
    for (const t of s.fila) if (t.tipo === "filtrar") {
      const vivos = (await Promise.all(t.S.map(p => K.produto(p.id)))).filter(p => p && p.estoque > 0);
      if (vivos.length) t.S = [maisBarato(vivos, t.item)];
    }
  }
  else if (acao === "tanto_faz" && tk.tipo === "filtrar") {
    tk.S = [maisBarato(tk.S, tk.item)];
  }
  else if (valor != null && tk.tipo === "filtrar" && tk.attr) {
    const novo = tk.S.filter(p => p[tk.attr] === valor);
    if (novo.length) tk.S = novo; else msgs.push("Essa opção não está disponível.");
  }
  else if (produtoId != null && (tk.tipo === "sem_estoque" || tk.tipo === "trocar")) {
    const alt = (await alternativas(tk.prod)).find(a => a.id === Number(produtoId));
    if (!alt) msgs.push("Essa opção não está disponível.");
    else {
      s.fila.shift();
      await concluir(d, { item: tk.item, qtd: tk.qtd, carrinho: tk.carrinho, antigo: tk.carrinho ? tk.prod.id : tk.antigo }, alt, msgs);
    }
  }
  return avancar(d, msgs);
}

// Confere o estoque de tudo que está no carrinho e abre as perguntas de troca/remoção
async function verificar(d) {
  const s = est(d), msgs = [], its = await K.listar(d);
  s.fila = s.fila.filter(t => !t.carrinho);
  let n = 0;
  for (const i of its) {
    const p = await K.produto(i.produtoId);
    const base = { item: { raw: p.nome }, prod: p, qtd: i.quantidade, carrinho: true, antigo: p.id };
    if (p.estoque <= 0) { s.fila.push({ ...base, tipo: "sem_estoque" }); n++; }
    else if (i.quantidade > p.estoque) { s.fila.push({ ...base, tipo: "estoque_baixo", max: p.estoque }); n++; }
  }
  if (!its.length) msgs.push("Seu carrinho está vazio.");
  else if (!n) msgs.push("✅ Tudo certo! Todos os itens do carrinho estão disponíveis.");
  else msgs.push(`Encontrei ${n} item(ns) com problema de estoque. Vamos resolver:`);
  return avancar(d, msgs);
}

async function faq(d, t) {
  const m = M.ns(t);
  if (/verific|confer|estoque|disponib/.test(m)) return verificar(d);
  const r = txt => ({ mensagens: [txt], pergunta: null, concluido: false });
  if (/entrega|frete|prazo/.test(m)) return r("Nossas entregas express levam de 45 a 90 minutos para a sua região! O frete é grátis para compras acima de R$ 100,00.");
  if (/pagamento|cartao|pix/.test(m)) return r("Aceitamos Pix, cartões de crédito/débito e vale-alimentação/refeição (Alelo, VR, Sodexo).");
  if (/promocao|desconto|oferta/.test(m)) return r("Confira os produtos com selo de desconto na vitrine: as ofertas chegam a 20%!");
  if (/feedback|sugest|reclam|elogio|avalia/.test(m)) return r("Adoramos ouvir você! Toque em “Feedback” no menu da loja para enviar sua opinião, sugestão ou problema. Nossa equipe responde por lá.");
  if (/meu carrinho|total/.test(m)) {
    const its = await K.listar(d);
    return r(`Você tem ${its.length} tipo(s) de item no carrinho, totalizando ${brl(its.reduce((a, i) => a + i.preco * i.quantidade, 0))}.`);
  }
  if (/^(oi|ola|bom dia|boa tarde|boa noite|ajuda)\b/.test(m))
    return r("Olá! Envie sua lista (um item por linha ou separados por vírgula) ou uma foto dela. Eu pergunto o tipo, a marca e o tamanho quando precisar e confiro o estoque.");
  return null;
}

async function texto(d, t) {
  t = (t || "").trim();
  if (!t) return { mensagens: [], pergunta: null, concluido: false };
  const f = await faq(d, t);
  if (f) return f;
  const s = est(d), cab = s.fila[0];
  const mp = cab && cab.tipo === "peso" && t.match(/^\s*(\d+(?:[.,]\d+)?)\s*(kg|quilos?|g|gr|gramas?)?\s*$/i);
  if (mp) { // “700g”, “1,5 kg”, “2” respondem à pergunta de peso
    let v = parseFloat(mp[1].replace(",", ".")); const u = (mp[2] || "").toLowerCase();
    v = u.startsWith("g") || (!u && v >= 50) ? v / 1000 : v;
    return escolher(d, { peso: v });
  }
  const linhas = t.split(/\n|;|(?<!\d),|,(?!\d)/).map(x => x.trim()).filter(Boolean);
  if (s.fila.length && linhas.length === 1) { // digitou outro nome enquanto há pergunta aberta: refaz o item atual
    const nova = await novaTarefa(linhas[0]);
    if (nova) { s.fila.shift(); s.fila.unshift(nova); return avancar(d, []); }
    return avancar(d, [`Não encontrei “${linhas[0]}” no catálogo. Escolha uma opção ou tente outro nome.`]);
  }
  return processar(d, linhas, []);
}
const linhasDaImagem = (d, linhas, abertura) => processar(d, linhas, [abertura]);

// Uma chamada por vez para cada dono (evita misturar a fila quando o usuário clica rápido)
const travas = new Map();
function serial(d, fn) {
  const ant = travas.get(d) || Promise.resolve();
  const p = ant.then(fn, fn);
  const cauda = p.then(() => {}, () => {});
  travas.set(d, cauda);
  cauda.then(() => { if (travas.get(d) === cauda) travas.delete(d); });
  return p;
}
module.exports = {
  texto: (d, t) => serial(d, () => texto(d, t)),
  escolher: (d, b) => serial(d, () => escolher(d, b)),
  verificar: d => serial(d, () => verificar(d)),
  linhasDaImagem: (d, l, a) => serial(d, () => linhasDaImagem(d, l, a)),
};
