const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/');
}

/* ---------- LISTAR ---------- */
router.get('/', isAuthenticated, async (_, res) => {
  const [rows] = await pool.query('SELECT * FROM unidades ORDER BY nombre');
  res.render('inventario/unidades_list', {
    title: 'Unidades',
    unidades: rows
  });
});

/* ---------- NUEVA ---------- */
router.get('/nueva', isAuthenticated, (_, res) => {
  res.render('inventario/unidades_form', {
    title: 'Nueva unidad',
    unidad: { id: 0, nombre: '', simbolo: '' }
  });
});

router.post('/nueva', isAuthenticated, async (req, res) => {
  const { nombre, simbolo } = req.body;
  const uid = req.session.user.id;
  await pool.query(
    'INSERT INTO unidades (nombre, simbolo, creado_por, actualizado_por) VALUES (?,?,?,?)',
    [nombre, simbolo, uid, uid]
  );
  res.redirect('/inventario/unidades');
});

/* ---------- EDITAR ---------- */
router.get('/:id/editar', isAuthenticated, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM unidades WHERE id=?', [req.params.id]);
  if (!rows.length) return res.redirect('/inventario/unidades');
  res.render('inventario/unidades_form', {
    title: 'Editar unidad',
    unidad: rows[0]
  });
});

router.post('/:id/editar', isAuthenticated, async (req, res) => {
  const { nombre, simbolo } = req.body;
  const uid = req.session.user.id;
  await pool.query(
    `UPDATE unidades
       SET nombre=?, simbolo=?, actualizado_por=?, actualizado_en=NOW()
     WHERE id=?`,
    [nombre, simbolo, uid, req.params.id]
  );
  res.redirect('/inventario/unidades');
});

/* ---------- FICHA ---------- */
router.get('/:id', isAuthenticated, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.*,
            uc.nombre AS creado_por_nombre,
            uu.nombre AS actualizado_por_nombre
     FROM unidades u
     LEFT JOIN usuarios uc ON uc.id = u.creado_por
     LEFT JOIN usuarios uu ON uu.id = u.actualizado_por
     WHERE u.id = ?`, [req.params.id]);

  if (!rows.length) return res.redirect('/inventario/unidades');

  res.render('inventario/unidades_ficha', {
    title: 'Ficha unidad',
    unidad: rows[0]
  });
});

module.exports = router;
