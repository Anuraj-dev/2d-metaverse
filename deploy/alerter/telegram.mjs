// Telegram Bot API transport. Zero dependencies — native fetch (Node 18+).

const MAX_LEN = 3500; // Telegram hard limit is 4096; leave headroom for markup.

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Send an HTML message via the Telegram Bot API. Retries once on failure,
 * logs errors, and never throws — a broken alert transport must not crash
 * the watchdog loop.
 *
 * @returns {Promise<boolean>} whether the message was delivered.
 */
export async function sendTelegram(token, chatId, text, fetchImpl = fetch) {
  if (!token || !chatId) {
    console.error("alerter: telegram token/chat id missing; not sending");
    return false;
  }

  const body = {
    chat_id: chatId,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    text: escapeHtml(text).slice(0, MAX_LEN),
  };
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      const detail = await res.text().catch(() => "");
      console.error(`alerter: telegram send failed (status ${res.status}, attempt ${attempt}): ${detail}`);
    } catch (error) {
      console.error(`alerter: telegram send error (attempt ${attempt}):`, error);
    }
  }
  return false;
}

export { escapeHtml };
