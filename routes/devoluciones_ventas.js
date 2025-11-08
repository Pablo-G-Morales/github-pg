// routes/devoluciones_ventas.js
const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

// ====== Auth ======
function isLoggedIn(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}
function isAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  if (req.session?.user?.rol_id === 1) return next();
  return res.status(403).send('Acceso restringido para administradores.');
}
router.use(isLoggedIn, isAdmin);

// ====== Utilidades ======

// Intenta ejecutar un query y devuelve [rows]; si falla por tabla/columna, retorna null
async function tryQuery(sql, params) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (e) {
    // Solo ignoramos errores de tabla/columna no encontrados; otros se relanzan
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR')) {
      return null;
    }
    throw e;
  }
}

// Obtiene el pedido COMPLETADO + líneas usando el primer esquema que funcione
async function getPedidoCompleto(pedido_id) {
  const [pedidos] = await pool.query(
    `SELECT p.id,
            p.created_at AS fecha,       -- ajusta aquí si tu fecha se llama distinto; mantén AS fecha
            p.estado, p.total, p.bodega_id,
            p.nom_nuevo, p.tel_nuevo, p.direccion,
            p.municipio_id, p.departamento_id
       FROM pedidos p
      WHERE p.id = ? AND p.estado = 'COMPLETADO'`,
    [pedido_id]
  );
  if (pedidos.length === 0) return null;

  const combos = [
    // Prioridad: tu DB real según DESCRIBE
    { table: 'pedidos_detalles', prodCol: 'producto_id', pedCol: 'pedido_id' },
    { table: 'pedidos_det',      prodCol: 'producto_id', pedCol: 'pedido_id' },
    // Fallbacks por si en otro entorno usan product_id
    { table: 'pedidos_detalles', prodCol: 'product_id',  pedCol: 'pedido_id' },
    { table: 'pedidos_det',      prodCol: 'product_id',  pedCol: 'pedido_id' },
    // Fallbacks por si el FK al pedido se llama id_pedido
    { table: 'pedidos_detalles', prodCol: 'producto_id', pedCol: 'id_pedido' },
    { table: 'pedidos_det',      prodCol: 'producto_id', pedCol: 'id_pedido' },
  ];

  let lineas = null;
  for (const c of combos) {
    const sql = `
      SELECT d.id,
             d.${c.prodCol} AS product_id,
             pr.nombre       AS product_nombre,
             d.cantidad,
             d.precio_unitario,
             (d.cantidad * d.precio_unitario) AS subtotal
        FROM ${c.table} d
        JOIN products pr ON pr.id = d.${c.prodCol}
       WHERE d.${c.pedCol} = ?`;
    const rows = await tryQuery(sql, [pedido_id]);
    if (rows !== null) { lineas = rows; break; }
  }

  if (!lineas) {
    throw new Error(
      'No se pudieron leer las líneas del pedido. ' +
      'Revisa que exista alguna de las combinaciones: ' +
      '[pedidos_detalles/pedidos_det] con columnas [producto_id|product_id] y [pedido_id|id_pedido].'
    );
  }

  return { pedido: pedidos[0], detalles: lineas };
}

// Total devuelto previo por producto (para limitar máximo devolvible)
async function getDevueltosPreviosPorProducto(pedido_id) {
  const [rows] = await pool.query(
    `SELECT dvd.product_id, SUM(dvd.cantidad) AS devuelto
       FROM devoluciones_ventas dv
       JOIN devoluciones_ventas_detalles dvd ON dvd.devolucion_id = dv.id
      WHERE dv.pedido_id = ?
   GROUP BY dvd.product_id`,
    [pedido_id]
  );
  const map = new Map();
  for (const r of rows) map.set(r.product_id, Number(r.devuelto || 0));
  return map;
}

