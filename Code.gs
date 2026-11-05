/**
 * Backend en Google Apps Script para la app de Control Minimarket.
 *
 * Hoja "Vencimientos" con encabezados en la fila 1:
 *   id | timestamp | tipo | producto | fechaVencimiento | cantidad
 * (el orden no importa: se buscan por nombre. Las columnas que falten se crean solas)
 *
 * Implementar: Implementar > Nueva implementación > Aplicación web
 *   - Ejecutar como: Yo
 *   - Quién tiene acceso: Cualquier persona
 * Cada vez que cambies este código, hay que crear una NUEVA VERSIÓN de la implementación.
 */

/**
 * Backend en Google Apps Script para Control Minimarket.
 */

const TOKEN = 'minimarket2026';
const HOJA = 'Vencimientos';
const COLUMNAS = ['id', 'timestamp', 'tipo', 'producto', 'fechaVencimiento', 'cantidad'];
const EMAIL_NOTIFICACIONES = 'tu-email@gmail.com'; // 👈 CAMBIÁ ESTO POR TU EMAIL
const DIAS_ALERTA_EMAIL = 7; // Avisa de lo que vence dentro de los próximos 7 días

const VERSION = 'v3-editar-email';

function doGet() {
  return responder_({ ok: true, version: VERSION, mensaje: 'Backend Minimarket activo' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.token !== TOKEN) return responder_({ ok: false, error: 'No autorizado' });

    lock.waitLock(10000);
    switch (d.accion) {
      case 'obtenerVencimientos': return responder_({ ok: true, lista: listar_() });
      case 'guardarVencimiento':  return responder_({ ok: true, registro: guardar_(d) });
      case 'editarVencimiento':   return responder_({ ok: true, registro: editar_(d) });
      case 'eliminarVencimiento': return responder_({ ok: true, eliminado: eliminar_(d.id) });
      default: return responder_({ ok: false, error: 'Acción desconocida' });
    }
  } catch (err) {
    return responder_({ ok: false, error: String(err.message || err) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Hoja ---------- */

function hoja_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(HOJA) || ss.insertSheet(HOJA);
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, COLUMNAS.length).setValues([COLUMNAS]);
  return sh;
}

function encabezados_(sh) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  COLUMNAS.forEach(function (c) {
    if (headers.indexOf(c) === -1) {
      headers.push(c);
      sh.getRange(1, headers.length).setValue(c);
    }
  });
  return headers;
}

function fechaTexto_(v, tz) {
  return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v).trim();
}

/* ---------- Acciones CRUD ---------- */

function listar_() {
  const sh = hoja_();
  const headers = encabezados_(sh);
  const ultima = sh.getLastRow();
  if (ultima < 2) return [];

  const tz = sh.getParent().getSpreadsheetTimeZone();
  const datos = sh.getRange(2, 1, ultima - 1, headers.length).getValues();
  const iId = headers.indexOf('id');
  const ids = datos.map(function (f) { return [f[iId]]; });
  let faltaId = false;

  const lista = [];
  datos.forEach(function (fila, n) {
    const r = {};
    headers.forEach(function (h, i) { r[h] = fila[i]; });
    if (!r.producto) return;
    if (!ids[n][0]) { ids[n][0] = Utilities.getUuid(); faltaId = true; }
    lista.push({
      id: String(ids[n][0]),
      producto: String(r.producto),
      fechaVencimiento: fechaTexto_(r.fechaVencimiento, tz),
      cantidad: Number(r.cantidad) || 0,
    });
  });

  if (faltaId) sh.getRange(2, iId + 1, datos.length, 1).setValues(ids);
  return lista;
}

function guardar_(d) {
  const producto = String(d.producto || '').trim().replace(/\s+/g, ' ');
  const fecha = String(d.fechaVencimiento || '');
  const cantidad = Number(d.cantidad);

  if (!producto || producto.length > 120) throw new Error('Producto inválido');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(new Date(fecha).getTime())) throw new Error('Fecha inválida');
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100000) throw new Error('Cantidad inválida');

  const sh = hoja_();
  const headers = encabezados_(sh);
  const id = Utilities.getUuid();
  const valores = {
    id: id,
    timestamp: new Date(),
    tipo: 'Vencimientos',
    producto: producto,
    fechaVencimiento: fecha,
    cantidad: cantidad,
  };
  sh.appendRow(headers.map(function (h) { return valores[h] !== undefined ? valores[h] : ''; }));

  return { id: id, producto: producto, fechaVencimiento: fecha, cantidad: cantidad };
}

