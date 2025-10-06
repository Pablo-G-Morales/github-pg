const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');
const PDFDocument = require('pdfkit');        // ← si luego quieres PDF

/* ─── middleware simple de sesión ─── */
function isAuth (req, res, next){
  if (req.session.user) return next();
  res.redirect('/');
}

/* ╔══════════════════════════════════╗
   ║  LISTADO GENERAL                 ║
   ╚══════════════════════════════════╝ */
router.get('/', isAuth, async (_, res, next) => {
  try{
    const [ordenes] = await pool.query(`
      SELECT o.id,
             DATE_FORMAT(o.fecha_hora,'%d/%m/%Y %H:%i') AS fecha,
             prov.nombre  AS proveedor,
             IFNULL(SUM(i.cantidad * i.precio_unitario),0) AS total
        FROM compras_ordenes o
        JOIN proveedores prov          ON prov.id = o.proveedor_id
   LEFT JOIN compras_ordenes_items i  ON i.orden_id = o.id
    GROUP BY o.id, fecha, proveedor
    ORDER BY o.id DESC
    `);
    res.render('compras/ordenes_list', { title:'Órdenes', ordenes });
  }catch(e){ next(e); }
});

/* ╔══════════════════════════════════╗
   ║  FORMULARIO NUEVO                ║
   ╚══════════════════════════════════╝ */
router.get('/nuevo', isAuth, async (_, res, next) => {
  try{
    const [proveedores] = await pool.query('SELECT id,nombre FROM proveedores ORDER BY nombre');
    const [insumos]     = await pool.query('SELECT id,nombre,precio_estandar FROM insumos ORDER BY nombre');
    res.render('compras/ordenes_form', {
      title:'Nueva orden',
      proveedores, insumos, flash:null
    });
  }catch(e){ next(e); }
});

/* ╔══════════════════════════════════╗
   ║  GUARDAR NUEVA ORDEN             ║
   ╚══════════════════════════════════╝ */
router.post('/nuevo', isAuth, async (req,res,next)=>{
  const { proveedor_id, lineas } = req.body; // lineas será JSON string
  if(!lineas || !proveedor_id){
    const [proveedores] = await pool.query('SELECT id,nombre FROM proveedores ORDER BY nombre');
    const [insumos]     = await pool.query('SELECT id,nombre,precio_estandar FROM insumos ORDER BY nombre');
    return res.render('compras/ordenes_form', {
      title:'Nueva orden', proveedores, insumos,
      flash:'Seleccione proveedor y añada al menos una línea'
    });
  }
  const items = JSON.parse(lineas);
  const conn  = await pool.getConnection();
  try{
    await conn.beginTransaction();

    const [result] = await conn.query(`
      INSERT INTO compras_ordenes
        (proveedor_id, fecha_hora, creado_por, actualizado_por)
      VALUES (?,?,?,?)`,
      [proveedor_id, new Date(), req.session.user.id, req.session.user.id]);
    const ordenId = result.insertId;

    /* insertar ítems */
    for(const it of items){
      await conn.query(`
        INSERT INTO compras_ordenes_items
          (orden_id, insumo_id, cantidad, precio_unitario)
        VALUES (?,?,?,?)`,
        [ordenId, it.insumo_id, it.cantidad, it.precio_unitario]);
    }

    await conn.commit();
    res.redirect('/compras/ordenes/'+ordenId);
  }catch(e){
    await conn.rollback();
    next(e);
  }finally{
    conn.release();
  }
});

/* ╔══════════════════════════════════╗
   ║  FICHA DETALLE                   ║
   ╚══════════════════════════════════╝ */
router.get('/:id', isAuth, async (req,res,next)=>{
  try{
    const [cabRows] = await pool.query(`
      SELECT o.*,
             DATE_FORMAT(o.fecha_hora,'%d/%m/%Y %H:%i') AS fecha_hora_fmt,
             prov.nombre AS proveedor
        FROM compras_ordenes o
        JOIN proveedores prov ON prov.id = o.proveedor_id
       WHERE o.id = ?`, [req.params.id]);
    if(!cabRows.length) return res.redirect('/compras/ordenes');

    const [items] = await pool.query(`
      SELECT i.*, ins.nombre AS insumo
        FROM compras_ordenes_items i
        JOIN insumos ins ON ins.id = i.insumo_id
       WHERE i.orden_id = ?`, [req.params.id]);

    res.render('compras/ordenes_ficha', {
      title:'Ficha orden',
      orden: cabRows[0], items
    });
  }catch(e){ next(e); }
});

/* ╔══════════════════════════════════╗
   ║  PDF (opcional)                  ║
   ╚══════════════════════════════════╝ */
router.get('/:id/pdf', isAuth, async (req,res,next)=>{
  try{
    const [[o]]  = await pool.query(`
      SELECT o.id,
             DATE_FORMAT(o.fecha_hora,'%d/%m/%Y %H:%i') AS fecha,
             prov.nombre AS proveedor
        FROM compras_ordenes o
        JOIN proveedores prov ON prov.id = o.proveedor_id
       WHERE o.id=?`, [req.params.id]);
    if(!o) return res.redirect('/compras/ordenes');

    const [items] = await pool.query(`
      SELECT ins.nombre AS insumo,
             i.cantidad, i.precio_unitario,
             (i.cantidad * i.precio_unitario) AS subtotal
        FROM compras_ordenes_items i
        JOIN insumos ins ON ins.id = i.insumo_id
       WHERE i.orden_id=?`, [req.params.id]);

    /* -- generar PDF muy simple -- */
    const doc = new PDFDocument({ margin:40 });
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`inline; filename=orden_${o.id}.pdf`);
    doc.pipe(res);

    doc.fontSize(16).text(`Orden de compra #${o.id}`, {align:'center'});
    doc.moveDown();
    doc.fontSize(12).text(`Fecha: ${o.fecha}`);
    doc.text(`Proveedor: ${o.proveedor}`);
    doc.moveDown();
    doc.text('Detalle:', {underline:true});
    doc.moveDown(0.5);

    items.forEach(it=>{
      doc.text(`${it.cantidad} x ${it.insumo} @ Q${it.precio_unitario}  =  Q${(it.cantidad*it.precio_unitario).toFixed(2)}`);
    });
    doc.end();

  }catch(e){ next(e); }
});

module.exports = router;
