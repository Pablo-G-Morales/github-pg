// routes/pedidos_autorizar.js
const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');

/* ===== Middlewares ===== */
function isAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}
function isAdmin(req, res, next) {
  if (req.session?.user?.rol_id === 1) return next();
  return res.status(403).send('Solo administrador');
}

/* ===== Multer uploads: /public/uploads/pedidos ===== */
const upDir = path.join(__dirname, '..', 'public', 'uploads', 'pedidos');
fs.mkdirSync(upDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _f, cb) => cb(null, upDir),
  filename   : (_req, f, cb) => {
    const ts = Date.now();
    const safe = (f.originalname||'archivo').replace(/[^\w.\-]+/g,'_');
    cb(null, `${ts}_${safe}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => {
    const ok = /pdf|png|jpe?g|webp/i.test(f.mimetype);
    cb(ok ? null : new Error('Formato no permitido (solo PDF/JPG/PNG/WebP)'), ok);
  }
});

/* ===== Helpers ===== */
async function getPedidoCab(conn, id) {
  const [[row]] = await conn.query(`
    SELECT pd.*,
           pr.nombre AS proveedor_nombre,
           b.nombre  AS bodega_nombre,
           d.nombre  AS departamento_nombre,
           m.nombre  AS municipio_nombre
      FROM pedidos pd
 LEFT JOIN proveedores pr ON pr.id = pd.proveedor_id
 LEFT JOIN bodegas     b  ON b.id  = pd.bodega_id
 LEFT JOIN departamentos d ON d.id = pd.departamento_id
 LEFT JOIN municipios   m  ON m.id = pd.municipio_id
     WHERE pd.id = ?
  `, [id]);
  return row || null;
}

/* =======================================================
   LISTADO de pedidos por autorizar/completar
   GET /pedidos/autorizar
   Muestra pedidos con estado PENDIENTE o EN_PROCESO
======================================================= */
router.get('/autorizar', isAuth, isAdmin, async (_req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT pd.id, pd.fecha_pedido, pd.total, pd.estado,
             pr.nombre AS proveedor_nombre,
             b.nombre  AS bodega_nombre
        FROM pedidos pd
   LEFT JOIN proveedores pr ON pr.id = pd.proveedor_id
   LEFT JOIN bodegas     b  ON b.id  = pd.bodega_id
       WHERE pd.estado IN ('PENDIENTE','EN_PROCESO')
       ORDER BY pd.id DESC
    `);
    res.render('pedidos/autorizar_list', {
      title: 'Autorizar / Completar pedidos',
      pedidos: rows
    });
  } catch (e) { next(e); }
});

/* =======================================================
   FORM completar pedido
   GET /pedidos/autorizar/:id
======================================================= */
router.get('/autorizar/:id(\\d+)', isAuth, isAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[pedido]] = await pool.query(`SELECT * FROM pedidos WHERE id=?`, [id]);
    if (!pedido) return res.redirect('/pedidos/autorizar');
    if (pedido.estado === 'COMPLETADO' || pedido.estado === 'ANULADO') {
      return res.redirect(`/pedidos/${id}`);
    }

    const [detalles] = await pool.query(`
      SELECT dd.*, p.nombre AS producto_nombre
        FROM pedidos_det dd
   LEFT JOIN products p ON p.id = dd.producto_id
       WHERE dd.pedido_id = ?
       ORDER BY dd.id ASC
    `, [id]);

    // catálogos (opcionales)
    const [formas]      = await pool.query(`SELECT id, nombre FROM formas_pago ORDER BY nombre`);
    const [condiciones] = await pool.query(`SELECT id, nombre FROM condiciones_pago ORDER BY nombre`);
    const [tiposDoc]    = await pool.query(`SELECT id, nombre FROM tipos_documento ORDER BY nombre`);

    res.render('pedidos/autorizar_form', {
      title: `Completar pedido #${id}`,
      pedido,
      detalles,
      formas, condiciones, tiposDoc
    });
  } catch (e) { next(e); }
});

