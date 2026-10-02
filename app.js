"use strict";
/* Mis Sellos — catálogo personal de sellos con IA.
   Funciona entero en el teléfono: los sellos y las fotos viven en IndexedDB y la IA
   (Claude) se llama directamente desde aquí con la clave que pone Emmanuel en Ajustes.
   No hay servidor ni nube. */

const APP_VERSION = "1.0.1";
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (v) => (v == null || v === "" || isNaN(v) ? "—" : Number(v).toLocaleString("es-ES",
  { minimumFractionDigits: v < 10 && v % 1 ? 2 : 0, maximumFractionDigits: 2 }) + " €");
const leerLS = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const guardarLS = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
function velo(t) { $("#velo-t").textContent = t || "Un momento…"; $("#velo").classList.add("on"); }
function quitarVelo() { $("#velo").classList.remove("on"); }

/* ================= configuración (en este teléfono) ================= */
const CFG = () => ({
  clave: leerLS("clave_api").trim(),
  modelo: leerLS("modelo") || "claude-fable-5-1",
  busqueda: leerLS("busqueda") !== "0",
  umbral: parseFloat(leerLS("umbral")) || 50,
});
const ESTADO = { get aviso_valor() { return CFG().umbral; } };

/* ================= base de datos (IndexedDB) ================= */
const BD = {
  db: null,
  abrir() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("mis-sellos", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("sellos", { keyPath: "id", autoIncrement: true });
        r.result.createObjectStore("fotos");
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  _tx(stores, modo, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(stores, modo);
      let out;
      const rq = fn(t);
      if (rq) rq.onsuccess = () => { out = rq.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  todos() { return this._tx("sellos", "readonly", t => t.objectStore("sellos").getAll()); },
  foto(id) { return this._tx("fotos", "readonly", t => t.objectStore("fotos").get(Number(id))); },
  poner(rec) { return this._tx("sellos", "readwrite", t => t.objectStore("sellos").put(rec)); },
  async añadir(rec, foto) {
    let id;
    await this._tx(["sellos", "fotos"], "readwrite", t => {
      const rq = t.objectStore("sellos").add(rec);
      rq.addEventListener("success", () => { id = rq.result; if (foto) t.objectStore("fotos").put(foto, id); });
      return rq;
    });
    return id;
  },
  borrar(id) {
    return this._tx(["sellos", "fotos"], "readwrite", t => {
      t.objectStore("sellos").delete(Number(id)); t.objectStore("fotos").delete(Number(id));
    });
  },
  ponerFoto(id, foto) { return this._tx("fotos", "readwrite", t => t.objectStore("fotos").put(foto, Number(id))); },
};

let SELLOS = [];
const CACHE_FOTOS = new Map();
async function urlFoto(id) {
  if (CACHE_FOTOS.has(id)) return CACHE_FOTOS.get(id);
  const f = await BD.foto(id);
  if (CACHE_FOTOS.size > 400) CACHE_FOTOS.delete(CACHE_FOTOS.keys().next().value);
  CACHE_FOTOS.set(id, f || "");
  return f || "";
}
function rellenarFotos(cont) {
  cont.querySelectorAll("img[data-f]").forEach(async img => {
    const u = await urlFoto(Number(img.dataset.f));
    if (u) img.src = u;
  });
}

/* ================= campos y limpieza ================= */
const CAMPOS = ["pais", "bandera", "rareza", "continente", "tirada", "origen", "imprenta", "impresion",
  "historia", "precio_nuevo", "precio_usado", "candidatas", "dudoso", "anio", "denominacion", "tema",
  "descripcion", "tipo", "catalogo_ref", "dentado", "uso", "estado", "defectos", "valor_min",
  "valor_max", "confianza", "revisar", "razon_valor", "fuentes", "verificar", "album", "pagina",
  "cantidad", "favorito", "notas"];
const NUM = new Set(["valor_min", "valor_max", "cantidad", "revisar", "favorito", "dudoso"]);
const LISTAS = new Set(["fuentes", "verificar", "candidatas"]);
function aNum(v) { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; }
function limpiar(d) {
  const o = {};
  for (const k of CAMPOS) {
    if (!(k in d)) continue;
    let v = d[k];
    if (NUM.has(k)) v = k.startsWith("valor") ? aNum(v) : (parseInt(v) || 0);
    else if (LISTAS.has(k)) v = Array.isArray(v) ? v : [];
    else v = v == null ? "" : String(v).trim();
    o[k] = v;
  }
  return o;
}
const ahora = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

/* ================= operaciones sobre la colección ================= */
async function cargarTodos() { SELLOS = (await BD.todos()).sort((a, b) => b.id - a.id); }
function buscarDup(d) {
  if (!d.pais || !d.denominacion) return [];
  const l = (x) => String(x ?? "").toLowerCase();
  return SELLOS.filter(s => l(s.pais) === l(d.pais) && String(s.anio) === String(d.anio ?? "") &&
    l(s.denominacion) === l(d.denominacion) && l(s.catalogo_ref) === l(d.catalogo_ref));
}
async function guardarSello(datos, recorte, sumarA) {
  const campos = limpiar(datos);
  if (sumarA) {
    const s = SELLOS.find(x => x.id === Number(sumarA));
    s.cantidad = (s.cantidad || 1) + (campos.cantidad || 1);
    await BD.poner(s);
    return s.id;
  }
  const rec = { cantidad: 1, favorito: 0, revisar: 0, dudoso: 0, ...campos,
    creado: ahora(), valorado: ahora() };
  const id = await BD.añadir(rec, recorte);
  rec.id = id;
  SELLOS.unshift(rec);
  return id;
}
async function editarSello(id, cambios) {
  const s = SELLOS.find(x => x.id === Number(id));
  Object.assign(s, limpiar(cambios));
  await BD.poner(s);
  return s;
}
async function borrarSello(id) {
  await BD.borrar(id);
  SELLOS = SELLOS.filter(s => s.id !== Number(id));
  CACHE_FOTOS.delete(Number(id));
}

/* ================= la IA (Claude, directo desde el teléfono) ================= */
let aviso_modelo = false;
async function llamarClaude(contenido, usarBusqueda) {
  const cfg = CFG();
  if (!cfg.clave) throw new Error("Falta la clave de la IA. Ve a ⚙️ Ajustes y pégala (se saca en console.anthropic.com).");
  const pedir = async (conBusqueda) => {
    const cuerpo = { model: cfg.modelo, max_tokens: 9000,
      system: [{ type: "text", text: CONOCIMIENTO, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: contenido }] };
    if (conBusqueda) cuerpo.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }];
    for (let intento = 0; intento < 4; intento++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": cfg.clave, "anthropic-version": "2023-06-01",
          "content-type": "application/json", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify(cuerpo) });
      if (r.ok) return await r.json();
      if ([429, 503, 529].includes(r.status) && intento < 3) {
        await new Promise(ok => setTimeout(ok, 8000 * (intento + 1))); continue; }
      const e = new Error(await mensajeHttp(r)); e.status = r.status; throw e;
    }
  };
  let resp, sinBusqueda = false;
  try { resp = await pedir(usarBusqueda); }
  catch (e) {
    if ((e.status === 404 || /model/i.test(e.message)) && cfg.modelo !== "claude-sonnet-5-5") {
      // ese modelo no está disponible en la cuenta: sigue con Sonnet y lo avisa
      cfg.modelo = "claude-sonnet-5-5"; guardarLS("modelo", cfg.modelo);
      aviso_modelo = true; return await llamarClaude(contenido, usarBusqueda);
    }
    if (usarBusqueda && e.status === 400) { resp = await pedir(false); sinBusqueda = true; }
    else if (e instanceof TypeError) throw new Error("No hay conexión con la IA. Comprueba tu internet y vuelve a intentarlo.");
    else throw e;
  }
  const texto = (resp.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  return { texto, sinBusqueda };
}
async function mensajeHttp(r) {
  let det = ""; try { det = (await r.json()).error?.message || ""; } catch (e) {}
  if (r.status === 401) return "La clave de la IA no es válida. Revísala en ⚙️ Ajustes.";
  if (r.status === 429) return "La IA dice que vas demasiado rápido. Espera un minuto y repite.";
  if (r.status === 402 || r.status === 403) return "La cuenta de la IA no tiene saldo o permiso. Revísalo en console.anthropic.com.";
  return `Error de la IA (${r.status}): ${det.slice(0, 200)}`;
}
function extraerJSON(t) {
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error("La IA no devolvió datos legibles. Repite la foto.");
  try { return JSON.parse(t.slice(a, b + 1)); }
  catch (e) { throw new Error("La respuesta de la IA llegó cortada. Repite la foto."); }
}
const imgBloque = (dataURL) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: dataURL.split(",")[1] } });

