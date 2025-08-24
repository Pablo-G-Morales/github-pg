const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

/* ---------- Middleware de seguridad ---------- */
function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/');
}

/* ---------- LISTAR ---------- */
router.get('/', isAuthenticated, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM colores ORDER BY nombre');
  res.render('inventario/colores_list', {
    title: 'Colores',
    colores: rows
  });
});

/* ---------- NUEVO ---------- */
router.get('/nuevo', isAuthenticated, (req, res) => {
  res.render('inventario/colores_form', {
    title: 'Nuevo color',
    color: { id: 0, nombre: '', hex: '#000000' }
  });
});

router.post('/nuevo', isAuthenticated, async (req, res) => {
  const { nombre, hex } = req.body;
  await pool.query(
    'INSERT INTO colores (nombre, hex, creado_por, actualizado_por) VALUES (?,?,?,?)',
    [nombre, hex, req.session.user.id, req.session.user.id]
  );
  res.redirect('/inventario/colores');
});

/* ---------- EDITAR ---------- */
router.get('/:id/editar', isAuthenticated, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM colores WHERE id=?', [req.params.id]);
  if (!rows.length) return res.redirect('/inventario/colores');
  res.render('inventario/colores_form', {
    title: 'Editar color',
    color: rows[0]
  });
});

router.post('/:id/editar', isAuthenticated, async (req, res) => {
  const { nombre, hex } = req.body;
  await pool.query(
    `UPDATE colores
       SET nombre=?, hex=?, actualizado_por=?, actualizado_en=NOW()
     WHERE id=?`,
    [nombre, hex, req.session.user.id, req.params.id]
  );
  res.redirect('/inventario/colores');
});

module.exports = router;
