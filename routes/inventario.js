const express = require('express');
const router = express.Router();

// Middleware opcional para proteger acceso
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/');
  }
}

// Ruta principal del módulo de inventario
router.get('/', isAuthenticated, (req, res) => {
  res.render('inventario', {
    title: 'Inventario - SubliRex',
    user: req.session.user   // 🔴 aquí estás enviando user
  });
});

module.exports = router;
