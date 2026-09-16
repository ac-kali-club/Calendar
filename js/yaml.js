/* =====================================================================
   yaml.js  —  a tiny, dependency-free YAML reader/writer
   ---------------------------------------------------------------------
   This is NOT a full YAML implementation. It supports exactly the
   subset this project uses, which keeps it small and easy to audit:

     • comments            # like this  (whole-line or trailing)
     • key: value          scalars
     • key:                followed by an indented block (nested map)
     • lists of scalars    - ctf
     • lists of maps       - title: X
                             date:  Y
     • inline arrays       tags: [ctf, lab]
     • quoted strings      time: "09:00"

   Indentation is significant (use spaces, not tabs — tabs are treated
   as two spaces). Exposed as a global:  window.KaliYAML
   ===================================================================== */
(function (global) {
  "use strict";

  /* ---- helpers ---- */

  // Remove a trailing "# comment" when it's clearly a comment
  // (preceded by whitespace and not inside quotes). Whole-line
  // comments are handled by the caller.
  function stripComment(line) {
    if (line.indexOf("#") === -1) return line;
    var inS = false, inD = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === "'" && !inD) inS = !inS;
      else if (ch === '"' && !inS) inD = !inD;
      else if (ch === "#" && !inS && !inD && (i === 0 || /\s/.test(line[i - 1]))) {
        return line.slice(0, i);
      }
    }
    return line;
  }

  function unquote(v) {
    v = v.trim();
    if (v.length >= 2) {
      var a = v[0], b = v[v.length - 1];
      if ((a === '"' && b === '"') || (a === "'" && b === "'")) return v.slice(1, -1);
    }
    return v;
  }

  // Turn a scalar string into a JS value. Handles inline [a, b] arrays.
  function scalar(v) {
    v = v.trim();
    if (v === "") return "";
    if (v[0] === "[" && v[v.length - 1] === "]") {          // inline array
      var inner = v.slice(1, -1).trim();
      if (inner === "") return [];
      return inner.split(",").map(function (x) { return unquote(x); });
    }
    return unquote(v);
  }

  /* ---- tokenize: [{indent, text}] with blanks/comments removed ----
     A "- foo" line is split into two tokens: a bare "-" marker at the
     dash's indent, and its content "foo" at indent+2. That lets the
     parser treat every list item's body as a normal indented block. */
  function tokenize(text) {
    var out = [];
    var raw = String(text).replace(/\r\n?/g, "\n").split("\n");
    for (var i = 0; i < raw.length; i++) {
      var line = stripComment(raw[i].replace(/\t/g, "  "));
      if (line.trim() === "") continue;
      var indent = line.match(/^ */)[0].length;
      var body = line.trim();
      if (body === "-" ) {
        out.push({ indent: indent, text: "-" });
      } else if (body.slice(0, 2) === "- ") {
        out.push({ indent: indent, text: "-" });
        out.push({ indent: indent + 2, text: body.slice(2).trim() });
      } else {
        out.push({ indent: indent, text: body });
      }
    }
    return out;
  }

  /* ---- recursive block parser ----
     Parses the run of tokens at (or deeper than) `indent` starting at
     index `i`. Returns [value, nextIndex]. A block is one of:
       - a sequence (its lines are "-" markers)
       - a mapping  (its lines are "key: ..." )
       - a scalar   (a single value line) */
  function parseBlock(t, i, indent) {
    if (i >= t.length || t[i].indent < indent) return [null, i];
    var here = t[i].indent;

    // sequence?
    if (t[i].text === "-") {
      var arr = [];
      while (i < t.length && t[i].indent === here && t[i].text === "-") {
        i++; // step onto the item's content block (indent === here+2)
        var res = parseBlock(t, i, here + 2);
        arr.push(res[0]);
        i = res[1];
      }
      return [arr, i];
    }

    // mapping? (line looks like "key:" or "key: value")
    if (/^[^:]+:(\s|$)/.test(t[i].text)) {
      var map = {};
      while (i < t.length && t[i].indent === here && t[i].text !== "-" && /^[^:]+:(\s|$)/.test(t[i].text)) {
        var m = t[i].text.match(/^([^:]+):\s*(.*)$/);
        var key = m[1].trim(), rest = m[2];
        if (rest !== "") {           // inline value
          map[key] = scalar(rest);
          i++;
        } else {                     // nested block below
          i++;
          var r = parseBlock(t, i, here + 1);
          map[key] = r[0];
          i = r[1];
        }
      }
      return [map, i];
    }

    // otherwise: a plain scalar (e.g. a list item like "- ctf")
    return [scalar(t[i].text), i + 1];
  }

  function parse(text) {
    var t = tokenize(text);
    if (!t.length) return null;
    return parseBlock(t, 0, t[0].indent)[0];
  }

  /* ---- writer: serialize an events array back to YAML ----
     Only needed for the "export" button (personal events). */
  function esc(v) {
    v = String(v == null ? "" : v);
    if (v === "" || /[:#\-?&*!|>'"%@`{}\[\],]/.test(v) || /^\s|\s$/.test(v)) {
      return '"' + v.replace(/"/g, '\\"') + '"';
    }
    return v;
  }

  function stringifyEvents(list) {
    var out = "# Exported from the Kali Club Calendar\n";
    out += "# Drop this in your /events/ folder as <YYYY-MM>.yaml\n";
    out += "events:\n";
    list.slice()
      .sort(function (a, b) { return (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")); })
      .forEach(function (e) {
        out += "  - title: " + esc(e.title) + "\n";
        out += "    date: " + e.date + "\n";
        if (e.time) out += '    time: "' + e.time + '"\n';
        out += "    category: " + (e.category || "other") + "\n";
        if (e.tags && e.tags.length) out += "    tags: [" + e.tags.join(", ") + "]\n";
        if (e.location) out += "    location: " + esc(e.location) + "\n";
        if (e.note) out += "    note: " + esc(e.note) + "\n";
      });
    return out;
  }

  global.KaliYAML = { parse: parse, stringifyEvents: stringifyEvents };
})(window);
