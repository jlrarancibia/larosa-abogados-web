'use strict';

// ============================================================
// telegram-webhook.js — La Rosa & Abogados
// Maneja:
//   - callback_query: botones ✅ Aprobar / ✏️ Editar / ❌ Descartar
//   - message /blog [tema]: genera artículo sobre ese tema
//   - message /editar [PR] [instrucciones]: regenera artículo con cambios
// Endpoint: /.netlify/functions/telegram-webhook
// ============================================================

const https = require('https');

const REPO          = 'jlrarancibia/larosa-abogados-web';
const WORKFLOW_FILE = 'daily-blog.yml';

// ── HTTP helpers ─────────────────────────────────────────────

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function githubRequest(method, path, body) {
  const res = await httpsRequest(
    `https://api.github.com/repos/${REPO}${path}`,
    {
      method,
      headers: {
        'Authorization': `token ${process.env.GH_PAT}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'LaRosa-Blog-Bot/1.0',
        'Content-Length': body ? Buffer.byteLength(JSON.stringify(body)) : 0,
      },
    },
    body
  );
  if (res.status >= 400 && res.status !== 422) {
    throw new Error(`GitHub API ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function telegramRequest(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const body = JSON.stringify(payload);
  await httpsRequest(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    body
  );
}

async function answerCallback(callbackQueryId, text) {
  await telegramRequest('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
}

async function sendMessage(chatId, text) {
  await telegramRequest('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  });
}

// ── GitHub Actions helpers ───────────────────────────────────

async function triggerWorkflow(inputs = {}) {
  await githubRequest('POST', `/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    ref: 'main',
    inputs,
  });
}

async function getPRTitle(prNumber) {
  try {
    const pr = await githubRequest('GET', `/pulls/${prNumber}`);
    return pr && pr.title ? pr.title.replace(/^Blog:\s*/i, '').trim() : '';
  } catch (e) {
    console.warn('No se pudo obtener título del PR:', e.message);
    return '';
  }
}

// ── Handler principal ────────────────────────────────────────

exports.handler = async function (event) {
  console.log('Webhook recibido:', event.httpMethod, event.body ? event.body.slice(0, 200) : 'sin body');

  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: 'ok' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    console.error('Error parseando body:', e.message);
    return { statusCode: 200, body: 'ok' };
  }

  const pat = process.env.GH_PAT || '';
  if (!pat) {
    console.error('GH_PAT no configurado');
    return { statusCode: 200, body: 'ok' };
  }

  // ── Botones inline (callback_query) ──────────────────────

  if (body.callback_query) {
    const { id: callbackId, data, message } = body.callback_query;
    const chatId = message?.chat?.id?.toString();

    console.log('callback_data:', data, 'chat_id:', chatId);

    if (!chatId || chatId !== process.env.TELEGRAM_CHAT_ID) {
      console.warn('Chat no autorizado:', chatId);
      return { statusCode: 200, body: 'ignored' };
    }

    if (!data) return { statusCode: 200, body: 'ok' };

    const parts  = data.split('_');
    const action   = parts[0];
    const prNumber = parts[1];
    const branch   = parts.slice(2).join('_');

    console.log(`Acción: ${action}, PR: ${prNumber}, Rama: ${branch}`);

    try {
      if (action === 'approve') {
        console.log('Mergeando PR', prNumber);
        await githubRequest('PUT', `/pulls/${prNumber}/merge`, {
          commit_title: `Blog: Artículo publicado (PR #${prNumber})`,
          merge_method: 'squash',
        });
        try { await githubRequest('DELETE', `/git/refs/heads/${branch}`); }
        catch (e) { console.warn('No se pudo eliminar rama:', e.message); }

        await answerCallback(callbackId, '✅ ¡Publicado! Netlify desplegará en ~1 minuto.');
        await sendMessage(chatId,
          `✅ <b>Artículo publicado</b>\n\nEl PR #${prNumber} fue mergeado. Aparecerá en larosayabogados.com en ~2 minutos.`
        );

      } else if (action === 'discard') {
        console.log('Cerrando PR', prNumber);
        await githubRequest('PATCH', `/pulls/${prNumber}`, { state: 'closed' });
        try { await githubRequest('DELETE', `/git/refs/heads/${branch}`); }
        catch (e) { console.warn('No se pudo eliminar rama:', e.message); }

        await answerCallback(callbackId, '❌ Artículo descartado.');
        await sendMessage(chatId,
          `❌ <b>Artículo descartado</b>\n\nEl PR #${prNumber} fue cerrado y la rama eliminada.`
        );

      } else if (action === 'edit') {
        await answerCallback(callbackId, '✏️ Listo, dime qué cambiar.');
        await sendMessage(chatId,
          `✏️ <b>Editar artículo (PR #${prNumber})</b>\n\n` +
          `Escríbeme en este chat con el siguiente formato:\n\n` +
          `<code>/editar ${prNumber} [tus instrucciones]</code>\n\n` +
          `<b>Ejemplos:</b>\n` +
          `<code>/editar ${prNumber} Ajusta el tono y agrega una sección sobre multas</code>\n` +
          `<code>/editar ${prNumber} El artículo debe citar el Art. 46 LPCL y ser más formal</code>\n\n` +
          `El PR #${prNumber} se cerrará automáticamente y se generará una nueva versión.`
        );

      } else {
        console.warn('Acción desconocida:', action);
        await answerCallback(callbackId, 'Acción no reconocida.');
      }

    } catch (err) {
      console.error('Error procesando acción:', err.message);
      try {
        await answerCallback(callbackId, `⚠️ Error: ${err.message.slice(0, 100)}`);
        await sendMessage(chatId, `⚠️ Error: ${err.message}`);
      } catch (e2) {
        console.error('Error enviando mensaje de error:', e2.message);
      }
    }

    return { statusCode: 200, body: 'ok' };
  }

  // ── Mensajes de texto (/blog y /editar) ──────────────────

  if (body.message) {
    const { text, chat } = body.message;
    const chatId = chat?.id?.toString();

    console.log('Mensaje recibido:', text ? text.slice(0, 100) : '(sin texto)', 'chat_id:', chatId);

    if (!chatId || chatId !== process.env.TELEGRAM_CHAT_ID || !text) {
      return { statusCode: 200, body: 'ok' };
    }

    // /blog [tema y punto de vista]
    if (text.startsWith('/blog')) {
      const topicText = text.slice(5).trim();

      if (!topicText) {
        await sendMessage(chatId,
          `📝 <b>Cómo solicitar un artículo:</b>\n\n` +
          `<code>/blog [tema y tu punto de vista]</code>\n\n` +
          `<b>Ejemplos:</b>\n` +
          `<code>/blog Segunda vuelta 2026: qué cambia legalmente para las empresas</code>\n` +
          `<code>/blog Reforma laboral de Sánchez: riesgos para los empleadores limeños</code>`
        );
        return { statusCode: 200, body: 'ok' };
      }

      try {
        console.log('Disparando workflow con topic_override:', topicText);
        await triggerWorkflow({ topic_override: topicText });
        await sendMessage(chatId,
          `⏳ <b>Recibido.</b>\n\n` +
          `Generando artículo sobre:\n<i>${topicText}</i>\n\n` +
          `Te aviso en ~2 minutos con el preview para que lo revises.`
        );
      } catch (err) {
        console.error('Error disparando workflow:', err.message);
        await sendMessage(chatId, `⚠️ Error al generar artículo: ${err.message}`);
      }

      return { statusCode: 200, body: 'ok' };
    }

    // /editar [pr_number] [instrucciones]
    if (text.startsWith('/editar')) {
      const rest = text.slice(7).trim();
      const spaceIdx = rest.indexOf(' ');

      if (!rest || spaceIdx === -1) {
        await sendMessage(chatId,
          `✏️ <b>Formato correcto:</b>\n\n` +
          `<code>/editar [número_PR] [instrucciones]</code>\n\n` +
          `<b>Ejemplo:</b>\n` +
          `<code>/editar 25 Ajusta el tono y agrega sección sobre multas</code>`
        );
        return { statusCode: 200, body: 'ok' };
      }

      const prNumber   = rest.slice(0, spaceIdx).trim();
      const instructions = rest.slice(spaceIdx + 1).trim();

      if (isNaN(Number(prNumber))) {
        await sendMessage(chatId, `⚠️ El número de PR debe ser un número. Ejemplo: <code>/editar 25 instrucciones</code>`);
        return { statusCode: 200, body: 'ok' };
      }

      try {
        console.log(`Regenerando PR #${prNumber} con instrucciones:`, instructions);
        const originalTitle = await getPRTitle(prNumber);
        console.log('Título original del PR:', originalTitle);

        await triggerWorkflow({
          topic_override: originalTitle || 'Regenerar artículo con nuevas instrucciones',
          edit_pr: prNumber,
          edit_instructions: instructions,
        });

        await sendMessage(chatId,
          `⏳ <b>Regenerando artículo</b>\n\n` +
          `PR #${prNumber} será cerrado y reemplazado por la nueva versión.\n\n` +
          `<b>Instrucciones:</b> <i>${instructions}</i>\n\n` +
          `Te aviso en ~2 minutos con el nuevo preview.`
        );
      } catch (err) {
        console.error('Error regenerando artículo:', err.message);
        await sendMessage(chatId, `⚠️ Error al regenerar: ${err.message}`);
      }

      return { statusCode: 200, body: 'ok' };
    }

    // Comando no reconocido — mostrar ayuda
    if (text.startsWith('/')) {
      await sendMessage(chatId,
        `🤖 <b>Comandos disponibles:</b>\n\n` +
        `📝 <code>/blog [tema]</code>\nGenerar artículo sobre un tema específico\n\n` +
        `✏️ <code>/editar [PR] [cambios]</code>\nReeditar un artículo pendiente\n\n` +
        `Los artículos automáticos llegan todos los días a las 9AM Lima.`
      );
    }
  }

  return { statusCode: 200, body: 'ok' };
};
