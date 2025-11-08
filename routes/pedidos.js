// routes/pedidos.js
// ------------------------------------------------------------------
// Pedidos: listado, creación (shop), detalle, recibo HTML y PDF,
// flujo de autorización/completado, catálogo y municipios.
// Usa SOLO 'nom_nuevo' y 'tel_nuevo' en la cabecera.
// ------------------------------------------------------------------
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const PDFDocument = require('pdfkit');
const multer = require('multer');
const pool = require('../config/db');

// ============================
// Inventario por bodega (por defecto)
// ============================
const STOCK_TABLE = 'product_stock';
const COL_PROD = 'product_id';
const COL_BODEGA = 'warehouse_id';
const COL_STOCK = 'cantidad';

// ============================
// Uploads (archivo de diseño)
// ============================
const uploadDir = path.resolve(process.cwd(), 'public', 'uploads', 'pedidos');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '').toLowerCase()) || '';
    cb(null, `diseno_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

// (Auth real si aplica)
const isAuth = (req, res, next) => next();

// ============================
// Utils
// ============================
function formatMoney(n) { return `Q ${Number(n || 0).toFixed(2)}`; }

// ============================
// Data helpers
// ============================
async function getPedidoById(id) {
  const [[pedido]] = await pool.query(`
    SELECT p.*,
           p.direccion AS direccion_envio,
           b.nombre    AS bodega_nombre,
           dep.nombre  AS departamento_nombre,
           mun.nombre  AS municipio_nombre,
           COALESCE(NULLIF(TRIM(p.nom_nuevo), ''), 'Consumidor final') AS cliente_mostrar
      FROM pedidos p
 LEFT JOIN bodegas       b   ON b.id  = p.bodega_id
 LEFT JOIN departamentos dep ON dep.id= p.departamento_id
 LEFT JOIN municipios    mun ON mun.id= p.municipio_id
     WHERE p.id = ?
    LIMIT 1
  `, [id]);
  return pedido || null;
}

async function getDetallesPedido(id) {
  // Une detalles desde pedidos_detalles y pedidos_det (compatibilidad)
  const [detalles] = await pool.query(`
    SELECT d.id,
           d.pedido_id,
           d.producto_id,
           d.cantidad,
           COALESCE(d.precio_unitario, 0) AS precio_unitario,
           COALESCE(d.subtotal, d.cantidad * COALESCE(d.precio_unitario,0)) AS subtotal,
           pr.nombre AS producto_nombre
    FROM (
          SELECT id, pedido_id, producto_id, cantidad, precio_unitario, subtotal, created_at
            FROM pedidos_detalles
           WHERE pedido_id = ?
          UNION ALL
          SELECT id, pedido_id, producto_id, cantidad, precio_unitario, NULL AS subtotal, creado_en AS created_at
            FROM pedidos_det
           WHERE pedido_id = ?
    ) AS d
    LEFT JOIN products  pr ON pr.id = d.producto_id
    ORDER BY d.id ASC
  `, [id, id]).catch(async () => {
    // Si no existe products, intenta con productos
    const [alt] = await pool.query(`
      SELECT d.id,
             d.pedido_id,
             d.producto_id,
             d.cantidad,
             COALESCE(d.precio_unitario, 0) AS precio_unitario,
             COALESCE(d.subtotal, d.cantidad * COALESCE(d.precio_unitario,0)) AS subtotal,
             pr.nombre AS producto_nombre
      FROM (
            SELECT id, pedido_id, producto_id, cantidad, precio_unitario, subtotal, created_at
              FROM pedidos_detalles
             WHERE pedido_id = ?
            UNION ALL
            SELECT id, pedido_id, producto_id, cantidad, precio_unitario, NULL AS subtotal, creado_en AS created_at
              FROM pedidos_det
             WHERE pedido_id = ?
      ) AS d
      LEFT JOIN productos pr ON pr.id = d.producto_id
      ORDER BY d.id ASC
    `, [id, id]);
    return [alt];
  });
  return detalles;
}

// ============================
// API Catálogo (resiliente) y Municipios
// ============================
// Catálogo por bodega (ajustado a tu schema: products + product_stock)
router.get('/api/catalog', isAuth, async (req, res) => {
  try {
    const bodegaId = Number(req.query.bodega_id || 0);
    const q = (req.query.search || '').trim();
    if (!bodegaId) return res.json({ items: [] });

    // 1) Camino rápido: tu esquema real
    try {
      const params = [bodegaId];
      let whereName = '';
      if (q) { whereName = 'AND pr.nombre LIKE ?'; params.push(`%${q}%`); }

      const [rows] = await pool.query(`
        SELECT  pr.id,
                pr.nombre,
                COALESCE(pr.precio_venta, 0)                  AS precio,
                COALESCE(st.cantidad, 0)                       AS stock,
                COALESCE(pr.imagen, '/img/producto.png')       AS imagen
    FROM products pr
LEFT JOIN product_stock st
  ON st.product_id = pr.id
 AND st.warehouse_id = ?
WHERE pr.clase = 'PRODUCTO'
  ${whereName ? 'AND pr.nombre LIKE ?' : ''}
ORDER BY pr.nombre ASC
LIMIT 300

      `, params);

      return res.json({
        items: rows.map(r => ({
          id: r.id,
          nombre: r.nombre,
          precio: Number(r.precio || 0),
          stock: Number(r.stock || 0),
          sinStock: Number(r.stock || 0) <= 0,
          imagen: r.imagen
        }))
      });
    } catch (errFast) {
      // 2) Fallback sin tabla de stock (o columnas distintas)
      console.warn('Catálogo: usando fallback sin tabla de stock ->', errFast.message);

      const params = [];
      let whereName = '';
      if (q) { whereName = 'WHERE pr.nombre LIKE ?'; params.push(`%${q}%`); }

      const [rows] = await pool.query(`
        SELECT  pr.id,
                pr.nombre,
                COALESCE(pr.precio_venta, 0)            AS precio,
                0                                        AS stock,
                COALESCE(pr.imagen, '/img/producto.png') AS imagen
          FROM products pr
WHERE pr.clase = 'PRODUCTO'
  ${whereName ? 'AND pr.nombre LIKE ?' : ''}
ORDER BY pr.nombre ASC
LIMIT 300
      `, params);

      return res.json({
        items: rows.map(r => ({
          id: r.id,
          nombre: r.nombre,
          precio: Number(r.precio || 0),
          stock: 0,
          sinStock: true,
          imagen: r.imagen
        }))
      });
    }
  } catch (e) {
    console.error('Catalog error:', e);
    res.json({ items: [] });
  }
});

// Municipios por departamento
router.get('/api/municipios', isAuth, async (req, res) => {
  try {
    const depId = Number(req.query.departamento_id || 0);
    if (!depId) return res.json({ items: [] });
    const [rows] = await pool.query(
      `SELECT id, nombre FROM municipios WHERE departamento_id = ? ORDER BY nombre ASC`,
      [depId]
    );
    res.json({ items: rows });
  } catch (e) {
    res.json({ items: [] });
  }
});

// ============================
// LISTA PRINCIPAL (/pedidos)
// ============================
router.get('/', isAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        p.id,
        COALESCE(p.fecha_pedido, p.created_at) AS fecha_pedido,
        p.total,
        p.estado,
        p.nom_nuevo,
        p.tel_nuevo,
        b.nombre AS bodega_nombre,
        COALESCE(NULLIF(TRIM(p.nom_nuevo), ''), 'Consumidor final') AS cliente_mostrar
      FROM pedidos p
      LEFT JOIN bodegas b ON b.id = p.bodega_id
      ORDER BY p.id DESC
    `);

    res.render('pedidos/index', {
      title: 'Pedidos',
      pedidos: rows
    });
  } catch (e) { next(e); }
});

