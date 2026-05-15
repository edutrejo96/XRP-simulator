const labelDataMode = () => (books?.mode||'').includes('live') ? 'Live' : 'Datos base locales';
const labelQuality = q => String(q||'')
  .replace(/fetch failed:.*/gi, t('sourceUnavailable'))
  .replace(/exchange init failed:.*/gi, t('sourceUnavailable'))
  .replace(/disabled:.*/gi, t('sourceUnavailable'))
  .replace(/etf_live_quote/gi,'ETF live quote')
  .replace(/etf_quote_unavailable/gi,'ETF quote unavailable')
  .replace(/fallback|datos base locales|base snapshot/gi,'base local')
  .replace(/_/g,' ');
const labelVenue = v => String(v||'').replace(/ fallback/gi,' base local').replace(/fallback/gi,'base local');
const isNum = n => typeof n === 'number' && Number.isFinite(n);
const fmtUsd = (n, digits=2) => {
  if (!isNum(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return '$' + (n/1e12).toFixed(digits) + 'T';
  if (abs >= 1e9) return '$' + (n/1e9).toFixed(digits) + 'B';
  if (abs >= 1e6) return '$' + (n/1e6).toFixed(digits) + 'M';
  return '$' + n.toLocaleString(undefined,{maximumFractionDigits:digits});
};
const fmtMarketCell = (n, digits=1) => isNum(n) && n > 0 ? fmtUsd(n, digits) : '<span style="color:#7a9abf">—</span>';
const fmtVolumeCell = b => {
  const n = b?.daily_volume_usd;
  if (isNum(n) && n > 0) return fmtUsd(n,1);
  const st = String(b?.volume_status||'');
  if (st.includes('requires_trade_indexer')) return '<span style="color:#7a9abf">requiere indexador</span>';
  if (st.includes('unavailable') || st.includes('failed')) return '<span style="color:#7a9abf">no expuesto API</span>';
  return '<span style="color:#7a9abf">—</span>';
};
const pct = (n, d=1) => (Number.isFinite(n) ? n.toFixed(d) + '%' : '—');
const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));

const DEPTH_LEVELS_PCT = [0.1, 0.25, 0.5, 1, 2, 5];
const depthPctLabel = pct => `±${pct}%`;
const selectedDepthPct = () => DEPTH_LEVELS_PCT[state.depthIdx] ?? 1;
const depthCurveKey = pct => String(pct).replace(/\.0$/,'');
function getDepthAtPct(b, pct=selectedDepthPct()){
  if (!b) return 0;
  const curve = b.depth_curve_usd || {};
  const k = depthCurveKey(pct);
  if (isNum(curve[k])) return curve[k];
  const d1 = isNum(b.depth_1pct_usd) ? b.depth_1pct_usd : 0;
  const d2 = isNum(b.depth_2pct_usd) ? b.depth_2pct_usd : 0;
  if (pct <= 1) return d1 * Math.max(pct, 0);
  if (pct <= 2) return d1 + (d2 - d1) * ((pct - 1) / 1);
  return d2 * Math.pow(pct / 2, 0.75);
}
function isDisplayAggregateRow(b){
  return String(b?.quality||'') === 'live_aggregate' || !!b?.is_aggregate;
}

// ── ETF / ETP PRODUCT REGISTRY ───────────────────────────────────────────────
// Proportional shares of total ETF holdings (must sum to 1.0).
// Actual held amounts scale with the xrp_spot_etfs item activation & confidence.
const ETF_PRODUCTS = [
  {name:'Canary Capital XRP ETF',      ticker:'XRPC',   market:'USA',    share:0.24, confirmed:true, kind:'spot_etf'},
  {name:'Bitwise XRP ETF',             ticker:'XRP',    market:'USA',    share:0.18, confirmed:true, kind:'spot_etf'},
  {name:'Grayscale XRP Trust ETF',     ticker:'GXRP',   market:'USA',    share:0.16, confirmed:true, kind:'spot_etf'},
  {name:'Franklin Templeton XRP ETF',  ticker:'XRPZ',   market:'USA',    share:0.14, confirmed:true, kind:'spot_etf'},
  {name:'21Shares XRP ETF',            ticker:'TOXR',   market:'USA',    share:0.12, confirmed:true, kind:'spot_etf'},
  {name:'REX-Osprey XRP ETF',          ticker:'XRPR',   market:'USA',    share:0.06, confirmed:true, kind:'spot_etf'},
  {name:'Evolve XRP ETF',              ticker:'XRP.TO', market:'Canadá', share:0.06, confirmed:true, kind:'spot_etf'},
  {name:'21Shares XRP ETP',            ticker:'AXRP.SW', market:'Europa', share:0.04, confirmed:true, kind:'etp'},
];
const ETF_TOTAL_XRP_B = 100;   // total XRP issued (B)
const ETF_ESCROW_B    = 45.2;  // Ripple escrow (B)

let registry, books, items = [], scenariosV86 = null;
let customCounter = 0;
const state = {
  floatB: 1.25,
  rotation: 58,
  privateFactor: 1,
  premium: 18,
  orderM: 100,
  depthIdx: Number(localStorage.getItem('rit_depth_idx') ?? 3),
  filter: 'all',
  search: '',
  cinematicModule: 'narrative',
  lang: localStorage.getItem('rit_lang') || 'es'
};
let currentResult = null;
let liveRefreshTimer = null;
const LIVE_SNAPSHOT_REFRESH_MS = 60000;
const snapshotSignature = d => [d?.version||'', d?.mode||'', d?.generated_at||'', (d?.books||[]).length].join('|');
const snapshotTimeLabel = d => {
  if (!d?.generated_at) return '—';
  try { return new Date(d.generated_at).toLocaleString(state.lang, {dateStyle:'short', timeStyle:'medium'}); }
  catch { return d.generated_at; }
};
const explainers = {
  float:{title:'Float vendedor disponible',text:'Piensa en esto como la cantidad de XRP que está realmente suelta para venderse. Si hay mucho XRP disponible, el precio necesita menos tensión para moverse. Si hay poco XRP disponible, cada dólar empuja más.'},
  rotation:{title:'Rotación',text:'Es cuántas veces se reutiliza el mismo XRP en un año. Si gira muy rápido, hace falta menos precio para mover el mismo dinero. Si se queda retenido más tiempo, el precio funcional suele subir.'},
  privateFactor:{title:'Liquidez privada',text:'Esto simula cuánto refuerzan la profundidad actores grandes, mesas OTC o infraestructura privada. Más a la derecha significa libros más profundos y menos golpe de precio.'},
  premium:{title:'Prima de mercado',text:'Es la parte emocional o narrativa. El mercado a veces paga más de lo que justifica la utilidad pura porque espera más adopción futura.'},
  orderM:{title:'Orden de estrés',text:'Es el tamaño de la orden que usas para probar el slippage. Una orden más grande choca más con el libro y mueve más el precio.'},
  adoption:{title:'Adopción',text:'Aquí eliges cuánto de ese corredor o capa usa realmente la infraestructura. 0% es casi apagado; 100% es uso total dentro de ese bloque.'}
};

