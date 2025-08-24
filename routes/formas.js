const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/');
}

/* ---------- LISTA ---------- */
router.get('/', isAuthenticated, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM formas ORDER BY nombre');
  res.render('inventario/formas_list', {
    title: 'Formas',
    formas: rows
  });
});

/* ---------- NUEVO ---------- */
router.get('/nuevo', isAuthenticated, (req, res) => {
  res.render('inventario/formas_form', {
    title: 'Nueva forma',
    forma: { id: 0, nombre: '', descripcion: '' }
  });
});

router.post('/nuevo', isAuthenticated, async (req, res) => {
  const { nombre, descripcion } = req.body;
  const uid = req.session.user.id;
  await pool.query(
    'INSERT INTO formas (nombre, descripcion, creado_por, actualizado_por) VALUES (?,?,?,?)',
    [nombre, descripcion, uid, uid]
  );
  res.redirect('/inventario/formas');
});

/* ---------- EDITAR ---------- */
router.get('/:id/editar', isAuthenticated, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM formas WHERE id=?', [req.params.id]);
  if (!rows.length) return res.redirect('/inventario/formas');
  res.render('inventario/formas_form', {
    title: 'Editar forma',
    forma: rows[0]
  });
});

router.post('/:id/editar', isAuthenticated, async (req, res) => {
  const { nombre, descripcion } = req.body;
  const uid = req.session.user.id;
  await pool.query(
    `UPDATE formas
       SET nombre=?, descripcion=?, actualizado_por=?, actualizado_en=NOW()
     WHERE id=?`,
    [nombre, descripcion, uid, req.params.id]
  );
  res.redirect('/inventario/formas');
});

/* ---------- FICHA ---------- */
router.get('/:id', isAuthenticated, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT f.*,
            uc.nombre AS creado_por_nombre,
            uu.nombre AS actualizado_por_nombre
     FROM formas f
     LEFT JOIN usuarios uc ON uc.id = f.creado_por
     LEFT JOIN usuarios uu ON uu.id = f.actualizado_por
     WHERE f.id = ?`, [req.params.id]);

  if (!rows.length) return res.redirect('/inventario/formas');

  res.render('inventario/formas_ficha', {
    title: 'Ficha forma',
    forma: rows[0]
  });
});

module.exports = router;