// ============================
// NUEVO / GUARDAR PEDIDO
// ============================
router.get('/nuevo', isAuth, async (req, res, next) => {
  try {
    const [proveedores] = await pool.query(`SELECT id, nombre FROM proveedores ORDER BY nombre`);
    const [bodegas] = await pool.query(`SELECT id, nombre FROM bodegas ORDER BY nombre`);
    const [departamentos] = await pool.query(`SELECT id, nombre FROM departamentos ORDER BY nombre`);
    res.render('pedidos/shop', {
      title: 'Nuevo pedido (Tienda)',
      proveedores, bodegas, departamentos
    });
  } catch (e) { next(e); }
});

router.post('/', isAuth, upload.single('diseno'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const body = req.body || {};
    const items = JSON.parse(body.items || '[]');

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, message: 'Agrega productos al pedido.' });
    }
    // --- Validar que todos sean PRODUCTO (no INSUMO) ---
    const ids = items.map(it => Number(it.producto_id)).filter(Boolean);
    if (!ids.length) {
      return res.status(400).json({ ok:false, message:'Agrega productos válidos al pedido.' });
    }
    const [clases] = await pool.query(
      `SELECT id, clase FROM products WHERE id IN (?)`,
      [ids]
    );
    const claseById = new Map(clases.map(r => [Number(r.id), r.clase]));
    const invalidos = ids.filter(id => claseById.get(id) !== 'PRODUCTO');

    if (invalidos.length) {
      return res.status(400).json({
        ok:false,
        message:`Hay artículos no vendibles (INSUMO): ${invalidos.join(', ')}.`
      });
    }

    const bodega_id = Number(body.bodega_id || 0);
    const departamento_id = Number(body.departamento_id || 0);
    const municipio_id = Number(body.municipio_id || 0);
    if (!bodega_id || !departamento_id || !municipio_id) {
      return res.status(400).json({ ok: false, message: 'Bodega, departamento y municipio son requeridos.' });
    }

    // === Cliente (solo 2 campos nuevos) ===
    let nom_nuevo = (body.nom_nuevo || body.cliente_nombre || '').toString().trim();
    let tel_nuevo = (body.tel_nuevo || body.cliente_telefono || '').toString().trim();
    if (!nom_nuevo) nom_nuevo = 'Consumidor final';
    nom_nuevo = nom_nuevo.slice(0, 150);
    tel_nuevo = tel_nuevo.slice(0, 20);

    // Fecha NOT NULL: usar NOW() si viene vacío
    let fecha_pedido = (body.fecha_pedido || '').toString().trim();
    const usarNow = !fecha_pedido;

    // Total cabecera
    const total = items.reduce((a, it) => {
      const q = Math.max(1, Number(it.cantidad || 0));
      const p = Math.max(0, Number(it.precio_unitario || 0));
      return a + q * p;
    }, 0);

    // Usuario creador (NOT NULL en tu tabla)
    const userId = (req.session && req.session.user && req.session.user.id) || 1;

    await conn.beginTransaction();

    const disenoRelPath = req.file ? path.posix.join('/uploads/pedidos', path.basename(req.file.path)) : null;

    // Inserta cabecera
    const sqlCab = `
      INSERT INTO pedidos
      (proveedor_id, bodega_id, departamento_id, municipio_id, fecha_pedido, direccion, diseno_path, notas,
       estado, total, usuario_crea_id, nom_nuevo, tel_nuevo, created_at, updated_at)
      VALUES (?,?,?,?, ${usarNow ? 'NOW()' : '?'}, ?, ?, ?, 'PENDIENTE', ?, ?, ?, ?, NOW(), NOW())
    `;
    const paramsCab = [
      body.proveedor_id || null,
      bodega_id,
      departamento_id,
      municipio_id,
    ];
    if (!usarNow) paramsCab.push(fecha_pedido);
    paramsCab.push(
      body.direccion || null,
      disenoRelPath,
      body.notas || null,
      total,
      userId,
      nom_nuevo || null,
      tel_nuevo || null
    );

    const [ins] = await conn.query(sqlCab, paramsCab);
    const pedidoId = ins.insertId;

    // Inserta detalles (intenta en pedidos_detalles; si no existe, en pedidos_det)
    const tryInsertDetalles = async (tableName) => {
      const values = items.map(it => ([
        pedidoId,
        Number(it.producto_id),
        Math.max(1, Number(it.cantidad)),
        Number(it.precio_unitario) || 0,
        (tableName === 'pedidos_detalles') ? (Math.max(1, Number(it.cantidad)) * (Number(it.precio_unitario) || 0)) : null
      ]));
      if (tableName === 'pedidos_detalles') {
        await conn.query(
          `INSERT INTO pedidos_detalles
           (pedido_id, producto_id, cantidad, precio_unitario, subtotal)
           VALUES ?`,
          [values]
        );
      } else {
        await conn.query(
          `INSERT INTO pedidos_det
           (pedido_id, producto_id, cantidad, precio_unitario, creado_en)
           VALUES ${values.map(() => '(?,?,?,?, NOW())').join(',')}`,
          values.flat()
        );
      }
    };

    try {
      await tryInsertDetalles('pedidos_detalles');
    } catch {
      await tryInsertDetalles('pedidos_det');
    }

    await conn.commit();
    return res.json({ ok: true, redirect: `/pedidos/${pedidoId}` });
  } catch (e) {
    try { await conn.rollback(); } catch (_) { }
    console.error('❌ Error en POST /pedidos:', e);
    return res.status(500).json({ ok: false, message: 'Error al guardar el pedido.' });
  } finally {
    conn.release();
  }
});