const I18N = {
  es: {
    langName:'Español', navPresentation:'Presentación', navInfra:'Infraestructura', navCalc:'Cálculo', navCinema:'Escenario final', navDonate:'Apoyar',
    audioPlaylist:'Playlist cinematográfica', pause:'Pausar', play:'Reproducir', previous:'Anterior', next:'Siguiente', close:'Cerrar', understood:'Entendido',
    beforeEnter:'Antes de entrar', introTitle:'Esto no predice el futuro. Te enseña qué tendría que pasar para que XRP cambiara de escala.',
    introText:'El simulador une tres cosas: la infraestructura real de Ripple/XRPL, los corredores conectados o en pilotos, y los libros de órdenes que miden liquidez real.',
    intro1Title:'1 · Infraestructura', intro1Text:'Payments, RLUSD, Prime/Hidden Road, Treasury, Custody, Rail, Brasil, México, APAC, Corea, EAU, RWA, ETF/ETP y pilotos.',
    intro2Title:'2 · Liquidez', intro2Text:'Orderbooks CEX, XRPL DEX, agregados live y proxies institucionales/ETF separados para no mezclar señal pública con OTC.',
    intro3Title:'3 · Resultado', intro3Text:'Calcula flujo XRP, RLUSD/XRPL, float efectivo, reducción por ETF, rotación, profundidad, slippage y precio funcional.',
    introFine:'La música intentará sonar desde el inicio. Algunos navegadores bloquean el audio automático: si ocurre, pulsa “Entrar con música”.', enterMusic:'Entrar con música', enterSilent:'Entrar sin música',
    explainLabel:'Explicación sencilla', explainTitleDefault:'¿Qué significa esto?', explainTextDefault:'Aquí verás una explicación en lenguaje muy simple.',
    crawlStep:'Paso 1 · Presentación', crawlIntro:'Introducción del proyecto', crawlToCalc:'Ir al cálculo', crawlFooter:'Esta parte te pone en contexto: qué simula la web, a qué infraestructura se conecta y qué piezas reales o en piloto se tienen en cuenta.',
    movieMode:'Modo película', scene:'Escena', cinemaCaption:'No es una promesa de precio. Es una simulación de condiciones: infraestructura, adopción, liquidez y libros de órdenes.',
    kicker:'No es una predicción. Es un mapa de condiciones.', heroTitle:'No calcules XRP como una acción. Simúlalo como infraestructura de liquidez.',
    heroLead:'Este gemelo digital integra corredores reales, productos Ripple, RLUSD, XRPL, Prime, Custody, Treasury, pilotos, adquisiciones y orderbooks para estimar cómo cambiarían flujo, float, rotación, profundidad y slippage según adopción elegida.',
    viewPresentation:'Ver presentación', goCalc:'Ir al cálculo', whatDoes:'¿Qué hace esta web?', metricInfra:'Infraestructura', metricCorridors:'Corredores', metricBooks:'Orderbooks', metricData:'Modo datos',
    step1:'Paso 1 · Presentación', presTitle:'Primero contexto. Luego cálculo. Y al final el escenario visual.', presText:'Primero entiendes el proyecto en lenguaje sencillo, después ajustas la simulación y por último abres el escenario visual basado en los números que tú has construido.',
    openPresentation:'Abrir presentación', skipCalc:'Saltar al cálculo', presStep1Title:'1 · Presentación', presStep1Text:'Qué es el proyecto, qué capa de Ripple/XRPL integra, qué empresas se contemplan y qué parte está confirmada o en piloto.', presStep2Title:'2 · Cálculo', presStep2Text:'Tocas adopción, float, rotación, liquidez y orderbooks. El resultado cambia en vivo.', presStep3Title:'3 · Escenario final', presStep3Text:'El escenario final usa tus datos: orderbooks, rangos temporales y resumen en lenguaje fácil.',
    thesisLabel:'La tesis', thesisTitle:'El precio no sale de un deseo. Sale de flujo, float, rotación y liquidez real.', thesisText:'Si XRP funciona solo como puente de alta rotación, el mismo token puede mover mucho volumen sin necesitar precios extremos. Si una parte de la infraestructura empieza a retener XRP como inventario, colateral o liquidez operativa, baja la rotación efectiva, baja el float vendedor y el equilibrio cambia de forma no lineal.', thesisNote:'La web separa impacto directo en XRP, impacto en RLUSD, impacto en XRPL e impacto indirecto sobre profundidad institucional.',
    differentLabel:'Lo que hace diferente esta versión', differentTitle:'La adopción no se inventa: se construye desde infraestructura real.',
    infraMap:'Mapa de infraestructura', infraTitle:'Infraestructura Ripple/XRPL integrada', infraText:'Activa, ajusta o añade mercados. Cada bloque tiene evidencia, región, corredores y dependencias con otras capas de Ripple: Prime, Custody, Treasury, RLUSD y stacks regionales.', allEvidence:'Toda evidencia', searchPlaceholder:'Buscar corredor, partner, moneda…',
    calcStep:'Paso 2 · Cálculo', globalParams:'Parámetros globales', floatSeller:'Float vendedor disponible', rotationBase:'Rotación base anual', privateLiquidity:'Factor de liquidez privada por adopción', marketPremium:'Prima de mercado/narrativa', stressOrder:'Orden de estrés para slippage', reset:'Reset', openFinalCinema:'Abrir escenario final', calcFine:'Los valores se recalculan en tiempo real. En el slider de float, la derecha significa menos XRP vendedor disponible y por eso suele subir el precio funcional.',
    liveResult:'Resultado actual del escenario', functionalPrice:'Precio funcional', marketSimPrice:'Precio mercado simulado', directFlowYear:'Volumen directo XRP/año', rlusdFlowYear:'Volumen RLUSD influido/año', xrplFlowYear:'Volumen XRPL influido/año', dynamicDepth:'Depth ±1% dinámico', stressSlippage:'Slippage orden estrés', execPriceLabel:'Precio ejecución (orden estrés)', estimatedTier:'Tier estimado',
    orderbooksLabel:'Orderbooks', orderbooksTitle:'Libros usados para profundidad y slippage', orderbooksText:'La adopción aumenta profundidad modelada, pero la base viene de los datos live o de datos base locales. No se fija un precio objetivo manual.', copyScenario:'Copiar mi escenario', booksLive:'Estás viendo libros live. El slippage nace de estos libros y luego se ajusta por adopción.', booksBase:'Estás viendo datos base locales de liquidez. Sirven para que el simulador arranque sin quedarse vacío. Cuando ejecutes el actualizador live, se sustituyen por libros reales.',
    pair:'Par', source:'Fuente', dailyVol:'Vol/día', quality:'Calidad', baseData:'Datos base locales', live:'Live',
    simpleSummary:'Proyección narrativa', pythonSimple:'Escenario 2026 → 2035 explicado fácil', priceTime:'Precio en el tiempo', path2035:'Camino 2026 → 2035', pathFine:'No es una predicción exacta. Es una visualización condicional de cómo podría evolucionar el equilibrio si se mantiene el escenario construido.',
    finalCinemaStep:'Paso 3 · Escenario final', finalCinemaTitle:'Convierte tu simulación en una narrativa visual.', finalCinemaText:'Esta parte usa los números, la adopción y los orderbooks que acabas de calcular. Elige el módulo y abre el escenario final.', backCalc:'Volver al cálculo', openCinema:'Abrir escenario', moduleNarrative:'Infraestructura', moduleOrderbooks:'Orderbooks', moduleTimeline:'Precio 2026 → 2035', moduleSummary:'Resumen sencillo', cinemaTip:'Consejo: primero ajusta el escenario. Después abre esta parte para compartir una lectura más limpia y coherente.',
    addMissing:'Añadir lo que falte', customMarket:'Mercado/corredor personalizado', customText:'Añade un corredor que no esté en la base. El simulador lo integra al instante con etiqueta “usuario”.', addModel:'Añadir al modelo',
    donateLabel:'Apoyar el proyecto', donateTitle:'XRP Simulator es gratuito. Apoyo voluntario.', donateText:'Si esta herramienta te aporta valor, puedes apoyar su mantenimiento. La donación ayuda a sostener datos live, APIs y desarrollo. No es pago por asesoramiento ni promesa de rentabilidad.', copy:'Copiar',
    rowConnects:'Conecta con:', autonomous:'Base autónoma', activate:'Activar', adoption:'Adopción', explanation:'Explicación',
    chartTitle:'Flujo directo XRP por capa de infraestructura', reading:'Lectura', resultReading:'el motor ya no trata cada corredor como una isla. Usa {active} piezas activas, enlaza {coupled} de ellas con módulos de infraestructura (RLUSD, Prime, Custody, Treasury, stacks regionales), cruza sus corredores con {books} libros y recalcula la profundidad con un multiplicador de red de <b>{boost}x</b>. El precio funcional sigue saliendo solo del flujo directo que toca XRP, pero la liquidez y la rotación se ajustan por la infraestructura conectada. Rotación efectiva: <b>{rotation}x</b>.',
    timelineNote2026:'Lo que hoy sugiere tu escenario construido.', timelineNote2029:'Más corredores activos, más profundidad y más retención institucional.', timelineNote2035:'Escala larga: la infraestructura madura y el slippage debería caer si el escenario se cumple.', simpleReading:'Lectura rápida: con {active} piezas activas, un depth dinámico de {depth} y slippage de {slip}, tu escenario hoy se parece a un {tier}. La base de orderbooks actual es {mode}.',
    expFloatTitle:'Float vendedor disponible', expFloatText:'Piensa en esto como la cantidad de XRP que está realmente suelta para venderse. Si hay mucho XRP disponible, el precio necesita menos tensión para moverse. Si hay poco XRP disponible, cada dólar empuja más.', expRotationTitle:'Rotación', expRotationText:'Es cuántas veces se reutiliza el mismo XRP en un año. Si gira muy rápido, hace falta menos precio para mover el mismo dinero. Si se queda retenido más tiempo, el precio funcional suele subir.', expPrivateTitle:'Liquidez privada', expPrivateText:'Esto simula cuánto refuerzan la profundidad actores grandes, mesas OTC o infraestructura privada. Más a la derecha significa libros más profundos y menos golpe de precio.', expPremiumTitle:'Prima de mercado', expPremiumText:'Es la parte emocional o narrativa. El mercado a veces paga más de lo que justifica la utilidad pura porque espera más adopción futura.', expOrderTitle:'Orden de estrés', expOrderText:'Es el tamaño de la orden que usas para probar el slippage. Una orden más grande choca más con el libro y mueve más el precio.', expAdoptionTitle:'Adopción', expAdoptionText:'Aquí eliges cuánto de ese corredor o capa usa realmente la infraestructura. 0% es casi apagado; 100% es uso total dentro de ese bloque.',
    crawlTitle:'Una simulación de adopción, liquidez y precio funcional para XRP', crawlP1:'Este proyecto no intenta adivinar el futuro con una cifra mágica. Intenta responder algo más útil: qué tendría que pasar en la infraestructura real para que XRP cambiara de escala.', crawlP2:'La web mezcla tres capas al mismo tiempo: infraestructura Ripple/XRPL, corredores y pilotos, y orderbooks. Así el resultado cambia cuando subes o bajas adopción.', crawlIntegrates:'Qué integra:', crawlTypes:'Qué tipo de piezas se contemplan:', crawlConfirmed:'Confirmado hoy:', crawlPilots:'En piloto o exploración:', crawlNone:'Ninguno activado en este momento', crawlP3:'Cuando mueves la adopción, el motor ajusta flujo directo que toca XRP, float vendedor efectivo, rotación, profundidad y slippage. Por eso el resultado no sale de fijar un precio a mano.', crawlP4:'Primero entiendes el mapa. Después calculas. Y al final ves un escenario visual basado en el escenario que tú mismo construiste.', crawlIdea:'Idea central:', crawlIdeaText:'XRP no se trata aquí como una acción ni como una fe ciega. Se trata como una pieza de liquidez dentro de una red más grande.',
    disclaimerTitle:'Antes de continuar · simulación educativa', disclaimerText:'Este simulador combina infraestructura Ripple/XRPL, mercados públicos, profundidad de orderbooks, ETF/ETP, RLUSD, RWA y modelos de liquidez para construir escenarios condicionales. No es asesoramiento financiero, no predice precios y no garantiza rentabilidad. Cada cifra es una salida del modelo según los parámetros elegidos, no una promesa ni una recomendación de inversión.', disclaimerCheck:'Entiendo que este simulador es educativo y no constituye asesoramiento financiero ni predicción de precios.', disclaimerAccept:'Acepto — Entrar', disclaimerDecline:'Salir sin entrar',
    etfLabel:'Acumulador ETF', etfTitle:'ETFs Spot XRP / ETP Institucional', etfText:'Los ETF/ETP de XRP dan exposición institucional y pueden retirar XRP del float vendedor. El panel separa XRP retenido, AUM estimado y volumen secundario ETF para no tratar la acción del ETF como si fuera un orderbook spot de XRP.', etfHoldings:'XRP en ETFs estimado', etfFloatRed:'Reducción de float', etfAum:'AUM estimado ETF', etfNote:'El ETF como infraestructura reduce el float disponible para el mercado. Actívalo en el mapa de infraestructura para ver el efecto en el precio funcional.'
  },
  en: {
    langName:'English', navPresentation:'Presentation', navInfra:'Infrastructure', navCalc:'Calculation', navCinema:'Final scenario', navDonate:'Support', audioPlaylist:'Cinematic playlist', pause:'Pause', play:'Play', previous:'Previous', next:'Next', close:'Close', understood:'Got it', beforeEnter:'Before entering', introTitle:'This does not predict the future. It shows what would need to happen for XRP to scale.', introText:'The simulator combines three things: real Ripple/XRPL infrastructure, connected or pilot corridors, and order books that measure real liquidity.', intro1Title:'1 · Infrastructure', intro1Text:'Payments, RLUSD, Ripple Prime, Treasury, Custody, Rail, Brazil, Mexico, APAC, Korea, tokenization and pilots.', intro2Title:'2 · Liquidity', intro2Text:'CEX and XRPL DEX order books. If adoption rises, the model increases depth and changes slippage dynamically.', intro3Title:'3 · Result', intro3Text:'It calculates direct XRP flow, RLUSD/XRPL flow, effective float, rotation, depth, slippage and functional price.', introFine:'Music will try to start immediately. Some browsers block autoplay: if that happens, press “Enter with music”.', enterMusic:'Enter with music', enterSilent:'Enter without music', explainLabel:'Simple explanation', explainTitleDefault:'What does this mean?', explainTextDefault:'Here you will see a very simple explanation.', crawlStep:'Step 1 · Presentation', crawlIntro:'Project introduction', crawlToCalc:'Go to calculation', crawlFooter:'This section gives context: what the web simulates, what infrastructure it connects to, and which real or pilot pieces are included.', movieMode:'Movie mode', scene:'Scene', cinemaCaption:'Not a price promise. It is a simulation of conditions: infrastructure, adoption, liquidity and order books.', kicker:'Not a prediction. A map of conditions.', heroTitle:'Do not value XRP like a stock. Simulate it as liquidity infrastructure.', heroLead:'This digital twin integrates real corridors, Ripple products, RLUSD, XRPL, Prime, Custody, Treasury, pilots, acquisitions and order books to estimate how flow, float, rotation, depth and slippage change with adoption.', viewPresentation:'View presentation', goCalc:'Go to calculation', whatDoes:'What does this web do?', metricInfra:'Infrastructure', metricCorridors:'Corridors', metricBooks:'Order books', metricData:'Data mode', step1:'Step 1 · Presentation', presTitle:'First context. Then calculation. Then the cinematic.', presText:'The flow is now clearer: first you understand the project in simple language, then you adjust the simulation, and finally you open the cinematic based on your scenario.', openPresentation:'Open presentation', skipCalc:'Skip to calculation', presStep1Title:'1 · Presentation', presStep1Text:'What the project is, which Ripple/XRPL layers it includes, which companies are considered, and what is confirmed or in pilot.', presStep2Title:'2 · Calculation', presStep2Text:'You adjust adoption, float, rotation, liquidity and order books. The result changes live.', presStep3Title:'3 · Cinematic', presStep3Text:'The final movie uses your calculated scenario: order books, yearly prices and a simple summary.', thesisLabel:'The thesis', thesisTitle:'Price does not come from a wish. It comes from flow, float, rotation and real liquidity.', thesisText:'If XRP works only as a high-rotation bridge, the same token can move large volume without extreme prices. If part of the infrastructure starts holding XRP as inventory, collateral or operating liquidity, effective rotation falls, sellable float falls, and equilibrium can change non-linearly.', thesisNote:'The web separates direct XRP impact, RLUSD impact, XRPL impact and indirect institutional-depth impact.', differentLabel:'What makes this version different', differentTitle:'Adoption is not invented: it is built from real infrastructure.', infraMap:'Infrastructure map', infraTitle:'Integrated Ripple/XRPL infrastructure', infraText:'Enable, adjust or add markets. Each block has evidence, region, corridors and dependencies with Ripple layers: Prime, Custody, Treasury, RLUSD and regional stacks.', allEvidence:'All evidence', searchPlaceholder:'Search corridor, partner, currency…', calcStep:'Step 2 · Calculation', globalParams:'Global parameters', floatSeller:'Available sellable float', rotationBase:'Base annual rotation', privateLiquidity:'Private-liquidity factor from adoption', marketPremium:'Market/narrative premium', stressOrder:'Stress order for slippage', reset:'Reset', openFinalCinema:'Open final cinematic', calcFine:'Values recalculate in real time. On the float slider, moving right means less available sellable XRP, which usually raises the functional price.', liveResult:'Live result', functionalPrice:'Functional price', marketSimPrice:'Simulated market price', directFlowYear:'Direct XRP volume/year', rlusdFlowYear:'Influenced RLUSD volume/year', xrplFlowYear:'Influenced XRPL volume/year', dynamicDepth:'Dynamic depth ±1%', stressSlippage:'Stress-order slippage', execPriceLabel:'Execution price (stress order)', estimatedTier:'Estimated tier', orderbooksLabel:'Order books', orderbooksTitle:'Books used for depth and slippage', orderbooksText:'Adoption increases modeled depth, but the base comes from live data or local base data. No manual target price is fixed.', copyScenario:'Copy my scenario', booksLive:'You are viewing live books. Slippage starts from these books and is adjusted by adoption.', booksBase:'You are viewing local base liquidity data. It lets the simulator start without being empty. When you run the live updater, it will be replaced by real books.', pair:'Pair', source:'Source', dailyVol:'Daily vol', quality:'Quality', baseData:'Local base data', live:'Live', simpleSummary:'Simple summary', pythonSimple:'The Python-style output, explained simply', priceTime:'Price over time', path2035:'Path 2026 → 2035', pathFine:'Not an exact prediction. It visualizes how equilibrium could evolve if your scenario persists.', finalCinemaStep:'Step 3 · Final cinematic', finalCinemaTitle:'Now turn your scenario into a video.', finalCinemaText:'This part uses the numbers and adoption you just calculated. Choose the module to show and open the final cinematic.', backCalc:'Back to calculation', openCinema:'Open cinematic', moduleNarrative:'Infrastructure', moduleOrderbooks:'Order books', moduleTimeline:'Price 2026 → 2035', moduleSummary:'Simple summary', cinemaTip:'Tip: first adjust the scenario. Then open this section to record the video with a cleaner story.', addMissing:'Add what is missing', customMarket:'Custom market/corridor', customText:'Add a corridor not in the base. The simulator integrates it instantly with a “user” label.', addModel:'Add to model', donateLabel:'Support the project', donateTitle:'Free simulator. Voluntary support.', donateText:'If this tool gives you value and you want to support development, you can donate. It is not payment for advice or a promise of returns.', copy:'Copy', rowConnects:'Connects with:', autonomous:'Autonomous base', activate:'Enable', adoption:'Adoption', explanation:'Explanation', chartTitle:'Direct XRP flow by infrastructure layer', reading:'Reading', resultReading:'the engine no longer treats each corridor as an island. It uses {active} active pieces, links {coupled} with infrastructure modules (RLUSD, Prime, Custody, Treasury, regional stacks), crosses their corridors with {books} books and recalculates depth with a network multiplier of <b>{boost}x</b>. Functional price still comes only from direct flow that touches XRP, while liquidity and rotation adjust through connected infrastructure. Effective rotation: <b>{rotation}x</b>.', timelineNote2026:'What your current scenario suggests today.', timelineNote2029:'More active corridors, more depth and more institutional retention.', timelineNote2035:'Long run: infrastructure matures and slippage should fall if the scenario plays out.', simpleReading:'Quick reading: with {active} active pieces, dynamic depth of {depth} and slippage of {slip}, your scenario currently resembles {tier}. The current order-book base is {mode}.', expFloatTitle:'Available sellable float', expFloatText:'Think of this as the amount of XRP truly loose and available to sell. More available XRP means less pressure on price. Less available XRP means each dollar pushes harder.', expRotationTitle:'Rotation', expRotationText:'How many times the same XRP is reused in a year. Faster rotation means less price is needed to move the same money. If it is held longer, functional price tends to rise.', expPrivateTitle:'Private liquidity', expPrivateText:'This simulates how much large actors, OTC desks or private infrastructure reinforce depth. Further right means deeper books and less price impact.', expPremiumTitle:'Market premium', expPremiumText:'The emotional or narrative part. Markets sometimes pay above pure utility because they expect more future adoption.', expOrderTitle:'Stress order', expOrderText:'The order size used to test slippage. A bigger order hits the book harder and moves price more.', expAdoptionTitle:'Adoption', expAdoptionText:'How much of that corridor or layer actually uses the infrastructure. 0% is almost off; 100% is full usage within that block.', crawlTitle:'A simulation of adoption, liquidity and functional price for XRP', crawlP1:'This project does not try to guess the future with a magic number. It asks a more useful question: what would need to happen in real infrastructure for XRP to scale?', crawlP2:'The web mixes three layers at once: Ripple/XRPL infrastructure, corridors and pilots, and order books. The result changes when you move adoption up or down.', crawlIntegrates:'What it integrates:', crawlTypes:'Types of pieces considered:', crawlConfirmed:'Confirmed today:', crawlPilots:'In pilot or exploration:', crawlNone:'None active right now', crawlP3:'When you move adoption, the engine adjusts direct flow touching XRP, effective sellable float, rotation, depth and slippage. That is why the result is not a manually fixed price.', crawlP4:'First you understand the map. Then you calculate. Finally you see a cinematic based on the scenario you built.', crawlIdea:'Core idea:', crawlIdeaText:'XRP is not treated here like a stock or blind faith. It is treated as a liquidity component inside a larger network.',
    disclaimerTitle:'Before continuing — important notice', disclaimerText:'This simulator is an educational and interactive tool. It integrates real Ripple/XRPL infrastructure, orderbook data and liquidity models to estimate how XRP parameters would change with adoption. It is NOT financial advice, does NOT predict prices and does NOT guarantee any returns. Any figure you see is the result of a conditional mathematical model, not a promise or investment recommendation.', disclaimerCheck:'I understand this simulator is educational and does not constitute financial advice or a price prediction.', disclaimerAccept:'Accept — Enter', disclaimerDecline:'Exit without entering',
    etfLabel:'ETF Accumulator', etfTitle:'XRP Spot ETFs / Institutional ETP', etfText:'Approved US XRP spot ETFs buy and hold XRP directly. This reduces the effective sellable float and pushes the functional price upward non-linearly.', etfHoldings:'Estimated XRP in ETFs', etfFloatRed:'Float reduction', etfAum:'ETF estimated AUM', etfNote:'ETF as infrastructure reduces the float available to the market. Enable it in the infrastructure map to see the effect on the functional price.'
  },
  ja: {
    langName:'日本語', navPresentation:'プレゼン', navInfra:'インフラ', navCalc:'計算', navCinema:'シネマ', navDonate:'支援', audioPlaylist:'シネマ用プレイリスト', pause:'停止', play:'再生', previous:'前へ', next:'次へ', close:'閉じる', understood:'わかりました', beforeEnter:'入る前に', introTitle:'これは未来を予言するものではありません。XRPがスケールするには何が必要かを見せるものです。', introText:'このシミュレーターは、Ripple/XRPLの実インフラ、接続済みまたはパイロット中の回廊、そして実際の流動性を測るオーダーブックを組み合わせます。', intro1Title:'1 · インフラ', intro1Text:'Payments、RLUSD、Ripple Prime、Treasury、Custody、Rail、ブラジル、メキシコ、APAC、韓国、トークン化、パイロット。', intro2Title:'2 · 流動性', intro2Text:'CEXとXRPL DEXのオーダーブック。採用が増えると、モデルは板の厚みとスリッページを動的に変えます。', intro3Title:'3 · 結果', intro3Text:'XRPに直接触れるフロー、RLUSD/XRPLフロー、有効フロート、回転率、板の厚み、スリッページ、機能価格を計算します。', introFine:'音楽は最初から再生を試みます。ブラウザが自動再生を止める場合は「音楽ありで入る」を押してください。', enterMusic:'音楽ありで入る', enterSilent:'音楽なしで入る', explainLabel:'かんたんな説明', explainTitleDefault:'これは何を意味しますか？', explainTextDefault:'ここに、とても簡単な説明が表示されます。', crawlStep:'ステップ1 · プレゼン', crawlIntro:'プロジェクト紹介', crawlToCalc:'計算へ', crawlFooter:'ここでは、何をシミュレーションし、どのインフラに接続し、どの実案件・パイロットを考慮しているかを説明します。', movieMode:'ムービーモード', scene:'シーン', cinemaCaption:'価格の約束ではありません。インフラ、採用、流動性、オーダーブックという条件のシミュレーションです。', kicker:'予測ではなく、条件の地図です。', heroTitle:'XRPを株のように計算しない。流動性インフラとしてシミュレーションする。', heroLead:'このデジタルツインは、実際の回廊、Ripple製品、RLUSD、XRPL、Prime、Custody、Treasury、パイロット、買収、オーダーブックを統合し、採用に応じてフロー、フロート、回転率、板の厚み、スリッページがどう変わるかを推定します。', viewPresentation:'プレゼンを見る', goCalc:'計算へ', whatDoes:'このWebは何をする？', metricInfra:'インフラ', metricCorridors:'回廊', metricBooks:'オーダーブック', metricData:'データモード', step1:'ステップ1 · プレゼン', presTitle:'まず背景。次に計算。最後にシネマ。', presText:'まずプロジェクトをやさしく理解し、次にシミュレーションを調整し、最後に自分のシナリオに基づくシネマを開きます。', openPresentation:'プレゼンを開く', skipCalc:'計算へ進む', presStep1Title:'1 · プレゼン', presStep1Text:'プロジェクトの内容、含まれるRipple/XRPLレイヤー、企業、確認済みかパイロットかを説明します。', presStep2Title:'2 · 計算', presStep2Text:'採用率、フロート、回転率、流動性、オーダーブックを調整します。結果はリアルタイムに変わります。', presStep3Title:'3 · シネマ', presStep3Text:'最終ムービーは、あなたの計算済みシナリオ、オーダーブック、年別価格、簡単な要約を使います。', thesisLabel:'テーゼ', thesisTitle:'価格は願望ではなく、フロー、フロート、回転率、実際の流動性から生まれます。', thesisText:'XRPが高回転のブリッジとしてだけ使われるなら、大きな量を動かしても極端な価格は必要ありません。一部のインフラがXRPを在庫、担保、運用流動性として保持し始めると、有効回転率と売却可能フロートが下がり、均衡は非線形に変わります。', thesisNote:'このWebは、XRPへの直接影響、RLUSDへの影響、XRPLへの影響、機関投資家レベルの板厚への間接影響を分けます。', differentLabel:'この版の違い', differentTitle:'採用は想像ではなく、実インフラから組み立てます。', infraMap:'インフラマップ', infraTitle:'統合されたRipple/XRPLインフラ', infraText:'市場を有効化、調整、追加できます。各ブロックには証拠、地域、回廊、Prime、Custody、Treasury、RLUSD、地域スタックとの依存関係があります。', allEvidence:'すべての証拠', searchPlaceholder:'回廊、パートナー、通貨を検索…', calcStep:'ステップ2 · 計算', globalParams:'全体パラメータ', floatSeller:'売却可能フロート', rotationBase:'年間基本回転率', privateLiquidity:'採用によるプライベート流動性係数', marketPremium:'市場/ナラティブ・プレミアム', stressOrder:'スリッページ用ストレス注文', reset:'リセット', openFinalCinema:'最終シネマを開く', calcFine:'値はリアルタイムに再計算されます。フロートのスライダーは、右に行くほど売却可能XRPが少なくなり、機能価格が上がりやすくなります。', liveResult:'ライブ結果', functionalPrice:'機能価格', marketSimPrice:'市場シミュレーション価格', directFlowYear:'直接XRPフロー/年', rlusdFlowYear:'影響を受けるRLUSDフロー/年', xrplFlowYear:'影響を受けるXRPLフロー/年', dynamicDepth:'動的Depth ±1%', stressSlippage:'ストレス注文スリッページ', execPriceLabel:'実行価格（ストレス注文）', estimatedTier:'推定ティア', orderbooksLabel:'オーダーブック', orderbooksTitle:'Depthとスリッページに使う板', orderbooksText:'採用はモデル上の板厚を増やしますが、ベースはライブデータまたはローカル基礎データです。手動の目標価格は設定しません。', copyScenario:'シナリオをコピー', booksLive:'ライブの板を表示中です。スリッページはこの板を基にし、採用で調整されます。', booksBase:'ローカル基礎流動性データを表示中です。シミュレーターが空にならないための初期データです。ライブ更新を実行すると実際の板に置き換わります。', pair:'ペア', source:'ソース', dailyVol:'日次出来高', quality:'品質', baseData:'ローカル基礎データ', live:'ライブ', simpleSummary:'簡単な要約', pythonSimple:'Python風の出力をやさしく説明', priceTime:'時間軸の価格', path2035:'2026 → 2035 の道筋', pathFine:'正確な予測ではありません。あなたのシナリオが続いた場合の均衡の変化を可視化します。', finalCinemaStep:'ステップ3 · 最終シネマ', finalCinemaTitle:'あなたのシナリオを動画に変える。', finalCinemaText:'この部分は、計算した数値と採用率を使います。見せたいモジュールを選び、最終シネマを開いてください。', backCalc:'計算に戻る', openCinema:'シネマを開く', moduleNarrative:'インフラ', moduleOrderbooks:'オーダーブック', moduleTimeline:'価格 2026 → 2035', moduleSummary:'簡単な要約', cinemaTip:'先にシナリオを調整し、その後この部分を開くと、よりきれいな流れで録画できます。', addMissing:'不足しているものを追加', customMarket:'カスタム市場/回廊', customText:'ベースにない回廊を追加します。シミュレーターは「ユーザー」ラベルで即座に統合します。', addModel:'モデルに追加', donateLabel:'プロジェクト支援', donateTitle:'無料シミュレーター。任意支援。', donateText:'このツールに価値を感じ、開発を支援したい場合は寄付できます。助言料でも利益保証でもありません。', copy:'コピー', rowConnects:'接続先:', autonomous:'自律ベース', activate:'有効化', adoption:'採用率', explanation:'説明', chartTitle:'インフラ層別の直接XRPフロー', reading:'読み取り', resultReading:'エンジンは各回廊を孤立したものとして扱いません。{active}個の有効な要素を使い、そのうち{coupled}個をインフラモジュール（RLUSD、Prime、Custody、Treasury、地域スタック）に接続し、{books}個の板と照合し、ネットワーク倍率 <b>{boost}x</b> で板厚を再計算します。機能価格はXRPに直接触れるフローから出ますが、流動性と回転率は接続されたインフラで調整されます。有効回転率: <b>{rotation}x</b>。', timelineNote2026:'現在のシナリオが今日示している姿。', timelineNote2029:'より多くの回廊、板厚、機関投資家の保持。', timelineNote2035:'長期ではインフラが成熟し、シナリオが成立すればスリッページは下がるはずです。', simpleReading:'簡単な読み取り: {active}個の有効要素、動的Depth {depth}、スリッページ {slip} では、現在のシナリオは {tier} に近いです。現在の板ベースは {mode} です。', expFloatTitle:'売却可能フロート', expFloatText:'実際に売りに出やすいXRPの量です。多いほど価格への圧力は弱く、少ないほど同じ資金でも価格を押し上げやすくなります。', expRotationTitle:'回転率', expRotationText:'同じXRPが1年に何回使い回されるかです。速く回るほど同じ資金を少ない価格で動かせます。長く保持されるほど機能価格は上がりやすくなります。', expPrivateTitle:'プライベート流動性', expPrivateText:'大口、OTCデスク、プライベートインフラが板厚をどれだけ強化するかを表します。右に行くほど板が厚くなり、価格への衝撃が下がります。', expPremiumTitle:'市場プレミアム', expPremiumText:'感情やナラティブの部分です。市場は将来の採用を期待して、純粋な実用価値より高く払うことがあります。', expOrderTitle:'ストレス注文', expOrderText:'スリッページを試す注文サイズです。大きい注文ほど板に強くぶつかり、価格を動かします。', expAdoptionTitle:'採用率', expAdoptionText:'その回廊やレイヤーが実際にインフラをどれだけ使うかです。0%はほぼオフ、100%はそのブロック内で最大利用です。', crawlTitle:'XRPの採用、流動性、機能価格のシミュレーション', crawlP1:'このプロジェクトは魔法の数字で未来を当てるものではありません。XRPがスケールするには実インフラで何が必要かを問います。', crawlP2:'WebはRipple/XRPLインフラ、回廊とパイロット、オーダーブックの3層を同時に混ぜます。採用率を上下させると結果も変わります。', crawlIntegrates:'統合しているもの:', crawlTypes:'考慮する要素の種類:', crawlConfirmed:'今日確認済み:', crawlPilots:'パイロットまたは探索中:', crawlNone:'現在有効なものはありません', crawlP3:'採用率を動かすと、XRPに直接触れるフロー、有効売却フロート、回転率、板厚、スリッページが調整されます。だから結果は手動で固定した価格ではありません。', crawlP4:'最初に地図を理解し、次に計算し、最後に自分で作ったシナリオに基づくシネマを見ます。', crawlIdea:'中心アイデア:', crawlIdeaText:'XRPは株でも盲信でもなく、大きなネットワーク内の流動性部品として扱われます。',
    disclaimerTitle:'続ける前に — 重要なお知らせ', disclaimerText:'このシミュレーターは教育用のインタラクティブツールです。実際のRipple/XRPLインフラ、オーダーブックデータ、流動性モデルを統合して、採用に応じてXRPのパラメーターがどう変化するかを推定します。金融アドバイスではなく、価格予測でも、いかなる収益の保証でもありません。', disclaimerCheck:'このシミュレーターは教育目的であり、金融アドバイスや価格予測ではないことを理解しました。', disclaimerAccept:'同意して入る', disclaimerDecline:'入らずに終了',
    etfLabel:'ETFアキュムレーター', etfTitle:'XRPスポットETF / 機関投資家向けETP', etfText:'承認された米国XRPスポットETFはXRPを直接購入・保有します。これにより有効売却フロートが減少し、機能価格が非線形に上昇します。', etfHoldings:'ETF推定XRP保有量', etfFloatRed:'フロート減少', etfAum:'ETF推定AUM', etfNote:'インフラとしてのETFは市場向け利用可能フロートを削減します。インフラマップで有効化すると機能価格への効果が確認できます。'
  },
  ko: {
    langName:'한국어', navPresentation:'프레젠테이션', navInfra:'인프라', navCalc:'계산', navCinema:'최종 시나리오', navDonate:'후원', audioPlaylist:'시네마틱 플레이리스트', pause:'일시정지', play:'재생', previous:'이전', next:'다음', close:'닫기', understood:'알겠습니다', beforeEnter:'시작하기 전에', introTitle:'이것은 미래 예측이 아닙니다. XRP가 더 큰 규모로 가려면 무엇이 필요할지 보여줍니다.', introText:'시뮬레이터는 실제 Ripple/XRPL 인프라, 연결되었거나 파일럿 중인 회랑, 그리고 실제 유동성을 측정하는 오더북을 결합합니다.', intro1Title:'1 · 인프라', intro1Text:'Payments, RLUSD, Ripple Prime, Treasury, Custody, Rail, 브라질, 멕시코, APAC, 한국, 토큰화, 파일럿.', intro2Title:'2 · 유동성', intro2Text:'CEX와 XRPL DEX 오더북. 채택이 증가하면 모델은 깊이와 슬리피지를 동적으로 바꿉니다.', intro3Title:'3 · 결과', intro3Text:'직접 XRP 흐름, RLUSD/XRPL 흐름, 유효 플로트, 회전율, 깊이, 슬리피지, 기능 가격을 계산합니다.', introFine:'음악은 처음부터 재생을 시도합니다. 일부 브라우저는 자동 재생을 막습니다. 그 경우 “음악과 함께 시작”을 누르세요.', enterMusic:'음악과 함께 시작', enterSilent:'음악 없이 시작', explainLabel:'쉬운 설명', explainTitleDefault:'이게 무슨 뜻인가요?', explainTextDefault:'아주 쉬운 설명이 여기에 표시됩니다.', crawlStep:'1단계 · 프레젠테이션', crawlIntro:'프로젝트 소개', crawlToCalc:'계산으로 이동', crawlFooter:'이 부분은 웹이 무엇을 시뮬레이션하는지, 어떤 인프라에 연결되는지, 어떤 실제/파일럿 요소를 고려하는지 설명합니다.', movieMode:'영화 모드', scene:'장면', cinemaCaption:'가격 약속이 아닙니다. 인프라, 채택, 유동성, 오더북 조건의 시뮬레이션입니다.', kicker:'예측이 아니라 조건의 지도입니다.', heroTitle:'XRP를 주식처럼 계산하지 마세요. 유동성 인프라로 시뮬레이션하세요.', heroLead:'이 디지털 트윈은 실제 회랑, Ripple 제품, RLUSD, XRPL, Prime, Custody, Treasury, 파일럿, 인수, 오더북을 통합해 채택에 따라 흐름, 플로트, 회전율, 깊이, 슬리피지가 어떻게 바뀌는지 추정합니다.', viewPresentation:'프레젠테이션 보기', goCalc:'계산으로 이동', whatDoes:'이 웹은 무엇을 하나요?', metricInfra:'인프라', metricCorridors:'회랑', metricBooks:'오더북', metricData:'데이터 모드', step1:'1단계 · 프레젠테이션', presTitle:'먼저 맥락. 그다음 계산. 마지막으로 시네마틱.', presText:'흐름은 더 명확합니다. 먼저 쉬운 언어로 프로젝트를 이해하고, 시뮬레이션을 조정한 다음, 자신이 만든 시나리오 기반의 시네마틱을 엽니다.', openPresentation:'프레젠테이션 열기', skipCalc:'계산으로 건너뛰기', presStep1Title:'1 · 프레젠테이션', presStep1Text:'프로젝트가 무엇인지, 어떤 Ripple/XRPL 레이어를 포함하는지, 어떤 기업을 고려하는지, 무엇이 확인되었거나 파일럿인지 설명합니다.', presStep2Title:'2 · 계산', presStep2Text:'채택률, 플로트, 회전율, 유동성, 오더북을 조정합니다. 결과는 실시간으로 변합니다.', presStep3Title:'3 · 시네마틱', presStep3Text:'최종 영상은 계산된 시나리오, 오더북, 연도별 가격, 쉬운 요약을 사용합니다.', thesisLabel:'논지', thesisTitle:'가격은 소망에서 나오지 않습니다. 흐름, 플로트, 회전율, 실제 유동성에서 나옵니다.', thesisText:'XRP가 높은 회전율의 브리지로만 작동한다면 큰 거래량도 극단적인 가격 없이 이동할 수 있습니다. 인프라 일부가 XRP를 재고, 담보, 운영 유동성으로 보유하기 시작하면 유효 회전율과 매도 가능 플로트가 줄고 균형은 비선형으로 바뀔 수 있습니다.', thesisNote:'웹은 XRP 직접 영향, RLUSD 영향, XRPL 영향, 기관 수준 깊이에 대한 간접 영향을 분리합니다.', differentLabel:'이 버전의 차이점', differentTitle:'채택은 상상이 아니라 실제 인프라에서 구성됩니다.', infraMap:'인프라 지도', infraTitle:'통합된 Ripple/XRPL 인프라', infraText:'시장을 켜고 조정하거나 추가할 수 있습니다. 각 블록에는 증거, 지역, 회랑, Prime, Custody, Treasury, RLUSD, 지역 스택과의 의존성이 있습니다.', allEvidence:'모든 증거', searchPlaceholder:'회랑, 파트너, 통화 검색…', calcStep:'2단계 · 계산', globalParams:'전체 파라미터', floatSeller:'매도 가능 플로트', rotationBase:'연간 기본 회전율', privateLiquidity:'채택 기반 프라이빗 유동성 계수', marketPremium:'시장/내러티브 프리미엄', stressOrder:'슬리피지 스트레스 주문', reset:'초기화', openFinalCinema:'최종 시네마틱 열기', calcFine:'값은 실시간으로 다시 계산됩니다. 플로트 슬라이더는 오른쪽으로 갈수록 매도 가능 XRP가 줄어들어 기능 가격이 오르기 쉽습니다.', liveResult:'실시간 결과', functionalPrice:'기능 가격', marketSimPrice:'시뮬레이션 시장 가격', directFlowYear:'직접 XRP 거래량/년', rlusdFlowYear:'영향 받는 RLUSD 거래량/년', xrplFlowYear:'영향 받는 XRPL 거래량/년', dynamicDepth:'동적 Depth ±1%', stressSlippage:'스트레스 주문 슬리피지', execPriceLabel:'실행 가격 (스트레스 주문)', estimatedTier:'예상 티어', orderbooksLabel:'오더북', orderbooksTitle:'깊이와 슬리피지에 사용되는 장부', orderbooksText:'채택은 모델의 깊이를 증가시키지만, 기본값은 라이브 데이터 또는 로컬 기본 데이터에서 옵니다. 수동 목표 가격은 고정하지 않습니다.', copyScenario:'내 시나리오 복사', booksLive:'라이브 오더북을 보고 있습니다. 슬리피지는 이 장부에서 시작해 채택률로 조정됩니다.', booksBase:'로컬 기본 유동성 데이터를 보고 있습니다. 시뮬레이터가 비어 있지 않게 하는 초기 데이터입니다. 라이브 업데이트를 실행하면 실제 장부로 대체됩니다.', pair:'페어', source:'출처', dailyVol:'일 거래량', quality:'품질', baseData:'로컬 기본 데이터', live:'라이브', simpleSummary:'쉬운 요약', pythonSimple:'Python식 출력을 쉽게 설명', priceTime:'시간에 따른 가격', path2035:'2026 → 2035 경로', pathFine:'정확한 예측이 아닙니다. 당신의 시나리오가 유지될 때 균형이 어떻게 변할 수 있는지 시각화합니다.', finalCinemaStep:'3단계 · 최종 시네마틱', finalCinemaTitle:'이제 당신의 시나리오를 영상으로 바꾸세요.', finalCinemaText:'이 부분은 방금 계산한 수치와 채택률을 사용합니다. 보여줄 모듈을 선택하고 최종 시네마틱을 여세요.', backCalc:'계산으로 돌아가기', openCinema:'시네마틱 열기', moduleNarrative:'인프라', moduleOrderbooks:'오더북', moduleTimeline:'가격 2026 → 2035', moduleSummary:'쉬운 요약', cinemaTip:'먼저 시나리오를 조정하세요. 그다음 이 부분을 열면 더 깔끔한 흐름으로 영상을 녹화할 수 있습니다.', addMissing:'부족한 것 추가', customMarket:'사용자 시장/회랑', customText:'기본 목록에 없는 회랑을 추가합니다. 시뮬레이터는 즉시 “사용자” 라벨로 통합합니다.', addModel:'모델에 추가', donateLabel:'프로젝트 후원', donateTitle:'무료 시뮬레이터. 자발적 후원.', donateText:'이 도구가 가치 있다고 느끼고 개발을 지원하고 싶다면 기부할 수 있습니다. 조언료나 수익 보장이 아닙니다.', copy:'복사', rowConnects:'연결됨:', autonomous:'독립 기본값', activate:'활성화', adoption:'채택률', explanation:'설명', chartTitle:'인프라 레이어별 직접 XRP 흐름', reading:'해석', resultReading:'엔진은 각 회랑을 섬처럼 따로 보지 않습니다. {active}개의 활성 요소를 사용하고, 그중 {coupled}개를 인프라 모듈(RLUSD, Prime, Custody, Treasury, 지역 스택)과 연결하며, {books}개의 오더북과 교차해 네트워크 배수 <b>{boost}x</b>로 깊이를 다시 계산합니다. 기능 가격은 여전히 XRP에 직접 닿는 흐름에서 나오지만, 유동성과 회전율은 연결된 인프라에 따라 조정됩니다. 유효 회전율: <b>{rotation}x</b>.', timelineNote2026:'현재 시나리오가 오늘 보여주는 모습.', timelineNote2029:'더 많은 활성 회랑, 더 깊은 유동성, 더 많은 기관 보유.', timelineNote2035:'장기적으로 인프라가 성숙하고 시나리오가 실현되면 슬리피지는 낮아질 수 있습니다.', simpleReading:'빠른 해석: {active}개의 활성 요소, 동적 깊이 {depth}, 슬리피지 {slip} 기준으로 현재 시나리오는 {tier}에 가깝습니다. 현재 오더북 기준은 {mode}입니다.', expFloatTitle:'매도 가능 플로트', expFloatText:'실제로 시장에 풀려 팔릴 수 있는 XRP의 양입니다. 많으면 가격 압력이 약하고, 적으면 같은 돈도 가격을 더 밀어 올립니다.', expRotationTitle:'회전율', expRotationText:'같은 XRP가 1년에 몇 번 재사용되는지입니다. 빠르게 돌수록 같은 돈을 더 낮은 가격으로 이동할 수 있습니다. 오래 보유되면 기능 가격이 오르기 쉽습니다.', expPrivateTitle:'프라이빗 유동성', expPrivateText:'대형 참여자, OTC 데스크, 프라이빗 인프라가 오더북 깊이를 얼마나 강화하는지입니다. 오른쪽으로 갈수록 장부가 깊어지고 가격 충격이 줄어듭니다.', expPremiumTitle:'시장 프리미엄', expPremiumText:'감정이나 내러티브의 부분입니다. 시장은 미래 채택을 기대해 순수 유틸리티보다 더 비싸게 지불할 수 있습니다.', expOrderTitle:'스트레스 주문', expOrderText:'슬리피지를 테스트하는 주문 크기입니다. 주문이 클수록 장부와 더 세게 충돌하고 가격을 더 움직입니다.', expAdoptionTitle:'채택률', expAdoptionText:'해당 회랑이나 레이어가 실제로 인프라를 얼마나 사용하는지입니다. 0%는 거의 꺼짐, 100%는 해당 블록 내 최대 사용입니다.', crawlTitle:'XRP의 채택, 유동성, 기능 가격 시뮬레이션', crawlP1:'이 프로젝트는 마법 같은 숫자로 미래를 맞히려는 것이 아닙니다. XRP가 스케일하려면 실제 인프라에서 무엇이 필요할지를 묻습니다.', crawlP2:'웹은 Ripple/XRPL 인프라, 회랑과 파일럿, 오더북이라는 세 레이어를 동시에 섞습니다. 채택률을 올리거나 내리면 결과도 변합니다.', crawlIntegrates:'통합 항목:', crawlTypes:'고려하는 요소 유형:', crawlConfirmed:'오늘 확인됨:', crawlPilots:'파일럿 또는 탐색 중:', crawlNone:'현재 활성화된 항목 없음', crawlP3:'채택률을 움직이면 엔진은 XRP에 직접 닿는 흐름, 유효 매도 플로트, 회전율, 깊이, 슬리피지를 조정합니다. 그래서 결과는 손으로 고정한 가격이 아닙니다.', crawlP4:'먼저 지도를 이해합니다. 그다음 계산합니다. 마지막으로 직접 만든 시나리오 기반 시네마틱을 봅니다.', crawlIdea:'핵심 아이디어:', crawlIdeaText:'여기서 XRP는 주식도 맹신도 아닙니다. 더 큰 네트워크 안의 유동성 구성 요소로 다룹니다.',
    disclaimerTitle:'계속하기 전에 — 중요한 공지', disclaimerText:'이 시뮬레이터는 교육용 인터랙티브 도구입니다. 실제 Ripple/XRPL 인프라, 오더북 데이터 및 유동성 모델을 통합하여 채택에 따라 XRP 파라미터가 어떻게 변화하는지 추정합니다. 금융 조언이 아니며, 가격을 예측하지 않고, 어떠한 수익도 보장하지 않습니다.', disclaimerCheck:'이 시뮬레이터가 교육 목적이며 금융 조언이나 가격 예측이 아님을 이해합니다.', disclaimerAccept:'동의하고 시작', disclaimerDecline:'시작하지 않고 종료',
    etfLabel:'ETF 누산기', etfTitle:'XRP 스팟 ETF / 기관 ETP', etfText:'승인된 미국 XRP 스팟 ETF는 XRP를 직접 구매하고 보유합니다. 이는 유효 매도 플로트를 줄이고 기능 가격을 비선형으로 상승시킵니다.', etfHoldings:'ETF 예상 XRP 보유량', etfFloatRed:'플로트 감소', etfAum:'ETF 예상 AUM', etfNote:'인프라로서의 ETF는 시장에서 이용 가능한 플로트를 줄입니다. 인프라 맵에서 활성화하면 기능 가격에 미치는 영향을 확인할 수 있습니다.'
  }
};
// Spanish summaries for infrastructure items (overrides English-only summary field)
const SUMMARY_I18N = {
  es: {
    bitso_mxn_latam: 'Bitso usa explícitamente Ripple Payments con RLUSD y XRP como activos de liquidación. No todo el volumen de pagos en LATAM toca XRP directamente.',
    brazil_full_stack: 'Brasil no es solo un par de divisas: Ripple tiene Payments, RLUSD, BBRL en XRPL, bancos, custodia y treasury integradas.',
    tranglo_apac_network: 'Tranglo opera en 70+ países y 5.500 socios de pago. El toque en XRP debe ser configurable porque los flujos pueden ser privados, stablecoin o fiat.',
    sbi_remit_jpy_thb: 'Corredor de remesas RippleNet confirmado. El contacto directo con XRP no se asume por defecto salvo que el usuario lo ajuste.',
    unicambio_eur_brl: 'Ripple anunció pagos instantáneos entre Portugal y Brasil a través de Unicâmbio, conectando Europa con el stack de Brasil.',
    ripple_prime_hidden_road: 'Gran superficie institucional. Bajo contacto directo con XRP pero alto impacto en profundidad privada, colateral RLUSD y menor rotación si XRP se convierte en inventario.',
    ripple_treasury_gtreasury: 'Superficie de treasury muy grande. Modelo conservador: $13T no es volumen XRP, pero una pequeña activación puede importar.',
    rail_stablecoin_payments: 'Rail es principalmente infraestructura RLUSD/stablecoin. El impacto en XRP es indirecto salvo que el enrutamiento use rutas de liquidez XRP.',
    rlusd_core: 'RLUSD puede aumentar la actividad en XRPL y la liquidez XRP/RLUSD, pero no todo el flujo RLUSD requiere XRP.',
    dbs_franklin_sgbenji: 'Señal fuerte de XRPL/RLUSD. El impacto directo en XRP depende del enrutamiento de liquidez y el uso de colateral.',
    mas_bloom_unloq: 'Piloto oficial útil para narrativa y valor de opción futuro, pero con bajo peso en producción actual.',
    korea_institutional_stack: 'Corea es principalmente custodia, tokenización y stablecoin hoy, con posible impacto futuro en liquidez XRP/RLUSD.',
    custody_global: 'La custodia suele afectar a la confianza y el inventario retenido antes de afectar directamente a la demanda spot de XRP.',
    modulr_uk_eu: 'Cliente confirmado de RippleNet/Payments, pero el uso directo de XRP no se asume por defecto.',
    moneymatch_myr_sme: 'Prueba sólida de uso de la red de pagos, pero el contacto directo con XRP es incierto.',
    flash_haiha_aus_global: 'Clientes confirmados de Ripple Payments en los rails de remesas de Australia y APAC.',
    philippines_php_historical: 'Corredor útil de mantener, marcado como histórico. Necesita validación en vivo en lugar de asumir flujo directo actual de XRP.',
    cbdc_stablecoin_pilots: 'Importante para narrativa y arquitectura, pero sin demanda XRP actual salvo que se use un puente o ruta de liquidez XRPL pública.',
    xrp_spot_etfs: 'Los ETF/ETP de XRP acumulan exposición spot y pueden reducir el float vendedor efectivo. El modelo separa tenencia directa, volumen secundario de ETF y liquidez real de XRP para no confundir acciones del ETF con orderbook spot.',
    lulu_uae_middle_east: 'Lulu Exchange usa Ripple Payments para pagos cross-border en EAU y Oriente Medio. Hub de remesas de alto volumen entre Asia del Sur y el Golfo.',
    rwa_xrpl_ecosystem: 'Tokenización de activos del mundo real en XRPL (Franklin Benji EE.UU., Archax UK, OpenEden, Zoniqx, HashNote). Los activos residen permanentemente en XRPL — alto efecto de retención, bajo flujo directo XRP pero fuerte dependencia del ledger.',
    dtcc_derivatives_collateral: 'Especulativo: Hidden Road (adquisición Ripple) podría llevar XRP o RLUSD como colateral elegible para derivados compensados en DTCC. Alto efecto de retención si se confirma — el colateral queda bloqueado. No anunciado, no en piloto.'
  },
  ja: {
    xrp_spot_etfs: '米国で承認されたXRPスポットETFはXRPを直接蓄積します。売り可能フロートを減少させ、継続的な機関投資家需要を生み出します。',
    lulu_uae_middle_east: 'Lulu ExchangeはRipple Paymentsを使用してUAEと中東のクロスボーダー決済を行っています。南アジアから湾岸地域への高ボリューム送金ハブです。',
    rwa_xrpl_ecosystem: 'XRPLでの現実資産のトークン化（Franklin Benji米国、Archax英国、OpenEden、Zoniqx、HashNote）。資産はXRPLに永続的に存在し、高い保有効果があります。',
    dtcc_derivatives_collateral: '投機的：Hidden Road（Ripple買収）がDTCC清算デリバティブの適格担保としてXRPまたはRLUSDを提供する可能性があります。確認済みではなく、パイロットでもありません。'
  },
  ko: {
    xrp_spot_etfs: '미국에서 승인된 XRP 스팟 ETF는 XRP를 직접 축적합니다. 매도 가능 플로트를 줄이고 지속적인 기관 수요를 창출합니다.',
    lulu_uae_middle_east: 'Lulu Exchange는 Ripple Payments를 사용해 UAE와 중동의 크로스보더 결제를 처리합니다. 남아시아에서 걸프 지역으로의 고용량 송금 허브입니다.',
    rwa_xrpl_ecosystem: 'XRPL에서의 실물 자산 토큰화(Franklin Benji 미국, Archax 영국, OpenEden, Zoniqx, HashNote). 자산이 XRPL에 영구적으로 존재하여 높은 유보 효과가 있습니다.',
    dtcc_derivatives_collateral: '투기적: Hidden Road(Ripple 인수)가 DTCC 청산 파생상품의 적격 담보로 XRP 또는 RLUSD를 제공할 수 있습니다. 발표되지 않았으며 파일럿도 아닙니다.'
  }
};

