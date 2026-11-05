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
let filtroActual = 'todos';        // 'todos' | 'vencidos' | 'proximos'
let textoBusqueda = '';            // lo que se escribe en el buscador de la lista

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

// Un solo criterio para el resumen y los filtros (lo que vence hoy cuenta como "próximos")
function categoria(iso) {
    const dias = diasHasta(iso);
    if (dias < 0) return 'vencidos';
    return dias <= CONFIG.DIAS_ALERTA ? 'proximos' : 'ok';
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
    actualizarResumen();
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

/* ============ Resumen: tres tarjetas que abren la lista ============ */
function crearChip(clase, titulo, grupo, filtro) {
    const chip = el('button', `rounded-xl border px-2 py-2.5 text-left transition-all hover:brightness-95 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-slate-400 outline-none ${clase}`);
    chip.type = 'button';
    chip.dataset.filtro = filtro;
    chip.setAttribute('aria-label', `${titulo}: ${grupo.n}. Ver lista`);
    chip.append(
        el('span', 'block text-2xl font-bold leading-none', String(grupo.n)),
        el('span', 'block text-xs font-semibold mt-1', titulo),
        el('span', 'block text-[11px] opacity-80', `${grupo.u} unidad${grupo.u === 1 ? '' : 'es'}`),
    );
    return chip;
}

function actualizarResumen() {
    const grupos = { todos: { n: 0, u: 0 }, vencidos: { n: 0, u: 0 }, proximos: { n: 0, u: 0 } };

    registros.forEach((r) => {
        grupos.todos.n += 1;
        grupos.todos.u += r.cantidad;
        const g = grupos[categoria(r.fechaVencimiento)];   // 'ok' no tiene grupo: solo suma en "Todos"
        if (g) { g.n += 1; g.u += r.cantidad; }
    });

    $('resumen').replaceChildren(
        crearChip('bg-slate-50 border-slate-200 text-slate-700', 'Todos', grupos.todos, 'todos'),
        crearChip('bg-rose-50 border-rose-200 text-rose-700', 'Vencidos', grupos.vencidos, 'vencidos'),
        crearChip('bg-amber-50 border-amber-200 text-amber-700', `Próximos ${CONFIG.DIAS_ALERTA} d`, grupos.proximos, 'proximos'),
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
        actualizarResumen();
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
const FILTROS = { todos: 'Todos', vencidos: 'Vencidos', proximos: `Próximos ${CONFIG.DIAS_ALERTA} d` };
const PILL_BASE = 'px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all focus-visible:ring-2 focus-visible:ring-slate-400 outline-none';
const PILL_ACTIVA = 'bg-slate-900 text-white border-slate-900';
const PILL_INACTIVA = 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100';

// Para buscar sin importar mayúsculas ni tildes
const sinTildes = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

function pasaFiltros(r, palabras) {
    if (filtroActual !== 'todos' && categoria(r.fechaVencimiento) !== filtroActual) return false;
    const nombre = sinTildes(r.producto);
    return palabras.every((p) => nombre.includes(p));   // tienen que estar todas las palabras escritas
}

function actualizarFiltros() {
    document.querySelectorAll('[data-pill]').forEach((b) => {
        const f = b.dataset.pill;
        const n = f === 'todos' ? registros.length : registros.filter((r) => categoria(r.fechaVencimiento) === f).length;
        const activo = f === filtroActual;
        b.textContent = `${FILTROS[f]} (${n})`;
        b.className = `${PILL_BASE} ${activo ? PILL_ACTIVA : PILL_INACTIVA}`;
        b.setAttribute('aria-pressed', String(activo));
    });
}

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
    actualizarFiltros();
    const cont = $('contenedor-lista');
    cont.replaceChildren();

    const palabras = sinTildes(textoBusqueda.trim()).split(/\s+/).filter(Boolean);
    const visibles = registros
        .filter((r) => pasaFiltros(r, palabras))
        .sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento));

    if (visibles.length === 0) {
        const msg = registros.length === 0 ? 'No hay vencimientos cargados en la planilla.' : 'No hay productos que coincidan.';
        cont.append(el('p', 'text-xs text-slate-400 text-center py-6', msg));
        return;
    }
    cont.append(...visibles.map(crearTarjeta));
}

async function abrirModal(filtro = 'todos') {
    filtroActual = filtro;
    textoBusqueda = '';
    $('buscar').value = '';
    ultimoFoco = document.activeElement;
    $('modal-lista').classList.remove('hidden');
    $('btn-cerrar').focus();

    if (registros.length) renderizarLista();   // muestra la cache mientras se actualiza
    else {
        actualizarFiltros();
        $('contenedor-lista').replaceChildren(el('p', 'text-xs text-slate-400 text-center py-6', 'Cargando desde Google Sheets...'));
    }

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
        actualizarResumen();
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
    $('resumen').addEventListener('click', (e) => {             // tarjetas del resumen -> lista filtrada
        const chip = e.target.closest('[data-filtro]');
        if (chip) abrirModal(chip.dataset.filtro);
    });
    $('filtros').addEventListener('click', (e) => {
        const pill = e.target.closest('[data-pill]');
        if (pill) { filtroActual = pill.dataset.pill; renderizarLista(); }
    });
    $('buscar').addEventListener('input', (e) => { textoBusqueda = e.target.value; renderizarLista(); });
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

    const aviso = el('div', 'col-span-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 p-3 text-xs space-y-1');
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