async function analizarFoto(dataURL) {
  const { texto, sinBusqueda } = await llamarClaude(
    [imgBloque(dataURL), { type: "text", text: PROMPT }], CFG().busqueda);
  const d = extraerJSON(texto); d.sin_busqueda = sinBusqueda; return d;
}
async function afinarSello(id, pista) {
  const foto = await urlFoto(id);
  if (!foto) throw new Error("No encuentro la foto de este sello.");
  let t = PROMPT + "\n\nEsta foto contiene UN solo sello: analízalo a fondo con la máxima atención.";
  if (pista) t += `\nPista del coleccionista (puede ayudarte, pero compruébala): ${pista}`;
  const { texto } = await llamarClaude([imgBloque(foto), { type: "text", text: t }], CFG().busqueda);
  const d = extraerJSON(texto);
  if (!(d.sellos || []).length) throw new Error("La IA no ha podido analizar esa foto.");
  const n = d.sellos[0]; delete n.caja;
  const s = await editarSello(id, { ...n });
  s.valorado = ahora(); await BD.poner(s);
}
async function revalorarSello(id) {
  const s = SELLOS.find(x => x.id === Number(id));
  const resumen = {}; ["pais", "anio", "denominacion", "tema", "descripcion", "tipo", "catalogo_ref", "dentado", "uso", "estado", "defectos"]
    .forEach(k => resumen[k] = s[k]);
  const { texto } = await llamarClaude([{ type: "text", text: PROMPT_REVALORAR.replace("{datos}", JSON.stringify(resumen)).replace(/\{\{/g, "{").replace(/\}\}/g, "}") }], CFG().busqueda);
  const n = extraerJSON(texto);
  await editarSello(id, n); s.valorado = ahora(); await BD.poner(s);
}

/* ================= navegación ================= */
document.querySelectorAll("nav button").forEach(b => b.onclick = () => irA(b.dataset.v));
function irA(v) {
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("on", x.dataset.v === v));
  document.querySelectorAll(".vista").forEach(x => x.classList.toggle("on", x.id === "v-" + v));
  if (v === "col") cargarColeccion();
  if (v === "aj") cargarAjustes();
  window.scrollTo(0, 0);
}

/* ================= arranque ================= */
async function inicio() {
  try { await BD.abrir(); } catch (e) {
    $("#resumen").textContent = "No se pudo abrir el almacén del teléfono.";
    $("#aviso-ia").innerHTML = `<div class="aviso error">⚠️ Este navegador no deja guardar datos (¿pestaña privada?). Ábrela en Safari normal.</div>`;
    return;
  }
  try { navigator.storage && navigator.storage.persist && await navigator.storage.persist(); } catch (e) {}
  await cargarTodos();
  $("#def-album").value = leerLS("album");
  $("#def-pagina").value = leerLS("pagina");
  $("#def-album").onchange = () => guardarLS("album", $("#def-album").value);
  $("#def-pagina").onchange = () => guardarLS("pagina", $("#def-pagina").value);
  $("#rapido").checked = leerLS("rapido") !== "0";
  $("#rapido").onchange = () => guardarLS("rapido", $("#rapido").checked ? "1" : "0");
  avisos();
  resumen();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
}
function avisos() {
  let h = "";
  const instalada = window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  if (!instalada) h += `<div class="aviso error">📲 <strong>Instálala para no perder tus sellos:</strong> abre este enlace en
    <strong>Safari</strong> → Compartir → <strong>Añadir a pantalla de inicio</strong> y úsala siempre desde el icono.
    Safari borra los datos de las webs que no se usan en 7 días; las apps instaladas están a salvo.</div>`;
  if (!CFG().clave) h += `<div class="aviso">🔑 Falta la clave de la IA. Ve a <strong>⚙️ Ajustes</strong> y pégala (una sola vez).</div>`;
  const ult = leerLS("ultima_copia");
  const dias = ult ? (Date.now() - Number(ult)) / 864e5 : Infinity;
  if (SELLOS.length >= 20 && dias > 30) h += `<div class="aviso">💾 Llevas ${SELLOS.length} sellos y ${ult ? "hace más de 30 días que no haces" : "aún no has hecho"} copia de seguridad.
    Ve a ⚙️ Ajustes → <strong>Exportar TODO</strong>.</div>`;
  $("#aviso-ia").innerHTML = h;
}
function resumen() {
  const g = general();
  $("#resumen").textContent = g.n === 0 ? "Colección vacía — haz tu primera foto"
    : `${g.c} sellos (${g.n} distintos) · valor estimado ${eur(g.vmin)} – ${eur(g.vmax)} · ${g.rev} por revisar${g.valiosos ? ` · 💎 ${g.valiosos} valiosos` : ""}`;
  const albs = [...new Set(SELLOS.map(s => s.album).filter(Boolean))].sort();
  $("#lista-albumes").innerHTML = albs.map(a => `<option value="${esc(a)}">`).join("");
}
function general() {
  const um = CFG().umbral;
  return SELLOS.reduce((g, s) => { const c = s.cantidad || 1;
    g.n++; g.c += c; g.vmin += (s.valor_min || 0) * c; g.vmax += (s.valor_max || 0) * c;
    g.rev += s.revisar ? 1 : 0; g.valiosos += (s.valor_max >= um) ? 1 : 0; return g; },
    { n: 0, c: 0, vmin: 0, vmax: 0, rev: 0, valiosos: 0 });
}