const I18N_EXTRA = {
  es: {
    introLang:'Idioma', disclaimerAccept:'Acepto — Entrar con música', disclaimerDecline:'Acepto — Entrar sin música',
    etfProducts:'Productos incluidos',
    etfMethodTitle:'De dónde salen estos datos',
    etfMethodText:'Precio y volumen diario de ETF/ETP vienen de la consulta live de mercado cuando está disponible. XRP retenido, AUM y reparto por producto son hipótesis del modelo según el escenario activo: no son holdings oficiales ni orderbook spot XRP.',
    etfDataLive:'Live: {live}/{total} productos con precio/volumen consultado. Actualizado: {updated}.',
    etfDataModel:'Modelo: el reparto por producto usa pesos internos de escenario; XRP retenido = adopción ETF × confianza × hipótesis de holdings. El AUM usa ese XRP retenido × precio funcional del escenario.',
    etfTableProduct:'Producto', etfTableTicker:'Ticker', etfTablePrice:'Precio ETF/ETP', etfTableVol:'Vol/día live', etfTableHeld:'XRP retenido (modelo)', etfTableAum:'AUM (modelo)', etfTableShare:'% cesta', etfTotal:'TOTAL',
    etfDisabled:'— (desactivado)', etfNoQuery:'sin consulta', etfEnableHint:'Activa el ETF de XRP en el mapa de infraestructura para ver el efecto de reducción de float en el precio funcional.',
    floatExplainNote:'¿Por qué el circulante (~54.7B) es tan diferente del float vendedor (slider)? El circulante es todo el XRP que existe fuera del escrow de Ripple. Pero la enorme mayoría está retenido a largo plazo: reservas de exchanges, wallets de ballenas, custodias institucionales, holdings de inversores no vendedores. El float vendedor (slider) representa solo la fracción que está activamente disponible para venderse en el mercado a corto plazo — la "presión vendedora real". Cuanto más baja esa fracción, más mueve el precio cada dólar de flujo de pagos.',
    etfMechTitle:'Cómo el ETF bloquea XRP del mercado — mecanismo real',
    etfMechStep1:'El Participante Autorizado (PA) compra XRP en el mercado spot con dinero de inversores',
    etfMechStep2:'Entrega ese XRP al custodio del ETF (p.ej. Coinbase Custody, BitGo)',
    etfMechStep3:'El XRP queda bloqueado en custodia — no puede venderse libremente en spot',
    etfMechStep4:'El PA recibe acciones ETF que cotizan en bolsa (NYSE / Nasdaq / Xetra)',
    etfMechNote:'El volumen de la tabla ("Vol/día live") es el trading de acciones ETF en bolsa — no es flujo spot de XRP. El XRP bloqueado en custodia no puede salir a vender al mercado: reduce el float vendedor efectivo. Resultado: el mismo flujo de pagos por infraestructura mueve el precio más arriba de forma no lineal, porque hay menos XRP disponible para absorber la demanda.',
    liveBooksSection:'📊 Libros live CEX + XRPL DEX', pendingLiveSection:'⏳ Pendiente live — se actualiza al ejecutar el actualizador', instLiquiditySection:'🏦 Liquidez institucional estimada (no libro público)', etfBooksSection:'📈 ETF/ETP — cotización/volumen live separado del spot XRP', noDataSection:'⚠ Fuentes temporalmente no disponibles', technicalDetails:'Ver detalle técnico', sourceUnavailable:'No disponible temporalmente',
    depth1:'Depth ±1%', depth2:'Depth ±2%', spread:'Spread', autoRefresh:'auto-refresh web', snapshotUpdated:'snapshot: {time}', booksLive:'Viendo libros live. CEX, XRPL DEX y ETF/ETP se refrescan cuando el actualizador Python escribe un nuevo snapshot; la web lo recarga sola.',
    aggregateBooksSection:'Σ Agregado live visual — no entra en cálculo', depthCursorLabel:'Cursor de profundidad', depthCursorHelp:'Elige qué banda real del libro se usa para profundidad y slippage. Más cerca del precio = más exigente.', depthSelected:'Depth {pct}', depthCursorNote:'cálculo usando {pct}',
  },
  en: {
    introLang:'Language', disclaimerAccept:'Accept — Enter with music', disclaimerDecline:'Accept — Enter without music',
    etfProducts:'Products included',
    etfMethodTitle:'Where these data come from',
    etfMethodText:'ETF/ETP daily price and volume come from live market queries when available. XRP held, AUM and product split are model assumptions from the active scenario: they are not official holdings and not XRP spot order books.',
    etfDataLive:'Live: {live}/{total} products with price/volume queried. Updated: {updated}.',
    etfDataModel:'Model: product split uses internal scenario weights; XRP held = ETF adoption × confidence × holdings hypothesis. AUM uses that held XRP × the scenario functional price.',
    etfTableProduct:'Product', etfTableTicker:'Ticker', etfTablePrice:'ETF/ETP price', etfTableVol:'Live daily vol', etfTableHeld:'XRP held (model)', etfTableAum:'AUM (model)', etfTableShare:'% basket', etfTotal:'TOTAL',
    etfDisabled:'— (disabled)', etfNoQuery:'not queried', etfEnableHint:'Enable XRP ETF in the infrastructure map to see the float reduction effect on functional price.',
    floatExplainNote:'Why is circulating supply (~54.7B) so different from the sellable float slider? Circulating supply is all XRP outside Ripple escrow. But the vast majority is held long-term: exchange reserves, whale wallets, institutional custody, long-term investor holdings. The float slider represents only the fraction actively available to sell in the short term — the "real selling pressure". The lower that fraction, the more each dollar of payment flow moves the price.',
    etfMechTitle:'How the ETF locks XRP out of the market — real mechanism',
    etfMechStep1:'The Authorized Participant (AP) buys XRP on the spot market with investor cash',
    etfMechStep2:'Delivers that XRP to the ETF custodian (e.g. Coinbase Custody, BitGo)',
    etfMechStep3:'XRP is locked in custody — it cannot be sold freely on the spot market',
    etfMechStep4:'The AP receives ETF shares that trade on a stock exchange (NYSE / Nasdaq / Xetra)',
    etfMechNote:'"Daily vol" in the table is ETF share trading on a stock exchange — it is NOT XRP spot flow. XRP locked in custody cannot return to the spot market to be sold: it reduces the effective sellable float. Result: the same payment infrastructure flow pushes the functional price higher non-linearly, because there is less XRP available to absorb demand.',
    liveBooksSection:'📊 Live CEX + XRPL DEX books', pendingLiveSection:'⏳ Pending live — updates when the updater runs', instLiquiditySection:'🏦 Estimated institutional liquidity (not public book)', etfBooksSection:'📈 ETF/ETP — live quote/volume separated from XRP spot', noDataSection:'⚠ Temporarily unavailable sources', technicalDetails:'View technical detail', sourceUnavailable:'Temporarily unavailable',
    depth1:'Depth ±1%', depth2:'Depth ±2%', spread:'Spread', autoRefresh:'web auto-refresh', snapshotUpdated:'snapshot: {time}', booksLive:'Viewing live books. CEX, XRPL DEX and ETF/ETP refresh when the Python updater writes a new snapshot; the web reloads it automatically.',
    aggregateBooksSection:'Σ Visual live aggregate — excluded from calculations', depthCursorLabel:'Depth cursor', depthCursorHelp:'Choose which real book band feeds depth and slippage. Closer to price = stricter.', depthSelected:'Depth {pct}', depthCursorNote:'calculation using {pct}',
  },
  ja: {
    introLang:'言語', disclaimerAccept:'同意 — 音楽ありで入る', disclaimerDecline:'同意 — 音楽なしで入る',
    etfProducts:'対象商品数',
    etfMethodTitle:'データの出どころ',
    etfMethodText:'ETF/ETPの日次価格と出来高は、利用可能な場合にライブ市場クエリから取得します。XRP保有量、AUM、商品別配分は有効シナリオのモデル仮説であり、公式保有量でもXRP現物オーダーブックでもありません。',
    etfDataLive:'ライブ: {total}商品のうち{live}商品で価格/出来高を照会。更新: {updated}。',
    etfDataModel:'モデル: 商品配分は内部シナリオ重みを使用。XRP保有量 = ETF採用率 × 信頼度 × 保有仮説。AUMはそのXRP保有量 × シナリオ機能価格です。',
    etfTableProduct:'商品', etfTableTicker:'ティッカー', etfTablePrice:'ETF/ETP価格', etfTableVol:'ライブ日次出来高', etfTableHeld:'XRP保有量（モデル）', etfTableAum:'AUM（モデル）', etfTableShare:'% バスケット', etfTotal:'合計',
    etfDisabled:'—（無効）', etfNoQuery:'未照会', etfEnableHint:'インフラマップでXRP ETFを有効にすると、フロート削減効果を確認できます。',
    floatExplainNote:'なぜ流通量（~54.7B）とフロートスライダー（1.25B）がこれほど違うのか？流通量はRippleエスクロー外に存在するすべてのXRPです。しかしその大半は長期保有：取引所準備金、クジラウォレット、機関投資家カストディ、長期投資家保有。フロートスライダーは短期的に実際に売却可能な部分のみを表します——「実際の売り圧力」です。この比率が低いほど、決済フローの1ドルが価格をより大きく動かします。',
    etfMechTitle:'ETFがXRPを市場からロックする仕組み',
    etfMechStep1:'認定参加者（AP）が投資家の資金でXRPを現物市場で購入',
    etfMechStep2:'そのXRPをETFカストディアン（例: Coinbase Custody）に納入',
    etfMechStep3:'XRPはカストディでロック — 現物市場で自由に売却不可',
    etfMechStep4:'APはETF株式を受け取り、証券取引所（NYSE/Nasdaq/Xetra）で売買',
    etfMechNote:'表の「日次出来高」はETF株式の証券取引所での売買です — XRP現物フローではありません。カストディにロックされたXRPは現物市場に戻れないため売却可能フロートが減少。結果: 同じインフラ決済フローがより少ないXRPを動かすため価格が非線形に上昇します。',
    liveBooksSection:'📊 ライブ CEX + XRPL DEX 板', pendingLiveSection:'⏳ ライブ待ち — アップデーター実行時に更新', instLiquiditySection:'🏦 推定機関流動性（公開板ではない）', etfBooksSection:'📈 ETF/ETP — XRP現物とは分離したライブ価格/出来高', noDataSection:'⚠ 一時的に利用できないソース', technicalDetails:'技術詳細を見る', sourceUnavailable:'一時的に利用できません',
    depth1:'Depth ±1%', depth2:'Depth ±2%', spread:'スプレッド', autoRefresh:'Web自動更新', snapshotUpdated:'snapshot: {time}', booksLive:'ライブ板を表示中。Pythonアップデーターが新しいsnapshotを書き込むと、CEX、XRPL DEX、ETF/ETPをWebが自動再読込します。',
    aggregateBooksSection:'Σ 表示用ライブ集計 — 計算から除外', depthCursorLabel:'板深度カーソル', depthCursorHelp:'深度とスリッページに使う実際の板の帯域を選択します。価格に近いほど厳密です。', depthSelected:'Depth {pct}', depthCursorNote:'{pct}で計算',
  },
  ko: {
    introLang:'언어', disclaimerAccept:'동의 — 음악과 함께 시작', disclaimerDecline:'동의 — 음악 없이 시작',
    etfProducts:'포함 상품 수',
    etfMethodTitle:'데이터 출처',
    etfMethodText:'ETF/ETP의 일일 가격과 거래량은 가능한 경우 라이브 시장 조회에서 가져옵니다. XRP 보유량, AUM, 상품별 비중은 활성 시나리오의 모델 가정이며 공식 보유량이나 XRP 현물 오더북이 아닙니다.',
    etfDataLive:'라이브: {total}개 중 {live}개 상품 가격/거래량 조회. 업데이트: {updated}.',
    etfDataModel:'모델: 상품 비중은 내부 시나리오 가중치를 사용합니다. XRP 보유량 = ETF 채택률 × 신뢰도 × 보유량 가설. AUM은 그 XRP 보유량 × 시나리오 기능 가격입니다.',
    etfTableProduct:'상품', etfTableTicker:'티커', etfTablePrice:'ETF/ETP 가격', etfTableVol:'라이브 일 거래량', etfTableHeld:'XRP 보유량(모델)', etfTableAum:'AUM(모델)', etfTableShare:'% 바스켓', etfTotal:'합계',
    etfDisabled:'— (비활성화)', etfNoQuery:'조회 없음', etfEnableHint:'인프라 지도에서 XRP ETF를 활성화하면 기능 가격에 대한 플로트 감소 효과를 볼 수 있습니다.',
    floatExplainNote:'왜 유통량(~54.7B)과 매도 가능 플로트 슬라이더(1.25B)가 이렇게 다를까요? 유통량은 Ripple 에스크로 밖에 존재하는 모든 XRP입니다. 하지만 대부분은 장기 보유 중: 거래소 준비금, 고래 지갑, 기관 수탁, 장기 투자자 보유분. 플로트 슬라이더는 단기적으로 실제 매도 가능한 부분만 나타냅니다—"실질 매도 압력"입니다. 이 비율이 낮을수록 결제 흐름의 1달러가 가격을 더 크게 움직입니다.',
    etfMechTitle:'ETF가 XRP를 시장에서 잠그는 방식 — 실제 메커니즘',
    etfMechStep1:'공인 참여자(AP)가 투자자 자금으로 현물 시장에서 XRP 매수',
    etfMechStep2:'해당 XRP를 ETF 수탁자(예: Coinbase Custody, BitGo)에 납입',
    etfMechStep3:'XRP는 수탁에 잠금 — 현물 시장에서 자유롭게 매도 불가',
    etfMechStep4:'AP는 주식 거래소(NYSE/Nasdaq/Xetra)에서 거래되는 ETF 주식 수령',
    etfMechNote:'표의 "일 거래량"은 주식 거래소에서의 ETF 주식 거래량입니다 — XRP 현물 흐름이 아닙니다. 수탁에 잠긴 XRP는 현물 시장으로 돌아와 매도될 수 없어 실질 매도 가능 플로트가 감소합니다. 결과: 동일한 인프라 결제 흐름이 더 적은 XRP로 수요를 흡수해야 하므로 기능 가격이 비선형적으로 상승합니다.',
    liveBooksSection:'📊 라이브 CEX + XRPL DEX 오더북', pendingLiveSection:'⏳ 라이브 대기 — 업데이트 실행 시 갱신', instLiquiditySection:'🏦 추정 기관 유동성(공개 오더북 아님)', etfBooksSection:'📈 ETF/ETP — XRP 현물과 분리된 라이브 가격/거래량', noDataSection:'⚠ 일시적으로 사용할 수 없는 소스', technicalDetails:'기술 세부 정보 보기', sourceUnavailable:'일시적으로 사용할 수 없음',
    depth1:'Depth ±1%', depth2:'Depth ±2%', spread:'스프레드', autoRefresh:'웹 자동 새로고침', snapshotUpdated:'snapshot: {time}', booksLive:'라이브 오더북을 보고 있습니다. Python 업데이터가 새 snapshot을 쓰면 CEX, XRPL DEX, ETF/ETP를 웹이 자동으로 다시 불러옵니다.',
    aggregateBooksSection:'Σ 표시용 라이브 집계 — 계산 제외', depthCursorLabel:'깊이 커서', depthCursorHelp:'깊이와 슬리피지에 사용할 실제 오더북 구간을 선택합니다. 가격에 가까울수록 더 엄격합니다.', depthSelected:'Depth {pct}', depthCursorNote:'{pct} 기준 계산',
  }
};

