// routes/admin_contactos.js
const express = require('express');
const router  = express.Router();

/* Reutiliza tus middlewares reales si los tienes en otro archivo */
function isAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}
function isAdmin(req, res, next) {
  if (req.session?.user?.rol_id === 1) return next();
  return res.status(403).send('Solo administrador');
}

/* GET /admin/contactos (informativa) */
router.get('/admin/contactos', isAuth, isAdmin, (req, res) => {
  const contact = {
    nombre: 'SubliRex - Soporte',
    email : process.env.CONTACT_EMAIL || 'soporte@sublirex.com',
    phone : process.env.CONTACT_PHONE || '+502 0000 0000',
    // Mensaje inicial de WhatsApp (puedes editarlo)
    waText: encodeURIComponent('Hola, necesito soporte de SubliRex.')
  };

  // Normalizar número para WhatsApp: solo dígitos (ej: 50255551234)
  const waNumber = (process.env.CONTACT_PHONE_WHATSAPP || contact.phone)
    .replace(/[^\d]/g, '');

  res.render('admin/contactos', {
    title: 'Contactos',
    contact,
    waNumber
  });
});

module.exports = router;
