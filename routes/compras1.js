// routes/compras1.js
const express = require('express');
const router = express.Router();

// Menú principal de compras
router.get('/', (req, res) => {
  res.render('compras1', { title: 'Menú de Compras' });
});

module.exports = router;
