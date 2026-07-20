// server.js
// Backend de un TIERLIST de PvP de Minecraft (Sword, NethPot, UHC)
// Incluye: regiones (NA/SA/EU), tiers (HT1...LT5), sistema de puntos,
// tier general, integración con API de Mojang + ruta propia para heads,
// sistema de cuentas con roles admin/usuario y registro de tests normales/High Tests.

const express = require('express');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve('./public')));

const PORT = process.env.PORT || 8040;

const playersFile = './players.json';
const cuentasFile = './cuentas.json';
const testsFile = './tests.json';
const settingsFile = './settings.json';

// =====================================================================
// --- CONFIGURACIÓN DEL TIERLIST ---
// =====================================================================

const REGIONES = ['NA', 'SA', 'EU'];

const GAMEMODES = ['sword', 'nethpot', 'uhc'];

const GAMEMODES_NOMBRE = {
    sword: 'Sword',
    nethpot: 'NethPot',
    uhc: 'UHC'
};

const TIERS_ORDEN = [
    'HT1',
    'LT1',
    'HT2',
    'LT2',
    'HT3',
    'LT3',
    'HT4',
    'LT4',
    'HT5',
    'LT5'
];

// Tests normales: desde LT5 hasta LT3.
const TIERS_TEST_NORMAL = [
    'LT5',
    'HT5',
    'LT4',
    'HT4',
    'LT3'
];

// High Tests: el jugador retado debe ser LT3 o superior.
const TIERS_HIGH_TEST = [
    'LT3',
    'HT3',
    'LT2',
    'HT2',
    'LT1',
    'HT1'
];

const TEST_EVALS = ['PASSED', 'FAILED'];
const TEST_RESULTS = ['PASSED', 'FAILED'];
const TEST_OUTCOMES = ['WON', 'LOST'];

// Cuando el retado falla la evaluación, baja un tier.
const DEMOCION_HIGH_TEST = {
    HT1: 'LT1',
    LT1: 'HT2',
    HT2: 'LT2',
    LT2: 'HT3',
    HT3: 'LT3',
    LT3: 'HT4'
};

const PUNTOS_POR_TIER = {
    HT1: 60,
    LT1: 40,
    HT2: 30,
    LT2: 20,
    HT3: 10,
    LT3: 6,
    HT4: 4,
    LT4: 3,
    HT5: 2,
    LT5: 1
};

const RANGOS_TIER_GENERAL = [
    { tier: 'Tier 1', min: 106, max: 180 },
    { tier: 'Tier 2', min: 60, max: 105 },
    { tier: 'Tier 3', min: 30, max: 59 },
    { tier: 'Tier 4', min: 11, max: 29 },
    { tier: 'Tier 5', min: 0, max: 10 }
];

const AJUSTES_DEFAULT = {
    // false: los puntos usan el tier actual.
    // true: los puntos usan el mejor tier histórico de cada modalidad.
    usarPeakTierParaPuntos: false
};

// =====================================================================
// --- FUNCIONES AUXILIARES DE ARCHIVOS ---
// =====================================================================

function leerArchivo(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            console.warn(
                `Advertencia: Archivo no encontrado en ${filePath}. Creando archivo vacío.`
            );

            fs.writeFileSync(filePath, '[]', 'utf8');
            return [];
        }

        const data = fs.readFileSync(filePath, 'utf8');

        if (!data.trim()) {
            fs.writeFileSync(filePath, '[]', 'utf8');
            return [];
        }

        return JSON.parse(data);
    } catch (err) {
        console.error(`Error leyendo ${filePath}:`, err);
        return [];
    }
}

function escribirArchivo(filePath, data) {
    try {
        fs.writeFileSync(
            filePath,
            JSON.stringify(data, null, 2),
            'utf8'
        );

        return true;
    } catch (err) {
        console.error(`Error escribiendo ${filePath}:`, err);
        return false;
    }
}

function leerAjustes() {
    try {
        if (!fs.existsSync(settingsFile)) {
            escribirArchivo(settingsFile, AJUSTES_DEFAULT);
            return { ...AJUSTES_DEFAULT };
        }

        const contenido = fs.readFileSync(settingsFile, 'utf8').trim();

        if (!contenido) {
            escribirArchivo(settingsFile, AJUSTES_DEFAULT);
            return { ...AJUSTES_DEFAULT };
        }

        const guardado = JSON.parse(contenido);

        const ajustes = {
            usarPeakTierParaPuntos:
                typeof guardado?.usarPeakTierParaPuntos === 'boolean'
                    ? guardado.usarPeakTierParaPuntos
                    : AJUSTES_DEFAULT.usarPeakTierParaPuntos
        };

        // Normaliza el archivo para que siempre tenga la estructura actual.
        escribirArchivo(settingsFile, ajustes);

        return ajustes;
    } catch (err) {
        console.error(`Error leyendo ${settingsFile}:`, err);
        return { ...AJUSTES_DEFAULT };
    }
}

function guardarAjustes(ajustes) {
    const normalizados = {
        usarPeakTierParaPuntos:
            Boolean(ajustes?.usarPeakTierParaPuntos)
    };

    return escribirArchivo(settingsFile, normalizados);
}

// =====================================================================
// --- CUENTAS ---
// =====================================================================

function normalizarCuenta(cuenta) {
    return {
        usuario: cuenta.usuario,
        contraseña: cuenta.contraseña,
        rol: cuenta.rol || 'usuario',
        banned: cuenta.banned || false,
        fotoPerfil: cuenta.fotoPerfil || null,
        descripcion: cuenta.descripcion || ''
    };
}

function leerCuentasNormalizadas() {
    const cuentas = leerArchivo(cuentasFile);
    let necesitaActualizacion = false;

    let cuentasNormalizadas = cuentas.map(cuenta => {
        const cuentaNormalizada = normalizarCuenta(cuenta);

        if (
            !Object.prototype.hasOwnProperty.call(cuenta, 'fotoPerfil') ||
            !Object.prototype.hasOwnProperty.call(cuenta, 'descripcion') ||
            !Object.prototype.hasOwnProperty.call(cuenta, 'banned')
        ) {
            necesitaActualizacion = true;
        }

        return cuentaNormalizada;
    });

    if (cuentasNormalizadas.length === 0) {
        cuentasNormalizadas = [
            normalizarCuenta({
                usuario: 'root',
                contraseña: 'cambiame123',
                rol: 'admin'
            })
        ];

        necesitaActualizacion = true;

        console.warn(
            'No existían cuentas. Se creó la cuenta "root" / "cambiame123" con rol admin. Cambia esa contraseña cuanto antes.'
        );
    }

    if (necesitaActualizacion) {
        escribirArchivo(cuentasFile, cuentasNormalizadas);
        console.log('Cuentas normalizadas con valores por defecto.');
    }

    return cuentasNormalizadas;
}

function requireAdmin(req, res, next) {
    const usuario =
        req.headers['x-admin-usuario'] ||
        (req.body && req.body.adminUsuario);

    const contraseña =
        req.headers['x-admin-password'] ||
        (req.body && req.body.adminContraseña);

    if (!usuario || !contraseña) {
        return res.status(401).json({
            error: 'Se requieren credenciales de administrador.'
        });
    }

    const cuentas = leerCuentasNormalizadas();

    const cuenta = cuentas.find(
        c => c.usuario === usuario && c.contraseña === contraseña
    );

    if (!cuenta) {
        return res.status(403).json({
            error: 'Credenciales de administrador inválidas'
        });
    }

    if (cuenta.banned) {
        return res.status(403).json({
            error: 'Tu cuenta ha sido suspendida'
        });
    }

    if (cuenta.rol !== 'admin') {
        return res.status(403).json({
            error: 'Se requiere rol de administrador para esta acción'
        });
    }

    req.admin = cuenta;
    next();
}

// =====================================================================
// --- MINECRAFT / SKINS ---
// =====================================================================

