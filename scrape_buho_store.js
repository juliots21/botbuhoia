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
let playwright = null;

const KNOWLEDGE_DIR = path.join(__dirname, 'data', 'knowledge');

function cleanText(value = '') {
    return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeKey(value = '') {
    return cleanText(value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '');
}

function extractSlug(value = '') {
    if (!value) return '';
    try {
        const url = new URL(value);
        const parts = url.pathname.split('/').filter(Boolean);
        return normalizeKey(parts[parts.length - 1] || '');
    } catch {
        const parts = String(value).split('/').filter(Boolean);
        return normalizeKey(parts[parts.length - 1] || '');
    }
}

function extractBasePrice(value = '') {
    const text = cleanText(value);
    if (/gratis|free/i.test(text)) {
        return 'Gratis';
    }
    const match = text.match(/(?:S\/|US\$|\$)\s?\d[\d.,]*/i);
    return match ? cleanText(match[0]) : text;
}

function shouldUseAnnualField(cycle = '') {
    return /anual|bianual|trienal/i.test(cycle) && !/semi-anual/i.test(cycle);
}

function shouldUseMonthlyField(cycle = '') {
    return /mensual/i.test(cycle);
}

function shouldUseSemiAnnualField(cycle = '') {
    return /semi-anual/i.test(cycle);
}

function normalizeCycleName(value = '') {
    const text = cleanText(value);
    if (/mensual/i.test(text)) return 'Mensual';
    if (/semi-anual/i.test(text)) return 'Semi-Anual';
    if (/anual/i.test(text)) return 'Anual';
    if (/bianual/i.test(text)) return 'Bi-Anual';
    if (/trienal/i.test(text)) return 'Trienal';
    return text;
}

function parseCyclePriceText(text = '') {
    const flat = cleanText(text);
    const cycleMatch = flat.match(/Mensual|Semi-Anual|Anual|Bi-Anual|Trienal(?:mente)?/i);
    const priceMatch = flat.match(/(?:S\/|US\$|\$)\s?\d[\d.,]*(?:\s?[A-Z]{3})?/i);
    const discountMatch = flat.match(/Ahorras?\s+el\s+\d+%|\d+%\s*(?:Dsto|Descuento|de ahorro)/i);
    const originalMatch = flat.match(/(?:S\/|US\$|\$)\s?\d[\d.,]*(?:\s?[A-Z]{3})?\s*$/i);

    return {
        ciclo: normalizeCycleName(cycleMatch ? cycleMatch[0] : ''),
        precio: priceMatch ? cleanText(priceMatch[0]) : '',
        descuento: discountMatch ? cleanText(discountMatch[0]) : '',
        precio_original: discountMatch && originalMatch ? cleanText(originalMatch[0]) : ''
    };
}

function mergeUniqueCycles(cycles = []) {
    const seen = new Set();
    const merged = [];
    for (const c of cycles) {
        const key = `${normalizeKey(c.ciclo)}|${normalizeKey(c.precio)}|${normalizeKey(c.descuento)}|${normalizeKey(c.precio_original)}`;
        if (key !== '|||' && !seen.has(key)) {
            seen.add(key);
            merged.push(c);
        }
    }
    return merged;
}

function extractTokenHints(name = '') {
    const text = normalizeKey(name);
    const hints = [];
    if (text.includes('essential')) hints.push('essential');
    if (text.includes('priority')) hints.push('priority');
    if (text.includes('ilimitado')) hints.push('ilimitado');
    return hints;
}

function escapeRegExp(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCyclesFromTextBlock(text = '') {
    const cycles = [];
    const cycleRegex = /(Mensual|Semi-Anual|Anual|Bi-Anual|Trienal(?:mente)?)\s*((?:S\/|US\$|\$)\s?\d[\d.,]*(?:\s?[A-Z]{3})?)(?:\s*Ahorras?\s*(?:el\s*)?(\d+%))?(?:\s*((?:S\/|US\$|\$)\s?\d[\d.,]*(?:\s?[A-Z]{3})?))?/gi;
    let m;
    while ((m = cycleRegex.exec(text)) !== null) {
        cycles.push({
            ciclo: normalizeCycleName(m[1]),
            precio: cleanText(m[2]),
            descuento: m[3] ? cleanText(m[3]) : '',
            precio_original: m[4] ? cleanText(m[4]) : ''
        });
    }
    return mergeUniqueCycles(cycles);
}

async function scrapePurchasePageWithBrowser(url, expectedPlanName = '') {
    try {
        if (!playwright) {
            playwright = require('playwright');
        }
    } catch (error) {
        console.log('   ⚠️  Playwright no está disponible para fallback de click real.');
        return null;
    }

    let browser;
    try {
        browser = await playwright.chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        });
        const page = await context.newPage();

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(1200);

        let bodyText = cleanText(await page.textContent('body'));
        let isConfig = /configurar|elija ciclo|sumario de pedido|importe a la fecha/i.test(bodyText);

        // Si no llegó a Configurar, intenta clickear el botón Pedir Ahora del plan esperado.
        if (!isConfig) {
            const cards = page.locator('.package');
            const count = await cards.count();
            const expectedNorm = normalizeKey(expectedPlanName);

            for (let i = 0; i < count; i++) {
                const card = cards.nth(i);
                const cardText = normalizeKey(await card.innerText());
                if (!expectedNorm || cardText.includes(expectedNorm.substring(0, Math.min(expectedNorm.length, 12)))) {
                    const btn = card.locator('a.btn-order-now').first();
                    if (await btn.count()) {
                        await Promise.all([
                            page.waitForLoadState('domcontentloaded', { timeout: 45000 }),
                            btn.click({ timeout: 10000 })
                        ]);
                        await page.waitForTimeout(1200);
                        break;
                    }
                }
            }

            bodyText = cleanText(await page.textContent('body'));
            isConfig = /configurar|elija ciclo|sumario de pedido|importe a la fecha/i.test(bodyText);
        }

        if (!isConfig) {
            await context.close();
            return null;
        }

        const cycleSectionMatch = bodyText.match(/Elija Ciclo[\s\S]*?Sumario de Pedido/i);
        const cycleSection = cycleSectionMatch ? cycleSectionMatch[0] : bodyText;
        const billingCycles = extractCyclesFromTextBlock(cycleSection);

        const summary = await page.evaluate(() => {
            const result = {};
            const allText = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
            const totalMatch = allText.match(/Importe a la Fecha\s*((?:S\/|US\$|\$)\s?\d[\d.,]*(?:\s?[A-Z]{3})?)/i);
            if (totalMatch) result.total = totalMatch[1].trim();
            return result;
        });

        await context.close();
        return { billingCycles, summary };
    } catch (error) {
        console.log(`   ⚠️  Fallback browser falló: ${error.message}`);
        return null;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

function extractFacturaloPeriods(html = '', planKey = 'essential') {
    const blockRegex = new RegExp(`${planKey}\\s*:\\s*\\{([\\s\\S]*?)defaultPeriodIndex`, 'i');
    const blockMatch = html.match(blockRegex);
    if (!blockMatch) return [];

    const periodsBlock = blockMatch[1];
    const periodRegex = /\{[^}]*durationMonths\s*:\s*(\d+)[^}]*price\s*:\s*([\d.]+)[^}]*label\s*:\s*"([^"]+)"[^}]*\}/gi;
    const periods = [];
    let match;

    while ((match = periodRegex.exec(periodsBlock)) !== null) {
        periods.push({
            meses: Number(match[1]),
            precio_total: Number(match[2]),
            etiqueta: cleanText(match[3])
        });
    }

    return periods;
}