function itemSummary(item) {
  const langMap = SUMMARY_I18N[state.lang] || {};
  return langMap[item.id] || item['summary_' + state.lang] || item.summary_es || item.summary || '';
}

function t(key, vars={}){
  const lang = I18N[state.lang] || I18N.es;
  let s = (I18N_EXTRA[state.lang]||{})[key] ?? lang[key] ?? (I18N_EXTRA.es||{})[key] ?? I18N.es[key] ?? key;
  for (const [k,v] of Object.entries(vars)) s = String(s).replaceAll(`{${k}}`, v);
  return s;
}
const EXPLAINER_KEYS = {float:['expFloatTitle','expFloatText'], rotation:['expRotationTitle','expRotationText'], privateFactor:['expPrivateTitle','expPrivateText'], premium:['expPremiumTitle','expPremiumText'], orderM:['expOrderTitle','expOrderText'], adoption:['expAdoptionTitle','expAdoptionText']};
const UI_MAP = [
  ['#introLangLabel','introLang'],
  ['.audio-meta small','audioPlaylist'], ['#toggleAudio','pause'], ['#prevTrack','previous','title'], ['#nextTrack','next','title'],
  ['#introModal .section-label','beforeEnter'], ['#introTitle','introTitle'], ['#introTitle + p','introText'], ['#introModal .simple-grid div:nth-child(1) b','intro1Title'], ['#introModal .simple-grid div:nth-child(1) span','intro1Text'], ['#introModal .simple-grid div:nth-child(2) b','intro2Title'], ['#introModal .simple-grid div:nth-child(2) span','intro2Text'], ['#introModal .simple-grid div:nth-child(3) b','intro3Title'], ['#introModal .simple-grid div:nth-child(3) span','intro3Text'], ['#introModal .fine','introFine'], ['#enterWithMusic','enterMusic'], ['#enterSilent','enterSilent'],
  ['#explainModal .section-label','explainLabel'], ['#explainTitle','explainTitleDefault'], ['#explainText','explainTextDefault'], ['#closeExplain','understood'],
  ['#crawlOverlay .section-label','crawlStep'], ['#crawlOverlay h3','crawlIntro'], ['#skipToCalculator','crawlToCalc'], ['#closeCrawl','close'], ['#crawlOverlay .crawl-footer','crawlFooter'],
  ['.cinematic-topline .section-label','movieMode'], ['#cinemaPrev','previous'], ['#cinemaPause','pause'], ['#cinemaNext','next'], ['#cinemaClose','close'], ['.cinematic-caption','cinemaCaption'],
  ['nav a[href="#presentacion"]','navPresentation'], ['nav a[href="#infra"]','navInfra'], ['nav a[href="#simulador"]','navCalc'], ['nav a[href="#cinematica"]','navCinema'], ['nav a[href="#donar"]','navDonate'],
  ['#inicio .kicker','kicker'], ['#inicio h1','heroTitle'], ['#inicio .lead','heroLead'], ['#openPresentationHero','viewPresentation'], ['#inicio .hero-actions a[href="#simulador"]','goCalc'], ['#openIntro','whatDoes'],
  ['#heroMetrics div:nth-child(1) span','metricInfra'], ['#heroMetrics div:nth-child(2) span','metricCorridors'], ['#heroMetrics div:nth-child(3) span','metricBooks'], ['#heroMetrics div:nth-child(4) span','metricData'],
  ['#presentacion > .section-label','step1'], ['#presentacion h2','presTitle'], ['#presentacion .section-head .muted','presText'], ['#openPresentation','openPresentation'], ['#presentacion a[href="#simulador"]','skipCalc'], ['#presentacion .presentation-step:nth-child(1) b','presStep1Title'], ['#presentacion .presentation-step:nth-child(1) span','presStep1Text'], ['#presentacion .presentation-step:nth-child(2) b','presStep2Title'], ['#presentacion .presentation-step:nth-child(2) span','presStep2Text'], ['#presentacion .presentation-step:nth-child(3) b','presStep3Title'], ['#presentacion .presentation-step:nth-child(3) span','presStep3Text'],
  ['#tesis article:nth-child(1) .section-label','thesisLabel'], ['#tesis article:nth-child(1) h2','thesisTitle'], ['#tesis article:nth-child(1) p:first-of-type','thesisText'], ['#tesis article:nth-child(1) .muted','thesisNote'], ['#tesis article:nth-child(2) .section-label','differentLabel'], ['#tesis article:nth-child(2) h2','differentTitle'],
  ['#infra > .section-label','infraMap'], ['#infra h2','infraTitle'], ['#infra .muted','infraText'], ['#filterEvidence option[value="all"]','allEvidence'], ['#searchInfra','searchPlaceholder','placeholder'],
  ['#simulador article:nth-child(1) .section-label','calcStep'], ['#simulador article:nth-child(1) h2','globalParams'], ['#floatInput','floatSeller','labelPrefix'], ['#rotationInput','rotationBase','labelPrefix'], ['#privateInput','privateLiquidity','labelPrefix'], ['#premiumInput','marketPremium','labelPrefix'], ['#orderInput','stressOrder','labelPrefix'], ['#resetBtn','reset'], ['#cinemaBtn','openFinalCinema'], ['#simulador article:nth-child(1) .fine','calcFine'],
  ['.results-card .section-label','liveResult'], ['.result-main div:nth-child(1) span','functionalPrice'], ['.result-main div:nth-child(2) span','marketSimPrice'], ['.result-grid div:nth-child(1) span','directFlowYear'], ['.result-grid div:nth-child(2) span','rlusdFlowYear'], ['.result-grid div:nth-child(3) span','xrplFlowYear'], ['.result-grid div:nth-child(4) span','dynamicDepth'], ['.result-grid div:nth-child(5) span','stressSlippage'], ['#execPriceLabel','execPriceLabel'], ['.result-grid div:nth-child(7) span','estimatedTier'],
  ['#orderbooks .section-label','orderbooksLabel'], ['#orderbooks h2','orderbooksTitle'], ['#orderbooks .muted','orderbooksText'], ['#copyScenario','copyScenario'], ['#depthCursorLabel','depthCursorLabel'], ['#depthCursorHelp','depthCursorHelp'],
  ['#simpleSummary article:nth-child(1) .section-label','simpleSummary'], ['#simpleSummary article:nth-child(1) h2','pythonSimple'], ['#simpleSummary article:nth-child(2) .section-label','priceTime'], ['#simpleSummary article:nth-child(2) h2','path2035'], ['#simpleSummary article:nth-child(2) .fine','pathFine'],
  ['#cinematica .section-label','finalCinemaStep'], ['#cinematica h2','finalCinemaTitle'], ['#cinematica .muted','finalCinemaText'], ['#cinematica a[href="#simulador"]','backCalc'], ['#playCinematic','openCinema'], ['.cinema-module-btn[data-module="narrative"]','moduleNarrative'], ['.cinema-module-btn[data-module="orderbooks"]','moduleOrderbooks'], ['.cinema-module-btn[data-module="timeline"]','moduleTimeline'], ['.cinema-module-btn[data-module="summary"]','moduleSummary'], ['#cinematica .fine','cinemaTip'],
  ['#custom .section-label','addMissing'], ['#custom h2','customMarket'], ['#custom .muted','customText'], ['#addCustom','addModel'],
  ['#donar .section-label','donateLabel'], ['#donar h2','donateTitle'], ['#donar p','donateText'],
  ['#introBeforeEnter','disclaimerTitle'], ['#introDisclaimerText','disclaimerText'],
  ['#acceptText','disclaimerCheck'], ['#enterWithMusic','disclaimerAccept'], ['#enterSilent','disclaimerDecline'],
  ['#introFineText','introFine'],
  ['#etfLabelEl','etfLabel'], ['#etfTitleEl','etfTitle'], ['#etfTextEl','etfText'],
  ['#etfHoldingsLabel','etfHoldings'], ['#etfFloatRedLabel','etfFloatRed'], ['#etfAumLabel','etfAum'], ['#etfProductsLabel','etfProducts'], ['#etfMethodTitle','etfMethodTitle'], ['#etfMethodText','etfMethodText'],
  ['#etfMechTitle','etfMechTitle'], ['#etfMechStep1','etfMechStep1'], ['#etfMechStep2','etfMechStep2'], ['#etfMechStep3','etfMechStep3'], ['#etfMechStep4','etfMechStep4'], ['#etfMechNote','etfMechNote'],
  ['#floatExplainNote','floatExplainNote']
];
function setLabelPrefix(inputSelector, key){
  const input = document.querySelector(inputSelector); if(!input) return;
  const label = input.closest('.control')?.querySelector('label'); const b = label?.querySelector('b'); const btn=label?.querySelector('button');
  if(label && b) { label.childNodes[0].nodeValue = t(key) + ' '; if(btn) btn.textContent=t('explanation'); }
}
function applyI18nStatic(){
  document.documentElement.lang = state.lang;
  document.title = 'XRP Simulator — ' + t('langName');
  document.querySelectorAll('.lang-btn').forEach(b=>b.classList.toggle('active', b.dataset.lang===state.lang));
  UI_MAP.forEach(([selector,key,attr])=>{
    if(attr==='labelPrefix') return setLabelPrefix(selector,key);
    document.querySelectorAll(selector).forEach(el=>{
      if(attr) el.setAttribute(attr,t(key)); else el.textContent=t(key);
    });
  });
  document.querySelectorAll('.copy-wallet').forEach(btn=>btn.textContent=t('copy'));
  updateDepthCursorUI();
  // Keep disclaimer/accept buttons in sync after language switch
  const cb = document.getElementById('acceptCheck');
  if (cb) {
    const ok = cb.checked;
    ['enterWithMusic','enterSilent'].forEach(id=>{ const b=document.getElementById(id); if(b) b.disabled=!ok; });
  }
}
function setupLanguage(){
  document.querySelectorAll('.lang-btn').forEach(btn=>btn.addEventListener('click',()=>{
    state.lang = btn.dataset.lang || 'es'; localStorage.setItem('rit_lang', state.lang); applyI18nStatic();
    if (registry && books && items.length) renderAll();
    if (window.__refreshLanguageCinematic) window.__refreshLanguageCinematic();
  }));
  initDepthCursor();
  applyI18nStatic();
  startLiveSnapshotAutoRefresh();
}

