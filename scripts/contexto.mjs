// Junta lo que Claude Code ya sabe de una marca antes de preguntarle nada al usuario:
// los CLAUDE.md, la memoria del proyecto, los archivos de la carpeta, los perfiles de marcas/
// y los informes anteriores de Documentos/spy. No abre el navegador y tarda segundos.
//
//   node contexto.mjs [--dir <carpeta del proyecto>]
//
// Imprime un JSON corto con pistas de Instagram, web, nombre, precios y campos como "nicho:",
// y los archivos que conviene leer. Nunca abre .env, claves ni credenciales.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const SKILL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const iDir = argv.indexOf('--dir');
const DIR = path.resolve(iDir >= 0 && argv[iDir + 1] ? argv[iDir + 1] : process.cwd());
const HOME = os.homedir();

const SECRETO = /(^\.env|\.pem$|\.key$|\.p12$|\.pfx$|id_rsa|secret|credential|token|password|contrase)/i;
const SALTEAR = /^(node_modules|dist|build|out|coverage|vendor|venv|__pycache__|target|tmp|temp|AppData|Library|Pictures|Music|Videos|Movies|Downloads|Descargas|Imágenes|Música)$/i;
const TEXTO = /\.(md|mdx|markdown|txt|html?|json|ya?ml|toml|liquid|astro|vue|svelte|jsx?|tsx?|mjs|php)$/i;
const CODIGO = /\.(jsx?|tsx?|mjs|php|vue|svelte|astro|liquid)$/i;
const PROFUNDIDAD = 4;
const MAX_ARCHIVOS = 500;

// Dominios que aparecen en cualquier proyecto y no son la web de nadie.
const RUIDO = ['github.com', 'githubusercontent.com', 'github.io', 'gitlab.com', 'npmjs.com', 'npmjs.org', 'unpkg.com', 'jsdelivr.net',
  'cloudflare.com', 'googleapis.com', 'gstatic.com', 'google.com', 'googletagmanager.com', 'google-analytics.com', 'doubleclick.net',
  'facebook.com', 'facebook.net', 'fb.com', 'fb.me', 'fbcdn.net', 'instagram.com', 'cdninstagram.com', 'meta.com', 'whatsapp.com', 'wa.me', 'ig.me', 'm.me',
  'youtube.com', 'youtu.be', 'tiktok.com', 'twitter.com', 'x.com', 'linkedin.com', 'pinterest.com', 'threads.net', 'threads.com',
  'vercel.app', 'vercel.com', 'netlify.app', 'netlify.com', 'w3.org', 'schema.org', 'example.com', 'example.org', 'localhost',
  'anthropic.com', 'claude.ai', 'claude.com', 'openai.com', 'chatgpt.com', 'microsoft.com', 'apple.com', 'mozilla.org', 'wikipedia.org',
  'stackoverflow.com', 'reddit.com', 'medium.com', 'notion.so', 'figma.com', 'canva.com', 'stripe.com', 'paypal.com', 'gravatar.com',
  'amazonaws.com', 'cloudfront.net', 'calendly.com', 'typeform.com', 'zoom.us', 'bit.ly', 'linktr.ee', 't.co', 'goo.gl', 'nodejs.org',
  'python.org', 'playwright.dev', 'tailwindcss.com', 'shields.io', 'sentry.io', 'hotjar.com', 'clarity.ms', 'shopify.com', 'myshopify.com',
  'wixsite.com', 'wordpress.org', 'wordpress.com', 'cdn.com', 'jquery.com', 'fontawesome.com', 'typekit.net'];
const EXTENSION = /^(html?|css|js|mjs|cjs|json|md|png|jpe?g|gif|svg|webp|mp4|mov|txt|xml|ya?ml|php|py|ts|tsx|jsx|map|lock|zip|pdf)$/i;
const IG_RESERVADO = /^(p|reel|reels|stories|explore|accounts|tv|direct|about|developer|legal|web|static|graphql|api)$/i;

