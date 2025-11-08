// routes/pedidos_municipios.js
const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

/* ===== Auth ===== */
function isAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}

/* ========== LISTA ========== */
// GET /pedidos/municipios
router.get('/', isAuth, async (_req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT m.id, m.nombre AS municipio_nombre, m.creado_en,
             d.nombre AS departamento_nombre,
             u.nombre AS creado_por_nombre
      FROM municipios m
      LEFT JOIN departamentos d ON d.id = m.departamento_id
      LEFT JOIN usuarios u      ON u.id = m.creado_por_id
      ORDER BY m.id DESC
    `);
    res.render('pedidos/municipios_list', {
      title: 'Municipios',
      items: rows
    });
  } catch (e) { next(e); }
});

/* ========== NUEVO ========== */
// GET /pedidos/municipios/nuevo
router.get('/nuevo', isAuth, async (_req, res, next) => {
  try {
    const [deps] = await pool.query(`SELECT id, nombre FROM departamentos ORDER BY nombre`);
    res.render('pedidos/municipios_new', {
      title: 'Nuevo municipio',
      departamentos: deps
    });
  } catch (e) { next(e); }
});

// POST /pedidos/municipios/nuevo
router.post('/nuevo', isAuth, async (req, res, next) => {
  try {
    const departamento_id = Number(req.body.departamento_id);
    const nombre = (req.body.nombre || '').trim();
    if (!departamento_id || !nombre) return res.status(400).send('Departamento y nombre son obligatorios.');

    // unicidad por departamento
    const [[exists]] = await pool.query(
      `SELECT id FROM municipios WHERE departamento_id=? AND nombre=?`,
      [departamento_id, nombre]
    );
    if (exists) return res.status(400).send('Ya existe un municipio con ese nombre en el departamento seleccionado.');

    await pool.query(`
      INSERT INTO municipios (departamento_id, nombre, creado_por_id)
      VALUES (?, ?, ?)
    `, [departamento_id, nombre, req.session.user.id]);

    res.redirect('/pedidos/municipios');
  } catch (e) { next(e); }
});

/* ========== FICHA ========== */
// GET /pedidos/municipios/:id
router.get('/:id(\\d+)', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[muni]] = await pool.query(`
      SELECT m.*,
             d.nombre AS departamento_nombre,
             uc.nombre AS creado_por_nombre,
             ua.nombre AS actualizado_por_nombre
      FROM municipios m
      LEFT JOIN departamentos d ON d.id = m.departamento_id
      LEFT JOIN usuarios uc     ON uc.id = m.creado_por_id
      LEFT JOIN usuarios ua     ON ua.id = m.actualizado_por_id
      WHERE m.id=?
    `, [id]);

    if (!muni) return res.redirect('/pedidos/municipios');

    res.render('pedidos/municipios_show', {
      title: `Municipio #${muni.id}`,
      muni
    });
  } catch (e) { next(e); }
});

/* ========== EDITAR ========== */
// GET /pedidos/municipios/:id/editar
router.get('/:id(\\d+)/editar', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[muni]] = await pool.query(`SELECT * FROM municipios WHERE id=?`, [id]);
    if (!muni) return res.redirect('/pedidos/municipios');

    const [deps] = await pool.query(`SELECT id, nombre FROM departamentos ORDER BY nombre`);

    res.render('pedidos/municipios_edit', {
      title: `Editar municipio #${muni.id}`,
      muni,
      departamentos: deps
    });
  } catch (e) { next(e); }
});

// POST /pedidos/municipios/:id/editar
router.post('/:id(\\d+)/editar', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const departamento_id = Number(req.body.departamento_id);
    const nombre = (req.body.nombre || '').trim();

    if (!departamento_id || !nombre) return res.status(400).send('Departamento y nombre son obligatorios.');

    // unicidad por departamento (excluyendo este id)
    const [[exists]] = await pool.query(
      `SELECT id FROM municipios WHERE departamento_id=? AND nombre=? AND id<>?`,
      [departamento_id, nombre, id]
    );
    if (exists) return res.status(400).send('Ya existe un municipio con ese nombre en el departamento seleccionado.');

    await pool.query(`
      UPDATE municipios
         SET departamento_id=?, nombre=?, actualizado_por_id=?, actualizado_en=NOW()
       WHERE id=?
    `, [departamento_id, nombre, req.session.user.id, id]);

    res.redirect(`/pedidos/municipios/${id}`);
  } catch (e) { next(e); }
});

module.exports = router;