function editar_(d) {
  if (!d.id) throw new Error('Falta el ID');
  const producto = String(d.producto || '').trim().replace(/\s+/g, ' ');
  const fecha = String(d.fechaVencimiento || '');
  const cantidad = Number(d.cantidad);

  if (!producto || producto.length > 120) throw new Error('Producto inválido');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(new Date(fecha).getTime())) throw new Error('Fecha inválida');
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100000) throw new Error('Cantidad inválida');

  const sh = hoja_();
  const headers = encabezados_(sh);
  const ultima = sh.getLastRow();
  if (ultima < 2) throw new Error('No hay registros');

  const idxId = headers.indexOf('id');
  const ids = sh.getRange(2, idxId + 1, ultima - 1, 1).getValues();

  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(d.id)) {
      const numFila = i + 2;
      sh.getRange(numFila, headers.indexOf('producto') + 1).setValue(producto);
      sh.getRange(numFila, headers.indexOf('fechaVencimiento') + 1).setValue(fecha);
      sh.getRange(numFila, headers.indexOf('cantidad') + 1).setValue(cantidad);
      sh.getRange(numFila, headers.indexOf('timestamp') + 1).setValue(new Date());

      return { id: d.id, producto: producto, fechaVencimiento: fecha, cantidad: cantidad };
    }
  }
  throw new Error('El registro a editar no existe');
}

function eliminar_(id) {
  if (!id) throw new Error('Falta el id');
  const sh = hoja_();
  const headers = encabezados_(sh);
  const ultima = sh.getLastRow();
  if (ultima < 2) throw new Error('No hay registros');

  const ids = sh.getRange(2, headers.indexOf('id') + 1, ultima - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      sh.deleteRow(i + 2);
      return true;
    }
  }
  throw new Error('El registro no existe');
}

/* ---------- Disparador Automático de Email ---------- */

/**
 * Para activar el envío diario por mail:
 * 1. Cambiá EMAIL_NOTIFICACIONES arriba con tu dirección.
 * 2. En el editor de Apps Script, andá a "Activadores" (icono de reloj a la izquierda).
 * 3. Hacé clic en "+ Añadir activador".
 * 4. Seleccioná la función: "enviarReporteDiarioEmail".
 * 5. Seleccioná fuente de eventos: "Según el tiempo".
 * 6. Seleccioná tipo de activador: "Temporizador de días" (ej. de 8 a 9 AM).
 */
function enviarReporteDiarioEmail() {
  const lista = listar_();
  if (!lista.length) return;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const porVencer = [];
  const yaVencidos = [];

  lista.forEach(function (item) {
    const partes = item.fechaVencimiento.split('-');
    const fVenc = new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[Partes.length - 1]));
    const diffDias = Math.round((fVenc - hoy) / 86400000);

    if (diffDias < 0) {
      yaVencidos.push(item.producto + ' (Cant: ' + item.cantidad + ') - Vencido');
    } else if (diffDias <= DIAS_ALERTA_EMAIL) {
      porVencer.push(item.producto + ' (Cant: ' + item.cantidad + ') - Vence en ' + diffDias + ' días');
    }
  });

  if (!yaVencidos.length && !porVencer.length) return; // No envía mail si no hay novedades

  let cuerpo = 'Resumen diario de vencimientos de Minimarket:\n\n';

  if (yaVencidos.length) {
    cuerpo += '🔴 YA VENCIDOS:\n- ' + yaVencidos.join('\n- ') + '\n\n';
  }

  if (porVencer.length) {
    cuerpo += '⚠️ PRÓXIMOS A VENCER (en ' + DIAS_ALERTA_EMAIL + ' días):\n- ' + porVencer.join('\n- ') + '\n\n';
  }

  cuerpo += 'Ingresá a la app para actualizar el inventario.';

  MailApp.sendEmail({
    to: EMAIL_NOTIFICACIONES,
    subject: '🛒 Alerta Vencimientos Minimarket (' + Utilities.formatDate(hoy, 'GMT-3', 'dd/MM/yyyy') + ')',
    body: cuerpo,
  });
}
