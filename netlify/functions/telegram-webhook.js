'use strict';

// ============================================================
// telegram-webhook.js — La Rosa & Abogados
// Netlify Function que recibe callbacks de Telegram cuando el
// usuario toca ✅ Aprobar o ❌ Descartar en el mensaje del bot.
// Endpoint: /.netlify/functions/telegram-webhook
// ============================================================

const REPO = 'jlrarancibia/larosa-abogados-web';

async function githubRequest(method, path, body) {
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: {
      Authorization: `token ${process.env.GH_PAT}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'LaRosa-Blog-Bot/1.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok && res.status !== 422) {
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function telegramRequest(method, payload) {
  const { default: fetch } = await import('node-fetch');
  const token = process.env.TELEGRAM_BOT_TOKEN;
  await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function answerCallback(callbackQueryId, text) {
  await telegramRequest('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
}

async function sendMessage(chatId, text) {
  await telegramRequest('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

exports.handler = async function (event) {
  // Siempre responde 200 — Telegram reintenta si recibe 4xx/5xx
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: 'ok' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 200, body: 'ok' };
  }

  // Solo procesamos callback_query (botones inline)
  if (!body.callback_query) {
    return { statusCode: 200, body: 'ok' };
  }

  const { id: callbackId, data, message } = body.callback_query;
  const chatId = message?.chat?.id?.toString();

  // Validar que viene del chat autorizado
  if (!chatId || chatId !== process.env.TELEGRAM_CHAT_ID) {
    console.warn('Callback ignorado: chat_id no autorizado:', chatId);
    return { statusCode: 200, body: 'ignored' };
  }

  if (!data) {
    return { statusCode: 200, body: 'ok' };
  }

  // Parsear callback_data: "approve_123_blog-auto-20260406"
  const parts = data.split('_');
  const action   = parts[0];              // 'approve' o 'discard'
  const prNumber = parts[1];              // número del PR
  const branch   = parts.slice(2).join('_'); // nombre de la rama

  console.log(`Acción: ${action}, PR: ${prNumber}, Rama: ${branch}`);

  try {
    if (action === 'approve') {
      // 1. Merge PR (squash para historial limpio)
      await githubRequest('PUT', `/pulls/${prNumber}/merge`, {
        commit_title: `Blog: Artículo auto-generado (PR #${prNumber})`,
        merge_method: 'squash',
      });

      // 2. Eliminar rama remota
      try {
        await githubRequest('DELETE', `/git/refs/heads/${branch}`);
      } catch (e) {
        console.warn('No se pudo eliminar la rama (puede que ya no exista):', e.message);
      }

      await answerCallback(callbackId, '✅ ¡Publicado! Netlify desplegará en ~1 minuto.');
      await sendMessage(chatId,
        `✅ <b>Artículo publicado</b>\n\nEl PR #${prNumber} fue mergeado exitosamente. Netlify desplegará en larosayabogados.com en aproximadamente 1-2 minutos.`
      );

    } else if (action === 'discard') {
      // 1. Cerrar el PR
      await githubRequest('PATCH', `/pulls/${prNumber}`, { state: 'closed' });

      // 2. Eliminar rama remota
      try {
        await githubRequest('DELETE', `/git/refs/heads/${branch}`);
      } catch (e) {
        console.warn('No se pudo eliminar la rama:', e.message);
      }

      await answerCallback(callbackId, '❌ Artículo descartado.');
      await sendMessage(chatId,
        `❌ <b>Artículo descartado</b>\n\nEl PR #${prNumber} fue cerrado y la rama eliminada. Mañana se generará un nuevo artículo.`
      );

    } else {
      console.warn('Acción desconocida:', action);
      await answerCallback(callbackId, 'Acción no reconocida.');
    }

  } catch (err) {
    console.error('Error procesando callback:', err.message);
    try {
      await answerCallback(callbackId, `⚠️ Error: ${err.message.slice(0, 100)}`);
      await sendMessage(chatId, `⚠️ Error al procesar la acción: ${err.message}`);
    } catch {
      // ignorar errores al reportar errores
    }
  }

  return { statusCode: 200, body: 'ok' };
};