/* ================= foto ================= */
$("#b-camara").onclick = () => $("#f-camara").click();
$("#b-galeria").onclick = () => $("#f-galeria").click();
$("#f-camara").onchange = $("#f-galeria").onchange = (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (f) procesarFoto(f);
};

/* Lee la foto del iPhone (Safari la convierte de HEIC a JPEG y respeta la rotación). */
async function reducir(file, max) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}
function recortar(canvas, caja) {
  let [x1, y1, x2, y2] = (caja || [0, 0, 1, 1]).map(Number);
  if (![x1, y1, x2, y2].every(isFinite) || x2 <= x1 || y2 <= y1) [x1, y1, x2, y2] = [0, 0, 1, 1];
  const W = canvas.width, H = canvas.height;
  const px = (x2 - x1) * W * 0.05, py = (y2 - y1) * H * 0.05;
  const sx = Math.max(0, x1 * W - px), sy = Math.max(0, y1 * H - py);
  const sw = Math.min(W - sx, (x2 - x1) * W + 2 * px), sh = Math.min(H - sy, (y2 - y1) * H + 2 * py);
  const k = Math.min(1, 600 / Math.max(sw, sh));
  const o = document.createElement("canvas");
  o.width = Math.max(1, Math.round(sw * k)); o.height = Math.max(1, Math.round(sh * k));
  o.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, o.width, o.height);
  return o.toDataURL("image/jpeg", 0.82);
}

let TANDA = [];
async function procesarFoto(file) {
  velo("Analizando la foto…\nIdentificando y valorando el sello (puede tardar ~30 s)");
  try {
    const canvas = await reducir(file, 2048);
    const d = await analizarFoto(canvas.toDataURL("image/jpeg", 0.9));
    TANDA = (d.sellos || []).slice(0, 1).map(s => ({ ...s, recorte: recortar(canvas, s.caja), cantidad: 1, guardado: false }));
    pintarResultados(d);
    avisarValiosos(ESTADO.aviso_valor);
    if ($("#rapido").checked && TANDA.length) await guardarTodos(true);
  } catch (e) {
    $("#resultados").innerHTML = `<div class="aviso error">⚠️ ${esc(e.message)}</div>`;
  }
  quitarVelo();
}

function avisarValiosos(umbral) {
  const joyas = TANDA.filter(s => Number(s.valor_max) >= umbral);
  if (!joyas.length) return;
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {}
  $("#modal-c").innerHTML = `<div class="alerta">
    <h2>💎 ¡Posible sello valioso!</h2>
    ${joyas.map(s => `<img src="${s.recorte}" style="max-height:200px;max-width:100%;border-radius:10px;margin-top:8px">
      <div class="gran">${eur(s.valor_min)} – ${eur(s.valor_max)}</div>
      <div><strong>${esc(s.pais)} ${esc(s.anio)} · ${esc(s.denominacion)}</strong></div>
      <div class="suave">${esc(s.razon_valor)}</div>
      ${(s.verificar || []).length ? `<ul class="v" style="text-align:left">${s.verificar.map(v => `<li>Comprobar: ${esc(v)}</li>`).join("")}</ul>` : ""}
      <hr style="border-color:var(--borde)">`).join("")}
    <p class="suave">Es una <strong>estimación hecha con IA a partir de una foto</strong>. Antes de venderlo,
      guárdalo con cuidado y confírmalo con un catálogo (Michel, Scott, Yvert, Edifil) o con un experto.
      Queda guardado y marcado con 💎 en tu colección.</p>
    <button class="boton" id="m-entendido">👍 Entendido</button></div>`;
  $("#modal").classList.add("on");
  $("#m-entendido").onclick = () => $("#modal").classList.remove("on");
}

const CAMPOS_FORM = [["pais", "País"], ["anio", "Año"], ["denominacion", "Valor facial"], ["tema", "Tema"],
  ["tipo", "Tipo"], ["catalogo_ref", "Ref. catálogo"], ["dentado", "Dentado"], ["uso", "Nuevo / usado"], ["estado", "Estado"]];

function infoHTML(s) {
  const filas = [["Rareza", s.rareza], ["Año", s.anio], ["Origen", s.origen], ["Tirada", s.tirada],
    ["Imprenta", s.imprenta], ["Impresión", s.impresion], ["Dentado", s.dentado], ["Ref. catálogo", s.catalogo_ref],
    ["Precio nuevo", s.precio_nuevo], ["Precio usado", s.precio_usado], ["Historia", s.historia]]
    .filter(([, v]) => v && String(v).trim());
  return filas.length ? `<div class="info">${filas.map(([k, v]) => `<div><b>${k}</b><span>${esc(v)}</span></div>`).join("")}</div>` : "";
}
function candidatasHTML(s, accion) {
  const cs = (s.candidatas || []).filter(c => c && (c.pais || c.anio));
  if (!cs.length) return "";
  return `<div style="margin-top:8px"><strong style="font-size:14px">❓ Otras posibilidades</strong>
    <div class="suave">Si la app no está segura, aquí van las opciones. Elige la exacta.</div>
    ${cs.map((c, k) => `<div class="cand">
      <span class="p">${esc(c.probabilidad ?? "?")}%</span> ${esc(c.pais)} ${esc(c.anio)} · ${esc(c.denominacion)}
      ${c.catalogo_ref ? "· " + esc(c.catalogo_ref) : ""}
      ${c.valor_max != null ? `<br>≈ ${eur(c.valor_min)} – ${eur(c.valor_max)}` : ""}
      ${c.tirada ? `<br>Tirada: ${esc(c.tirada)}` : ""}
      <br><span class="suave">${esc(c.motivo)}</span>
      <br><button class="boton chico sec" data-${accion}="${k}">✔ Es esta</button></div>`).join("")}</div>`;
}
function aplicarCandidata(c) {
  const o = {};
  ["pais", "anio", "denominacion", "catalogo_ref", "tirada"].forEach(k => { if (c[k]) o[k] = c[k]; });
  if (c.valor_min != null) o.valor_min = c.valor_min;
  if (c.valor_max != null) o.valor_max = c.valor_max;
  o.dudoso = 0; o.confianza = "media";
  return o;
}
function badgeConf(c) {
  return c === "alta" ? `<span class="chip">confianza alta</span>`
    : c === "media" ? `<span class="chip">confianza media</span>` : `<span class="chip rojo">confianza baja</span>`;
}