function formatearUUID(uuidSinGuiones) {
    if (!uuidSinGuiones || uuidSinGuiones.length !== 32) {
        return uuidSinGuiones;
    }

    return [
        uuidSinGuiones.slice(0, 8),
        uuidSinGuiones.slice(8, 12),
        uuidSinGuiones.slice(12, 16),
        uuidSinGuiones.slice(16, 20),
        uuidSinGuiones.slice(20)
    ].join('-');
}

function generarSkinHeadUrl(username, size = 160) {
    const nombre = encodeURIComponent(username || 'Steve');
    const tamaño = Math.min(
        Math.max(parseInt(size) || 160, 32),
        512
    );

    return `/api/skin-head/${nombre}?size=${tamaño}`;
}

async function obtenerDatosMinecraft(username) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
        const resp = await fetch(
            `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`,
            {
                signal: controller.signal
            }
        );

        clearTimeout(timeoutId);

        if (resp.status === 200) {
            const data = await resp.json();
            const uuid = formatearUUID(data.id);

            return {
                existe: true,
                username: data.name,
                uuid,
                skinHeadUrl: generarSkinHeadUrl(data.name, 160)
            };
        }

        if (resp.status === 404 || resp.status === 204) {
            return {
                existe: false,
                username,
                uuid: null,
                skinHeadUrl: null
            };
        }

        throw new Error(
            `Mojang API respondió con estado ${resp.status}`
        );
    } catch (err) {
        clearTimeout(timeoutId);

        console.warn(
            `No se pudo confirmar "${username}" contra la API de Mojang (${err.message}). Usando skin por nombre.`
        );

        return {
            existe: null,
            username,
            uuid: null,
            skinHeadUrl: generarSkinHeadUrl(username, 160)
        };
    }
}

// =====================================================================
// --- JUGADORES ---
// =====================================================================

function calcularPuntosDeTier(tier) {
    if (!tier) {
        return 0;
    }

    return PUNTOS_POR_TIER[tier] || 0;
}

function calcularTierGeneral(totalPuntos) {
    const rango = RANGOS_TIER_GENERAL.find(
        r => totalPuntos >= r.min && totalPuntos <= r.max
    );

    return rango ? rango.tier : 'Tier 5';
}


function normalizarEstadoJugadores(valor, valorRetirado) {
    if (valorRetirado !== undefined) {
        const retiradoTexto = String(valorRetirado).toLowerCase();

        if (['true', '1', 'si', 'sí'].includes(retiradoTexto)) {
            return 'retirados';
        }

        if (['false', '0', 'no'].includes(retiradoTexto)) {
            return 'activos';
        }
    }

    const estado = String(valor || 'activos').toLowerCase().trim();

    if (['activo', 'activos'].includes(estado)) {
        return 'activos';
    }

    if (['retirado', 'retirados', 'ret'].includes(estado)) {
        return 'retirados';
    }

    if (['todos', 'all'].includes(estado)) {
        return 'todos';
    }

    return null;
}

function filtrarJugadoresPorEstado(jugadores, estado) {
    if (estado === 'todos') {
        return jugadores;
    }

    if (estado === 'retirados') {
        return jugadores.filter(jugador => Boolean(jugador.retirado));
    }

    return jugadores.filter(jugador => !jugador.retirado);
}

function formatearTierRetirado(tier, retirado) {
    if (!tier) {
        return null;
    }

    return retirado ? `R${tier}` : tier;
}

function indiceTier(tier) {
    if (!tier) {
        return Number.POSITIVE_INFINITY;
    }

    const indice = TIERS_ORDEN.indexOf(String(tier).toUpperCase());

    return indice === -1
        ? Number.POSITIVE_INFINITY
        : indice;
}

function obtenerMejorTier(...tiers) {
    const validos = tiers
        .flat(Infinity)
        .filter(tier => TIERS_ORDEN.includes(String(tier || '').toUpperCase()))
        .map(tier => String(tier).toUpperCase());

    if (validos.length === 0) {
        return null;
    }

    validos.sort((a, b) => indiceTier(a) - indiceTier(b));

    return validos[0];
}

function obtenerTiersDelHistorial(historial) {
    if (!Array.isArray(historial)) {
        return [];
    }

    return historial
        .map(item => item && item.tier)
        .filter(Boolean);
}

function actualizarPeakTier(jugador, gamemode, nuevoTier) {
    if (!jugador.peakTiers) {
        jugador.peakTiers = {
            sword: null,
            nethpot: null,
            uhc: null
        };
    }

    jugador.peakTiers[gamemode] = obtenerMejorTier(
        jugador.peakTiers[gamemode],
        nuevoTier
    );

    return jugador.peakTiers[gamemode];
}

function recalcularPuntos(jugador, ajustes = leerAjustes()) {
    const retirado = Boolean(jugador.retirado);

    jugador.tiersMostrados = {
        sword: formatearTierRetirado(jugador.tiers?.sword || null, retirado),
        nethpot: formatearTierRetirado(jugador.tiers?.nethpot || null, retirado),
        uhc: formatearTierRetirado(jugador.tiers?.uhc || null, retirado)
    };

    if (retirado) {
        jugador.tiersPuntuados = {
            sword: null,
            nethpot: null,
            uhc: null
        };

        jugador.fuentePuntos = 'RETIRADO';
        jugador.puntos = {
            sword: 0,
            nethpot: 0,
            uhc: 0,
            total: 0
        };
        jugador.tierGeneral = 'RET';

        return jugador;
    }

    const usarPeak = Boolean(
        ajustes.usarPeakTierParaPuntos
    );

    const tiersPuntuados = {
        sword:
            (usarPeak && jugador.peakTiers?.sword) ||
            jugador.tiers.sword ||
            null,

        nethpot:
            (usarPeak && jugador.peakTiers?.nethpot) ||
            jugador.tiers.nethpot ||
            null,

        uhc:
            (usarPeak && jugador.peakTiers?.uhc) ||
            jugador.tiers.uhc ||
            null
    };

    const sword = calcularPuntosDeTier(tiersPuntuados.sword);
    const nethpot = calcularPuntosDeTier(tiersPuntuados.nethpot);
    const uhc = calcularPuntosDeTier(tiersPuntuados.uhc);
    const total = sword + nethpot + uhc;

    jugador.tiersPuntuados = tiersPuntuados;
    jugador.fuentePuntos = usarPeak
        ? 'PEAK_TIER'
        : 'TIER_ACTUAL';

    jugador.puntos = {
        sword,
        nethpot,
        uhc,
        total
    };

    jugador.tierGeneral = calcularTierGeneral(total);

    return jugador;
}

function normalizarJugador(jugador, ajustes = leerAjustes()) {
    const username = jugador.username || 'Steve';

    const tiers = {
        sword: jugador.tiers
            ? jugador.tiers.sword || null
            : null,

        nethpot: jugador.tiers
            ? jugador.tiers.nethpot || null
            : null,

        uhc: jugador.tiers
            ? jugador.tiers.uhc || null
            : null
    };

    const historialTiers = {
        sword:
            (jugador.historialTiers &&
                Array.isArray(jugador.historialTiers.sword) &&
                jugador.historialTiers.sword) ||
            [],

        nethpot:
            (jugador.historialTiers &&
                Array.isArray(jugador.historialTiers.nethpot) &&
                jugador.historialTiers.nethpot) ||
            [],

        uhc:
            (jugador.historialTiers &&
                Array.isArray(jugador.historialTiers.uhc) &&
                jugador.historialTiers.uhc) ||
            []
    };

    const peakTiers = {
        sword: obtenerMejorTier(
            jugador.peakTiers?.sword,
            tiers.sword,
            obtenerTiersDelHistorial(historialTiers.sword)
        ),

        nethpot: obtenerMejorTier(
            jugador.peakTiers?.nethpot,
            tiers.nethpot,
            obtenerTiersDelHistorial(historialTiers.nethpot)
        ),

        uhc: obtenerMejorTier(
            jugador.peakTiers?.uhc,
            tiers.uhc,
            obtenerTiersDelHistorial(historialTiers.uhc)
        )
    };

    const jugadorNormalizado = {
        id: jugador.id,
        username,
        uuid: jugador.uuid || null,
        region: jugador.region,
        skinHeadUrl: generarSkinHeadUrl(username, 160),
        tiers,
        peakTiers,
        historialTiers,

        retirado: Boolean(jugador.retirado),
        fechaRetiro: jugador.fechaRetiro || null,
        retiradoPor: jugador.retiradoPor || null,
        ultimaFechaRetiro: jugador.ultimaFechaRetiro || null,
        fechaReingreso: jugador.fechaReingreso || null,
        reingresadoPor: jugador.reingresadoPor || null,
        historialRetiros: Array.isArray(jugador.historialRetiros)
            ? jugador.historialRetiros
            : [],

        fechaRegistro:
            jugador.fechaRegistro ||
            new Date().toISOString()
    };

    return recalcularPuntos(
        jugadorNormalizado,
        ajustes
    );
}

