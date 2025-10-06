// routes/informacion.js
const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

/* =========================================================
   Helpers
========================================================= */

// Detecta qué columna de imagen existe en `planchas`
// Devuelve: 'imagen_url' | 'imagen' | null
async function getPlanchaImgColumn() {
  const [rows] = await pool.query(`
    SELECT column_name AS c
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'planchas'
      AND column_name IN ('imagen_url','imagen')
    ORDER BY FIELD(column_name, 'imagen_url','imagen')
    LIMIT 1
  `);
  return rows?.[0]?.c || null;
}

/* =========================================================
   LISTADO  GET /informacion
   Filtros: ?plancha_id=...&q=...
========================================================= */
router.get('/', async (req, res, next) => {
  try {
    const { plancha_id, q } = req.query;

    const [planchas] = await pool.query(
      'SELECT id, nombre FROM planchas ORDER BY nombre'
    );

    const where = [];
    const params = [];

    if (plancha_id) { where.push('i.plancha_id = ?'); params.push(plancha_id); }
    if (q) {
      // busca por producto (local u oficial) y por plancha
      where.push('(COALESCE(p.nombre, i.producto_nombre) LIKE ? OR pl.nombre LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const imgCol = await getPlanchaImgColumn();
    const imgSelect = imgCol ? `pl.\`${imgCol}\`` : 'NULL';

    const [rows] = await pool.query(`
      SELECT
        i.id,
        COALESCE(p.nombre, i.producto_nombre) AS producto,
        pl.nombre AS plancha,
        ${imgSelect} AS plancha_imagen,
        i.temperatura,
        i.tiempo
      FROM info_sublimacion i
      JOIN planchas pl ON pl.id = i.plancha_id
      LEFT JOIN products p ON p.id = i.product_id
      ${whereSql}
      ORDER BY producto ASC, plancha ASC
    `, params);

    res.render('informacion/productos_lista', {
      title  : 'Información de sublimación (Producto–Plancha)',
      datos  : rows,
      planchas,
      filtro : { plancha_id: plancha_id || '', q: q || '' }
    });
  } catch (err) { next(err); }
});

/* =========================================================
   PLANCHAS: LISTADO  GET /informacion/planchas
========================================================= */
router.get('/planchas', async (_req, res, next) => {
  try {
    const imgCol = await getPlanchaImgColumn();
    const imgSelect = imgCol ? `pl.\`${imgCol}\`` : 'NULL';
    const groupByImg = imgCol ? `pl.\`${imgCol}\`` : 'NULL';

    const [rows] = await pool.query(`
      SELECT
        pl.id,
        pl.nombre,
        ${imgSelect} AS imagen,
        COUNT(i.id) AS usos
      FROM planchas pl
      LEFT JOIN info_sublimacion i ON i.plancha_id = pl.id
      GROUP BY pl.id, pl.nombre, ${groupByImg}
      ORDER BY pl.nombre ASC
    `);

    res.render('informacion/planchas_lista', {
      title   : 'Planchas registradas',
      planchas: rows
    });
  } catch (err) { next(err); }
});

/* =========================================================
   FICHA  GET /informacion/ficha/:id
========================================================= */
router.get('/ficha/:id', async (req, res, next) => {
  try {
    const id = req.params.id;

    const imgCol = await getPlanchaImgColumn();
    const imgSelect = imgCol ? `pl.\`${imgCol}\`` : 'NULL';

    const [[ficha]] = await pool.query(`
      SELECT
        i.*,
        COALESCE(p.nombre, i.producto_nombre) AS producto,
        pl.nombre AS plancha,
        ${imgSelect} AS plancha_imagen
      FROM info_sublimacion i
      JOIN planchas pl ON pl.id = i.plancha_id
      LEFT JOIN products p ON p.id = i.product_id
      WHERE i.id = ?
    `, [id]);

    if (!ficha) return res.redirect('/informacion');

    res.render('informacion/producto_plancha_ficha', {
      title: `Ficha: ${ficha.producto} – ${ficha.plancha}`,
      ficha
    });
  } catch (err) { next(err); }
});

/* =========================================================
   NUEVA INFORMACIÓN  GET /informacion/nueva
========================================================= */
router.get('/nueva', async (_req, res, next) => {
  try {
    const [productos] = await pool.query('SELECT id, nombre FROM products ORDER BY nombre');
    const [planchas]  = await pool.query('SELECT id, nombre FROM planchas ORDER BY nombre');

    res.render('informacion/combinacion_form', {
      title: 'Nueva información (Producto–Plancha)',
      productos,
      planchas,
      registro: null
    });
  } catch (err) { next(err); }
});

/* =========================================================
   NUEVA INFORMACIÓN  POST /informacion/nueva
========================================================= */
router.post('/nueva', async (req, res, next) => {
  try {
    const { product_id, producto_nombre, plancha_id, temperatura, tiempo } = req.body;

    // nombre obligatorio; si no viene y hay product_id, buscarlo
    let nombre = (producto_nombre || '').trim();
    if (!nombre && product_id) {
      const [[p]] = await pool.query('SELECT nombre FROM products WHERE id = ?', [product_id]);
      if (p) nombre = p.nombre;
    }
    if (!nombre) return res.redirect('/informacion/nueva');

    // evitar duplicados (nombre + plancha)
    const [[dup]] = await pool.query(`
      SELECT id FROM info_sublimacion
      WHERE producto_nombre = ? AND plancha_id = ?
      LIMIT 1
    `, [nombre, plancha_id]);
    if (dup) return res.redirect('/informacion');

    await pool.query(`
      INSERT INTO info_sublimacion
        (product_id, producto_nombre, plancha_id, temperatura, tiempo)
      VALUES (?, ?, ?, ?, ?)
    `, [
      product_id || null,
      nombre,
      plancha_id,
      temperatura || null,
      tiempo || null
    ]);

    res.redirect('/informacion');
  } catch (err) { next(err); }
});

/* =========================================================
   EDITAR INFORMACIÓN  GET /informacion/:id/editar
========================================================= */
router.get('/:id/editar', async (req, res, next) => {
  try {
    const id = req.params.id;

    const [[registro]] = await pool.query(
      'SELECT * FROM info_sublimacion WHERE id = ?',
      [id]
    );
    if (!registro) return res.redirect('/informacion');

    const [planchas]  = await pool.query('SELECT id, nombre FROM planchas ORDER BY nombre');
    const [productos] = await pool.query('SELECT id, nombre FROM products ORDER BY nombre');

    res.render('informacion/combinacion_form', {
      title: `Editar información — ${registro.producto_nombre}`,
      registro,
      productos,
      planchas
    });
  } catch (err) { next(err); }
});

/* =========================================================
   EDITAR INFORMACIÓN  POST /informacion/:id/editar
========================================================= */
router.post('/:id/editar', async (req, res, next) => {
  try {
    const id = req.params.id;
    const { product_id, producto_nombre, plancha_id, temperatura, tiempo } = req.body;

    // evitar duplicados (nombre + plancha) excluyendo el propio id
    const [[dup]] = await pool.query(`
      SELECT id FROM info_sublimacion
      WHERE producto_nombre = ? AND plancha_id = ? AND id <> ?
      LIMIT 1
    `, [ (producto_nombre || '').trim(), plancha_id, id ]);
    if (dup) return res.redirect(`/informacion/${id}/editar`);

    await pool.query(`
      UPDATE info_sublimacion
      SET product_id = ?, producto_nombre = ?, plancha_id = ?, temperatura = ?, tiempo = ?
      WHERE id = ?
    `, [
      product_id || null,
      (producto_nombre || '').trim(),
      plancha_id,
      temperatura || null,
      tiempo || null,
      id
    ]);

    res.redirect('/informacion');
  } catch (err) { next(err); }
});

/* =========================================================
   ELIMINAR INFORMACIÓN  POST /informacion/:id/eliminar
========================================================= */
router.post('/:id/eliminar', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM info_sublimacion WHERE id = ?', [req.params.id]);
    res.redirect('/informacion');
  } catch (err) { next(err); }
});

