/* Página de obrigado + agendamento. JavaScript puro, sem bibliotecas. */
(function () {
  "use strict";

  // ---------- utilidades ----------
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var store = {
    get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { sessionStorage.removeItem(k); } catch (e) {} },
  };

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || (opts.body ? "POST" : "GET"), headers: {} };
    if (opts.body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        data = data || {};
        data._status = r.status;
        return data;
      });
    }, function () { return { _status: 0, ok: false, error: "network", message: "Sem conexão. Verifique sua internet e tente de novo." }; });
  }

  var ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>';
  var ICON_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>';

  // ---------- estado ----------
  var tokenMatch = location.pathname.match(/^\/agendar\/([A-Za-z0-9_-]{10,200})/);
  var S = {
    token: tokenMatch ? tokenMatch[1] : "",
    ticket: tokenMatch ? "" : (store.get("mm_ticket") || ""),
    info: null,
    me: null,
    days: [],
    day: null,
    slot: null,
    busy: false,
    notice: null,
  };
  var box = $("#booking");

  function access() { return S.token ? "token=" + encodeURIComponent(S.token) : "ticket=" + encodeURIComponent(S.ticket); }

  // ---------- conteúdo da página ----------
  function applyInfo(info) {
    S.info = info;
    if (info.hero) {
      var t = $("#hero-title");
      t.innerHTML = esc(info.hero.before) + ' <span class="grad-text">' + esc(info.hero.highlight) + "</span> " + esc(info.hero.after);
      $("#hero-subtitle").textContent = info.hero.subtitle;
    }
    document.querySelectorAll("[data-bonus-value]").forEach(function (el) { el.textContent = info.bonusValue; });
    if (info.footerText) $("#footer-text").textContent = info.footerText;
    if (info.supportEmail) {
      var a = $("#support-link");
      a.textContent = info.supportEmail;
      a.href = "mailto:" + info.supportEmail;
      $("#footer-support").hidden = false;
    }
    setupVideo(info.videoId);
    applyWindow(info.estimatedWindow, true);
  }

  function applyWindow(w, estimated) {
    if (!w) return;
    $("#days-left").textContent = w.daysLeft;
    $("#deadline-short").textContent = w.lastDayShort;
    $("#bonus-deadline-text").textContent = w.lastDayLabel + (estimated ? "" : "");
    $("#trust-deadline").textContent = "Bônus garantido até " + w.lastDayShort;
    var urgent = w.daysLeft <= 1;
    $("#card-days").classList.toggle("is-urgent", urgent);
    $("#card-date").classList.toggle("is-urgent", urgent);
    $("#card-days .caption").textContent = w.daysLeft === 1 ? "dia útil restante" : "dias úteis restantes";
  }

  function setupVideo(id) {
    var el = $("#video");
    if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return;
    el.innerHTML =
      '<button type="button" class="media-poster" aria-label="Assistir ao vídeo">' +
      '<img src="https://i.ytimg.com/vi/' + id + '/hqdefault.jpg" alt="" loading="lazy" decoding="async">' +
      '<span class="play-btn"><svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg></span></button>';
    el.querySelector("button").addEventListener("click", function () {
      el.innerHTML =
        '<iframe src="https://www.youtube-nocookie.com/embed/' + id +
        '?autoplay=1&rel=0&modestbranding=1&playsinline=1" title="Vídeo de boas-vindas" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
    });
  }

  // ---------- telas do agendamento ----------
  function render(html) { box.innerHTML = html; }

  function noticeHtml() {
    if (!S.notice) return "";
    return '<div class="notice notice--' + S.notice.kind + '" role="alert">' + esc(S.notice.text) + "</div>";
  }

  function viewIdentify(errorText, emailValue) {
    render(
      '<form class="stage is-active" id="f-identify" novalidate>' +
        '<div class="stage-title"><span class="n">1</span><h3 class="h3">Informe o e-mail usado na compra</h3></div>' +
        '<div class="stage-body">' +
          '<div class="field"><label for="i-email">E-mail da compra</label>' +
          '<input class="input' + (errorText ? " is-error" : "") + '" id="i-email" type="email" inputmode="email" autocomplete="email" required placeholder="voce@email.com" value="' + esc(emailValue || "") + '">' +
          '<div class="field-error" id="e-email">' + esc(errorText || "") + "</div></div>" +
          '<button class="btn btn-primary btn-block" type="submit">Continuar</button>' +
          '<p class="privacy">Usamos seu e-mail só para localizar sua compra.</p>' +
        "</div></form>"
    );
    var f = $("#f-identify");
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var email = $("#i-email").value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        viewIdentify("Digite um e-mail válido.", email);
        $("#i-email").focus();
        return;
      }
      lookup(email, 0);
    });
  }

  var POLL_INTERVAL = 5000, POLL_MAX = 60000;

  function viewConfirming(seconds) {
    render(
      '<div class="status-box">' +
        '<div class="spinner" aria-hidden="true"></div>' +
        '<h3 class="h3">Estamos confirmando seu pagamento…</h3>' +
        '<p>Isso costuma levar alguns segundos. Não feche esta página.</p>' +
        '<p class="caption">Tentando de novo automaticamente (' + seconds + "s)</p>" +
      "</div>"
    );
  }

  function viewNotFound(email) {
    render(
      '<div class="result-card">' +
        '<div class="result-icon result-icon--info">' + ICON_X + "</div>" +
        '<h3 class="h3">Ainda não encontramos sua compra</h3>' +
        "<p style=\"margin:0\">Confira se o e-mail <strong style=\"color:var(--ink)\">" + esc(email) + "</strong> é o mesmo usado na compra. " +
        "Se estiver certo, aguarde: em alguns minutos você recebe um e-mail com o seu link pessoal de agendamento.</p>" +
        '<div style="display:grid;gap:10px;width:100%;max-width:360px">' +
          '<button class="btn btn-primary" id="b-retry" type="button">Tentar novamente</button>' +
          '<button class="btn btn-secondary" id="b-other" type="button">Usar outro e-mail</button>' +
        "</div></div>"
    );
    $("#b-retry").addEventListener("click", function () { lookup(email, 0); });
    $("#b-other").addEventListener("click", function () { viewIdentify("", ""); });
  }

  function lookup(email, elapsed) {
    if (elapsed === 0) viewConfirming(Math.round(POLL_MAX / 1000));
    api("/api/public/lookup", { body: { email: email } }).then(function (r) {
      if (r._status === 400) return viewIdentify(r.message || "Digite um e-mail válido.", email);
      if (r._status === 429 || r._status === 0 || r._status >= 500) {
        return viewError(r.message || "Não foi possível consultar agora.", function () { lookup(email, 0); });
      }
      if (r.state === "not_found") {
        if (elapsed + POLL_INTERVAL > POLL_MAX) return viewNotFound(email);
        viewConfirming(Math.round((POLL_MAX - elapsed - POLL_INTERVAL) / 1000));
        return setTimeout(function () { lookup(email, elapsed + POLL_INTERVAL); }, POLL_INTERVAL);
      }
      S.ticket = r.ticket;
      store.set("mm_ticket", r.ticket);
      handleMe(r);
    });
  }

  function viewError(text, retry) {
    render(
      '<div class="result-card">' +
        '<div class="result-icon result-icon--bad">' + ICON_X + "</div>" +
        '<h3 class="h3">Algo deu errado</h3><p style="margin:0">' + esc(text) + "</p>" +
        '<button class="btn btn-secondary" id="b-err" type="button">Tentar novamente</button></div>'
    );
    $("#b-err").addEventListener("click", retry);
  }

  function rulesList() {
    return '<ul class="check-list">' +
      "<li>Não é possível cancelar nem remarcar pela página.</li>" +
      "<li>Se faltar, você perde o bônus.</li>" +
      "<li>O link do Zoom chega pelo WhatsApp.</li></ul>";
  }

  function viewBooked(me, justNow) {
    var b = me.booking;
    render(
      '<div class="card-feature result-card" style="box-shadow:none">' +
        '<span class="float-badge">' + (justNow ? "Agendamento confirmado" : "Reunião agendada") + "</span>" +
        '<div class="result-icon result-icon--ok">' + ICON_OK + "</div>" +
        '<h3 class="h3">' + (justNow ? "Prontinho" + (me.firstName ? ", " + esc(me.firstName) : "") + "! Sua reunião está marcada" : "Você já tem uma reunião marcada") + "</h3>" +
        '<div class="result-when">' + esc(whenMain(b.label)) + "<small>" + esc(whenSub(b.label)) + "</small></div>" +
        (S.info && S.info.durationMin ? '<p class="caption" style="margin:0">Duração: cerca de ' + S.info.durationMin + " minutos, pelo Zoom.</p>" : "") +
        rulesList() +
        '<p class="whats-tip">💬 Fique de olho no seu WhatsApp</p>' +
        (justNow ? '<p class="caption" style="margin:0">Enviamos a confirmação para o seu e-mail.</p>' : "") +
      "</div>"
    );
  }

  // "segunda-feira, 09/11/2026 às 08:00 (horário de Brasília)" -> partes
  function whenMain(label) { return label.replace(/\s*\(horário de Brasília\)/, "").replace(/^(\S+),\s*/, function (_, d) { return d.charAt(0).toUpperCase() + d.slice(1) + ", "; }); }
  function whenSub() { return "horário de Brasília"; }

  function viewExpired(me) {
    render(
      '<div class="card result-card card-expired" style="background:rgba(255,90,114,.04)">' +
        '<div class="result-icon result-icon--bad">' + ICON_X + "</div>" +
        '<h3 class="h3">O prazo do bônus terminou</h3>' +
        '<p style="margin:0">' + esc(me.expiredText || "O prazo para agendar a reunião gratuita terminou.") + "</p>" +
      "</div>"
    );
  }

  function viewRefunded() {
    render(
      '<div class="card result-card card-expired">' +
        '<div class="result-icon result-icon--bad">' + ICON_X + "</div>" +
        '<h3 class="h3">Bônus indisponível</h3>' +
        '<p style="margin:0">Esta compra foi reembolsada, por isso a Reunião de Implementação não está mais disponível.</p>' +
      "</div>"
    );
  }

  function viewNoSlots() {
    render(
      '<div class="result-card">' +
        '<div class="result-icon result-icon--info">' + ICON_CAL + "</div>" +
        '<h3 class="h3">Os horários do seu prazo estão esgotados</h3>' +
        '<p style="margin:0">Todos os horários disponíveis até o fim do seu prazo foram reservados. Nosso time vai falar com você pelo WhatsApp para encontrar uma solução.</p>' +
        '<button class="btn btn-secondary" id="b-reload" type="button">Atualizar horários</button>' +
      "</div>"
    );
    $("#b-reload").addEventListener("click", loadSlots);
  }

  function skeleton() {
    var pills = "", times = "";
    for (var i = 0; i < 5; i++) pills += '<div class="skeleton"></div>';
    for (var j = 0; j < 6; j++) times += '<div class="skeleton"></div>';
    return '<div class="skel-row" aria-hidden="true">' + pills + '</div><div class="skel-grid" aria-hidden="true" style="margin-top:14px">' + times + "</div>";
  }

  function identityLine() {
    var me = S.me;
    var who = me.firstName ? esc(me.firstName) + " · " : "";
    return '<div class="identity"><span>' + who + "<strong>" + esc(me.email) + "</strong></span>" +
      (S.token ? "" : '<button class="link-btn" type="button" id="b-switch">Não é você? Trocar e-mail</button>') + "</div>";
  }

  function viewChoose(loading) {
    var me = S.me;
    var day = S.day ? S.days.filter(function (d) { return d.date === S.day; })[0] : null;
    var slot = S.slot;
    var html = noticeHtml() + '<div class="stepper">';

    html += '<div class="stage is-done"><div class="stage-title"><span class="n">1</span><h3 class="h3">Identificação</h3></div>' +
      '<div class="stage-body">' + identityLine() + "</div></div>";

    html += '<div class="stage ' + (S.day ? "is-done" : "is-active") + '"><div class="stage-title"><span class="n">2</span><h3 class="h3">Escolha o dia</h3></div><div class="stage-body">';
    if (loading) html += skeleton();
    else {
      html += '<div class="day-picker" role="group" aria-label="Dias disponíveis">';
      S.days.forEach(function (d) {
        html += '<button type="button" class="day-pill" data-day="' + d.date + '" aria-pressed="' + (d.date === S.day) + '"' + (d.slots.length ? "" : " disabled") + ">" +
          '<span class="wd">' + esc(d.weekday) + '</span><span class="dt">' + esc(d.label) + "</span></button>";
      });
      html += "</div>";
    }
    html += "</div></div>";

    html += '<div class="stage ' + (!S.day ? "is-locked" : slot ? "is-done" : "is-active") + '"><div class="stage-title"><span class="n">3</span><h3 class="h3">Escolha o horário</h3></div><div class="stage-body">';
    if (day) {
      var morning = day.slots.filter(function (s) { return s.time < "12:00"; });
      var afternoon = day.slots.filter(function (s) { return s.time >= "12:00"; });
      [["Manhã", morning], ["Tarde e noite", afternoon]].forEach(function (g) {
        if (!g[1].length) return;
        html += '<div class="time-group"><p class="time-group-label">' + g[0] + '</p><div class="time-grid">';
        g[1].forEach(function (s) {
          html += '<button type="button" class="time-btn" data-slot="' + s.start + '" aria-pressed="' + (s.start === slot) + '">' + esc(s.time) + "</button>";
        });
        html += "</div></div>";
      });
    } else if (!loading) {
      html += '<p class="caption" style="margin:0">Escolha um dia para ver os horários livres.</p>';
    }
    html += "</div></div>";

    var locked = !slot;
    html += '<form class="stage ' + (locked ? "is-locked" : "is-active") + '" id="f-book" novalidate><div class="stage-title"><span class="n">4</span><h3 class="h3">Seus dados</h3></div><div class="stage-body"><div class="form-grid">' +
      '<div class="field"><label for="i-name">Nome</label><input class="input" id="i-name" autocomplete="name" maxlength="120" value="' + esc(S.form ? S.form.name : me.name || "") + '"' + (locked ? " disabled" : "") + '><div class="field-error" id="e-name"></div></div>' +
      '<div class="field"><label for="i-mail">E-mail</label><input class="input" id="i-mail" value="' + esc(me.email) + '" readonly></div>' +
      '<div class="field"><label for="i-wa">WhatsApp com DDD</label><input class="input" id="i-wa" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(11) 98765-4321" maxlength="16" value="' + esc(S.form ? S.form.wa : me.whatsapp || "") + '"' + (locked ? " disabled" : "") + '><div class="field-error" id="e-wa"></div></div>' +
      '<label class="checkbox"><input type="checkbox" id="i-accept"' + (S.form && S.form.accept ? " checked" : "") + (locked ? " disabled" : "") + '><span>Li e aceito as regras: não é possível cancelar ou remarcar pela página, e se eu faltar perco o bônus.</span></label>' +
      '<div class="field-error" id="e-accept"></div>' +
      '<p class="privacy">🔒 Seus dados são usados só para entrarmos em contato sobre a reunião (LGPD).</p>' +
      "</div></div></form>";

    html += '<div class="stage ' + (locked ? "is-locked" : "is-active") + '"><div class="stage-title"><span class="n">5</span><h3 class="h3">Confirmação</h3></div><div class="stage-body">' +
      (slot ? '<p style="margin:0">Você escolheu <strong style="color:var(--ink)">' + esc(day ? day.weekday.charAt(0) + day.weekday.slice(1).toLowerCase() + " " + day.label : "") + " às " + esc(slotTime(slot)) + "</strong> (horário de Brasília).</p>" : "") +
      '<button class="btn btn-primary btn-block" type="submit" form="f-book" id="b-confirm"' + (locked || S.busy ? " disabled" : "") + ">" + (S.busy ? "Confirmando…" : "Confirmar meu horário") + "</button></div></div>";

    html += "</div>";
    render(html);
    bindChoose();
  }

  function slotTime(start) {
    for (var i = 0; i < S.days.length; i++) for (var j = 0; j < S.days[i].slots.length; j++) if (S.days[i].slots[j].start === start) return S.days[i].slots[j].time;
    return "";
  }

  function saveForm() {
    var n = $("#i-name"), w = $("#i-wa"), a = $("#i-accept");
    if (n) S.form = { name: n.value, wa: w.value, accept: a.checked };
  }

  function maskPhone(v) {
    var d = v.replace(/\D/g, "");
    if (d.length > 11 && d.indexOf("55") === 0) d = d.slice(2);
    d = d.slice(0, 11);
    if (d.length <= 2) return d.length ? "(" + d : "";
    if (d.length <= 6) return "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length <= 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
  }

  function validPhone(v) {
    var d = v.replace(/\D/g, "");
    if ((d.length === 12 || d.length === 13) && d.indexOf("55") === 0) d = d.slice(2);
    if (d.length !== 10 && d.length !== 11) return false;
    if (Number(d.slice(0, 2)) < 11) return false;
    if (d.length === 11 && d.charAt(2) !== "9") return false;
    return true;
  }

  function bindChoose() {
    var sw = $("#b-switch");
    if (sw) sw.addEventListener("click", function () { store.del("mm_ticket"); S.ticket = ""; S.me = null; S.form = null; viewIdentify("", ""); });

    box.querySelectorAll(".day-pill").forEach(function (b) {
      b.addEventListener("click", function () {
        saveForm();
        S.day = b.getAttribute("data-day");
        S.slot = null;
        S.notice = null;
        viewChoose(false);
        var first = box.querySelector(".time-btn");
        if (first) first.focus({ preventScroll: true });
      });
    });
    box.querySelectorAll(".time-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        saveForm();
        S.slot = Number(b.getAttribute("data-slot"));
        S.notice = null;
        viewChoose(false);
        var f = $("#i-wa");
        if (f && window.matchMedia("(max-width: 720px)").matches) $("#f-book").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    var wa = $("#i-wa");
    if (wa) wa.addEventListener("input", function () { wa.value = maskPhone(wa.value); });
    var form = $("#f-book");
    if (form) form.addEventListener("submit", function (ev) { ev.preventDefault(); submitBooking(); });
  }

  function setFieldError(id, inputId, text) {
    $(id).textContent = text || "";
    if (inputId) $(inputId).classList.toggle("is-error", !!text);
  }

  function submitBooking() {
    if (S.busy || !S.slot) return;
    saveForm();
    var name = S.form.name.trim(), wa = S.form.wa.trim(), ok = true;
    setFieldError("#e-name", "#i-name", name ? "" : "Informe seu nome.");
    if (!name) ok = false;
    var waOk = validPhone(wa);
    setFieldError("#e-wa", "#i-wa", waOk ? "" : "Informe um WhatsApp válido com DDD.");
    if (!waOk) ok = false;
    setFieldError("#e-accept", null, S.form.accept ? "" : "Para confirmar, aceite as regras.");
    if (!S.form.accept) ok = false;
    if (!ok) return;

    S.busy = true;
    viewChoose(false);
    var body = { slotStart: S.slot, name: name, whatsapp: wa, accept: true };
    if (S.token) body.token = S.token; else body.ticket = S.ticket;
    api("/api/public/book", { body: body }).then(function (r) {
      S.busy = false;
      if (r.ok) {
        S.me.booking = r.booking;
        if (r.durationMin && S.info) S.info.durationMin = r.durationMin;
        viewBooked(S.me, true);
        box.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (r.error === "slot_taken") {
        S.notice = { kind: "warn", text: "Esse horário acabou de ser reservado, escolha outro." };
        S.slot = null;
        return loadSlots();
      }
      if (r.error === "already_booked" || r.error === "expired" || r.error === "refunded" || r.error === "not_active") return loadMe();
      if (r.error === "ticket_expired") { store.del("mm_ticket"); S.ticket = ""; return viewIdentify(r.message, S.me && S.me.email); }
      if (r.error === "invalid_whatsapp") { viewChoose(false); return setFieldError("#e-wa", "#i-wa", r.message); }
      if (r.error === "invalid_slot") { S.notice = { kind: "warn", text: r.message }; S.slot = null; return loadSlots(); }
      S.notice = { kind: "error", text: r.message || "Não foi possível confirmar. Tente de novo." };
      viewChoose(false);
    });
  }

  function loadSlots() {
    viewChoose(true);
    api("/api/public/slots?" + access()).then(function (r) {
      if (!r.ok) {
        if (r.error === "ticket_expired") { store.del("mm_ticket"); S.ticket = ""; return viewIdentify(r.message, ""); }
        return viewError(r.message || "Não foi possível carregar os horários.", loadSlots);
      }
      if (r.state !== "ready") return loadMe();
      S.days = r.days || [];
      if (!S.days.length) return viewNoSlots();
      if (!S.day || !S.days.some(function (d) { return d.date === S.day; })) S.day = S.days[0].date;
      viewChoose(false);
    });
  }

  function handleMe(me) {
    S.me = me;
    applyWindow(me.window, false);
    if (me.state === "booked") return viewBooked(me, false);
    if (me.state === "expired") return viewExpired(me);
    if (me.state === "refunded") return viewRefunded();
    loadSlots();
  }

  function loadMe() {
    api("/api/public/me?" + access()).then(function (r) {
      if (!r.ok) {
        if (S.token) return viewError(r.message || "Link de agendamento inválido. Use o e-mail da compra abaixo.", function () { S.token = ""; viewIdentify("", ""); });
        store.del("mm_ticket");
        S.ticket = "";
        return viewIdentify("", "");
      }
      handleMe(r);
    });
  }

  // ---------- animação de entrada ----------
  function setupReveal() {
    var els = document.querySelectorAll(".reveal");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    // Já visíveis na primeira tela entram imediatamente.
    els.forEach(function (el) { io.observe(el); });
    document.documentElement.classList.add("fx");
  }

  // ---------- início ----------
  setupReveal();
  api("/api/public/info").then(function (info) { if (info.ok) applyInfo(info); });
  if (S.token || S.ticket) loadMe();
  else viewIdentify("", "");
})();