// ============ LISTAR ============
router.get('/', async (_req, res) => {
  try {
    // Devoluciones existentes (como ya lo tenías)
    const [devoluciones] = await pool.query(
      `SELECT dv.id, dv.pedido_id, dv.created_at, u.nombre AS creado_por, dv.motivo_general,
              COUNT(dvd.id) AS items, SUM(dvd.cantidad) AS total_items
         FROM devoluciones_ventas dv
    LEFT JOIN usuarios u ON u.id = dv.usuario_id
    LEFT JOIN devoluciones_ventas_detalles dvd ON dvd.devolucion_id = dv.id
     GROUP BY dv.id
     ORDER BY dv.id DESC`
    );

    // NUEVO: listado de pedidos COMPLETADOS (básico)
    const [pedidosCompletados] = await pool.query(
      `SELECT p.id, p.created_at, p.total, p.nom_nuevo, p.estado
         FROM pedidos p
        WHERE p.estado = 'COMPLETADO'
        ORDER BY p.id DESC
        LIMIT 100`
    );

    res.render('devoluciones_ventas/index', {
      title: 'Devoluciones de Ventas',
      devoluciones,
      pedidosCompletados
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al listar devoluciones/pedidos.');
  }
});


// ====== Nueva ======
router.get('/nueva', async (req, res) => {
  try {
    const pedido_id = Number(req.query.pedido_id);
    if (!pedido_id) return res.status(400).send('Falta pedido_id');

    const data = await getPedidoCompleto(pedido_id);
    if (!data) return res.status(404).send('Pedido no encontrado o no está COMPLETADO.');

    const prev = await getDevueltosPreviosPorProducto(pedido_id);
    const detallesConMax = data.detalles.map(d => {
      const dev = prev.get(d.product_id) || 0;
      const maxDevolvible = Math.max(0, Number(d.cantidad) - Number(dev));
      return { ...d, maxDevolvible };
    });

    res.render('devoluciones_ventas/new', {
      title: `Nueva devolución – Pedido #${data.pedido.id}`,
      pedido: data.pedido,
      detalles: detallesConMax
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al preparar nueva devolución.');
  }
});

// Atajo desde /devoluciones-ventas/pedido/:id/nueva
router.get('/pedido/:id/nueva', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).send('ID inválido.');
  res.redirect(`/devoluciones-ventas/nueva?pedido_id=${id}`);
});

// ====== Crear ======
router.post('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const pedido_id = Number(req.body.pedido_id);
    const motivo_general = req.body.motivo_general || null;
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!pedido_id || items.length === 0) {
      return res.status(400).send('Datos incompletos.');
    }

    const data = await getPedidoCompleto(pedido_id);
    if (!data) return res.status(400).send('Pedido no válido o no está COMPLETADO.');

    const vendidos = new Map();
    data.detalles.forEach(d => vendidos.set(d.product_id, Number(d.cantidad)));

    const prev = await getDevueltosPreviosPorProducto(pedido_id);

    const normItems = items.map(it => ({
      product_id: Number(it.product_id),
      cantidad  : Number(it.cantidad),
      detalle   : it.detalle ? String(it.detalle).slice(0, 500) : null
    })).filter(it => it.product_id && it.cantidad > 0);

    if (normItems.length === 0) {
      return res.status(400).send('Debes seleccionar al menos un producto con cantidad > 0.');
    }

    for (const it of normItems) {
      const vendido = vendidos.get(it.product_id) || 0;
      const previo  = prev.get(it.product_id) || 0;
      const maxDevolvible = Math.max(0, vendido - previo);
      if (it.cantidad > maxDevolvible) {
        return res.status(400).send(`La cantidad a devolver del producto ${it.product_id} excede el máximo permitido (${maxDevolvible}).`);
      }
    }

    await conn.beginTransaction();

    const [insCab] = await conn.query(
      `INSERT INTO devoluciones_ventas (pedido_id, usuario_id, motivo_general, created_at)
       VALUES (?, ?, ?, NOW())`,
      [pedido_id, req.session.user.id, motivo_general]
    );
    const devolucionId = insCab.insertId;

    for (const it of normItems) {
      await conn.query(
        `INSERT INTO devoluciones_ventas_detalles (devolucion_id, product_id, cantidad, detalle)
         VALUES (?, ?, ?, ?)`,
        [devolucionId, it.product_id, it.cantidad, it.detalle]
      );

      await conn.query(
        `INSERT INTO conteo_fallas (product_id, total_devueltos, updated_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           total_devueltos = total_devueltos + VALUES(total_devueltos),
           updated_at = NOW()`,
        [it.product_id, it.cantidad]
      );
    }

    await conn.commit();
    res.redirect(`/devoluciones-ventas/${devolucionId}`);
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error(err);
    res.status(500).send('Error al crear la devolución.');
  } finally {
    conn.release();
  }
});

// ====== Ver ======
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[cab]] = await pool.query(
      `SELECT dv.id, dv.pedido_id, dv.usuario_id, u.nombre AS creado_por, dv.motivo_general, dv.created_at
         FROM devoluciones_ventas dv
    LEFT JOIN usuarios u ON u.id = dv.usuario_id
        WHERE dv.id = ?`,
      [id]
    );
    if (!cab) return res.status(404).send('Devolución no encontrada.');

    const [det] = await pool.query(
      `SELECT dvd.id, dvd.product_id, pr.nombre AS product_nombre, dvd.cantidad, dvd.detalle
         FROM devoluciones_ventas_detalles dvd
         JOIN products pr ON pr.id = dvd.product_id
        WHERE dvd.devolucion_id = ?`,
      [id]
    );

    res.render('devoluciones_ventas/show', { title: `Devolución #${id}`, cab, detalles: det });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar la devolución.');
  }
});

