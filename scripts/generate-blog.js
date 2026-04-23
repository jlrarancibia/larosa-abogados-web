'use strict';

// ============================================================
// generate-blog.js — La Rosa & Abogados
// Genera un artículo de blog diario usando Claude AI.
// Uso: node scripts/generate-blog.js
// Requiere: ANTHROPIC_API_KEY en variables de entorno
// Opcional: SERPER_API_KEY para búsqueda Google News mejorada
// ============================================================

const Anthropic = require('@anthropic-ai/sdk');
const fs        = require('fs');
const path      = require('path');
const https     = require('https');
const http      = require('http');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_FILE = path.join(ROOT, 'blog', 'tragedia-matute-alianza-lima-responsabilidad-legal.html');

const PRACTICE_AREAS = [
  'derecho laboral',
  'arrendamientos',
  'sucesiones',
  'derecho civil',
  'derecho de familia',
  'derecho comercial',
  'derecho societario',
];

// Unsplash photo IDs pre-verificados por tema
const UNSPLASH_IDS = {
  legal:      'photo-1589578527966-fdac0f44566c',
  juzgado:    'photo-1505664194779-8beaceb93d44',
  contrato:   'photo-1450101499163-c8848c66ca85',
  reunion:    'photo-1521791136064-7986c2920216',
  familia:    'photo-1529156069898-49953e39b3ac',
  laboral:    'photo-1568992687947-868a62a9f521',
  propiedad:  'photo-1560518883-ce09059eeffa',
  finanzas:   'photo-1554224155-6726b3ff858f',
  empresa:    'photo-1507003211169-0a1dd7228f2d',
  documentos: 'photo-1568667256549-094345857637',
};

// ── Utilidades HTTP ──────────────────────────────────────────

function httpGet(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 LaRosaBlog/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout fetching ' + url)); });
  });
}