function pintarResultados(d) {
  const cont = $("#resultados");
  if (!TANDA.length) {
    cont.innerHTML = `<div class="aviso">No he visto ningún sello en la foto. ${esc(d.notas || "")} Prueba con más luz y fondo liso.</div>`;
    return;
  }
  let h = "";
  if (d.sin_busqueda) h += `<div class="aviso">ℹ️ Esta vez la IA no pudo buscar precios en internet: los valores son aún más aproximados.</div>`;
  if (d.notas) h += `<p class="suave">📝 ${esc(d.notas)}</p>`;
  h += TANDA.map((s, i) => tarjetaResultado(s, i)).join("");
  cont.innerHTML = h;
  cont.scrollIntoView({ behavior: "smooth", block: "start" });
  TANDA.forEach((s, i) => enlazarResultado(i));
}

function tarjetaResultado(s, i) {
  const bajo = (s.valor_max ?? 0) < 1;
  const titulo = [s.bandera, s.pais || "¿País?", s.anio, s.denominacion].filter(Boolean).join(" · ");
  return `<div class="caja" id="r${i}">
    <img src="${s.recorte}" style="width:100%;max-height:340px;object-fit:contain;background:#000;border-radius:12px">
    <div class="guardado-aviso" id="ga${i}"></div>
    <div class="valor ${bajo ? "bajo" : ""}" style="font-size:30px;margin-top:10px">${eur(s.valor_min)} – ${eur(s.valor_max)}</div>
    <div class="suave" style="margin-top:-2px">valor estimado de este ejemplar</div>
    <div style="margin-top:6px">${badgeConf(s.confianza)}${s.revisar ? `<span class="chip oro">🔍 merece revisión</span>` : ""}${Number(s.dudoso) ? `<span class="chip rojo">❓ no estoy seguro</span>` : ""}${Number(s.valor_max) >= ESTADO.aviso_valor ? `<span class="chip joya">💎 valioso</span>` : ""}</div>
    <h3 style="margin:12px 0 4px">${esc(titulo)}</h3>
    <div>${esc(s.tema)}${s.tipo ? " · " + esc(s.tipo) : ""}${s.uso ? " · " + esc(s.uso) : ""}${s.estado ? " · estado " + esc(s.estado) : ""}</div>
    <p class="suave" style="margin:6px 0">${esc(s.descripcion)}</p>
    ${infoHTML(s)}
    <p class="suave" style="margin:8px 0 0">💬 ${esc(s.razon_valor)}</p>
    ${s.defectos ? `<p class="suave" style="margin:4px 0">⚠️ Defectos: ${esc(s.defectos)}</p>` : ""}
    ${(s.verificar || []).length ? `<ul class="v">${s.verificar.map(v => `<li>Comprobar: ${esc(v)}</li>`).join("")}</ul>` : ""}
    ${(s.fuentes || []).length ? `<div class="suave" style="margin-top:6px">Fuentes: ${s.fuentes.slice(0, 4).map((u, k) => `<a href="${esc(u)}" target="_blank" rel="noopener">[${k + 1}]</a>`).join(" ")}</div>` : ""}
    <div class="editable">
    ${candidatasHTML(s, "cand")}
    <details style="margin-top:8px"><summary class="suave">✏️ Corregir datos</summary>
      <div class="fila">${CAMPOS_FORM.map(([k, t]) => `<div><label>${t}</label><input data-i="${i}" data-k="${k}" value="${esc(s[k])}"></div>`).join("")}</div>
      <label>Descripción</label><textarea data-i="${i}" data-k="descripcion">${esc(s.descripcion)}</textarea>
      <div class="fila"><div><label>Valor mín. (€)</label><input data-i="${i}" data-k="valor_min" inputmode="decimal" value="${s.valor_min ?? ""}"></div>
      <div><label>Valor máx. (€)</label><input data-i="${i}" data-k="valor_max" inputmode="decimal" value="${s.valor_max ?? ""}"></div></div>
    </details>
    <div class="fila" style="margin-top:8px">
      <div><label>Cantidad</label><input data-i="${i}" data-k="cantidad" inputmode="numeric" value="1"></div>
      <div><label>Notas</label><input data-i="${i}" data-k="notas" placeholder="opcional"></div>
    </div>
    <div class="fila" style="margin-top:12px">
      <button class="boton" data-g="${i}">💾 Guardar</button>
      <button class="boton sec" data-d="${i}">Descartar</button>
    </div></div>
  </div>`;
}
function enlazarResultado(i) {
  const caja = $("#r" + i);
  caja.querySelectorAll("[data-cand]").forEach(b => b.onclick = () => {
    Object.assign(TANDA[i], aplicarCandidata(TANDA[i].candidatas[b.dataset.cand]));
    caja.outerHTML = tarjetaResultado(TANDA[i], i); enlazarResultado(i);
  });
  caja.querySelectorAll("[data-k]").forEach(el => el.oninput = () => { TANDA[i][el.dataset.k] = el.value; });
  caja.querySelector("[data-g]").onclick = () => guardarUno(i, false);
  caja.querySelector("[data-d]").onclick = () => { caja.remove(); TANDA[i].guardado = true; };
}

async function guardarUno(i, auto) {
  const s = TANDA[i];
  if (s.guardado) return;
  const dat = { ...s, album: $("#def-album").value.trim(), pagina: $("#def-pagina").value.trim(),
    cantidad: parseInt(s.cantidad) || 1 };
  delete dat.recorte;
  let sumar = null;
  try {
    const dup = buscarDup(dat);
    if (dup.length) {
      const c = dup[0];
      if (auto) sumar = c.id;
      else if (confirm(`Ya tienes este sello (${c.pais} ${c.anio} ${c.denominacion}, ×${c.cantidad}).\n\nAceptar = sumar uno más al existente (repetido)\nCancelar = guardarlo como sello aparte`)) sumar = c.id;
    }
    await guardarSello(dat, s.recorte, sumar);
  } catch (e) { alert("No se pudo guardar: " + e.message); return; }
  s.guardado = true;
  const caja = $("#r" + i);
  const ed = caja.querySelector(".editable"); if (ed) ed.remove();
  caja.querySelector(".guardado-aviso").innerHTML = `<div class="aviso" style="margin:10px 0 0;border-color:var(--verde)">✅ Guardado${sumar ? " (sumado a uno que ya tenías)" : ""} en tu colección${Number(s.dudoso) ? ` · ❓ no estoy seguro: míralo en Colección → Dudosos y elige entre las opciones` : ""}</div>`;
  resumen(); avisos();
}
async function guardarTodos(auto) {
  for (let i = 0; i < TANDA.length; i++) await guardarUno(i, auto === true);
}

