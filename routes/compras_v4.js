// routes/compras_v4.js
const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

/* ============ Auth ============ */
function isAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}
function isAdmin(req, res, next) {
  if (req.session?.user?.rol_id === 1) return next();
  return res.status(403).send('Solo administrador');
}

/* ============ Helpers ============ */
const toDate = v => (v && !isNaN(new Date(v))) ? new Date(v) : new Date();

// (Se mantienen por si los necesitas luego; aquí ya NO se usan en aprobar)
function agruparPorProducto(items) {
  const map = new Map();
  for (const it of (items || [])) {
    if (it.clase !== 'PRODUCTO') continue;
    const pid  = Number(it.item_id);
    const cant = Number(it.cantidad || 0);
    if (!pid || !cant) continue;
    map.set(pid, (map.get(pid)||0) + cant);
  }
  return [...map.entries()].map(([product_id, cantidad]) => ({ product_id, cantidad }));
}
async function aplicarStock(conn, { warehouse_id, supplier_id, items, signo }) {
  const consol = agruparPorProducto(items);
  for (const { product_id, cantidad } of consol) {
    const delta = signo * cantidad;

    // 1) stock por bodega
    await conn.query(`
      INSERT INTO product_stock (product_id, warehouse_id, cantidad)
      VALUES (?,?,?)
      ON DUPLICATE KEY UPDATE cantidad = cantidad + VALUES(cantidad)
    `, [product_id, warehouse_id, delta]);

    // 2) inventario por proveedor + bodega (guarda último precio visto)
    const linea = items.find(x => Number(x.item_id) === product_id && x.clase==='PRODUCTO') || {};
    const precioCompra = (linea.precio_unitario != null && linea.precio_unitario !== '') ? Number(linea.precio_unitario) : null;

    await conn.query(`
      INSERT INTO product_inventario (product_id, warehouse_id, supplier_id, cantidad, precio_compra, updated_at)
      VALUES (?,?,?,?,?, NOW())
      ON DUPLICATE KEY UPDATE
        cantidad      = cantidad + VALUES(cantidad),
        precio_compra = COALESCE(VALUES(precio_compra), precio_compra),
        updated_at    = NOW()
    `, [product_id, warehouse_id, supplier_id, delta, precioCompra]);
  }
}

/* =======================================================
   UI principal (estilo tienda)
======================================================= */
router.get('/', isAuth, async (req, res, next) => {
  try {
    const [proveedores] = await pool.query('SELECT id,nombre FROM proveedores ORDER BY nombre');
    const [bodegas]     = await pool.query('SELECT id,nombre FROM bodegas ORDER BY nombre');
    res.render('V4compras/shop', {
      title: 'Nueva compra (Tienda)',
      proveedores, bodegas,
      user: req.session.user
    });
  } catch (e) { next(e); }
});

/* =======================================================
   API catálogo
   - Precio por proveedor (si existe en product_supplier_prices)
   - Stock: suma de product_inventario (opcional por bodega)
   - No filtra por stock 0
   - Query: ?search=&proveedor_id=&bodega_id=
======================================================= */
router.get('/api/catalog', isAuth, async (req, res, next) => {
  try {
    const q    = (req.query.search || '').trim();
    const prov = Number(req.query.proveedor_id) || null;
    const bod  = Number(req.query.bodega_id) || null;

    const params = [];
    const precioSelect = prov
      ? `(
           SELECT psp.precio_compra
             FROM product_supplier_prices psp
            WHERE psp.product_id = p.id AND psp.supplier_id = ?
            LIMIT 1
         )`
      : 'NULL';
    if (prov) params.push(prov);

    const stockSelect = `
      COALESCE((
        SELECT SUM(pi.cantidad)
          FROM product_inventario pi
         WHERE pi.product_id = p.id
           ${bod ? 'AND pi.warehouse_id = ?' : ''}
      ), 0)
    `;
    if (bod) params.push(bod);

    let sql = `
      SELECT p.id, p.nombre, p.imagen,
             ${precioSelect} AS precio,
             ${stockSelect}   AS stock
        FROM products p
       WHERE p.clase='PRODUCTO'
    `;
    if (q) { sql += ' AND p.nombre LIKE ?'; params.push(`%${q}%`); }
    sql += ' ORDER BY p.nombre ASC LIMIT 300';

    const [rows] = await pool.query(sql, params);
    rows.forEach(r => { if (!r.imagen) r.imagen = '/img/products/noimg.png'; });
    res.json({ ok:true, items: rows });
  } catch (e) { next(e); }
});