function extractFacturaloDiscountMap(text = '', startToken = '', endToken = '') {
    if (!startToken) return {};
    const startIndex = text.toLowerCase().indexOf(startToken.toLowerCase());
    if (startIndex < 0) return {};

    let endIndex = text.length;
    if (endToken) {
        const candidate = text.toLowerCase().indexOf(endToken.toLowerCase(), startIndex + startToken.length);
        if (candidate > startIndex) endIndex = candidate;
    }

    const section = text.slice(startIndex, endIndex);
    const discountMap = {};
    const regex = /(\d+)\s*Mes(?:es)?(?:\s*con\s*(\d+)%\s*Dsto)?/gi;
    let m;
    while ((m = regex.exec(section)) !== null) {
        discountMap[Number(m[1])] = m[2] ? `${m[2]}%` : 'Oferta';
    }

    return discountMap;
}

async function scrapeFacturaloPro8Page(url) {
    try {
        console.log(`\n📦 Scrapeando (método Facturalo): ${url}`);
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const html = res.data;
        const $ = cheerio.load(html);
        const title = cleanText($('h1').first().text()) || 'Facturalo Perú';
        const bodyText = cleanText($('body').text());

        const cards = $('.pricing-rates, .business-rate, .prices-section .card');
        const cardInfo = [];
        cards.each((i, el) => {
            const name = cleanText($(el).find('h4, h5, .title').first().text());
            const includes = [];
            $(el).find('li').each((j, li) => {
                const t = cleanText($(li).text());
                if (t) includes.push(t);
            });
            if (name) cardInfo.push({ name, includes });
        });

        const essentialPeriods = extractFacturaloPeriods(html, 'essential');
        const priorityPeriods = extractFacturaloPeriods(html, 'priority');
        const essentialDiscounts = extractFacturaloDiscountMap(bodyText, 'Plan Essential', 'Plan Priority');
        const priorityDiscounts = extractFacturaloDiscountMap(bodyText, 'Plan Priority', '*Precios no incluyen');

        const plans = [];

        if (essentialPeriods.length > 0) {
            const includes = (cardInfo.find((c) => /essential/i.test(c.name)) || {}).includes || [];
            plans.push({
                nombre: 'Plan Essential',
                descripcion: 'Plan extraído desde facturaloperu.com/pro8',
                ciclos_facturacion: essentialPeriods.map((p) => ({
                    meses: p.meses,
                    descuento: essentialDiscounts[p.meses] || 'Oferta',
                    precio_total: p.precio_total,
                    moneda: 'PEN',
                    incluye: includes
                }))
            });
        }

        if (priorityPeriods.length > 0) {
            const includes = (cardInfo.find((c) => /priority/i.test(c.name)) || {}).includes || [];
            plans.push({
                nombre: 'Plan Priority',
                descripcion: 'Plan extraído desde facturaloperu.com/pro8',
                ciclos_facturacion: priorityPeriods.map((p) => ({
                    meses: p.meses,
                    descuento: priorityDiscounts[p.meses] || 'Oferta',
                    precio_total: p.precio_total,
                    moneda: 'PEN',
                    incluye: includes
                }))
            });
        }

        return {
            title,
            description: cleanText($('.section-title p').first().text()),
            plans,
            sourceType: 'facturalo-pro8'
        };
    } catch (error) {
        console.error(`   ❌ Error en método Facturalo: ${error.message}`);
        return null;
    }
}