function leerJugadoresNormalizados() {
    const jugadores = leerArchivo(playersFile);
    const ajustes = leerAjustes();

    const normalizados = jugadores.map(
        jugador => normalizarJugador(jugador, ajustes)
    );

    escribirArchivo(playersFile, normalizados);

    return normalizados;
}

function registrarCambioTier(jugador, gamemode, nuevoTier) {
    const historial = jugador.historialTiers[gamemode];

    const ultimo =
        historial.length > 0
            ? historial[historial.length - 1].tier
            : undefined;

    if (ultimo !== (nuevoTier || null)) {
        historial.push({
            tier: nuevoTier || null,
            fecha: new Date().toISOString()
        });
    }
}

// =====================================================================
// --- TESTS ---
// =====================================================================

function generarTestId() {
    return `test_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
}

function normalizarNombreParticipante(valor) {
    if (typeof valor !== 'string') {
        return null;
    }

    const nombre = valor.trim();

    return nombre.length >= 1 && nombre.length <= 32
        ? nombre
        : null;
}

function normalizarMarcador(valor) {
    if (typeof valor !== 'string') {
        return null;
    }

    const match = valor
        .trim()
        .match(/^(\d{1,3})\s*[-:]\s*(\d{1,3})$/);

    if (!match) {
        return null;
    }

    return `${Number(match[1])}-${Number(match[2])}`;
}

function leerTestsNormalizados() {
    const tests = leerArchivo(testsFile);

    const normalizados = tests
        .filter(test => test && typeof test === 'object')
        .map(test => ({
            ...test,
            id: test.id || generarTestId(),
            fecha: test.fecha || new Date().toISOString(),
            tipo: String(test.tipo || '').toUpperCase()
        }))
        .filter(
            test =>
                test.tipo === 'NORMAL' ||
                test.tipo === 'HIGH'
        );

    escribirArchivo(testsFile, normalizados);

    return normalizados;
}

function buscarJugadorPorUsername(jugadores, username) {
    return jugadores.find(
        jugador =>
            jugador.username.toLowerCase() ===
            username.toLowerCase()
    );
}

function aplicarTierJugador(jugador, gamemode, nuevoTier) {
    registrarCambioTier(
        jugador,
        gamemode,
        nuevoTier
    );

    jugador.tiers[gamemode] = nuevoTier;

    // El peak solo mejora. Una bajada o la eliminación del tier actual
    // nunca borra el mejor tier histórico.
    actualizarPeakTier(
        jugador,
        gamemode,
        nuevoTier
    );

    jugador.skinHeadUrl = generarSkinHeadUrl(
        jugador.username,
        160
    );

    recalcularPuntos(jugador);
}

function guardarJugadoresYTests(
    jugadores,
    tests,
    jugadoresAnteriores,
    testsAnteriores
) {
    if (!escribirArchivo(playersFile, jugadores)) {
        return {
            ok: false,
            error: 'Error guardando los cambios de tier'
        };
    }

    if (!escribirArchivo(testsFile, tests)) {
        escribirArchivo(
            playersFile,
            jugadoresAnteriores
        );

        escribirArchivo(
            testsFile,
            testsAnteriores
        );

        return {
            ok: false,
            error: 'Error guardando el registro del test'
        };
    }

    return {
        ok: true
    };
}

// =====================================================================
// --- RUTA: CABEZA DE SKIN DE MINECRAFT ---
// =====================================================================

app.get('/api/skin-head/:username', (req, res) => {
    const { username } = req.params;

    const size = Math.min(
        Math.max(parseInt(req.query.size) || 160, 32),
        512
    );

    if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) {
        return res.redirect(
            `https://mc-heads.net/avatar/Steve/${size}`
        );
    }

    res.redirect(
        `https://mc-heads.net/avatar/${encodeURIComponent(username)}/${size}`
    );
});

// =====================================================================
// --- RUTAS: CONFIGURACIÓN ---
// =====================================================================

app.get('/api/config', (req, res) => {
    res.json({
        regiones: REGIONES,
        gamemodes: GAMEMODES,
        gamemodesNombre: GAMEMODES_NOMBRE,
        tiersOrden: TIERS_ORDEN,
        puntosPorTier: PUNTOS_POR_TIER,
        rangosTierGeneral: RANGOS_TIER_GENERAL,
        estadosJugadores: ['activos', 'retirados', 'todos'],
        ajustes: leerAjustes(),

        tests: {
            tipos: ['NORMAL', 'HIGH'],
            tiersNormal: TIERS_TEST_NORMAL,
            tiersHigh: TIERS_HIGH_TEST,
            evals: TEST_EVALS,
            resultados: TEST_RESULTS,
            desenlaces: TEST_OUTCOMES
        }
    });
});

// =====================================================================
// --- RUTAS: AJUSTES GLOBALES ---
// =====================================================================

app.get('/api/settings', (req, res) => {
    res.json(leerAjustes());
});

app.patch(
    '/api/settings/peak-tier-points',
    requireAdmin,
    (req, res) => {
        const valor =
            req.body.enabled ??
            req.body.usarPeakTierParaPuntos;

        if (typeof valor !== 'boolean') {
            return res.status(400).json({
                error:
                    'El campo enabled debe ser true o false'
            });
        }

        const ajustes = {
            ...leerAjustes(),
            usarPeakTierParaPuntos: valor
        };

        if (!guardarAjustes(ajustes)) {
            return res.status(500).json({
                error:
                    'No se pudo guardar la configuración'
            });
        }

        const jugadores = leerJugadoresNormalizados();

        jugadores.forEach(jugador => {
            recalcularPuntos(jugador, ajustes);
        });

        if (!escribirArchivo(playersFile, jugadores)) {
            return res.status(500).json({
                error:
                    'La configuración se guardó, pero no se pudieron recalcular los jugadores'
            });
        }

        res.json({
            success: true,
            ajustes,
            jugadoresActualizados: jugadores.length
        });
    }
);

// =====================================================================
// --- RUTAS: JUGADORES ---
// =====================================================================

app.get('/api/players', (req, res) => {
    console.log('GET /api/players - Solicitado.');

    let jugadores = leerJugadoresNormalizados();

    const {
        region,
        gamemode,
        tier,
        estado,
        retirado
    } = req.query;

    const estadoNormalizado = normalizarEstadoJugadores(
        estado,
        retirado
    );

    if (!estadoNormalizado) {
        return res.status(400).json({
            error: 'Estado inválido. Usa activos, retirados o todos'
        });
    }

    jugadores = filtrarJugadoresPorEstado(
        jugadores,
        estadoNormalizado
    );

    if (region) {
        jugadores = jugadores.filter(
            j => j.region === region.toUpperCase()
        );
    }

    if (
        gamemode &&
        GAMEMODES.includes(gamemode)
    ) {
        if (tier) {
            const tierBuscado = String(tier)
                .toUpperCase()
                .replace(/^R/, '');

            jugadores = jugadores.filter(
                j => j.tiers[gamemode] === tierBuscado
            );
        } else {
            jugadores = jugadores.filter(
                j => j.tiers[gamemode] !== null
            );
        }
    }

    res.json(jugadores);
});

