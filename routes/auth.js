const express = require('express');
const bcrypt  = require('bcrypt');
const pool    = require('../config/db');

const router = express.Router();

/* ---------- Middlewares reutilizables ---------- */
function isAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/');
}

function isAdmin(req, res, next) {
  if (req.session.user?.rol_id === 1) return next();
  return res.redirect('/dashboard');
}

/* ---------- Página de login ---------- */
router.get('/', (req, res) => {
  if (req.session.user) {
    // redirige según rol
    return req.session.user.rol_id === 1
      ? res.redirect('/usuarios')
      : res.redirect('/dashboard');
  }
  res.render('login', { error: null });
});

/* ---------- Procesar login ---------- */
router.post('/login', async (req, res) => {
  const { usuario, contrasena } = req.body;

  try {
    const [rows] = await pool.query(`
      SELECT u.*, r.nombre AS rol_nombre, e.nombre AS estado_nombre
        FROM usuarios u
        JOIN roles  r ON r.id = u.rol_id
        JOIN estado e ON e.id = u.estado_id
       WHERE u.usuario = ?
       LIMIT 1
    `, [usuario]);

    if (!rows.length) {
      return res.render('login', { error: 'Usuario no existe' });
    }

    const user = rows[0];

    if (user.estado_nombre !== 'Habilitado') {
      return res.render('login', { error: 'Usuario inhabilitado. Contacte al administrador.' });
    }

    const ok = await bcrypt.compare(contrasena, user.contrasena);
    if (!ok) {
      return res.render('login', { error: 'Contraseña incorrecta' });
    }

    /* Guardamos en sesión (sin password ni blob) */
    const { contrasena: _p, foto_perfil, ...safeUser } = user;
    req.session.user = { ...safeUser };

    return user.rol_id === 1
      ? res.redirect('/usuarios')
      : res.redirect('/dashboard');

  } catch (err) {
    console.error(err);
    return res.render('login', { error: 'Error interno' });
  }
});

/* ---------- Logout ---------- */
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

/* ---------- Dashboard ---------- */
router.get('/dashboard', isAuth, (req, res) => {
  res.render('dashboard', { user: req.session.user });
});

module.exports = router;
