/* =====================================================================
   app.js  —  the UI layer  (read-only viewer)
   ---------------------------------------------------------------------
   Ties yaml.js + events.js to the DOM: draws the calendar, handles the
   tag filters, the day + event overlays, and the command line.

   Events come ONLY from the YAML files under /events/ — there is no
   "add" from the page. To change what's on the calendar, edit the YAML
   (see the GitHub repo) and hit reload.

   Reading order:
     STATE → DATA LOADING → RENDER → FILTERS → OVERLAYS → NAV
     → TERMINAL → BOOT/RAIN/CLOCK → INIT
   ===================================================================== */
(function () {
  "use strict";

  var E = window.KaliEvents;
  var MONTHS = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY",
                "AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion:reduce)").matches;

  /* ---- STATE ---- */
  var view = new Date(); view.setDate(1); view.setHours(0,0,0,0);
  var config = { term:null, breaks:[], months:[], tags:[] };
  var rules = [];                 // recurring rules
  var monthCache = {};            // { "2026-09": [events from file] }
  var tagOrder = [];              // ordered list of known tag names
  var tagLabels = {};             // name -> pretty label
  var enabled = {};               // name -> bool (filter state)

  /* ---- DOM refs ---- */
  var $ = function (id) { return document.getElementById(id); };
  var grid=$("grid"), ops=$("ops"), legend=$("legend"), tagbar=$("tagfilters"),
      mName=$("mName"), mYear=$("mYear"), total=$("total"),
      logEl=$("log"), cmd=$("cmd");

  /* ---- DATA LOADING ---- */
  function ym(y, m) { return y + "-" + (m < 9 ? "0" : "") + (m + 1); }

  function ensureMonth(ym) {
    // Load a month's file once, then cache it. Re-render when it arrives.
    if (monthCache[ym]) return Promise.resolve(monthCache[ym]);
    monthCache[ym] = [];                       // mark as loading/empty
    return E.loadMonth(ym).then(function (list) {
      monthCache[ym] = list;
      refreshTags();
      render();
      return list;
    });
  }

  // every event for the currently viewed month
  function eventsForView() {
    var y = view.getFullYear(), m = view.getMonth(), key = ym(y, m);
    var out = E.expandRecurring(rules, y, m, config.term, config.breaks);
    return out.concat(monthCache[key] || []);
  }

  // An event's effective tags = its tags, or [category] if it has none.
  function effTags(e) { return (e.tags && e.tags.length) ? e.tags : [e.category]; }
  function isVisible(e) { return effTags(e).some(function (t) { return enabled[t] !== false; }); }

  /* ---- RENDER ---- */
  function render() {
    var y = view.getFullYear(), m = view.getMonth();
    mName.textContent = MONTHS[m]; mYear.textContent = y;

    var all = eventsForView();
    var shown = all.filter(isVisible);
    var byDay = {};
    shown.forEach(function (e) { (byDay[e.date] = byDay[e.date] || []).push(e); });
    Object.keys(byDay).forEach(function (d) {
      byDay[d].sort(function (a,b){ return (a.time||"99").localeCompare(b.time||"99"); });
    });

    // build 6x7 grid
    grid.innerHTML = "";
    var first = new Date(y, m, 1).getDay();
    var start = new Date(y, m, 1); start.setDate(start.getDate() - first);
    var today = E.isoOf(new Date());
    for (var i = 0; i < 42; i++) {
      var d = new Date(start); d.setDate(start.getDate() + i);
      var iso = E.isoOf(d), out = d.getMonth() !== m;
      var cell = document.createElement("div");
      cell.className = "cell" + (out ? " out" : "") + (iso === today ? " today" : "");
      var num = document.createElement("div"); num.className = "num"; num.textContent = d.getDate();
      cell.appendChild(num);

      var list = byDay[iso] || [];
      if (list.length) {
        var chips = document.createElement("div"); chips.className = "chips";
        list.slice(0, 3).forEach(function (ev) {
          var c = document.createElement("div");
          c.className = "chip cat-" + ev.category;
          c.textContent = (ev.time ? ev.time + " " : "") + ev.title;
          c.title = ev.title;
          c.addEventListener("click", function (e) { e.stopPropagation(); openEvent(ev); });
          chips.appendChild(c);
        });
        if (list.length > 3) {
          var more = document.createElement("div"); more.className = "more";
          more.textContent = "+" + (list.length - 3) + " more";
          chips.appendChild(more);
        }
        cell.appendChild(chips);
      }
      cell.addEventListener("click", (function (iso) { return function () { openDay(iso); }; })(iso));
      grid.appendChild(cell);
    }

    renderOps(all);
    renderLegend(shown);
    total.textContent = shown.length;
  }

  function renderOps(all) {
    var today = E.isoOf(new Date());
    var up = all.filter(isVisible)
      .filter(function (e){ return e.date >= today; })
      .sort(function (a,b){ return (a.date+(a.time||"99")).localeCompare(b.date+(b.time||"99")); })
      .slice(0, 5);
    ops.innerHTML = "";
    if (!up.length) {
      var li = document.createElement("li"); li.className = "op-empty";
      li.textContent = "> nothing upcoming in this view."; ops.appendChild(li); return;
    }
    up.forEach(function (e) {
      var dt = new Date(e.date + "T00:00:00");
      var li = document.createElement("li"); li.className = "op";
      var dot = document.createElement("span"); dot.className = "dot-cat cat-" + e.category;
      var dd = document.createElement("span"); dd.className = "d";
      dd.textContent = ("0"+(dt.getMonth()+1)).slice(-2) + "/" + ("0"+dt.getDate()).slice(-2);
      var tt = document.createElement("span"); tt.className = "t"; tt.textContent = e.title;
      li.appendChild(dot); li.appendChild(dd); li.appendChild(tt);
      li.addEventListener("click", function () { openEvent(e); });
      ops.appendChild(li);
    });
  }

  function renderLegend(shown) {
    var cats = {};
    shown.forEach(function (e) { cats[e.category] = true; });
    var names = { meeting:"meeting", ctf:"CTF", workshop:"workshop",
                  social:"social", club:"club", other:"other" };
    legend.innerHTML = "";
    Object.keys(cats).forEach(function (c) {
      var row = document.createElement("div"); row.className = "leg cat-" + c;
      row.appendChild(document.createElement("i"));
      row.appendChild(document.createTextNode(" " + (names[c] || c)));
      legend.appendChild(row);
    });
  }

  /* ---- FILTERS (tag toggles) ---- */
  function refreshTags() {
    // Seed from config the first time.
    if (!tagOrder.length && config.tags && config.tags.length) {
      config.tags.forEach(function (t) {
        var name = (t.name || t).toString();
        if (enabled[name] === undefined) { tagOrder.push(name); enabled[name] = true; }
        tagLabels[name] = t.label || name;
      });
    }
    // Discover any tags present in loaded data we haven't seen yet.
    var seen = {};
    rules.forEach(function (r){ (r.tags||[]).forEach(function(t){ seen[t]=true; }); });
    Object.keys(monthCache).forEach(function (k) {
      monthCache[k].forEach(function (e){ effTags(e).forEach(function(t){ seen[t]=true; }); });
    });
    Object.keys(seen).forEach(function (t) {
      if (enabled[t] === undefined) { tagOrder.push(t); enabled[t] = true; tagLabels[t] = tagLabels[t]||t; }
    });
    renderTagBar();
  }

  function renderTagBar() {
    tagbar.innerHTML = "";
    if (!tagOrder.length) {
      var none = document.createElement("div"); none.className = "op-empty";
      none.textContent = "// no tags yet"; tagbar.appendChild(none); return;
    }
    tagOrder.forEach(function (name) {
      var b = document.createElement("div");
      b.className = "tag " + (enabled[name] ? "on" : "off");
      b.textContent = tagLabels[name] || name;
      b.title = name;
      b.addEventListener("click", function () { enabled[name] = !enabled[name]; renderTagBar(); render(); });
      tagbar.appendChild(b);
    });
  }
  function setAllTags(v) { tagOrder.forEach(function (t){ enabled[t] = v; }); renderTagBar(); render(); }

  /* ---- OVERLAYS ---- */
  function timeLabel(e) {
    if (e.time && e.endTime) return e.time + "\u2013" + e.endTime;
    if (e.time) return e.time;
    return "all day";
  }

  // single-event detail (opens when you click an event)
  var eventOverlay = $("eventOverlay"), detailBody = $("detailBody"), detailAccent = $("detailAccent");
  function openEvent(e) {
    detailAccent.style.background = "var(--cat-" + e.category + ", var(--dragon))";
    var dt = new Date(e.date + "T00:00:00");
    var rows = [
      ["when", dt.toDateString() + " \u00b7 " + timeLabel(e)],
      ["where", e.location || "\u2014"],
      ["type", e.category],
      ["source", e.source === "recurring" ? "weekly (recurring.yaml)" : "events file"]
    ];
    var html = '<div class="drow"><div class="k">title</div><div class="v">' + escapeHtml(e.title) + "</div></div>";
    rows.forEach(function (r) {
      html += '<div class="drow"><div class="k">' + r[0] + '</div><div class="v">' + escapeHtml(r[1]) + "</div></div>";
    });
    if (e.tags && e.tags.length) {
      html += '<div class="drow"><div class="k">tags</div><div class="v"><div class="dtags">' +
        e.tags.map(function (t){ return "<span>" + escapeHtml(t) + "</span>"; }).join("") + "</div></div></div>";
    }
    if (e.note) html += '<div class="drow"><div class="k">note</div><div class="v">' + escapeHtml(e.note) + "</div></div>";
    html += '<div class="mfoot"><button class="btn accent" id="detClose">close</button></div>';
    detailBody.innerHTML = html;
    $("detClose").addEventListener("click", closeOverlays);
    eventOverlay.classList.add("on");
  }

  // day list
  var dayOverlay = $("dayOverlay"), evlist = $("evlist");
  function openDay(iso) {
    $("dayDate").textContent = new Date(iso + "T00:00:00").toDateString();
    var list = eventsForView().filter(isVisible).filter(function (e){ return e.date === iso; })
      .sort(function (a,b){ return (a.time||"99").localeCompare(b.time||"99"); });
    evlist.innerHTML = "";
    if (!list.length) evlist.innerHTML = '<div class="mnote">// no events on this date (in the current filter).</div>';
    list.forEach(function (e) {
      var row = document.createElement("div"); row.className = "evitem cat-" + e.category;
      var info = document.createElement("div"); info.className = "info";
      info.innerHTML = '<div class="ti">' + escapeHtml(e.title) + '</div><div class="me">' +
        escapeHtml(timeLabel(e) + (e.location ? " \u00b7 " + e.location : "")) + "</div>";
      row.appendChild(info);
      row.addEventListener("click", function () { closeOverlays(); openEvent(e); });
      evlist.appendChild(row);
    });
    dayOverlay.classList.add("on");
  }
  $("dayClose").addEventListener("click", closeOverlays);

  function closeOverlays() {
    [dayOverlay, eventOverlay].forEach(function (o){ o.classList.remove("on"); });
  }
  // click backdrop or Esc closes
  [dayOverlay, eventOverlay].forEach(function (o) {
    o.addEventListener("click", function (e) { if (e.target === o) closeOverlays(); });
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeOverlays(); });

  /* ---- NAV ---- */
  function goto(d) { view = new Date(d.getFullYear(), d.getMonth(), 1); afterNav(); }
  function afterNav() { ensureMonth(ym(view.getFullYear(), view.getMonth())); render(); }
  $("prev").addEventListener("click", function () { view.setMonth(view.getMonth()-1); afterNav(); });
  $("next").addEventListener("click", function () { view.setMonth(view.getMonth()+1); afterNav(); });
  $("todayBtn").addEventListener("click", function () { goto(new Date()); });
  $("tagAll").addEventListener("click", function () { setAllTags(true); });
  $("tagNone").addEventListener("click", function () { setAllTags(false); });

  /* ---- TERMINAL ---- */
  function logline(txt, cls) {
    var l = document.createElement("div"); l.className = "l " + (cls || "");
    l.textContent = txt; logEl.appendChild(l); logEl.scrollTop = logEl.scrollHeight;
  }
  var HELP = [
    "commands:",
    "  ls [YYYY-MM]        list events (default: current view)",
    "  goto YYYY-MM        jump to a month",
    "  today | next | prev navigate",
    "  tags                list tags + on/off state",
    "  filter <tag> on|off toggle a tag (or: filter all|none)",
    "  reload              re-fetch the /events/ files from the server",
    "  banner | clear | whoami",
    "",
    "  events are edited in the YAML files (see the GitHub repo)."
  ];
  function args(s) { var o=[],re=/"([^"]*)"|(\S+)/g,m; while((m=re.exec(s))) o.push(m[1]!==undefined?m[1]:m[2]); return o; }

  function run(raw) {
    var s = raw.trim(); if (!s) return;
    logline("kali@algonquin:~$ " + s, "echo");
    var a = args(s), c = a[0].toLowerCase();

    if (c === "help") HELP.forEach(function (x){ logline(x, "sys"); });
    else if (c === "clear") logEl.innerHTML = "";
    else if (c === "banner") banner();
    else if (c === "whoami") logline("root (uid=0) — mundus noster domain", "ok");
    else if (c === "today") { goto(new Date()); logline("→ current month", "ok"); }
    else if (c === "next") { view.setMonth(view.getMonth()+1); afterNav(); logline("→ " + MONTHS[view.getMonth()] + " " + view.getFullYear(), "ok"); }
    else if (c === "prev") { view.setMonth(view.getMonth()-1); afterNav(); logline("→ " + MONTHS[view.getMonth()] + " " + view.getFullYear(), "ok"); }
    else if (c === "goto") {
      if (!a[1]) return logline("usage: goto YYYY-MM", "err");
      var d = new Date((a[1].length <= 7 ? a[1] + "-01" : a[1]) + "T00:00:00");
      if (isNaN(d)) return logline("bad date: " + a[1], "err");
      goto(d); logline("→ " + MONTHS[d.getMonth()] + " " + d.getFullYear(), "ok");
    }
    else if (c === "tags") {
      if (!tagOrder.length) return logline("no tags loaded yet", "sys");
      tagOrder.forEach(function (t){ logline("  [" + (enabled[t] ? "x" : " ") + "] " + t, ""); });
    }
    else if (c === "filter") {
      if (a[1] === "all") { setAllTags(true); return logline("all tags on", "ok"); }
      if (a[1] === "none") { setAllTags(false); return logline("all tags off", "ok"); }
      var tag = a[1], st = (a[2]||"toggle").toLowerCase();
      if (!tag || enabled[tag] === undefined) return logline("unknown tag: " + tag + " (try 'tags')", "err");
      enabled[tag] = st === "on" ? true : st === "off" ? false : !enabled[tag];
      renderTagBar(); render(); logline("filter " + tag + " → " + (enabled[tag] ? "on" : "off"), "ok");
    }
    else if (c === "ls") {
      var scope = a[1];
      var list = (scope ? allLoaded().filter(function(e){return e.date.indexOf(scope)===0;}) : eventsForView())
        .slice().sort(function (x,y){ return (x.date+(x.time||"")).localeCompare(y.date+(y.time||"")); });
      if (!list.length) return logline("no events found", "sys");
      list.forEach(function (e){ logline("  " + e.date + " " + (e.time||"--:--") + "  " + e.category.padEnd(9) + " " + e.title, ""); });
      logline(list.length + " event(s)", "sys");
    }
    else if (c === "reload") { logline("re-fetching /events/ ...", "sys"); reload(); }
    else logline("command not found: " + c + " (try 'help')", "err");
  }
  cmd.addEventListener("keydown", function (e) { if (e.key === "Enter") { run(cmd.value); cmd.value = ""; } });

  function allLoaded() {
    var out = [];
    Object.keys(monthCache).forEach(function (k){ out = out.concat(monthCache[k]); });
    Object.keys(monthCache).forEach(function (k) {
      var p = k.split("-"); out = out.concat(E.expandRecurring(rules, +p[0], +p[1]-1, config.term, config.breaks));
    });
    return out;
  }

  function banner() {
    var rows = ["ALGONQUIN KALI CLUB  ::  ops calendar v2.0",
                "mundus noster domain  \u00b7  hack the planet"];
    var pad = 3, w = 0; rows.forEach(function (r){ if (r.length > w) w = r.length; });
    var inner = w + pad*2, bar = new Array(inner+1).join("=");
    logline("+" + bar + "+", "echo");
    rows.forEach(function (r){ logline("|" + new Array(pad+1).join(" ") + r + new Array(inner-pad-r.length+1).join(" ") + "|", "echo"); });
    logline("+" + bar + "+", "echo");
  }

  /* ---- BOOT / RAIN / CLOCK ---- */
  function tick() {
    $("clock").innerHTML = "<span>" + new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}) + "</span>";
  }

  function matrixRain() {
    if (reduce) return;
    var cv = $("rain"), ctx = cv.getContext("2d");
    var glyphs = "01<>[]{}/\\|=+*#\u30a2\u30a6\u30a8\u30aa\u30ab\u30adABCDEF".split("");
    var cols, drops, fs = 15;
    function size() { cv.width = innerWidth; cv.height = innerHeight; cols = Math.floor(cv.width/fs); drops = []; for (var i=0;i<cols;i++) drops[i] = Math.random()*-50; }
    size(); addEventListener("resize", size);
    (function draw() {
      ctx.fillStyle = "rgba(8,9,13,.09)"; ctx.fillRect(0,0,cv.width,cv.height);
      ctx.font = fs + "px 'JetBrains Mono',monospace";
      for (var i=0;i<cols;i++) {
        ctx.fillStyle = Math.random() > .82 ? "rgba(46,230,214,.9)" : "rgba(77,159,255,.65)";
        ctx.fillText(glyphs[Math.floor(Math.random()*glyphs.length)], i*fs, drops[i]*fs);
        if (drops[i]*fs > cv.height && Math.random() > .975) drops[i] = 0;
        drops[i]++;
      }
      requestAnimationFrame(draw);
    })();
  }

  function boot(done) {
    var el = $("boottext"), scr = $("boot");
    scr.addEventListener("click", function () { scr.style.display = "none"; });
    if (reduce) { scr.style.display = "none"; banner(); done(); return; }
    var lines = [
      "[ ok ] booting Kali GNU/Linux rolling ...",
      "[ ok ] mounting /events ...",
      "[ ok ] fetching schedule from network ...",
      "[ ok ] establishing session ...",
      "root@kali:~# access granted — welcome, operator."
    ];
    var outp = "", i = 0;
    (function type() {
      if (i >= lines.length) {
        el.innerHTML = outp + '<span class="blink">█</span>';
        setTimeout(function () { scr.style.opacity = "0"; scr.style.transition = "opacity .4s";
          setTimeout(function(){ scr.style.display = "none"; }, 420); }, 400);
        banner(); done(); return;
      }
      outp += lines[i] + "\n"; el.innerHTML = outp + '<span class="blink">█</span>';
      i++; setTimeout(type, 250);
    })();
  }

  /* ---- INIT ---- */
  function reload() {
    monthCache = {};
    E.loadConfig().then(function (cfg) {
      config = cfg; refreshTags();
      return E.loadRecurring();
    }).then(function (r) {
      rules = r || []; refreshTags();
      return ensureMonth(ym(view.getFullYear(), view.getMonth()));
    }).then(function () {
      render();
      logline("loaded: " + rules.length + " weekly rule(s), config from index.yaml", "ok");
    });
  }

  function init() {
    tick(); setInterval(tick, 1000);
    matrixRain();
    render();                                   // draw empty grid immediately
    if (location.protocol === "file:") {
      logline("heads-up: opened as a local file, so /events/*.yaml can't be fetched.", "sys");
      logline("serve the folder over http (e.g. `python3 -m http.server`) to load events.", "sys");
    }
    boot(function () {
      logline("type 'help' for commands. click a day or an event to see details.", "sys");
      reload();                                 // fetch config + recurring + current month
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c];
    });
  }

  init();
})();
