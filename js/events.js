/* =====================================================================
   events.js  —  the data layer
   ---------------------------------------------------------------------
   Responsible for:
     • fetching the YAML files from /events/
     • turning "recurring" rules into concrete dated events for a month
     • normalizing event fields (dates, times, tags)
   No DOM code lives here. Exposed as  window.KaliEvents.

   File layout it expects (see /events/):
     events/index.yaml      config: base, term, breaks, months, tags
     events/recurring.yaml   weekly rules
     events/<YYYY-MM>.yaml   dated events for that month (lazy-loaded)
   ===================================================================== */
(function (global) {
  "use strict";

  // Base path for the YAML files. index.yaml can override this
  // (e.g. to an absolute path like "/events/" or a full URL).
  var BASE = "events/";

  var WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
                   sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
                   thursday: 4, friday: 5, saturday: 6 };

  /* ---- small utilities ---- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isoOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function uid() { return "e" + Math.random().toString(36).slice(2, 8); }

  function normDate(v) {
    v = String(v || "").trim();
    var m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    return m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]);
  }
  function normTime(v) {
    v = String(v || "").trim();
    var m = v.match(/^(\d{1,2}):(\d{2})$/);
    return m ? pad(+m[1]) + ":" + m[2] : "";
  }
  function asList(v) {
    if (v == null || v === "") return [];
    if (Array.isArray(v)) return v.map(function (x) { return String(x).trim(); }).filter(Boolean);
    return String(v).split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* ---- fetch + parse one YAML file. Returns null on 404/any error,
     so a missing month file simply means "no events that month". ---- */
  function fetchYAML(path) {
    return fetch(path, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (txt) { return txt == null ? null : global.KaliYAML.parse(txt); })
      .catch(function () { return null; });
  }

  /* ---- turn a raw parsed event map into our normalized shape ---- */
  function normalizeEvent(o, source) {
    if (!o || typeof o !== "object") return null;
    var title = o.title || o.name || o.event;
    var date = normDate(o.date || o.day);
    if (!title || !date) return null;
    return {
      id: uid(),
      date: date,
      time: normTime(o.time || o.when),
      endTime: normTime(o.end_time || o.endtime || o.end),
      title: String(title),
      category: String(o.category || o.cat || o.type || "other").toLowerCase(),
      tags: asList(o.tags),
      location: o.location || o.room || "",
      note: o.note || o.notes || o.desc || "",
      source: source || "file"     // "file" | "recurring" | "personal"
    };
  }

  /* ---- expand ONE recurring rule into events for a given month ----
     A rule has: weekday, time, category, tags, location, note,
     optional start/end (YYYY-MM-DD) limiting the range. ---- */
  function expandRule(rule, year, month, term, breaks) {
    var out = [];
    var wd = WEEKDAYS[String(rule.weekday || rule.day || "").toLowerCase()];
    if (wd === undefined) return out;

    var start = normDate(rule.start) || (term && term.start) || null;
    var end   = normDate(rule.end)   || (term && term.end)   || null;

    var daysInMonth = new Date(year, month + 1, 0).getDate();
    for (var d = 1; d <= daysInMonth; d++) {
      var date = new Date(year, month, d);
      if (date.getDay() !== wd) continue;
      var iso = isoOf(date);
      if (start && iso < start) continue;
      if (end && iso > end) continue;
      if (inBreak(iso, breaks)) continue;
      out.push({
        id: uid(),
        date: iso,
        time: normTime(rule.time),
        endTime: normTime(rule.end_time || rule.endtime || rule.end),
        title: String(rule.title || "Untitled"),
        category: String(rule.category || rule.cat || "other").toLowerCase(),
        tags: asList(rule.tags),
        location: rule.location || rule.room || "",
        note: rule.note || "",
        source: "recurring"
      });
    }
    return out;
  }

  function inBreak(iso, breaks) {
    if (!breaks) return false;
    for (var i = 0; i < breaks.length; i++) {
      var s = normDate(breaks[i].start), e = normDate(breaks[i].end);
      if (s && e && iso >= s && iso <= e) return true;
    }
    return false;
  }

  /* ---- public API ---- */
  var api = {
    get base() { return BASE; },

    /* Load index.yaml → { base, term, breaks, months, tags } */
    loadConfig: function () {
      return fetchYAML(BASE + "index.yaml").then(function (cfg) {
        cfg = cfg || {};
        if (cfg.base) BASE = String(cfg.base);       // allow override
        return {
          term:   cfg.term   || null,
          breaks: cfg.breaks || [],
          months: cfg.months || [],
          tags:   cfg.tags   || []
        };
      });
    },

    /* Load recurring.yaml → array of raw rules */
    loadRecurring: function () {
      return fetchYAML(BASE + "recurring.yaml").then(function (doc) {
        return (doc && doc.recurring) ? doc.recurring : (Array.isArray(doc) ? doc : []);
      });
    },

    /* Load one month file → array of normalized events */
    loadMonth: function (ym) {
      return fetchYAML(BASE + ym + ".yaml").then(function (doc) {
        var list = (doc && doc.events) ? doc.events : (Array.isArray(doc) ? doc : []);
        return list.map(function (o) { return normalizeEvent(o, "file"); }).filter(Boolean);
      });
    },

    /* Expand all recurring rules for a given (year, month) */
    expandRecurring: function (rules, year, month, term, breaks) {
      var out = [];
      (rules || []).forEach(function (rule) {
        out = out.concat(expandRule(rule, year, month, term, breaks));
      });
      return out;
    },

    normalizeEvent: normalizeEvent,
    isoOf: isoOf
  };

  global.KaliEvents = api;
})(window);
