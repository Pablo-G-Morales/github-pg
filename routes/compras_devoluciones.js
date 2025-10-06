// routes/compras_devoluciones.js
const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

/* ===== Middlewares ===== */
function isAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}
function isAdmin(req, res, next) {
  if (req.session?.user?.rol_id === 1) return next();
  return res.status(403).send('Solo administrador');
}

/* ===== Helpers inventario (descuento) ===== */
function agruparPorProducto(items) {
  const m = new Map();
  for (const it of (items || [])) {
    const pid  = Number(it.producto_id || it.item_id);
    const cant = Number(it.cantidad || 0);
    if (!pid || !cant) continue;
    m.set(pid, (m.get(pid) || 0) + cant);
  }
  return [...m.entries()].map(([product_id, cantidad]) => ({ product_id, cantidad }));
}

async function aplicarDescuentoStock(conn, { warehouse_id, supplier_id, items }) {
  const consol = agruparPorProducto(items);
  for (const { product_id, cantidad } of consol) {
    const delta = -1 * Number(cantidad); // DESCUENTO

    // 1) stock por bodega
    await conn.query(`
      INSERT INTO product_stock (product_id, warehouse_id, cantidad)
      VALUES (?,?,?)
      ON DUPLICATE KEY UPDATE cantidad = cantidad + VALUES(cantidad)
    `, [product_id, warehouse_id, delta]);

    // 2) inventario por proveedor + bodega
    await conn.query(`
      INSERT INTO product_inventario (product_id, warehouse_id, supplier_id, cantidad, updated_at)
      VALUES (?,?,?,?, NOW())
      ON DUPLICATE KEY UPDATE
        cantidad   = cantidad + VALUES(cantidad),
        updated_at = NOW()
    `, [product_id, warehouse_id, supplier_id, delta]);
  }
}

/* =======================================================
   LISTA de devoluciones
   GET /compras-v4/devoluciones
======================================================= */
router.get('/devoluciones', isAuth, isAdmin, async (_req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        cd.id, cd.compra_id, cd.creado_en,
        u.nombre AS creado_por_nombre,
        c.fecha_compra, c.total,
        p.nombre AS proveedor_nombre,
        b.nombre AS bodega_nombre
      FROM compras_devoluciones cd
      LEFT JOIN compras     c ON c.id = cd.compra_id
      LEFT JOIN usuarios    u ON u.id = cd.creado_por_id
      LEFT JOIN proveedores p ON p.id = c.proveedor_id
      LEFT JOIN bodegas     b ON b.id = c.bodega_id
      ORDER BY cd.id DESC
    `);

    res.render('V4compras/devolucion_list', {
      title: 'Devoluciones de Compras',
      items: rows
    });
  } catch (e) { next(e); }
});

/* =======================================================
   PICKER: elegir compra COMPLETADA
   GET /compras-v4/devoluciones/nueva
======================================================= */
router.get('/devoluciones/nueva', isAuth, isAdmin, async (_req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.id, c.fecha_compra, c.total,
             p.nombre AS proveedor_nombre,
             b.nombre AS bodega_nombre
      FROM compras c
      LEFT JOIN proveedores p ON p.id = c.proveedor_id
      LEFT JOIN bodegas     b ON b.id = c.bodega_id
      WHERE c.estado='COMPLETADO'
      ORDER BY c.id DESC
    `);

    res.render('V4compras/devolucion_pick', {
      title: 'Elegir compra (COMPLETADO) para devolución',
      compras: rows
    });
  } catch (e) { next(e); }
});

/* =======================================================
   FORM NUEVA DEVOLUCIÓN (desde compra COMPLETADA)
   GET /compras-v4/devoluciones/nueva/:compraId
======================================================= */
router.get('/devoluciones/nueva/:compraId(\\d+)', isAuth, isAdmin, async (req, res, next) => {
  try {
    const compraId = Number(req.params.compraId);

    // Cabecera de la compra
    const [[compra]] = await pool.query(`
      SELECT c.*, p.nombre AS proveedor_nombre, b.nombre AS bodega_nombre
      FROM compras c
      LEFT JOIN proveedores p ON p.id = c.proveedor_id
      LEFT JOIN bodegas     b ON b.id = c.bodega_id
      WHERE c.id=?`, [compraId]);

    if (!compra) return res.redirect('/compras-v4/autorizar');
    if (compra.estado !== 'COMPLETADO') {
      return res.status(400).send('Solo se permiten devoluciones de compras COMPLETADAS.');
    }

    // Detalle de compra (solo PRODUCTO)
    const [detCompra] = await pool.query(`
      SELECT d.producto_id, pr.nombre AS producto_nombre,
             d.cantidad AS cantidad_comprada,
             d.precio_unitario
      FROM compras_detalles d
      LEFT JOIN products pr ON pr.id = d.producto_id
      WHERE d.compra_id=? AND d.producto_id IS NOT NULL
      ORDER BY d.id ASC
    `, [compraId]);

    // Cantidades ya devueltas por producto en esta compra
    const [devPrev] = await pool.query(`
      SELECT cdd.producto_id, SUM(cdd.cantidad) AS devuelto
      FROM compras_devoluciones cd
      JOIN compras_devoluciones_det cdd ON cdd.devolucion_id = cd.id
      WHERE cd.compra_id=?
      GROUP BY cdd.producto_id
    `, [compraId]);

    const devMap = new Map(devPrev.map(r => [Number(r.producto_id), Number(r.devuelto || 0)]));

    // Calcula saldo disponible a devolver por producto
    const items = detCompra.map(r => {
      const dev   = devMap.get(Number(r.producto_id)) || 0;
      const saldo = Math.max(0, Number(r.cantidad_comprada) - dev);
      return { ...r, devuelto: dev, saldo_devolucion: saldo };
    }).filter(x => x.saldo_devolucion > 0);

    return res.render('V4compras/devolucion_form', {
      title: `Devolución compra #${compraId}`,
      compra,
      items
    });
  } catch (e) { next(e); }
});

