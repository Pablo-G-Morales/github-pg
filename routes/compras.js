// routes/compras.js
const express = require('express');
const router  = express.Router();

/* --- Middleware reutilizado --- */
function isAuthenticated (req, res, next) {
  if (req.session.user) return next();
  res.redirect('/');
}

/* ---------- MENÚ PRINCIPAL ---------- */
router.get('/', isAuthenticated, (req, res) => {
  res.render('compras', { title: 'Compras' });
});

/* ---------- Compra de nuevo producto ---------- */
router.get('/nuevo-producto', isAuthenticated, (req, res) => {
  res.render('compras/nuevo_producto', { title: 'Compra de nuevo producto' });
});

/* ---------- Compra de insumos ---------- */
router.get('/insumos', isAuthenticated, (req, res) => {
  res.render('compras/insumos', { title: 'Compra de insumos' });
});

module.exports = router;
