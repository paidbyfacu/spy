// Scraper de la Biblioteca de anuncios de Meta, sin login ni API.
// Abre la biblioteca con Chrome, Edge o el Chromium de Playwright, lee el JSON que trae la página
// y el de cada scroll (AdLibrarySearchPaginationQuery), normaliza los anuncios y baja las imágenes.
//
//   node scrape.mjs marca --ig instagram.com/tumarca --web tumarca.com --nicho fitness --out <carpeta>
//   node scrape.mjs descubrir --q "proteina whey" --q "batidos" --pais AR --out <carpeta>
//   node scrape.mjs paginas --pagina 282592881929497 --pagina "Huel" --pais ALL --out <carpeta> [--propia <id o nombre>]
//   node scrape.mjs imagenes --out <carpeta>   (después de analisis.json: baja las imágenes citadas que falten)
//
// Salida en <carpeta>: descubrir.json, paginas/<page_id>.json, img/<ad_id>.jpg y resumen.json (lo que lee Claude).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(DIR, 'package.json'));
let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch {
  console.error(`Falta playwright-core. Corre: npm install --prefix "${DIR}"`);
  process.exit(2);
}

// ---------- argumentos ----------
const [cmd, ...rest] = process.argv.slice(2);
const args = { q: [], pagina: [] };
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  if (Array.isArray(args[k])) args[k].push(v);
  else args[k] = v;
}
const PAIS = String(args.pais || 'ALL').toUpperCase();
const OUT = path.resolve(args.out || path.join(os.homedir(), 'Documents', 'spy', `spy-${hoy()}`));
const HEADED = !!args.ver;
const MAX_GANADORES = +args['max-ganadores'] || 120;
const MAX_NUEVOS = +args['max-nuevos'] || 60;
const MAX_APAGADOS = +args['max-apagados'] || 60;
const MAX_DESCUBRIR = +args['max-descubrir'] || 150;
fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'paginas'), { recursive: true });

function hoy() { return new Date().toISOString().slice(0, 10); }
const log = (...m) => console.log('[spy]', ...m);
const DIA = 86400;

// ---------- navegador ----------
async function abrirNavegador() {
  const intentos = [{ channel: 'chrome' }, { channel: 'msedge' }, {}];
  for (const extra of intentos) {
    try {
      return await chromium.launch({ headless: !HEADED, ...extra, args: ['--disable-blink-features=AutomationControlled'] });
    } catch {}
  }
  console.error('No encontré Chrome, Edge ni Chromium. Instala Chrome o corre: npx playwright install chromium');
  process.exit(2);
}

// El navegador también arma las hojas de contacto con canvas, por eso lo abre hasta el comando resumen.
const browser = ['marca', 'descubrir', 'paginas', 'resumen', 'imagenes'].includes(cmd) ? await abrirNavegador() : null;
const ctx = await browser?.newContext({
  locale: 'es-AR',
  viewport: { width: 1366, height: 900 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
});

function urlBiblioteca({ q, pageId, activos = true, orden = 'total_impressions' }) {
  const p = new URLSearchParams({
    active_status: activos ? 'active' : 'inactive',
    ad_type: 'all',
    country: PAIS,
    is_targeted_country: 'false',
    media_type: 'all',
    'sort_data[mode]': orden,
    'sort_data[direction]': 'desc',
  });
  if (pageId) { p.set('search_type', 'page'); p.set('view_all_page_id', pageId); }
  else { p.set('search_type', 'keyword_unordered'); p.set('q', q); }
  return 'https://www.facebook.com/ads/library/?' + p.toString();
}

// Recorre cualquier JSON y junta los anuncios, venga del HTML inicial o de la paginación.
function recolectar(o, ads, meta, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 80) return;
  if (Array.isArray(o)) { for (const x of o) recolectar(x, ads, meta, depth + 1); return; }
  if (o.ad_archive_id && o.snapshot) { ads.push(o); return; }
  if (o.search_results_connection && typeof o.search_results_connection.count === 'number') {
    meta.count = Math.max(meta.count ?? 0, o.search_results_connection.count);
  }
  for (const k in o) recolectar(o[k], ads, meta, depth + 1);
}

