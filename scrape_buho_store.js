/**
 * scrape_buho_store.js — Scraper para productos de buho.la/store
 * Extrae información de las páginas de productos y actualiza los JSON en data/knowledge/
 * 
 * Uso: node scrape_buho_store.js
 * 
 * Requiere: axios, cheerio
 * Instalar: npm install cheerio
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const KNOWLEDGE_DIR = path.join(__dirname, 'data', 'knowledge');

// Configuración de productos a scrapear (TODOS los productos de buho.la/store)
const PRODUCTS = [
    // ─── Hosting ───
    {
        url: 'https://buho.la/store/hosting-compartido',
        jsonFile: 'hosting.json',
        name: 'Hosting Linux',
        samplePurchaseUrl: 'https://buho.la/store/hosting-compartido/hosting-l5'
    },
    // ─── Comunicación ───
    {
        url: 'https://buho.la/store/chat',
        jsonFile: 'buhochat.json',
        name: 'Chat Buho',
        samplePurchaseUrl: 'https://buho.la/store/chat/chat-buho-ch-3'
    },
    {
        url: 'https://buho.la/store/google-workspace',
        jsonFile: 'correoscorporativos.json',
        name: 'Correos Corporativos: Google Workspace',
        samplePurchaseUrl: 'https://buho.la/store/google-workspace/g30a'
    },
    {
        url: 'https://buho.la/store/zoho-mail',
        jsonFile: 'zohomail.json',
        name: 'Correos Corporativos: Zoho Mail',
        samplePurchaseUrl: 'https://buho.la/store/zoho-mail/zoho-mail-z5'
    },
    // ─── WhatsApp API (Waya) ───
    {
        url: 'https://buho.la/store/waya-empresa',
        jsonFile: 'waya_empresa.json',
        name: 'Waya - 1 Empresa',
        samplePurchaseUrl: 'https://buho.la/store/waya-empresa/w1'
    },
    {
        url: 'https://buho.la/store/waya-reseller',
        jsonFile: 'waya_reseller.json',
        name: 'Waya - Resellers',
        samplePurchaseUrl: 'https://buho.la/store/waya-reseller/wr5'
    },
    // ─── Facturación Perú ───
    {
        url: 'https://buho.la/store/facturafacil',
        jsonFile: 'facturafacil.json',
        name: 'Factura Fácil - Perú',
        samplePurchaseUrl: 'https://buho.la/store/facturafacil/factura-facil-f3'
    },
    {
        url: 'https://buho.la/store/fastura',
        jsonFile: 'fastura.json',
        name: 'Fastura - Perú',
        samplePurchaseUrl: 'https://buho.la/store/fastura/fastura-reseller-r5'
    },
    {
        url: 'https://buho.la/store/validacion',
        jsonFile: 'validacion.json',
        name: 'Validación OSE / Firmas PSE - Perú',
        samplePurchaseUrl: 'https://buho.la/store/validacion/ose-ff-1k'
    },
    {
        url: 'https://buho.la/store/certificado-sunat',
        jsonFile: 'certificadosunat.json',
        name: 'Certificado Digital - SUNAT Perú',
        samplePurchaseUrl: 'https://buho.la/store/certificado-sunat/certificado-digital-sunat-clientes'
    },
    {
        url: 'https://buho.la/store/app',
        jsonFile: 'app31.json',
        name: 'APP 3.1 Facturación - Perú',
        samplePurchaseUrl: 'https://buho.la/store/app/essential'
    },
    // ─── Facturación Colombia ───
    {
        url: 'https://buho.la/store/fastura-colombia',
        jsonFile: 'fastura_colombia.json',
        name: 'Fastura - Colombia',
        samplePurchaseUrl: null
    }
];

/**
 * Extrae los planes y precios de una página de producto de buho.la/store
 */
async function scrapeProductPage(url) {
    try {
        console.log(`\n📦 Scrapeando: ${url}`);
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        const $ = cheerio.load(res.data);

        // Extraer título principal
        const title = $('h1').first().text().trim();
        console.log(`   Título: ${title}`);

        // Extraer descripción
        const description = $('.product-group-description, .product-group-subtitle, .sub-heading')
            .first().text().trim();

        // Extraer planes con precios
        const plans = [];
        $('.package').each((i, el) => {
            const planName = $(el).find('.package-name h3, .package-name').text().trim();
            const priceAmount = $(el).find('.price-amount').text().trim();
            const priceCycle = $(el).find('.price-cycle').text().trim();
            const setupFee = $(el).find('.price-setup').text().trim();
            const orderUrl = $(el).find('a.btn-order-now, a[href*="store/"]').attr('href') || '';

            // Extraer características del plan
            const features = [];
            $(el).find('.package-features li, .package-content li').each((j, li) => {
                const text = $(li).text().trim();
                if (text) features.push(text);
            });

            if (planName) {
                plans.push({
                    nombre: planName,
                    precio: priceAmount || 'Consultar',
                    ciclo: priceCycle || '',
                    costo_instalacion: setupFee || '',
                    caracteristicas: features,
                    url_pedido: orderUrl.startsWith('http') ? orderUrl : `https://buho.la${orderUrl}`
                });
                console.log(`   ✅ Plan: ${planName} — ${priceAmount} ${priceCycle}`);
            }
        });

        return { title, description, plans };
    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        return null;
    }
}