/* =========================================================
   PLANCHAS: NUEVA (dos rutas soportadas)  GET
   /informacion/planchas/nueva  y  /informacion/planchas/nuevo
========================================================= */
async function renderNuevaPlancha(req, res, next) {
  try {
    res.render('informacion/plancha_form', {
      title   : 'Nueva plancha',
      registro: null
    });
  } catch (err) { next(err); }
}
router.get('/planchas/nueva', renderNuevaPlancha);
router.get('/planchas/nuevo', renderNuevaPlancha); // alias

/* =========================================================
   PLANCHAS: NUEVA  POST (dos rutas soportadas)
========================================================= */
async function crearPlancha(req, res, next) {
  try {
    const { nombre, imagen_url } = req.body;
    const imgCol = await getPlanchaImgColumn();

    if (imgCol) {
      await pool.query(
        `INSERT INTO planchas (nombre, \`${imgCol}\`) VALUES (?, ?)`,
        [nombre, imagen_url || null]
      );
    } else {
      await pool.query(`INSERT INTO planchas (nombre) VALUES (?)`, [nombre]);
    }

    res.redirect('/informacion/planchas');
  } catch (err) { next(err); }
}
router.post('/planchas/nueva', crearPlancha);
router.post('/planchas/nuevo', crearPlancha); // alias