app.get('/api/players/:id', (req, res) => {
    const { id } = req.params;
    const jugadores = leerJugadoresNormalizados();

    const jugador = jugadores.find(
        j => j.id === id
    );

    if (!jugador) {
        return res.status(404).json({
            error: 'Jugador no encontrado'
        });
    }

    res.json(jugador);
});

app.get(
    '/api/players/:id/historial/:gamemode',
    (req, res) => {
        const {
            id,
            gamemode
        } = req.params;

        if (!GAMEMODES.includes(gamemode)) {
            return res.status(400).json({
                error:
                    `Gamemode inválido. Debe ser uno de: ` +
                    GAMEMODES.join(', ')
            });
        }

        const jugadores =
            leerJugadoresNormalizados();

        const jugador = jugadores.find(
            j => j.id === id
        );

        if (!jugador) {
            return res.status(404).json({
                error: 'Jugador no encontrado'
            });
        }

        res.json(
            jugador.historialTiers[gamemode]
        );
    }
);

app.post(
    '/api/players',
    requireAdmin,
    async (req, res) => {
        const {
            username,
            region
        } = req.body;

        console.log(
            `POST /api/players - Solicitado registrar al jugador "${username}".`
        );

        if (!username || !region) {
            return res.status(400).json({
                error: 'Se requieren username y region'
            });
        }

        const regionUpper =
            region.toUpperCase();

        if (!REGIONES.includes(regionUpper)) {
            return res.status(400).json({
                error:
                    `Región inválida. Debe ser una de: ` +
                    REGIONES.join(', ')
            });
        }

        if (
            !/^[A-Za-z0-9_]{1,16}$/.test(
                username
            )
        ) {
            return res.status(400).json({
                error:
                    'El nombre de usuario de Minecraft no tiene un formato válido'
            });
        }

        const jugadores =
            leerJugadoresNormalizados();

        if (
            jugadores.some(
                j =>
                    j.username.toLowerCase() ===
                    username.toLowerCase()
            )
        ) {
            return res.status(409).json({
                error:
                    'Ese jugador ya está registrado en el tierlist'
            });
        }

        const datosMc =
            await obtenerDatosMinecraft(username);

        if (datosMc.existe === false) {
            return res.status(404).json({
                error:
                    `No existe ninguna cuenta de Minecraft con el nombre "${username}"`
            });
        }

        const nuevoJugador =
            normalizarJugador({
                id: Date.now().toString(),
                username: datosMc.username,
                uuid: datosMc.uuid,
                region: regionUpper,
                skinHeadUrl:
                    datosMc.skinHeadUrl,

                tiers: {
                    sword: null,
                    nethpot: null,
                    uhc: null
                },

                peakTiers: {
                    sword: null,
                    nethpot: null,
                    uhc: null
                },

                historialTiers: {
                    sword: [],
                    nethpot: [],
                    uhc: []
                },

                fechaRegistro:
                    new Date().toISOString()
            });

        jugadores.push(nuevoJugador);

        if (
            !escribirArchivo(
                playersFile,
                jugadores
            )
        ) {
            return res.status(500).json({
                error:
                    'Error guardando al jugador'
            });
        }

        console.log(
            `POST /api/players - Jugador "${nuevoJugador.username}" registrado exitosamente.`
        );

        res.status(201).json({
            success: true,
            jugador: nuevoJugador
        });
    }
);

app.patch(
    '/api/players/:id',
    requireAdmin,
    async (req, res) => {
        const { id } = req.params;

        const {
            username,
            region,
            refrescarSkin
        } = req.body;

        const jugadores =
            leerJugadoresNormalizados();

        const index = jugadores.findIndex(
            j => j.id === id
        );

        if (index === -1) {
            return res.status(404).json({
                error: 'Jugador no encontrado'
            });
        }

        const jugador = jugadores[index];
        const usernameAnterior = jugador.username;
        let usernameCambio = false;

        if (username !== undefined) {
            const usernameSolicitado =
                String(username).trim();

            if (
                !/^[A-Za-z0-9_]{1,16}$/.test(
                    usernameSolicitado
                )
            ) {
                return res.status(400).json({
                    error:
                        'El nombre de usuario de Minecraft debe tener de 1 a 16 caracteres y solo puede usar letras, números o guion bajo'
                });
            }

            const duplicado = jugadores.some(
                (otroJugador, otroIndex) =>
                    otroIndex !== index &&
                    String(otroJugador.username)
                        .toLowerCase() ===
                    usernameSolicitado.toLowerCase()
            );

            if (duplicado) {
                return res.status(409).json({
                    error:
                        'Ya existe otro jugador registrado con ese nombre'
                });
            }

            if (
                usernameSolicitado !==
                jugador.username
            ) {
                const datosMc =
                    await obtenerDatosMinecraft(
                        usernameSolicitado
                    );

                if (datosMc.existe === false) {
                    return res.status(404).json({
                        error:
                            `No existe ninguna cuenta de Minecraft con el nombre "${usernameSolicitado}"`
                    });
                }

                jugador.username =
                    datosMc.username ||
                    usernameSolicitado;

                if (datosMc.uuid) {
                    jugador.uuid =
                        datosMc.uuid;
                }

                usernameCambio = true;
            }
        }

        if (region) {
            const regionUpper =
                String(region).toUpperCase();

            if (
                !REGIONES.includes(regionUpper)
            ) {
                return res.status(400).json({
                    error:
                        `Región inválida. Debe ser una de: ` +
                        REGIONES.join(', ')
                });
            }

            jugador.region =
                regionUpper;
        }

        if (refrescarSkin && !usernameCambio) {
            const datosMc =
                await obtenerDatosMinecraft(
                    jugador.username
                );

            if (datosMc.username) {
                jugador.username =
                    datosMc.username;
            }

            if (datosMc.uuid) {
                jugador.uuid =
                    datosMc.uuid;
            }
        }

        jugador.skinHeadUrl =
            generarSkinHeadUrl(
                jugador.username,
                160
            );

        recalcularPuntos(jugador);

        const jugadoresAnteriores =
            leerArchivo(playersFile);

        const tests =
            leerTestsNormalizados();

        const testsAnteriores =
            JSON.parse(
                JSON.stringify(tests)
            );

        let testsActualizados = 0;

        if (usernameCambio) {
            const anteriorLower =
                usernameAnterior.toLowerCase();

            for (const test of tests) {
                const campos =
                    test.tipo === 'NORMAL'
                        ? ['tester', 'testeado']
                        : ['retador', 'retado'];

                for (const campo of campos) {
                    if (
                        typeof test[campo] === 'string' &&
                        test[campo].toLowerCase() ===
                            anteriorLower
                    ) {
                        test[campo] =
                            jugador.username;

                        testsActualizados += 1;
                    }
                }
            }
        }

        if (
            !escribirArchivo(
                playersFile,
                jugadores
            )
        ) {
            return res.status(500).json({
                error:
                    'Error al actualizar al jugador'
            });
        }

        if (
            usernameCambio &&
            !escribirArchivo(
                testsFile,
                tests
            )
        ) {
            escribirArchivo(
                playersFile,
                jugadoresAnteriores
            );

            escribirArchivo(
                testsFile,
                testsAnteriores
            );

            return res.status(500).json({
                error:
                    'No se pudo actualizar el nombre en el historial de tests. Los cambios fueron revertidos.'
            });
        }

        res.json({
            success: true,
            jugador,
            usernameAnterior:
                usernameCambio
                    ? usernameAnterior
                    : null,
            testsActualizados
        });
    }
);