function updateDepthCursorUI(){
  const pct = selectedDepthPct();
  const out = document.getElementById('depthCursorOut');
  const input = document.getElementById('depthCursor');
  if (input) input.value = String(state.depthIdx);
  if (out) out.textContent = depthPctLabel(pct);
}
function initDepthCursor(){
  const input = document.getElementById('depthCursor');
  if (!input || input.dataset.bound === '1') { updateDepthCursorUI(); return; }
  state.depthIdx = clamp(Math.round(state.depthIdx), 0, DEPTH_LEVELS_PCT.length - 1);
  input.value = String(state.depthIdx);
  input.dataset.bound = '1';
  input.addEventListener('input', () => {
    state.depthIdx = clamp(Math.round(Number(input.value)), 0, DEPTH_LEVELS_PCT.length - 1);
    localStorage.setItem('rit_depth_idx', String(state.depthIdx));
    updateDepthCursorUI();
    renderBooks();
    calculate();
  });
  updateDepthCursorUI();
}


async function refreshLiveSnapshotOnce(){
  if (!books) return;
  try {
    const next = await fetch('data/live_orderbook_snapshot.json?ts=' + Date.now(), {cache:'no-store'}).then(r=>r.json());
    if (!next || !Array.isArray(next.books)) return;
    if (snapshotSignature(next) !== snapshotSignature(books)) {
      books = next;
      renderHero();
      renderBooks();
      calculate();
      applyI18nStatic();
      console.log('[XRP Simulator] live snapshot refreshed', next.generated_at);
    }
  } catch (err) {
    console.warn('[XRP Simulator] live snapshot refresh failed', err);
  }
}
function startLiveSnapshotAutoRefresh(){
  if (liveRefreshTimer) clearInterval(liveRefreshTimer);
  liveRefreshTimer = setInterval(refreshLiveSnapshotOnce, LIVE_SNAPSHOT_REFRESH_MS);
}

async function loadData(){
  const [reg, book] = await Promise.all([
    fetch('data/infrastructure_registry.json').then(r=>r.json()),
    fetch('data/live_orderbook_snapshot.json').then(r=>r.json())
  ]);
  registry = reg;
  books = book;
  items = reg.items.map(x=>({...x, enabled:true, activation_pct:x.default_activation_pct}));

  // Load v8.6 calibrated scenarios (Python engine — correct prices)
  try {
    scenariosV86 = await fetch('data/scenarios_v86.json').then(r=>r.json());
    console.log('[v8.6] Scenarios loaded:', Object.keys(scenariosV86.scenarios));
  } catch(e) {
    console.warn('[v8.6] scenarios_v86.json not found, using internal fallback');
    scenariosV86 = null;
  }

  initFilters();
  bindControls();
  setupLanguage();
  renderAll();
  applyI18nStatic();
}

function initFilters(){
  const ev = [...new Set(items.map(i=>i.evidence))];
  const sel = document.getElementById('filterEvidence');
  ev.forEach(e=>{const o=document.createElement('option');o.value=e;o.textContent=e.replaceAll('_',' ');sel.appendChild(o)});
}
function bindControls(){
  const bindings = [
    ['floatInput','floatB','floatOut',v=>`${Number(v).toFixed(2)}B XRP`],
    ['rotationInput','rotation','rotationOut',v=>`${Math.round(v)}x`],
    ['privateInput','privateFactor','privateOut',v=>`${Number(v).toFixed(2)}x`],
    ['premiumInput','premium','premiumOut',v=>`${Math.round(v)}%`],
    ['orderInput','orderM','orderOut',v=>`$${Math.round(v)}M`]
  ];
  bindings.forEach(([id,key,out,format])=>{
    const el=document.getElementById(id); const oo=document.getElementById(out);
    el.addEventListener('input',()=>{state[key]=Number(el.value); oo.textContent=format(el.value); calculate();});
    oo.textContent=format(el.value);
  });
  document.getElementById('filterEvidence').addEventListener('change',e=>{state.filter=e.target.value;renderInfra();});
  document.getElementById('searchInfra').addEventListener('input',e=>{state.search=e.target.value.toLowerCase();renderInfra();});
  document.getElementById('resetBtn').addEventListener('click',()=>{items.forEach(i=>{i.enabled=true;i.activation_pct=i.default_activation_pct}); Object.assign(state,{floatB:1.25,rotation:58,privateFactor:1,premium:18,orderM:100}); ['floatInput','rotationInput','privateInput','premiumInput','orderInput'].forEach(id=>{const el=document.getElementById(id); el.value = {floatInput:1.25,rotationInput:58,privateInput:1,premiumInput:18,orderInput:100}[id]; el.dispatchEvent(new Event('input'));}); renderAll();});
  document.getElementById('cinemaBtn').addEventListener('click',()=>document.getElementById('playCinematic')?.click());
  document.getElementById('copyScenario').addEventListener('click',copyScenario);
  document.getElementById('addCustom').addEventListener('click',addCustom);
  document.getElementById('customVolumeNum')?.addEventListener('input', updateVolPreview);
  document.getElementById('customVolumeUnit')?.addEventListener('change', updateVolPreview);
  document.querySelectorAll('.copy-wallet').forEach(btn=>btn.addEventListener('click',async()=>{
    const val = btn.getAttribute('data-copy') || '';
    try { await navigator.clipboard.writeText(val); btn.textContent='Copiado'; setTimeout(()=>btn.textContent='Copiar',1200); }
    catch(e){ alert('Copia manualmente: ' + val); }
  }));
  document.querySelectorAll('.explain-btn').forEach(btn=>btn.addEventListener('click',()=>openExplainer(btn.dataset.explain)));
  document.querySelectorAll('.cinema-module-btn').forEach(btn=>btn.addEventListener('click',()=>{
    state.cinematicModule = btn.dataset.module;
    document.querySelectorAll('.cinema-module-btn').forEach(x=>x.classList.toggle('active',x===btn));
    if (window.__openCinemaModule) window.__openCinemaModule(state.cinematicModule, true);
  }));
  document.getElementById('closeExplain')?.addEventListener('click',closeExplainer);
  document.getElementById('explainBackdrop')?.addEventListener('click',closeExplainer);
}
function openExplainer(key){
  const keys = EXPLAINER_KEYS[key];
  const info = keys ? {title:t(keys[0]), text:t(keys[1])} : (explainers[key] || {title:t('explainTitleDefault'), text:t('explainTextDefault')});
  document.getElementById('explainTitle').textContent = info.title;
  document.getElementById('explainText').textContent = info.text;
  document.getElementById('explainModal')?.classList.remove('hidden');
  document.getElementById('explainModal')?.setAttribute('aria-hidden','false');
}
function closeExplainer(){
  document.getElementById('explainModal')?.classList.add('hidden');
  document.getElementById('explainModal')?.setAttribute('aria-hidden','true');
}