/* ================= colección ================= */
const FILTRO = { q: "", orden: "nuevo", fav: 0, revisar: 0, dup: 0, valioso: 0, dudoso: 0, raro: 0, antes1950: 0 };
let VISTA_LISTA = false, POR = "todos";
const CATEGORIAS = [["todos", "📋 Todos"], ["pais", "🌍 País"], ["continente", "🗺️ Continente"], ["anio", "📅 Año"],
  ["decada", "🕰️ Década"], ["tema", "🎨 Tema"], ["tipo", "🏷️ Tipo"], ["album", "📚 Álbum"], ["estado", "✨ Estado"], ["rango", "💰 Valor"]];
const CLAVES_FILTRO = ["pais", "continente", "anio", "decada", "tema", "tipo", "album", "estado", "rango", "uso"];
let CAT = null;

const decada = (s) => { const a = parseInt(s.anio); return a >= 1000 ? (Math.floor(a / 10) * 10) + "s" : ""; };
const rango = (s) => { const v = s.valor_max; if (v == null) return "";
  return v < 0.5 ? "1) menos de 0,50 €" : v < 2 ? "2) 0,50 – 2 €" : v < 10 ? "3) 2 – 10 €" : v < 50 ? "4) 10 – 50 €" : v < 200 ? "5) 50 – 200 €" : "6) más de 200 €"; };
const CLAVE = { pais: s => s.pais, continente: s => s.continente, anio: s => String(s.anio || ""), decada, tema: s => s.tema,
  tipo: s => s.tipo, album: s => s.album, estado: s => s.estado, uso: s => s.uso, rango };

function pasaFiltro(s) {
  for (const k of ["pais", "estado", "album", "uso", "tipo", "tema", "continente", "anio", "decada", "rango"])
    if (FILTRO[k] && CLAVE[k](s) !== FILTRO[k]) return false;
  if (FILTRO.q) {
    const txt = [s.pais, s.anio, s.denominacion, s.tema, s.descripcion, s.catalogo_ref, s.album, s.notas].join(" ").toLowerCase();
    if (!FILTRO.q.toLowerCase().split(/\s+/).filter(Boolean).every(w => txt.includes(w))) return false;
  }
  if (FILTRO.valioso && !(s.valor_max >= CFG().umbral)) return false;
  if (FILTRO.raro && !["raro", "muy raro"].includes(s.rareza)) return false;
  if (FILTRO.antes1950 && !(parseInt(s.anio) >= 1000 && parseInt(s.anio) < 1950)) return false;
  if (FILTRO.dudoso && !s.dudoso) return false;
  if (FILTRO.revisar && !s.revisar) return false;
  if (FILTRO.fav && !s.favorito) return false;
  if (FILTRO.dup && !(s.cantidad > 1)) return false;
  return true;
}
function catalogo() {
  let f = SELLOS.filter(pasaFiltro);
  const ord = { nuevo: (a, b) => b.id - a.id, valor: (a, b) => (b.valor_max || 0) - (a.valor_max || 0),
    pais: (a, b) => String(a.pais).localeCompare(String(b.pais)) || String(a.anio).localeCompare(String(b.anio)),
    anio: (a, b) => String(a.anio).localeCompare(String(b.anio)) || String(a.pais).localeCompare(String(b.pais)) }[FILTRO.orden] || ((a, b) => b.id - a.id);
  f = f.slice().sort(ord);
  const tot = f.reduce((g, s) => { const c = s.cantidad || 1; g.n++; g.c += c; g.vmin += (s.valor_min || 0) * c; g.vmax += (s.valor_max || 0) * c; return g; }, { n: 0, c: 0, vmin: 0, vmax: 0 });
  const opciones = {};
  ["pais", "estado", "album", "uso", "tipo", "anio", "tema", "continente"].forEach(k =>
    opciones[k] = [...new Set(SELLOS.map(CLAVE[k]).filter(Boolean))].sort());
  const pas = {};
  SELLOS.forEach(s => { if (!s.pais) return; const p = pas[s.pais] ||= { pais: s.pais, bandera: s.bandera, c: 0 }; p.c += s.cantidad || 1; if (s.bandera) p.bandera = s.bandera; });
  const rareza = {};
  SELLOS.forEach(s => { rareza[s.rareza || ""] = (rareza[s.rareza || ""] || 0) + (s.cantidad || 1); });
  return { sellos: f.slice(0, 600), filtrado: tot, general: general(), opciones,
    pasaporte: Object.values(pas).sort((a, b) => b.c - a.c), rareza, recientes: SELLOS.slice(0, 12),
    paises: Object.keys(pas).length };
}
function grupos(por) {
  const m = new Map();
  SELLOS.forEach(s => { const k = CLAVE[por](s) || ""; const c = s.cantidad || 1;
    const g = m.get(k) || { clave: k, n: 0, c: 0, vmin: 0, vmax: 0, foto: s.id };
    g.n++; g.c += c; g.vmin += (s.valor_min || 0) * c; g.vmax += (s.valor_max || 0) * c; m.set(k, g); });
  let out = [...m.values()].filter(g => g.clave);
  const sin = m.get("");
  if (["anio", "decada", "rango"].includes(por)) out.sort((a, b) => a.clave.localeCompare(b.clave));
  else if (por === "pais") out.sort((a, b) => a.clave.toLowerCase().localeCompare(b.clave.toLowerCase()));
  else out.sort((a, b) => b.c - a.c);
  if (sin) out.push(sin);
  return out;
}

$("#q").oninput = () => { FILTRO.q = $("#q").value; clearTimeout(window._t); window._t = setTimeout(cargarColeccion, 300); };
$("#orden").onchange = () => { FILTRO.orden = $("#orden").value; cargarColeccion(); };
[["#t-fav", "fav"], ["#t-rev", "revisar"], ["#t-dup", "dup"], ["#t-val", "valioso"], ["#t-dud", "dudoso"], ["#t-raro", "raro"], ["#t-ant", "antes1950"]]
  .forEach(([id, k]) => $(id).onclick = () => { FILTRO[k] = FILTRO[k] ? 0 : 1; $(id).classList.toggle("on", !!FILTRO[k]); cargarColeccion(); });
$("#t-vista").onclick = () => { VISTA_LISTA = !VISTA_LISTA; $("#rejilla").classList.toggle("lista", VISTA_LISTA); };
$("#t-limpiar").onclick = () => {
  Object.keys(FILTRO).forEach(k => delete FILTRO[k]);
  Object.assign(FILTRO, { q: "", orden: "nuevo", fav: 0, revisar: 0, dup: 0, valioso: 0, dudoso: 0, raro: 0, antes1950: 0 });
  POR = "todos"; $("#q").value = ""; $("#orden").value = "nuevo";
  document.querySelectorAll(".tog").forEach(t => t.classList.remove("on"));
  cargarColeccion();
};
function pintarVerPor() {
  $("#verpor").innerHTML = CATEGORIAS.map(([k, t]) => `<button data-por="${k}" class="${POR === k ? "on" : ""}">${t}</button>`).join("");
  $("#verpor").querySelectorAll("button").forEach(b => b.onclick = () => {
    POR = b.dataset.por; CLAVES_FILTRO.forEach(k => delete FILTRO[k]); cargarColeccion(); });
}
const nombreGrupo = (por, clave) => por === "rango" ? clave.replace(/^\d\) /, "") : clave;