// ============================
// AUTORIZAR / COMPLETAR
// ============================
router.get('/autorizar/lista', isAuth, async (req, res, next) => {
  try {
    const estados = ['PENDIENTE', 'EN_PROCESO'];
    const [rows] = await pool.query(`
      SELECT
        p.id,
        p.fecha_pedido AS fecha_pedido,
        p.total,
        p.estado,
        p.nom_nuevo,
        p.tel_nuevo,
        b.nombre AS bodega_nombre,
        COALESCE(NULLIF(TRIM(p.nom_nuevo), ''), 'Consumidor final') AS cliente_mostrar
      FROM pedidos p
      LEFT JOIN bodegas  b ON b.id  = p.bodega_id
      WHERE p.estado IN (?,?)
      ORDER BY p.id DESC
    `, estados);
    res.render('pedidos/autorizar_lista', { title: 'Autorizar / completar', items: rows });
  } catch (e) { next(e); }
});

router.get('/autorizar/:id(\\d+)', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const pedido = await getPedidoById(id);
    if (!pedido) { return res.redirect('/pedidos/autorizar/lista'); }

    const detalles = await getDetallesPedido(id);
    const [formasPago] = await pool.query(`SELECT id, nombre FROM formas_pago`).catch(() => [[]]);
    const [condicionesPago] = await pool.query(`SELECT id, nombre FROM condiciones_pago`).catch(() => [[]]);
    const [tiposDocumento] = await pool.query(`SELECT id, nombre FROM tipos_documento`).catch(() => [[]]);

    res.render('pedidos/autorizar_show', {
      title: `Completar pedido #${id}`,
      pedido,
      detalles,
      formasPago, condicionesPago, tiposDocumento,
      totalCalc: detalles.reduce((a, d) => a + Number(d.subtotal || 0), 0),
      errorMsg: null,
      selected: { forma_pago_id: null, condicion_pago_id: null, tipo_documento_id: null }
    });
  } catch (e) { next(e); }
});