async function leerLista(url, max) {
  const page = await ctx.newPage();
  const crudos = [];
  const meta = {};
  page.on('response', async (r) => {
    if (!r.url().includes('/api/graphql')) return;
    try {
      const t = (await r.text()).replace(/^for \(;;\);/, '');
      for (const linea of t.split('\n')) { try { recolectar(JSON.parse(linea), crudos, meta); } catch {} }
    } catch {}
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    if (/login|checkpoint/.test(page.url())) throw new Error('Meta pidió iniciar sesión: proba de nuevo con --ver');
    const scripts = await page.$$eval('script[type="application/json"]', (els) => els.map((e) => e.textContent));
    for (const s of scripts) { try { recolectar(JSON.parse(s), crudos, meta); } catch {} }
    let quietos = 0;
    while (unicos(crudos).length < max && quietos < 3) {
      const antes = unicos(crudos).length;
      await page.mouse.wheel(0, 30000);
      await page.waitForTimeout(2200);
      quietos = unicos(crudos).length === antes ? quietos + 1 : 0;
    }
  } finally {
    await page.close();
  }
  return { ads: unicos(crudos).slice(0, max), total: meta.count ?? null };
}

// Un anuncio por creador, para mostrar caras distintas.
function unicosPorPagina(lista) {
  const vistos = new Set();
  return lista.filter((a) => (vistos.has(a.creador) ? false : vistos.add(a.creador)));
}

function unicos(lista) {
  const vistos = new Set();
  return lista.filter((a) => (vistos.has(a.ad_archive_id) ? false : vistos.add(a.ad_archive_id)));
}

// ---------- normalización ----------
const fecha = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : null);
const limpiar = (s) => (typeof s === 'string' && !/\{\{.*\}\}/.test(s) ? s.trim() : '');

function normalizar(a, estado, rank) {
  const s = a.snapshot || {};
  const card = (s.cards || [])[0] || {};
  const video = (s.videos || [])[0] || {};
  const imagen = (s.images || [])[0] || {};
  const ahora = Date.now() / 1000;
  const fin = estado === 'activo' ? ahora : a.end_date || ahora;
  const link = s.link_url || card.link_url || '';
  let dominio = '';
  try { dominio = new URL(link).hostname.replace(/^www\./, ''); } catch {}
  let formato = s.display_format || 'DESCONOCIDO';
  if (formato === 'DCO' || formato === 'DPA') formato += card.video_hd_url || card.video_sd_url ? '_VIDEO' : '_IMAGEN';
  if (formato === 'CAROUSEL' || formato === 'MULTI_IMAGES') formato = 'CARRUSEL';
  return {
    id: a.ad_archive_id,
    page_id: a.page_id || s.page_id,
    page_name: a.page_name || s.page_name,
    estado,
    rank,
    inicio: fecha(a.start_date),
    fin: estado === 'activo' ? null : fecha(a.end_date),
    dias: a.start_date ? Math.max(0, Math.round((fin - a.start_date) / DIA)) : null,
    formato,
    versiones: a.collation_count || 1,
    plataformas: a.publisher_platform || [],
    texto: limpiar(s.body?.text) || limpiar(card.body),
    titulo: limpiar(s.title) || limpiar(card.title),
    descripcion: limpiar(s.link_description) || limpiar(card.link_description),
    cta: s.cta_text || card.cta_text || '',
    link,
    dominio,
    tarjetas: (s.cards || []).length,
    partner: s.branded_content && s.branded_content.page_id !== (a.page_id || s.page_id) ? s.branded_content.page_name : null,
    partner_id: s.branded_content?.page_id || null,
    seguidores: s.page_like_count ?? null,
    avatar_url: s.page_profile_picture_url || null,
    imagen_url:
      imagen.resized_image_url || imagen.original_image_url || video.video_preview_image_url ||
      card.resized_image_url || card.original_image_url || card.video_preview_image_url || null,
    biblioteca: `https://www.facebook.com/ads/library/?id=${a.ad_archive_id}`,
  };
}

// ---------- imágenes: se bajan y se achican a 640 px para que el informe pese poco ----------
let lienzo;
async function bajarImagen(ad) {
  if (!ad.imagen_url) return null;
  const rel = `img/${ad.id}.jpg`;
  const destino = path.join(OUT, rel);
  if (fs.existsSync(destino)) return rel;
  try {
    const r = await ctx.request.get(ad.imagen_url, { timeout: 20000, headers: { referer: 'https://www.facebook.com/' } });
    if (!r.ok()) return null;
    const buf = await r.body();
    const tipo = r.headers()['content-type'] || 'image/jpeg';
    lienzo ??= await ctx.newPage();
    const b64 = await lienzo.evaluate(async ({ data, tipo }) => {
      const img = new Image();
      img.src = `data:${tipo};base64,${data}`;
      await img.decode();
      const k = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.8).split(',')[1];
    }, { data: buf.toString('base64'), tipo });
    fs.writeFileSync(destino, Buffer.from(b64, 'base64'));
    return rel;
  } catch {
    return null;
  }
}

async function bajarImagenes(ads, cuantas) {
  for (const ad of ads.slice(0, cuantas)) ad.img = await bajarImagen(ad);
}