app.patch(
    '/api/players/:id/tier',
    requireAdmin,
    (req, res) => {
        const { id } = req.params;

        const {
            gamemode,
            tier
        } = req.body;

        console.log(
            `PATCH /api/players/${id}/tier - Solicitado asignar tier "${tier}" en "${gamemode}".`
        );

        if (
            !gamemode ||
            !GAMEMODES.includes(gamemode)
        ) {
            return res.status(400).json({
                error:
                    `Gamemode inválido. Debe ser uno de: ` +
                    GAMEMODES.join(', ')
            });
        }

        let tierNormalizado = null;

        if (
            tier !== null &&
            tier !== undefined &&
            tier !== ''
        ) {
            tierNormalizado =
                String(tier).toUpperCase();

            if (
                !TIERS_ORDEN.includes(
                    tierNormalizado
                )
            ) {
                return res.status(400).json({
                    error:
                        `Tier inválido. Debe ser uno de: ` +
                        `${TIERS_ORDEN.join(', ')} o null`
                });
            }
        }

        const jugadores =
            leerJugadoresNormalizados();

        const index = jugadores.findIndex(
            j => j.id === id
        );

        if (index === -1) {
            return res.status(404).json({
                error: 'Jugador no encontrado'
            });
        }

        const jugador = jugadores[index];

        if (jugador.retirado) {
            return res.status(409).json({
                error:
                    'El jugador está retirado. Debes reintegrarlo antes de asignarle tiers.'
            });
        }

        aplicarTierJugador(
            jugador,
            gamemode,
            tierNormalizado
        );

        if (
            !escribirArchivo(
                playersFile,
                jugadores
            )
        ) {
            return res.status(500).json({
                error:
                    'Error al asignar el tier'
            });
        }

        console.log(
            `PATCH /api/players/${id}/tier - Tier actualizado. Tier general ahora: ${jugador.tierGeneral} (${jugador.puntos.total} pts).`
        );

        res.json({
            success: true,
            jugador
        });
    }
);

app.patch(
    '/api/players/:id/retirement',
    requireAdmin,
    (req, res) => {
        const { id } = req.params;
        const valor = req.body.retirado ?? req.body.retired;

        if (typeof valor !== 'boolean') {
            return res.status(400).json({
                error: 'El campo retirado debe ser true o false'
            });
        }

        const jugadores = leerJugadoresNormalizados();
        const index = jugadores.findIndex(jugador => jugador.id === id);

        if (index === -1) {
            return res.status(404).json({
                error: 'Jugador no encontrado'
            });
        }

        const jugador = jugadores[index];
        const ahora = new Date().toISOString();

        if (valor === true) {
            if (jugador.retirado) {
                return res.json({
                    success: true,
                    sinCambios: true,
                    jugador
                });
            }

            jugador.historialRetiros = Array.isArray(jugador.historialRetiros)
                ? jugador.historialRetiros
                : [];

            jugador.historialRetiros.push({
                accion: 'RETIRADO',
                fecha: ahora,
                por: req.admin.usuario,
                tiers: JSON.parse(JSON.stringify(jugador.tiers)),
                peakTiers: JSON.parse(JSON.stringify(jugador.peakTiers)),
                puntos: JSON.parse(JSON.stringify(jugador.puntos)),
                tierGeneral: jugador.tierGeneral
            });

            jugador.retirado = true;
            jugador.fechaRetiro = ahora;
            jugador.ultimaFechaRetiro = ahora;
            jugador.retiradoPor = req.admin.usuario;
            jugador.fechaReingreso = null;
            jugador.reingresadoPor = null;

            recalcularPuntos(jugador);
        } else {
            if (!jugador.retirado) {
                return res.json({
                    success: true,
                    sinCambios: true,
                    jugador
                });
            }

            jugador.historialRetiros = Array.isArray(jugador.historialRetiros)
                ? jugador.historialRetiros
                : [];

            jugador.historialRetiros.push({
                accion: 'REINGRESADO',
                fecha: ahora,
                por: req.admin.usuario,
                tiersRetirados: JSON.parse(JSON.stringify(jugador.tiers)),
                peakTiersRetirados: JSON.parse(JSON.stringify(jugador.peakTiers))
            });

            jugador.retirado = false;
            jugador.fechaReingreso = ahora;
            jugador.reingresadoPor = req.admin.usuario;
            jugador.fechaRetiro = null;
            jugador.retiradoPor = null;

            // Al volver, comienza desde cero y debe retestearse.
            jugador.tiers = {
                sword: null,
                nethpot: null,
                uhc: null
            };

            jugador.peakTiers = {
                sword: null,
                nethpot: null,
                uhc: null
            };

            jugador.historialTiers = {
                sword: [],
                nethpot: [],
                uhc: []
            };

            jugador.tiersPuntuados = {
                sword: null,
                nethpot: null,
                uhc: null
            };

            recalcularPuntos(jugador);
        }

        if (!escribirArchivo(playersFile, jugadores)) {
            return res.status(500).json({
                error: 'No se pudo guardar el estado de retiro del jugador'
            });
        }

        res.json({
            success: true,
            retirado: jugador.retirado,
            reinicioCompleto: valor === false,
            jugador
        });
    }
);

app.delete(
    '/api/players/:id',
    requireAdmin,
    (req, res) => {
        const { id } = req.params;

        console.log(
            `DELETE /api/players/${id} - Solicitado.`
        );

        let jugadores =
            leerJugadoresNormalizados();

        const existe = jugadores.some(
            j => j.id === id
        );

        if (!existe) {
            return res.status(404).json({
                error: 'Jugador no encontrado'
            });
        }

        jugadores = jugadores.filter(
            j => j.id !== id
        );

        if (
            !escribirArchivo(
                playersFile,
                jugadores
            )
        ) {
            return res.status(500).json({
                error:
                    'Error al eliminar al jugador'
            });
        }

        console.log(
            `DELETE /api/players/${id} - Jugador eliminado exitosamente.`
        );

        res.json({
            success: true
        });
    }
);

// =====================================================================
// --- RUTAS: TESTS ---
// =====================================================================

// Historial público de tests.
// Permite filtrar por tipo, gamemode o jugador.
app.get('/api/tests', (req, res) => {
    let tests = leerTestsNormalizados();

    const {
        tipo,
        gamemode,
        jugador
    } = req.query;

    if (tipo) {
        const tipoUpper =
            String(tipo).toUpperCase();

        if (
            !['NORMAL', 'HIGH'].includes(
                tipoUpper
            )
        ) {
            return res.status(400).json({
                error:
                    'Tipo inválido. Usa NORMAL o HIGH'
            });
        }

        tests = tests.filter(
            test => test.tipo === tipoUpper
        );
    }

    if (gamemode) {
        const gamemodeLower =
            String(gamemode).toLowerCase();

        if (
            !GAMEMODES.includes(
                gamemodeLower
            )
        ) {
            return res.status(400).json({
                error:
                    `Gamemode inválido. Debe ser uno de: ` +
                    GAMEMODES.join(', ')
            });
        }

        tests = tests.filter(
            test =>
                test.gamemode ===
                gamemodeLower
        );
    }

    if (jugador) {
        const buscado =
            String(jugador)
                .trim()
                .toLowerCase();

        tests = tests.filter(test => {
            const participantes =
                test.tipo === 'NORMAL'
                    ? [
                        test.tester,
                        test.testeado
                    ]
                    : [
                        test.retador,
                        test.retado
                    ];

            return participantes.some(
                nombre =>
                    typeof nombre === 'string' &&
                    nombre
                        .toLowerCase()
                        .includes(buscado)
            );
        });
    }

    tests.sort(
        (a, b) =>
            new Date(b.fecha) -
            new Date(a.fecha)
    );

    res.json(tests);
});

app.get('/api/tests/:id', (req, res) => {
    const tests = leerTestsNormalizados();

    const test = tests.find(
        item => item.id === req.params.id
    );

    if (!test) {
        return res.status(404).json({
            error: 'Test no encontrado'
        });
    }

    res.json(test);
});