router.post('/autorizar/:id(\\d+)/completar', isAuth, async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    const { forma_pago_id, condicion_pago_id, tipo_documento_id } = req.body || {};

    const pedido = await getPedidoById(id);
    if (!pedido) { conn.release(); return res.redirect('/pedidos/autorizar/lista'); }

    const detalles = await getDetallesPedido(id);
    const totalCalc = detalles.reduce((a, d) => a + Number(d.subtotal || 0), 0);

    if (!detalles.length) {
      conn.release();
      const [formasPago] = await pool.query(`SELECT id, nombre FROM formas_pago`).catch(() => [[]]);
      const [condicionesPago] = await pool.query(`SELECT id, nombre FROM condiciones_pago`).catch(() => [[]]);
      const [tiposDocumento] = await pool.query(`SELECT id, nombre FROM tipos_documento`).catch(() => [[]]);
      return res.render('pedidos/autorizar_show', {
        title: `Completar pedido #${id}`,
        pedido, detalles,
        formasPago, condicionesPago, tiposDocumento,
        totalCalc,
        errorMsg: 'El pedido no tiene productos.',
        selected: { forma_pago_id, condicion_pago_id, tipo_documento_id }
      });
    }

    if (pedido.estado === 'COMPLETADO') { conn.release(); return res.redirect('/pedidos/autorizar/lista'); }

    await conn.beginTransaction();

    const bodegaId = Number(pedido.bodega_id);
    const errores = [];

    for (const it of detalles) {
      const productoId = Number(it.producto_id);
      const qty = Number(it.cantidad || 0);

      // Asegura fila y bloquea stock
      await conn.query(`
        INSERT INTO \`${STOCK_TABLE}\` (\`${COL_PROD}\`, \`${COL_BODEGA}\`, \`${COL_STOCK}\`)
        VALUES (?,?,0)
        ON DUPLICATE KEY UPDATE \`${COL_STOCK}\` = \`${COL_STOCK}\`
      `, [productoId, bodegaId]);

      const [[stk]] = await conn.query(`
        SELECT \`${COL_STOCK}\` AS stock
          FROM \`${STOCK_TABLE}\`
         WHERE \`${COL_PROD}\`=? AND \`${COL_BODEGA}\`=?
         FOR UPDATE
      `, [productoId, bodegaId]);

      const disponible = Number(stk?.stock || 0);
      if (disponible < qty) {
        errores.push(`Stock insuficiente del producto #${productoId} en bodega #${bodegaId}. Disponible: ${disponible}, requerido: ${qty}.`);
        continue;
      }

      await conn.query(`
        UPDATE \`${STOCK_TABLE}\`
           SET \`${COL_STOCK}\` = \`${COL_STOCK}\` - ?
         WHERE \`${COL_PROD}\`=? AND \`${COL_BODEGA}\`=?
      `, [qty, productoId, bodegaId]);
    }

    if (errores.length) {
      await conn.rollback();
      conn.release();

      const [formasPago] = await pool.query(`SELECT id, nombre FROM formas_pago`).catch(() => [[]]);
      const [condicionesPago] = await pool.query(`SELECT id, nombre FROM condiciones_pago`).catch(() => [[]]);
      const [tiposDocumento] = await pool.query(`SELECT id, nombre FROM tipos_documento`).catch(() => [[]]);

      return res.render('pedidos/autorizar_show', {
        title: `Completar pedido #${id}`,
        pedido, detalles,
        formasPago, condicionesPago, tiposDocumento,
        totalCalc,
        errorMsg: errores.join(' '),
        selected: { forma_pago_id, condicion_pago_id, tipo_documento_id }
      });
    }

    await conn.query(`
      UPDATE pedidos
         SET estado = 'COMPLETADO',
             completed_at = NOW(),
             forma_pago_id = ?,
             condicion_pago_id = ?,
             tipo_documento_id = ?
       WHERE id = ?
       LIMIT 1
    `, [forma_pago_id || null, condicion_pago_id || null, tipo_documento_id || null, id]);

    // Registro de cierre (si existe)
    await conn.query(`
      INSERT INTO pedidos_cierres
      (pedido_id, numero_documento, forma_pago_id, condicion_pago_id, tipo_documento_id, archivo_path, creado_por_id, creado_en)
      VALUES (?, NULL, ?, ?, ?, NULL, ?, NOW())
    `, [id, forma_pago_id || null, condicion_pago_id || null, tipo_documento_id || null, (req.user?.id || null)])
      .catch(() => { });

    await conn.commit();
    conn.release();

    return res.redirect('/pedidos/autorizar/lista');
  } catch (e) {
    try { await conn.rollback(); } catch (_) { }
    conn.release();
    next(e);
  }
});