// Hoja de contacto: los anuncios clave de una marca en una sola imagen con etiquetas,
// para que Claude los mire con una lectura en vez de una por anuncio.
async function hojaDeContacto(pageId, celdas) {
  const conImagen = celdas.filter((c) => c.ad.img && fs.existsSync(path.join(OUT, c.ad.img)));
  if (!conImagen.length) return null;
  lienzo ??= await ctx.newPage();
  const datos = conImagen.map((c) => ({ etiqueta: c.etiqueta, data: fs.readFileSync(path.join(OUT, c.ad.img)).toString('base64') }));
  const b64 = await lienzo.evaluate(async (datos) => {
    const COL = 4, W = 320, H = 400, BAR = 30;
    const c = document.createElement('canvas');
    c.width = COL * W;
    c.height = Math.ceil(datos.length / COL) * (H + BAR);
    const g = c.getContext('2d');
    g.fillStyle = '#111';
    g.fillRect(0, 0, c.width, c.height);
    for (const [i, d] of datos.entries()) {
      const img = new Image();
      img.src = `data:image/jpeg;base64,${d.data}`;
      await img.decode();
      const x = (i % COL) * W, y = Math.floor(i / COL) * (H + BAR);
      const k = Math.min(W / img.naturalWidth, H / img.naturalHeight);
      const w = img.naturalWidth * k, h = img.naturalHeight * k;
      g.drawImage(img, x + (W - w) / 2, y + BAR + (H - h) / 2, w, h);
      g.fillStyle = d.etiqueta.startsWith('A') ? '#b3261e' : '#1d5fe0';
      g.fillRect(x, y, W, BAR);
      g.fillStyle = '#fff';
      g.font = '600 17px sans-serif';
      g.fillText(d.etiqueta, x + 8, y + 21);
    }
    return c.toDataURL('image/jpeg', 0.82).split(',')[1];
  }, datos);
  const rel = `img/hoja-${pageId}.jpg`;
  fs.writeFileSync(path.join(OUT, rel), Buffer.from(b64, 'base64'));
  return { img: rel, celdas: conImagen.map((c) => ({ etiqueta: c.etiqueta.split(' ')[0], id: c.ad.id })) };
}

// G = ganador, N = nuevo, A = apagado en 7 días o menos, C = creador.
function armarHoja(p) {
  const etiquetar = (lista, letra, n, f) => lista.filter((a) => a.img).slice(0, n).map((ad, k) => ({ ad, etiqueta: `${letra}${k + 1} ${f(ad)}` }));
  return hojaDeContacto(p.page_id, [
    ...etiquetar([...p.ganadores].sort((a, b) => b.puntaje - a.puntaje), 'G', 8, (a) => `#${a.rank} · ${a.dias} días`),
    ...etiquetar(p.nuevos.filter((a) => a.dias <= 14), 'N', 4, (a) => `${a.dias} días`),
    ...etiquetar(p.apagados.filter((a) => a.dias <= 7), 'A', 4, (a) => `apagado en ${a.dias} d`),
    ...etiquetar(unicosPorPagina(p.creadores || []), 'C', 4, (a) => String(a.creador).slice(0, 22)),
  ]);
}