// Registra un test normal y asigna el tier obtenido.
app.post(
    '/api/tests/normal',
    requireAdmin,
    (req, res) => {
        const tester =
            normalizarNombreParticipante(
                req.body.tester
            );

        const testeado =
            normalizarNombreParticipante(
                req.body.testeado
            );

        const gamemode =
            String(
                req.body.gamemode || ''
            ).toLowerCase();

        const tierObtenido =
            String(
                req.body.tierObtenido || ''
            ).toUpperCase();

        if (
            !tester ||
            !testeado ||
            !gamemode ||
            !tierObtenido
        ) {
            return res.status(400).json({
                error:
                    'Se requieren tester, testeado, gamemode y tierObtenido'
            });
        }

        if (
            !GAMEMODES.includes(gamemode)
        ) {
            return res.status(400).json({
                error:
                    `Gamemode inválido. Debe ser uno de: ` +
                    GAMEMODES.join(', ')
            });
        }

        if (
            !TIERS_TEST_NORMAL.includes(
                tierObtenido
            )
        ) {
            return res.status(400).json({
                error:
                    `Un test normal solo puede otorgar: ` +
                    TIERS_TEST_NORMAL.join(', ')
            });
        }

        const jugadores =
            leerJugadoresNormalizados();

        const jugadoresAnteriores =
            JSON.parse(
                JSON.stringify(jugadores)
            );

        const jugadorTesteado =
            buscarJugadorPorUsername(
                jugadores,
                testeado
            );

        if (!jugadorTesteado) {
            return res.status(404).json({
                error:
                    `El jugador testeado "${testeado}" no está registrado en el tierlist`
            });
        }

        if (jugadorTesteado.retirado) {
            return res.status(409).json({
                error:
                    `El jugador "${jugadorTesteado.username}" está retirado y no puede recibir tests hasta ser reintegrado`
            });
        }

        const tierAnterior =
            jugadorTesteado.tiers[gamemode] ||
            null;

        const peakAnterior =
            jugadorTesteado.peakTiers?.[gamemode] ||
            null;

        aplicarTierJugador(
            jugadorTesteado,
            gamemode,
            tierObtenido
        );

        const peakNuevo =
            jugadorTesteado.peakTiers?.[gamemode] ||
            null;

        const tests =
            leerTestsNormalizados();

        const testsAnteriores =
            JSON.parse(
                JSON.stringify(tests)
            );

        const nuevoTest = {
            id: generarTestId(),
            tipo: 'NORMAL',
            tester,
            testeado:
                jugadorTesteado.username,
            gamemode,

            resultados: {
                tierAnterior,
                tierObtenido,
                peakAnterior,
                peakNuevo,
                puntosCalculadosCon:
                    jugadorTesteado.fuentePuntos
            },

            registradoPor:
                req.admin.usuario,

            fecha:
                new Date().toISOString()
        };

        tests.push(nuevoTest);

        const guardado =
            guardarJugadoresYTests(
                jugadores,
                tests,
                jugadoresAnteriores,
                testsAnteriores
            );

        if (!guardado.ok) {
            return res.status(500).json({
                error: guardado.error
            });
        }

        res.status(201).json({
            success: true,
            test: nuevoTest,
            jugador: jugadorTesteado
        });
    }
);

// Registra un High Test.
//
// Si resultado es PASSED:
// el retador recibe el tier del retado.
//
// Si eval es FAILED:
// el retado baja un tier.
app.post(
    '/api/tests/high',
    requireAdmin,
    (req, res) => {
        const retador =
            normalizarNombreParticipante(
                req.body.retador
            );

        const retado =
            normalizarNombreParticipante(
                req.body.retado
            );

        const gamemode =
            String(
                req.body.gamemode || ''
            ).toLowerCase();

        const evaluacion =
            String(
                req.body.eval || ''
            ).toUpperCase();

        const resultado =
            String(
                req.body.resultado || ''
            ).toUpperCase();

        const desenlace =
            String(
                req.body.desenlace || ''
            ).toUpperCase();

        const marcador =
            normalizarMarcador(
                req.body.marcador
            );

        if (
            !retador ||
            !retado ||
            !gamemode ||
            !evaluacion ||
            !resultado ||
            !desenlace ||
            !marcador
        ) {
            return res.status(400).json({
                error:
                    'Se requieren retador, retado, gamemode, eval, resultado, desenlace y marcador'
            });
        }

        if (
            retador.toLowerCase() ===
            retado.toLowerCase()
        ) {
            return res.status(400).json({
                error:
                    'El retador y el retado no pueden ser la misma persona'
            });
        }

        if (
            !GAMEMODES.includes(gamemode)
        ) {
            return res.status(400).json({
                error:
                    `Gamemode inválido. Debe ser uno de: ` +
                    GAMEMODES.join(', ')
            });
        }

        if (
            !TEST_EVALS.includes(evaluacion)
        ) {
            return res.status(400).json({
                error:
                    'Eval inválida. Usa PASSED o FAILED'
            });
        }

        if (
            !TEST_RESULTS.includes(resultado)
        ) {
            return res.status(400).json({
                error:
                    'Resultado inválido. Usa PASSED o FAILED'
            });
        }

        if (
            !TEST_OUTCOMES.includes(desenlace)
        ) {
            return res.status(400).json({
                error:
                    'Desenlace inválido. Usa WON o LOST'
            });
        }

        const jugadores =
            leerJugadoresNormalizados();

        const jugadoresAnteriores =
            JSON.parse(
                JSON.stringify(jugadores)
            );

        const jugadorRetador =
            buscarJugadorPorUsername(
                jugadores,
                retador
            );

        const jugadorRetado =
            buscarJugadorPorUsername(
                jugadores,
                retado
            );

        if (!jugadorRetador) {
            return res.status(404).json({
                error:
                    `El retador "${retador}" no está registrado en el tierlist`
            });
        }

        if (!jugadorRetado) {
            return res.status(404).json({
                error:
                    `El retado "${retado}" no está registrado en el tierlist`
            });
        }

        if (jugadorRetador.retirado || jugadorRetado.retirado) {
            const retirados = [jugadorRetador, jugadorRetado]
                .filter(jugador => jugador.retirado)
                .map(jugador => jugador.username)
                .join(', ');

            return res.status(409).json({
                error:
                    `No se puede registrar el High Test porque hay jugadores retirados: ${retirados}`
            });
        }

        const tierRetadorAnterior =
            jugadorRetador.tiers[gamemode] ||
            null;

        const tierRetadoAnterior =
            jugadorRetado.tiers[gamemode] ||
            null;

        const peakRetadorAnterior =
            jugadorRetador.peakTiers?.[gamemode] ||
            null;

        const peakRetadoAnterior =
            jugadorRetado.peakTiers?.[gamemode] ||
            null;

        if (
            !TIERS_HIGH_TEST.includes(
                tierRetadoAnterior
            )
        ) {
            return res.status(400).json({
                error:
                    `El retado debe tener LT3 o un tier superior en ${GAMEMODES_NOMBRE[gamemode]}`
            });
        }

        let tierRetadorNuevo =
            tierRetadorAnterior;

        let tierRetadoNuevo =
            tierRetadoAnterior;

        if (resultado === 'PASSED') {
            tierRetadorNuevo =
                tierRetadoAnterior;

            aplicarTierJugador(
                jugadorRetador,
                gamemode,
                tierRetadorNuevo
            );
        }

        if (evaluacion === 'FAILED') {
            tierRetadoNuevo =
                DEMOCION_HIGH_TEST[
                    tierRetadoAnterior
                ];

            aplicarTierJugador(
                jugadorRetado,
                gamemode,
                tierRetadoNuevo
            );
        }

        const peakRetadorNuevo =
            jugadorRetador.peakTiers?.[gamemode] ||
            null;

        const peakRetadoNuevo =
            jugadorRetado.peakTiers?.[gamemode] ||
            null;

        const tests =
            leerTestsNormalizados();

        const testsAnteriores =
            JSON.parse(
                JSON.stringify(tests)
            );

        const nuevoTest = {
            id: generarTestId(),
            tipo: 'HIGH',
            retador:
                jugadorRetador.username,
            retado:
                jugadorRetado.username,
            gamemode,
            eval: evaluacion,
            resultado,
            desenlace,
            marcador,

            cambiosTier: {
                retador: {
                    anterior:
                        tierRetadorAnterior,
                    nuevo:
                        tierRetadorNuevo,
                    peakAnterior:
                        peakRetadorAnterior,
                    peakNuevo:
                        peakRetadorNuevo
                },

                retado: {
                    anterior:
                        tierRetadoAnterior,
                    nuevo:
                        tierRetadoNuevo,
                    peakAnterior:
                        peakRetadoAnterior,
                    peakNuevo:
                        peakRetadoNuevo,
                    demoteado:
                        evaluacion === 'FAILED'
                }
            },

            puntosCalculadosCon:
                jugadorRetador.fuentePuntos,

            registradoPor:
                req.admin.usuario,

            fecha:
                new Date().toISOString()
        };

        tests.push(nuevoTest);

        const guardado =
            guardarJugadoresYTests(
                jugadores,
                tests,
                jugadoresAnteriores,
                testsAnteriores
            );

        if (!guardado.ok) {
            return res.status(500).json({
                error: guardado.error
            });
        }

        res.status(201).json({
            success: true,
            test: nuevoTest,

            jugadores: {
                retador:
                    jugadorRetador,

                retado:
                    jugadorRetado
            }
        });
    }
);

