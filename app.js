'use strict';

/* ============ Configuración ============ */
const CONFIG = {
    URL_SCRIPT: 'https://script.google.com/macros/s/AKfycbxPJsrnXQGZ69H-njZkuMk0mK6ENwYGWieGDP0UTiZpyrVW9FpQ3DjKrOpE2zLxER5I/exec',
    TOKEN: 'minimarket2026',   // tiene que ser igual al TOKEN de Code.gs
    DIAS_ALERTA: 30,               // días antes del vencimiento para marcar en naranja
    TOAST_MS: 3000,
};

/* ============ Estado ============ */
let registros = [];                // cache de la lista del Sheet
let toastTimer = null;
let ultimoFoco = null;             // para devolver el foco al cerrar el modal

const $ = (id) => document.getElementById(id);
const PRODUCTOS_SET = new Set(PRODUCTOS);

/* ============ Helpers ============ */
function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;   // textContent: nunca interpreta HTML
    return n;
}

const normalizar = (s) => s.trim().replace(/\s+/g, ' ').toUpperCase();

function formatearFecha(iso) {                       // 2026-11-05 -> 05/11/2026
    return iso.split('-').reverse().join('/');
}

function diasHasta(iso) {                            // días desde hoy hasta la fecha (negativo = vencido)
    const [y, m, d] = iso.split('-').map(Number);
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return Math.round((new Date(y, m - 1, d) - hoy) / 86400000);
}

function estadoVencimiento(iso) {
    const dias = diasHasta(iso);

    if (dias < 0)  return { clase: 'text-rose-600',  texto: `Vencido hace ${-dias} d` };
    if (dias === 0) return { clase: 'text-rose-600',  texto: 'Vence hoy' };
    if (dias <= CONFIG.DIAS_ALERTA) return { clase: 'text-amber-600', texto: `Vence en ${dias} d` };
    return { clase: 'text-emerald-600', texto: `Vence en ${dias} d` };
}

/* ============ API (Apps Script) ============ */
// Content-Type text/plain = "request simple": no hay preflight y se puede leer la respuesta.
async function api(payload) {
    if (!navigator.onLine) throw new Error('Sin conexión a internet');
    const res = await fetch(CONFIG.URL_SCRIPT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, token: CONFIG.TOKEN }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Error desconocido');
    return data;
}

async function cargarRegistros() {
    const { lista } = await api({ accion: 'obtenerVencimientos' });
    registros = lista;
    actualizarBadge();
}

/* ============ UI: toast y badge ============ */
function mostrarToast(mensaje, icono = '✅') {
    const toast = $('toast');
    $('toast-mensaje').textContent = mensaje;
    $('toast-icon').textContent = icono;
    toast.classList.remove('opacity-0', 'pointer-events-none');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('opacity-0', 'pointer-events-none'), CONFIG.TOAST_MS);
}

function actualizarBadge(texto) {
    $('badge-contador').textContent = texto ?? registros.length;
    if (texto === undefined) actualizarResumen();   // se recalcula cada vez que cambia la lista
}

/* ============ Resumen: vencidos y próximos ============ */
function crearChip(clase, titulo, grupo) {
    const chip = el('div', `flex-1 rounded-xl border p-3 ${clase}`);
    chip.append(
        el('p', 'text-2xl font-bold leading-none', String(grupo.n)),
        el('p', 'text-xs font-semibold mt-1', titulo),
        el('p', 'text-[11px] opacity-80', `${grupo.u} unidad${grupo.u === 1 ? '' : 'es'}`),
    );
    return chip;
}

function actualizarResumen() {
    const vencidos = { n: 0, u: 0 };
    const proximos = { n: 0, u: 0 };

    registros.forEach((r) => {
        const dias = diasHasta(r.fechaVencimiento);
        const grupo = dias < 0 ? vencidos : dias <= CONFIG.DIAS_ALERTA ? proximos : null;
        if (grupo) { grupo.n += 1; grupo.u += r.cantidad; }
    });

    $('resumen').replaceChildren(
        crearChip('bg-rose-50 border-rose-200 text-rose-700', 'Ya vencidos', vencidos),
        crearChip('bg-amber-50 border-amber-200 text-amber-700', `Vencen en ${CONFIG.DIAS_ALERTA} días`, proximos),
    );
}

/* ============ Guardar ============ */
function setCargando(btn, cargando, textoCargando = '') {
    btn.disabled = cargando;
    btn.textContent = cargando ? textoCargando : btn.dataset.texto;
}

async function guardarVencimiento(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector('button[type="submit"]');

    if (!form.reportValidity()) return;   // usa la validación nativa (required, min, max)

    const producto = normalizar($('v-producto').value);
    const fechaVencimiento = $('v-fecha').value;
    const cantidad = Number($('v-cantidad').value);

    if (!Number.isInteger(cantidad) || cantidad < 1) {
        mostrarToast('La cantidad debe ser un número entero mayor a 0', '⚠️');
        return;
    }
    if (!PRODUCTOS_SET.has(producto) &&
        !confirm(`"${producto}" no está en la lista de productos.\n¿Guardarlo igual?`)) {
        return;
    }

    setCargando(btn, true, 'Guardando...');
    try {
        const { registro } = await api({ accion: 'guardarVencimiento', producto, fechaVencimiento, cantidad });
        registros.push(registro);
        actualizarBadge();
        mostrarToast('¡Vencimiento guardado!', '✅');
        form.reset();
        $('v-producto').focus();
    } catch (err) {
        console.error('Error al guardar:', err);
        mostrarToast(`No se pudo guardar: ${err.message}`, '❌');
    } finally {
        setCargando(btn, false);
    }
}

