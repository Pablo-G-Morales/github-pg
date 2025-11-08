// routes/pedidos1.js
const express = require('express');
const router  = express.Router();

/* Autenticación básica (igual que en otros módulos) */
function isAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}

/* Página principal de Pedidos (menú) */
router.get('/', isAuth, (req, res) => {
  res.render('pedidos/pedidos1', {
    title: 'Pedidos',
    user : req.session.user || null
  });
});

module.exports = router;
