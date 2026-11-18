// Interpretação da lista: normaliza, separa quantidade/tamanho, pontua o catálogo e decide (T1 e DELTA).
const db = require("./db");
const T1 = parseFloat(process.env.T1) || 0.75;       // limiar de aceitação automática
const DELTA = parseFloat(process.env.DELTA) || 0.08; // margem sobre o segundo colocado

const ns = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const clean = s => ns(s).replace(/[^a-z0-9]+/g, " ").trim();
const sizeRe = /(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|lts?|litros?|l)\b/;
const normSize = (n, u) => String(parseFloat(n.replace(",", "."))) + u.replace(/^(lts?|litros?)$/, "l").replace(/^gr$/, "g");
const ABREV = [["tio j", "tio joao"], ["refri", "refrigerante"], ["refrig", "refrigerante"], ["int", "integral"],
  ["desn", "desnatado"], ["semi", "semidesnatado"], ["mussa", "mussarela"], ["espag", "espaguete"], ["marg", "margarina"]];

// Palavras que não identificam o produto ("pacote de arroz", "2 un de óleo") e unidades de embalagem
const STOP = new Set(["de", "da", "do", "das", "dos", "e", "o", "a", "os", "as", "um", "uma", "para", "pra"]);
const EMBALAGEM = /\b(pt|pts|pct|pcts|pc|pcs|pacote|pacotes|pote|potes|un|und|unid|unids|unidade|unidades|cx|caixa|caixas|lata|latas|garrafa|garrafas|sc|saco|sacos|dz|duzia|duzias|bandeja|bandejas|vidro|vidros|tubo|tubos|fardo|fardos)\b/g;
const NUMEROS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
const semStop = s => s.split(" ").filter(w => w && !STOP.has(w)).join(" ");

// Tamanho em unidade base: kg/g → gramas ("m"), l/ml → mililitros ("v")
function quant(z) {
  const m = z && z.match(/^([\d.]+)(kg|g|l|ml)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === "kg" ? { v: n * 1000, d: "m" } : m[2] === "g" ? { v: n, d: "m" } : m[2] === "l" ? { v: n * 1000, d: "v" } : { v: n, d: "v" };
}

let idx = null;
function indexar(p) {
  const str = semStop(clean([p.base, p.variante, p.marca].filter(Boolean).join(" ")));
  const m = ns(p.tamanho || "").match(sizeRe);
  const z = m ? normSize(m[1], m[2]) : null;
  return { p, str, z, zq: quant(z), bulk: !!p.granel };
}
const indice = async () => idx || (idx = (await db.all("SELECT * FROM produto")).map(indexar));

function parse(raw) {
  // tira marcadores de lista ("* ", "- ", "• ", "1) ", "2. ") e converte "duas" → 2
  let s = ns(raw).replace(/^\s*(?:[-*•–—]+|\d+[.)])\s+/, "").replace(/^\s*(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/, (_, w) => NUMEROS[w]);
  let z = null, q = null, m = s.match(sizeRe);
  if (m) { z = normSize(m[1], m[2]); s = s.replace(m[0], " "); }
  s = clean(s.replace(/\d+[.,]\d{2}\b/g, " ")).replace(EMBALAGEM, " ").replace(/\s+/g, " ").trim();
  m = s.match(/\bx\s*(\d+)\b|\b(\d+)\s*x\b|^(\d+)\b|\b(\d+)$/);
  if (m) { const g = m[1] || m[2] || m[3] || m[4]; if (g.length <= 4) q = +g; s = s.replace(m[0], " "); }
  let t = semStop(s.replace(/\s+/g, " ").trim());
  ABREV.forEach(([k, v]) => t = t.replace(new RegExp("\\b" + k + "\\b", "g"), v));
  return { raw, t: t.replace(/\s+/g, " ").trim(), z, q };
}

function lev(a, b) {
  const d = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const x = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = x;
    }
  }
  return d[b.length];
}
const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

function score(it, x) {
  const qt = it.t.split(" ").filter(Boolean), pt = x.str.split(" ");
  if (!qt.length) return 0;
  const tok = qt.reduce((acc, q) => acc + Math.max(...pt.map(w => sim(q, w))), 0) / qt.length;
  const cov = pt.filter(w => qt.some(q => sim(q, w) >= 0.8)).length / pt.length;
  let r = 0.85 * tok + 0.15 * cov;
  if (it.z && x.z && !x.bulk) {
    const a = quant(it.z), b = x.zq;
    if (x.z === it.z) r += 0.1;
    else if (!(a && b && a.d === b.d && a.v > b.v && a.v % b.v === 0)) r -= 0.25; // múltiplo (5kg de feijão de 1kg) não penaliza
  }
  return r;
}

// Devolve { auto: produto|null, cands: [produtos] } (linhas do banco). cands = grupo de produtos parecidos.
async function buscar(it) {
  const r = (await indice()).map(x => ({ x, s: score(it, x) })).sort((a, b) => b.s - a.s);
  if (!r.length) return { auto: null, cands: [] };
  const best = r[0].s, second = r[1] ? r[1].s : 0;
  if (best >= T1 && best - second >= DELTA) return { auto: r[0].x.p, cands: [r[0].x.p] };
  const lim = Math.max(0.45, best - 0.12);
  let c = r.filter(o => o.s >= lim).slice(0, 60);
  if (it.z) { const exatos = c.filter(o => o.x.z === it.z); if (exatos.length) c = exatos; }
  return { auto: null, cands: c.map(o => o.x.p) };
}

// Quantidade de unidades do produto: número pedido × quantos pacotes são necessários para chegar ao peso/volume pedido
function qtd(p, it) {
  if (p.granel) { // quantidade em kg (aceita fração: 700g → 0,7)
    const m = it.z && it.z.match(/^([\d.]+)(kg|g)$/);
    if (m) return Math.min(99, Math.max(0.05, Math.round((m[2] === "kg" ? +m[1] : +m[1] / 1000) * 20) / 20));
    return it.q || 1;
  }
  let n = it.q || 1;
  const ms = ns(p.tamanho || "").match(sizeRe), a = quant(it.z), b = ms ? quant(normSize(ms[1], ms[2])) : null;
  if (a && b && a.d === b.d && a.v >= b.v) n *= Math.ceil(a.v / b.v);                    // 5 kg → 5 × 1kg; 1,5 kg → 2 × 1kg (arredonda para cima)
  const cx = (p.tamanho || "").match(/^(\d+)un$/);
  if (cx && it.q && it.q >= 6 && it.q % +cx[1] === 0) n = it.q / +cx[1];                 // 12 ovos → 1 caixa de 12
  return Math.min(n, 99);
}
const recarregar = () => { idx = null; };
module.exports = { ns, parse, buscar, qtd, recarregar };
