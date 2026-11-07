/* Painel administrativo. JavaScript puro. */
(function () {
  "use strict";
  var root = document.getElementById("root");
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || (opts.body !== undefined ? "POST" : "GET"), headers: {}, credentials: "same-origin" };
    if (opts.body !== undefined || init.method !== "GET") { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body || {}); }
    return fetch("/api/admin/" + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        d = d || {}; d._status = r.status;
        if (r.status === 401 && path !== "login") { showLogin(); throw new Error("unauthorized"); }
        return d;
      });
    });
  }

  function toast(msg, err) {
    var t = document.createElement("div");
    t.className = "toast" + (err ? " err" : "");
    t.setAttribute("role", "status");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3800);
  }

  var STATUS_LABEL = {
    agendado: "Agendado", realizada: "Realizada", nao_compareceu: "Não compareceu", remarcada: "Remarcada",
    cancelada_reembolso: "Cancelada (reembolso)", ativo: "Sem agendamento", expirado: "Bônus expirado", reembolsado: "Reembolsado",
  };
  var tag = function (st) { return '<span class="tag st-' + esc(st) + '">' + esc(STATUS_LABEL[st] || st) + "</span>"; };
  var waBtn = function (b) { return b.waLink ? '<a class="wa" href="' + esc(b.waLink) + '" target="_blank" rel="noopener">WhatsApp</a>' : '<span class="muted">sem WhatsApp</span>'; };
  var todayISO = function () {
    var p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return p;
  };

  var S = { user: null, page: "agenda", week: null, buyersFilter: "pending", q: "" };

  // ---------- login ----------
  function showLogin(msg) {
    S.user = null;
    root.innerHTML =
      '<div class="login-wrap"><form class="card login-card" id="f-login">' +
      '<span class="logo"><span class="logo-mark"></span>Money\'s Map</span>' +
      '<h1 class="h3" style="font-size:22px">Painel do time</h1>' +
      (msg ? '<div class="notice notice--error">' + esc(msg) + "</div>" : "") +
      '<div class="field"><label for="l-name">Seu nome</label><input class="input" id="l-name" autocomplete="username" required></div>' +
      '<div class="field"><label for="l-pass">Senha</label><input class="input" id="l-pass" type="password" autocomplete="current-password" required></div>' +
      '<button class="btn btn-primary" type="submit">Entrar</button>' +
      '<p class="muted" style="margin:0">Primeiro acesso: digite seu nome e a senha cadastrada como ADMIN_PASSWORD na Cloudflare. Você vira o dono do painel.</p>' +
      "</form></div>";
    $("#f-login").addEventListener("submit", function (e) {
      e.preventDefault();
      api("login", { body: { name: $("#l-name").value, password: $("#l-pass").value } }).then(function (r) {
        if (!r.ok) return showLogin(r.message || "Não foi possível entrar.");
        S.user = r.user;
        shell();
      });
    });
  }

  // ---------- estrutura ----------
  var NAV = [
    ["agenda", "📅", "Agenda"],
    ["buyers", "👥", "Compradores"],
    ["blocks", "⛔", "Bloqueios"],
    ["history", "🕘", "Histórico"],
    ["settings", "⚙️", "Ajustes"],
  ];

  function shell() {
    root.innerHTML =
      '<div class="admin"><nav class="sidebar" aria-label="Menu">' +
      '<span class="logo"><span class="logo-mark"></span>Money\'s Map</span>' +
      NAV.map(function (n) { return '<button class="nav-btn" data-page="' + n[0] + '"><span class="ico" aria-hidden="true">' + n[1] + "</span>" + n[2] + "</button>"; }).join("") +
      '<div class="spacer"></div><div class="who">' + esc(S.user.name) + "</div>" +
      '<button class="nav-btn" id="b-logout"><span class="ico" aria-hidden="true">↩</span>Sair</button>' +
      '</nav><main class="content"><div id="kpis" class="kpis"></div><div id="page"></div></main></div>';
    $$(".nav-btn[data-page]").forEach(function (b) { b.addEventListener("click", function () { go(b.getAttribute("data-page")); }); });
    $("#b-logout").addEventListener("click", function () { api("logout", { body: {} }).then(function () { showLogin(); }); });
    loadKpis();
    go(location.hash.replace("#", "") || "agenda");
  }

  function go(page) {
    if (!NAV.some(function (n) { return n[0] === page; })) page = "agenda";
    S.page = page;
    history.replaceState(null, "", "#" + page);
    $$(".nav-btn[data-page]").forEach(function (b) { b.setAttribute("aria-current", b.getAttribute("data-page") === page ? "page" : "false"); });
    var p = $("#page");
    p.innerHTML = '<div class="spinner" style="margin:40px auto"></div>';
    ({ agenda: pageAgenda, buyers: pageBuyers, blocks: pageBlocks, history: pageHistory, settings: pageSettings })[page]();
  }

  // ---------- indicadores ----------
  function loadKpis(from, to) {
    var q = from ? "?from=" + from + "&to=" + to : "";
    api("stats" + q).then(function (s) {
      var pct = function (v) { return v == null ? "—" : String(v).replace(".", ",") + "%"; };
      $("#kpis").innerHTML =
        kpi(s.compras, "Compras", s.from.split("-").reverse().join("/") + " a " + s.to.split("-").reverse().join("/") + (s.reembolsos ? " · " + s.reembolsos + " reemb." : "")) +
        kpi(pct(s.pctAgendou), "Agendaram", s.agendaram + " de " + s.compras) +
        kpi(pct(s.pctCompareceu), "Compareceram", s.compareceram + " de " + (s.compareceram + s.faltaram) + " reuniões concluídas") +
        kpi(pct(s.pctUpgrade), "Compraram o upgrade", s.upgrades + " de " + s.compareceram + " que compareceram");
    });
  }
  function kpi(v, l, s) { return '<div class="card kpi"><div class="v">' + esc(v) + '</div><div class="l">' + esc(l) + '</div><div class="s">' + esc(s) + "</div></div>"; }

  // ---------- agenda ----------
  function pageAgenda() {
    api("agenda" + (S.week ? "?week=" + S.week : "")).then(function (r) {
      S.week = r.monday;
      var today = todayISO();
      var html = '<div class="page-head"><h1 class="h2">Agenda</h1><div class="row">' +
        '<button class="btn btn-secondary btn-xs" id="w-prev">← Semana anterior</button>' +
        '<button class="btn btn-secondary btn-xs" id="w-today">Hoje</button>' +
        '<button class="btn btn-secondary btn-xs" id="w-next">Próxima semana →</button></div></div>';
      html += '<div class="card"><div class="week-wrap"><div class="week"><div></div>';
      r.days.forEach(function (d) { html += '<div class="hd' + (d.date === today ? " today" : "") + '">' + esc(d.weekday) + " " + esc(d.label) + "</div>"; });
      var times = r.days[0].cells.map(function (c) { return c.time; });
      times.forEach(function (t, i) {
        html += '<div class="tm">' + t + "</div>";
        r.days.forEach(function (d) {
          var c = d.cells[i];
          if (c.state === "booked") html += '<button class="cell booked" data-booking="' + c.booking.id + '"><span class="nm">' + esc(c.booking.name || "Sem nome") + "</span>" + tag(c.booking.status) + "</button>";
          else if (c.state === "blocked") html += '<div class="cell blocked"><span class="nm">Bloqueado</span><span>' + esc(c.block.motivo || "") + "</span></div>";
          else html += '<div class="cell ' + c.state + '">' + (c.state === "past" ? "" : "Livre") + "</div>";
        });
      });
      html += "</div></div>";
      if (r.offGrid.length) html += '<p class="muted">Fora da grade atual: ' + r.offGrid.map(function (o) { return '<a href="#" data-booking="' + o.id + '">' + esc(o.short + " " + o.name) + "</a>"; }).join(", ") + "</p>";
      html += '<p class="muted" style="margin:12px 0 0">Legenda: ' + tag("agendado") + " " + tag("realizada") + " " + tag("nao_compareceu") + ' <span class="tag st-bloqueado">Bloqueado</span> <span class="tag st-livre">Livre</span></p></div>';
      $("#page").innerHTML = html;
      $("#w-prev").onclick = function () { S.week = r.prev; pageAgenda(); };
      $("#w-next").onclick = function () { S.week = r.next; pageAgenda(); };
      $("#w-today").onclick = function () { S.week = null; pageAgenda(); };
      $$("[data-booking]").forEach(function (b) { b.addEventListener("click", function (e) { e.preventDefault(); openBooking(Number(b.getAttribute("data-booking"))); }); });
    });
  }

  // ---------- modal ----------
  function modal(html, onClose) {
    var bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><button class="modal-close" aria-label="Fechar">×</button>' + html + "</div>";
    document.body.appendChild(bg);
    var close = function () { bg.remove(); document.removeEventListener("keydown", onKey); if (onClose) onClose(); };
    var onKey = function (e) { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    bg.addEventListener("click", function (e) { if (e.target === bg) close(); });
    $(".modal-close", bg).addEventListener("click", close);
    return { el: $(".modal", bg), close: close };
  }

  function refreshCurrent() { loadKpis(); go(S.page); }

  function slotPicker(container, days, onPick) {
    if (!days.length) { container.innerHTML = '<p class="muted">Nenhum horário livre na janela deste comprador.</p>'; return; }
    var sel = days[0].date, chosen = null;
    function draw() {
      var d = days.filter(function (x) { return x.date === sel; })[0];
      container.innerHTML =
        '<div class="mini-days">' + days.map(function (x) {
          return '<button type="button" class="day-pill" data-d="' + x.date + '" aria-pressed="' + (x.date === sel) + '"><span class="wd">' + esc(x.weekday) + '</span><span class="dt">' + esc(x.label) + "</span></button>";
        }).join("") + '</div><div class="time-grid">' + d.slots.map(function (s) {
          return '<button type="button" class="time-btn" data-s="' + s.start + '" aria-pressed="' + (s.start === chosen) + '">' + esc(s.time) + "</button>";
        }).join("") + "</div>";
      $$("[data-d]", container).forEach(function (b) { b.onclick = function () { sel = b.getAttribute("data-d"); chosen = null; onPick(null); draw(); }; });
      $$("[data-s]", container).forEach(function (b) { b.onclick = function () { chosen = Number(b.getAttribute("data-s")); onPick(chosen, sel + " " + b.textContent); draw(); }; });
    }
    draw();
  }

  function openBooking(id) {
    api("bookings/" + id).then(function (r) {
      if (!r.ok) return toast(r.message, true);
      var b = r.booking, u = r.buyer;
      var upg = b.upgradeVendido === null ? "" : b.upgradeVendido ? "sim" : "nao";
      var m = modal(
        "<h2>" + esc(u.name || "Sem nome") + "</h2>" + tag(b.status) +
        '<dl class="kv">' +
        "<dt>Reunião</dt><dd>" + esc(b.label) + "</dd>" +
        "<dt>WhatsApp</dt><dd>" + esc(u.whatsapp || "—") + " " + waBtn(u) + "</dd>" +
        "<dt>E-mail</dt><dd>" + esc(u.email) + "</dd>" +
        "<dt>Compra aprovada</dt><dd>" + esc(u.approvedLabel) + "</dd>" +
        "<dt>Fim da janela</dt><dd>" + esc(u.lastDayLabel) + "</dd>" +
        "<dt>Agendado por</dt><dd>" + esc(b.createdByType === "cliente" ? "Cliente (página)" : "Comercial: " + b.createdBy) + " em " + esc(b.createdLabel) + "</dd>" +
        "<dt>Pedido Kiwify</dt><dd>" + esc(u.orderId) + "</dd>" +
        "</dl>" +
        '<div class="stack">' +
          '<div class="field"><label for="m-status">Resultado da reunião</label><select class="input input-sm" id="m-status">' +
            ["agendado", "realizada", "nao_compareceu"].map(function (s) { return '<option value="' + s + '"' + (b.status === s ? " selected" : "") + ">" + STATUS_LABEL[s] + "</option>"; }).join("") +
          "</select></div>" +
          '<div class="field"><label for="m-upg">Comprou o upgrade?</label><select class="input input-sm" id="m-upg">' +
            '<option value=""' + (upg === "" ? " selected" : "") + '>Não informado</option><option value="sim"' + (upg === "sim" ? " selected" : "") + '>Sim</option><option value="nao"' + (upg === "nao" ? " selected" : "") + ">Não</option></select></div>" +
          '<div class="field"><label for="m-obs">Observação</label><textarea class="input" id="m-obs" maxlength="4000">' + esc(b.observacao) + "</textarea></div>" +
          '<button class="btn btn-primary btn-sm" id="m-save">Salvar</button>' +
        "</div>" +
        '<div class="divider"></div><h3 class="h3">Remarcar</h3>' +
        (r.reschedule.allowed
          ? '<p class="muted">Escolha um novo horário dentro da janela original. O horário atual será liberado.</p><div id="m-slots"><div class="spinner"></div></div><button class="btn btn-secondary btn-sm" id="m-resch" disabled style="margin-top:12px">Remarcar para o horário escolhido</button>'
          : '<p class="muted">' + esc(r.reschedule.reason) + '</p><button class="btn btn-secondary btn-sm" disabled>Remarcar</button>'),
        null
      );
      $("#m-save", m.el).onclick = function () {
        var v = $("#m-upg", m.el).value;
        api("bookings/" + id + "/update", { body: { status: $("#m-status", m.el).value, observacao: $("#m-obs", m.el).value, upgradeVendido: v === "" ? null : v === "sim" } }).then(function (x) {
          if (!x.ok) return toast(x.message, true);
          toast("Salvo.");
          m.close(); refreshCurrent();
        });
      };
      if (r.reschedule.allowed) {
        var chosen = null;
        api("bookings/" + id + "/slots").then(function (s) {
          slotPicker($("#m-slots", m.el), s.days || [], function (v) { chosen = v; $("#m-resch", m.el).disabled = !v; });
        });
        $("#m-resch", m.el).onclick = function () {
          if (!chosen || !confirm("Confirmar a remarcação? O horário antigo será liberado.")) return;
          api("bookings/" + id + "/reschedule", { body: { slotStart: chosen } }).then(function (x) {
            if (!x.ok) return toast(x.message, true);
            toast("Remarcado para " + x.booking.short + ".");
            m.close(); refreshCurrent();
          });
        };
      }
    });
  }

  // ---------- compradores ----------
  var FILTERS = [["pending", "Sem agendamento"], ["booked", "Agendados"], ["expired", "Expirados"], ["refunded", "Reembolsados"], ["all", "Todos"]];

  function pageBuyers() {
    var head = '<div class="page-head"><h1 class="h2">Compradores</h1>' +
      '<input class="input input-sm" id="q" placeholder="Buscar nome, e-mail ou WhatsApp" style="max-width:320px" value="' + esc(S.q) + '"></div>' +
      '<div class="tabs" role="tablist" style="margin-bottom:14px">' + FILTERS.map(function (f) {
        return '<button class="tab" role="tab" data-f="' + f[0] + '" aria-selected="' + (S.buyersFilter === f[0]) + '">' + f[1] + "</button>";
      }).join("") + '</div><div id="list" class="card"><div class="spinner"></div></div>';
    $("#page").innerHTML = head;
    $$("[data-f]").forEach(function (b) { b.onclick = function () { S.buyersFilter = b.getAttribute("data-f"); pageBuyers(); }; });
    var t;
    $("#q").addEventListener("input", function (e) { clearTimeout(t); t = setTimeout(function () { S.q = e.target.value; loadBuyers(); }, 300); });
    loadBuyers();
  }

  function loadBuyers() {
    api("buyers?filter=" + S.buyersFilter + "&q=" + encodeURIComponent(S.q)).then(function (r) {
      var list = r.buyers || [];
      if (!list.length) { $("#list").innerHTML = '<p class="muted" style="margin:0">Nenhum comprador nesta lista.</p>'; return; }
      var pending = S.buyersFilter === "pending";
      var html = '<div class="table-wrap"><table><thead><tr><th>Nome</th><th>WhatsApp</th><th>E-mail</th><th>Aprovação</th><th>Último dia</th>' +
        (pending ? "<th>Dias restantes</th>" : "<th>Status</th>") + "<th></th></tr></thead><tbody>";
      list.forEach(function (b) {
        html += "<tr><td><strong>" + esc(b.name || "—") + "</strong></td><td>" + waBtn(b) + '<div class="muted">' + esc(b.whatsapp) + "</div></td><td>" + esc(b.email) + "</td><td>" + esc(b.approvedLabel) + "</td><td>" + esc(b.lastDayLabel) + "</td>" +
          (pending ? '<td class="' + (b.daysLeft <= 1 ? "urgent" : "") + '">' + b.daysLeft + "</td>" : "<td>" + tag(b.status) + "</td>") +
          '<td><div class="row" style="flex-wrap:nowrap">' + (b.status === "ativo" && pending ? '<button class="btn btn-primary btn-xs" data-book="' + b.id + '">Agendar</button>' : "") +
          '<button class="btn btn-secondary btn-xs" data-buyer="' + b.id + '">Detalhes</button></div></td></tr>';
      });
      html += "</tbody></table></div>";
      $("#list").innerHTML = html;
      $$("[data-book]").forEach(function (b) { b.onclick = function () { openBookFor(Number(b.getAttribute("data-book"))); }; });
      $$("[data-buyer]").forEach(function (b) { b.onclick = function () { openBuyer(Number(b.getAttribute("data-buyer"))); }; });
    });
  }

  function openBookFor(id) {
    api("buyers/" + id).then(function (r) {
      var u = r.buyer, chosen = null;
      var m = modal(
        "<h2>Agendar para " + esc(u.name || u.email) + "</h2>" +
        '<p class="muted">Mesmas regras da página pública: só horários livres dentro da janela (até ' + esc(u.lastDayLabel) + ").</p>" +
        '<div class="stack"><div class="field"><label for="b-wa">WhatsApp</label><input class="input input-sm" id="b-wa" value="' + esc(u.whatsapp) + '" placeholder="(11) 98765-4321"></div></div>' +
        '<div id="b-slots" style="margin-top:14px"><div class="spinner"></div></div>' +
        '<button class="btn btn-primary btn-sm" id="b-ok" disabled style="margin-top:14px">Confirmar agendamento</button>'
      );
      api("buyers/" + id + "/slots").then(function (s) { slotPicker($("#b-slots", m.el), s.days || [], function (v) { chosen = v; $("#b-ok", m.el).disabled = !v; }); });
      $("#b-ok", m.el).onclick = function () {
        api("buyers/" + id + "/book", { body: { slotStart: chosen, whatsapp: $("#b-wa", m.el).value } }).then(function (x) {
          if (!x.ok) return toast(x.message, true);
          toast("Agendado: " + x.booking.short + ".");
          m.close(); refreshCurrent();
        });
      };
    });
  }

  function openBuyer(id) {
    api("buyers/" + id).then(function (r) {
      var u = r.buyer;
      var m = modal(
        "<h2>" + esc(u.name || "Sem nome") + "</h2>" + tag(u.status) +
        '<dl class="kv"><dt>WhatsApp</dt><dd>' + esc(u.whatsapp || "—") + " " + waBtn(u) + "</dd><dt>E-mail</dt><dd>" + esc(u.email) + "</dd>" +
        "<dt>Compra aprovada</dt><dd>" + esc(u.approvedLabel) + "</dd><dt>Último dia</dt><dd>" + esc(u.lastDayLabel) + " (" + u.daysLeft + " dia(s) restante(s))</dd>" +
        "<dt>Pedido Kiwify</dt><dd>" + esc(u.orderId) + "</dd>" +
        '<dt>Link pessoal</dt><dd><button class="btn btn-secondary btn-xs" id="u-copy">Copiar link de agendamento</button></dd></dl>' +
        '<div class="stack"><div class="row"><input class="input input-sm" id="u-name" value="' + esc(u.name) + '" style="flex:1;min-width:160px" aria-label="Nome">' +
        '<input class="input input-sm" id="u-wa" value="' + esc(u.whatsapp) + '" style="flex:1;min-width:160px" aria-label="WhatsApp" placeholder="WhatsApp">' +
        '<button class="btn btn-secondary btn-xs" id="u-save">Salvar contato</button></div></div>' +
        '<div class="divider"></div><h3 class="h3">Reuniões</h3>' +
        (r.bookings.length ? '<ul class="check-list" style="margin-top:10px">' + r.bookings.map(function (b) {
          return '<li><a href="#" data-bk="' + b.id + '">' + esc(b.short) + "</a> " + tag(b.status) + "</li>";
        }).join("") + "</ul>" : '<p class="muted">Nenhuma.</p>') +
        '<div class="divider"></div><h3 class="h3">Histórico</h3><div class="table-wrap"><table><tbody>' +
        r.events.map(function (e) { return "<tr><td class=\"muted\">" + esc(e.createdLabel) + "</td><td>" + esc(e.tipo) + "</td><td>" + esc(e.resumo) + "</td><td>" + esc(e.actor) + "</td></tr>"; }).join("") +
        "</tbody></table></div>"
      );
      $("#u-copy", m.el).onclick = function () {
        (navigator.clipboard ? navigator.clipboard.writeText(u.bookingLink) : Promise.reject()).then(function () { toast("Link copiado."); }, function () { prompt("Copie o link:", u.bookingLink); });
      };
      $("#u-save", m.el).onclick = function () {
        api("buyers/" + id + "/contact", { body: { name: $("#u-name", m.el).value, whatsapp: $("#u-wa", m.el).value } }).then(function (x) {
          if (!x.ok) return toast(x.message, true);
          toast("Contato atualizado."); m.close(); refreshCurrent();
        });
      };
      $$("[data-bk]", m.el).forEach(function (a) { a.onclick = function (e) { e.preventDefault(); m.close(); openBooking(Number(a.getAttribute("data-bk"))); }; });
    });
  }

  // ---------- bloqueios ----------
  function pageBlocks() {
    var html = '<div class="page-head"><h1 class="h2">Bloqueios</h1></div>' +
      '<div class="card stack" style="max-width:640px"><h3 class="h3">Novo bloqueio</h3>' +
      '<div class="row"><div class="field" style="flex:1;min-width:150px"><label for="k-date">Data</label><input class="input input-sm" type="date" id="k-date" min="' + todayISO() + '" value="' + todayISO() + '"></div>' +
      '<div class="field" style="flex:1;min-width:150px"><label for="k-mode">O que bloquear</label><select class="input input-sm" id="k-mode"><option value="slot">Um horário</option><option value="range">Intervalo de horas</option><option value="day">Dia inteiro</option></select></div></div>' +
      '<div class="row" id="k-times"></div>' +
      '<div class="field"><label for="k-motivo">Motivo (opcional)</label><input class="input input-sm" id="k-motivo" maxlength="200" placeholder="Ex.: médico"></div>' +
      '<div id="k-conflict"></div><button class="btn btn-primary btn-sm" id="k-save">Bloquear</button></div>' +
      '<h3 class="h3" style="margin:22px 0 10px">Bloqueios futuros</h3><div class="card" id="k-list"><div class="spinner"></div></div>';
    $("#page").innerHTML = html;
    var times = [];
    api("agenda").then(function (a) { times = a.days[0].cells.map(function (c) { return c.time; }); drawTimes(); });
    function drawTimes() {
      var mode = $("#k-mode").value, t = $("#k-times");
      if (mode === "slot") t.innerHTML = '<div class="field" style="flex:1"><label for="k-time">Horário</label><select class="input input-sm" id="k-time">' + times.map(function (x) { return "<option>" + x + "</option>"; }).join("") + "</select></div>";
      else if (mode === "range") t.innerHTML = '<div class="field" style="flex:1"><label for="k-from">De</label><input class="input input-sm" type="time" id="k-from" value="08:00"></div><div class="field" style="flex:1"><label for="k-to">Até</label><input class="input input-sm" type="time" id="k-to" value="12:00"></div>';
      else t.innerHTML = "";
    }
    $("#k-mode").onchange = drawTimes;
    drawTimes();
    function save(confirmFlag) {
      var mode = $("#k-mode").value;
      var body = { date: $("#k-date").value, mode: mode, motivo: $("#k-motivo").value, confirm: !!confirmFlag };
      if (mode === "slot") body.time = $("#k-time").value;
      if (mode === "range") { body.from = $("#k-from").value; body.to = $("#k-to").value; }
      api("blocks", { body: body }).then(function (r) {
        if (r._status === 409 && r.conflicts) {
          $("#k-conflict").innerHTML = '<div class="notice notice--warn"><strong>Atenção:</strong> já há reunião agendada nesse período: ' +
            r.conflicts.map(function (c) { return esc(c.short + " (" + c.name + ")"); }).join(", ") +
            '. O bloqueio não cancela essas reuniões; remarque-as pela Agenda se precisar.<div class="row" style="margin-top:10px"><button class="btn btn-secondary btn-xs" id="k-force">Bloquear mesmo assim</button></div></div>';
          $("#k-force").onclick = function () { save(true); };
          return;
        }
        if (!r.ok) return toast(r.message, true);
        $("#k-conflict").innerHTML = "";
        toast("Bloqueio criado.");
        loadBlocks();
      });
    }
    $("#k-save").onclick = function () { save(false); };
    loadBlocks();
  }

  function loadBlocks() {
    api("blocks").then(function (r) {
      var l = r.blocks || [];
      $("#k-list").innerHTML = l.length ? '<div class="table-wrap"><table><thead><tr><th>Período</th><th>Motivo</th><th>Criado por</th><th></th></tr></thead><tbody>' +
        l.map(function (b) { return "<tr><td><strong>" + esc(b.label) + "</strong></td><td>" + esc(b.motivo || "—") + "</td><td>" + esc(b.createdBy) + '</td><td><button class="btn btn-danger btn-xs" data-del="' + b.id + '">Remover</button></td></tr>'; }).join("") +
        "</tbody></table></div>" : '<p class="muted" style="margin:0">Nenhum bloqueio futuro.</p>';
      $$("[data-del]").forEach(function (b) {
        b.onclick = function () {
          if (!confirm("Remover este bloqueio? Os horários voltam a ficar livres.")) return;
          api("blocks/" + b.getAttribute("data-del"), { method: "DELETE" }).then(function () { toast("Bloqueio removido."); loadBlocks(); });
        };
      });
    });
  }

  // ---------- histórico ----------
  var EV_LABEL = {
    compra: "Compra", agendamento: "Agendamento", remarcacao: "Remarcação", bloqueio: "Bloqueio", bloqueio_removido: "Bloqueio removido",
    reembolso: "Reembolso", chargeback: "Chargeback", bonus_expirado: "Bônus expirado", atualizacao_reuniao: "Reunião atualizada",
    email_enviado: "E-mail enviado", erro_email: "Erro de e-mail", erro_telegram: "Erro no Telegram", erro_cron: "Erro em tarefa",
    configuracao: "Configuração", usuario_criado: "Usuário criado", usuario_alterado: "Usuário alterado", contato_atualizado: "Contato atualizado", webhook_ignorado: "Webhook ignorado",
  };
  function pageHistory() {
    $("#page").innerHTML = '<div class="page-head"><h1 class="h2">Histórico</h1><div class="tabs"><button class="tab" id="h-ev" aria-selected="true">Eventos</button><button class="tab" id="h-wh" aria-selected="false">Webhooks recebidos</button></div></div><div class="card" id="h-body"><div class="spinner"></div></div>';
    $("#h-ev").onclick = function () { $("#h-ev").setAttribute("aria-selected", "true"); $("#h-wh").setAttribute("aria-selected", "false"); loadEvents(); };
    $("#h-wh").onclick = function () { $("#h-wh").setAttribute("aria-selected", "true"); $("#h-ev").setAttribute("aria-selected", "false"); loadWebhooks(); };
    loadEvents();
  }
  function loadEvents(before, append) {
    api("events" + (before ? "?before=" + before : "")).then(function (r) {
      var rows = (r.events || []).map(function (e) {
        var isErr = String(e.tipo).indexOf("erro") === 0;
        return "<tr><td class=\"muted\" style=\"white-space:nowrap\">" + esc(e.createdLabel) + "</td><td>" + (isErr ? '<span class="tag st-nao_compareceu">' : "<strong>") + esc(EV_LABEL[e.tipo] || e.tipo) + (isErr ? "</span>" : "</strong>") +
          "</td><td>" + esc(e.buyer_name || "") + "</td><td>" + esc(e.resumo) + "</td><td>" + esc(e.actor) + "</td></tr>";
      }).join("");
      var last = r.events && r.events.length ? r.events[r.events.length - 1].id : null;
      if (!append) $("#h-body").innerHTML = '<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Evento</th><th>Comprador</th><th>Detalhe</th><th>Quem</th></tr></thead><tbody id="h-rows"></tbody></table></div><div id="h-more"></div>';
      $("#h-rows").insertAdjacentHTML("beforeend", rows || (append ? "" : '<tr><td colspan="5" class="muted">Nada registrado ainda.</td></tr>'));
      $("#h-more").innerHTML = r.events && r.events.length === 100 ? '<button class="btn btn-secondary btn-xs" style="margin-top:12px">Carregar mais</button>' : "";
      var mb = $("#h-more button");
      if (mb) mb.onclick = function () { loadEvents(last, true); };
    });
  }
  function loadWebhooks() {
    api("webhooks").then(function (r) {
      var l = r.webhooks || [];
      $("#h-body").innerHTML = '<p class="muted" style="margin-top:0">Últimos 50 avisos recebidos da Kiwify (conteúdo bruto, para conferência).</p>' + (l.length ? l.map(function (w) {
        return '<details style="border-bottom:1px solid var(--stroke);padding:10px 0"><summary style="cursor:pointer">' + esc(w.receivedLabel) + " · " + (w.valid ? '<span class="tag st-realizada">válido</span>' : '<span class="tag st-nao_compareceu">assinatura inválida</span>') +
          " · " + esc(w.event_type || "?") + " · pedido " + esc(w.order_id || "?") + " · " + esc(w.result) + '</summary><pre class="raw">' + esc(pretty(w.body)) + "</pre></details>";
      }).join("") : '<p class="muted">Nenhum webhook recebido ainda.</p>');
    });
  }
  function pretty(s) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch (e) { return s; } }

  // ---------- ajustes ----------
  function pageSettings() {
    Promise.all([api("config"), api("users")]).then(function (res) {
      var c = res[0], u = res[1];
      var groups = {};
      c.fields.forEach(function (f) { (groups[f.group] = groups[f.group] || []).push(f); });
      var sec = function (ok) { return ok ? '<span class="tag st-realizada">cadastrado</span>' : '<span class="tag st-nao_compareceu">faltando</span>'; };
      var html = '<div class="page-head"><h1 class="h2">Ajustes</h1></div><div class="stack" style="max-width:760px">' +
        '<div class="card stack"><h3 class="h3">Endereços para a Kiwify</h3>' +
        '<div class="field"><label>URL do webhook</label><input class="input input-sm" readonly value="' + esc(c.webhookUrl) + '"></div>' +
        '<div class="field"><label>Página de obrigado</label><input class="input input-sm" readonly value="' + esc(c.thankYouUrl) + '"></div></div>' +
        '<div class="card stack"><h3 class="h3">Segredos (cadastrados na Cloudflare)</h3><dl class="kv" style="margin:0">' +
        Object.keys(c.secrets).map(function (k) { return "<dt>" + k + "</dt><dd>" + sec(c.secrets[k]) + "</dd>"; }).join("") +
        '</dl><div class="row"><button class="btn btn-secondary btn-xs" id="s-tg">Enviar mensagem de teste no Telegram</button></div></div>';
      Object.keys(groups).forEach(function (g) {
        html += '<form class="card stack" data-group="' + esc(g) + '"><h3 class="h3">' + esc(g) + "</h3>";
        groups[g].forEach(function (f) {
          var id = "c-" + f.key;
          var input;
          if (f.type === "textarea") input = '<textarea class="input" id="' + id + '" name="' + f.key + '">' + esc(f.value) + "</textarea>";
          else if (f.type === "boolean") input = '<select class="input input-sm" id="' + id + '" name="' + f.key + '"><option value="true"' + (f.value === "true" ? " selected" : "") + '>Sim</option><option value="false"' + (f.value !== "true" ? " selected" : "") + ">Não</option></select>";
          else input = '<input class="input input-sm" id="' + id + '" name="' + f.key + '" type="' + (f.type === "number" ? "number" : f.type === "time" ? "time" : "text") + '" value="' + esc(f.value) + '">';
          html += '<div class="field"><label for="' + id + '">' + esc(f.label) + "</label>" + input + (f.help ? '<span class="muted">' + esc(f.help) + "</span>" : "") + "</div>";
        });
        html += '<div><button class="btn btn-primary btn-sm" type="submit">Salvar ' + esc(g.toLowerCase()) + "</button></div></form>";
      });
      html += '<div class="card stack"><h3 class="h3">Usuários do painel</h3><div class="table-wrap"><table><tbody>' +
        u.users.map(function (x) {
          return "<tr><td><strong>" + esc(x.name) + "</strong>" + (x.is_owner ? ' <span class="muted">(dono)</span>' : "") + "</td><td>" + (x.active ? tag("realizada").replace("Realizada", "Ativo") : '<span class="tag st-livre">Inativo</span>') + "</td><td>" +
            (S.user.isOwner && !x.is_owner ? '<button class="btn btn-secondary btn-xs" data-toggle="' + x.id + '" data-active="' + x.active + '">' + (x.active ? "Desativar" : "Reativar") + "</button> " +
              '<button class="btn btn-secondary btn-xs" data-pw="' + x.id + '">Nova senha</button>' : "") + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        (S.user.isOwner ? '<form class="row" id="f-user"><input class="input input-sm" id="nu-name" placeholder="Nome" style="flex:1;min-width:140px" required><input class="input input-sm" id="nu-pw" type="password" placeholder="Senha (mín. 8)" style="flex:1;min-width:140px" required><button class="btn btn-primary btn-xs" type="submit">Adicionar</button></form>' : "") +
        '</div><form class="card stack" id="f-pw"><h3 class="h3">Trocar minha senha</h3><div class="row"><input class="input input-sm" type="password" id="pw-cur" placeholder="Senha atual" style="flex:1;min-width:140px" autocomplete="current-password"><input class="input input-sm" type="password" id="pw-new" placeholder="Nova senha (mín. 8)" style="flex:1;min-width:140px" autocomplete="new-password"><button class="btn btn-secondary btn-xs" type="submit">Trocar</button></div></form></div>';
      $("#page").innerHTML = html;

      $$("form[data-group]").forEach(function (f) {
        f.addEventListener("submit", function (e) {
          e.preventDefault();
          var values = {};
          $$("[name]", f).forEach(function (i) { values[i.name] = i.value; });
          api("config", { body: { values: values } }).then(function (r) { r.ok ? toast("Configurações salvas.") : toast(r.message, true); });
        });
      });
      $("#s-tg").onclick = function () { api("test-notify", { body: {} }).then(function (r) { toast(r.message, !r.ok); }); };
      var fu = $("#f-user");
      if (fu) fu.addEventListener("submit", function (e) {
        e.preventDefault();
        api("users", { body: { name: $("#nu-name").value, password: $("#nu-pw").value } }).then(function (r) { if (!r.ok) return toast(r.message, true); toast("Usuário criado."); pageSettings(); });
      });
      $$("[data-toggle]").forEach(function (b) {
        b.onclick = function () { api("users/" + b.getAttribute("data-toggle"), { body: { active: b.getAttribute("data-active") !== "1" } }).then(function (r) { if (!r.ok) return toast(r.message, true); pageSettings(); }); };
      });
      $$("[data-pw]").forEach(function (b) {
        b.onclick = function () {
          var pw = prompt("Nova senha para este usuário (mínimo 8 caracteres):");
          if (pw) api("users/" + b.getAttribute("data-pw"), { body: { password: pw } }).then(function (r) { r.ok ? toast("Senha alterada.") : toast(r.message, true); });
        };
      });
      $("#f-pw").addEventListener("submit", function (e) {
        e.preventDefault();
        api("password", { body: { current: $("#pw-cur").value, password: $("#pw-new").value } }).then(function (r) { r.ok ? toast("Senha alterada.") : toast(r.message, true); });
      });
    });
  }

  // ---------- início ----------
  api("me").then(function (r) { S.user = r.user; shell(); }, function () {});
})();