// Borra solamente el registro.
// No revierte los cambios de tier.
app.delete(
    '/api/tests/:id',
    requireAdmin,
    (req, res) => {
        const tests =
            leerTestsNormalizados();

        const existe = tests.some(
            test =>
                test.id === req.params.id
        );

        if (!existe) {
            return res.status(404).json({
                error: 'Test no encontrado'
            });
        }

        const nuevosTests =
            tests.filter(
                test =>
                    test.id !==
                    req.params.id
            );

        if (
            !escribirArchivo(
                testsFile,
                nuevosTests
            )
        ) {
            return res.status(500).json({
                error:
                    'Error eliminando el registro del test'
            });
        }

        res.json({
            success: true
        });
    }
);

// =====================================================================
// --- RUTAS: RANKING / LEADERBOARD ---
// =====================================================================

app.get('/api/leaderboard', (req, res) => {
    console.log(
        'GET /api/leaderboard - Solicitado.'
    );

    let jugadores = leerJugadoresNormalizados();

    const {
        region,
        estado,
        retirado
    } = req.query;

    const estadoNormalizado = normalizarEstadoJugadores(
        estado,
        retirado
    );

    if (!estadoNormalizado) {
        return res.status(400).json({
            error: 'Estado inválido. Usa activos, retirados o todos'
        });
    }

    jugadores = filtrarJugadoresPorEstado(
        jugadores,
        estadoNormalizado
    );

    if (region) {
        jugadores = jugadores.filter(
            j => j.region === region.toUpperCase()
        );
    }

    jugadores.sort((a, b) => {
        if (a.retirado !== b.retirado) {
            return Number(a.retirado) - Number(b.retirado);
        }

        return (
            b.puntos.total - a.puntos.total ||
            a.username.localeCompare(b.username)
        );
    });

    const ranking = jugadores.map(
        (j, i) => ({
            posicion: i + 1,
            ...j
        })
    );

    res.json(ranking);
});

app.get(
    '/api/leaderboard/:gamemode',
    (req, res) => {
        const { gamemode } = req.params;
        const {
            region,
            estado,
            retirado
        } = req.query;

        console.log(
            `GET /api/leaderboard/${gamemode} - Solicitado.`
        );

        if (!GAMEMODES.includes(gamemode)) {
            return res.status(400).json({
                error:
                    `Gamemode inválido. Debe ser uno de: ` +
                    GAMEMODES.join(', ')
            });
        }

        const estadoNormalizado = normalizarEstadoJugadores(
            estado,
            retirado
        );

        if (!estadoNormalizado) {
            return res.status(400).json({
                error: 'Estado inválido. Usa activos, retirados o todos'
            });
        }

        let jugadores = filtrarJugadoresPorEstado(
            leerJugadoresNormalizados(),
            estadoNormalizado
        ).filter(
            j => j.tiers[gamemode] !== null
        );

        if (region) {
            jugadores = jugadores.filter(
                j => j.region === region.toUpperCase()
            );
        }

        jugadores.sort((a, b) => {
            if (a.retirado !== b.retirado) {
                return Number(a.retirado) - Number(b.retirado);
            }

            const diferenciaPuntos =
                (b.puntos?.[gamemode] || 0) -
                (a.puntos?.[gamemode] || 0);

            if (diferenciaPuntos !== 0) {
                return diferenciaPuntos;
            }

            const diferenciaTierActual =
                indiceTier(a.tiers[gamemode]) -
                indiceTier(b.tiers[gamemode]);

            if (diferenciaTierActual !== 0) {
                return diferenciaTierActual;
            }

            return a.username.localeCompare(b.username);
        });

        const ranking = jugadores.map((j, i) => ({
            posicion: i + 1,
            id: j.id,
            username: j.username,
            region: j.region,
            retirado: j.retirado,
            fechaRetiro: j.fechaRetiro,
            tierGeneral: j.tierGeneral,

            skinHeadUrl: generarSkinHeadUrl(
                j.username,
                160
            ),

            tier: j.tiers[gamemode],
            tierMostrado: formatearTierRetirado(
                j.tiers[gamemode],
                j.retirado
            ),
            peakTier: j.peakTiers?.[gamemode] || null,
            tierPuntuado: j.tiersPuntuados?.[gamemode] || null,
            fuentePuntos: j.fuentePuntos,
            puntos: j.puntos[gamemode]
        }));

        res.json(ranking);
    }
);

// =====================================================================
// --- RUTAS: CUENTAS ---
// =====================================================================

app.post('/api/login', (req, res) => {
    const {
        username,
        password
    } = req.body;

    console.log(
        `POST /api/login - Intento de login para el usuario "${username}".`
    );

    if (!username || !password) {
        return res.status(400).json({
            error:
                'Datos incompletos de cuenta.'
        });
    }

    const accounts =
        leerCuentasNormalizadas();

    const account = accounts.find(
        c =>
            c.usuario === username &&
            c.contraseña === password
    );

    if (!account) {
        console.warn(
            `POST /api/login - Login fallido para el usuario "${username}".`
        );

        return res.status(403).json({
            error:
                'Usuario o contraseña incorrecto'
        });
    }

    if (account.banned) {
        console.warn(
            `POST /api/login - Usuario baneado: ${username}.`
        );

        return res.status(403).json({
            error:
                'Tu cuenta ha sido suspendida. Contacta al administrador.'
        });
    }

    console.log(
        `POST /api/login - Login exitoso para el usuario "${username}".`
    );

    res.status(200).json({
        usuario: account.usuario,
        rol: account.rol,
        fotoPerfil:
            account.fotoPerfil,
        descripcion:
            account.descripcion
    });
});

app.post('/api/cuentas', (req, res) => {
    const {
        usuario,
        contraseña
    } = req.body;

    console.log(
        `POST /api/cuentas - Solicitud de registro para el usuario "${usuario}".`
    );

    if (!usuario || !contraseña) {
        return res.status(400).json({
            error:
                'Datos incompletos de cuenta'
        });
    }

    const cuentas =
        leerCuentasNormalizadas();

    if (
        cuentas.find(
            c => c.usuario === usuario
        )
    ) {
        return res.status(409).json({
            success: false,
            message: 'Usuario ya existe'
        });
    }

    cuentas.push({
        usuario,
        contraseña,
        rol: 'usuario',
        banned: false,
        fotoPerfil: null,
        descripcion: ''
    });

    if (
        !escribirArchivo(
            cuentasFile,
            cuentas
        )
    ) {
        return res.status(500).json({
            error:
                'Error guardando cuenta'
        });
    }

    console.log(
        `POST /api/cuentas - Cuenta para "${usuario}" creada exitosamente.`
    );

    res.status(201).json({
        success: true
    });
});

app.get(
    '/api/cuentas',
    requireAdmin,
    (req, res) => {
        console.log(
            'GET /api/cuentas - Solicitado.'
        );

        const cuentas =
            leerCuentasNormalizadas();

        const cuentasSinPass =
            cuentas.map(c => ({
                usuario: c.usuario,
                rol: c.rol,
                banned:
                    c.banned || false
            }));

        res.json(cuentasSinPass);
    }
);