// ============================
// SHOW y Recibos
// ============================
router.get('/:id(\\d+)', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const pedido = await getPedidoById(id);
    if (!pedido) { return res.redirect('/pedidos'); }
    const detalles = await getDetallesPedido(id);
    res.render('pedidos/show', {
      title: `Pedido #${id}`,
      pedido,
      detalles,
      totalCalc: detalles.reduce((a, d) => a + Number(d.subtotal || 0), 0)
    });
  } catch (e) { next(e); }
});

router.get('/:id(\\d+)/recibo', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const pedido = await getPedidoById(id);
    if (!pedido) return res.redirect('/pedidos');
    const detalles = await getDetallesPedido(id);
    res.render('pedidos/recibo', { title: `Recibo de Pedido #${id}`, pedido, detalles });
  } catch (e) { next(e); }
});

router.get('/:id(\\d+)/recibo.pdf', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const pedido = await getPedidoById(id);
    if (!pedido) { return res.redirect('/pedidos'); }
    const detalles = await getDetallesPedido(id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="recibo_pedido_${id}.pdf"`);

    const doc = new PDFDocument({ size: 'LETTER', margin: 36 });
    doc.pipe(res);

    const logoCandidates = [
      path.resolve(process.cwd(), 'public', 'img', 'logo.png'),
      path.resolve(process.cwd(), 'Repositorios', 'sublirex', 'public', 'img', 'logo.png'),
    ];
    const logoPath = logoCandidates.find(p => fs.existsSync(p));
    if (logoPath) doc.image(logoPath, 36, 36, { width: 100 });

    doc.fontSize(18).text(`Recibo de Pedido #${id}`, 160, 40).moveDown(2);

    const fechaStr = (pedido.fecha_pedido ? new Date(pedido.fecha_pedido) : new Date())
      .toLocaleString('es-GT', { hour12: true });

    doc.fontSize(10);
    doc.text(`Cliente: ${pedido.cliente_mostrar}`);
    if (pedido.tel_nuevo) doc.text(`Teléfono: ${pedido.tel_nuevo}`);
    doc.text(`Bodega: ${pedido.bodega_nombre || '-'}`);
    doc.text(`Estado: ${pedido.estado || '-'}`);
    doc.text(`Fecha/Hora: ${fechaStr}`);
    doc.text(`Departamento: ${pedido.departamento_nombre || '-'}`);
    doc.text(`Municipio: ${pedido.municipio_nombre || '-'}`);
    if (pedido.direccion_envio) doc.text(`Dirección: ${pedido.direccion_envio}`);
    if (pedido.notas) doc.text(`Notas: ${pedido.notas}`);
    doc.moveDown(1.5);

    // Tabla
    doc.fontSize(11).text('Detalles del Pedido', { underline: true }).moveDown(0.5);
    const x0 = 36, widths = [250, 80, 80, 80];
    doc.fontSize(10).text('Producto', x0, doc.y, { width: widths[0] });
    doc.text('Cantidad', x0 + widths[0], doc.y, { width: widths[1], align: 'right' });
    doc.text('Precio', x0 + widths[0] + widths[1], doc.y, { width: widths[2], align: 'right' });
    doc.text('Subtotal', x0 + widths[0] + widths[1] + widths[2], doc.y, { width: widths[3], align: 'right' });
    doc.moveDown(0.3);
    doc.moveTo(x0, doc.y).lineTo(576 - 36, doc.y).strokeColor('#ccc').stroke().moveDown(0.3);

    let total = 0;
    for (const d of detalles) {
      const nombre = d.producto_nombre || `#${d.producto_id}`;
      const qty = Number(d.cantidad || 0);
      const pu = Number(d.precio_unitario || 0);
      const sub = Number(d.subtotal || qty * pu);
      total += sub;

      const y = doc.y;
      doc.fillColor('#000');
      doc.text(nombre, x0, y, { width: widths[0] });
      doc.text(qty.toString(), x0 + widths[0], y, { width: widths[1], align: 'right' });
      doc.text(formatMoney(pu), x0 + widths[0] + widths[1], y, { width: widths[2], align: 'right' });
      doc.text(formatMoney(sub), x0 + widths[0] + widths[1] + widths[2], y, { width: widths[3], align: 'right' });
      doc.moveDown(0.2);
    }

    doc.moveDown(0.5);
    doc.moveTo(x0, doc.y).lineTo(576 - 36, doc.y).strokeColor('#ccc').stroke().moveDown(0.3);
    doc.fontSize(12).text('Total', x0 + widths[0] + widths[1], doc.y, { width: widths[2], align: 'right' });
    doc.fontSize(12).text(formatMoney(total || pedido.total || 0), x0 + widths[0] + widths[1] + widths[2], doc.y, { width: widths[3], align: 'right' });

    doc.end();
  } catch (e) { next(e); }
});