/**
 * Intenta scrapear la página de compra de un producto
 */
async function scrapePurchasePage(url) {
    try {
        console.log(`   🛒 Scrapeando página de compra: ${url}`);
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            maxRedirects: 5
        });
        const $ = cheerio.load(res.data);

        // Extraer opciones de ciclo de facturación
        const billingCycles = [];
        $('input[name="billingcycle"], .billing-cycle-option, .cycle-option').each((i, el) => {
            const cycleName = $(el).parent().text().trim() || $(el).attr('data-label') || '';
            const cyclePrice = $(el).attr('data-price') || '';
            if (cycleName) {
                billingCycles.push({ ciclo: cycleName, precio: cyclePrice });
            }
        });

        // Extraer resumen de precios
        const summary = {};
        $('.order-summary, .product-summary, .total-due-today').each((i, el) => {
            summary.total = $(el).find('.total, .total-amount').text().trim();
        });

        return { billingCycles, summary };
    } catch (error) {
        console.error(`   ❌ Error en página de compra: ${error.message}`);
        return null;
    }
}

/**
 * Actualiza el JSON de un producto con los planes scrapeados
 */
function updateProductJSON(product, scrapedPlans) {
    const filePath = path.join(KNOWLEDGE_DIR, product.jsonFile);

    if (!fs.existsSync(filePath)) {
        console.log(`   ⚠️  Archivo ${product.jsonFile} no existe, saltando actualización.`);
        return;
    }

    try {
        const existingData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        // Actualizar precios de planes existentes si hay datos nuevos scrapeados
        if (scrapedPlans && scrapedPlans.length > 0) {
            for (const scrapedPlan of scrapedPlans) {
                // Buscar plan correspondiente en el JSON existente
                const existingPlan = existingData.planes.find(p =>
                    p.nombre.toLowerCase().includes(scrapedPlan.nombre.toLowerCase().substring(0, 10)) ||
                    scrapedPlan.nombre.toLowerCase().includes(p.nombre.toLowerCase().substring(0, 10))
                );

                if (existingPlan && scrapedPlan.precio && scrapedPlan.precio !== 'Consultar') {
                    const oldPrice = existingPlan.precio;
                    existingPlan.precio = scrapedPlan.precio;
                    if (oldPrice !== scrapedPlan.precio) {
                        console.log(`   📝 Precio actualizado: ${existingPlan.nombre}: ${oldPrice} → ${scrapedPlan.precio}`);
                    }
                }
            }
        }

        // Actualizar fecha de última actualización
        existingData.ultima_actualizacion = new Date().toISOString();

        fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2), 'utf-8');
        console.log(`   ✅ ${product.jsonFile} actualizado`);
    } catch (error) {
        console.error(`   ❌ Error actualizando ${product.jsonFile}: ${error.message}`);
    }
}

/**
 * Función principal
 */
async function main() {
    console.log('═══════════════════════════════════════');
    console.log('🦉 SCRAPER DE PRODUCTOS DIGITAL BUHO');
    console.log('═══════════════════════════════════════');
    console.log(`📁 Directorio de conocimiento: ${KNOWLEDGE_DIR}`);
    console.log(`📅 Fecha: ${new Date().toISOString()}\n`);

    // Verificar que existe el directorio
    if (!fs.existsSync(KNOWLEDGE_DIR)) {
        console.error('❌ Directorio de conocimiento no encontrado. Creándolo...');
        fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
    }

    for (const product of PRODUCTS) {
        console.log(`\n${'─'.repeat(40)}`);
        console.log(`🔍 Procesando: ${product.name}`);

        // 1. Scrapear página principal del producto
        const productData = await scrapeProductPage(product.url);

        // 2. Scrapear una página de compra de ejemplo
        if (product.samplePurchaseUrl) {
            await scrapePurchasePage(product.samplePurchaseUrl);
        }

        // 3. Actualizar JSON si tenemos datos
        if (productData && productData.plans.length > 0) {
            updateProductJSON(product, productData.plans);
        } else {
            console.log(`   ⚠️  No se encontraron planes en la página (puede ser SPA/JavaScript).`);
            console.log(`   ℹ️  Los precios en los JSON ya fueron establecidos manualmente.`);
        }

        // Esperar un poco entre requests
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\n${'═'.repeat(40)}`);
    console.log('✅ Scraping completado');

    // Mostrar resumen de archivos
    const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.json'));
    console.log(`\n📊 RESUMEN:`);
    console.log(`   Total archivos JSON: ${files.length}`);
    for (const f of files) {
        const size = fs.statSync(path.join(KNOWLEDGE_DIR, f)).size;
        console.log(`   - ${f} (${(size / 1024).toFixed(1)} KB)`);
    }
}

main().catch(err => console.error('Error fatal:', err));
