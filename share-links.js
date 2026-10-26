// Share links for the handout: reading the letter off the stage, putting a
// shared letter back on it, and the two ways a letter travels.
//
//  - On the Wix site (the usual case): the page in the iframe asks the Wix
//    page (Velo code, dev/share/velo/) to store the letter in the Letters
//    collection; the link is the Wix page with ?l=<id>, and Velo sends the
//    stored letter back into the iframe when someone opens it.
//  - On its own server (Cloudflare Pages, handout.danielharries.com: the
//    functions in cloudflare/): the letter is stored there and the link is
//    this page with ?l=<id>.
//  - On its own with no server (e.g. the GitHub Pages address or a local
//    test): the whole letter goes in the link, compressed, after #l=.
//
// Either way the letter is the same small object (a "payload"):
//   { v: 1, text, address, font: 0-8, medium: 9-12, condition: 13-15,
//     additions: [16, 17, 19 that are on], signature: 21|22 }
// using the menu's own numbers (docs/splits-board.md, "Shared numbers").
(function () {
  "use strict";

  const VERSION = 1;
  const MAX_TEXT = 5000;      // characters; the Velo backend checks the same
  const MAX_ADDRESS = 300;    // the envelope's address, likewise
  const ADDITIONS = [16, 17, 19];
  const RANGES = { font: [0, 8, 2], medium: [9, 12, 9], condition: [13, 15, 13], signature: [21, 22, 21] }; // min, max, default
  const MSG_OUT = "dnd-handout";      // messages this page sends
  const MSG_IN = "dnd-handout-site";  // messages the Wix page sends

  // ---- the payload --------------------------------------------------------

  function whole(n, [min, max, fallback]) {
    n = Math.round(Number(n));
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  }

  // A payload from anywhere (a link, the Wix collection) made safe to use, or
  // null if it isn't one.
  function clean(p) {
    if (!p || typeof p !== "object" || p.v !== VERSION || typeof p.text !== "string") return null;
    return {
      v: VERSION,
      text: p.text.slice(0, MAX_TEXT),
      address: typeof p.address === "string" ? p.address.slice(0, MAX_ADDRESS) : "",
      font: whole(p.font, RANGES.font),
      medium: whole(p.medium, RANGES.medium),
      condition: whole(p.condition, RANGES.condition),
      additions: ADDITIONS.filter((a) => Array.isArray(p.additions) && p.additions.includes(a)),
      signature: whole(p.signature, RANGES.signature),
    };
  }

  // ---- reading and writing the stage's view model -------------------------

  function letterOf(vm) { return vm && vm.viewModel("propertyOfLetter1"); }

  // The envelope's address (VMMainStage.address.addressText), or null.
  function addressOf(vm) {
    try { const a = vm.viewModel("address"); return a && a.string("addressText"); } catch (e) { return null; }
  }

  function list(instance, name) {
    try { return instance.list(name); } catch (e) { return null; }
  }

  // Every item of every sub-menu (Menu2 rows, the Share button), as instances.
  function subMenuItems(vm) {
    const out = [];
    const menus = list(vm, "menuList");
    for (let i = 0; menus && i < menus.length; i++) {
      const subs = list(menus.instanceAt(i), "subMenuList");
      for (let j = 0; subs && j < subs.length; j++) out.push(subs.instanceAt(j));
    }
    return out;
  }

  // The Additions keep their on/off state on their Menu3 options (isOn), not
  // on the Letter: { 16: isOn property, 17: ..., 19: ... }
  function additionSwitches(vm) {
    const out = {};
    for (const row of subMenuItems(vm)) {
      const options = list(row, "subMenu3");
      for (let k = 0; options && k < options.length; k++) {
        const o = options.instanceAt(k);
        const g = o.number("globalIndex"), on = o.boolean("isOn");
        if (g && on && ADDITIONS.includes(g.value)) out[g.value] = on;
      }
    }
    return out;
  }

  function read(vm) {
    const letter = letterOf(vm);
    if (!letter) return null;
    const num = (name) => { const p = letter.number(name); return p ? p.value : undefined; };
    const switches = additionSwitches(vm);
    return clean({
      v: VERSION,
      text: letter.string("letterContents").value,
      address: (addressOf(vm) || { value: "" }).value,
      font: num("fontIndex"),
      medium: num("paperIndex"),
      condition: num("conditionIndex"),
      additions: ADDITIONS.filter((a) => switches[a] && switches[a].value),
      signature: num("signatureIndex"),
    });
  }

  // Puts a payload on the stage. lastGlobalIndex goes last and gets the
  // medium: the Paper Model layer picks the model from it, and LetterChoices
  // copies it into paperIndex (and would copy a font number back over
  // fontIndex if it were left holding one).
  function apply(vm, p) {
    const letter = letterOf(vm);
    if (!letter || !(p = clean(p))) return false;
    letter.string("letterContents").value = p.text;
    const address = addressOf(vm);
    if (address && p.address) address.value = p.address; // older links have none: the envelope keeps its own
    letter.number("fontIndex").value = p.font;
    letter.number("conditionIndex").value = p.condition;
    letter.number("signatureIndex").value = p.signature;
    letter.number("paperIndex").value = p.medium;
    const switches = additionSwitches(vm);
    for (const a of ADDITIONS) if (switches[a]) switches[a].value = p.additions.includes(a);
    letter.number("lastGlobalIndex").value = p.medium;
    return true;
  }

  // The Share button's view model (SharePlaceholder): shareRequested is set by
  // a click, shareState picks its label (see STATE).
  function shareButton(vm) {
    return subMenuItems(vm).find((item) => { try { return !!item.boolean("shareRequested"); } catch (e) { return false; } }) || null;
  }
  const STATE = { idle: 0, saving: 1, copied: 2, shown: 3, failed: 4 };

  // ---- a letter inside the link (#l=1.<compressed>) -----------------------

  function toBase64Url(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromBase64Url(text) {
    const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }
  async function pipe(bytes, stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  }

  async function toCode(p) {
    const json = new TextEncoder().encode(JSON.stringify(clean(p)));
    return VERSION + "." + toBase64Url(await pipe(json, new CompressionStream("deflate-raw")));
  }
  async function fromCode(code) {
    try {
      const [v, data] = String(code).split(".");
      if (Number(v) !== VERSION || !data) return null;
      const json = await pipe(fromBase64Url(data), new DecompressionStream("deflate-raw"));
      return clean(JSON.parse(new TextDecoder().decode(json)));
    } catch (e) {
      console.warn("share link: couldn't read the letter in it", e);
      return null;
    }
  }

  // The letter in this page's own address, if any (#l=...).
  function codeInAddress() {
    const m = /[#&]l=([^&]+)/.exec(location.hash);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function inlineLink(code) {
    return location.href.split("#")[0] + "#l=" + code;
  }

  // ---- the Wix page around us (Velo, dev/share/velo/page-code.js) ---------
  //
  // This page says hello until the Wix page answers (its code may start after
  // ours) or `wait` ms pass; no answer means there is no Wix page. Messages:
  //   out: hello | save {id, payload} | leave (left the shared letter)
  //   in:  hello {canSave, expectLetter} | letter {payload} | letter-missing
  //        | saved {id, url, copied} | save-failed {id, reason}

  function connect(wait) {
    if (window.parent === window) return Promise.resolve(null);
    let parentOrigin = "*";
    let replied = false;
    let letterResolve;
    const letter = new Promise((r) => (letterResolve = r));
    const pending = new Map();
    let seq = 0;
    const send = (msg) => window.parent.postMessage(Object.assign({ source: MSG_OUT }, msg), parentOrigin);

    return new Promise((resolve) => {
      let api = null;
      addEventListener("message", (e) => {
        const m = e.data;
        if (!m || m.source !== MSG_IN) return;
        if (m.type === "hello" && !replied) {
          replied = true;
          if (e.origin && e.origin !== "null") parentOrigin = e.origin;
          if (!m.expectLetter) letterResolve(null);
          api = {
            canSave: !!m.canSave,
            letter,
            save(payload) {
              const id = ++seq;
              send({ type: "save", id, payload: clean(payload) });
              return new Promise((res, rej) => {
                pending.set(id, { res, rej });
                setTimeout(() => { if (pending.delete(id)) rej(new Error("the Wix page didn't answer")); }, 15000);
              });
            },
            leave() { send({ type: "leave" }); },
          };
          resolve(api);
        } else if (m.type === "letter") {
          letterResolve(clean(m.payload));
        } else if (m.type === "letter-missing") {
          letterResolve(null);
        } else if ((m.type === "saved" || m.type === "save-failed") && pending.has(m.id)) {
          const p = pending.get(m.id);
          pending.delete(m.id);
          if (m.type === "saved") p.res({ url: m.url, copied: !!m.copied });
          else p.rej(new Error(m.reason || "couldn't save the letter"));
        }
      });
      const started = performance.now();
      (function hello() {
        if (replied) return;
        if (performance.now() - started > wait) { resolve(null); return; }
        send({ type: "hello" });
        setTimeout(hello, 400);
      })();
    });
  }

  // ---- this page's own server (cloudflare/functions/api/) ----------------
  //
  // Asks base + "health" whether it is there (on GitHub Pages it isn't), and
  // if so stores and fetches letters at base + "letters".

  function idInAddress() {
    const id = new URLSearchParams(location.search).get("l");
    return id && /^[A-Za-z0-9]{4,16}$/.test(id) ? id : null;
  }

  async function server(base) {
    try {
      const r = await fetch(base + "health", { cache: "no-store" });
      if (!r.ok || !(await r.json()).ok) return null;
    } catch (e) {
      return null;
    }
    return {
      canSave: true,
      async save(payload) {
        const r = await fetch(base + "letters", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(clean(payload)),
        });
        const answer = await r.json().catch(() => ({}));
        if (!r.ok || !answer.id) throw new Error(answer.error || "couldn't save the letter");
        const url = location.origin + location.pathname + "?l=" + answer.id;
        return { url, copied: await copy(url) };
      },
      async load(id) {
        try {
          const r = await fetch(base + "letters/" + encodeURIComponent(id));
          return r.ok ? clean(await r.json()) : null;
        } catch (e) {
          return null;
        }
      },
      leave() { // "Write your own": the shared letter leaves the address
        const u = new URL(location.href);
        if (!u.searchParams.has("l")) return;
        u.searchParams.delete("l");
        history.replaceState(null, "", u);
      },
    };
  }

  // ---- copying ------------------------------------------------------------

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false; // blocked (an iframe without clipboard-write, no recent click): the page shows the link instead
    }
  }

  window.HandoutShare = { VERSION, MAX_TEXT, STATE, clean, read, apply, shareButton, toCode, fromCode, codeInAddress, idInAddress, inlineLink, connect, server, copy };
})();