app.get(
    '/api/cuentas/:usuario/perfil',
    (req, res) => {
        const { usuario } =
            req.params;

        const cuentas =
            leerCuentasNormalizadas();

        const cuenta = cuentas.find(
            c => c.usuario === usuario
        );

        if (!cuenta) {
            return res.status(404).json({
                error:
                    'Usuario no encontrado'
            });
        }

        res.json({
            usuario: cuenta.usuario,
            rol: cuenta.rol,
            fotoPerfil:
                cuenta.fotoPerfil,
            descripcion:
                cuenta.descripcion,
            banned: cuenta.banned
        });
    }
);

app.patch(
    '/api/cuentas/:usuario/foto-perfil',
    (req, res) => {
        const { usuario } =
            req.params;

        const { fotoPerfil } =
            req.body;

        if (fotoPerfil === undefined) {
            return res.status(400).json({
                error:
                    'El campo fotoPerfil es requerido'
            });
        }

        const cuentas =
            leerCuentasNormalizadas();

        const index =
            cuentas.findIndex(
                c =>
                    c.usuario === usuario
            );

        if (index === -1) {
            return res.status(404).json({
                error:
                    'Usuario no encontrado'
            });
        }

        cuentas[index].fotoPerfil =
            fotoPerfil;

        if (
            !escribirArchivo(
                cuentasFile,
                cuentas
            )
        ) {
            return res.status(500).json({
                error:
                    'Error al actualizar foto de perfil'
            });
        }

        res.json({
            success: true,
            message:
                'Foto de perfil actualizada correctamente',
            fotoPerfil
        });
    }
);

app.patch(
    '/api/cuentas/:usuario/descripcion',
    (req, res) => {
        const { usuario } =
            req.params;

        const { descripcion } =
            req.body;

        if (descripcion === undefined) {
            return res.status(400).json({
                error:
                    'El campo descripcion es requerido'
            });
        }

        const cuentas =
            leerCuentasNormalizadas();

        const index =
            cuentas.findIndex(
                c =>
                    c.usuario === usuario
            );

        if (index === -1) {
            return res.status(404).json({
                error:
                    'Usuario no encontrado'
            });
        }

        cuentas[index].descripcion =
            descripcion;

        if (
            !escribirArchivo(
                cuentasFile,
                cuentas
            )
        ) {
            return res.status(500).json({
                error:
                    'Error al actualizar descripción'
            });
        }

        res.json({
            success: true,
            message:
                'Descripción actualizada correctamente',
            descripcion
        });
    }
);

app.patch(
    '/api/cuentas/:usuario/contraseña',
    (req, res) => {
        const { usuario } =
            req.params;

        const {
            contraseñaActual,
            contraseñaNueva
        } = req.body;

        if (
            !contraseñaActual ||
            !contraseñaNueva
        ) {
            return res.status(400).json({
                error:
                    'Se requieren contraseñaActual y contraseñaNueva'
            });
        }

        const cuentas =
            leerCuentasNormalizadas();

        const index =
            cuentas.findIndex(
                c =>
                    c.usuario === usuario
            );

        if (index === -1) {
            return res.status(404).json({
                error:
                    'Usuario no encontrado'
            });
        }

        if (
            cuentas[index].contraseña !==
            contraseñaActual
        ) {
            return res.status(403).json({
                error:
                    'La contraseña actual es incorrecta'
            });
        }

        cuentas[index].contraseña =
            contraseñaNueva;

        if (
            !escribirArchivo(
                cuentasFile,
                cuentas
            )
        ) {
            return res.status(500).json({
                error:
                    'Error al cambiar contraseña'
            });
        }

        res.json({
            success: true,
            message:
                'Contraseña cambiada correctamente'
        });
    }
);

app.patch(
    '/api/cuentas/:usuario/ban',
    requireAdmin,
    (req, res) => {
        const { usuario } =
            req.params;

        const { banned } =
            req.body;

        if (
            typeof banned !== 'boolean'
        ) {
            return res.status(400).json({
                error:
                    'El campo banned debe ser true o false'
            });
        }

        const cuentas =
            leerCuentasNormalizadas();

        const index =
            cuentas.findIndex(
                c =>
                    c.usuario === usuario
            );

        if (index === -1) {
            return res.status(404).json({
                error:
                    'Usuario no encontrado'
            });
        }

        cuentas[index].banned =
            banned;

        if (
            !escribirArchivo(
                cuentasFile,
                cuentas
            )
        ) {
            return res.status(500).json({
                error:
                    'Error al actualizar estado de ban'
            });
        }

        res.json({
            success: true,

            message:
                `Usuario ${
                    banned
                        ? 'baneado'
                        : 'desbaneado'
                } correctamente`
        });
    }
);

// =====================================================================
// --- GESTIÓN DE ROLES ROOT ---
// =====================================================================

app.post(
    '/api/cuentas/:usuario/grant-admin',
    (req, res) => {
        const { usuario } =
            req.params;

        const { rootPassword } =
            req.body;

        if (!rootPassword) {
            return res.status(400).json({
                error:
                    'La contraseña de root es requerida'
            });
        }

        const cuentas =
            leerCuentasNormalizadas();

        const rootAccount =
            cuentas.find(
                c => c.usuario === 'root'
            );

        if (!rootAccount) {
            return res.status(500).json({
                error:
                    'La cuenta root no existe en el sistema'
            });
        }

        if (
            rootAccount.contraseña !==
            rootPassword
        ) {
            return res.status(403).json({
                error:
                    'Contraseña de root incorrecta'
            });
        }

        const index =
            cuentas.findIndex(
                c =>
                    c.usuario === usuario
            );

        if (index === -1) {
            return res.status(404).json({
                error:
                    'Usuario no encontrado'
            });
        }

        if (
            cuentas[index].rol ===
            'admin'
        ) {
            return res.status(409).json({
                error:
                    'El usuario ya es administrador'
            });
        }

        cuentas[index].rol =
            'admin';

        if (
            !escribirArchivo(
                cuentasFile,
                cuentas
            )
        ) {
            return res.status(500).json({
                error:
                    'Error al otorgar rol de administrador'
            });
        }

        res.json({
            success: true,

            message:
                `Rol de administrador otorgado a ${usuario} correctamente`
        });
    }
);

app.post(
    '/api/cuentas/:usuario/revoke-admin',
    (req, res) => {
        const { usuario } =
            req.params;

        const { rootPassword } =
            req.body;

        if (!rootPassword) {
            return res.status(400).json({
                error:
                    'La contraseña de root es requerida'
            });
        }

        const cuentas =
            leerCuentasNormalizadas();

        const rootAccount =
            cuentas.find(
                c => c.usuario === 'root'
            );

        if (!rootAccount) {
            return res.status(500).json({
                error:
                    'La cuenta root no existe en el sistema'
            });
        }

        if (
            rootAccount.contraseña !==
            rootPassword
        ) {
            return res.status(403).json({
                error:
                    'Contraseña de root incorrecta'
            });
        }

        if (usuario === 'root') {
            return res.status(403).json({
                error:
                    'No se puede revocar el rol de administrador de la cuenta root'
            });
        }

        const index =
            cuentas.findIndex(
                c =>
                    c.usuario === usuario
            );

        if (index === -1) {
            return res.status(404).json({
                error:
                    'Usuario no encontrado'
            });
        }

        if (
            cuentas[index].rol !==
            'admin'
        ) {
            return res.status(409).json({
                error:
                    'El usuario no es administrador'
            });
        }

        cuentas[index].rol =
            'usuario';

        if (
            !escribirArchivo(
                cuentasFile,
                cuentas
            )
        ) {
            return res.status(500).json({
                error:
                    'Error al revocar rol de administrador'
            });
        }

        res.json({
            success: true,

            message:
                `Rol de administrador revocado a ${usuario} correctamente`
        });
    }
);

// =====================================================================
// --- INICIAR SERVIDOR ---
// =====================================================================

app.listen(PORT, '0.0.0.0', () => {
    console.log(
        `Servidor del Tierlist activo en puerto ${PORT}`
    );
});