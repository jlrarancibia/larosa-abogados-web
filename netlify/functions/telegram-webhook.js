'use strict';

// ============================================================
// telegram-webhook.js — La Rosa & Abogados
// Netlify Function que recibe callbacks de Telegram cuando el
// usuario toca ✅ Aprobar o ❌ Descartar en el mensaje del bot.
// Endpoint: /.netlify/functions/telegram-webhook
// ============================================================

const https = require('https');

const REPO = 'jlrarancibia/larosa-abogados-web';

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

exports.handler = async function (event) {
  console.log('Webhook recibido:', event.httpMethod, event.body ? event.body.slice(0, 200) : 'sin body');

  // Siempre responde 200 — Telegram reintenta si recibe 4xx/5xx
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

  console.log('Tipo de update:', Object.keys(body).join(', '));

  // Solo procesamos callback_query (botones inline)
  if (!body.callback_query) {
    return { statusCode: 200, body: 'ok' };
  }

  const { id: callbackId, data, message } = body.callback_query;
  const chatId = message?.chat?.id?.toString();

  console.log('callback_data:', data, 'chat_id:', chatId, 'esperado:', process.env.TELEGRAM_CHAT_ID);

  // Validar que viene del chat autorizado
  if (!chatId || chatId !== process.env.TELEGRAM_CHAT_ID) {
    console.warn('Chat no autorizado:', chatId);
    return { statusCode: 200, body: 'ignored' };
  }

  if (!data) {
    return { statusCode: 200, body: 'ok' };
  }

  // Parsear callback_data: "approve_123_blog-auto-20260406"
  const parts = data.split('_');
  const action   = parts[0];               // 'approve' o 'discard'
  const prNumber = parts[1];               // número del PR
  const branch   = parts.slice(2).join('_'); // nombre de la rama

  console.log(`Acción: ${action}, PR: ${prNumber}, Rama: ${branch}`);

  // Verificar env vars — log TODAS las variables disponibles para diagnóstico
  const allEnvKeys = Object.keys(process.env).filter(k => !k.includes('SECRET') && !k.includes('KEY') && !k.includes('TOKEN') && !k.includes('PAT'));
  console.log('ENV vars disponibles (sin secretos):', allEnvKeys.join(', '));
  console.log('GH_PAT definido:', typeof process.env.GH_PAT, '| GITHUB_PAT definido:', typeof process.env.GITHUB_PAT);

  // Intentar GH_PAT o GITHUB_PAT como fallback
  const pat = process.env.GH_PAT || process.env.GITHUB_PAT || '';
  console.log(`PAT presente: ${pat ? 'SÍ' : 'NO'}, longitud: ${pat.length}, inicio: ${pat.slice(0, 4)}`);
  if (!pat) {
    console.error('GH_PAT no está configurado en Netlify Functions');
    await answerCallback(callbackId, '⚠️ GH_PAT faltante en Netlify. Revisa Project config → Env vars → scope Functions');
    return { statusCode: 200, body: 'ok' };
  }

  try {
    if (action === 'approve') {
      console.log('Mergeando PR', prNumber);
      await githubRequest('PUT', `/pulls/${prNumber}/merge`, {
        commit_title: `Blog: Artículo auto-generado (PR #${prNumber})`,
        merge_method: 'squash',
      });

      console.log('Eliminando rama', branch);
      try {
        await githubRequest('DELETE', `/git/refs/heads/${branch}`);
      } catch (e) {
        console.warn('No se pudo eliminar rama:', e.message);
      }

      await answerCallback(callbackId, '✅ ¡Publicado! Netlify desplegará en ~1 minuto.');
      await sendMessage(chatId,
        `✅ <b>Artículo publicado</b>\n\nEl PR #${prNumber} fue mergeado. Netlify desplegará en larosayabogados.com en ~2 minutos.`
      );

    } else if (action === 'discard') {
      console.log('Cerrando PR', prNumber);
      await githubRequest('PATCH', `/pulls/${prNumber}`, { state: 'closed' });

      try {
        await githubRequest('DELETE', `/git/refs/heads/${branch}`);
      } catch (e) {
        console.warn('No se pudo eliminar rama:', e.message);
      }

      await answerCallback(callbackId, '❌ Artículo descartado.');
      await sendMessage(chatId,
        `❌ <b>Artículo descartado</b>\n\nEl PR #${prNumber} fue cerrado y la rama eliminada.`
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
};