function pintarGrupos() {
  const gs = grupos(POR);
  $("#grupos").innerHTML = gs.map(g => `
    <button class="grupo" data-clave="${esc(g.clave)}">
      <img data-f="${g.foto}" alt="">
      <b>${esc(g.clave ? nombreGrupo(POR, g.clave) : "(sin clasificar)")}</b>
      <span>${g.c} ${g.c === 1 ? "sello" : "sellos"}</span><br>
      <span class="v">${eur(g.vmin)} – ${eur(g.vmax)}</span>
    </button>`).join("") || `<p class="suave">Todavía no hay sellos.</p>`;
  rellenarFotos($("#grupos"));
  $("#grupos").querySelectorAll(".grupo").forEach(b => b.onclick = () => {
    if (b.dataset.clave) FILTRO[POR] = b.dataset.clave;
    POR = "todos"; cargarColeccion();
  });
}
const COLORES_RAREZA = { "común": "#6c8bb0", "poco común": "#6fd08c", "raro": "#e9b949", "muy raro": "#ee7b66" };
function pintarPanelInicio() {
  const g = CAT.general, hayFiltro = Object.entries(FILTRO).some(([k, v]) => v && k !== "orden");
  const cont = $("#panel-inicio");
  if (!g.n || hayFiltro) { cont.innerHTML = ""; return; }
  const r = CAT.rareza, tot = Object.values(r).reduce((x, y) => x + y, 0) || 1;
  const orden = ["común", "poco común", "raro", "muy raro"];
  cont.innerHTML = `
    <div class="resumen-grande"><div class="gran">${eur(g.vmin)} – ${eur(g.vmax)}</div>
      <div class="suave">${g.c} sellos · ${CAT.paises} países${g.valiosos ? ` · 💎 ${g.valiosos} valiosos` : ""}</div></div>
    <div class="titulo-sec">Pasaporte de sellos</div>
    <div class="pasaporte">${CAT.pasaporte.slice(0, 40).map(p => `<button data-pais="${esc(p.pais)}"><span>${esc(p.bandera || "🏳️")}</span>${esc(p.pais)}<br>${p.c}</button>`).join("")}</div>
    <div class="titulo-sec">Rareza</div>
    <div class="barra-rareza">${orden.map(k => `<i style="width:${(r[k] || 0) * 100 / tot}%;background:${COLORES_RAREZA[k]}"></i>`).join("")}</div>
    <div class="suave" style="font-size:12px">${orden.map(k => `<span style="color:${COLORES_RAREZA[k]}">●</span> ${r[k] || 0} ${k}`).join(" · ")}</div>
    <div class="titulo-sec">Añadidos recientemente</div>
    <div class="recientes">${CAT.recientes.map(s => `<div class="tarj" data-id="${s.id}">
      <img data-f="${s.id}" alt=""><div class="t">${esc(s.pais || "¿?")} ${esc(s.anio)}</div>
      <div class="v">${eur(s.valor_min)}–${eur(s.valor_max)}</div></div>`).join("")}</div>`;
  rellenarFotos(cont);
  cont.querySelectorAll("[data-pais]").forEach(b => b.onclick = () => { FILTRO.pais = b.dataset.pais; cargarColeccion(); });
  cont.querySelectorAll(".recientes .tarj").forEach(t => t.onclick = () => abrirDetalle(t.dataset.id));
}

