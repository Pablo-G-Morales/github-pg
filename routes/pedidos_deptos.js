// routes/pedidos_deptos.js
const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

/* ===== Auth ===== */
function isAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}

/* ========== LISTA ========== */
// GET /pedidos/departamentos
router.get('/', isAuth, async (_req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT d.id, d.nombre,
             d.creado_en,
             u.nombre AS creado_por_nombre
      FROM departamentos d
      LEFT JOIN usuarios u ON u.id = d.creado_por_id
      ORDER BY d.id DESC
    `);
    res.render('pedidos/departamentos_list', {
      title: 'Departamentos',
      items: rows
    });
  } catch (e) { next(e); }
});

/* ========== NUEVO ========== */
// GET /pedidos/departamentos/nuevo
router.get('/nuevo', isAuth, (_req, res) => {
  res.render('pedidos/departamentos_new', {
    title: 'Nuevo departamento'
  });
});

// POST /pedidos/departamentos/nuevo
router.post('/nuevo', isAuth, async (req, res, next) => {
  try {
    const nombre = (req.body.nombre || '').trim();
    if (!nombre) return res.status(400).send('El nombre es obligatorio.');

    // unicidad
    const [[exists]] = await pool.query('SELECT id FROM departamentos WHERE nombre=?', [nombre]);
    if (exists) return res.status(400).send('Ya existe un departamento con ese nombre.');

    await pool.query(`
      INSERT INTO departamentos (nombre, creado_por_id)
      VALUES (?, ?)
    `, [nombre, req.session.user.id]);

    res.redirect('/pedidos/departamentos');
  } catch (e) { next(e); }
});

/* ========== FICHA ========== */
// GET /pedidos/departamentos/:id
router.get('/:id(\\d+)', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[dep]] = await pool.query(`
      SELECT d.*,
             uc.nombre AS creado_por_nombre,
             ua.nombre AS actualizado_por_nombre
      FROM departamentos d
      LEFT JOIN usuarios uc ON uc.id = d.creado_por_id
      LEFT JOIN usuarios ua ON ua.id = d.actualizado_por_id
      WHERE d.id=?
    `, [id]);

    if (!dep) return res.redirect('/pedidos/departamentos');

    res.render('pedidos/departamentos_show', {
      title: `Departamento #${dep.id}`,
      dep
    });
  } catch (e) { next(e); }
});

/* ========== EDITAR ========== */
// GET /pedidos/departamentos/:id/editar
router.get('/:id(\\d+)/editar', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[dep]] = await pool.query('SELECT * FROM departamentos WHERE id=?', [id]);
    if (!dep) return res.redirect('/pedidos/departamentos');

    res.render('pedidos/departamentos_edit', {
      title: `Editar departamento #${dep.id}`,
      dep
    });
  } catch (e) { next(e); }
});

// POST /pedidos/departamentos/:id/editar
router.post('/:id(\\d+)/editar', isAuth, async (req, res, next) => {
  try {
    const id     = Number(req.params.id);
    const nombre = (req.body.nombre || '').trim();
    if (!nombre) return res.status(400).send('El nombre es obligatorio.');

    // unicidad (excluyendo el mismo id)
    const [[exists]] = await pool.query(
      'SELECT id FROM departamentos WHERE nombre=? AND id<>?',
      [nombre, id]
    );
    if (exists) return res.status(400).send('Ya existe un departamento con ese nombre.');

    await pool.query(
      `UPDATE departamentos
          SET nombre=?, actualizado_por_id=?, actualizado_en=NOW()
        WHERE id=?`,
      [nombre, req.session.user.id, id]
    );

    res.redirect(`/pedidos/departamentos/${id}`);
  } catch (e) { next(e); }
});

module.exports = router;