/* =======================================================
   POST completar pedido (descuenta stock y cierra)
   POST /pedidos/autorizar/:id
======================================================= */
router.post('/autorizar/:id(\\d+)', isAuth, isAdmin, upload.single('archivo'), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const id  = Number(req.params.id);
    const uid = req.session.user.id;

    const [[pedido]] = await conn.query(`SELECT * FROM pedidos WHERE id=? FOR UPDATE`, [id]);
    if (!pedido) {
      await conn.rollback(); return res.status(404).send('Pedido no encontrado');
    }
    if (pedido.estado === 'COMPLETADO' || pedido.estado === 'ANULADO') {
      await conn.rollback(); return res.redirect(`/pedidos/${id}`);
    }

    const [items] = await conn.query(`
      SELECT producto_id, cantidad
        FROM pedidos_det
       WHERE pedido_id = ?
    `, [id]);

    // Verificación de stock en bodega al momento de completar
    for (const it of items) {
      const pid  = Number(it.producto_id);
      const cant = Math.floor(Number(it.cantidad||0));
      if (!pid || cant<=0) continue;

      const [[stk]] = await conn.query(`
        SELECT COALESCE(cantidad,0) AS stock
          FROM product_stock
         WHERE product_id=? AND warehouse_id=? FOR UPDATE
      `, [pid, Number(pedido.bodega_id)]);

      const stockActual = Number(stk?.stock || 0);
      if (stockActual < cant) {
        await conn.rollback();
        return res.status(400).send(`Stock insuficiente para producto ${pid}. Disponible: ${stockActual}, requerido: ${cant}`);
      }
    }

    // Descuento de stock
    for (const it of items) {
      const pid  = Number(it.producto_id);
      const cant = Math.floor(Number(it.cantidad||0));
      if (!pid || cant<=0) continue;

      await conn.query(`
        INSERT INTO product_stock (product_id, warehouse_id, cantidad)
        VALUES (?,?,?)
        ON DUPLICATE KEY UPDATE cantidad = GREATEST(0, cantidad - VALUES(cantidad))
      `, [pid, Number(pedido.bodega_id), cant]);
    }

    // Registrar cierre
    const { numero_documento, forma_pago_id, condicion_pago_id, tipo_documento_id } = req.body;
    const archivoRel = req.file
      ? path.join('/uploads/pedidos', req.file.filename).replace(/\\/g,'/')
      : null;

    await conn.query(`
      INSERT INTO pedidos_cierres
        (pedido_id, numero_documento, forma_pago_id, condicion_pago_id, tipo_documento_id, archivo_path, creado_por_id, creado_en)
      VALUES (?,?,?,?,?,?,?, NOW())
    `, [
      id,
      (numero_documento || null),
      (forma_pago_id ? Number(forma_pago_id) : null),
      (condicion_pago_id ? Number(condicion_pago_id) : null),
      (tipo_documento_id ? Number(tipo_documento_id) : null),
      archivoRel,
      uid
    ]);

    // Cambiar estado a COMPLETADO
    await conn.query(
      `UPDATE pedidos SET estado='COMPLETADO', actualizado_en=NOW() WHERE id=?`,
      [id]
    );

    await conn.commit();
    res.redirect(`/pedidos/${id}`);
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});

/* =======================================================
   LISTA de cierres
   GET /pedidos/cierres
======================================================= */
router.get('/cierres', isAuth, isAdmin, async (_req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT pc.id, pc.pedido_id, pc.numero_documento, pc.archivo_path, pc.creado_en,
             pd.total, pd.fecha_pedido,
             b.nombre  AS bodega_nombre,
             pr.nombre AS proveedor_nombre
        FROM pedidos_cierres pc
   LEFT JOIN pedidos pd ON pd.id = pc.pedido_id
   LEFT JOIN bodegas b  ON b.id  = pd.bodega_id
   LEFT JOIN proveedores pr ON pr.id = pd.proveedor_id
       ORDER BY pc.id DESC
    `);
    res.render('pedidos/cierres_list', {
      title: 'Pedidos completados',
      items: rows
    });
  } catch (e) { next(e); }
});

/* =======================================================
   Ficha de cierre
   GET /pedidos/cierres/:id
======================================================= */
router.get('/cierres/:id(\\d+)', isAuth, isAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const [[cab]] = await pool.query(`
      SELECT pc.*, pd.total, pd.fecha_pedido, pd.id AS pedido_id,
             b.nombre  AS bodega_nombre,
             pr.nombre AS proveedor_nombre
        FROM pedidos_cierres pc
   LEFT JOIN pedidos pd ON pd.id = pc.pedido_id
   LEFT JOIN bodegas b  ON b.id  = pd.bodega_id
   LEFT JOIN proveedores pr ON pr.id = pd.proveedor_id
       WHERE pc.id=?
    `, [id]);

    if (!cab) return res.redirect('/pedidos/cierres');

    const [det] = await pool.query(`
      SELECT dd.*, p.nombre AS producto_nombre
        FROM pedidos_det dd
   LEFT JOIN products p ON p.id = dd.producto_id
       WHERE dd.pedido_id = ?
       ORDER BY dd.id ASC
    `, [cab.pedido_id]);

    res.render('pedidos/cierre_show', {
      title: `Cierre de pedido #${cab.pedido_id}`,
      cierre: cab,
      detalles: det
    });
  } catch (e) { next(e); }
});

module.exports = router;