// ============================
// === VISOR/RESOLVER DISEÑO ===
// ============================
async function resolveDesignPublicUrlOrBestAbs(id) {
  // 1) BD (diseno_path)
  const [[row]] = await pool.query(
    `SELECT diseno_path FROM pedidos WHERE id = ? LIMIT 1`,
    [id]
  );
  const disenoPath = row?.diseno_path ? String(row.diseno_path).trim() : '';
  if (disenoPath && disenoPath.startsWith('/uploads/')) {
    return { publicUrl: disenoPath, absPath: null };
  }

  // 2) Búsqueda recursiva por nombre con ID en /uploads/pedidos y /uploads/disenos
  const bases = [
    path.join(process.cwd(), 'public', 'uploads', 'pedidos'),
    path.join(process.cwd(), 'public', 'uploads', 'disenos'), // opcional/fallback
  ];
  const EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ai', '.psd', '.tif', '.tiff'];
  const idRe = new RegExp(`(^|\\D)0*${id}(\\D|$)`, 'i');

  async function walk(dir, maxDepth = 4, depth = 0) {
    const out = [];
    let ents = [];
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of ents) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory() && depth < maxDepth) {
        out.push(...await walk(abs, maxDepth, depth + 1));
      } else if (e.isFile()) {
        out.push(abs);
      }
    }
    return out;
  }

  let matches = [];
  for (const base of bases) {
    let files = [];
    try { files = await walk(base, 5); } catch { }
    for (const abs of files) {
      const lower = abs.toLowerCase();
      if (!EXT.some(ext => lower.endsWith(ext))) continue;
      const fname = path.basename(lower);
      if (idRe.test(fname)) matches.push(abs);
    }
    if (matches.length) break;
  }

  if (!matches.length) return { publicUrl: null, absPath: null };

  const stats = await Promise.all(matches.map(async p => ({ p, s: await fsp.stat(p) })));
  stats.sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);
  const bestAbs = stats[0].p;

  // Derivar URL pública desde "/uploads/..."
  const marker = `${path.sep}uploads${path.sep}`;
  const idx = bestAbs.toLowerCase().lastIndexOf(marker);
  if (idx >= 0) {
    const publicUrl = bestAbs.substring(idx).replaceAll(path.sep, '/');
    return { publicUrl, absPath: bestAbs };
  }
  return { publicUrl: null, absPath: bestAbs };
}

