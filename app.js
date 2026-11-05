'use strict';

/* ============ Configuración ============ */
const CONFIG = {
    URL_SCRIPT: 'https://script.google.com/macros/s/AKfycbzF-aC5dPzfwJunlO4Y-H6l6ZfJ3A0Y6RlFKv50fTxQU5b_HmfVUaOAMgS6gzrB3zVe/exec',
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

/* ============ Tema Oscuro / Claro ============ */
function inicializarTema() {
    const oscuroGuardado = localStorage.getItem('tema-oscuro') === 'true';
    if (oscuroGuardado) {
        document.documentElement.classList.add('dark');
        $('icono-tema').textContent = '☀️';
    } else {
        document.documentElement.classList.remove('dark');
        $('icono-tema').textContent = '🌙';
    }
}

function alternarTema() {
    const esOscuro = document.documentElement.classList.toggle('dark');
    localStorage.setItem('tema-oscuro', esOscuro);
    $('icono-tema').textContent = esOscuro ? '☀️' : '🌙';
}

/* ============ Helpers ============ */
function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
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

    if (dias < 0)  return { clase: 'text-rose-600 dark:text-rose-400',  texto: `Vencido hace ${-dias} d` };
    if (dias === 0) return { clase: 'text-rose-600 dark:text-rose-400',  texto: 'Vence hoy' };
    if (dias <= CONFIG.DIAS_ALERTA) return { clase: 'text-amber-600 dark:text-amber-400', texto: `Vence en ${dias} d` };
    return { clase: 'text-emerald-600 dark:text-emerald-400', texto: `Vence en ${dias} d` };
}

function categoria(iso) {
    const dias = diasHasta(iso);
    if (dias < 0) return 'vencidos';
    return dias <= CONFIG.DIAS_ALERTA ? 'proximos' : 'ok';
}

/* ============ API (Apps Script) ============ */
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

/* ============ UI: toast y resumen ============ */
function mostrarToast(mensaje, icono = '✅') {
    const toast = $('toast');
    $('toast-mensaje').textContent = mensaje;
    $('toast-icon').textContent = icono;
    toast.classList.remove('opacity-0', 'pointer-events-none');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('opacity-0', 'pointer-events-none'), CONFIG.TOAST_MS);
}

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
        const g = grupos[categoria(r.fechaVencimiento)];
        if (g) { g.n += 1; g.u += r.cantidad; }
    });

    $('resumen').replaceChildren(
        crearChip('bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300', 'Todos', grupos.todos, 'todos'),
        crearChip('bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300', 'Vencidos', grupos.vencidos, 'vencidos'),
        crearChip('bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300', `Próximos ${CONFIG.DIAS_ALERTA} d`, grupos.proximos, 'proximos'),
    );
}

/* ============ Guardar / Editar ============ */
function setCargando(btn, cargando, textoCargando = '') {
    btn.disabled = cargando;
    btn.textContent = cargando ? textoCargando : btn.dataset.texto;
}

function cancelarEdicion() {
    $('v-id').value = '';
    $('form-vencimientos').reset();
    $('btn-submit').dataset.texto = 'Guardar Vencimiento';
    $('btn-submit').textContent = 'Guardar Vencimiento';
    $('btn-cancelar-edicion').classList.add('hidden');
}

function iniciarEdicion(item) {
    cerrarModal();
    $('v-id').value = item.id;
    $('v-producto').value = item.producto;
    $('v-fecha').value = item.fechaVencimiento;
    $('v-cantidad').value = item.cantidad;

    $('btn-submit').dataset.texto = 'Actualizar Vencimiento';
    $('btn-submit').textContent = 'Actualizar Vencimiento';
    $('btn-cancelar-edicion').classList.remove('hidden');
    $('v-producto').focus();
}