async function scrapeSpaPricingPage(url, sourceType = 'spa-pricing') {
    try {
        if (!playwright) {
            playwright = require('playwright');
        }
    } catch (error) {
        console.error('   ❌ Playwright no está disponible para scrapear VendeYa (SPA).');
        return null;
    }

    let browser;
    try {
        console.log(`\n📦 Scrapeando (método SPA): ${url}`);
        browser = await playwright.chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        });
        const page = await context.newPage();

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(2500);

        const pricesLink = page.locator('a:has-text("Precios")').first();
        if (await pricesLink.count()) {
            try {
                await pricesLink.click({ timeout: 8000 });
                await page.waitForTimeout(1800);
            } catch {
                // Si falla el click, continúa con el DOM actual.
            }
        }

        let cards = page.locator('div.uk-card.uk-card-default.uk-card-body');
        if (await cards.count() === 0) {
            await page.goto(`${url}#precios`, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(2500);
            cards = page.locator('div.uk-card.uk-card-default.uk-card-body');
        }

        const plans = await page.evaluate(() => {
            const clean = (v = '') => String(v).replace(/\s+/g, ' ').trim();
            const normalizePrice = (raw = '') => {
                const flat = clean(raw);
                if (/gratis|free/i.test(flat)) return 'Gratis';
                const m = flat.match(/(?:S\/|US\$|\$)\s?\d[\d.,]*/i);
                return m ? clean(m[0]) : flat;
            };

            const cardNodes = Array.from(document.querySelectorAll('div.uk-card.uk-card-default.uk-card-body'));
            const extracted = [];

            for (const card of cardNodes) {
                const name = clean((card.querySelector('h3.el-meta') || card.querySelector('h3'))?.textContent || '');
                if (!name) continue;

                const priceText = clean((card.querySelector('.el-title') || card.querySelector('.price-original'))?.textContent || '');
                const desc = clean((card.querySelector('.el-content p') || {}).textContent || '');
                const actionHref = (card.querySelector('a.el-link') || {}).href || '';

                const incluye = [];
                const noIncluye = [];

                for (const li of Array.from(card.querySelectorAll('li'))) {
                    const text = clean(li.textContent || '');
                    if (!text) continue;

                    const hasDangerIcon = !!li.querySelector('.uk-text-danger');
                    const imgSrc = ((li.querySelector('img') || {}).getAttribute?.('src') || '').toLowerCase();
                    const isNoIncluded = hasDangerIcon || /circle-close|cross|xmark|times/.test(imgSrc) || /^x\s+/i.test(text) || /^×\s*/.test(text);
                    if (isNoIncluded) noIncluye.push(text.replace(/^x\s+/i, '').replace(/^×\s*/, ''));
                    else incluye.push(text);
                }

                extracted.push({
                    nombre: name,
                    precio: normalizePrice(priceText),
                    descripcion: desc,
                    incluye,
                    no_incluye: noIncluye,
                    url_pedido: actionHref
                });
            }

            return extracted;
        });

        const title = cleanText(await page.title()) || 'VendeYa.pe';
        const description = cleanText(await page.locator('body').innerText()).match(/Vende y atiende[^.]+\./i)?.[0] || '';

        await context.close();
        return {
            title,
            description: cleanText(description),
            plans,
            sourceType
        };
    } catch (error) {
        console.error(`   ❌ Error en método SPA: ${error.message}`);
        return null;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

async function scrapeVendeyaPage(url) {
    return await scrapeSpaPricingPage(url, 'vendeya-spa');
}

async function scrapeMozoPage(url) {
    return await scrapeSpaPricingPage(url, 'mozo-spa');
}

function findMatchingPlan(existingPlanes, scrapedPlan) {
    const scrapedNameNorm = normalizeKey(scrapedPlan.nombre);
    const scrapedSlug = extractSlug(scrapedPlan.url_pedido);

    if (scrapedSlug) {
        const bySlug = existingPlanes.find((p) => extractSlug(p.url_pedido) === scrapedSlug);
        if (bySlug) return bySlug;
    }

    const byCode = existingPlanes.find((p) => {
        if (!p.codigo) return false;
        const codeNorm = normalizeKey(p.codigo);
        return codeNorm && scrapedNameNorm.includes(codeNorm);
    });
    if (byCode) return byCode;

    const byExactName = existingPlanes.find((p) => normalizeKey(p.nombre) === scrapedNameNorm);
    if (byExactName) return byExactName;

    const scrapedHints = extractTokenHints(scrapedPlan.nombre);
    if (scrapedHints.length > 0) {
        const byHints = existingPlanes.find((p) => {
            const planHints = extractTokenHints(p.nombre);
            return scrapedHints.some((h) => planHints.includes(h));
        });
        if (byHints) return byHints;
    }

    return null;
}

// Configuración de productos a scrapear (TODOS los 17 productos de buho.la/store)
const PRODUCTS = [
    // ─── Infraestructura ───
    {
        url: 'https://buho.la/store/hosting-compartido',
        jsonFile: 'hosting.json',
        name: 'Hosting Linux',
        samplePurchaseUrl: 'https://buho.la/store/hosting-compartido/hosting-l5'
    },
    {
        url: 'https://buho.la/store/vps',
        jsonFile: 'vps.json',
        name: 'Servidores Cloud VPS',
        samplePurchaseUrl: 'https://buho.la/store/vps/e4'
    },
    // ─── Correos Corporativos ───
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
    // ─── Comunicación ───
    {
        url: 'https://buho.la/store/chat',
        jsonFile: 'buhochat.json',
        name: 'Chat Buho',
        samplePurchaseUrl: 'https://buho.la/store/chat/chat-buho-ch-3'
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
        url: 'https://buho.la/store/pro8',
        jsonFile: 'pro8.json',
        name: 'Facturador Pro 8 - Perú',
        samplePurchaseUrl: 'https://buho.la/store/pro8/pro8-essential'
    },
    {
        url: 'https://facturaloperu.com/pro8/',
        jsonFile: 'facturaloperu.json',
        name: 'Facturalo Perú',
        samplePurchaseUrl: null
    },
    {
        url: 'https://mozo.pe/',
        jsonFile: 'mozo.json',
        name: 'Mozo.pe - Perú',
        samplePurchaseUrl: null
    },
    {
        url: 'https://buho.la/store/app',
        jsonFile: 'app31.json',
        name: 'APP 3.1 Facturación - Perú',
        samplePurchaseUrl: 'https://buho.la/store/app/essential'
    },
    // ─── Colombia ───
    {
        url: 'https://buho.la/store/fastura-colombia',
        jsonFile: 'fastura_colombia.json',
        name: 'Fastura - Colombia',
        samplePurchaseUrl: null
    },
    {
        url: 'https://buho.la/store/certificados-dian',
        jsonFile: 'certificados_dian.json',
        name: 'Certificado Digital - DIAN Colombia',
        samplePurchaseUrl: null
    },
    // ─── Otros ───
    {
        url: 'https://buho.la/store/qrbuho',
        jsonFile: 'qrbuho.json',
        name: 'Qrbuho',
        samplePurchaseUrl: null
    }
];


/**
 * Extrae los planes y precios de una página de producto de buho.la/store
 */
async function scrapeProductPage(url) {
    try {
        if (/facturaloperu\.com\/pro8/i.test(url)) {
            return await scrapeFacturaloPro8Page(url);
        }

        if (/vendeya\.pe/i.test(url)) {
            return await scrapeVendeyaPage(url);
        }

        if (/mozo\.pe/i.test(url)) {
            return await scrapeMozoPage(url);
        }

        console.log(`\n📦 Scrapeando: ${url}`);
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        const $ = cheerio.load(res.data);

        // Extraer título principal
        const title = cleanText($('h1').first().text());
        console.log(`   Título: ${title}`);

        // Extraer descripción
        const description = cleanText(
            $('.product-group-description, .product-group-subtitle, .sub-heading')
                .first().text()
        );

        // Extraer planes con precios
        const plans = [];
        $('.package').each((i, el) => {
            const planName = cleanText(
                $(el)
                    .find('.package-title, .package-name h3, .package-name, .package-header h3, h3')
                    .first()
                    .text()
            );

            const priceAmount = cleanText(
                $(el).find('.price-amount, .package-price .price').first().text()
            );
            const priceCycle = cleanText($(el).find('.price-cycle').first().text());
            const setupFee = cleanText($(el).find('.price-setup').first().text());
            const orderUrl = $(el).find('a.btn-order-now, a[href*="store/"]').attr('href') || '';

            // Extraer características del plan
            const features = [];
            $(el).find('.package-features li, .package-content li').each((j, li) => {
                const text = cleanText($(li).text());
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

        if (plans.length === 0 && $('.package').length > 0) {
            console.log('   ⚠️  Se detectaron bloques .package pero no se pudo extraer nombre de planes.');
        }

        return { title, description, plans };
    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        return null;
    }
}

/**
 * Intenta scrapear la página de compra de un producto
 */
async function scrapePurchasePage(url, expectedPlanName = '') {
    try {
        console.log(`   🛒 Scrapeando página de compra: ${url}`);
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            maxRedirects: 5
        });
        const $ = cheerio.load(res.data);
        const pageText = cleanText($('body').text());
        const isConfigPage = /configurar|elija ciclo|sumario de pedido|importe a la fecha/i.test(pageText);

        // Extraer opciones de ciclo de facturación
        const billingCycles = [];
        $('input[name="billingcycle"], .billing-cycle-option, .cycle-option').each((i, el) => {
            const cycleName = cleanText($(el).parent().text()) || $(el).attr('data-label') || '';
            const cyclePrice = cleanText($(el).attr('data-price') || '');
            if (cycleName) {
                const parsed = parseCyclePriceText(`${cycleName} ${cyclePrice}`);
                billingCycles.push({
                    ciclo: parsed.ciclo || normalizeCycleName(cycleName),
                    precio: parsed.precio || cyclePrice,
                    descuento: parsed.descuento || '',
                    precio_original: parsed.precio_original || ''
                });
            }
        });

        // Fallback estricto para páginas de configuración real.
        if (billingCycles.length === 0 && isConfigPage) {
            const cycleSectionMatch = pageText.match(/Elija Ciclo[\s\S]*?Sumario de Pedido/i);
            const cycleSection = cycleSectionMatch ? cycleSectionMatch[0] : pageText;
            billingCycles.push(...extractCyclesFromTextBlock(cycleSection));
        }

        // Extraer resumen de precios
        const summary = {};
        $('.order-summary, .product-summary, .total-due-today').each((i, el) => {
            const totalText = cleanText($(el).find('.total, .total-amount, .amount').text());
            if (totalText) summary.total = totalText;
        });

        const uniqueCycles = mergeUniqueCycles(
            billingCycles.filter((c) => c && c.ciclo && c.precio)
        );

        if (uniqueCycles.length === 0) {
            const browserData = await scrapePurchasePageWithBrowser(url, expectedPlanName);
            if (browserData && browserData.billingCycles && browserData.billingCycles.length > 0) {
                return browserData;
            }
        }

        return { billingCycles: uniqueCycles, summary };
    } catch (error) {
        console.error(`   ❌ Error en página de compra: ${error.message}`);
        return await scrapePurchasePageWithBrowser(url, expectedPlanName);
    }
}

/**
 * Actualiza el JSON de un producto con los planes scrapeados
 */
function updateProductJSON(product, productData) {
    const filePath = path.join(KNOWLEDGE_DIR, product.jsonFile);

    if (!fs.existsSync(filePath)) {
        console.log(`   ⚠️  Archivo ${product.jsonFile} no existe, saltando actualización.`);
        return;
    }

    try {
        const existingData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const scrapedPlans = (productData && Array.isArray(productData.plans)) ? productData.plans : [];

        if (productData && productData.title) {
            existingData.sitio = existingData.sitio || productData.title;
        }

        if (productData && productData.description && !existingData.descripcion_general) {
            existingData.descripcion_general = productData.description;
        }

        // Actualizar precios de planes existentes si hay datos nuevos scrapeados
        const existingPlanes = Array.isArray(existingData.planes) ? existingData.planes : [];

        if (productData && productData.sourceType === 'facturalo-pro8') {
            if (scrapedPlans.length > 0) {
                existingData.planes = scrapedPlans;
                console.log(`   ✅ Planes de Facturalo actualizados (${scrapedPlans.length})`);
            } else {
                console.log('   ⚠️  Método Facturalo sin planes extraídos, se mantiene JSON actual.');
            }
        } else if (productData && (productData.sourceType === 'vendeya-spa' || productData.sourceType === 'mozo-spa')) {
            if (scrapedPlans.length > 0) {
                existingData.planes = scrapedPlans;
                console.log(`   ✅ Planes SPA actualizados (${scrapedPlans.length})`);
            } else {
                console.log('   ⚠️  Método SPA sin planes extraídos, se mantiene JSON actual.');
            }
        } else if (scrapedPlans && scrapedPlans.length > 0 && existingPlanes.length > 0) {
            for (const scrapedPlan of scrapedPlans) {
                // Buscar plan correspondiente en el JSON existente
                const existingPlan = findMatchingPlan(existingPlanes, scrapedPlan);

                if (existingPlan && scrapedPlan.precio && scrapedPlan.precio !== 'Consultar') {
                    const normalizedPrice = extractBasePrice(scrapedPlan.precio);
                    let targetField = 'precio';

                    if (existingPlan.precio_semianual && shouldUseSemiAnnualField(scrapedPlan.ciclo)) {
                        targetField = 'precio_semianual';
                    } else if (existingPlan.precio_mensual && shouldUseMonthlyField(scrapedPlan.ciclo)) {
                        targetField = 'precio_mensual';
                    } else if (existingPlan.precio_anual && shouldUseAnnualField(scrapedPlan.ciclo)) {
                        targetField = 'precio_anual';
                    } else if (existingPlan.precio) {
                        targetField = 'precio';
                    }

                    const oldPrice = existingPlan[targetField];
                    existingPlan[targetField] = normalizedPrice;

                    if (oldPrice !== normalizedPrice) {
                        console.log(`   📝 Precio actualizado (${targetField}): ${existingPlan.nombre}: ${oldPrice} → ${normalizedPrice}`);
                    }
                } else if (!existingPlan) {
                    const newPlan = {
                        nombre: scrapedPlan.nombre,
                        precio: extractBasePrice(scrapedPlan.precio || ''),
                        ciclo: scrapedPlan.ciclo || '',
                        incluye: scrapedPlan.caracteristicas || [],
                        url_pedido: scrapedPlan.url_pedido || ''
                    };
                    existingPlanes.push(newPlan);
                    console.log(`   ➕ Plan agregado al JSON: ${scrapedPlan.nombre}`);
                    continue;
                }

                if (existingPlan && scrapedPlan.ciclos_facturacion_extraidos && scrapedPlan.ciclos_facturacion_extraidos.length > 0) {
                    existingPlan.ciclos_facturacion = scrapedPlan.ciclos_facturacion_extraidos.map((c) => ({
                        ciclo: normalizeCycleName(c.ciclo),
                        precio: c.precio || '',
                        descuento: c.descuento || '',
                        precio_original: c.precio_original || ''
                    }));
                    console.log(`   🔄 Ciclos extraídos de carrito actualizados para ${existingPlan.nombre}`);
                }
            }
        } else if (existingPlanes.length === 0) {
            existingData.nota = existingData.nota || 'Actualmente no hay productos visibles en esta categoría.';
            console.log('   ℹ️  Categoría sin planes visibles, se mantiene JSON con nota informativa.');
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

    // Cargar fuentes adicionales desde scraper_sources.json
    const SCRAPER_SOURCES_FILE = path.join(__dirname, 'data', 'scraper_sources.json');
    if (fs.existsSync(SCRAPER_SOURCES_FILE)) {
        try {
            const extraSources = JSON.parse(fs.readFileSync(SCRAPER_SOURCES_FILE, 'utf-8'));
            if (extraSources.sources && Array.isArray(extraSources.sources)) {
                console.log(`\n📥 Cargando fuentes adicionales desde scraper_sources.json...`);
                let added = 0;
                for (const source of extraSources.sources) {
                    if (source.enabled) {
                        const alreadyConfigured = PRODUCTS.some((p) => normalizeKey(p.jsonFile) === normalizeKey(source.outputFile));
                        if (alreadyConfigured) {
                            console.log(`   ℹ️  Fuente extra omitida por duplicado de outputFile: ${source.outputFile}`);
                            continue;
                        }
                        PRODUCTS.push({
                            url: source.url,
                            jsonFile: source.outputFile,
                            name: `[EXTRA] ${source.name}`,
                            samplePurchaseUrl: null
                        });
                        added++;
                    }
                }
                console.log(`   Se agregaron ${added} fuentes adicionales.`);
            }
        } catch (error) {
            console.error(`❌ Error leyendo scraper_sources.json: ${error.message}`);
        }
    }

    const onlyFilter = process.env.SCRAPE_ONLY
        ? process.env.SCRAPE_ONLY.split(',').map((x) => normalizeKey(x)).filter(Boolean)
        : [];

    const productsToProcess = onlyFilter.length > 0
        ? PRODUCTS.filter((p) => onlyFilter.includes(normalizeKey(p.jsonFile)) || onlyFilter.includes(normalizeKey(p.name)))
        : PRODUCTS;

    if (onlyFilter.length > 0) {
        console.log(`\n🎯 Filtro activo SCRAPE_ONLY. Productos a procesar: ${productsToProcess.length}`);
    }

    for (const product of productsToProcess) {
        console.log(`\n${'─'.repeat(40)}`);
        console.log(`🔍 Procesando: ${product.name}`);

        // 1. Scrapear página principal del producto
        const productData = await scrapeProductPage(product.url);

        // 2. Extraer ciclos de facturación reales de los enlaces "Pedir Ahora" de cada plan
        if (productData && productData.plans.length > 0) {
            for (const plan of productData.plans) {
                if (plan.url_pedido && (plan.url_pedido.includes('/store/') || plan.url_pedido.includes('/cart.php'))) {
                    const purchaseData = await scrapePurchasePage(plan.url_pedido, plan.nombre);
                    if (purchaseData && purchaseData.billingCycles && purchaseData.billingCycles.length > 0) {
                        plan.ciclos_facturacion_extraidos = purchaseData.billingCycles;
                    }
                }
                // Esperar un poco entre requests para evitar saturar el servidor
                await new Promise(r => setTimeout(r, 500));
            }

            // 3. Actualizar JSON si tenemos datos
            updateProductJSON(product, productData);
        } else {
            console.log(`   ⚠️  No se encontraron planes en la página principal.`);
            console.log(`   ℹ️  (Puede ser un SPA o los precios fueron establecidos manualmente en el JSON).`);
            updateProductJSON(product, productData || { plans: [] });
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