function httpPost(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
    };
    const lib = url.startsWith('https') ? https : http;
    const urlObj = new URL(url);
    const req = lib.request({ hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, ...opts }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── 1. Fetch noticias ────────────────────────────────────────

async function fetchNewsFromRSS(query) {
  const encoded = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${encoded}&hl=es-419&gl=PE&ceid=PE:es-419`;
  try {
    const xml = await httpGet(url);
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const title   = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || block.match(/<title>(.*?)<\/title>/) || [])[1] || '';
      const snippet = (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || block.match(/<description>(.*?)<\/description>/) || [])[1] || '';
      const source  = (block.match(/<source[^>]*>(.*?)<\/source>/) || [])[1] || '';
      const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
      if (title) {
        items.push({
          title:   title.replace(/<[^>]+>/g, '').trim(),
          snippet: snippet.replace(/<[^>]+>/g, '').slice(0, 200).trim(),
          source:  source.trim(),
          date:    pubDate.trim(),
        });
      }
      if (items.length >= 5) break;
    }
    return items;
  } catch (e) {
    console.warn('RSS fetch failed for query:', query, e.message);
    return [];
  }
}

async function fetchNewsFromSerper(query) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  try {
    const raw = await httpPost(
      'https://google.serper.dev/news',
      { q: query, gl: 'pe', hl: 'es', num: 10 },
      { 'X-API-KEY': key }
    );
    const data = JSON.parse(raw);
    return (data.news || []).slice(0, 5).map(n => ({
      title:   n.title || '',
      snippet: (n.snippet || '').slice(0, 200),
      source:  n.source || '',
      date:    n.date || '',
    }));
  } catch (e) {
    console.warn('Serper fetch failed:', e.message);
    return [];
  }
}

async function fetchNews() {
  const queries = [
    'derecho laboral peru 2026',
    'arrendamiento desalojo peru',
    'sucesion herencia peru',
    'derecho civil codigo civil peru',
    'derecho familia divorcio alimentos peru',
  ];

  const allItems = [];
  for (const q of queries) {
    let items = await fetchNewsFromSerper(q);
    if (!items.length) items = await fetchNewsFromRSS(q);
    allItems.push(...items);
  }

  // Deduplicar por título similar
  const seen = new Set();
  return allItems.filter(item => {
    const key = item.title.toLowerCase().slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 15);
}

// ── 2. Extraer títulos ya publicados ────────────────────────

function getPublishedTitles() {
  const blogPath = path.join(ROOT, 'blog.html');
  try {
    const content = fs.readFileSync(blogPath, 'utf8');
    const titles = [];
    // Extrae <h2> dentro de elementos .blog-full-card
    const cardRegex = /class="blog-full-card"[\s\S]*?<h2>([\s\S]*?)<\/h2>/g;
    let match;
    while ((match = cardRegex.exec(content)) !== null) {
      const title = match[1].replace(/<[^>]+>/g, '').trim();
      if (title) titles.push(title);
    }
    return titles;
  } catch (e) {
    console.warn('No se pudo leer blog.html para obtener títulos publicados:', e.message);
    return [];
  }
}

// ── 3. Elegir tema con Claude Haiku ─────────────────────────

const EVERGREEN_FALLBACKS = [
  { title: 'Despido arbitrario en Perú: derechos del trabajador', practiceArea: 'derecho laboral', angle: 'Guía práctica sobre los derechos del trabajador ante un despido arbitrario en Perú' },
  { title: 'Contratos de arrendamiento: cláusulas esenciales 2026', practiceArea: 'arrendamientos', angle: 'Qué cláusulas no pueden faltar en un contrato de arrendamiento en Lima' },
  { title: 'Sucesión intestada en Perú: quiénes heredan sin testamento', practiceArea: 'sucesiones', angle: 'Guía sobre cómo funciona la herencia cuando no hay testamento en Perú' },
  { title: 'Responsabilidad civil extracontractual en Perú', practiceArea: 'derecho civil', angle: 'Cuándo y cómo reclamar daños y perjuicios bajo el Código Civil peruano' },
  { title: 'Pensión de alimentos: pasos para solicitarla en Perú', practiceArea: 'derecho de familia', angle: 'Proceso paso a paso para demandar pensión de alimentos en Lima' },
  { title: 'Constitución de empresa en Perú: SAC vs EIRL', practiceArea: 'derecho societario', angle: 'Comparativa legal para elegir el tipo de empresa más conveniente en Perú' },
  { title: 'CTS 2026: cálculo y derechos del trabajador peruano', practiceArea: 'derecho laboral', angle: 'Cómo se calcula la CTS y cuándo puede el trabajador retirarla' },
];

async function pickBestTopic(client, newsItems, publishedTitles = []) {
  const publishedBlock = publishedTitles.length
    ? `\n\nTemas YA PUBLICADOS en el blog (debes elegir un tema COMPLETAMENTE DIFERENTE, sin repetir ninguno de estos):\n${publishedTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : '';

  if (!newsItems.length) {
    // Fallback: rotar entre temas evergreen excluyendo los ya publicados
    const available = EVERGREEN_FALLBACKS.filter(fb =>
      !publishedTitles.some(pt => pt.toLowerCase().includes(fb.practiceArea.split(' ')[1] || fb.practiceArea))
    );
    const pick = available.length ? available[Math.floor(Math.random() * available.length)] : EVERGREEN_FALLBACKS[0];
    return {
      selectedNews: { title: pick.title, snippet: '', source: '' },
      practiceArea: pick.practiceArea,
      angle: pick.angle,
    };
  }

  const prompt = `Eres un estratega de contenidos para un estudio jurídico peruano.

Áreas de práctica del estudio: ${PRACTICE_AREAS.join(', ')}.
${publishedBlock}

De estas noticias recientes de Perú, selecciona la que más se conecte con las áreas del estudio, tenga mayor potencial de interés para personas naturales o empresas en Lima que buscan orientación legal, y que NO haya sido cubierta ya en el blog.

Noticias:
${newsItems.map((n, i) => `${i}. [${n.source}] ${n.title} — ${n.snippet}`).join('\n')}

Devuelve SOLO un JSON válido (sin markdown, sin texto extra):
{"newsIndex": N, "practiceArea": "área relevante", "angle": "ángulo editorial en 1 frase concreta"}`;

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text.replace(/```json?/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(raw);

  return {
    selectedNews: newsItems[parsed.newsIndex] || newsItems[0],
    practiceArea: parsed.practiceArea,
    angle: parsed.angle,
  };
}

// ── 3. Generar artículo con Claude Sonnet ───────────────────

function buildSlug(title) {
  const map = { á:'a',é:'e',í:'i',ó:'o',ú:'u',ü:'u',ñ:'n',à:'a',è:'e',ì:'i',ò:'o',ù:'u' };
  return title
    .toLowerCase()
    .replace(/[áéíóúüñàèìòù]/g, c => map[c] || c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 55) + '-peru-' + new Date().getFullYear();
}

function getLimaDate() {
  return new Date().toLocaleDateString('es-PE', {
    timeZone: 'America/Lima',
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function getMonthYear() {
  return new Date().toLocaleDateString('es-PE', {
    timeZone: 'America/Lima', month: 'long', year: 'numeric',
  }).replace(/^\w/, c => c.toUpperCase());
}

async function generateArticle(client, topic) {
  const today = getLimaDate();
  const idsJson = JSON.stringify(UNSPLASH_IDS, null, 2);

  const systemPrompt = `Eres Jorge H. La Rosa Ruiz, abogado fundador del estudio La Rosa & Abogados de Lima, Perú, con más de 20 años de experiencia. Escribes artículos de blog en español peruano formal pero accesible, dirigidos a personas naturales y empresas que buscan orientación legal en Lima.

REGLAS ESTRICTAS:
1. NUNCA inventes números de artículos del Código Civil, Penal u otras normas. Si no estás seguro del artículo exacto, escribe "según la normativa aplicable" o cita la ley sin número de artículo específico.
2. Los artículos que SÍ puedes citar con seguridad: Art. 219 CC (nulidad), Art. 950 CC (prescripción adquisitiva 10 años), Art. 1969 CC (resp. extracontractual), Art. 1970 CC (resp. objetiva), Art. 1983 CC (solidaridad), Art. 1985 CC (contenido indemnización), Art. 2001 CC (prescripción), Art. 111 CP (homicidio culposo), Art. 22-31 LPCL (despido), Art. 46 LPCL (indemnización por despido).
3. SIEMPRE incluye al final del artículo: "Este artículo es de carácter informativo y no constituye asesoría legal. Para orientación en tu caso específico, consúltanos."
4. Usa HTML semántico con las clases CSS del sitio.
5. El contenido de articleBodyHTML es TODO lo que va DENTRO de la etiqueta <article class="blog-full-content">, incluyendo el .blog-meta-bar inicial. NO incluyas la etiqueta <article> en sí.`;

  const userPrompt = `Genera un artículo completo de blog sobre el siguiente tema:

NOTICIA DE REFERENCIA: ${topic.selectedNews.title}
FUENTE: ${topic.selectedNews.source || 'Medios peruanos'}
CONTEXTO: ${topic.selectedNews.snippet}
ÁNGULO EDITORIAL: ${topic.angle}
ÁREA DE PRÁCTICA: ${topic.practiceArea}
FECHA HOY: ${today}

ESTRUCTURA REQUERIDA para articleBodyHTML:
1. <div class="blog-meta-bar"> con autor, fecha y categoría
2. <p class="blog-intro"> párrafo introductorio impactante (3-4 oraciones)
3. <figure class="blog-figure"> con <img> de Unsplash y <figcaption> con fuente
4. Al menos 4 secciones <h2> con contenido sustancioso
5. Mínimo 1 <div class="blog-highlight-box"> con <h3><i class="fa-solid fa-XXX"></i> Título</h3>
6. Mínimo 1 <table class="blog-table"> con <thead> y <tbody>
7. Mínimo 1 <ol class="blog-checklist"> con pasos accionables
8. Segunda <figure class="blog-figure"> en la mitad del artículo
9. Sección de preguntas frecuentes con <div class="faq-list"> y 5 <div class="faq-item">
10. <div class="blog-cta-box"> al final con botones de contacto y WhatsApp

Para las imágenes de Unsplash, elige el ID más relevante de esta tabla:
${idsJson}
Formato de URL: https://images.unsplash.com/PHOTO_ID?w=900&h=320&fit=crop&q=80

Para la tarjeta del blog, usar imagen: https://images.unsplash.com/PHOTO_ID?w=500&h=400&fit=crop&q=80

CLASES CSS disponibles:
- .blog-meta-bar, .blog-intro, .blog-highlight-box, .blog-figure
- .blog-table (con .blog-table thead tr para cabecera navy)
- .blog-checklist (ol con li que tiene <span class="check-num">N</span> y <div class="check-body"><strong>Título</strong><p>Desc</p></div>)
- .blog-cta-box (div con h3, p, y botones: .btn.btn-gold y .btn.btn-outline)
- .faq-list > .faq-item > button.faq-question y .faq-answer > p
- .source-link para enlaces externos a fuentes oficiales

Artículos relacionados a mencionar en sidebar (usa slugs exactos):
- abogado-civil-lima-peru-2026
- despido-arbitrario-peru-2026
- sucesion-intestada-peru
- desalojo-express-peru
- contrato-arrendamiento-peru-2026
- cts-2026-peru

Devuelve SOLO un JSON válido (sin markdown, sin texto extra):
{
  "title": "Título SEO (máx 65 caracteres)",
  "metaDescription": "Meta description (150-160 caracteres con keyword principal)",
  "h1": "H1 del artículo (puede ser más descriptivo que title)",
  "heroSubtitle": "Subtítulo breve bajo el H1 en la página",
  "practiceAreaLabel": "Etiqueta legible (ej: Derecho Laboral)",
  "readingMinutes": 6,
  "articleBodyHTML": "TODO el HTML del contenido (lo que va DENTRO de <article class=\\"blog-full-content\\">)",
  "faqSchema": [
    {"question": "Pregunta 1", "answer": "Respuesta completa 1"},
    {"question": "Pregunta 2", "answer": "Respuesta completa 2"},
    {"question": "Pregunta 3", "answer": "Respuesta completa 3"},
    {"question": "Pregunta 4", "answer": "Respuesta completa 4"},
    {"question": "Pregunta 5", "answer": "Respuesta completa 5"}
  ],
  "cardImageId": "photo-XXXXXXXXXXXXXXXXX",
  "cardImageAlt": "Alt text descriptivo para SEO",
  "cardPreviewText": "Resumen de 1-2 frases para la tarjeta del blog",
  "sidebarHeadingIcon": "fa-solid fa-scale-balanced",
  "sidebarHeading": "¿Necesitas asesoría en ${topic.practiceArea}?",
  "sidebarText": "Texto descriptivo del sidebar (1-2 frases)",
  "waText": "Texto URL-encoded para WhatsApp (ej: Hola%2C%20necesito%20orientaci%C3%B3n)",
  "relatedArticles": [
    {"slug": "slug-del-articulo", "title": "Título del artículo relacionado"},
    {"slug": "slug-del-articulo-2", "title": "Título del artículo relacionado 2"},
    {"slug": "slug-del-articulo-3", "title": "Título del artículo relacionado 3"}
  ],
  "ctaBandTitle": "Título del banner CTA al final de la página",
  "ctaBandText": "Texto motivador del banner CTA"
}`;

  let attempts = 0;
  while (attempts < 3) {
    try {
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      let raw = msg.content[0].text;
      // Strip markdown fences si las hay
      raw = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      return JSON.parse(raw);
    } catch (e) {
      attempts++;
      if (attempts >= 3) throw new Error('Fallo al generar artículo tras 3 intentos: ' + e.message);
      console.warn(`Intento ${attempts} fallido:`, e.message, '— reintentando en 5s...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ── 4. Extraer bloques estáticos del template ────────────────

function extractStaticBlocks(templateHTML) {
  // GTM snippet (head)
  const gtmHead = templateHTML.match(/(<script>\(function\(w,d,s,l,i\)[\s\S]*?<\/script>)/)?.[1] || '';

  // CSS + fonts
  const cssBlock = templateHTML.match(/(<link rel="stylesheet" href="\.\.\/css\/style\.css[\s\S]*?<\/noscript>)/)?.[1] || '';

  // Meta Pixel + GA4
  const pixelGA4 = templateHTML.match(/(<script>!function\(f,b,e[\s\S]*?<\/script>\s*<script async src="https:\/\/www\.googletagmanager\.com\/gtag[\s\S]*?<\/script>)/)?.[1] || '';

  // GTM noscript iframe
  const gtmNoscript = templateHTML.match(/(<noscript><iframe src="https:\/\/www\.googletagmanager\.com[\s\S]*?<\/noscript>)/)?.[1] || '';

  // Header completo
  const header = templateHTML.match(/(<header id="header">[\s\S]*?<\/header>)/)?.[1] || '';

  // Mobile nav
  const mobileNav = templateHTML.match(/(<div class="mobile-nav"[\s\S]*?<\/div>\s*\n)/)?.[1] || '';

  // Footer
  const footer = templateHTML.match(/(<footer>[\s\S]*?<\/footer>)/)?.[1] || '';

  // WhatsApp float
  const waFloat = templateHTML.match(/(<div class="whatsapp-float">[\s\S]*?<\/div>\s*\n\s*<script)/)?.[1]
    ?.replace(/\s*<script$/, '') || '';

  return { gtmHead, cssBlock, pixelGA4, gtmNoscript, header, mobileNav, footer, waFloat };
}

// ── 5. Ensamblar HTML completo ───────────────────────────────

function assembleHTML(data, slug, blocks, topic) {
  const today = new Date().toISOString().split('T')[0];
  const monthYear = getMonthYear();

  const faqSchemaItems = (data.faqSchema || []).map(item =>
    `      {\n        "@type": "Question",\n        "name": ${JSON.stringify(item.question)},\n        "acceptedAnswer": { "@type": "Answer", "text": ${JSON.stringify(item.answer)} }\n      }`
  ).join(',\n');

  const relatedLinks = (data.relatedArticles || []).map(a =>
    `            <a href="${a.slug}.html"><i class="fa-solid fa-arrow-right" style="color:var(--gold);margin-right:6px;"></i>${a.title}</a>`
  ).join('\n');

  const cardImgUrl = `https://images.unsplash.com/${data.cardImageId}?w=900&h=320&fit=crop&q=80`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${data.title} | La Rosa &amp; Abogados</title>
  <meta name="description" content="${data.metaDescription}" />
  <link rel="canonical" href="https://www.larosayabogados.com/blog/${slug}" />

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": ${JSON.stringify(data.h1)},
    "description": ${JSON.stringify(data.metaDescription)},
    "author": { "@type": "Person", "name": "Jorge H. La Rosa Ruiz" },
    "publisher": { "@type": "Organization", "name": "La Rosa & Abogados" },
    "datePublished": "${today}",
    "dateModified": "${today}",
    "inLanguage": "es-PE"
  }
  </script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
${faqSchemaItems}
    ]
  }
  </script>

  ${blocks.gtmHead}
  ${blocks.cssBlock}
  ${blocks.pixelGA4}
</head>
<body>
${blocks.gtmNoscript}

${blocks.header}

${blocks.mobileNav}

<section class="page-hero">
  <div class="container">
    <div class="breadcrumb">
      <a href="../index.html">Inicio</a><span>/</span>
      <a href="../blog.html">Blog</a><span>/</span>
      <span>${data.practiceAreaLabel}</span>
    </div>
    <h1>${data.h1}</h1>
    <p>${data.heroSubtitle}</p>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="blog-full-grid">

      <article class="blog-full-content">
${data.articleBodyHTML}
      </article>

      <aside class="blog-sidebar">
        <div class="sidebar-card gold-bg">
          <h3><i class="${data.sidebarHeadingIcon}" style="margin-right:8px;"></i> ${data.sidebarHeading}</h3>
          <p style="font-size:14px;margin-bottom:20px;">${data.sidebarText}</p>
          <a href="../contacto.html" class="btn btn-navy" style="width:100%;justify-content:center;display:flex;">Consulta ahora</a>
          <a href="https://wa.me/51973535633?text=${data.waText}" target="_blank" rel="noopener" style="margin-top:12px;width:100%;justify-content:center;display:flex;background:#25d366;color:#fff;padding:12px;border-radius:6px;font-weight:600;font-size:14px;gap:8px;align-items:center;"><i class="fa-brands fa-whatsapp" style="font-size:18px;"></i> WhatsApp</a>
        </div>

        <div class="sidebar-card">
          <h3>Artículos relacionados</h3>
          <div class="footer-links" style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">
${relatedLinks}
          </div>
        </div>

        <div class="sidebar-card">
          <h3>Nuestros Servicios</h3>
          <div class="sidebar-services">
            <a href="../servicios/derecho-laboral.html"><i class="fa-solid fa-briefcase"></i> Derecho Laboral</a>
            <a href="../servicios/derecho-arrendamientos.html"><i class="fa-solid fa-building"></i> Arrendamientos</a>
            <a href="../servicios/sucesiones.html"><i class="fa-solid fa-scroll"></i> Sucesiones</a>
            <a href="../servicios/derecho-civil.html"><i class="fa-solid fa-scale-balanced"></i> Derecho Civil</a>
            <a href="../servicios/derecho-familia.html"><i class="fa-solid fa-house-user"></i> Derecho de Familia</a>
            <a href="../servicios/derecho-comercial.html"><i class="fa-solid fa-handshake"></i> Derecho Comercial</a>
            <a href="../servicios/derecho-societario.html"><i class="fa-solid fa-building-columns"></i> Derecho Societario</a>
          </div>
        </div>
      </aside>

    </div>
  </div>
</section>

<section class="cta-band">
  <div class="container">
    <h2>${data.ctaBandTitle}</h2>
    <p>${data.ctaBandText}</p>
    <div class="cta-band-btns">
      <a href="../contacto.html" class="btn btn-gold"><i class="fa-solid fa-envelope"></i> Consulta confidencial</a>
      <a href="https://wa.me/51973535633?text=${data.waText}" target="_blank" rel="noopener" class="btn btn-outline"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a>
    </div>
  </div>
</section>

${blocks.footer}

${blocks.waFloat}

<script src="../js/main.js"></script>
</body>
</html>`;
}

// ── 6. Actualizar blog.html ──────────────────────────────────

function buildCardHTML(data, slug) {
  const monthYear = getMonthYear();
  const cardImgUrl = `https://images.unsplash.com/${data.cardImageId}?w=500&h=400&fit=crop&q=80`;
  const isNews = ['actualidad', 'coyuntura'].includes(data.practiceAreaLabel.toLowerCase());
  const tagStyle = isNews
    ? `style="background:#c0392b;color:#fff;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;"`
    : '';

  return `
          <a href="blog/${slug}.html" class="blog-full-card">
            <div class="blog-full-img">
              <img src="${cardImgUrl}" alt="${data.cardImageAlt}" class="blog-img-real" />
            </div>
            <div class="blog-full-body">
              <div class="blog-meta">
                <span ${tagStyle}><i class="fa-solid fa-tag"></i> ${data.practiceAreaLabel}</span>
                <span><i class="fa-regular fa-calendar"></i> ${monthYear}</span>
                <span><i class="fa-regular fa-clock"></i> ${data.readingMinutes} min</span>
              </div>
              <h2>${data.h1}</h2>
              <p>${data.cardPreviewText}</p>
              <span class="blog-read-more">Leer artículo <i class="fa-solid fa-arrow-right"></i></span>
            </div>
          </a>
`;
}