function evidenceWeight(item){return registry.evidence_weights[item.evidence] ?? 0.5;}
function activationRaw(item){return item && item.enabled ? ((item.activation_pct||0)/100) : 0;}
function getItem(id){return items.find(x=>x.id===id);}
function activationOf(id){const i=getItem(id); if(!i) return 0; return activationRaw(i) * evidenceWeight(i) * (i.confidence ?? 0.5);}
function dependencyIdsFor(item){
  const deps = new Set();
  const cat = (item.category||'').toLowerCase();
  const name = (item.name||'').toLowerCase();
  const stack = (item.stack||[]).join(' ').toLowerCase();
  const region = (item.region||'').toLowerCase();
  if (item.id !== 'rlusd_core' && (stack.includes('rlusd') || (item.rlusd_touch_pct||0) >= 20)) deps.add('rlusd_core');
  if (item.id !== 'ripple_prime_hidden_road' && ((item.private_liquidity_pct||0) >= 65 || stack.includes('prime'))) deps.add('ripple_prime_hidden_road');
  if (item.id !== 'custody_global' && (stack.includes('custody') || cat.includes('custody') || cat.includes('tokenization'))) deps.add('custody_global');
  if (item.id !== 'ripple_treasury_gtreasury' && (stack.includes('treasury') || cat.includes('treasury'))) deps.add('ripple_treasury_gtreasury');
  if (item.id !== 'brazil_full_stack' && (region.includes('brazil') || name.includes('brasil') || (item.corridors||[]).join(' ').toLowerCase().includes('brl'))) deps.add('brazil_full_stack');
  if (item.id !== 'korea_institutional_stack' && region.includes('korea')) deps.add('korea_institutional_stack');
  if (item.id !== 'ripple_prime_hidden_road' && (cat.includes('trade finance') || cat.includes('tokenized') || cat.includes('cbdc'))) deps.add('ripple_prime_hidden_road');
  return [...deps].filter(id => id !== item.id);
}
function dependencyBoost(item){
  const deps = dependencyIdsFor(item);
  if (!deps.length) return {ids:[], avg:0, factor:1};
  const avg = deps.reduce((s,id)=>s+activationOf(id),0) / deps.length;
  return {ids:deps, avg, factor: clamp(1 + avg * 0.55, 1, 1.65)};
}
function dependencyLabel(id){
  const map = {
    rlusd_core:'RLUSD core',
    ripple_prime_hidden_road:'Ripple Prime',
    custody_global:'Custody',
    ripple_treasury_gtreasury:'Treasury',
    brazil_full_stack:'Brasil stack',
    korea_institutional_stack:'Korea stack',
    xrp_spot_etfs:'ETF XRP',
    lulu_uae_middle_east:'UAE corridor',
    rwa_xrpl_ecosystem:'RWA XRPL',
    dtcc_derivatives_collateral:'DTCC Derivados'
  };
  return map[id] || (getItem(id)?.name || id);
}
function bookForSymbols(symbols=[]){
  const all = books.books || [];
  const relevant = all.filter(b=>symbols.includes(b.symbol));
  return relevant.length ? relevant : all.filter(b=>['XRP/USD','XRP/RLUSD'].includes(b.symbol));
}
function isSpotLiquidityRow(b){
  const q = String(b.quality||'');
  const sym = String(b.symbol||'');
  if (isDisplayAggregateRow(b)) return false;
  if (q.startsWith('etf_') || sym.startsWith('ETF/') || sym.startsWith('ETP/')) return false;
  if (q === 'institutional_estimate') return false;
  if (q.includes('failed') || q.includes('disabled') || q === 'symbol_not_listed') return false;
  if (!isNum(b.depth_1pct_usd) || b.depth_1pct_usd <= 0) return false;
  const liveMode = String(books?.mode||'').includes('live');
  const isLive = q.startsWith('live_');
  const isBase = q === 'fallback' || q === 'static_estimate' || q.includes('base');
  return liveMode ? isLive : (isLive || isBase);
}
function baseBookStats(activeItems){
  const used = new Map();
  activeItems.forEach(i=>bookForSymbols(i.book_symbols).forEach(b=>{ if (isSpotLiquidityRow(b)) used.set(`${b.venue}:${b.symbol}`,b); }));
  const arr = [...used.values()];
  if (!arr.length) return {depth1:0, depth2:0, depthSelected:0, volume:0, avgSpread:0, count:0, selectedPct:selectedDepthPct()};
  const selectedPct = selectedDepthPct();
  const depthSelected = arr.reduce((sum,b)=>sum+getDepthAtPct(b, selectedPct),0);
  const depth1 = arr.reduce((sum,b)=>sum+getDepthAtPct(b, 1),0);
  const depth2 = arr.reduce((sum,b)=>sum+getDepthAtPct(b, 2),0);
  const volume = arr.reduce((sum,b)=>sum+(isNum(b.daily_volume_usd)?b.daily_volume_usd:0),0);
  const avgSpread = arr.reduce((sum,b)=>sum+(isNum(b.spread_bps)?b.spread_bps:0),0)/arr.length;
  return {depth1:depthSelected, depth2, depthSelected, depthAt1:depth1, volume, avgSpread, count:arr.length, selectedPct};
}
function calculate(){
  const active = items.filter(i=>i.enabled);
  let direct=0, rlusd=0, xrpl=0, privateScore=0, retentionScore=0, weightedAdoption=0;
  let coupledItems = 0, dependencyScore = 0;
  const byCategory = {};
  active.forEach(i=>{
    const ev=evidenceWeight(i), conf=i.confidence ?? 0.5;
    const dep = dependencyBoost(i);
    const baseAct = activationRaw(i);
    const act = clamp(baseAct * dep.factor, 0, 1);
    const base = i.base_volume_annual_usd || 0;
    const directFlow = base * act * (i.direct_xrp_touch_pct/100) * ev * conf;
    const rlusdFlow = base * act * (i.rlusd_touch_pct/100) * ev * conf;
    const xrplFlow = base * act * (i.xrpl_touch_pct/100) * ev * conf;
    direct += directFlow; rlusd += rlusdFlow; xrpl += xrplFlow;
    privateScore += base * act * ((i.private_liquidity_pct||0)/100) * ev * conf * (1 + dep.avg*0.25);
    retentionScore += act * ((i.retention_effect_pct||0)/100) * ev * conf * (1 + dep.avg*0.35);
    weightedAdoption += act * ev * conf;
    dependencyScore += dep.avg;
    if (dep.ids.length) coupledItems += 1;
    byCategory[i.category] = (byCategory[i.category]||0) + directFlow;
  });
  const book = baseBookStats(active);
  const infraDepthBoost = 1
    + activationOf('ripple_prime_hidden_road') * 0.28
    + activationOf('custody_global') * 0.22
    + activationOf('ripple_treasury_gtreasury') * 0.16
    + activationOf('rlusd_core') * 0.12
    + activationOf('brazil_full_stack') * 0.06;
  const privateDepthBoost = 1 + Math.log10(1 + privateScore/1e9) * 0.55 * state.privateFactor;
  const xrplBoost = 1 + Math.log10(1 + xrpl/1e9) * 0.10;
  const depthDynamic = Math.max(book.depth1, 1) * privateDepthBoost * xrplBoost * infraDepthBoost;
  const orderUsd = state.orderM * 1e6;
  const slippage = clamp(Math.pow(orderUsd / Math.max(depthDynamic, 1), 0.66) * 1.0, 0.01, 95);
  const retentionCore = activationOf('custody_global')*0.10 + activationOf('ripple_prime_hidden_road')*0.09 + activationOf('ripple_treasury_gtreasury')*0.05;
  const retentionAdj = clamp(retentionScore * 1.8 + retentionCore, 0, 0.72);
  const effectiveRotation = Math.max(4, state.rotation * (1 - retentionAdj));
  const adoptionPremiumAdj = clamp((weightedAdoption*100)*2.2 + dependencyScore*12, 0, 260);
  const premiumTotal = state.premium + adoptionPremiumAdj;

  // ── ETF FLOAT REDUCTION ─────────────────────────────────────────────────
  // If the XRP ETF item is enabled, its holdings reduce the sellable float
  const etfItem = items.find(i => i.id === 'xrp_spot_etfs' && i.enabled);
  let etfHeldB = 0;
  if (etfItem) {
    const etfAct = clamp((etfItem.activation_pct || 0) / 100, 0, 1);
    const etfConf = etfItem.confidence ?? 0.85;
    etfHeldB = (etfItem.etf_holdings_xrp_billion || 0.75) * etfAct * etfConf;
  }
  const floatEffective = Math.max(state.floatB - etfHeldB, 0.05);

  let priceUtil, priceMarket;

  if (scenariosV86) {
    // ── V8.6 CALIBRATED ENGINE ──────────────────────────────────────
    // The registry flow (~$3B) is only the confirmed infrastructure slice.
    // v8.6 captures total ODL volume + induced demand + escrow + S-curve.
    // We use v8.6 as primary price anchor, scaled by user's slider state.

    // ── SCENARIO MAPPING ────────────────────────────────────────────
    // The registry default state (~7% raw activation) = today's confirmed
    // infrastructure = today_confirmed scenario ($1.19 util, $1.54 mkt).
    // We measure RELATIVE adoption: how much above/below default is the user?

    // Compute evidence-weighted activation (same as Python engine)
    const evWeights = registry.evidence_weights || {};
    let weightedSum = 0, weightedMax = 0;
    items.filter(i=>i.enabled).forEach(i=>{
      const ev = evWeights[i.evidence] ?? 0.5;
      const conf = i.confidence ?? 0.5;
      weightedSum += (i.activation_pct/100) * ev * conf;
      weightedMax += ev * conf;
    });
    // Calibrated thresholds anchored to DEFAULT state = today_confirmed 2026
    // DEFAULT evidence-weighted ratio ≈ 0.079 (measured from registry defaults)
    // Thresholds are multiples of 0.079 to preserve intuitive slider feel:
    //   0.079 (default) → today_confirmed 2026: P_util=$1.19, P_mkt=$1.54
    //   0.24           → status_quo
    //   0.40           → clarity_base
    //   0.63           → expected_roadmap
    //   0.95           → bank_integration
    //   >0.95          → stress_test
    const weightedRatio = weightedSum / Math.max(weightedMax, 0.001);

    let scKey;
    const DEFAULT_WR_THRESH = 0.0792;
    if      (weightedRatio < DEFAULT_WR_THRESH) scKey = 'regulatory_reversal';
    else if (weightedRatio < 0.140) scKey = 'today_confirmed';
    else if (weightedRatio < 0.260) scKey = 'status_quo';
    else if (weightedRatio < 0.420) scKey = 'clarity_base';
    else if (weightedRatio < 0.660) scKey = 'expected_roadmap';
    else if (weightedRatio < 0.950) scKey = 'bank_integration';
    else                            scKey = 'stress_test';

    const sc = scenariosV86.scenarios[scKey] || {};
    const yr26 = sc.years?.['2026'] || {p_util:1.19, p_mkt:1.54};
    const yr35 = sc.years?.['2035'] || {p_util:4.99, p_mkt:7.83};

    // Within each scenario: interpolate 2026→2035 based on position in band
    // Calibrated: DEFAULT wr=0.0792 → today_confirmed t=0 → P_util=$1.19 exactly
    const DEFAULT_WR = 0.0792;
    const scenBands = {
      regulatory_reversal:[0.000, DEFAULT_WR],
      today_confirmed:    [DEFAULT_WR, 0.140],
      status_quo:         [0.140, 0.260],
      clarity_base:       [0.260, 0.420],
      expected_roadmap:   [0.420, 0.660],
      bank_integration:   [0.660, 0.950],
      stress_test:        [0.950, 1.200]
    };
    const [lo,hi] = scenBands[scKey] || [0.0792, 0.14];
    const t = clamp((weightedRatio - lo) / Math.max(hi - lo, 0.001), 0, 1);
    let baseUtil = yr26.p_util + (yr35.p_util - yr26.p_util) * t;
    let baseMkt  = yr26.p_mkt  + (yr35.p_mkt  - yr26.p_mkt)  * t;

    // 3. Apply user slider adjustments vs model defaults
    //    Float slider + ETF reduction: lower effective float = higher price
    const floatAdj = clamp(Math.pow(1.24 / Math.max(floatEffective, 0.05), 0.6), 0.4, 2.5);
    //    Rotation slider: default 58x → higher rotation = lower price  
    const rotAdj   = clamp(Math.pow(58  / Math.max(effectiveRotation, 4), 0.4), 0.4, 2.0);
    //    Private liquidity: affects depth but not price directly (small effect)
    const privAdj  = clamp(1 + (state.privateFactor - 1) * 0.15, 0.7, 1.5);

    priceUtil  = clamp(baseUtil * floatAdj * rotAdj * privAdj, 0.01, 200000);
    // Premium slider: normalized so default 18% = neutral (no extra change vs calibration).
    // Moving left compresses market price toward util; moving right inflates narrative premium.
    const premiumUserAdj = clamp(1 + (state.premium - 18) / 100, 0.50, 6.0);
    priceMarket = clamp(baseMkt * floatAdj * rotAdj * privAdj * premiumUserAdj, priceUtil, 500000);
  } else {
    // Fallback if scenarios_v86.json not loaded
    priceUtil   = direct / ((state.floatB*1e9) * Math.pow(effectiveRotation, 0.72));
    priceMarket = priceUtil * (1 + premiumTotal/100);
  }
  // Execution price: what you'd actually pay placing the stress order against current depth
  const execPrice = clamp(priceMarket * (1 + slippage / 100), priceMarket, priceMarket * 96);
  const tier = tierFrom(priceUtil, direct, depthDynamic, slippage);
  const result = {active,direct,rlusd,xrpl,privateScore,retentionScore,book,depthDynamic,slippage,execPrice,effectiveRotation,priceUtil,priceMarket,premiumTotal,tier,byCategory,coupledItems,dependencyScore,infraDepthBoost,etfHeldB,floatEffective};
  currentResult = result;
  renderResults(result);
  renderSimpleSummary(result);
  if (window.__refreshCinemaIfOpen) window.__refreshCinemaIfOpen();
  return result;
}
function tierFrom(priceUtil, direct, depth, slip){
  // Official nomenclature: T0=Speculative → T5=Reserve Asset
  if (direct > 8e11 && slip < 1.0) return 'T5·Reserve Asset (HQLA 1+)';
  if (direct > 2e11 && slip < 5.0) return 'T4·Prime Collateral (HQLA 1)';
  if (direct > 5e10 && slip < 20)  return 'T3·Institutional (HQLA 2A)';
  if (direct > 1.5e10)              return 'T2·Bridge activo (HQLA 2B)';
  if (direct > 1e9)                 return 'T1·Utility básica';
  return 'T0·Especulativo';
}
function renderResults(r){
  document.getElementById('priceFunctional').textContent = fmtUsd(r.priceUtil,2);
  document.getElementById('priceMarket').textContent = fmtUsd(r.priceMarket,2);
  document.getElementById('directFlow').textContent = fmtUsd(r.direct,2);
  document.getElementById('rlusdFlow').textContent = fmtUsd(r.rlusd,2);
  document.getElementById('xrplFlow').textContent = fmtUsd(r.xrpl,2);
  document.getElementById('depthDynamic').textContent = fmtUsd(r.depthDynamic,2);
  document.getElementById('slippageOut').textContent = pct(r.slippage,2);
  const execEl = document.getElementById('execPriceOut');
  if (execEl) execEl.textContent = fmtUsd(r.execPrice,2);
  document.getElementById('tierOut').textContent = r.tier;
  const scKey86 = detectScenario(r);
  const sc86label = scenariosV86?.scenarios?.[scKey86]?.label || scKey86;
  const calib = scenariosV86?.calibration?.today_confirmed_2026;
  document.getElementById('explainBox').innerHTML = `
    <b>Resultado actual del escenario · Motor v8.6 · ${sc86label}</b><br>
    <span style="color:#9fc7de;font-size:13px">
      Precio funcional actual: <b style="color:#55e6ff">${fmtUsd(r.priceUtil,2)}</b> ·
      Precio mercado simulado actual: <b style="color:#dffaff">${fmtUsd(r.priceMarket,2)}</b>
      ${calib ? `<br>Calibración base 2026: P_util $${calib.p_util} / P_mkt $${calib.p_mkt_model} / Real $${calib.p_mkt_real} (gap ${calib.gap_pct}%)` : ''}
    </span><br><br>
    <b>Infraestructura activa:</b> ${r.active.length} piezas ·
    ${r.coupledItems} acopladas a módulos (RLUSD, Prime, Custody, Treasury) ·
    ${r.book.count} libros de orderbook · ${t('depthCursorNote',{pct:depthPctLabel(r.book.selectedPct||selectedDepthPct())})} ·
    Multiplicador de red: <b>${r.infraDepthBoost.toFixed(2)}x</b> ·
    Rotación efectiva: <b>${r.effectiveRotation.toFixed(1)}x</b><br>
    <span style="color:#7a9abf;font-size:12px">
      La proyección 2026→2035 se muestra más abajo como narrativa condicional. No es el mismo bloque que el resultado actual.
    </span>
  `.trim();
  drawChart(r.byCategory);
  renderEtfPanel(r);
}
function liveEtfRows(){
  return (books?.books||[]).filter(b=>String(b.quality||'').startsWith('etf_'));
}
function etfRowForTicker(ticker){
  return liveEtfRows().find(b=>String(b.ticker||'').toUpperCase()===String(ticker||'').toUpperCase());
}
function renderEtfPanel(r) {
  if (!document.getElementById('etfPanel')) return;
  const etfItem = items.find(i => i.id === 'xrp_spot_etfs');
  const etfEnabled = etfItem && etfItem.enabled;
  const held = r.etfHeldB || 0;           // B XRP
  const priceXrp = r.priceUtil || books?.xrp_price_usd || 1.5;
  const aumEst = held * priceXrp * 1e9;
  const reduction = held > 0 ? ((held / Math.max(state.floatB, 0.01)) * 100).toFixed(1) : '0';

  // ── Float bar ────────────────────────────────────────────────────────────────
  const freeB = Math.max(ETF_TOTAL_XRP_B - ETF_ESCROW_B - held, 0);
  const pctEscrow = (ETF_ESCROW_B / ETF_TOTAL_XRP_B * 100).toFixed(1);
  const pctEtf    = Math.max(held / ETF_TOTAL_XRP_B * 100, held > 0 ? 0.8 : 0).toFixed(2);
  const pctFree   = (100 - parseFloat(pctEscrow) - parseFloat(pctEtf)).toFixed(1);

  const segEtf  = document.getElementById('floatSegEtf');
  const segFree = document.getElementById('floatSegFree');
  if (segEtf)  { segEtf.style.width  = pctEtf  + '%'; }
  if (segFree) { segFree.style.width = pctFree + '%'; }
  const setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setT('floatSegEtfVal',  held > 0 ? held.toFixed(3) + 'B' : '—');
  setT('floatSegFreeVal', freeB.toFixed(1) + 'B');
  setT('etfTotalXrp',     held > 0 ? held.toFixed(3) + 'B XRP' : t('etfDisabled'));
  setT('circulatingXrp',  freeB.toFixed(1) + 'B XRP');
  setT('floatVendorXrp',  state.floatB.toFixed(2) + 'B XRP');
  setT('floatEffectiveXrp', r.floatEffective ? r.floatEffective.toFixed(3) + 'B XRP' : '—');

  // ── ETF products table ────────────────────────────────────────────────────────
  const wrap = document.getElementById('etfTableWrap');
  if (wrap) {
    const liveRows = liveEtfRows();
    const liveVolTotal = liveRows.reduce((s,b)=>s+(isNum(b.daily_volume_usd)?b.daily_volume_usd:0),0);
    const rows = ETF_PRODUCTS.map(p => {
      const live = etfRowForTicker(p.ticker);
      const pHeld = p.share * held;
      const pAum  = pHeld * priceXrp * 1e9;
      const pctShare = (p.share * 100).toFixed(0);
      const tag = p.market === 'USA'
        ? `<span class="etf-tag us">USA</span>`
        : p.market === 'Canadá'
          ? `<span class="etf-tag us">CA</span>`
          : `<span class="etf-tag eu">EU</span>`;
      const conf = p.confirmed ? '' : `<span class="etf-tag pending">filing</span>`;
      const barW = Math.round(p.share * 120);
      const price = live?.mid ? fmtUsd(live.mid,2) : '<span style="color:#7a9abf">—</span>';
      const vol = live ? fmtVolumeCell(live) : `<span style="color:#7a9abf">${t('etfNoQuery')}</span>`;
      const status = live ? `<span style="font-size:10px;color:#7a9abf;display:block">${labelQuality(live.quality)}</span>` : '';
      return `<tr>
        <td>${p.name}${tag}${conf}</td>
        <td style="color:#9da8b8">${p.ticker}</td>
        <td>${price}${status}</td>
        <td>${vol}</td>
        <td>${held > 0 ? (pHeld * 1000).toFixed(0) + 'M XRP' : '—'}</td>
        <td>${held > 0 ? fmtUsd(pAum, 1) : '—'}</td>
        <td>${pctShare}% <span class="etf-bar-mini" style="width:${barW}px"></span></td>
      </tr>`;
    });
    const totalHeldM = (held * 1000).toFixed(0);
    rows.push(`<tr>
      <td colspan="3"><b>${t('etfTotal')} (${ETF_PRODUCTS.length})</b></td>
      <td><b>${liveVolTotal > 0 ? fmtUsd(liveVolTotal, 2) : '—'}</b></td>
      <td><b>${held > 0 ? totalHeldM + 'M XRP' : '—'}</b></td>
      <td><b>${held > 0 ? fmtUsd(aumEst, 2) : '—'}</b></td>
      <td><b>100%</b></td>
    </tr>`);
    wrap.innerHTML = `<table class="etf-products-table">
      <thead><tr><th>${t('etfTableProduct')}</th><th>${t('etfTableTicker')}</th><th>${t('etfTablePrice')}</th><th>${t('etfTableVol')}</th><th>${t('etfTableHeld')}</th><th>${t('etfTableAum')}</th><th>${t('etfTableShare')}</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
  }

  // ── Summary metrics ───────────────────────────────────────────────────────────
  setT('etfHoldings',      held > 0 ? held.toFixed(3) + 'B XRP' : t('etfDisabled'));
  setT('etfFloatReduction', held > 0 ? `−${reduction}% del float` : '—');
  setT('etfAum',           held > 0 ? fmtUsd(aumEst, 2) : '—');
  setT('etfProductCount',  ETF_PRODUCTS.length.toString());

  const methodText = document.getElementById('etfMethodText');
  if (methodText) {
    const liveRows2 = liveEtfRows();
    const liveCount = liveRows2.filter(b=>isNum(b.mid) && b.mid>0).length;
    methodText.textContent = t('etfMethodText') + ' ' + t('etfDataLive',{live:liveCount,total:ETF_PRODUCTS.length,updated:snapshotTimeLabel(books)}) + ' ' + t('etfDataModel');
  }

  const noteEl = document.getElementById('etfPanelNote');
  if (noteEl) noteEl.textContent = etfEnabled
    ? t('etfNote')
    : t('etfEnableHint');
}
function renderInfra(){
  const grid = document.getElementById('infraGrid'); grid.innerHTML='';
  const q = state.search;
  const filtered = items.filter(i => (state.filter==='all'||i.evidence===state.filter) && (!q || [i.name,i.region,i.category,i.summary,...i.partners,...i.corridors].join(' ').toLowerCase().includes(q)));
  filtered.forEach(i=>{
    const dep = dependencyBoost(i);
    const depText = dep.ids.length ? dep.ids.map(dependencyLabel).join(' · ') : t('autonomous');
    const card=document.createElement('div'); card.className='infra-card' + (i.enabled?' active':'');
    card.innerHTML = `<div class="card-top"><h3>${i.name}</h3><span class="badge">${i.status_label}</span></div>
      <div class="partners">${i.region} · ${i.category}<br>${i.partners.slice(0,5).join(' · ')}</div>
      ${itemSummary(i) ? `<p class="muted compact-summary">${itemSummary(i)}</p>` : ''}
      <p class="explain"><b>${t('rowConnects')}</b> ${depText}</p>
      <div class="mini-bars"><div>XRP<br><b>${i.direct_xrp_touch_pct}%</b></div><div>RLUSD<br><b>${i.rlusd_touch_pct}%</b></div><div>XRPL<br><b>${i.xrpl_touch_pct}%</b></div></div>
      <div class="card-controls">
        <label class="toggle"><input type="checkbox" ${i.enabled?'checked':''}> ${t('activate')}</label>
        <label>${t('adoption')} <b>${i.activation_pct}%</b><button class="explain-btn inline" data-explain="adoption">${t('explanation')}</button></label>
        <input type="range" min="0" max="100" step="0.1" value="${i.activation_pct}">
      </div>`;
    const chk=card.querySelector('input[type=checkbox]');
    const range=card.querySelector('input[type=range]');
    const label=card.querySelector('.card-controls label:nth-of-type(2) b');
    chk.addEventListener('change',()=>{i.enabled=chk.checked; card.classList.toggle('active',i.enabled); calculate();});
    range.addEventListener('input',()=>{i.activation_pct=Number(range.value); label.textContent=`${Number(range.value).toFixed(1)}%`; calculate();});
    card.querySelectorAll('.explain-btn').forEach(btn=>btn.addEventListener('click',()=>openExplainer(btn.dataset.explain)));
    grid.appendChild(card);
  });
}
function renderBooks(){
  const table=document.getElementById('booksTable');
  const note=document.getElementById('booksNote');
  const mode=(books.mode||'').includes('live') ? 'live' : 'base';
  const pctSel = selectedDepthPct();
  updateDepthCursorUI();
  if (note) {
    const baseNote = mode==='live' ? t('booksLive') : t('booksBase');
    note.innerHTML = `${baseNote} <span class="live-refresh-pill">${t('autoRefresh')}</span> <span class="live-refresh-pill">${t('depthCursorNote',{pct:depthPctLabel(pctSel)})}</span> <span style="color:#7a9abf">${t('snapshotUpdated',{time:snapshotTimeLabel(books)})}</span>`;
  }
  const allBooks = books.books || [];
  const aggregateBooks = allBooks.filter(isDisplayAggregateRow);
  const liveBooks   = allBooks.filter(b=>String(b.quality||'').startsWith('live') && !isDisplayAggregateRow(b) && (b.depth_1pct_usd||0)>0);
  const instBooks   = allBooks.filter(b=>b.quality==='institutional_estimate');
  const etfBooks    = allBooks.filter(b=>String(b.quality||'').startsWith('etf_'));
  const staticBooks = allBooks.filter(b=>b.quality==='static_estimate');
  const failedBooks = allBooks.filter(b=>!String(b.quality||'').startsWith('etf_') && (String(b.quality||'').includes('failed') || String(b.quality||'').includes('disabled')));

  const makeRow = (b, cls='') => {
    const spread = typeof b.spread_bps==='number' ? b.spread_bps.toFixed(2)+' bps' : (b.spread_bps||'—');
    const note = b.note ? `<span style="font-size:10px;color:#7a9abf;display:block">${b.note}</span>` : '';
    const vol = fmtVolumeCell(b);
    const dSel = fmtMarketCell(getDepthAtPct(b, pctSel),1);
    const d2 = fmtMarketCell(getDepthAtPct(b, 2),1);
    return `<tr class="${cls}"><td>${b.symbol}</td><td>${labelVenue(b.venue)}${note}</td><td>${vol}</td><td>${dSel}</td><td>${d2}</td><td>${spread}</td><td>${labelQuality(b.quality)}</td></tr>`;
  };
  // ETF rows: depth/spread no aplica — son acciones en bolsa, no libros spot XRP
  const NA_DEPTH = `<span title="Las acciones ETF/ETP no tienen libro de órdenes spot XRP. El depth aquí es el del mercado de acciones, no el del XRP subyacente." style="color:#4a6a7a;cursor:help">N/A ⓘ</span>`;
  const makeEtfRow = (b) => {
    const note = b.note ? `<span style="font-size:10px;color:#7a9abf;display:block">${b.note}</span>` : '';
    const vol = fmtVolumeCell(b);
    return `<tr class="row-institutional"><td>${b.symbol}</td><td>${labelVenue(b.venue)}${note}</td><td>${vol}</td><td>${NA_DEPTH}</td><td>${NA_DEPTH}</td><td>${NA_DEPTH}</td><td>${labelQuality(b.quality)}</td></tr>`;
  };
  const ETF_SECTION_NOTE = `<tr><td colspan="7" style="font-size:11px;color:#4a6a7a;padding:6px 12px 10px;font-style:italic">Depth ±1%, Depth ±2% y Spread muestran N/A porque las ETF/ETP son acciones que cotizan en bolsa (NYSE/Nasdaq/Xetra) — no tienen libro de órdenes spot XRP. El volumen es el de las acciones, no el del XRP subyacente. El XRP retenido se modela en el panel ETF de arriba.</td></tr>`;

  const rows = [
    aggregateBooks.length ? `<tr class="table-section-header"><td colspan="7">${t('aggregateBooksSection')}</td></tr>` : '',
    ...aggregateBooks.map(b=>makeRow(b,'row-aggregate')),
    liveBooks.length ? `<tr class="table-section-header"><td colspan="7">${t('liveBooksSection')} (${liveBooks.length})</td></tr>` : '',
    ...liveBooks.map(b=>makeRow(b,'row-live')),
    staticBooks.length ? `<tr class="table-section-header"><td colspan="7">${t('pendingLiveSection')} (${staticBooks.length})</td></tr>` : '',
    ...staticBooks.map(b=>makeRow(b,'row-failed')),
    instBooks.length ? `<tr class="table-section-header"><td colspan="7">${t('instLiquiditySection')}</td></tr>` : '',
    ...instBooks.map(b=>makeRow(b,'row-institutional')),
    etfBooks.length ? `<tr class="table-section-header"><td colspan="7">${t('etfBooksSection')}</td></tr>` : '',
    etfBooks.length ? ETF_SECTION_NOTE : '',
    ...etfBooks.map(b=>makeEtfRow(b)),
    failedBooks.length ? `<tr class="table-section-header"><td colspan="7">${t('noDataSection')} (${failedBooks.length}) <details class="technical-details"><summary>${t('technicalDetails')}</summary>${failedBooks.map(b=>`<div><b>${b.symbol}</b> · ${labelVenue(b.venue)} · ${t('sourceUnavailable')}</div>`).join('')}</details></td></tr>` : '',
  ].join('');
  table.innerHTML=`<thead><tr><th>${t('pair')}</th><th>${t('source')}</th><th>${t('dailyVol')}</th><th>${t('depthSelected',{pct:depthPctLabel(pctSel)})}</th><th>${t('depth2')}</th><th>${t('spread')}</th><th>${t('quality')}</th></tr></thead><tbody>${rows}</tbody>`;
}
function drawChart(byCategory){
  const canvas=document.getElementById('flowChart'), ctx=canvas.getContext('2d');
  const w=canvas.width,h=canvas.height; ctx.clearRect(0,0,w,h);
  const entries=Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const max=Math.max(...entries.map(e=>e[1]),1);
  ctx.font='22px system-ui'; ctx.fillStyle='#eaf8ff'; ctx.fillText(t('chartTitle'),24,34);
  entries.forEach(([name,val],idx)=>{
    const y=62+idx*25, barW=(w-330)*(val/max);
    const grad=ctx.createLinearGradient(220,y,220+barW,y); grad.addColorStop(0,'#55e6ff'); grad.addColorStop(1,'#9d72ff');
    ctx.fillStyle='#9fb1c9'; ctx.font='14px system-ui'; ctx.fillText(name.slice(0,25),24,y+14);
    ctx.fillStyle='rgba(255,255,255,.08)'; ctx.fillRect(220,y,w-300,14);
    ctx.fillStyle=grad; ctx.fillRect(220,y,barW,14);
    ctx.fillStyle='#dffaff'; ctx.fillText(fmtUsd(val,1),w-72,y+14);
  });
}
function customVolumeUsd(){
  const num  = parseFloat(document.getElementById('customVolumeNum')?.value || 0);
  const unit = parseFloat(document.getElementById('customVolumeUnit')?.value || 1e9);
  return num * unit;
}
function updateVolPreview(){
  const v = customVolumeUsd();
  const el = document.getElementById('customVolPreview');
  if (el) el.textContent = Number.isFinite(v) && v > 0 ? '= ' + fmtUsd(v, 2) + '/año' : '—';
}
function addCustom(){
  const name = document.getElementById('customName').value.trim();
  const vol  = customVolumeUsd();
  if(!name || !vol) return alert(state.lang==='es'?'Pon nombre y volumen base anual.': state.lang==='en'?'Enter name and annual base volume.': state.lang==='ja'?'名前と年間ベース量を入力してください。':'이름과 연간 기본 거래량을 입력하세요.');
  const unitSel = document.getElementById('customVolumeUnit');
  const unitLabel = unitSel ? unitSel.options[unitSel.selectedIndex].text.split(' — ')[0] : '';
  const item={id:'custom_'+(++customCounter),name,region:'User',category:'Custom',evidence:'user_custom',status_label:'User',corridors:[name],partners:['User'],stack:['Custom'],base_volume_annual_usd:vol,base_volume_label:`Añadido por usuario (${fmtUsd(vol,2)}/año)`,default_activation_pct:10,activation_pct:10,direct_xrp_touch_pct:Number(document.getElementById('customXrp').value||0),rlusd_touch_pct:Number(document.getElementById('customRlusd').value||0),xrpl_touch_pct:Number(document.getElementById('customXrpl').value||0),private_liquidity_pct:50,retention_effect_pct:8,confidence:.5,book_symbols:['XRP/USD','XRP/RLUSD'],summary: state.lang==='es'?`Mercado añadido por el usuario. Volumen base: ${fmtUsd(vol,2)}/año. Revisa las hipótesis antes de compartir.`:`User-added market. Base volume: ${fmtUsd(vol,2)}/yr. Review assumptions before sharing.`,sources:[],enabled:true};
  items.push(item); renderInfra(); calculate();
}
function copyScenario(){
  const r=calculate();
  const txt=`Mi escenario XRP Simulator\nPrecio funcional: ${fmtUsd(r.priceUtil,2)}\nPrecio mercado simulado: ${fmtUsd(r.priceMarket,2)}\nFlujo directo XRP/año: ${fmtUsd(r.direct,2)}\nDepth ±1% dinámico: ${fmtUsd(r.depthDynamic,2)}\nSlippage orden ${fmtUsd(state.orderM*1e6,0)}: ${pct(r.slippage,2)}\nTier: ${r.tier}\nNo es predicción: es simulación condicional.`;
  navigator.clipboard?.writeText(txt); alert(state.lang==='es'?'Escenario copiado.':state.lang==='en'?'Scenario copied.':state.lang==='ja'?'シナリオをコピーしました。':'시나리오가 복사되었습니다.');
}
function renderHero(){
  document.getElementById('mInfra').textContent=items.length;
  document.getElementById('mCorridors').textContent=[...new Set(items.flatMap(i=>i.corridors))].length;
  document.getElementById('mBooks').textContent=(books.books||[]).length;
  document.getElementById('mMode').textContent=(books?.mode||'').includes('live')?t('live'):t('baseData');
}
function detectScenario(r){
  // Detect which v8.6 scenario best matches current user configuration
  if (!scenariosV86 || !r) return null;
  const direct = r.direct || 0;
  const slip = r.slippage || 50;
  if (direct < 5e8) return 'regulatory_reversal';
  if (direct < 3e9) return 'today_confirmed';
  if (direct < 6e9) return 'status_quo';
  if (direct < 1.5e10) return 'clarity_base';
  if (direct < 5e10) return 'expected_roadmap';
  if (direct < 2e11) return 'bank_integration';
  return 'stress_test';
}
function buildTimelineProjection(r=currentResult){
  if (!r) return [];
  // Use v8.6 calibrated data if available
  if (scenariosV86) {
    const scKey = detectScenario(r);
    const sc = scenariosV86.scenarios[scKey];
    if (sc && sc.years) {
      const yrs = ['2026','2029','2033','2035'];
      const notes = [t('timelineNote2026'), t('timelineNote2029'), t('timelineNote2035'), t('timelineNote2035')];
      return yrs.map((y,i)=>{
        const d = sc.years[y] || {};
        return {
          year:parseInt(y),
          util: d.p_util || 0,
          mkt: d.p_mkt || 0,
          depth: d.depth_1pct || 0,
          slip: d.slip_100m || 0,
          tier: d.tier_label || '',
          hqla: d.hqla || '',
          note: notes[i],
          scenario: sc.label
        };
      });
    }
  }
  // Fallback: simple projection
  const adoptionDensity = clamp(r.active.reduce((s,i)=>s + (i.enabled ? (i.activation_pct||0)/100 : 0), 0) / Math.max(r.active.length,1), 0, 1);
  const infraBoost = clamp(1 + adoptionDensity*0.55 + (r.infraDepthBoost-1)*0.6 + (r.premiumTotal/100)*0.15, 1, 3.2);
  const utilBase = Math.max(r.priceUtil, 0.01);
  const mktBase = Math.max(r.priceMarket, utilBase);
  return [
    {year:2026, util:utilBase, mkt:mktBase, note:t('timelineNote2026')},
    {year:2029, util:utilBase * (1.35 + infraBoost*0.55), mkt:mktBase * (1.55 + infraBoost*0.85), note:t('timelineNote2029')},
    {year:2033, util:utilBase * (1.7 + infraBoost*0.80), mkt:mktBase * (2.0 + infraBoost*1.20), note:t('timelineNote2035')},
    {year:2035, util:utilBase * (1.9 + infraBoost*0.95), mkt:mktBase * (2.2 + infraBoost*1.45), note:t('timelineNote2035')}
  ];
}
function renderSimpleSummary(r=currentResult){
  if (!r) return;
  const years = buildTimelineProjection(r);
  const cards = document.getElementById('simpleCards');
  if (cards) cards.innerHTML = years.map(y=>`<div class="simple-card"><span>${y.year}</span><b>${fmtUsd(y.mkt||y.util||0,2)}</b><small>${y.note||''}</small></div>`).join('');
  const tlEl = document.getElementById('timelineSimple');
  if (tlEl) tlEl.innerHTML = years.map((y,idx)=>`<div class="timeline-step"><div class="timeline-dot"></div><div><b>${y.year}</b><span>${t('functionalPrice')}: ${fmtUsd(y.util||0,2)}</span><small>${t('marketSimPrice')}: ${fmtUsd(y.mkt||0,2)}</small>${y.tier?`<small>${y.tier}</small>`:''}</div></div>${idx<years.length-1?'<div class="timeline-line"></div>':''}`).join('');
  const n = document.getElementById('simpleNarrative');
  if (n) {
    const mode = (books.mode||'').includes('live') ? t('live') : t('baseData');
    n.textContent = t('simpleReading',{active:r.active.length,depth:fmtUsd(r.depthDynamic,2),slip:pct(r.slippage,2),tier:(r.tier||'').toLowerCase(),mode});
  }
}
function renderAll(){initDepthCursor();renderHero();renderInfra();renderBooks();calculate();}
loadData().catch(err=>{console.error(err);document.body.innerHTML='<pre style="color:white;padding:40px">Error cargando datos: '+err.message+'</pre>'});

// v10.2 Full cinematic experience + playlist
(function setupCinematicExperience(){
  const tracks = [
    {title:'ACDC - Highway to Hell', src:'media/acdc_highway_to_hell.mp3'},
    {title:'Beat It - Michael Jackson', src:'media/beat_it_michael_jackson.mp3'},
    {title:'Bee Gees - Night Fever', src:'media/bee_gees_night_fever.mp3'},
    {title:'Bruno Mars - 24K Magic', src:'media/bruno_mars_24k_magic.mp3'},
    {title:'Elvis Presley - Jailhouse Rock', src:'media/elvis_presley_jailhouse_rock.mp3'},
    {title:'Seal - Fly Like An Eagle (Space Jam Soundtrack)', src:'media/seal_fly_like_an_eagle.mp3'},
    {title:'88GLAM - Lil Boat', src:'media/88glam_lil_boat.mp3'},
    {title:'Eminem - Lose Yourself', src:'media/eminem_lose_yourself.mp3'},
    {title:"Post Malone - Hollywood's Bleeding", src:'media/post_malone_hollywoods_bleeding.mp3'},
    {title:'Post Malone - Motley Crew', src:'media/post_malone_motley_crew.mp3'},
    {title:'Post Malone - Congratulations', src:'media/post_malone_congratulations.mp3'},
    {title:'Rema - Calm Down', src:'media/rema_calm_down.mp3'},
    {title:'Fat Joe - Lean Back', src:'media/fat_joe_lean_back.mp3'},
    {title:'Spiderbait - Black Betty', src:'media/spiderbait_black_betty.mp3'},
    {title:'Akon - Smack That', src:'media/akon_smack_that.mp3'},
    {title:'Davido - Skelewu', src:'media/davido_skelewu.mp3'},
    {title:"Gerry & The Pacemakers - You'll Never Walk Alone", src:'media/gerry_youll_never_walk_alone.mp3'},
    {title:'Bracket - Mama Africa', src:'media/bracket_mama_africa.mp3'},
    {title:'GRITS - Ooh Ahh (My Life Be Like)', src:'media/grits_ooh_ahh.mp3'},
    {title:"Fort Minor - Where'd U Go", src:'media/fort_minor_whered_u_go.mp3'},
    {title:"Mario Winans - I Don't Wanna Know", src:'media/mario_winans_i_dont_wanna_know.mp3'},
    {title:'Rayvanny ft. Diamond Platnumz - Tetema', src:'media/rayvanny_tetema.mp3'},
    {title:'Lithe - Fall Back', src:'media/lithe_fall_back.mp3'},
    {title:'Melvoni ft. 21 Savage - Counting Sheep', src:'media/melvoni_counting_sheep.mp3'},
    {title:"Melvoni - No Man's Land", src:'media/melvoni_no_mans_land.mp3'},
    {title:'Ndotz & Dj Mac - Watch Me Now', src:'media/ndotz_watch_me_now.mp3'},
    {title:'Oualid - Jini ft. F1rstman', src:'media/oualid_jini.mp3'},
    {title:'Sani Knight - BADASF', src:'media/sani_knight_badasf.mp3'},
    {title:'1nonly & 870glizzy - CHUMPCHANGE', src:'media/1nonly_chumpchange.mp3'}
  ];  const moduleKeys = {narrative:'moduleNarrative', orderbooks:'moduleOrderbooks', timeline:'moduleTimeline', summary:'moduleSummary'};
  function buildTranslatedScenes(module='narrative'){
    const r = currentResult || calculate();
    const possible = items.filter(i=>i.enabled && !['confirmed_live','confirmed'].includes(i.evidence));
    if(module==='orderbooks') return [
      {chip:t('moduleOrderbooks'), theme:'market', title:t('orderbooksTitle'), text:t('orderbooksText'), bullets:[`${t('metricData')}: ${(books.mode||'').includes('live')?t('live'):t('baseData')}`, `${t('dynamicDepth')}: ${fmtUsd(r.depthDynamic,2)}`, `${t('stressSlippage')}: ${pct(r.slippage,2)}`], visual:'orderbooks'}
    ];
    if(module==='timeline') return buildTimelineProjection(r).map(y=>({chip:t('moduleTimeline'),theme:'infra',title:`${y.year} · ${fmtUsd(y.mkt,2)}`,text:y.note,bullets:[`${t('functionalPrice')}: ${fmtUsd(y.util,2)}`,`${t('marketSimPrice')}: ${fmtUsd(y.mkt,2)}`],visual:'timeline',years:buildTimelineProjection(r)}));
    if(module==='summary') return [
      {chip:t('moduleSummary'), theme:'market', title:t('pythonSimple'), text:t('simpleReading',{active:r.active.length,depth:fmtUsd(r.depthDynamic,2),slip:pct(r.slippage,2),tier:r.tier,mode:(books.mode||'').includes('live')?t('live'):t('baseData')}), bullets:[`${t('functionalPrice')}: ${fmtUsd(r.priceUtil,2)}`, `${t('marketSimPrice')}: ${fmtUsd(r.priceMarket,2)}`, `${t('estimatedTier')}: ${r.tier}`], visual:'summary'}
    ];
    return [
      {chip:t('step1'), theme:'problem', title:t('heroTitle'), text:t('heroLead'), bullets:[t('presStep1Text'),t('presStep2Text'),t('presStep3Text')], visual:'network'},
      {chip:t('infraMap'), theme:'infra', title:t('infraTitle'), text:t('infraText'), bullets:[t('crawlConfirmed')+': '+items.filter(i=>i.enabled&&i.evidence==='confirmed').slice(0,3).map(i=>i.name).join(' · '), t('crawlPilots')+': '+(possible.slice(0,3).map(i=>i.name).join(' · ')||t('crawlNone'))], visual:'network'},
      {chip:t('calcStep'), theme:'market', title:t('globalParams'), text:t('calcFine'), bullets:[`${t('functionalPrice')}: ${fmtUsd(r.priceUtil,2)}`,`${t('marketSimPrice')}: ${fmtUsd(r.priceMarket,2)}`,`${t('stressSlippage')}: ${pct(r.slippage,2)}`], visual:'summary'}
    ];
  }
  function buildDynamicScenes(module='narrative'){
    const ready = !!(registry && books && Array.isArray(items) && items.length);
    if (!ready) {
      return [{chip:'Iniciando', theme:'problem', title:'Cargando datos…', text:'El motor está preparando infraestructura, orderbooks y escenarios.', bullets:[], visual:'network'}];
    }
    const r = currentResult || calculate();
    const possible = items.filter(i=>i.enabled && !['confirmed_live','confirmed'].includes(i.evidence));
    const scKey = detectScenario(r);
    const sc86 = scenariosV86?.scenarios?.[scKey];
    const yrs86 = sc86?.years || {};
    const calib = scenariosV86?.calibration;
    const xrplBooks = scenariosV86?.xrpl_orderbooks?.live_pairs || [];
    const escrow = scenariosV86?.escrow;
    const tierSys = scenariosV86?.tier_system || {};

    // ── ORDERBOOKS MODULE ────────────────────────────────────────────────
    if (module==='orderbooks'){
      const cexBooks = (books.books||[]).filter(b=>!isDisplayAggregateRow(b) && b.depth_1pct_usd > 0).slice(0,5);
      const xrplActive = xrplBooks.filter(b=>b.depth_1pct_usd > 0);
      const totalDepth = cexBooks.reduce((s,b)=>s+(b.depth_1pct_usd||0),0);
      const xrplPrice = scenariosV86?.xrpl_orderbooks?.xrp_price_captured || 0;
      return [
        {chip:'CEX Live', theme:'market',
          title:`${cexBooks.length} exchanges activos • $${(totalDepth/1e6).toFixed(1)}M depth agregada`,
          text:`El simulador captura libros live de ${cexBooks.length} exchanges. El precio live capturado es $${xrplPrice.toFixed(4)}/XRP — a ${Math.abs(xrplPrice-1.41).toFixed(4)} del precio real ($1.41).`,
          bullets: cexBooks.map(b=>`${b.symbol} · ${b.venue || b.source || '?'} · Depth±1%: $${((b.depth_1pct_usd||0)/1e6).toFixed(2)}M · Spread: ${(b.spread_bps||0).toFixed(0)} bps`),
          visual:'orderbooks_cex'},
        {chip:'XRPL DEX', theme:'infra',
          title:'XRPL DEX activo: USD + RLUSD + EUR',
          text:'El XRPL DEX tiene libros reales para XRP/USD (Bitstamp/Gatehub) y XRP/RLUSD (Ripple). Los corredores BRL/MXN van por RippleNet privado, no por el DEX público.',
          bullets: [
            ...xrplActive.map(b=>`${b.symbol} · ${b.venue} · Spread: ${(b.spread_pct||0).toFixed(2)}% · Depth±1%: $${((b.depth_1pct_usd||0)/1e3).toFixed(0)}K`),
            'BRL/MXN: ODL usa RippleNet privado → no visible en DEX',
            'RLUSD: 0.03% spread — el libro más ajustado del XRPL'
          ],
          visual:'orderbooks_xrpl'},
        {chip:'Escenario', theme:'market',
          title:`Depth proyectada · ${sc86?.label || scKey}`,
          text:`Con el motor v8.6, la depth emerge del volumen × tier. En 2035 este escenario proyecta ${fmtUsd((yrs86['2035']?.depth_1pct||0)*1e6,1)} de profundidad — equivalente a ${yrs86['2035']?.hqla || '—'}.`,
          bullets:[
            `2026: $${(yrs86['2026']?.depth_1pct||0).toFixed(0)}M depth · Slip $100M: ${(yrs86['2026']?.slip_100m||0).toFixed(1)}%`,
            `2029: $${((yrs86['2029']?.depth_1pct||0)/1e3).toFixed(1)}B depth · Slip $100M: ${(yrs86['2029']?.slip_100m||0).toFixed(2)}%`,
            `2035: $${((yrs86['2035']?.depth_1pct||0)/1e3).toFixed(1)}B depth · Slip $100M: ${(yrs86['2035']?.slip_100m||0).toFixed(2)}%`
          ],
          visual:'orderbooks',
          years: buildTimelineProjection(r)}
      ];
    }

    // ── TIMELINE MODULE ──────────────────────────────────────────────────
    if (module==='timeline'){
      const years = buildTimelineProjection(r);
      return [
        {chip:'Calibración', theme:'market',
          title:`Hoy: P_util $${calib?.today_confirmed_2026?.p_util || 1.19} · P_mkt $${calib?.today_confirmed_2026?.p_mkt_model || 1.54} · Real $1.41`,
          text:`El motor v8.6 calcula un precio de utilidad de $${calib?.today_confirmed_2026?.p_util || 1.19} y un precio de mercado de $${calib?.today_confirmed_2026?.p_mkt_model || 1.54} — un gap del ${calib?.today_confirmed_2026?.gap_pct || 9}% respecto al real ($1.41). ${calib?.today_confirmed_2026?.note_es || ''}`,
          bullets:[
            `P_utilidad (equilibrio): $${calib?.today_confirmed_2026?.p_util || 1.19}`,
            `P_mercado modelo: $${calib?.today_confirmed_2026?.p_mkt_model || 1.54}`,
            `P_mercado real: $1.41 · Gap: ${calib?.today_confirmed_2026?.gap_pct || 9}%`
          ], visual:'summary', years},
        ...years.map((y,idx)=>({
          chip: `${y.tier || y.year}`,
          theme: idx===0?'market': idx<2?'infra':'problem',
          title: `${y.year} · P_util $${(y.util||0).toFixed(2)} · P_mkt $${(y.mkt||0).toFixed(2)}`,
          text: y.note + (y.hqla ? ` Clasificación: ${y.hqla}.` : ''),
          bullets:[
            `Precio funcional: $${(y.util||0).toFixed(2)}`,
            `Precio mercado: $${(y.mkt||0).toFixed(2)}`,
            y.depth ? `Depth ±1%: $${(y.depth/1e3).toFixed(1)}B · Slip $100M: ${(y.slip||0).toFixed(2)}%` : `Tier: ${y.tier || '—'}`
          ], visual:'timeline', years})),
        {chip:'CLARITY', theme:'infra',
          title:`CLARITY Act: ${calib?.clarity_repricing?.multiplier || 6.4}× repricing`,
          text:`Sin CLARITY (status_quo 2026): $${calib?.clarity_repricing?.without_clarity_2026 || 1.80}. Con CLARITY: $${calib?.clarity_repricing?.with_clarity_2026 || 11.56}. Múltiplo ${calib?.clarity_repricing?.multiplier || 6.4}×. ${calib?.clarity_repricing?.note_es || ''}`,
          bullets:[
            `Sin CLARITY: $${calib?.clarity_repricing?.without_clarity_2026 || 1.80}`,
            `Con CLARITY: $${calib?.clarity_repricing?.with_clarity_2026 || 11.56}`,
            `Prima regulatoria añadida: +${calib?.clarity_repricing?.premium_regulatory_delta_pp || 58}pp`
          ], visual:'summary', years}
      ];
    }

    // ── SUMMARY MODULE ───────────────────────────────────────────────────
    if (module==='summary'){
      const years = buildTimelineProjection(r);
      const currentTierData = tierSys[String(r.tier?.split('·')[0]?.replace('T','').trim() || 2)] || {};
      return [
        {chip:'Resumen', theme:'market',
          title:`Motor v8.6 · ${sc86?.label || 'Escenario actual'}`,
          text:`P_util: $${(r.priceUtil||0).toFixed(2)} · P_mkt: $${(r.priceMarket||0).toFixed(2)} · ${r.tier} · Depth: $${fmtUsd(r.depthDynamic,1)}`,
          bullets:[
            `Flujo directo XRP: ${fmtUsd(r.direct,2)}/año`,
            `Profundidad dinámica: $${fmtUsd(r.depthDynamic,1)} (HQLA: ${currentTierData.hqla || '—'})`,
            `Slippage $${state.orderM}M: ${pct(r.slippage,2)}`
          ], visual:'summary', years},
        {chip:'Escrow', theme:'infra',
          title:'El escrow de Ripple: sistema de renovación perpetua',
          text: escrow?.mechanism_es || 'Ripple libera 1B XRP/mes pero re-bloquea 86-95% en contratos nuevos de 54+ meses.',
          bullets:[
            `Net real al mercado: 47-200M XRP/mes (no 1B/mes)`,
            `Escrow estimado 2035: ~${((escrow?.escrow_2035_est||32e9)/1e9).toFixed(0)}B XRP`,
            escrow?.self_regulating_es?.slice(0,80) || 'Sistema auto-regulador: precio alto = menos presión'
          ], visual:'summary', years},
        {chip:'Tiers', theme:'problem',
          title:'Nomenclatura oficial: T0·Especulativo → T5·Reserve Asset',
          text:'Los tiers mapean con HQLA del BIS/Basel III. XRP hoy está en T2·Bridge activo ($18.5B/año ODL real). CLARITY Act activa la transición a T3-T4.',
          bullets: Object.entries(tierSys).map(([k,v])=>`${v.label}: ${v.hqla}`),
          visual:'summary', years}
      ];
    }

    // ── NARRATIVE MODULE (default) ───────────────────────────────────────
    const scLabel = sc86?.label || 'Escenario actual';
    const year26 = yrs86['2026'] || {};
    const year35 = yrs86['2035'] || {};

    const base = [
      {chip:'Problema', theme:'problem',
        title:'El dinero global todavía mueve fricción real.',
        text:'Nostro/vostro bloquea $5T en liquidez atrapada. Settlements no son instantáneos. Remesas cobran 5-8% de fees. Los corredores de divisas emergentes tienen spreads de 1-3%.',
        bullets:['$1.8T en capital bancario bloqueado en cuentas nostro/vostro.','5-7 días para settlements cross-border en algunos corredores.','Remesas: $700B/año globales · 5-8% de costo promedio.'], visual:'network'},

      {chip:'Infraestructura Ripple', theme:'infra',
        title:'Ripple ya es una pila institucional, no solo un puente de pagos.',
        text:`El modelo integra ${items.length} piezas: Payments, RLUSD, Prime/Hidden Road, Custody, Treasury, Rail, Brasil, México, APAC, Corea, tokenización y pilotos. ${r.active.length} activas ahora.`,
        bullets:[
          `${items.filter(i=>i.enabled&&['confirmed_live','confirmed'].includes(i.evidence)).length} piezas confirmadas activas.`,
          `${possible.length} hipótesis/pilotos activos — peso menor pero incluidos.`,
          `${r.coupledItems} piezas acopladas a módulos de infraestructura (RLUSD, Prime, Custody, Treasury).`
        ], visual:'network'},

      {chip:'Motor v8.6', theme:'market',
        title:`P_utilidad = V / (M × R^0.72) · Escenario: ${scLabel}`,
        text:`Flujo directo XRP ${fmtUsd(r.direct,2)}/año · Float efectivo ${(state.floatB).toFixed(2)}B XRP · Rotación ${r.effectiveRotation.toFixed(1)}x. Precio funcional: ${fmtUsd(r.priceUtil,2)}. Con prima ${r.premiumTotal.toFixed(0)}%: ${fmtUsd(r.priceMarket,2)}.`,
        bullets:[
          `Flujo directo XRP: ${fmtUsd(r.direct,2)}/año`,
          `Rotación efectiva: ${r.effectiveRotation.toFixed(1)}x · Float: ${state.floatB}B XRP`,
          `P_util: ${fmtUsd(r.priceUtil,2)} · Prima: +${r.premiumTotal.toFixed(0)}% · P_mkt: ${fmtUsd(r.priceMarket,2)}`
        ], visual:'network'},

      {chip:'Escenario v8.6', theme:'infra',
        title:`${scLabel} · 2026→2035`,
        text: sc86?.note_es || `Con la adopción actual, el modelo proyecta ${fmtUsd(r.priceMarket,2)} en 2026 y ${fmtUsd(year35.p_mkt||0,2)} en 2035.`,
        bullets:[
          `2026: ${year26.tier_label || '—'} · P_util $${year26.p_util||'?'} · P_mkt $${year26.p_mkt||'?'}`,
          `2035: ${year35.tier_label || '—'} · P_util $${year35.p_util||'?'} · P_mkt $${year35.p_mkt||'?'}`,
          `HQLA actual: ${year26.hqla || '—'} → ${year35.hqla || '—'}`
        ], visual:'timeline', years: buildTimelineProjection(r)},

      {chip:'Orderbooks', theme:'market',
        title:`${(books.books||[]).filter(b=>!isDisplayAggregateRow(b) && b.depth_1pct_usd>0).length} exchanges · $${((r.depthDynamic||0)/1e6).toFixed(1)}M depth dinámica`,
        text:`Profundidad base ${fmtUsd(r.book?.depth1||0,1)} · Multiplicador Prime/RLUSD/Custody: ${(r.infraDepthBoost||1).toFixed(2)}x · Slippage $100M: ${pct(r.slippage,2)}.`,
        bullets:[
          ...(books.books||[]).filter(b=>!isDisplayAggregateRow(b) && b.depth_1pct_usd>0).slice(0,3).map(b=>`${b.symbol} · $${((b.depth_1pct_usd||0)/1e6).toFixed(2)}M depth · ${(b.spread_bps||0).toFixed(0)} bps`),
          `XRPL: XRP/USD Bitstamp $1.4M · XRP/RLUSD 0.03% spread`,
        ], visual:'orderbooks_cex'},

      {chip:'Escrow', theme:'infra',
        title:'Ripple escrow: 1B/mes liberado, 86-95% re-bloqueado.',
        text: escrow?.mechanism_es || 'Sistema de renovación perpetua: net real al mercado solo 47-200M XRP/mes.',
        bullets:[
          `Net real: 47-200M XRP/mes (no 1B/mes como se asume)`,
          `En 2035 quedan ~32B XRP en escrow (contratos 54+ meses)`,
          escrow?.self_regulating_es?.slice(0,90) || 'Sistema auto-regulador'
        ], visual:'summary', years: buildTimelineProjection(r)},

      {chip:'No linealidad', theme:'problem',
        title:'El salto ocurre si XRP pasa de bridge a colateral.',
        text:'Bridge de alta rotación: mismo XRP mueve mucho volumen sin precio extremo. Colateral retenido: float vendedor baja, precio funcional sube no-linealmente.',
        bullets:[
          `T2·Bridge (hoy): rotación ${r.effectiveRotation.toFixed(0)}x/año · P_util: ${fmtUsd(r.priceUtil,2)}`,
          `T4·Prime (post-CLARITY): rotación ~15-25x · P_util: $20-42`,
          `T5·Reserve: rotación ~10x · P_util: $88-440 según escenario`
        ], visual:'network'},

      {chip:'Brújula', theme:'problem',
        title:'No es una promesa. Es una brújula de condiciones.',
        text:'El objetivo no es decir "XRP valdrá X". Es medir qué infraestructura, adopción y liquidez deberían aparecer para justificar cada rango de valoración.',
        bullets:[
          `Calibración: motor v8.6 da $1.19 util / $1.54 mkt vs $1.41 real (gap 9%).`,
          `CLARITY repricing: sin $1.80 → con $11.56 (6.4×).`,
          `NO predicción. NO asesoramiento financiero.`
        ], visual:'summary', years: buildTimelineProjection(r)}
    ];

    if (possible.length){
      base.splice(2, 0, {chip:'Hipótesis activas', theme:'infra',
        title:`${possible.length} piezas no confirmadas activas en tu escenario.`,
        text:'El escenario final las incorpora porque forman parte del escenario que estás explorando, pero con peso reducido.',
        bullets:[
          possible.slice(0,5).map(i=>i.name).join(' · '),
          'Confirmado pesa más que piloto. Piloto pesa más que especulativo.',
          `Piezas confirmadas activas: ${items.filter(i=>i.enabled&&['confirmed_live','confirmed'].includes(i.evidence)).length}`
        ], visual:'network'});
    }

    return base;
  }

  let trackIndex = 0;
  let sceneIndex = 0;
  let currentScenes = [];
  let sceneTimer = null;
  let paused = false;
  const audio = new Audio(tracks[trackIndex].src);
  audio.preload = 'metadata';
  audio.loop = false;
  audio.volume = 0.62;

  const $ = id => document.getElementById(id);
  const player = $('audioPlayer');
  const toggle = $('toggleAudio');
  const title = $('trackTitle');
  const counter = $('trackCounter');
  const modal = $('introModal');
  const overlay = $('cinematicOverlay');

  function updateTrackUI(){
    if (title) title.textContent = tracks[trackIndex].title;
    if (counter) counter.textContent = `${trackIndex + 1} / ${tracks.length}`;
  }
  updateTrackUI(); // initialize title on load

  function setTrack(i, autoPlay=true){
    trackIndex = (i + tracks.length) % tracks.length;
    audio.src = tracks[trackIndex].src;
    updateTrackUI();
    if (autoPlay) tryPlay();
  }
  function updateAudioUI(){
    if (!player || !toggle) return;
    player.classList.toggle('paused', audio.paused);
    toggle.textContent = audio.paused ? t('play') : t('pause');
  }
  async function tryPlay(){
    try { await audio.play(); updateAudioUI(); return true; }
    catch (err) { updateAudioUI(); return false; }
  }
  function pauseAudio(){ audio.pause(); updateAudioUI(); }
  audio.addEventListener('ended',()=>setTrack(trackIndex+1,true));
  audio.addEventListener('play',updateAudioUI);
  audio.addEventListener('pause',updateAudioUI);

  $('toggleAudio')?.addEventListener('click',()=> audio.paused ? tryPlay() : pauseAudio());
  $('prevTrack')?.addEventListener('click',()=>setTrack(trackIndex-1,true));
  $('nextTrack')?.addEventListener('click',()=>setTrack(trackIndex+1,true));

  function closeModal(){ modal?.classList.add('hidden'); }
  function updateAcceptState(){
    const cb = $('acceptCheck');
    const ok = cb ? cb.checked : true;
    [$('enterWithMusic'),$('enterSilent')].forEach(btn=>{ if(btn) btn.disabled=!ok; });
  }
  $('acceptCheck')?.addEventListener('change', updateAcceptState);
  updateAcceptState();
  $('enterWithMusic')?.addEventListener('click',async()=>{ if(!($('acceptCheck')?.checked??true)) return; closeModal(); await tryPlay(); });
  $('enterSilent')?.addEventListener('click',()=>{ if(!($('acceptCheck')?.checked??true)) return; closeModal(); pauseAudio(); });
  $('openIntro')?.addEventListener('click',()=> modal?.classList.remove('hidden'));
  $('openPresentation')?.addEventListener('click',()=> openPresentation());
  $('openPresentationHero')?.addEventListener('click',()=> openPresentation());

  function buildPresentationMarkup(){
    const confirmed = items.filter(i=>i.enabled && i.evidence==='confirmed').slice(0,8).map(i=>i.name);
    const pilots = items.filter(i=>i.enabled && i.evidence!=='confirmed').slice(0,8).map(i=>i.name);
    const categories = [...new Set(items.map(i=>i.category).filter(Boolean))].slice(0,8);
    const companies = ['Ripple Payments','RLUSD','XRPL DEX/AMM','Ripple Prime / Hidden Road','Ripple Custody','Ripple Treasury','Bitso','Tranglo','SBI Remit','Unicâmbio','DBS','Franklin Templeton'];
    return `
      <div class="crawl-kicker">XRP Simulator</div>
      <h2>${t('crawlTitle')}</h2>
      <p>${t('crawlP1')}</p>
      <p>${t('crawlP2')}</p>
      <ul>
        <li><b>${t('crawlIntegrates')}</b> ${companies.join(' · ')}.</li>
        <li><b>${t('crawlTypes')}</b> ${categories.join(' · ')}.</li>
        <li><b>${t('crawlConfirmed')}</b> ${confirmed.length ? confirmed.join(' · ') : t('crawlNone')}.</li>
        <li><b>${t('crawlPilots')}</b> ${pilots.length ? pilots.join(' · ') : t('crawlNone')}.</li>
      </ul>
      <p>${t('crawlP3')}</p>
      <p>${t('crawlP4')}</p>
      <p><b>${t('crawlIdea')}</b> ${t('crawlIdeaText')}</p>
    `;
  }

  function openPresentation(){
    const overlay = $('crawlOverlay');
    const content = $('crawlContent');
    const track = $('crawlTrack');
    if (!overlay || !content || !track) return;
    content.innerHTML = buildPresentationMarkup();
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden','false');
    document.body.classList.add('cinema-lock');
    track.classList.remove('auto');
    track.scrollTop = 0;
    requestAnimationFrame(()=> track.classList.add('auto'));
  }
  function closePresentation(){
    const overlay = $('crawlOverlay');
    const track = $('crawlTrack');
    overlay?.classList.add('hidden');
    overlay?.setAttribute('aria-hidden','true');
    track?.classList.remove('auto');
    document.body.classList.remove('cinema-lock','presentation');
  }
  $('closeCrawl')?.addEventListener('click',()=> closePresentation());
  $('skipToCalculator')?.addEventListener('click',()=>{ closePresentation(); document.getElementById('simulador')?.scrollIntoView({behavior:'smooth', block:'start'}); });

  function renderScene(i){
    sceneIndex = (i + currentScenes.length) % currentScenes.length;
    const s = currentScenes[sceneIndex];
    if ($('sceneNumber')) $('sceneNumber').textContent = `Escena ${sceneIndex+1}/${currentScenes.length}`;
    if ($('sceneTitle')) $('sceneTitle').textContent = s.title;
    if ($('sceneText')) $('sceneText').textContent = s.text;
    document.querySelectorAll('#sceneDots button').forEach((b,idx)=>b.classList.toggle('active',idx===sceneIndex));
    if ($('cinemaModuleLabel')) $('cinemaModuleLabel').textContent = t(moduleKeys[state.cinematicModule] || 'moduleNarrative');
    renderCinematicVisual(s);

    if ($('cinemaCounter')) $('cinemaCounter').textContent = `Escena ${sceneIndex+1}/${currentScenes.length}`;
    if ($('cinemaChip')) $('cinemaChip').textContent = s.chip;
    if ($('cinemaTitle')) $('cinemaTitle').textContent = s.title;
    if ($('cinemaText')) $('cinemaText').textContent = s.text;
    if ($('cinemaBullets')) $('cinemaBullets').innerHTML = (s.bullets||[]).map(x=>`<div>${x}</div>`).join('');
    if ($('cinemaProgress')) $('cinemaProgress').style.width = `${((sceneIndex+1)/currentScenes.length)*100}%`;
    if (overlay) {
      overlay.classList.remove('scene-problem','scene-infra','scene-market');
      overlay.classList.add(`scene-${s.theme}`);
    }
  }
  function renderCinematicVisual(scene){
    const el = $('cinematicVisual'); if (!el) return;
    const years = scene.years || buildTimelineProjection(currentResult || calculate());
    const r = currentResult || calculate();

    // CEX orderbooks: show all active exchanges
    if (scene.visual==='orderbooks_cex'){
      const b = (books.books||[]).filter(bk=>!isDisplayAggregateRow(bk) && bk.depth_1pct_usd>0).slice(0,6);
      const maxD = Math.max(...b.map(bk=>bk.depth_1pct_usd||0),1);
      el.innerHTML = `<div class="book-cinema">
        <div class="book-header">CEX Live · ${b.length} exchanges</div>
        ${b.map(bk=>`<div class="book-row">
          <span>${bk.symbol}</span>
          <div class="book-bar"><i style="width:${clamp((bk.depth_1pct_usd||0)/maxD*100,4,100)}%"></i></div>
          <b>$${((bk.depth_1pct_usd||0)/1e6).toFixed(2)}M</b>
        </div>`).join('')}
        <div class="book-meta">Depth dinámica (con Prime+RLUSD): <b>${fmtUsd(r.depthDynamic,2)}</b></div>
      </div>`;
      return;
    }

    // XRPL DEX orderbooks
    if (scene.visual==='orderbooks_xrpl'){
      const xrplPairs = scenariosV86?.xrpl_orderbooks?.live_pairs || [];
      const disabled  = scenariosV86?.xrpl_orderbooks?.disabled_pairs || [];
      const price = scenariosV86?.xrpl_orderbooks?.xrp_price_captured || 0;
      el.innerHTML = `<div class="book-cinema">
        <div class="book-header">XRPL DEX · Price: $${price.toFixed(4)}</div>
        ${xrplPairs.map(p=>`<div class="book-row active">
          <span>${p.symbol}</span>
          <div class="book-bar"><i style="width:${clamp((p.depth_1pct_usd||0)/2e6*100,4,100)}%"></i></div>
          <b>${p.spread_pct != null ? p.spread_pct.toFixed(2)+'% spread' : '$'+((p.depth_1pct_usd||0)/1e3).toFixed(0)+'K'}</b>
        </div>`).join('')}
        ${disabled.map(p=>`<div class="book-row disabled">
          <span>${p.symbol}</span><i style="opacity:.4">${p.status}</i>
        </div>`).join('')}
      </div>`;
      return;
    }

    // Classic orderbooks view
    if (scene.visual==='orderbooks'){
      const b=(books.books||[]).slice(0,4);
      el.innerHTML = `<div class="book-cinema">${b.map(row=>`<div class="book-row"><span>${row.symbol}</span><div class="book-bar"><i style="width:${clamp((row.depth_1pct_usd||0)/2000000,8,100)}%"></i></div><b>${fmtUsd(row.depth_1pct_usd,1)}</b></div>`).join('')}<div class="book-meta">Depth dinámica actual: <b>${fmtUsd(r.depthDynamic,2)}</b></div></div>`;
      return;
    }

    // Timeline with v8.6 data
    if (scene.visual==='timeline'){
      const max = Math.max(...years.map(y=>y.mkt||y.util||0), 1);
      el.innerHTML = `<div class="timeline-cinema">
        ${years.map(y=>`<div class="timeline-col">
          <small>${y.year}</small>
          <div class="timeline-bar"><i style="height:${20+((y.mkt||0)/max*150)}px"></i></div>
          <b>${fmtUsd(y.mkt||0,1)}</b>
          ${y.tier ? `<span class="tier-badge">${y.tier}</span>` : ''}
        </div>`).join('')}
      </div>`;
      return;
    }

    // Summary with calibration
    if (scene.visual==='summary'){
      const calib = scenariosV86?.calibration;
      el.innerHTML = `<div class="summary-cinema">
        <div><span>P_util (motor v8.6)</span><b>${fmtUsd(r.priceUtil,2)}</b></div>
        <div><span>P_mercado modelo</span><b>${fmtUsd(r.priceMarket,2)}</b></div>
        <div><span>P_real hoy</span><b>${books?.xrp_price_usd ? '$'+(books.xrp_price_usd).toFixed(4) : '—'}</b></div>
        <div><span>Depth ±1%</span><b>${fmtUsd(r.depthDynamic,2)}</b></div>
        <div><span>Slip $100M</span><b>${pct(r.slippage,2)}</b></div>
        <div><span>Tier actual</span><b>${r.tier || '—'}</b></div>
      </div>`;
      return;
    }

    // Default: animated network
    el.innerHTML = `<div class="rail-line rail-a"></div><div class="rail-line rail-b"></div>
      <div class="cinema-node n1">FIAT</div>
      <div class="cinema-node n2">RLUSD</div>
      <div class="cinema-node n3">XRPL DEX</div>
      <div class="cinema-node n4">XRP</div>
      <div class="cinema-node n5">CEX</div>
      <div class="flow-particle p1"></div>
      <div class="flow-particle p2"></div>
      <div class="flow-particle p3"></div>`;
  }
  function initDots(){
    const dots = $('sceneDots');
    if (!dots) return;
    currentScenes = buildDynamicScenes(state.cinematicModule);
    if (!currentScenes.length) currentScenes = [{chip:'Inicio', theme:'problem', title:'Cargando…', text:'Preparando escenas.', bullets:[], visual:'network'}];
    dots.innerHTML = currentScenes.map((_,i)=>`<button aria-label="Escena ${i+1}"></button>`).join('');
    dots.querySelectorAll('button').forEach((b,i)=>b.addEventListener('click',()=>{stopScenes();renderScene(i);}));
    renderScene(0);
  }
  function stopScenes(){ if(sceneTimer){ clearInterval(sceneTimer); sceneTimer=null; } }
  function startAuto(){
    stopScenes(); paused=false;
    if ($('cinemaPause')) $('cinemaPause').textContent = t('pause');
    sceneTimer = setInterval(()=>renderScene(sceneIndex+1), 8600);
  }
  function openCinema(module=state.cinematicModule, forceRebuild=false){
    state.cinematicModule = module || state.cinematicModule;
    document.querySelectorAll('.cinema-module-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.module===state.cinematicModule));
    if (forceRebuild || !currentScenes?.length) currentScenes = buildDynamicScenes(state.cinematicModule);
    initDots();
    document.body.classList.add('cinema-lock','presentation');
    overlay?.classList.remove('hidden');
    overlay?.setAttribute('aria-hidden','false');
    renderScene(0);
    startAuto();
    tryPlay();
  }
  function closeCinema(){
    stopScenes();
    overlay?.classList.add('hidden');
    overlay?.setAttribute('aria-hidden','true');
    document.body.classList.remove('cinema-lock','presentation');
  }
  function toggleCinemaPause(){
    if (sceneTimer) { stopScenes(); paused=true; if ($('cinemaPause')) $('cinemaPause').textContent=(state.lang==='es'?'Continuar':state.lang==='en'?'Continue':state.lang==='ja'?'続ける':'계속'); }
    else { startAuto(); }
  }
  window.__openCinemaModule = openCinema;
  window.__refreshCinemaIfOpen = ()=>{ if (!overlay?.classList.contains('hidden')) openCinema(state.cinematicModule, true); };
  $('playCinematic')?.addEventListener('click',()=>openCinema(state.cinematicModule,true));
  $('cinemaBtn')?.addEventListener('click',()=>openCinema(state.cinematicModule,true));
  $('cinemaClose')?.addEventListener('click',closeCinema);
  $('cinemaPause')?.addEventListener('click',toggleCinemaPause);
  $('cinemaPrev')?.addEventListener('click',()=>{stopScenes();renderScene(sceneIndex-1);});
  $('cinemaNext')?.addEventListener('click',()=>{stopScenes();renderScene(sceneIndex+1);});
  document.addEventListener('keydown',e=>{
    if (!$('crawlOverlay')?.classList.contains('hidden') && e.key==='Escape') { closePresentation(); return; }
    if (overlay?.classList.contains('hidden')) return;
    if (e.key==='Escape') closeCinema();
    if (e.key==='ArrowRight') {stopScenes();renderScene(sceneIndex+1);}
    if (e.key==='ArrowLeft') {stopScenes();renderScene(sceneIndex-1);}
    if (e.key===' ') {e.preventDefault();toggleCinemaPause();}
  });

  // Try to start as soon as possible. Browsers may block sound until a tap/click.
  setTimeout(()=>{ tryPlay(); }, 350);
  initDots();
  updateAudioUI();
})();