// ====== Editar (form) ======
router.get('/:id/editar', async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [[cab]] = await pool.query(
      `SELECT id, pedido_id, usuario_id, motivo_general
         FROM devoluciones_ventas
        WHERE id = ?`,
      [id]
    );
    if (!cab) return res.status(404).send('Devolución no encontrada.');

    const data = await getPedidoCompleto(cab.pedido_id);
    if (!data) return res.status(400).send('Pedido asociado no válido.');

    const [misDet] = await pool.query(
      `SELECT id, product_id, cantidad, detalle
         FROM devoluciones_ventas_detalles
        WHERE devolucion_id = ?`,
      [id]
    );

    const [previosExcluyendoActual] = await pool.query(
      `SELECT dvd.product_id, SUM(dvd.cantidad) AS devuelto
         FROM devoluciones_ventas dv
         JOIN devoluciones_ventas_detalles dvd ON dvd.devolucion_id = dv.id
        WHERE dv.pedido_id = ? AND dv.id <> ?
     GROUP BY dvd.product_id`,
      [cab.pedido_id, id]
    );
    const prevMap = new Map();
    for (const r of previosExcluyendoActual) prevMap.set(r.product_id, Number(r.devuelto || 0));

    const detallesConMax = data.detalles.map(d => {
      const dev = prevMap.get(d.product_id) || 0;
      const maxDevolvible = Math.max(0, Number(d.cantidad) - Number(dev));
      return { ...d, maxDevolvible };
    });

    res.render('devoluciones_ventas/edit', {
      title: `Editar Devolución #${id}`,
      cab, detalles: detallesConMax, misDet
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al preparar edición.');
  }
});

// ====== Actualizar ======
router.post('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    const motivo_general = req.body.motivo_general || null;
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    const [[cab]] = await conn.query(
      `SELECT id, pedido_id FROM devoluciones_ventas WHERE id = ?`,
      [id]
    );
    if (!cab) return res.status(404).send('Devolución no encontrada.');

    const data = await getPedidoCompleto(cab.pedido_id);
    if (!data) return res.status(400).send('Pedido asociado no válido.');

    const vendidos = new Map();
    data.detalles.forEach(d => vendidos.set(d.product_id, Number(d.cantidad)));

    const [rows] = await conn.query(
      `SELECT dvd.product_id, SUM(dvd.cantidad) AS devuelto
         FROM devoluciones_ventas dv
         JOIN devoluciones_ventas_detalles dvd ON dvd.devolucion_id = dv.id
        WHERE dv.pedido_id = ? AND dv.id <> ?
     GROUP BY dvd.product_id`,
      [cab.pedido_id, id]
    );
    const devueltosPrevios = new Map();
    for (const r of rows) devueltosPrevios.set(r.product_id, Number(r.devuelto || 0));

    const normItems = items.map(it => ({
      product_id: Number(it.product_id),
      cantidad  : Number(it.cantidad),
      detalle   : it.detalle ? String(it.detalle).slice(0, 500) : null
    })).filter(it => it.product_id && it.cantidad >= 0);

    if (normItems.length === 0) {
      return res.status(400).send('Debes dejar al menos una línea con cantidad >= 0.');
    }

    for (const it of normItems) {
      const vendido = vendidos.get(it.product_id) || 0;
      const previo  = devueltosPrevios.get(it.product_id) || 0;
      const maxDevolvible = Math.max(0, vendido - previo);
      if (it.cantidad > maxDevolvible) {
        return res.status(400).send(`La cantidad a devolver del producto ${it.product_id} excede el máximo permitido (${maxDevolvible}).`);
      }
    }

    await conn.beginTransaction();

    const [detActual] = await conn.query(
      `SELECT product_id, cantidad
         FROM devoluciones_ventas_detalles
        WHERE devolucion_id = ?`,
      [id]
    );
    const actualMap = new Map();
    detActual.forEach(x => actualMap.set(x.product_id, Number(x.cantidad)));

    await conn.query(
      `UPDATE devoluciones_ventas SET motivo_general = ? WHERE id = ?`,
      [motivo_general, id]
    );

    await conn.query(`DELETE FROM devoluciones_ventas_detalles WHERE devolucion_id = ?`, [id]);

    const nuevoMap = new Map();
    for (const it of normItems) {
      if (it.cantidad > 0) {
        await conn.query(
          `INSERT INTO devoluciones_ventas_detalles (devolucion_id, product_id, cantidad, detalle)
           VALUES (?, ?, ?, ?)`,
          [id, it.product_id, it.cantidad, it.detalle]
        );
      }
      nuevoMap.set(it.product_id, (nuevoMap.get(it.product_id) || 0) + it.cantidad);
    }

    const productosAjustar = new Set([...actualMap.keys(), ...nuevoMap.keys()]);
    for (const pid of productosAjustar) {
      const antes   = actualMap.get(pid) || 0;
      const despues = nuevoMap.get(pid) || 0;
      const delta   = despues - antes;

      if (delta > 0) {
        await conn.query(
          `INSERT INTO conteo_fallas (product_id, total_devueltos, updated_at)
           VALUES (?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             total_devueltos = total_devueltos + VALUES(total_devueltos),
             updated_at = NOW()`,
          [pid, delta]
        );
      } else if (delta < 0) {
        await conn.query(
          `INSERT INTO conteo_fallas (product_id, total_devueltos, updated_at)
           VALUES (?, 0, NOW())
           ON DUPLICATE KEY UPDATE
             total_devueltos = GREATEST(0, total_devueltos + (?)),
             updated_at = NOW()`,
          [delta]
        );
      }
    }

    await conn.commit();
    res.redirect(`/devoluciones-ventas/${id}`);
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error(err);
    res.status(500).send('Error al actualizar la devolución.');
  } finally {
    conn.release();
  }
});

module.exports = router;