/* =======================================================
   GUARDAR DEVOLUCIÓN
   POST /compras-v4/devoluciones/:compraId
   Body: { notas, items:[{ producto_id, cantidad, motivo }] }
======================================================= */
router.post('/devoluciones/:compraId(\\d+)', isAuth, isAdmin, async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const compraId = Number(req.params.compraId);
    const uid   = req.session.user.id;
    const notas = (req.body.notas || null);

    // Valida compra COMPLETADA
    const [[compra]] = await conn.query(`SELECT * FROM compras WHERE id=? FOR UPDATE`, [compraId]);
    if (!compra) { await conn.rollback(); return res.status(404).send('Compra no encontrada'); }
    if (compra.estado !== 'COMPLETADO') {
      await conn.rollback();
      return res.status(400).send('Solo se permiten devoluciones de compras COMPLETADAS.');
    }

    // Detalle de compra (cant comprada)
    const [detCompra] = await conn.query(`
      SELECT d.producto_id, d.cantidad AS cantidad_comprada
      FROM compras_detalles d
      WHERE d.compra_id=? AND d.producto_id IS NOT NULL
    `, [compraId]);
    const compMap = new Map(detCompra.map(r => [Number(r.producto_id), Number(r.cantidad_comprada)]));

    // Devuelto previamente
    const [devPrev] = await conn.query(`
      SELECT cdd.producto_id, SUM(cdd.cantidad) AS devuelto
      FROM compras_devoluciones cd
      JOIN compras_devoluciones_det cdd ON cdd.devolucion_id = cd.id
      WHERE cd.compra_id=?
      GROUP BY cdd.producto_id
    `, [compraId]);
    const devMap = new Map(devPrev.map(r => [Number(r.producto_id), Number(r.devuelto || 0)]));

    // Items del request
    const itemsRaw = req.body.items || [];
    const items = Array.isArray(itemsRaw) ? itemsRaw : Object.values(itemsRaw);

    // Normaliza y valida cantidades
    const itemsValidos = [];
    for (const it of items) {
      const producto_id = Number(it.producto_id);
      const cantidad    = Number(it.cantidad || 0);
      const motivo      = (it.motivo || null);
      if (!producto_id || !cantidad) continue;

      const comprado = compMap.get(producto_id) || 0;
      const yaDev    = devMap.get(producto_id) || 0;
      const saldo    = Math.max(0, comprado - yaDev);
      if (cantidad <= 0 || cantidad > saldo) {
        await conn.rollback();
        return res.status(400).send(`Cantidad inválida para producto ${producto_id}. Máximo permitido: ${saldo}`);
      }
      itemsValidos.push({ producto_id, cantidad, motivo });
    }

    if (!itemsValidos.length) {
      await conn.rollback();
      return res.status(400).send('No hay líneas válidas para devolver.');
    }

    // Crea cabecera
    const [rCab] = await conn.query(`
      INSERT INTO compras_devoluciones (compra_id, notas, creado_por_id, creado_en)
      VALUES (?,?,?, NOW())
    `, [compraId, notas, uid]);
    const devolucionId = rCab.insertId;

    // Inserta detalle
    for (const it of itemsValidos) {
      await conn.query(`
        INSERT INTO compras_devoluciones_det (devolucion_id, producto_id, cantidad, motivo, creado_en)
        VALUES (?,?,?,?, NOW())
      `, [devolucionId, it.producto_id, it.cantidad, it.motivo]);
    }

    // Descuenta inventario SOLO de seleccionados
    await aplicarDescuentoStock(conn, {
      warehouse_id: Number(compra.bodega_id),
      supplier_id : Number(compra.proveedor_id),
      items: itemsValidos
    });

    await conn.commit();
    return res.redirect(`/compras-v4/devoluciones/${devolucionId}`);
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});

/* =======================================================
   VER DEVOLUCIÓN
   GET /compras-v4/devoluciones/:id
======================================================= */
router.get('/devoluciones/:id(\\d+)', isAuth, isAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const [[cab]] = await pool.query(`
      SELECT cd.*, u.nombre AS creado_por_nombre,
             c.proveedor_id, c.bodega_id, c.fecha_compra, c.total, c.id AS compra_id,
             p.nombre AS proveedor_nombre, b.nombre AS bodega_nombre
      FROM compras_devoluciones cd
      LEFT JOIN usuarios    u ON u.id = cd.creado_por_id
      LEFT JOIN compras     c ON c.id = cd.compra_id
      LEFT JOIN proveedores p ON p.id = c.proveedor_id
      LEFT JOIN bodegas     b ON b.id = c.bodega_id
      WHERE cd.id=?`, [id]);

    if (!cab) return res.redirect('/compras-v4/devoluciones');

    const [det] = await pool.query(`
      SELECT cdd.*, pr.nombre AS producto_nombre
      FROM compras_devoluciones_det cdd
      LEFT JOIN products pr ON pr.id = cdd.producto_id
      WHERE cdd.devolucion_id=?
      ORDER BY cdd.id ASC
    `, [id]);

    return res.render('V4compras/devolucion_show', {
      title: `Devolución #${id}`,
      devolucion: cab,
      detalles: det
    });
  } catch (e) { next(e); }
});

module.exports = router;
