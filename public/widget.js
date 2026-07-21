// ============================================================================
// ORCA EDGE - TOOL 1: embeddable chat widget (vanilla JS, no dependencies)
// ----------------------------------------------------------------------------
// Drops onto ANY client website with a single script tag:
//   <script src="https://oe-client-intake-crm.vercel.app/widget.js"
//           data-api="https://oe-client-intake-crm.vercel.app"></script>
// It fetches its own branding from /api/widget-config, so a client's embed
// needs no configuration. Kept dependency-free and self-contained so it never
// clashes with the host site's own React/CSS.
// ============================================================================

(function () {
  var script = document.currentScript;
  var API = (script && script.getAttribute("data-api")) || window.location.origin;

  var sessionId = null;
  var open = false;
  var sending = false;
  var greeted = false;
  var accent = "#4592DC";
  var firmName = "";
  var greeting = "Hi, how can I help today?";
  var tz = "Europe/London";

  // ---- styles (scoped with a unique prefix to avoid clashing) --------------
  var css = `
  .oe-w * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .oe-w-bubble { position: fixed; bottom: 22px; right: 22px; width: 60px; height: 60px; border-radius: 50%; background: var(--oe-accent); box-shadow: 0 6px 22px rgba(0,0,0,0.22); cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 2147483000; transition: transform 0.15s; border: none; }
  .oe-w-bubble:hover { transform: scale(1.06); }
  .oe-w-bubble svg { width: 28px; height: 28px; fill: #fff; }
  .oe-w-panel { position: fixed; bottom: 94px; right: 22px; width: 370px; max-width: calc(100vw - 32px); height: 560px; max-height: calc(100vh - 130px); background: #fff; border-radius: 16px; box-shadow: 0 12px 44px rgba(0,0,0,0.25); z-index: 2147483000; display: flex; flex-direction: column; overflow: hidden; opacity: 0; transform: translateY(12px); pointer-events: none; transition: opacity 0.2s, transform 0.2s; }
  .oe-w-panel.oe-open { opacity: 1; transform: translateY(0); pointer-events: auto; }
  .oe-w-head { background: linear-gradient(135deg, var(--oe-accent), #2E5F8C); color: #fff; padding: 16px 16px; }
  .oe-w-head-row { display: flex; align-items: center; gap: 12px; }
  .oe-w-avatar { width: 40px; height: 40px; border-radius: 11px; background: rgba(255,255,255,0.16); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .oe-w-avatar svg { width: 24px; height: 24px; }
  .oe-w-head-txt { flex: 1; min-width: 0; }
  .oe-w-head h4 { font-size: 1rem; font-weight: 700; }
  .oe-w-head p { font-size: 0.75rem; opacity: 0.92; margin-top: 2px; display: flex; align-items: center; gap: 6px; }
  .oe-w-close { background: rgba(255,255,255,0.14); border: none; color: #fff; width: 30px; height: 30px; border-radius: 9px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.15s; }
  .oe-w-close:hover { background: rgba(255,255,255,0.26); }
  .oe-w-close svg { width: 18px; height: 18px; }
  .oe-w-live { width: 7px; height: 7px; border-radius: 50%; background: #35F0A0; display: inline-block; box-shadow: 0 0 0 0 rgba(53,240,160,0.6); animation: oe-livepulse 2s infinite; }
  @keyframes oe-livepulse { 0% { box-shadow: 0 0 0 0 rgba(53,240,160,0.55); } 70% { box-shadow: 0 0 0 6px rgba(53,240,160,0); } 100% { box-shadow: 0 0 0 0 rgba(53,240,160,0); } }
  .oe-w-body { flex: 1; overflow-y: auto; padding: 16px; background: #F4F7FB; display: flex; flex-direction: column; gap: 10px; }
  .oe-w-msg { max-width: 85%; font-size: 0.88rem; line-height: 1.42; padding: 10px 13px; border-radius: 14px; white-space: pre-wrap; word-wrap: break-word; }
  .oe-w-msg.oe-user { align-self: flex-end; background: var(--oe-accent); color: #fff; border-bottom-right-radius: 4px; }
  .oe-w-msg.oe-bot { align-self: flex-start; background: #fff; color: #1a2330; border: 1px solid #E2E9F1; border-bottom-left-radius: 4px; }
  .oe-w-typing { align-self: flex-start; background: #fff; border: 1px solid #E2E9F1; border-radius: 14px; padding: 12px 15px; display: flex; gap: 4px; }
  .oe-w-typing span { width: 7px; height: 7px; border-radius: 50%; background: #B4C2D4; animation: oe-bounce 1.2s infinite; }
  .oe-w-typing span:nth-child(2) { animation-delay: 0.2s; }
  .oe-w-typing span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes oe-bounce { 0%,60%,100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-5px); opacity: 1; } }
  .oe-w-prompts { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 8px; background: #F4F7FB; }
  .oe-w-prompt { font-size: 0.78rem; background: #fff; border: 1px solid #CDDBEA; color: var(--oe-accent); padding: 6px 11px; border-radius: 999px; cursor: pointer; }
  .oe-w-prompt:hover { background: #EAF2FB; }
  .oe-w-foot { border-top: 1px solid #E2E9F1; padding: 10px; display: flex; gap: 8px; background: #fff; }
  .oe-w-input { flex: 1; border: 1px solid #D5DEE9; border-radius: 10px; padding: 10px 12px; font-size: 0.88rem; outline: none; resize: none; max-height: 90px; }
  .oe-w-input:focus { border-color: var(--oe-accent); }
  .oe-w-send { background: var(--oe-accent); border: none; border-radius: 10px; width: 42px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .oe-w-send:disabled { opacity: 0.5; cursor: default; }
  .oe-w-send svg { width: 18px; height: 18px; fill: #fff; }
  .oe-w-brand { text-align: center; font-size: 0.68rem; color: #9AA6B6; padding: 6px; background: #fff; }
  .oe-w-slots { display: flex; flex-wrap: wrap; gap: 6px; align-self: flex-start; max-width: 100%; }
  .oe-w-slot { font-size: 0.74rem; background: #F4F7FB; border: 1px solid #D3E0EE; color: #3A5570; padding: 5px 10px; border-radius: 7px; cursor: pointer; font-weight: 700; line-height: 1.2; }
  .oe-w-slot:hover:not(:disabled) { background: var(--oe-accent); color: #fff; border-color: var(--oe-accent); }
  .oe-w-slot:disabled { opacity: 0.4; cursor: default; }
  .oe-w-slot-chosen { background: var(--oe-accent); color: #fff; border-color: var(--oe-accent); }
  `;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  var root, panel, body, input, sendBtn, promptsRow;

  function build() {
    var style = el("style");
    style.textContent = css;
    document.head.appendChild(style);

    root = el("div", "oe-w");
    root.style.setProperty("--oe-accent", accent);

    var bubble = el("button", "oe-w-bubble");
    bubble.setAttribute("aria-label", "Open chat");
    bubble.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
    bubble.onclick = toggle;

    panel = el("div", "oe-w-panel");
    var head = el("div", "oe-w-head");
    head.innerHTML =
      '<div class="oe-w-head-row">' +
        '<div class="oe-w-avatar">' +
          '<svg viewBox="0 0 32 32" fill="none"><path d="M16 4.5 L27 13 V27 H20 V19.5 H12 V27 H5 V13 Z" fill="#fff" fill-opacity="0.95"/><path d="M16 4.5 L27 13" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 4.5 L5 13" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</div>' +
        '<div class="oe-w-head-txt">' +
          '<h4>' + esc(firmName) + '</h4>' +
          '<p><span class="oe-w-live"></span>Adviser desk online &middot; 24/7</p>' +
        '</div>' +
        '<button class="oe-w-close" aria-label="Minimise chat">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
        '</button>' +
      '</div>';
    head.querySelector(".oe-w-close").onclick = toggle;
    body = el("div", "oe-w-body");
    promptsRow = el("div", "oe-w-prompts");
    ["I'm buying my first home", "My fixed rate is ending", "I'm self-employed", "Buy-to-let enquiry"].forEach(function (p) {
      var b = el("button", "oe-w-prompt", esc(p));
      b.onclick = function () { input.value = p; sendMessage(); };
      promptsRow.appendChild(b);
    });
    var foot = el("div", "oe-w-foot");
    input = el("textarea", "oe-w-input");
    input.rows = 1;
    input.placeholder = "Type your message...";
    input.onkeydown = function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
    sendBtn = el("button", "oe-w-send");
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>';
    sendBtn.onclick = sendMessage;
    foot.appendChild(input); foot.appendChild(sendBtn);

    var brand = el("div", "oe-w-brand", "Secure intake &middot; response time tracked &middot; powered by Orca Edge");

    panel.appendChild(head); panel.appendChild(body); panel.appendChild(promptsRow); panel.appendChild(foot); panel.appendChild(brand);
    root.appendChild(bubble); root.appendChild(panel);
    document.body.appendChild(root);
  }

  function toggle() {
    open = !open;
    panel.classList.toggle("oe-open", open);
    // bubble becomes a close (X) while open
    if (open) {
      bubble.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      bubble.setAttribute("aria-label", "Close chat");
    } else {
      bubble.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
      bubble.setAttribute("aria-label", "Open chat");
    }
    if (open && !greeted) {
      greeted = true;
      addMsg(greeting, "bot");
    }
    if (open) setTimeout(function () { input.focus({ preventScroll: true }); }, 250);
  }

  function addMsg(text, who) {
    var m = el("div", "oe-w-msg " + (who === "user" ? "oe-user" : "oe-bot"), esc(text));
    body.appendChild(m);
    body.scrollTop = body.scrollHeight;
  }

  var typingEl = null;
  function showTyping() {
    typingEl = el("div", "oe-w-typing", "<span></span><span></span><span></span>");
    body.appendChild(typingEl);
    body.scrollTop = body.scrollHeight;
  }
  function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

  function sendMessage() {
    var text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    sendBtn.disabled = true;
    input.value = "";
    if (promptsRow) promptsRow.style.display = "none";
    addMsg(text, "user");
    showTyping();

    fetch(API + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, sessionId: sessionId, source: document.referrer || "demo-site" }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        hideTyping();
        if (data.sessionId) sessionId = data.sessionId;
        addMsg(data.reply || "Sorry, something went wrong. Please try again.", "bot");
      })
      .catch(function () {
        hideTyping();
        addMsg("Sorry, I'm having a brief connection issue. Please try again in a moment.", "bot");
      })
      .finally(function () { sending = false; sendBtn.disabled = false; input.focus({ preventScroll: true }); });
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // Fetch branding, then build.
  fetch(API + "/api/widget-config")
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      if (cfg.accent) accent = cfg.accent;
      if (cfg.firmName) firmName = cfg.firmName;
      if (cfg.greeting) greeting = cfg.greeting;
      if (cfg.timezone) tz = cfg.timezone;
    })
    .catch(function () {})
    .finally(build);
})();
