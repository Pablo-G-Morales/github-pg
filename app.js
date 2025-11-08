// app.js
require('dotenv').config();

const express    = require('express');
const session    = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path       = require('path');
const pool       = require('./config/db');

const app  = express();
const PORT = process.env.PORT || 3000;

/* =========================
   Rutas (imports)
========================= */
const authRouter                     = require('./routes/auth');
const usuariosRouter                 = require('./routes/usuarios');
const perfilRouter                   = require('./routes/perfil');

/* INVENTARIO ─ sub-módulos */
const inventarioRouter               = require('./routes/inventario');
const coloresRouter                  = require('./routes/colores');
const materialesRouter               = require('./routes/materiales');
const formasRouter                   = require('./routes/formas');
const unidadesRouter                 = require('./routes/unidades');
const proveedoresRouter              = require('./routes/proveedores');
const marcasRouter                   = require('./routes/marcas');
const bodegasRouter                  = require('./routes/bodegas');
const productosRouter                = require('./routes/productos');
const invProdRouter                  = require('./routes/inventario_producto');
const stockRouter                    = require('./routes/stock');

/* INFORMACIÓN */
const informacionRouter              = require('./routes/informacion');

/* COMPRAS / CATÁLOGOS */
const comprasV2Router                = require('./routes/compras_v2');
const comprasV3Router                = require('./routes/compras_v3');
const compras1Router                 = require('./routes/compras1');
const comprasAutorizarRouter         = require('./routes/compras_autorizar');
const comprasV4Router                = require('./routes/compras_v4');
const comprasFacturasRouter          = require('./routes/compras_facturas');
const comprasDevolucionesRouter      = require('./routes/compras_devoluciones');

const catalogosTiposDocumentoRouter  = require('./routes/catalogos_tipos_documento');
const catalogosFormasPagoRouter      = require('./routes/catalogos_formas_pago');
const catalogosCondicionesPagoRouter = require('./routes/catalogos_condiciones_pago');

/* PEDIDOS */
const pedidos1Router                 = require('./routes/pedidos1');
const pedidosDeptosRouter            = require('./routes/pedidos_deptos');
const pedidosMunicipiosRouter        = require('./routes/pedidos_municipios');
const pedidosTiendaRouter            = require('./routes/pedidos_tienda'); // legacy
const pedidosRouter                  = require('./routes/pedidos');        // ← el bueno
const pedidosAutorizarRouter         = require('./routes/pedidos_autorizar');
const devolucionesVentasRouter = require('./routes/devoluciones_ventas');
/* Ventas */
const ventasRouter = require('./routes/ventas');   // <— NUEVO
const disenosRouter = require('./routes/disenos');
const insumosDesc = require('./routes/insumos_descuento');
/* Imagen */
const dashImgs = require('./routes/dashboard_imagenes');
const adminContactos = require('./routes/admin_contactos');


/* =========================
   Config básica
========================= */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* =========================
   Sesión
========================= */
app.use(session({
  key   : 'sublirex.sid',
  secret: process.env.SESSION_SECRET || 'Sblx_Secret_123',
  store : new MySQLStore({}, pool),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 } // 1 hora
}));

/* =========================
   Variables globales (usuario logueado)
========================= */
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

/* =========================
   Rutas públicas
========================= */
app.use('/',         authRouter);
app.use('/usuarios', usuariosRouter);
app.use('/perfil',   perfilRouter);

/* =========================
   INVENTARIO (rutas específicas primero)
========================= */
app.use('/inventario/stock',       stockRouter);
app.use('/inventario/productos',   productosRouter);
app.use('/inventario/productos',   invProdRouter);
app.use('/inventario/colores',     coloresRouter);
app.use('/inventario/materiales',  materialesRouter);
app.use('/inventario/formas',      formasRouter);
app.use('/inventario/unidades',    unidadesRouter);
app.use('/inventario/proveedores', proveedoresRouter);
app.use('/inventario/marcas',      marcasRouter);
app.use('/inventario/bodegas',     bodegasRouter);
app.use('/inventario',             inventarioRouter);

/* =========================
   COMPRAS (orden correcto)
========================= */
app.use('/compras-v2', comprasV2Router);
app.use('/compras-v3', comprasV3Router);
app.use('/compras',    comprasV2Router); // alias

// Flujos avanzados de compras (autorizar / v4 / devoluciones / facturas)
app.use('/compras-v4', comprasAutorizarRouter);    // autorizar/facturas (flujo de completar)
app.use('/compras-v4', comprasV4Router);           // compras principales (tienda, ficha)
app.use('/compras-v4', comprasDevolucionesRouter); // devoluciones de compras
app.use('/compras-v4', comprasFacturasRouter);     // listado/ficha de facturas

// Menú visual o versiones antiguas
app.use('/compras1', compras1Router);

/* =========================
   CATÁLOGOS
========================= */
app.use('/catalogos/tipos-documento',  catalogosTiposDocumentoRouter);
app.use('/catalogos/formas-pago',      catalogosFormasPagoRouter);
app.use('/catalogos/condiciones-pago', catalogosCondicionesPagoRouter);

/* =========================
   PEDIDOS
========================= */
// versiones antiguas bajo otra base para que NO tapen las rutas buenas
app.use('/pedidos1',          pedidos1Router);
app.use('/pedidos/departamentos', pedidosDeptosRouter);
app.use('/pedidos/municipios',    pedidosMunicipiosRouter);
app.use('/pedidos-legacy',     pedidosTiendaRouter); // ← antes estaba en '/pedidos'
app.use('/pedidos',            pedidosRouter);       // ← único router en '/pedidos'
app.use('/pedidos',            pedidosAutorizarRouter);
app.use('/devoluciones-ventas', devolucionesVentasRouter);
app.use('/', disenosRouter);
app.use('/insumos', insumosDesc);

/* =========================
   INFORMACIÓN
========================= */
app.use('/informacion', informacionRouter);

/* =========================
   VENTAS
========================= */
app.use('/ventas',             ventasRouter); 

/* =========================
   ADMIN
========================= */
app.use('/', dashImgs);
app.use('/', adminContactos);

/* =========================
   404 y errores
========================= */
app.use((req, res) => {
  res.status(404).render('404', { url: req.originalUrl });
});

app.use((err, req, res, _next) => {
  console.error('🚨 Error:', err);
  res.status(500).render('500', { error: err });
});

/* =========================
   Servidor
========================= */
app.listen(PORT, () => {
  console.log(`✅ SubliRex ejecutándose en http://localhost:${PORT}`);
});
