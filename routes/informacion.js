const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

/* -------------------------------------------------
   Helpers
------------------------------------------------- */
const logAccion = async ({ parametroId, accion, prev, next, userId }) => {
  await pool.query('INSERT INTO sublimacion_parametros_log SET ?', {
    parametro_id  : parametroId,
    accion,
    usuario_id    : userId || null,
    datos_previos : prev ? JSON.stringify(prev) : null,
    datos_nuevos  : next ? JSON.stringify(next) : null
  });
};

/* -------------------------------------------------
   Rutas CRUD  |  Base: /informacion
------------------------------------------------- */

/* ► Listado */
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT sp.*, p.nombre AS plancha, p.imagen
      FROM   sublimacion_parametros sp
      JOIN   planchas p ON p.id = sp.plancha_id
      ORDER  BY sp.id DESC
    `);
    res.render('informacion/parametros_lista', {
      datos : rows,
      title : 'Parámetros de sublimación'
    });
  } catch (e) { next(e); }
});

/* ► Formulario crear */
router.get('/nuevo', async (_, res, next) => {
  try {
    const [planchas] = await pool.query('SELECT id, nombre FROM planchas ORDER BY nombre');
    res.render('informacion/parametros_form', {
      registro : {},
      planchas,
      title    : 'Nuevo parámetro'
    });
  } catch (e) { next(e); }
});

/* ► Crear */
router.post('/nuevo', async (req, res, next) => {
  try {
    const data = {
      plancha_id  : req.body.plancha_id,
      temperatura : req.body.temperatura,
      tiempo      : req.body.tiempo
    };
    const [result] = await pool.query('INSERT INTO sublimacion_parametros SET ?', [data]);

    await logAccion({
      parametroId : result.insertId,
      accion      : 'CREAR',
      next        : data,
      userId      : req.session?.user?.id
    });

    res.redirect('/informacion');
  } catch (e) { next(e); }
});

/* ► Formulario editar */
router.get('/:id/editar', async (req, res, next) => {
  try {
    const id = req.params.id;
    const [[registro]] = await pool.query(`
      SELECT * FROM sublimacion_parametros WHERE id = ?`, [id]);
    if (!registro) return res.redirect('/informacion');

    const [planchas] = await pool.query('SELECT id, nombre FROM planchas ORDER BY nombre');

    res.render('informacion/parametros_form', {
      registro,
      planchas,
      title : 'Editar parámetro'
    });
  } catch (e) { next(e); }
});

/* ► Actualizar */
router.post('/:id/editar', async (req, res, next) => {
  try {
    const id = req.params.id;
    const [[prev]] = await pool.query('SELECT * FROM sublimacion_parametros WHERE id = ?', [id]);
    if (!prev) return res.redirect('/informacion');

    const updates = {
      plancha_id  : req.body.plancha_id,
      temperatura : req.body.temperatura,
      tiempo      : req.body.tiempo
    };

    await pool.query('UPDATE sublimacion_parametros SET ? WHERE id = ?', [updates, id]);

    await logAccion({
      parametroId : id,
      accion      : 'ACTUALIZAR',
      prev,
      next        : { ...prev, ...updates },
      userId      : req.session?.user?.id
    });

    res.redirect('/informacion');
  } catch (e) { next(e); }
});

/* ► Eliminar */
router.post('/:id/eliminar', async (req, res, next) => {
  try {
    const id = req.params.id;
    const [[prev]] = await pool.query('SELECT * FROM sublimacion_parametros WHERE id = ?', [id]);
    if (!prev) return res.redirect('/informacion');

    await pool.query('DELETE FROM sublimacion_parametros WHERE id = ?', [id]);

    await logAccion({
      parametroId : id,
      accion      : 'ELIMINAR',
      prev,
      userId      : req.session?.user?.id
    });

    res.redirect('/informacion');
  } catch (e) { next(e); }
});

module.exports = router;