const RE_IG = /instagram\.com\/([A-Za-z0-9._]{2,30})/gi;
const RE_IG_ARROBA = /\b(?:instagram|insta|ig)\b\s*[:=]?\s*@([A-Za-z0-9._]{2,30})/gi;
const RE_URL = /\bhttps?:\/\/(?:www\.)?([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+)/gi;
const RE_WEB = /\b(?:web|sitio|website|dominio|site|url|homepage)["']?\s*[:=]\s*["']?(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+)/gi;
const RE_CAMPO = /^[\s>*_#|-]*(nicho|rubro|niche|pa[ií]s|p[uú]blico(?: objetivo)?|cliente ideal|audiencia|objetivo|presupuesto|oferta(?: principal)?|precios?|producto(?: principal)?|servicios?|marca|brand|propuesta de valor|diferencial)\**\s*[:=]\s*\**\s*(.{2,160})$/gim;
const RE_PRECIO = /(?:US\$|USD|ARS|AR\$|MXN|CLP|COP|€|\$|S\/)\s?\d[\d.,]*(?:\s?(?:USD|ARS|MXN|CLP|COP|EUR))?|\d[\d.,]*\s?(?:€|EUR\b|USD\b)/g;
const RE_TEMA = /marca|brand|oferta|offer|precio|pricing|plan(es)?\b|producto|product|servicio|cliente|avatar|p[uú]blico|audiencia|buyer|persona|nicho|landing|about|nosotros|readme|copy|guion|estrategia|pauta|anuncio|ads\b|campa[nñ]a|propuesta|brief|posicionamiento/i;

const leer = (f, max = 200_000) => {
  try {
    const st = fs.statSync(f);
    if (!st.isFile() || st.size > max || SECRETO.test(path.basename(f))) return null;
    return fs.readFileSync(f, 'utf8');
  } catch { return null; }
};
const real = (f) => { try { return fs.realpathSync(f); } catch { return null; } };

// ---------- 1. instrucciones: CLAUDE.md de la carpeta hacia arriba y de la configuración ----------
const configs = [...new Set([process.env.CLAUDE_CONFIG_DIR, path.join(HOME, '.claude')].filter(Boolean).map((d) => path.resolve(d)))];
const instrucciones = [];
const vistos = new Set();
const sumar = (lista, f, extra = {}) => {
  const r = real(f);
  if (!r || vistos.has(r) || leer(r) == null) return;
  vistos.add(r);
  lista.push({ ruta: r, ...extra });
};
for (let d = DIR; ; d = path.dirname(d)) {
  for (const n of ['CLAUDE.md', 'CLAUDE.local.md', path.join('.claude', 'CLAUDE.md'), 'AGENTS.md']) sumar(instrucciones, path.join(d, n), { peso: 3 });
  if (path.dirname(d) === d) break;
}
for (const c of configs) sumar(instrucciones, path.join(c, 'CLAUDE.md'), { peso: 2 });

// ---------- 2. memoria del proyecto ----------
const clave = DIR.replace(/[^a-zA-Z0-9]/g, '-');
const memoria = [];
for (const c of configs) {
  const dir = path.join(c, 'projects', clave, 'memory');
  let archivos = [];
  try { archivos = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch {}
  for (const f of archivos) sumar(memoria, path.join(dir, f), { peso: 3 });
}

// ---------- 3. archivos de la carpeta ----------
// Una carpeta general, como la del usuario o Documentos, tiene de todo: no se recorre.
const general = [HOME, path.join(HOME, 'Documents'), path.join(HOME, 'Documentos'), path.join(HOME, 'Desktop'), path.join(HOME, 'Escritorio'), path.join(HOME, 'OneDrive')]
  .map((d) => path.resolve(d).toLowerCase()).includes(DIR.toLowerCase()) || path.dirname(DIR) === DIR;
const archivos = [];
if (!general) {
  const cola = [[DIR, 0]];
  while (cola.length && archivos.length < MAX_ARCHIVOS) {
    const [d, prof] = cola.shift();
    let entradas = [];
    try { entradas = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entradas) {
      if (e.name.startsWith('.')) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (prof < PROFUNDIDAD && !SALTEAR.test(e.name)) cola.push([f, prof + 1]); continue; }
      if (!e.isFile() || !TEXTO.test(e.name) || SECRETO.test(e.name)) continue;
      if (/package-lock|yarn\.lock|pnpm-lock|\.min\./i.test(e.name)) continue;
      const r = real(f);
      if (!r || vistos.has(r)) continue;
      vistos.add(r);
      archivos.push({ ruta: r, peso: prof === 0 ? 2 : 1, codigo: CODIGO.test(e.name) });
      if (archivos.length >= MAX_ARCHIVOS) break;
    }
  }
}

// ---------- pistas ----------
const pistas = { instagram: new Map(), webs: new Map(), nombres: new Map() };
const campos = [];
const precios = new Map();
// Dentro de la carpeta, la ruta corta alcanza para saber de dónde salió la pista.
const corta = (ruta) => (ruta.toLowerCase().startsWith(DIR.toLowerCase() + path.sep) ? path.relative(DIR, ruta) : ruta);
const anotar = (mapa, valor, peso, ruta) => {
  const k = valor.toLowerCase();
  const p = mapa.get(k) || { valor, peso: 0, en: [] };
  p.peso += peso;
  if (p.en.length < 3 && !p.en.includes(corta(ruta))) p.en.push(corta(ruta));
  mapa.set(k, p);
};
const esWeb = (host) => {
  const h = host.toLowerCase().replace(/\.$/, '');
  const tld = h.split('.').pop();
  if (!/^[a-z]{2,12}$/.test(tld) || EXTENSION.test(tld)) return false;
  return !RUIDO.some((r) => h === r || h.endsWith('.' + r));
};
const textoPlano = (s, html) => (html ? s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ') : s);

function analizar(item) {
  const crudo = leer(item.ruta);
  if (crudo == null) return 0;
  const html = /\.html?$/i.test(item.ruta);
  const plano = textoPlano(crudo, html);
  let hits = 0;
  for (const [, u] of crudo.matchAll(RE_IG)) if (!IG_RESERVADO.test(u)) { anotar(pistas.instagram, u.replace(/\.$/, ''), item.peso, item.ruta); hits++; }
  for (const [, u] of crudo.matchAll(RE_IG_ARROBA)) { anotar(pistas.instagram, u.replace(/\.$/, ''), item.peso, item.ruta); hits++; }
  for (const re of [RE_URL, RE_WEB]) for (const [, h] of crudo.matchAll(re)) if (esWeb(h)) { anotar(pistas.webs, h.toLowerCase().replace(/^www\./, ''), item.peso, item.ruta); hits++; }
  if (html && !/^(404|500|error)\b/i.test(path.basename(item.ruta))) {
    const sitio = crudo.match(/property=["']og:site_name["'][^>]*content=["']([^"']{2,60})/i)?.[1];
    const titulo = crudo.match(/<title>([^<]{2,120})<\/title>/i)?.[1]?.split(/\s[|\-–·:]\s/)[0]?.trim();
    for (const n of [sitio, titulo]) if (n) anotar(pistas.nombres, n, item.peso, item.ruta);
    const canon = crudo.match(/rel=["']canonical["'][^>]*href=["']https?:\/\/(?:www\.)?([^/"']+)/i)?.[1] || crudo.match(/property=["']og:url["'][^>]*content=["']https?:\/\/(?:www\.)?([^/"']+)/i)?.[1];
    if (canon && esWeb(canon)) anotar(pistas.webs, canon.toLowerCase(), item.peso + 2, item.ruta);
  }
  if (path.basename(item.ruta) === 'package.json') {
    try {
      const pkg = JSON.parse(crudo);
      const home = pkg.homepage?.match(/https?:\/\/(?:www\.)?([^/]+)/)?.[1];
      if (home && esWeb(home)) anotar(pistas.webs, home.toLowerCase(), item.peso + 2, item.ruta);
    } catch {}
  }
  if (!item.codigo) {
    for (const [, campo, valor] of plano.matchAll(RE_CAMPO)) {
      if (campos.length < 40) campos.push({ campo: campo.toLowerCase(), valor: valor.trim().replace(/\*+$/, ''), en: corta(item.ruta) });
      hits++;
    }
  }
  const tema = (plano.match(new RegExp(RE_TEMA.source, 'gi')) || []).length;
  const susPrecios = item.codigo ? [] : plano.match(RE_PRECIO) || [];
  if (susPrecios.length && (tema >= 3 || RE_TEMA.test(path.basename(item.ruta)))) {
    for (const p of susPrecios.slice(0, 20)) anotar(precios, p.trim(), 1, item.ruta);
  }
  return hits * 2 + Math.min(tema, 20) + (RE_TEMA.test(path.relative(DIR, item.ruta)) ? 8 : 0) + (susPrecios.length ? 3 : 0);
}

for (const it of [...instrucciones, ...memoria, ...archivos]) it.puntos = analizar(it);

// ---------- 4. perfiles guardados e informes anteriores ----------
const perfiles = [];
try {
  for (const f of fs.readdirSync(path.join(SKILL, 'marcas')).filter((x) => x.endsWith('.json'))) {
    const ruta = path.join(SKILL, 'marcas', f);
    try {
      const p = JSON.parse(fs.readFileSync(ruta, 'utf8'));
      perfiles.push({ ruta, nombre: p.nombre, instagram: p.instagram, web: p.web, pais: p.pais, actualizado: fs.statSync(ruta).mtime.toISOString().slice(0, 10) });
    } catch {}
  }
} catch {}

const informes = [];
for (const base of [path.join(HOME, 'Documents', 'spy'), path.join(HOME, 'Documentos', 'spy')]) {
  let dirs = [];
  try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { continue; }
  for (const e of dirs) {
    const carpeta = path.join(base, e.name);
    try {
      const m = JSON.parse(fs.readFileSync(path.join(carpeta, 'marca.json'), 'utf8'));
      informes.push({
        carpeta, fecha: (m.generado || '').slice(0, 10), instagram: m.instagram?.usuario || null, web: m.web?.url || null, nicho: m.nicho || null,
        analisis: fs.existsSync(path.join(carpeta, 'analisis.json')),
      });
    } catch {}
  }
}
informes.sort((a, b) => b.fecha.localeCompare(a.fecha));

// ---------- salida ----------
const top = (mapa, n) => [...mapa.values()].sort((a, b) => b.peso - a.peso).slice(0, n);
const motivo = (it) => {
  const r = [];
  const c = corta(it.ruta);
  if (campos.some((x) => x.en === c)) r.push('campos');
  if ([...precios.values()].some((p) => p.en.includes(c))) r.push('precios');
  if ([...pistas.instagram.values(), ...pistas.webs.values()].some((p) => p.en.includes(c))) r.push('links');
  return r.join(', ') || 'habla de la marca o de su oferta';
};
const relevantes = (lista, n, min) => lista.filter((it) => it.puntos >= min).sort((a, b) => b.puntos - a.puntos).slice(0, n).map((it) => ({ ruta: it.ruta, por: motivo(it) }));

console.log(JSON.stringify({
  carpeta: DIR,
  carpeta_recorrida: !general,
  archivos_revisados: archivos.length,
  instrucciones: instrucciones.map((it) => it.ruta),
  memoria: relevantes(memoria, 12, 1),
  leer: relevantes(archivos, 8, 6),
  pistas: {
    instagram: top(pistas.instagram, 6),
    webs: top(pistas.webs, 6),
    nombres: top(pistas.nombres, 4),
    campos: campos.slice(0, 20),
    precios: top(precios, 12).map((p) => p.valor),
  },
  perfiles,
  informes: informes.slice(0, 10),
}, null, 1));