// Abrir archivo (redirige a /uploads/..., útil para imágenes y PDF)
router.get('/:id(\\d+)/diseno', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID inválido');

    const { publicUrl, absPath } = await resolveDesignPublicUrlOrBestAbs(id);
    if (publicUrl) return res.redirect(publicUrl);
    if (absPath) return res.sendFile(absPath); // fallback
    return res.status(404).send(`No se encontró un diseño para el pedido #${id}.`);
  } catch (e) { next(e); }
});

// Visor HTML en <iframe> (no descarga)
router.get('/:id(\\d+)/diseno/visor', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID inválido');

    const { publicUrl, absPath } = await resolveDesignPublicUrlOrBestAbs(id);
    if (!publicUrl && !absPath) {
      return res.status(404).send(`No se encontró un diseño para el pedido #${id}.`);
    }
    const fileUrl = publicUrl || `/pedidos/${id}/diseno/raw`;
    return res.render('pedidos/diseno_visor', {
      title: `Diseño del pedido #${id}`,
      pedidoId: id,
      fileUrl
    });
  } catch (e) { next(e); }
});

// Entrega el archivo con Content-Disposition: inline (forzar render en navegador)
router.get('/:id(\\d+)/diseno/raw', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('ID inválido');

    const { publicUrl, absPath } = await resolveDesignPublicUrlOrBestAbs(id);
    // Resolver path absoluto si vino como URL pública
    let fileAbs = absPath;
    if (!fileAbs && publicUrl) {
      fileAbs = path.join(process.cwd(), 'public', publicUrl.replace(/^\/+/, '')); // /uploads/... -> abs
    }
    if (!fileAbs) return res.status(404).send('Archivo no encontrado.');

    res.setHeader('Content-Disposition', 'inline');
    return res.sendFile(fileAbs);
  } catch (e) { next(e); }
});

module.exports = router;
