// routes/compras_v3.js
const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

/* -------------------- Auth -------------------- */
function isAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}
function isAdmin(req, res, next) {
  if (req.session?.user?.rol_id === 1) return next();
  return res.status(403).send('No autorizado');
}

/* -------------------- Utils -------------------- */
const toLocalInput = (dt) => {
  if (!dt) return '';
  const d = new Date(dt);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
function agruparPorProducto(items) {
  const map = new Map();
  for (const it of (items||[])) {
    if (it.clase !== 'PRODUCTO') continue;
    const pid = Number(it.item_id);
    const cant = parseFloat(it.cantidad || 0);
    if (!pid || !cant) continue;
    map.set(pid, (map.get(pid)||0) + cant);
  }
  return [...map.entries()].map(([product_id, cantidad]) => ({ product_id, cantidad }));
}

/* -------------------- Movimiento de stock -------------------- */
async function aplicarStock(conn, { warehouse_id, supplier_id, items, signo }) {
  const consol = agruparPorProducto(items);
  for (const { product_id, cantidad } of consol) {
    const delta = signo * cantidad;

    // 1) product_stock
    await conn.query(`
      INSERT INTO product_stock (product_id, warehouse_id, cantidad)
      VALUES (?,?,?)
      ON DUPLICATE KEY UPDATE cantidad = cantidad + VALUES(cantidad)
    `, [product_id, warehouse_id, delta]);

    // 2) product_inventario (resumen por proveedor)
    const it = items.find(x => Number(x.item_id) === product_id && x.clase==='PRODUCTO') || {};
    const precioCompra = (it.precio_unitario != null && it.precio_unitario !== '') ? Number(it.precio_unitario) : null;

    await conn.query(`
      INSERT INTO product_inventario (product_id, warehouse_id, supplier_id, cantidad, precio_compra)
      VALUES (?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        cantidad = cantidad + VALUES(cantidad),
        precio_compra = COALESCE(VALUES(precio_compra), precio_compra)
    `, [product_id, warehouse_id, supplier_id, delta, precioCompra]);
  }
}

/* =================================================================
   UI: Nueva compra (con modales)
================================================================= */
router.get('/nueva', isAuth, async (_req, res, next) => {
  try {
    const [proveedores] = await pool.query('SELECT id,nombre FROM proveedores ORDER BY nombre');
    const [bodegas]     = await pool.query('SELECT id,nombre FROM bodegas ORDER BY nombre');

    res.render('compras_v3/compra_form_modal', {
      title: 'Nueva compra',
      compra: null,
      proveedores,
      bodegas,
      // La Orden actual se arma client-side; enviamos arreglo vacío
      detalles: []
    });
  } catch (e) { next(e); }
});

/* =================================================================
   API Catálogo (para el Modal #1)
   GET /compras-v3/api/items?clase=PRODUCTO|INSUMO&search=&proveedor_id=&bodega_id=
   - Si clase=PRODUCTO: trae productos; opcionalmente filtra por proveedor y
     adjunta el "último precio" de ese proveedor. Incluye stock de la bodega.
   - Si clase=INSUMO: usa products.clase='INSUMO' (o si aún manejas tabla insumos,
     ver nota al final).
================================================================= */
router.get('/api/items', isAuth, async (req, res, next) => {
  try {
    const clase = (req.query.clase || 'PRODUCTO').toUpperCase();
    const q     = (req.query.search || '').trim();
    const prov  = Number(req.query.proveedor_id) || null;
    const bod   = Number(req.query.bodega_id) || null;

    if (clase === 'PRODUCTO') {
      // Productos con último precio por proveedor (si prov), más stock por bodega (si bod)
      const params = [];
      let sql = `
        SELECT p.id AS item_id,
               p.nombre,
               p.imagen,
               'PRODUCTO' AS clase,
               -- último precio del proveedor (si se envió proveedor_id)
               (
                 SELECT psp.precio_compra
                   FROM product_supplier_prices psp
                   JOIN (
                     SELECT product_id, supplier_id, MAX(fecha_vigencia) AS max_fv
                       FROM product_supplier_prices
                      WHERE supplier_id = ${prov ? '?' : 'psp.supplier_id'}
                      ${prov ? '' : '/* ignora filtro si no hay prov */'}
                      GROUP BY product_id, supplier_id
                   ) ult
                     ON ult.product_id  = psp.product_id
                    AND ult.supplier_id = psp.supplier_id
                    AND ult.max_fv      = psp.fecha_vigencia
                  WHERE psp.product_id = p.id
                  ${prov ? 'AND psp.supplier_id = ?' : ''}
                  LIMIT 1
               ) AS precio,
               -- stock por bodega (si bod)
               (
                 SELECT SUM(ps.cantidad) FROM product_stock ps
                  WHERE ps.product_id = p.id
                    ${bod ? 'AND ps.warehouse_id = ?' : ''}
               ) AS stock
          FROM products p
         WHERE p.clase = 'PRODUCTO'
      `;
      if (q) { sql += ' AND p.nombre LIKE ?'; params.push(`%${q}%`); }

      // armar params según uso
      if (prov) params.push(prov, prov);
      if (bod)  params.push(bod);

      sql += ' ORDER BY p.nombre ASC LIMIT 200';
      const [rows] = await pool.query(sql, params);
      return res.json({ ok:true, items: rows });
    }

    // clase = INSUMO (usando products.clase='INSUMO')
    const params = [];
    let sql = `
      SELECT p.id AS item_id,
             p.nombre,
             p.imagen,
             'INSUMO' AS clase,
             p.precio_venta_sugerido AS precio,  -- o un campo específico si lo tienes
             NULL AS stock
        FROM products p
       WHERE p.clase = 'INSUMO'
    `;
    if (q) { sql += ' AND p.nombre LIKE ?'; params.push(`%${q}%`); }
    sql += ' ORDER BY p.nombre ASC LIMIT 200';
    const [rows] = await pool.query(sql, params);
    return res.json({ ok:true, items: rows });
  } catch (e) { next(e); }
});

/* =================================================================
   API Detalle de producto (Modal #2)
   GET /compras-v3/api/productos/:id/detalle?proveedor_id=&bodega_id=
   - Devuelve ficha, stock en bodega, y último precio del proveedor.
================================================================= */
router.get('/api/productos/:id/detalle', isAuth, async (req, res, next) => {
  try {
    const id   = Number(req.params.id);
    const prov = Number(req.query.proveedor_id) || null;
    const bod  = Number(req.query.bodega_id) || null;

    const [[p]] = await pool.query(`
      SELECT p.id, p.nombre, p.descripcion, p.imagen,
             m.nombre AS marca, mat.nombre AS material, c.nombre AS color,
             f.nombre AS forma, u.nombre AS unidad, p.capacidad
        FROM products p
        LEFT JOIN marcas m     ON m.id  = p.brand_id
        LEFT JOIN materiales mat ON mat.id = p.material_id
        LEFT JOIN colores c    ON c.id  = p.color_id
        LEFT JOIN formas  f    ON f.id  = p.shape_id
        LEFT JOIN unidades u   ON u.id  = p.unit_id
       WHERE p.id=? AND p.clase='PRODUCTO'
    `, [id]);
    if (!p) return res.json({ ok:false, msg:'Producto no encontrado' });

    const [[stk]] = await pool.query(`
      SELECT IFNULL(SUM(cantidad),0) AS stock
        FROM product_stock
       WHERE product_id=? ${bod ? 'AND warehouse_id=?' : ''}
    `, bod ? [id,bod] : [id]);

    let precio = null;
    if (prov) {
      const [[lp]] = await pool.query(`
        SELECT psp.precio_compra
          FROM product_supplier_prices psp
          JOIN (
            SELECT product_id, supplier_id, MAX(fecha_vigencia) AS max_fv
              FROM product_supplier_prices
             WHERE supplier_id = ?
             GROUP BY product_id, supplier_id
          ) ult
            ON ult.product_id  = psp.product_id
           AND ult.supplier_id = psp.supplier_id
           AND ult.max_fv      = psp.fecha_vigencia
         WHERE psp.product_id=? AND psp.supplier_id=?
         LIMIT 1
      `, [prov, id, prov]);
      if (lp) precio = lp.precio_compra;
    }

    res.json({ ok:true, producto: p, stock: Number(stk?.stock||0), precio });
  } catch (e) { next(e); }
});

/* =================================================================
   GUARDAR (crear)
   body:
   - proveedor_id (input en la pantalla, también se elige en el modal superior)
   - bodega_id (requerido si hay PRODUCTO en la orden)
   - fecha_compra, notas
   - items[]: { item_id, clase, cantidad, precio_unitario }
================================================================= */
router.post('/', isAuth, async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { proveedor_id, bodega_id, fecha_compra, notas } = req.body;
    const itemsRaw = req.body.items || [];
    const items = Array.isArray(itemsRaw) ? itemsRaw : Object.values(itemsRaw);

    // Calcular total y normalizar
    let total = 0;
    for (const it of items) {
      it.cantidad = Number(it.cantidad || 0);
      it.precio_unitario = Number(it.precio_unitario || 0);
      total += it.cantidad * it.precio_unitario;
    }

    // Cabecera
    const [r] = await conn.query(`
      INSERT INTO compras (proveedor_id, bodega_id, fecha_compra, total, notas, usuario_crea_id, estado)
      VALUES (?,?,?,?,?,?, 'PENDIENTE')
    `, [
      Number(proveedor_id),
      items.some(i => i.clase==='PRODUCTO') ? Number(bodega_id) : null,
      new Date(fecha_compra),
      total,
      (notas || null),
      req.session.user.id
    ]);
    const compraId = r.insertId;

    // Detalle
    for (const it of items) {
      const esProd = it.clase === 'PRODUCTO';
      const pid = esProd ? Number(it.item_id) : null;
      const iid = esProd ? null : Number(it.item_id);
      await conn.query(`
        INSERT INTO compras_detalles (compra_id, producto_id, insumo_id, cantidad, precio_unitario)
        VALUES (?,?,?,?,?)
      `, [compraId, pid, iid, it.cantidad, it.precio_unitario]);
    }

    // Movimiento de stock (solo PRODUCTO)
    if (items.some(i => i.clase==='PRODUCTO')) {
      await aplicarStock(conn, {
        warehouse_id: Number(bodega_id),
        supplier_id : Number(proveedor_id),
        items,
        signo: +1
      });
    }

    await conn.commit();
    res.json({ ok:true, id: compraId, redirect: `/compras/${compraId}` });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});