async function guardarVencimiento(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = $('btn-submit');

    if (!form.reportValidity()) return;

    const id = $('v-id').value;
    const producto = normalizar($('v-producto').value);
    const fechaVencimiento = $('v-fecha').value;
    const cantidad = Number($('v-cantidad').value);

    if (!Number.isInteger(cantidad) || cantidad < 1) {
        mostrarToast('La cantidad debe ser mayor a 0', '⚠️');
        return;
    }
    if (!PRODUCTOS_SET.has(producto) && !confirm(`"${producto}" no está en el catálogo.\n¿Continuar igual?`)) {
        return;
    }

    const esEdicion = Boolean(id);
    setCargando(btn, true, esEdicion ? 'Actualizando...' : 'Guardando...');

    try {
        const accion = esEdicion ? 'editarVencimiento' : 'guardarVencimiento';
        const { registro } = await api({ accion, id, producto, fechaVencimiento, cantidad });

        if (esEdicion) {
            const idx = registros.findIndex((r) => r.id === id);
            if (idx !== -1) registros[idx] = registro;
            mostrarToast('¡Registro actualizado!', '✅');
        } else {
            registros.push(registro);
            mostrarToast('¡Vencimiento guardado!', '✅');
        }

        actualizarResumen();
        cancelarEdicion();
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
const PILL_ACTIVA = 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100';
const PILL_INACTIVA = 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800';

const sinTildes = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

function pasaFiltros(r, palabras) {
    if (filtroActual !== 'todos' && categoria(r.fechaVencimiento) !== filtroActual) return false;
    const nombre = sinTildes(r.producto);
    return palabras.every((p) => nombre.includes(p));
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

    const card = el('div', 'bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex items-center justify-between gap-2 text-xs');

    const info = el('div', 'space-y-0.5 min-w-0');
    info.append(el('p', 'font-bold text-slate-800 dark:text-slate-200 break-words', item.producto));

    const detalle = el('p', 'text-slate-500 dark:text-slate-400');
    detalle.append(
        'Vence: ',
        el('span', 'font-semibold text-slate-700 dark:text-slate-300', formatearFecha(item.fechaVencimiento)),
        ' | Cant: ',
        el('span', 'font-semibold text-slate-700 dark:text-slate-300', String(item.cantidad)),
    );
    info.append(detalle, el('p', `font-semibold ${est.clase}`, est.texto));

    const acciones = el('div', 'shrink-0 flex items-center gap-1');

    const btnEditar = el('button', 'bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 p-2 rounded-lg transition-all font-bold outline-none', '✏️');
    btnEditar.type = 'button';
    btnEditar.dataset.editar = item.id;
    btnEditar.setAttribute('aria-label', `Editar ${item.producto}`);

    const btnEliminar = el('button', 'bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 p-2 rounded-lg transition-all font-bold outline-none', '🗑️');
    btnEliminar.type = 'button';
    btnEliminar.dataset.eliminar = item.id;
    btnEliminar.setAttribute('aria-label', `Eliminar ${item.producto}`);

    acciones.append(btnEditar, btnEliminar);
    card.append(info, acciones);
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
        cont.append(el('p', 'text-xs text-slate-400 dark:text-slate-500 text-center py-6', msg));
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

    if (registros.length) renderizarLista();
    else {
        actualizarFiltros();
        $('contenedor-lista').replaceChildren(el('p', 'text-xs text-slate-400 dark:text-slate-500 text-center py-6', 'Cargando desde Google Sheets...'));
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
    inicializarTema();

    // Autocompletado
    const frag = document.createDocumentFragment();
    PRODUCTOS.forEach((p) => frag.append(Object.assign(document.createElement('option'), { value: p })));
    $('lista-productos').append(frag);

    // Eventos
    $('btn-tema').addEventListener('click', alternarTema);
    $('form-vencimientos').addEventListener('submit', guardarVencimiento);
    $('btn-cancelar-edicion').addEventListener('click', cancelarEdicion);

    $('resumen').addEventListener('click', (e) => {
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
        const btnEdit = e.target.closest('[data-editar]');
        if (btnEdit) {
            const item = registros.find((r) => r.id === btnEdit.dataset.editar);
            if (item) iniciarEdicion(item);
            return;
        }
        const btnElim = e.target.closest('[data-eliminar]');
        if (btnElim) eliminarRegistro(btnElim.dataset.eliminar);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !$('modal-lista').classList.contains('hidden')) cerrarModal();
    });

    cargarRegistros().catch(mostrarErrorCarga);
}

function mostrarErrorCarga(err) {
    console.warn('No se pudo cargar la lista:', err);

    const aviso = el('div', 'col-span-3 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 p-3 text-xs space-y-1');
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

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker:', err));
    });
}