function updateBlogHTML(cardHTML) {
  const blogPath = path.join(ROOT, 'blog.html');
  let content = fs.readFileSync(blogPath, 'utf8');
  const marker = '<div class="blog-full-grid">';
  const idx = content.indexOf(marker);
  if (idx === -1) throw new Error('Marcador blog-full-grid no encontrado en blog.html');
  content = content.slice(0, idx + marker.length) + cardHTML + content.slice(idx + marker.length);
  fs.writeFileSync(blogPath, content, 'utf8');
}

// ── 7. Actualizar index.html (Temas Relevantes) ─────────────

const PRACTICE_AREA_ICONS = {
  'derecho laboral':    'fa-briefcase',
  'arrendamientos':     'fa-building',
  'sucesiones':         'fa-scroll',
  'derecho civil':      'fa-scale-balanced',
  'derecho de familia': 'fa-house-user',
  'derecho comercial':  'fa-handshake',
  'derecho societario': 'fa-building-columns',
  'actualidad':         'fa-landmark',
  'coyuntura':          'fa-landmark',
};

function updateIndexHTML(data, slug) {
  const indexPath = path.join(ROOT, 'index.html');
  let content = fs.readFileSync(indexPath, 'utf8');

  const marker = '<div class="trending-list">';
  const idx = content.indexOf(marker);
  if (idx === -1) { console.warn('Marcador trending-list no encontrado en index.html'); return; }

  const monthYear = getMonthYear();
  const areaKey = (data.practiceAreaLabel || '').toLowerCase();
  const icon = PRACTICE_AREA_ICONS[areaKey] || 'fa-newspaper';
  const isNews = ['actualidad', 'coyuntura'].includes(areaKey);
  const tagStyle = isNews ? ` style="background:#c0392b;color:#fff;"` : '';

  const newItem = `
      <a href="blog/${slug}.html" class="trending-item">
        <div class="trend-icon"><i class="fa-solid ${icon}"></i></div>
        <div>
          <span class="trend-tag"${tagStyle}>${data.practiceAreaLabel}</span>
          <div class="trend-title">${data.h1}</div>
          <div class="trend-date"><i class="fa-regular fa-calendar"></i> ${monthYear}</div>
        </div>
      </a>
`;

  // Insert new item at top of trending-list
  const insertAt = idx + marker.length;
  content = content.slice(0, insertAt) + newItem + content.slice(insertAt);

  // Remove the 7th trending-item to keep the list at 6
  const items = [...content.matchAll(/<a href="blog\/[^"]+\.html" class="trending-item">/g)];
  if (items.length > 6) {
    const seventh = items[6];
    const closeTag = '</a>';
    const endIdx = content.indexOf(closeTag, seventh.index) + closeTag.length;
    content = content.slice(0, seventh.index) + content.slice(endIdx);
  }

  fs.writeFileSync(indexPath, content, 'utf8');
}

// ── 8. Actualizar sitemap.xml ────────────────────────────────

function updateSitemap(slug) {
  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  let content = fs.readFileSync(sitemapPath, 'utf8');
  if (content.includes(slug)) {
    console.warn('El slug ya existe en sitemap.xml, omitiendo inserción.');
    return;
  }
  const entry = `  <url><loc>https://www.larosayabogados.com/blog/${slug}</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>\n`;
  content = content.replace('</urlset>', entry + '</urlset>');
  fs.writeFileSync(sitemapPath, content, 'utf8');
}

// ── 8. Main ──────────────────────────────────────────────────

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log('📰 Buscando noticias legales en Perú...');
  const newsItems = await fetchNews();
  console.log(`   Encontradas ${newsItems.length} noticias.`);

  console.log('📚 Leyendo títulos ya publicados en blog.html...');
  const publishedTitles = getPublishedTitles();
  console.log(`   Artículos previos encontrados: ${publishedTitles.length}`);
  if (publishedTitles.length) {
    console.log('   Temas a evitar:', publishedTitles.slice(0, 5).join(' | '));
  }

  console.log('🤖 Eligiendo el mejor tema con Claude Haiku...');
  const topic = await pickBestTopic(client, newsItems, publishedTitles);
  console.log(`   Tema elegido: ${topic.selectedNews.title}`);
  console.log(`   Ángulo: ${topic.angle}`);

  console.log('✍️  Generando artículo completo con Claude Sonnet...');
  const articleData = await generateArticle(client, topic);
  const slug = buildSlug(articleData.title);
  console.log(`   Slug: ${slug}`);

  console.log('📄 Leyendo template para bloques estáticos...');
  const templateHTML = fs.readFileSync(TEMPLATE_FILE, 'utf8');
  const blocks = extractStaticBlocks(templateHTML);

  console.log('🔧 Ensamblando HTML...');
  const fullHTML = assembleHTML(articleData, slug, blocks, topic);

  const articlePath = path.join(ROOT, 'blog', slug + '.html');
  fs.writeFileSync(articlePath, fullHTML, 'utf8');
  console.log(`   Artículo escrito: ${articlePath}`);

  console.log('📋 Actualizando blog.html...');
  updateBlogHTML(buildCardHTML(articleData, slug));

  console.log('🏠 Actualizando index.html (Temas Relevantes)...');
  updateIndexHTML(articleData, slug);

  console.log('🗺️  Actualizando sitemap.xml...');
  updateSitemap(slug);

  console.log('📦 Escribiendo article-output.json...');
  const output = {
    slug,
    title: articleData.title,
    preview: articleData.cardPreviewText,
  };
  fs.writeFileSync(path.join(ROOT, 'article-output.json'), JSON.stringify(output, null, 2), 'utf8');

  console.log('✅ Generación completada exitosamente.');
  console.log(JSON.stringify(output));
}

main().catch(err => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