/* ============ Lista / modal ============ */
function crearTarjeta(item) {
    const est = estadoVencimiento(item.fechaVencimiento);

    const card = el('div', 'bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-2 text-xs');

    const info = el('div', 'space-y-0.5 min-w-0');
    info.append(el('p', 'font-bold text-slate-800 break-words', item.producto));

    const detalle = el('p', 'text-slate-500');
    detalle.append(
        'Vence: ',
        el('span', 'font-semibold text-slate-700', formatearFecha(item.fechaVencimiento)),
        ' | Cant: ',
        el('span', 'font-semibold text-slate-700', String(item.cantidad)),
    );
    info.append(detalle, el('p', `font-semibold ${est.clase}`, est.texto));

    const btn = el('button', 'shrink-0 bg-rose-50 hover:bg-rose-100 text-rose-600 p-2 rounded-lg transition-all font-bold focus-visible:ring-2 focus-visible:ring-rose-400 outline-none', '🗑️');
    btn.type = 'button';
    btn.dataset.eliminar = item.id;
    btn.setAttribute('aria-label', `Eliminar ${item.producto}`);

    card.append(info, btn);
    return card;
}

function renderizarLista() {
    const cont = $('contenedor-lista');
    cont.replaceChildren();

    if (registros.length === 0) {
        cont.append(el('p', 'text-xs text-slate-400 text-center py-6', 'No hay vencimientos cargados en la planilla.'));
        return;
    }
    const ordenados = [...registros].sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento));
    cont.append(...ordenados.map(crearTarjeta));
}

async function abrirModal() {
    ultimoFoco = document.activeElement;
    $('modal-lista').classList.remove('hidden');
    $('btn-cerrar').focus();

    if (registros.length) renderizarLista();   // muestra la cache mientras se actualiza
    else $('contenedor-lista').replaceChildren(el('p', 'text-xs text-slate-400 text-center py-6', 'Cargando desde Google Sheets...'));

    try {
        await cargarRegistros();
        renderizarLista();
    } catch (err) {
        console.error('Error al leer el Sheet:', err);
        if (!registros.length) {
            $('contenedor-lista').replaceChildren(el('p', 'text-xs text-rose-500 text-center py-6', `Error al cargar: ${err.message}`));
        } else {
            mostrarToast('No se pudo actualizar la lista', '⚠️');
        }
    }
}

function cerrarModal() {
    $('modal-lista').classList.add('hidden');
    if (ultimoFoco) ultimoFoco.focus();
}

async function eliminarRegistro(id) {
    const item = registros.find((r) => r.id === id);
    if (!item || !confirm(`¿Eliminar "${item.producto}" (${formatearFecha(item.fechaVencimiento)})?`)) return;

    try {
        await api({ accion: 'eliminarVencimiento', id });
        registros = registros.filter((r) => r.id !== id);
        renderizarLista();
        actualizarBadge();
        mostrarToast('Registro eliminado', '🗑️');
    } catch (err) {
        console.error('Error al eliminar:', err);
        mostrarToast(`No se pudo eliminar: ${err.message}`, '❌');
    }
}

/* ============ Inicio ============ */
function init() {
    // Autocompletado
    const frag = document.createDocumentFragment();
    PRODUCTOS.forEach((p) => frag.append(Object.assign(document.createElement('option'), { value: p })));
    $('lista-productos').append(frag);

    // Eventos
    $('form-vencimientos').addEventListener('submit', guardarVencimiento);
    $('btn-ver-lista').addEventListener('click', abrirModal);
    $('btn-cerrar').addEventListener('click', cerrarModal);
    $('btn-cerrar-x').addEventListener('click', cerrarModal);
    $('modal-lista').addEventListener('click', (e) => { if (e.target === e.currentTarget) cerrarModal(); });
    $('contenedor-lista').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-eliminar]');
        if (btn) eliminarRegistro(btn.dataset.eliminar);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !$('modal-lista').classList.contains('hidden')) cerrarModal();
    });

    cargarRegistros().catch(mostrarErrorCarga);   // una sola carga inicial (contador y resumen)
}

function mostrarErrorCarga(err) {
    console.warn('No se pudo cargar la lista:', err);
    actualizarBadge('?');

    const aviso = el('div', 'w-full rounded-xl border border-rose-200 bg-rose-50 text-rose-700 p-3 text-xs space-y-1');
    aviso.append(
        el('p', 'font-semibold', 'No se pudo leer la lista del Sheet'),
        el('p', 'break-words', `Motivo: ${err.message}`),
    );
    const btn = el('button', 'underline font-semibold', 'Reintentar');
    btn.type = 'button';
    btn.addEventListener('click', () => cargarRegistros().catch(mostrarErrorCarga));
    aviso.append(btn);
    $('resumen').replaceChildren(aviso);
}

init();

// App instalable y con arranque offline (necesita HTTPS; Netlify lo da)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker:', err));
    });
}