/* =========================================================
   PLANCHAS: EDITAR  GET /informacion/planchas/:id/editar
========================================================= */
router.get('/planchas/:id/editar', async (req, res, next) => {
  try {
    const id = req.params.id;
    const imgCol = await getPlanchaImgColumn();

    const [[registro]] = await pool.query(`
      SELECT id, nombre, ${imgCol ? `\`${imgCol}\`` : 'NULL'} AS imagen
      FROM planchas
      WHERE id = ?
    `, [id]);

    if (!registro) return res.redirect('/informacion/planchas');

    res.render('informacion/plancha_form', {
      title   : `Editar plancha — ${registro.nombre}`,
      registro
    });
  } catch (err) { next(err); }
});

/* =========================================================
   PLANCHAS: EDITAR  POST /informacion/planchas/:id/editar
========================================================= */
router.post('/planchas/:id/editar', async (req, res, next) => {
  try {
    const id = req.params.id;
    const { nombre, imagen_url } = req.body;

    const imgCol = await getPlanchaImgColumn();

    if (imgCol) {
      await pool.query(
        `UPDATE planchas SET nombre = ?, \`${imgCol}\` = ? WHERE id = ?`,
        [nombre, imagen_url || null, id]
      );
    } else {
      await pool.query(`UPDATE planchas SET nombre = ? WHERE id = ?`, [nombre, id]);
    }

    res.redirect('/informacion/planchas');
  } catch (err) { next(err); }
});

/* =========================================================
   PLANCHAS: ELIMINAR  POST /informacion/planchas/:id/eliminar
   (si tu FK en info_sublimacion.plancha_id tiene ON DELETE CASCADE,
    se eliminan también sus combinaciones)
========================================================= */
router.post('/planchas/:id/eliminar', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM planchas WHERE id = ?', [req.params.id]);
    res.redirect('/informacion/planchas');
  } catch (err) { next(err); }
});


router.get('/planchas/:id/editar', async (req, res, next) => {
  try {
    const id = req.params.id;

    // detectar columna de imagen
    const [cols] = await pool.query(`
      SELECT column_name AS c
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'planchas'
        AND column_name IN ('imagen_url','imagen')
      ORDER BY FIELD(column_name,'imagen_url','imagen')
      LIMIT 1
    `);
    const imgCol = cols?.[0]?.c;

    const [[registro]] = await pool.query(`
      SELECT id, nombre, ${imgCol ? `\`${imgCol}\`` : 'NULL'} AS imagen
      FROM planchas
      WHERE id = ?
    `, [id]);

    if (!registro) return res.redirect('/informacion/planchas');

    res.render('informacion/plancha_form', {
      title   : `Editar plancha — ${registro.nombre}`,
      registro
    });
  } catch (err) { next(err); }
});

/* ====== PLANCHAS: EDITAR (POST) ====== */
router.post('/planchas/:id/editar', async (req, res, next) => {
  try {
    const id = req.params.id;
    const { nombre, imagen_url } = req.body;

    const [cols] = await pool.query(`
      SELECT column_name AS c
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'planchas'
        AND column_name IN ('imagen_url','imagen')
      ORDER BY FIELD(column_name,'imagen_url','imagen')
      LIMIT 1
    `);
    const imgCol = cols?.[0]?.c;

    if (imgCol) {
      await pool.query(
        `UPDATE planchas SET nombre = ?, \`${imgCol}\` = ? WHERE id = ?`,
        [nombre, imagen_url || null, id]
      );
    } else {
      await pool.query(`UPDATE planchas SET nombre = ? WHERE id = ?`, [nombre, id]);
    }

    res.redirect('/informacion/planchas');
  } catch (err) { next(err); }
});

/* ====== PLANCHAS: ELIMINAR (POST) ====== */
router.post('/planchas/:id/eliminar', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM planchas WHERE id = ?', [req.params.id]);
    res.redirect('/informacion/planchas');
  } catch (err) { next(err); }
});

module.exports = router;