// ---------- estadísticas ----------
function contar(lista, f) {
  const m = {};
  for (const x of lista) { const k = f(x); if (k) m[k] = (m[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}
const mediana = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const ganchoDe = (t) => (t || '').split(/\n|(?<=[.!?¡¿])\s/)[0].slice(0, 160);

function estadisticas(p) {
  const activos = [...p.ganadores, ...p.nuevos.filter((n) => !p.ganadores.some((g) => g.id === n.id))];
  const hace = (d) => new Date(Date.now() - d * DIA * 1000).toISOString().slice(0, 10);
  const lanzados = contar(activos.filter((a) => a.inicio >= hace(30)), (a) => a.inicio);
  const [diaPico, cantPico] = Object.entries(lanzados).sort((a, b) => b[1] - a[1])[0] || [];
  return {
    activos_total: p.activos_total,
    inactivos_total: p.inactivos_total,
    muestra_activos: activos.length,
    formatos: contar(activos, (a) => a.formato),
    plataformas: contar(activos.flatMap((a) => a.plataformas), (x) => x),
    lanzados_7d: activos.filter((a) => a.inicio >= hace(7)).length,
    lanzados_30d: activos.filter((a) => a.inicio >= hace(30)).length,
    // Si hasta el más viejo de la muestra de nuevos es de esta semana, la cifra real es mayor.
    lanzados_7d_es_minimo: p.nuevos.length > 0 && p.nuevos.every((a) => a.inicio >= hace(7)),
    dia_pico: diaPico ? { fecha: diaPico, anuncios: cantPico } : null,
    mediana_dias_activos: mediana(activos.map((a) => a.dias)),
    pct_mas_de_30_dias: activos.length ? Math.round((100 * activos.filter((a) => a.dias >= 30).length) / activos.length) : 0,
    mediana_dias_apagados: mediana(p.apagados.map((a) => a.dias)),
    apagados_en_7_dias: p.apagados.filter((a) => a.dias <= 7).length,
    ctas: contar(activos, (a) => a.cta),
    dominios: contar(activos, (a) => a.dominio),
    partners: contar(activos, (a) => a.partner),
    creadores: contar(p.creadores, (a) => a.creador),
    anuncios_de_creadores: p.creadores.length,
    con_versiones: activos.filter((a) => a.versiones > 1).length,
  };
}

// Ganador: está entre los de más impresiones y lleva tiempo corriendo. Meta no publica resultados,
// pero nadie deja prendido un anuncio que pierde plata, y el orden por impresiones lo decide Meta.
function puntaje(a, total) {
  const porImpresiones = 1 - (a.rank - 1) / Math.max(total, 1);
  const porDias = Math.min(a.dias || 0, 120) / 120;
  return +(0.6 * porImpresiones + 0.3 * porDias + 0.1 * Math.min(a.versiones - 1, 5) / 5).toFixed(3);
}

// ---------- comandos ----------
async function descubrir() {
  if (!args.q.length) throw new Error('Falta --q "palabra clave"');
  const anunciantes = {};
  const busquedas = [];
  for (const q of args.q) {
    log(`Buscando "${q}" en ${PAIS}…`);
    const { ads, total } = await leerLista(urlBiblioteca({ q }), MAX_DESCUBRIR);
    busquedas.push({ q, total, leidos: ads.length });
    ads.forEach((a, i) => {
      const n = normalizar(a, 'activo', i + 1);
      const k = n.page_id;
      anunciantes[k] ??= { page_id: k, page_name: n.page_name, seguidores: n.seguidores, apariciones: 0, peso: 0, busquedas: new Set(), ejemplo: '' };
      const x = anunciantes[k];
      x.apariciones++;
      x.peso += 1 / Math.sqrt(i + 1);
      x.busquedas.add(q);
      if (!x.ejemplo) x.ejemplo = ganchoDe(n.texto);
    });
  }
  const lista = Object.values(anunciantes)
    .map((x) => ({ ...x, busquedas: [...x.busquedas], peso: +x.peso.toFixed(2) }))
    .sort((a, b) => b.peso - a.peso);
  const salida = { generado: new Date().toISOString(), pais: PAIS, busquedas, anunciantes: lista };
  fs.writeFileSync(path.join(OUT, 'descubrir.json'), JSON.stringify(salida, null, 1));
  log(`Listo: ${lista.length} anunciantes en ${path.join(OUT, 'descubrir.json')}`);
  for (const x of lista.slice(0, 25)) console.log(`  ${x.page_id}\t${x.page_name}\tpeso ${x.peso}\t${x.apariciones} anuncios\t${x.seguidores ?? '?'} seguidores`);
}

async function resolverPagina(valor) {
  if (/^\d{6,}$/.test(valor)) return valor;
  const m = String(valor).match(/view_all_page_id=(\d+)/);
  if (m) return m[1];
  log(`Buscando la página de "${valor}"…`);
  const { ads } = await leerLista(urlBiblioteca({ q: valor }), 60);
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
  const conteo = {};
  for (const a of ads) {
    const k = a.page_id;
    conteo[k] ??= { id: k, nombre: a.page_name, n: 0 };
    conteo[k].n += norm(a.page_name) === norm(valor) ? 100 : norm(a.page_name).includes(norm(valor)) ? 10 : 1;
  }
  const mejor = Object.values(conteo).sort((a, b) => b.n - a.n)[0];
  if (!mejor) throw new Error(`No encontré anuncios de "${valor}" en ${PAIS}`);
  log(`  → ${mejor.nombre} (${mejor.id})`);
  return mejor.id;
}

async function scrapearPagina(pageId, propia) {
  log(`Página ${pageId}: anuncios con más impresiones…`);
  const g = await leerLista(urlBiblioteca({ pageId }), MAX_GANADORES);
  log(`  ${g.ads.length} de ${g.total ?? '?'} activos. Anuncios más nuevos…`);
  const n = await leerLista(urlBiblioteca({ pageId, orden: 'relevancy_monthly_grouped' }), MAX_NUEVOS);
  log(`  ${n.ads.length} nuevos. Anuncios apagados hace poco…`);
  const i = await leerLista(urlBiblioteca({ pageId, activos: false, orden: 'relevancy_monthly_grouped' }), MAX_APAGADOS);
  log(`  ${i.ads.length} de ${i.total ?? '?'} apagados.`);

  const ganadores = g.ads.map((a, k) => normalizar(a, 'activo', k + 1));
  const total = g.total || ganadores.length;
  ganadores.forEach((a) => (a.puntaje = puntaje(a, total)));
  const rankPorId = Object.fromEntries(ganadores.map((a) => [a.id, a.rank]));
  const nuevos = n.ads.map((a) => normalizar(a, 'activo', rankPorId[a.ad_archive_id] ?? null));
  const apagados = i.ads.map((a, k) => normalizar(a, 'apagado', k + 1));
  const nombre = ganadores[0]?.page_name || nuevos[0]?.page_name || apagados[0]?.page_name || pageId;

  // Creadores: anuncios de la marca en partnership con un creador, y los que salen desde la cuenta
  // del creador con la marca como partner, que solo aparecen buscando el nombre de la marca.
  log(`  Anuncios de creadores para ${nombre}…`);
  const c = await leerLista(urlBiblioteca({ q: nombre }), 90);
  const propios = [...ganadores, ...nuevos.filter((x) => !ganadores.some((g) => g.id === x.id))];
  const creadores = [
    ...propios.filter((a) => a.partner).map((a) => ({ ...a, creador: a.partner })),
    ...c.ads
      .map((a, k) => normalizar(a, 'activo', k + 1))
      .filter((a) => a.page_id !== pageId && a.partner_id === pageId)
      .map((a) => ({ ...a, rank: null, creador: a.page_name })),
  ];

  const p = { page_id: pageId, page_name: nombre, propia: !!propia, pais: PAIS, activos_total: g.total, inactivos_total: i.total, ganadores, nuevos, apagados, creadores };
  p.stats = estadisticas(p);

  // Imágenes: los mejores ganadores, los nuevos y los apagados rápido, que son los que va a mirar Claude.
  const top = [...ganadores].sort((a, b) => b.puntaje - a.puntaje);
  await bajarImagenes(top, 16);
  await bajarImagenes(nuevos.filter((a) => !a.img), 8);
  await bajarImagenes(apagados.filter((a) => a.dias <= 7), 8);
  await bajarImagenes(unicosPorPagina(creadores), 6);
  for (const lista of [ganadores, nuevos, apagados, creadores]) for (const a of lista) a.img ??= fs.existsSync(path.join(OUT, `img/${a.id}.jpg`)) ? `img/${a.id}.jpg` : null;
  // Foto de perfil de la página, para que el informe muestre cada anuncio como se ve en el feed.
  const conAvatar = [...ganadores, ...nuevos, ...apagados].find((a) => a.page_id === pageId && a.avatar_url);
  p.avatar = conAvatar ? await bajarImagen({ id: `avatar-${pageId}`, imagen_url: conAvatar.avatar_url }) : null;

  p.hoja = await armarHoja(p);

  fs.writeFileSync(path.join(OUT, 'paginas', `${pageId}.json`), JSON.stringify(p, null, 1));
  log(`  Guardado: ${nombre}`);
  return p;
}

// ---------- tu marca: Instagram, web y si ya anuncia ----------
const PAISES = [
  ['AR', /\.com\.ar\b|\+54\s?9?\s?\d|\bARS\b|es-AR/i], ['MX', /\.com\.mx\b|\.mx\b|\+52\s?\d|\bMXN\b|es-MX/i], ['CL', /\.cl\b|\+56\s?\d|\bCLP\b|es-CL/i],
  ['CO', /\.com\.co\b|\.co\/|\+57\s?\d|\bCOP\b|es-CO/i], ['PE', /\.pe\b|\+51\s?\d|\bPEN\b|S\/\s?\d|es-PE/i], ['UY', /\.com\.uy\b|\+598\s?\d|\bUYU\b|es-UY/i],
  ['ES', /\.es\b|\+34\s?\d|es-ES/i], ['US', /\+1\s?\(?\d{3}|en-US/i],
];

async function leerWeb(url) {
  if (!/^https?:/.test(url)) url = 'https://' + url;
  const page = await ctx.newPage();
  const extraer = () => page.evaluate(() => {
    const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const meta = (n) => document.querySelector(`meta[name="${n}"],meta[property="${n}"]`)?.content || '';
    const html = document.documentElement.outerHTML;
    const links = [...document.querySelectorAll('a[href]')].map((a) => ({ txt: t(a.innerText).slice(0, 60), href: a.href }));
    return {
      url: location.href,
      titulo: document.title,
      descripcion: meta('description') || meta('og:description'),
      idioma: document.documentElement.lang || '',
      encabezados: [...document.querySelectorAll('h1,h2,h3')].map((h) => t(h.innerText)).filter(Boolean).slice(0, 30),
      botones: [...new Set([...document.querySelectorAll('button,a[class*="btn"],a[class*="button"],[role="button"]')].map((b) => t(b.innerText)).filter((x) => x && x.length < 40))].slice(0, 25),
      texto: t(document.body?.innerText).slice(0, 6000),
      links,
      seguimiento: {
        pixel_meta: /connect\.facebook\.net|fbq\(/.test(html),
        google: /googletagmanager|gtag\(|google-analytics/.test(html),
        tiktok: /analytics\.tiktok\.com|ttq\./.test(html),
      },
      plataforma: (html.match(/shopify|tiendanube|woocommerce|wix|hotmart|mercadopago|stripe|kajabi|squarespace|webflow|framer|wordpress/gi) || []).map((x) => x.toLowerCase()).filter((x, i, a) => a.indexOf(x) === i),
    };
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3500);
    const inicio = await extraer();
    const destino = path.join(OUT, 'img', 'marca-web.jpg');
    await page.screenshot({ path: destino, type: 'jpeg', quality: 72 });
    // Hasta 3 páginas internas que suelen tener la oferta: planes, precios, productos, servicios.
    const host = new URL(inicio.url).hostname;
    const internas = [...new Map(inicio.links
      .filter((l) => { try { return new URL(l.href).hostname === host && /plan|precio|pricing|programa|servicio|producto|product|shop|tienda|coaching|asesor|membres|curso|oferta/i.test(l.href + ' ' + l.txt); } catch { return false; } })
      .map((l) => [l.href.split('#')[0], l])).values()].slice(0, 3);
    const paginas = [];
    for (const l of internas) {
      try {
        await page.goto(l.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        const x = await extraer();
        paginas.push({ url: x.url, titulo: x.titulo, encabezados: x.encabezados.slice(0, 12), texto: x.texto.slice(0, 2500) });
      } catch {}
    }
    const todo = [inicio.texto, ...paginas.map((p) => p.texto)].join(' ');
    const redes = inicio.links.map((l) => l.href).filter((h) => /instagram\.com|facebook\.com|tiktok\.com|youtube\.com|wa\.me|whatsapp/i.test(h));
    return {
      ...inicio, links: undefined,
      precios: [...new Set(todo.match(/(?:US\$|USD|ARS|AR\$|MXN|CLP|COP|€|\$|S\/)\s?\d[\d.,]*(?:\s?(?:USD|ARS|MXN|CLP|COP|EUR))?/g) || [])].slice(0, 20),
      redes: [...new Set(redes)].slice(0, 10),
      paginas,
      captura: 'img/marca-web.jpg',
    };
  } finally {
    await page.close();
  }
}

// Instagram ya no responde su API sin sesión, pero el perfil público trae en la página el usuario
// y sus últimos 12 posts con texto e imagen; likes y fechas solo se ven con sesión.
async function leerInstagram(valor) {
  const usuario = String(valor).replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '').split(/[/?#]/)[0];
  const url = `https://www.instagram.com/${usuario}/`;
  const movil = await browser.newContext({
    locale: 'es-AR', viewport: { width: 430, height: 1400 }, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  const page = await movil.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    const scripts = await page.$$eval('script[type="application/json"]', (els) => els.map((e) => e.textContent));
    let u = null, edges = [];
    const buscar = (o, d = 0, clave = '') => {
      if (!o || typeof o !== 'object' || d > 60) return;
      if (Array.isArray(o)) { for (const x of o) buscar(x, d + 1, clave); return; }
      if ('biography' in o && o.username?.toLowerCase() === usuario.toLowerCase()) u ??= o;
      if (Array.isArray(o.edges) && /timeline/i.test(clave) && o.edges.length > edges.length) edges = o.edges;
      for (const k in o) buscar(o[k], d + 1, k);
    };
    for (const t of scripts) { try { buscar(JSON.parse(t)); } catch {} }
    const meta = await page.evaluate(() => ({
      titulo: document.querySelector('meta[property="og:title"]')?.content || '',
      descripcion: document.querySelector('meta[property="og:description"]')?.content || document.querySelector('meta[name="description"]')?.content || '',
      foto: document.querySelector('meta[property="og:image"]')?.content || '',
    }));
    const avatar = await bajarImagen({ id: 'marca-avatar', imagen_url: u?.profile_pic_url || meta.foto });
    const tipos = { 1: 'foto', 2: 'reel', 8: 'carrusel' };
    const posts = edges.map(({ node: n }) => ({
      tipo: n.product_type === 'clips' ? 'reel' : tipos[n.media_type] || 'post',
      fijado: !!n.is_timeline_pinned,
      texto: (n.caption?.text || '').slice(0, 600),
      url: n.seo_canonical_url || (n.code ? `https://www.instagram.com/p/${n.code}/` : null),
      imagen_url: (n.image_versions2?.candidates || []).find((c) => c.width <= 750)?.url || n.image_versions2?.candidates?.[0]?.url || n.display_uri || null,
    }));
    for (const [k, p] of posts.slice(0, 9).entries()) p.img = await bajarImagen({ id: `marca-post-${k + 1}`, imagen_url: p.imagen_url });
    return {
      usuario, url, completo: !!u,
      nombre: u?.full_name || meta.titulo.replace(/\s*\(@.*$/, ''),
      bio: u?.biography || '',
      seguidores: u?.follower_count ?? null, seguidos: u?.following_count ?? null,
      verificada: !!u?.is_verified, privada: !!u?.is_private,
      resumen_publico: meta.descripcion,
      avatar,
      posts: posts.map(({ imagen_url, ...p }) => p),
    };
  } catch (e) {
    return { usuario, url, completo: false, error: `Instagram no dejó leer el perfil: ${e.message}` };
  } finally {
    await movil.close();
  }
}

// Busca la página de la marca en la biblioteca por su nombre, su usuario y su dominio.
async function buscarAnunciante({ nombres, dominio }) {
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
  const claves = nombres.map(norm).filter((x) => x.length > 2);
  const candidatos = {};
  for (const q of [...new Set(nombres.filter(Boolean))].slice(0, 3)) {
    log(`Buscando anuncios de "${q}"…`);
    const { ads } = await leerLista(urlBiblioteca({ q }), 40).catch(() => ({ ads: [] }));
    for (const a of ads) {
      const n = normalizar(a, 'activo', 0);
      const k = n.page_id;
      const nombre = norm(n.page_name);
      const pts = (claves.some((c) => nombre === c) ? 100 : claves.some((c) => nombre.includes(c) || c.includes(nombre)) ? 30 : 0) + (dominio && n.dominio.endsWith(dominio) ? 50 : 0);
      if (!pts) continue;
      candidatos[k] ??= { page_id: k, page_name: n.page_name, puntos: 0, anuncios_vistos: 0 };
      candidatos[k].puntos += pts;
      candidatos[k].anuncios_vistos++;
    }
  }
  return Object.values(candidatos).sort((a, b) => b.puntos - a.puntos).slice(0, 3);
}

async function leerMarca() {
  if (!args.ig && !args.web) throw new Error('Falta --ig <usuario o link> o --web <dominio>');
  const salida = { generado: new Date().toISOString(), nicho: args.nicho || '' };
  if (args.web) { log(`Leyendo la web ${args.web}…`); salida.web = await leerWeb(String(args.web)).catch((e) => ({ url: args.web, error: e.message })); }
  if (args.ig) { log(`Leyendo el Instagram ${args.ig}…`); salida.instagram = await leerInstagram(String(args.ig)); }
  const ig = salida.instagram || {};
  const w = salida.web || {};
  let dominio = '';
  try { dominio = new URL(w.url || '').hostname.replace(/^www\./, ''); } catch {}
  salida.biblioteca = await buscarAnunciante({ nombres: [ig.nombre, ig.usuario, w.titulo?.split(/[|\-–·:]/)[0]?.trim()], dominio });
  const pista = [w.idioma, dominio, w.texto, ...(w.precios || []), ig.bio].join(' ');
  salida.pais_probable = PAISES.find(([, re]) => re.test(pista))?.[0] || null;
  const celdas = (ig.posts || []).filter((p) => p.img).slice(0, 9).map((p, k) => ({ ad: { img: p.img, id: p.id }, etiqueta: `P${k + 1} ${p.tipo}${p.likes != null ? ` · ${p.likes} likes` : ''}` }));
  if (w.captura) celdas.unshift({ ad: { img: w.captura, id: 'web' }, etiqueta: 'WEB' });
  salida.hoja = await hojaDeContacto('marca', celdas);
  fs.writeFileSync(path.join(OUT, 'marca.json'), JSON.stringify(salida, null, 1));
  log(`Marca: ${ig.nombre || w.titulo || '?'} · ${ig.seguidores ?? '?'} seguidores · país probable ${salida.pais_probable ?? '?'}`);
  log(salida.biblioteca.length ? `  Ya anuncia en Meta: ${salida.biblioteca.map((b) => `${b.page_name} (${b.page_id})`).join(', ')}` : '  No encontré anuncios activos suyos en la biblioteca.');
  log(`Guardado: ${path.join(OUT, 'marca.json')}`);
}

// resumen.json: lo justo para que Claude analice sin leer miles de líneas.
async function escribirResumen() {
  const dir = path.join(OUT, 'paginas');
  const paginas = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  for (const p of paginas) {
    if (p.hoja && fs.existsSync(path.join(OUT, p.hoja.img))) continue;
    p.hoja = await armarHoja(p);
    fs.writeFileSync(path.join(dir, `${p.page_id}.json`), JSON.stringify(p, null, 1));
  }
  // El texto completo va solo en los ganadores; en el resto alcanza con el gancho, y así se gastan menos tokens.
  const corto = (a, conTexto) => ({
    id: a.id, rank: a.rank, dias: a.dias, inicio: a.inicio, fin: a.fin || undefined, formato: a.formato,
    versiones: a.versiones > 1 ? a.versiones : undefined, gancho: ganchoDe(a.texto),
    texto: conTexto ? (a.texto || '').slice(0, 320) : undefined, titulo: a.titulo || undefined,
    cta: a.cta || undefined, dominio: a.dominio || undefined, img: a.img || undefined,
  });
  // Un mismo gancho suele subirse muchas veces, en otro país o con otro recorte: va una vez, con cuántas copias tiene.
  const agrupar = (lista, n, conTexto) => {
    const grupos = new Map();
    for (const a of lista) {
      const k = (ganchoDe(a.texto) || a.titulo || a.id).toLowerCase().slice(0, 60);
      if (grupos.has(k)) { const g = grupos.get(k); g.copias = (g.copias || 1) + 1; g.otros_ids.push(a.id); continue; }
      if (grupos.size >= n) continue;
      grupos.set(k, { ...corto(a, conTexto), otros_ids: [] });
    }
    return [...grupos.values()].map((g) => ({ ...g, otros_ids: g.otros_ids.length ? g.otros_ids.slice(0, 3) : undefined }));
  };
  const resumen = {
    generado: new Date().toISOString(),
    carpeta: OUT,
    pais: PAIS,
    nota: 'rank = posición en el orden por impresiones de Meta, 1 es el que más impresiones tiene. dias = días corriendo. Ganador = muchas impresiones y muchos días. Apagado rápido = dias <= 7.',
    paginas: paginas.map((p) => ({
      page_id: p.page_id,
      page_name: p.page_name,
      propia: p.propia,
      hoja: p.hoja || null,
      stats: p.stats,
      ganadores: agrupar([...p.ganadores].sort((a, b) => b.puntaje - a.puntaje), 10, true),
      nuevos: agrupar(p.nuevos.filter((a) => a.dias <= 14), 8),
      apagados_rapido: agrupar(p.apagados.filter((a) => a.dias <= 7), 8),
      creadores: unicosPorPagina(p.creadores || []).slice(0, 6).map((a) => ({ creador: a.creador, ...corto(a) })),
    })),
  };
  // Un anuncio por línea: se lee entero con Read y pesa bastante menos que con sangría.
  const json = JSON.stringify(resumen, null, 1).replace(/\{\n\s+"(?:id|creador|etiqueta)": [\s\S]*?\n\s+\}/g, (m) => JSON.stringify(JSON.parse(m)));
  fs.writeFileSync(path.join(OUT, 'resumen.json'), json);
  log(`Resumen para analizar: ${path.join(OUT, 'resumen.json')}`);
}

// El scrape baja solo las primeras imágenes de cada lista. Después de escribir analisis.json,
// esto baja las de los anuncios citados que quedaron sin imagen.
async function completarImagenes() {
  const analisis = path.join(OUT, 'analisis.json');
  if (!fs.existsSync(analisis)) throw new Error(`No encuentro ${analisis}`);
  const citados = new Set(fs.readFileSync(analisis, 'utf8').match(/\b\d{10,20}\b/g) || []);
  const porId = new Map();
  const dirPaginas = path.join(OUT, 'paginas');
  for (const f of fs.existsSync(dirPaginas) ? fs.readdirSync(dirPaginas) : []) {
    const p = JSON.parse(fs.readFileSync(path.join(dirPaginas, f), 'utf8'));
    for (const lista of Object.values(p)) if (Array.isArray(lista)) for (const ad of lista) if (ad?.id) porId.set(ad.id, ad);
  }
  const faltan = [...citados].map((id) => porId.get(id)).filter((ad) => ad?.imagen_url && !fs.existsSync(path.join(OUT, 'img', `${ad.id}.jpg`)));
  log(`${faltan.length} anuncios citados sin imagen.`);
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  let ok = 0;
  for (const ad of faltan) if (await bajarImagen(ad)) ok++;
  log(`Bajadas: ${ok} de ${faltan.length}.`);
}

try {
  if (cmd === 'marca') await leerMarca();
  else if (cmd === 'descubrir') await descubrir();
  else if (cmd === 'paginas') {
    if (args.propia) args.pagina.push(args.propia);
    if (!args.pagina.length) throw new Error('Falta --pagina <id, nombre o link de la biblioteca>');
    const propiaId = args.propia ? await resolverPagina(args.propia) : null;
    for (const v of args.pagina) {
      try {
        const id = v === args.propia ? propiaId : await resolverPagina(v);
        await scrapearPagina(id, id === propiaId);
      } catch (e) {
        log(`  Salteo "${v}": ${e.message}`);
      }
    }
    await escribirResumen();
  } else if (cmd === 'resumen') await escribirResumen();
  else if (cmd === 'imagenes') await completarImagenes();
  else {
    console.log('Uso: node scrape.mjs marca --ig <usuario|link> --web <dominio> [--nicho fitness] --out <carpeta>');
    console.log('     node scrape.mjs descubrir --q "palabra" [--q ...] --pais AR --out <carpeta>');
    console.log('     node scrape.mjs paginas --pagina <id|nombre|link> [--pagina ...] [--propia <id|nombre>] --pais AR --out <carpeta>');
    process.exit(1);
  }
} finally {
  await browser?.close();
}