/* =================================================================
   EDITAR (flujo: revertir -> actualizar -> re-aplicar)
================================================================= */
router.post('/:id', isAuth, async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { id } = req.params;

    const [[compraPrev]] = await conn.query('SELECT proveedor_id, bodega_id FROM compras WHERE id=?', [id]);
    const [detPrev] = await conn.query('SELECT producto_id AS item_id, cantidad FROM compras_detalles WHERE compra_id=?', [id]);

    // Revertir stock anterior (solo productos)
    if (detPrev.some(x => x.item_id)) {
      await aplicarStock(conn, {
        warehouse_id: Number(compraPrev.bodega_id),
        supplier_id : Number(compraPrev.proveedor_id),
        items       : detPrev.map(d => ({ item_id: d.item_id, clase:'PRODUCTO', cantidad: d.cantidad })),
        signo       : -1
      });
    }

    // Nuevos datos
    const { proveedor_id, bodega_id, fecha_compra, notas } = req.body;
    const itemsRaw = req.body.items || [];
    const items = Array.isArray(itemsRaw) ? itemsRaw : Object.values(itemsRaw);

    // Total
    let total = 0;
    for (const it of items) {
      it.cantidad = Number(it.cantidad || 0);
      it.precio_unitario = Number(it.precio_unitario || 0);
      total += it.cantidad * it.precio_unitario;
    }

    // Cabecera
    await conn.query(`
      UPDATE compras
         SET proveedor_id=?,
             bodega_id=?,
             fecha_compra=?,
             total=?,
             notas=?,
             usuario_mod_id=?,
             actualizado_en=NOW()
       WHERE id=?
    `, [
      Number(proveedor_id),
      items.some(i => i.clase==='PRODUCTO') ? Number(bodega_id) : null,
      new Date(fecha_compra),
      total,
      (notas || null),
      req.session.user.id,
      id
    ]);

    // Detalle
    await conn.query('DELETE FROM compras_detalles WHERE compra_id=?', [id]);
    for (const it of items) {
      const esProd = it.clase === 'PRODUCTO';
      const pid = esProd ? Number(it.item_id) : null;
      const iid = esProd ? null : Number(it.item_id);
      await conn.query(`
        INSERT INTO compras_detalles (compra_id, producto_id, insumo_id, cantidad, precio_unitario)
        VALUES (?,?,?,?,?)
      `, [id, pid, iid, it.cantidad, it.precio_unitario]);
    }

    // Re-aplicar stock (solo productos)
    if (items.some(i => i.clase==='PRODUCTO')) {
      await aplicarStock(conn, {
        warehouse_id: Number(bodega_id),
        supplier_id : Number(proveedor_id),
        items,
        signo: +1
      });
    }

    await conn.commit();
    res.json({ ok:true, id, redirect: `/compras/${id}` });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});

