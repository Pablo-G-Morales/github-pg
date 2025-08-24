// insertAdmin.js
const bcrypt = require('bcrypt');
const pool = require('./config/db');

async function crearAdmin() {
  const password = '123456';
  const hash = await bcrypt.hash(password, 10);

  const sql = `
    INSERT INTO usuarios (nombre, apellido, usuario, contrasena, rol_id)
    VALUES (?, ?, ?, ?, ?)
  `;

  try {
    const [result] = await pool.query(sql, [
      'Pablo',
      'Morales',
      'admin',
      hash,
      1
    ]);
    console.log('✅ Usuario administrador creado con ID:', result.insertId);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error al crear el admin:', err);
    process.exit(1);
  }
}

crearAdmin();
