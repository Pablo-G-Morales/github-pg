// routes/ventas.js
const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

/* ===== Auth (ajusta si tus middlewares viven en otro lado) ===== */
function isLoggedIn(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}
function isAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin' || req.session?.user?.rol_id === 1) return next();
  return res.status(403).send('Acceso restringido.');
}
router.use(isLoggedIn, isAdmin);

/* ===== Helpers ===== */
function toInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}
function likeWrap(s) {
  return `%${String(s || '').trim()}%`;
}

/* ===== GET /ventas  -> listado con filtros + paginación servidor ===== */
router.get('/', async (req, res) => {
  try {
    const page     = toInt(req.query.page, 1);
    const sizeSafe = toInt(req.query.size, 25);
    const size     = [10, 25, 50, 100].includes(sizeSafe) ? sizeSafe : 25;

    const year     = toInt(req.query.year, 0);   // 0 = todos
    const month    = toInt(req.query.month, 0);  // 0 = todos
    const bodegaId = toInt(req.query.bodega_id, 0);
    const cliente  = (req.query.cliente || '').trim();
    const q        = (req.query.q || '').trim(); // búsqueda global

    const where = ['p.estado = "COMPLETADO"'];
    const params = [];

    if (year)     { where.push('YEAR(p.created_at) = ?'); params.push(year); }
    if (month)    { where.push('MONTH(p.created_at) = ?'); params.push(month); }
    if (bodegaId) { where.push('p.bodega_id = ?');         params.push(bodegaId); }
    if (cliente)  { where.push('p.nom_nuevo LIKE ?');      params.push(likeWrap(cliente)); }

    if (q) {
      const isNum = /^\d+$/.test(q);
      if (isNum) {
        where.push('(p.id = ? OR p.nom_nuevo LIKE ? OR p.tel_nuevo LIKE ?)');
        params.push(parseInt(q, 10), likeWrap(q), likeWrap(q));
      } else {
        where.push('(p.nom_nuevo LIKE ? OR p.tel_nuevo LIKE ?)');
        params.push(likeWrap(q), likeWrap(q));
      }
    }

    const whereSQL = 'WHERE ' + where.join(' AND ');

    // Catálogos
    const [bodegas] = await pool.query(`SELECT id, nombre FROM bodegas ORDER BY nombre ASC`);
    const [years]   = await pool.query(
      `SELECT DISTINCT YEAR(created_at) AS y
         FROM pedidos
        WHERE estado = 'COMPLETADO'
     ORDER BY y DESC`
    );

    // Totales
    const [[tot]] = await pool.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(p.total),0) AS suma
         FROM pedidos p
         ${whereSQL}`,
      params
    );
    const totalRows  = Number(tot.total || 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / size));
    const offset     = (page - 1) * size;

    // Listado
    const listSQL = `
      SELECT p.id,
             p.created_at,
             p.total,
             p.nom_nuevo,
             p.tel_nuevo,
             p.bodega_id,
             b.nombre AS bodega_nombre
        FROM pedidos p
   LEFT JOIN bodegas b ON b.id = p.bodega_id
       ${whereSQL}
    ORDER BY p.id DESC
       LIMIT ? OFFSET ?`;
    const listParams = [...params, size, offset];

    const [pedidos] = await pool.query(listSQL, listParams);

    res.render('ventas/index', {
      title: 'Ventas (Pedidos completados)',
      filtros: { page, size, year, month, bodega_id: bodegaId, cliente, q },
      pedidos,
      bodegas,
      years,
      resumen: { totalRows, totalPages, suma: Number(tot.suma || 0) }
    });
  } catch (err) {
    console.error('Error en /ventas:', err);
    res.status(500).send('Error al cargar ventas.');
  }
});

/* ===== GET /ventas/estadisticas  -> KPIs + datasets para Chart.js ===== */
router.get('/estadisticas', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();

    // KPIs reales (contador + suma)
    const [[kpi]] = await pool.query(
      `SELECT COUNT(*) AS pedidos, COALESCE(SUM(total),0) AS monto
         FROM pedidos
        WHERE estado = 'COMPLETADO'`
    );

    // Ventas por mes (año elegido)
    const [rowsMes] = await pool.query(
      `SELECT MONTH(p.created_at) AS m, SUM(p.total) AS monto
         FROM pedidos p
        WHERE p.estado = 'COMPLETADO' AND YEAR(p.created_at) = ?
     GROUP BY MONTH(p.created_at)
     ORDER BY m ASC`,
      [year]
    );
    const ventasPorMes = Array.from({ length: 12 }, (_, i) => {
      const row = rowsMes.find(r => Number(r.m) === i + 1);
      return row ? Number(row.monto || 0) : 0;
    });

    // Ventas por año (últimos 7)
    const [rowsAnio] = await pool.query(
      `SELECT YEAR(p.created_at) AS y, SUM(p.total) AS monto
         FROM pedidos p
        WHERE p.estado = 'COMPLETADO'
          AND p.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 YEAR)
     GROUP BY YEAR(p.created_at)
     ORDER BY y ASC`
    );
    const labelsAnio = rowsAnio.map(r => r.y);
    const dataAnio   = rowsAnio.map(r => Number(r.monto || 0));

    // Ventas por cliente (TOP 10)
    const [rowsCliente] = await pool.query(
      `SELECT COALESCE(p.nom_nuevo, 'Consumidor final') AS cliente,
              COUNT(*) AS pedidos,
              SUM(p.total) AS monto
         FROM pedidos p
        WHERE p.estado = 'COMPLETADO'
     GROUP BY COALESCE(p.nom_nuevo, 'Consumidor final')
     ORDER BY monto DESC
        LIMIT 10`
    );
    const labelsCliente = rowsCliente.map(r => r.cliente);
    const dataCliente   = rowsCliente.map(r => Number(r.monto || 0));
    const cantCliente   = rowsCliente.map(r => Number(r.pedidos || 0)); // disponible si luego quieres alternar “monto / #pedidos”

    // Años disponibles para el selector
    const [years] = await pool.query(
      `SELECT DISTINCT YEAR(created_at) AS y
         FROM pedidos
        WHERE estado = 'COMPLETADO'
     ORDER BY y DESC`
    );

    res.render('ventas/estadisticas', {
      title: 'Estadísticas de Ventas',
      resumen: {
        pedidos: Number(kpi.pedidos || 0),
        monto  : Number(kpi.monto || 0)
      },
      chartData: {
        year,
        porMes: ventasPorMes,
        labelsAnio, dataAnio,
        labelsCliente, dataCliente, cantCliente
      },
      years
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar estadísticas.');
  }
});

module.exports = router;
