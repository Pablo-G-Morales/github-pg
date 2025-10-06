// routes/compras_facturas.js
const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

/* ====== Middlewares ====== */
function isAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}
function isAdmin(req, res, next) {
  if (req.session?.user?.rol_id === 1) return next();
  return res.status(403).send('Solo administrador');
}

/* =========================
   LISTADO HISTÓRICO (admin)
   GET /compras-v4/facturas
========================= */
router.get('/facturas', isAuth, isAdmin, async (_req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        cf.id, cf.compra_id, cf.numero_factura, cf.archivo_path,
        cf.creado_en, u.nombre AS creado_por_nombre,
        c.total, c.fecha_compra,
        p.nombre AS proveedor_nombre,
        b.nombre AS bodega_nombre,
        fp.nombre AS forma_pago_nombre,
        cp.nombre AS condicion_pago_nombre,
        td.nombre AS tipo_documento_nombre
      FROM compras_facturas cf
      LEFT JOIN compras c              ON c.id = cf.compra_id
      LEFT JOIN proveedores p          ON p.id = c.proveedor_id
      LEFT JOIN bodegas b              ON b.id = c.bodega_id
      LEFT JOIN usuarios u             ON u.id = cf.creado_por_id
      LEFT JOIN formas_pago fp         ON fp.id = cf.forma_pago_id
      LEFT JOIN condiciones_pago cp    ON cp.id = cf.condicion_pago_id
      LEFT JOIN tipos_documento td     ON td.id = cf.tipo_documento_id
      ORDER BY cf.id DESC
    `);

    res.render('V4compras/facturas_list', {
      title: 'Facturas registradas',
      items: rows
    });
  } catch (e) { next(e); }
});

/* =========================
   FICHA FACTURA (admin)
   GET /compras-v4/facturas/:id
========================= */
router.get('/facturas/:id(\\d+)', isAuth, isAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const [[factura]] = await pool.query(`
      SELECT
        cf.*,
        u.nombre AS creado_por_nombre,
        c.total, c.fecha_compra, c.estado,
        p.nombre AS proveedor_nombre,
        b.nombre AS bodega_nombre,
        fp.nombre AS forma_pago_nombre,
        cp.nombre AS condicion_pago_nombre,
        td.nombre AS tipo_documento_nombre
      FROM compras_facturas cf
      LEFT JOIN compras c              ON c.id = cf.compra_id
      LEFT JOIN proveedores p          ON p.id = c.proveedor_id
      LEFT JOIN bodegas b              ON b.id = c.bodega_id
      LEFT JOIN usuarios u             ON u.id = cf.creado_por_id
      LEFT JOIN formas_pago fp         ON fp.id = cf.forma_pago_id
      LEFT JOIN condiciones_pago cp    ON cp.id = cf.condicion_pago_id
      LEFT JOIN tipos_documento td     ON td.id = cf.tipo_documento_id
      WHERE cf.id=?
    `, [id]);

    if (!factura) return res.redirect('/compras-v4/facturas');

    // Detalle de productos de la compra asociada
    const [detalles] = await pool.query(`
      SELECT d.cantidad, d.precio_unitario,
             pr.nombre AS producto_nombre
      FROM compras_detalles d
      LEFT JOIN products pr ON pr.id = d.producto_id
      WHERE d.compra_id=?
      ORDER BY d.id ASC
    `, [factura.compra_id]);

    res.render('V4compras/factura_show', {
      title: `Factura #${factura.id}`,
      factura,
      detalles
    });
  } catch (e) { next(e); }
});

module.exports = router;