function cargarColeccion() {
  pintarVerPor();
  $("#grupos").hidden = POR === "todos";
  $("#bloque-lista").hidden = POR !== "todos";
  const activos = CLAVES_FILTRO.filter(k => FILTRO[k]);
  $("#migas").innerHTML = activos.length ? `<div class="migas">Viendo: ${activos.map(k => `<strong>${esc(nombreGrupo(k, FILTRO[k]))}</strong>`).join(" · ")}
    — <button id="quitar-cat">← volver a las categorías</button></div>` : "";
  if (activos.length) $("#quitar-cat").onclick = () => {
    const k = activos[0]; activos.forEach(x => delete FILTRO[x]); POR = k === "uso" ? "todos" : k; cargarColeccion(); };
  if (POR !== "todos") { pintarGrupos(); resumen(); return; }
  CAT = catalogo();
  const sel = $("#selectores");
  if (!sel.dataset.listo || sel.dataset.n !== String(CAT.general.n)) {
    sel.innerHTML = [["pais", "País"], ["anio", "Año"], ["album", "Álbum"], ["estado", "Estado"], ["uso", "Uso"]]
      .map(([k, t]) => `<select data-f="${k}"><option value="">${t}: todos</option>
        ${CAT.opciones[k].map(o => `<option ${FILTRO[k] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`).join("");
    sel.dataset.listo = 1; sel.dataset.n = CAT.general.n;
    sel.querySelectorAll("select").forEach(s => s.onchange = () => { FILTRO[s.dataset.f] = s.value; cargarColeccion(); });
  }
  pintarPanelInicio();
  const f = CAT.filtrado;
  $("#totales").textContent = `${f.c} sellos (${f.n} distintos) · valor estimado ${eur(f.vmin)} – ${eur(f.vmax)}`;
  $("#rejilla").innerHTML = CAT.sellos.length ? CAT.sellos.map(s => `
    <div class="tarj" data-id="${s.id}">
      ${s.favorito ? `<span class="fav">⭐</span>` : ""}${s.valor_max >= CFG().umbral ? `<span class="fav" style="left:10px;right:auto">💎</span>` : ""}
      <img data-f="${s.id}" alt="">
      <div class="t">${esc(s.pais || "¿País?")} ${esc(s.anio)}</div>
      <div class="s">${esc(s.denominacion)} · ${esc(s.tema)}</div>
      <div class="v">${eur(s.valor_min)}–${eur(s.valor_max)}${s.cantidad > 1 ? ` · ×${s.cantidad}` : ""}</div>
      <div class="s">${s.revisar ? "🔍 revisar · " : ""}${esc(s.album)}${s.pagina ? " p." + esc(s.pagina) : ""}</div>
    </div>`).join("") : `<p class="suave">No hay sellos con estos filtros.</p>`;
  rellenarFotos($("#rejilla"));
  document.querySelectorAll("#rejilla .tarj").forEach(t => t.onclick = () => abrirDetalle(t.dataset.id));
  resumen();
}

async function abrirDetalle(id) {
  const s = SELLOS.find(x => x.id === Number(id));
  if (!s) return;
  const foto = await urlFoto(s.id);
  const campos = [...CAMPOS_FORM, ["album", "Álbum"], ["pagina", "Página"], ["cantidad", "Cantidad"],
    ["tirada", "Tirada"], ["origen", "Origen"], ["imprenta", "Imprenta"], ["impresion", "Impresión"],
    ["precio_nuevo", "Precio nuevo"], ["precio_usado", "Precio usado"], ["valor_min", "Valor mín. (€)"], ["valor_max", "Valor máx. (€)"]];
  $("#modal-c").innerHTML = `
    <img src="${foto}" style="width:100%;max-height:300px;object-fit:contain;background:#000;border-radius:10px">
    <div class="valor" style="margin-top:8px">${eur(s.valor_min)} – ${eur(s.valor_max)}</div>
    <div>${badgeConf(s.confianza)}${s.revisar ? `<span class="chip oro">🔍 merece revisión</span>` : ""}
      <span class="chip">valorado ${esc((s.valorado || "").slice(0, 10))}</span></div>
    <h3 style="margin:10px 0 2px">${esc([s.bandera, s.pais, s.anio, s.denominacion].filter(Boolean).join(" · "))}</h3>
    <p class="suave">${esc(s.razon_valor)}</p>
    ${Number(s.dudoso) ? `<span class="chip rojo">❓ identificación dudosa</span>` : ""}
    ${infoHTML(s)}
    ${candidatasHTML(s, "cand")}
    ${(s.verificar || []).length ? `<ul class="v">${s.verificar.map(v => `<li>Comprobar: ${esc(v)}</li>`).join("")}</ul>` : ""}
    ${(s.fuentes || []).length ? `<div class="suave">Fuentes: ${s.fuentes.slice(0, 4).map((u, k) => `<a href="${esc(u)}" target="_blank" rel="noopener">[${k + 1}]</a>`).join(" ")}</div>` : ""}
    <div class="fila">${campos.map(([k, t]) => `<div><label>${t}</label><input data-k="${k}" value="${esc(s[k])}"></div>`).join("")}</div>
    <label>Descripción</label><textarea data-k="descripcion">${esc(s.descripcion)}</textarea>
    <label>Notas</label><textarea data-k="notas">${esc(s.notas)}</textarea>
    <div class="fila" style="margin-top:12px">
      <button class="boton chico" id="m-fav">${s.favorito ? "⭐ Quitar favorito" : "☆ Favorito"}</button>
      <button class="boton chico" id="m-rev">${s.revisar ? "Marcar como común" : "🔍 Marcar por revisar"}</button>
      <button class="boton chico sec" id="m-val">🔄 Revalorar con IA</button>
      <button class="boton chico sec" id="m-fondo">🔬 Analizar a fondo</button>
    </div>
    <div class="fila" style="margin-top:12px">
      <button class="boton" id="m-ok">💾 Guardar cambios</button>
      <button class="boton sec" id="m-cerrar">Cerrar</button>
    </div>
    <button class="boton rojo chico" id="m-del" style="margin-top:14px">🗑️ Borrar este sello</button>`;
  $("#modal").classList.add("on");
  const leer = () => { const o = {}; $("#modal-c").querySelectorAll("[data-k]").forEach(e => o[e.dataset.k] = e.value); return o; };
  const cerrar = () => { $("#modal").classList.remove("on"); cargarColeccion(); };
  const fallo = (e) => alert(e.message || e);
  $("#m-cerrar").onclick = cerrar;
  $("#m-ok").onclick = async () => { await editarSello(id, leer()); cerrar(); };
  $("#m-fav").onclick = async () => { await editarSello(id, { favorito: s.favorito ? 0 : 1 }); abrirDetalle(id); };
  $("#m-rev").onclick = async () => { await editarSello(id, { revisar: s.revisar ? 0 : 1 }); abrirDetalle(id); };
  $("#modal-c").querySelectorAll("[data-cand]").forEach(b => b.onclick = async () => {
    await editarSello(id, aplicarCandidata((s.candidatas || [])[b.dataset.cand])); abrirDetalle(id); });
  $("#m-fondo").onclick = async () => {
    const pista = prompt("Analizar este sello a fondo.\n\nSi sabes algo (país, año, de qué serie es…) escríbelo como pista. Si no, déjalo vacío:", "");
    if (pista === null) return;
    await editarSello(id, leer());
    velo("Analizando a fondo y buscando en catálogos…\n(puede tardar un minuto)");
    try { await afinarSello(id, pista); } catch (e) { fallo(e); }
    quitarVelo(); abrirDetalle(id);
  };
  $("#m-val").onclick = async () => {
    await editarSello(id, leer());
    velo("Buscando el valor actual de mercado…");
    try { await revalorarSello(id); } catch (e) { fallo(e); }
    quitarVelo(); abrirDetalle(id);
  };
  $("#m-del").onclick = async () => {
    if (!confirm("¿Borrar este sello de la colección? No se puede deshacer.")) return;
    await borrarSello(id); cerrar();
  };
}

/* ================= ajustes ================= */
function cargarAjustes() {
  const c = CFG();
  $("#aj-clave").value = c.clave;
  $("#aj-modelo").value = ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5"].includes(c.modelo) ? c.modelo : "claude-fable-5-1";
  $("#aj-busqueda").checked = c.busqueda;
  $("#aj-umbral").value = c.umbral;
  $("#aj-guardar").onclick = () => {
    guardarLS("clave_api", $("#aj-clave").value.trim());
    guardarLS("modelo", $("#aj-modelo").value);
    guardarLS("busqueda", $("#aj-busqueda").checked ? "1" : "0");
    guardarLS("umbral", String(parseFloat($("#aj-umbral").value) || 50));
    $("#aj-ok").textContent = "✅ Guardado en este teléfono"; avisos();
  };
  $("#aj-estado").textContent = `${SELLOS.length} sellos guardados en este teléfono · versión ${APP_VERSION}`;
  $("#b-exportar").onclick = exportarTodo;
  $("#b-probar").onclick = probarIA;
  $("#f-importar").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importarZip(f); };
}

/* Prueba rápida de la conexión con la IA: clave, modelo y búsqueda en internet */
async function probarIA() {
  const out = $("#prueba-ia");
  guardarLS("clave_api", $("#aj-clave").value.trim());
  guardarLS("modelo", $("#aj-modelo").value);
  out.innerHTML = "Probando…";
  const paso = async (nombre, fn) => {
    try { const r = await fn(); out.innerHTML += `<br>✅ ${nombre}${r ? " — " + esc(r) : ""}`; return true; }
    catch (e) { out.innerHTML += `<br>❌ ${nombre}: ${esc(e.message)}`; return false; }
  };
  out.innerHTML = "";
  const cfg = CFG();
  out.innerHTML = `Modelo: <strong>${esc(cfg.modelo)}</strong>`;
  let ok = await paso("Conexión, clave y modelo", async () => {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": cfg.clave, "anthropic-version": "2023-06-01", "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: cfg.modelo, max_tokens: 20, messages: [{ role: "user", content: "Responde solo: OK" }] }) });
    if (!r.ok) throw new Error(await mensajeHttp(r));
    return "la IA responde";
  });
  if (ok) await paso("Búsqueda de precios en internet", async () => {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": cfg.clave, "anthropic-version": "2023-06-01", "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: cfg.modelo, max_tokens: 300, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
        messages: [{ role: "user", content: "Busca en internet qué es el catálogo filatélico Edifil y responde en una frase." }] }) });
    if (!r.ok) throw new Error(await mensajeHttp(r) + " (se analizará sin buscar en internet)");
    return "disponible";
  });
  if (ok) await paso("Lectura de imágenes", async () => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d"); x.fillStyle = "#c33"; x.fillRect(0, 0, 64, 64);
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": cfg.clave, "anthropic-version": "2023-06-01", "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: cfg.modelo, max_tokens: 30, messages: [{ role: "user", content: [imgBloque(c.toDataURL("image/jpeg")), { type: "text", text: "¿De qué color es la imagen? Una palabra." }] }] }) });
    if (!r.ok) throw new Error(await mensajeHttp(r));
    const d = await r.json(); return "ve la imagen (" + (d.content?.[0]?.text || "").trim() + ")";
  });
}

/* ---------- exportar / importar ---------- */
const csvCampo = (v) => `"${String(Array.isArray(v) ? v.map(x => typeof x === "object" ? JSON.stringify(x) : x).join("; ") : (v ?? "")).replace(/"/g, '""')}"`;
function csvTexto(filas) {
  const cols = ["id", "creado", "valorado"].concat(CAMPOS);
  return "﻿" + [cols.join(";")].concat(filas.map(f => cols.map(c => csvCampo(f[c])).join(";"))).join("\r\n");
}
function htmlCatalogo(filas) {
  const e = esc;
  const tarj = filas.map(f => {
    const busq = ["pais", "anio", "denominacion", "tema", "descripcion", "catalogo_ref", "album", "notas"].map(k => f[k] || "").join(" ").toLowerCase();
    return `<div class=t data-b="${e(busq)}"><img src="fotos/${f.id}.jpg" loading=lazy>
      <b>${e(f.pais || "¿?")} ${e(f.anio || "")}</b><br>${e(f.denominacion || "")} · ${e(f.tema || "")}${(f.cantidad || 1) > 1 ? " · ×" + f.cantidad : ""}
      ${f.valor_max != null ? `<div class=v>${f.valor_min ?? 0} – ${f.valor_max} €</div>` : ""}
      <small>${e(f.descripcion || "")}${f.catalogo_ref ? "<br>Ref: " + e(f.catalogo_ref) : ""}${f.album ? "<br>📍 " + e(f.album) + (f.pagina ? " p. " + e(f.pagina) : "") : ""}${f.revisar ? "<br>🔍 merece revisión" : ""}${f.notas ? "<br>📝 " + e(f.notas) : ""}</small></div>`;
  }).join("");
  const g = general();
  return `<!DOCTYPE html><html lang=es><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Mi colección de sellos</title>
<style>body{font-family:Segoe UI,system-ui,sans-serif;background:#f6f2e9;color:#222;margin:0;padding:16px}h1{margin:0 0 4px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin-top:14px}.t{background:#fff;border-radius:10px;padding:10px;box-shadow:0 1px 4px #0002;font-size:14px}.t img{width:100%;height:140px;object-fit:contain;background:#222;border-radius:6px;margin-bottom:6px}.v{color:#1a7a3a;font-weight:700}small{color:#555;display:block;margin-top:4px}input{padding:10px;font-size:16px;width:100%;max-width:420px;border:1px solid #bbb;border-radius:8px}</style>
<h1>📮 Mi colección de sellos</h1><div>${g.c} sellos (${g.n} distintos) · valor estimado ${Math.round(g.vmin)} – ${Math.round(g.vmax)} € · exportado el ${new Date().toLocaleDateString("es-ES")}</div>
<p><small>Los valores son estimaciones orientativas hechas con IA a partir de fotos.</small></p>
<input placeholder="Buscar…" oninput="for(const t of document.querySelectorAll('.t'))t.style.display=t.dataset.b.includes(this.value.toLowerCase())?'':'none'">
<div class=g>${tarj}</div></html>`;
}
async function exportarTodo() {
  if (!SELLOS.length) { alert("Todavía no hay sellos que exportar."); return; }
  velo("Preparando la copia…\n(con muchas fotos puede tardar un poco)");
  try {
    const z = new JSZip();
    const filas = SELLOS.slice().sort((a, b) => a.id - b.id);
    z.file("LEEME.txt", "Mi colección de sellos\n\n- catalogo.html : ábrelo con el navegador (con buscador). Necesita la carpeta fotos al lado.\n- catalogo.csv  : hoja para Excel/LibreOffice (separador ;).\n- catalogo.json : todos los datos. Sirve para volver a importarlos en la app (⚙️ Ajustes → Importar copia).\n- fotos/        : un recorte por cada sello (el nombre es el número del sello).\n\nLos valores son estimaciones orientativas hechas con IA.\n");
    z.file("catalogo.html", htmlCatalogo(filas));
    z.file("catalogo.csv", csvTexto(filas));
    z.file("catalogo.json", JSON.stringify(filas, null, 1));
    for (const s of filas) {
      const f = await BD.foto(s.id);
      if (f) z.file(`fotos/${s.id}.jpg`, f.split(",")[1], { base64: true });
    }
    const blob = await z.generateAsync({ type: "blob", compression: "STORE" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Mis_Sellos_${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    guardarLS("ultima_copia", String(Date.now())); avisos();
  } catch (e) { alert("No se pudo crear la copia: " + e.message); }
  quitarVelo();
}
async function importarZip(file) {
  velo("Leyendo la copia…");
  try {
    const z = await JSZip.loadAsync(file);
    const js = z.file("catalogo.json");
    if (!js) throw new Error("Este archivo no parece una copia de Mis Sellos.");
    const filas = JSON.parse(await js.async("string"));
    quitarVelo();
    if (!confirm(`La copia tiene ${filas.length} sellos. ¿Añadirlos a los que ya tienes?`)) return;
    velo("Importando…");
    let n = 0;
    for (const f of filas) {
      const foto = z.file(`fotos/${f.id}.jpg`);
      const b64 = foto ? await foto.async("base64") : null;
      const rec = { ...f }; delete rec.id;
      const id = await BD.añadir(rec, b64 ? "data:image/jpeg;base64," + b64 : null);
      rec.id = id; SELLOS.unshift(rec); n++;
    }
    await cargarTodos(); resumen(); avisos();
    alert(`✅ Importados ${n} sellos.`);
  } catch (e) { alert(e.message); }
  quitarVelo();
}

inicio();