/* =======================================================
   CREAR COMPRA (PENDIENTE) → NO mueve stock
======================================================= */
router.post('/', isAuth, async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const uid          = req.session.user.id;
    const proveedor_id = Number(req.body.proveedor_id);
    const bodega_id    = Number(req.body.bodega_id);
    const notas        = req.body.notas || null;
    const fecha        = toDate(req.body.fecha_compra);

    const itemsRaw = req.body.items || [];
    const items    = Array.isArray(itemsRaw) ? itemsRaw : Object.values(itemsRaw);

    // Normalizar y total
    let total = 0;
    for (const it of items) {
      it.clase           = 'PRODUCTO'; // este flujo solo compra PRODUCTO
      it.item_id         = Number(it.item_id);
      it.cantidad        = Number(it.cantidad || 0);
      it.precio_unitario = Number(it.precio_unitario || 0);
      total += it.cantidad * it.precio_unitario;
    }

    // Cabecera: queda PENDIENTE (no mueve stock aquí)
    const [r] = await conn.query(`
      INSERT INTO compras
        (proveedor_id, bodega_id, fecha_compra, total, notas, usuario_crea_id, estado)
      VALUES (?,?,?,?,?,?, 'PENDIENTE')
    `, [proveedor_id, bodega_id, fecha, total, notas, uid]);
    const compraId = r.insertId;

    // Detalle
    for (const it of items) {
      await conn.query(`
        INSERT INTO compras_detalles
          (compra_id, producto_id, insumo_id, cantidad, precio_unitario)
        VALUES (?,?,?,?,?)
      `, [compraId, it.item_id, null, it.cantidad, it.precio_unitario]);
    }

    await conn.commit();
    return res.json({ ok:true, id: compraId, redirect: `/compras-v4/${compraId}?ok=1` });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally { conn.release(); }
});

/* =======================================================
   APROBAR COMPRA – solo admin
   NOTA: YA NO suma inventario aquí.
   - Si ya está APROBADO o COMPLETADO: no cambia nada.
======================================================= */
router.post('/:id(\\d+)/aprobar', isAuth, isAdmin, async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const id = Number(req.params.id);
    const [[compra]] = await conn.query('SELECT * FROM compras WHERE id=?', [id]);
    if (!compra) {
      await conn.rollback();
      return res.status(404).send('Compra no encontrada');
    }

    if (compra.estado === 'COMPLETADO') {
      await conn.rollback();
      return res.redirect(`/compras-v4/${id}`);
    }

    if (compra.estado !== 'APROBADO') {
      await conn.query(
        `UPDATE compras SET estado='APROBADO', usuario_mod_id=?, updated_at=NOW() WHERE id=?`,
        [req.session.user.id, id]
      );
    }

    await conn.commit();
    res.redirect(`/compras-v4/${id}`);
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally { conn.release(); }
});

/* =======================================================
   Ficha simple
======================================================= */
router.get('/:id(\\d+)', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const [[compra]] = await pool.query(`
      SELECT c.*, p.nombre AS proveedor_nombre, b.nombre AS bodega_nombre
        FROM compras c
   LEFT JOIN proveedores p ON p.id = c.proveedor_id
   LEFT JOIN bodegas b     ON b.id = c.bodega_id
       WHERE c.id=?`, [id]);

    const [detalles] = await pool.query(`
      SELECT d.*, pr.nombre AS producto_nombre
        FROM compras_detalles d
   LEFT JOIN products pr ON pr.id = d.producto_id
       WHERE d.compra_id=?`, [id]);

    if (!compra) return res.redirect('/compras-v4');

    res.render('V4compras/compra_success', {
      title: `Compra #${compra.id}`,
      compra, detalles,
      user: req.session.user,
      ok: req.query.ok === '1'
    });
  } catch (e) { next(e); }
});

module.exports = router;