/* =================================================================
   Ficha (igual que en v2, sirve para ver la compra)
================================================================= */
router.get('/:id', isAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const [[compra]] = await pool.query(`
      SELECT c.*,
             DATE_FORMAT(c.fecha_compra, '%d/%m/%Y %H:%i') AS fecha_formateada,
             p.nombre AS proveedor_nombre,
             b.nombre AS bodega_nombre
        FROM compras c
        JOIN proveedores p ON p.id = c.proveedor_id
        LEFT JOIN bodegas  b ON b.id = c.bodega_id
       WHERE c.id=?
    `, [id]);
    if (!compra) return res.redirect('/compras');

    const [detalles] = await pool.query(`
      SELECT d.*,
             pr.nombre  AS producto_nombre,
             ins.nombre AS insumo_nombre,
             (d.cantidad * d.precio_unitario) AS subtotal
        FROM compras_detalles d
        LEFT JOIN products pr ON pr.id = d.producto_id
        LEFT JOIN products ins ON ins.id = d.insumo_id  AND ins.clase='INSUMO'
       WHERE d.compra_id=?
    `, [id]);

    res.render('compras_v3/compra_ficha', { title: `Compra #${compra.id}`, compra, detalles });
  } catch (e) { next(e); }
});

/* =================================================================
   Cambiar estado (solo administrador)
================================================================= */
router.post('/:id/estado', isAuth, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    if (!['PENDIENTE','APROBADO','ANULADO'].includes(estado)) {
      return res.status(400).send('Estado inválido');
    }
    await pool.query(`UPDATE compras SET estado=?, usuario_mod_id=?, actualizado_en=NOW() WHERE id=?`,
      [estado, req.session.user.id, id]);
    res.redirect('/compras/' + id);
  } catch (e) { next(e); }
});

module.exports = router;
