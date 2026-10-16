/**
 * assets:sync-pokemon
 * 从 PokéAPI 拉取全国图鉴元数据（编号 / 中文名 / 属性 / 世代 / 进化链 / 形态 / 稀有度标记）。
 * 输出：src/data/pokemon/pokedex.json, src/data/pokemon/evolution-chains.json, pokedex-meta.json
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SOURCES,
  DATA_DIR,
  LOG_DIR,
  RunLog,
  ensureDir,
  fetchJson,
  log,
  mapLimit,
  writeJson,
  spriteUrl,
  LICENSE_NOTES,
} from './lib.mjs';

const GEN_MAP = {
  'generation-i': 1,
  'generation-ii': 2,
  'generation-iii': 3,
  'generation-iv': 4,
  'generation-v': 5,
  'generation-vi': 6,
  'generation-vii': 7,
  'generation-viii': 8,
  'generation-ix': 9,
};

const GEN_ZH = {
  1: '第一世代', 2: '第二世代', 3: '第三世代', 4: '第四世代', 5: '第五世代',
  6: '第六世代', 7: '第七世代', 8: '第八世代', 9: '第九世代',
};

const TYPE_ZH = {
  normal: '一般', fire: '火', water: '水', electric: '电', grass: '草', ice: '冰',
  fighting: '格斗', poison: '毒', ground: '地面', flying: '飞行', psychic: '超能力',
  bug: '虫', rock: '岩石', ghost: '幽灵', dragon: '龙', dark: '恶', steel: '钢', fairy: '妖精',
};

function pickZhName(species) {
  const names = species.names || [];
  const lang = (n) => n.language.name.toLowerCase();
  const candidates = [
    ...names.filter((n) => lang(n) === 'zh-hans'),
    ...names.filter((n) => lang(n) === 'zh-hant'),
    ...names.filter((n) => lang(n) === 'zh'),
  ];
  if (candidates.length) return candidates[0].name;
  const ja = names.find((n) => lang(n) === 'ja-hrkt' || lang(n) === 'ja');
  return ja ? ja.name : species.name;
}

function pickEnName(species) {
  const n = (species.names || []).find((x) => x.language.name.toLowerCase() === 'en');
  return n ? n.name : species.name;
}

function summarizeTrigger(detail) {
  if (!detail) return { kind: 'unknown' };
  const out = { kind: detail.trigger?.name ?? 'unknown' };
  if (detail.min_level) out.level = detail.min_level;
  if (detail.item) out.item = detail.item.name;
  if (detail.held_item) out.heldItem = detail.held_item.name;
  if (detail.time_of_day) out.timeOfDay = detail.time_of_day;
  if (detail.min_happiness) out.happiness = detail.min_happiness;
  if (detail.known_move) out.knownMove = detail.known_move.name;
  if (detail.known_move_type) out.knownMoveType = detail.known_move_type.name;
  if (detail.location) out.location = detail.location.name;
  if (detail.trade_species) out.tradeFor = detail.trade_species.name;
  if (detail.relative_physical_stats !== null && detail.relative_physical_stats !== undefined) {
    out.relativeStats = detail.relative_physical_stats;
  }
  if (detail.needs_overworld_rain) out.rain = true;
  if (detail.turn_upside_down) out.upsideDown = true;
  return out;
}

/** 把 PokéAPI 的进化链递归结构转成带 stage / evolvesFrom 的树 */
function buildChainTree(node) {
  const id = Number(node.species.url.split('/').filter(Boolean).pop());
  return {
    id,
    name: node.species.name,
    trigger: node.evolution_details?.length ? summarizeTrigger(node.evolution_details[0]) : null,
    stage: 0,
    evolvesFrom: null,
    children: (node.evolves_to || []).map(buildChainTree),
  };
}

function indexChain(root) {
  const index = new Map();
  const walk = (n, depth, parentId) => {
    n.stage = depth;
    n.evolvesFrom = parentId;
    index.set(n.id, n);
    for (const c of n.children) walk(c, depth + 1, n.id);
  };
  walk(root, 1, null);
  return index;
}

function serializeNode(n) {
  return {
    id: n.id,
    name: n.name,
    stage: n.stage,
    evolvesFrom: n.evolvesFrom,
    trigger: n.trigger,
    children: n.children.map(serializeNode),
  };
}

const FORM_SUFFIX_ZH = {
  mega: '超级进化', 'mega-x': '超级进化X', 'mega-y': '超级进化Y', gmax: '超极巨化',
  alola: '阿罗拉形态', galar: '伽勒尔形态', hisui: '洗翠形态', paldea: '帕底亚形态',
  origin: '起源形态', altered: '别种形态', attack: '攻击形态', defense: '防御形态',
  speed: '速度形态', therian: '灵兽形态', incarnate: '化身形态', black: '黑', white: '白',
  zen: '达摩模式', resolute: '觉悟形态', pirouette: '舞步形态', blade: '刀剑形态',
  shield: '盾牌形态', complete: '完全体形态', crowned: '王者形态', eternamax: '无尽巨化',
  primal: '原始回归', unbound: '解放形态', ultra: '究极形态', dawn: '拂晓之翼',
  dusk: '黄昏之鬃', midday: '白昼形态', midnight: '黑夜形态', wellspring: '水井面具',
  hearthflame: '炉火面具', cornerstorn: '基石面具', teal: '碧草面具', starter: '搭档形态',
  '10': '10% 形态', '50': '50% 形态', 'baile': '热辣热辣风格', 'pom-pom': '啪啪啪风格',
  'pa-u': '呼啦呼啦风格', 'sensu': '飘飘然风格', 'noice': '浓密胡须',
};

function formLabel(slug, baseSlug) {
  if (slug === baseSlug) return '默认形态';
  const suffix = slug.slice(baseSlug.length + 1);
  if (!suffix) return '默认形态';
  return FORM_SUFFIX_ZH[suffix] ?? suffix.replace(/-/g, ' ');
}

export async function syncPokedex() {
  const runLog = new RunLog('sync-pokemon');
  ensureDir(LOG_DIR);
  log('读取 species 列表...');

  const list = await fetchJson(`${SOURCES.pokeapi}/pokemon-species?limit=2000`);
  const refs = list.results
    .map((r) => ({ id: Number(r.url.split('/').filter(Boolean).pop()), name: r.name }))
    .sort((a, b) => a.id - b.id);

  log(`共 ${refs.length} 个 species 条目，开始拉取详情...`);

  const speciesData = await mapLimit(refs, 24, async (ref) => {
    const s = await fetchJson(`${SOURCES.pokeapi}/pokemon-species/${ref.id}`);
    if (!s) {
      runLog.error('species 404', { id: ref.id });
      return null;
    }
    return {
      id: s.id,
      slug: s.name,
      nameZh: pickZhName(s),
      nameEn: pickEnName(s),
      generation: GEN_MAP[s.generation?.name] ?? 0,
      generationName: GEN_ZH[GEN_MAP[s.generation?.name]] ?? '未知',
      color: s.color?.name ?? 'unknown',
      isLegendary: !!s.is_legendary,
      isMythical: !!s.is_mythical,
      isBaby: !!s.is_baby,
      captureRate: s.capture_rate,
      habitat: s.habitat?.name ?? null,
      shape: s.shape?.name ?? null,
      evolutionChainUrl: s.evolution_chain?.url ?? null,
      varieties: (s.varieties || []).map((v) => ({ slug: v.pokemon.name, isDefault: v.is_default })),
      flavor:
        (s.flavor_text_entries || [])
          .filter((f) => ['zh-hans', 'zh-hant', 'zh'].includes(f.language.name.toLowerCase()))
          .slice(-1)
          .map((f) => f.flavor_text.replace(/\s+/g, ''))[0] ?? null,
    };
  });
  const species = speciesData.filter(Boolean);
  log(`species 详情完成：${species.length}`);

  /* ---------------- 进化链 ---------------- */
  const chainUrls = [...new Set(species.map((s) => s.evolutionChainUrl).filter(Boolean))];
  log(`开始拉取 ${chainUrls.length} 条进化链...`);
  const chainsRaw = await mapLimit(chainUrls, 20, async (url) => {
    const c = await fetchJson(url);
    if (!c) {
      runLog.error('evolution-chain 404', { url });
      return null;
    }
    const root = buildChainTree(c.chain);
    const index = indexChain(root);
    return { id: c.id, url, root, index };
  });
  const chains = chainsRaw.filter(Boolean);
  const chainByUrl = new Map(chains.map((c) => [c.url, c]));

  /* ---------------- 形态战斗数据 ---------------- */
  const varietyRefs = [];
  for (const s of species) {
    for (const v of s.varieties) varietyRefs.push({ speciesId: s.id, slug: v.slug, isDefault: v.isDefault });
  }
  log(`拉取 ${varietyRefs.length} 个形态的战斗数据...`);
  const pokemonRaw = await mapLimit(varietyRefs, 24, async (v) => {
    const p = await fetchJson(`${SOURCES.pokeapi}/pokemon/${v.slug}`);
    if (!p) {
      runLog.warn('pokemon 404', v);
      return null;
    }
    return { speciesId: v.speciesId, isDefault: v.isDefault, data: p };
  });
  const pokemonBySlug = new Map();
  for (const item of pokemonRaw.filter(Boolean)) pokemonBySlug.set(item.data.name, item.data);
  log(`形态战斗数据完成：${pokemonBySlug.size}`);

  /* ---------------- 组装图鉴 ---------------- */
  const dex = {};
  const missingForms = [];

  for (const s of species) {
    const chain = s.evolutionChainUrl ? chainByUrl.get(s.evolutionChainUrl) : null;
    const node = chain ? chain.index.get(s.id) ?? null : null;

    const forms = [];
    for (const v of s.varieties) {
      const p = pokemonBySlug.get(v.slug);
      if (!p) continue;
      forms.push({
        slug: v.slug,
        isDefault: v.isDefault,
        formId: p.id,
        label: formLabel(v.slug, s.slug),
        types: (p.types || []).sort((a, b) => a.slot - b.slot).map((t) => t.type.name),
        typeLabels: (p.types || []).sort((a, b) => a.slot - b.slot).map((t) => TYPE_ZH[t.type.name] ?? t.type.name),
        height: p.height,
        weight: p.weight,
        stats: Object.fromEntries((p.stats || []).map((st) => [st.stat.name, st.base_stat])),
        abilities: (p.abilities || []).map((a) => ({ name: a.ability.name, hidden: a.is_hidden })),
        sprites: {
          front: spriteUrl.front(p.id),
          frontShiny: spriteUrl.frontShiny(p.id),
          official: spriteUrl.artwork(p.id),
          showdown: spriteUrl.showdown(p.id),
          showdownShiny: spriteUrl.showdownShiny(p.id),
          genVIcon: spriteUrl.genVIcon(p.id),
        },
      });
    }
    if (!forms.length) missingForms.push({ id: s.id, nameZh: s.nameZh });

    const def = forms.find((f) => f.isDefault) || forms[0] || null;

    dex[s.id] = {
      id: s.id,
      slug: s.slug,
      nameZh: s.nameZh,
      nameEn: s.nameEn,
      generation: s.generation,
      generationName: s.generationName,
      types: def ? def.types : [],
      typeLabels: def ? def.typeLabels : [],
      color: s.color,
      habitat: s.habitat,
      shape: s.shape,
      rarity: s.isMythical ? 'mythical' : s.isLegendary ? 'legendary' : s.isBaby ? 'baby' : 'normal',
      isLegendary: s.isLegendary,
      isMythical: s.isMythical,
      captureRate: s.captureRate,
      baseStats: def ? def.stats : {},
      statTotal: def ? Object.values(def.stats).reduce((a, b) => a + b, 0) : 0,
      abilities: def ? def.abilities : [],
      height: def ? def.height : null,
      weight: def ? def.weight : null,
      flavor: s.flavor,
      evoStage: node ? node.stage : 1,
      evoStageCount: chain ? maxStage(chain.root) : 1,
      evolvesFrom: node ? node.evolvesFrom : null,
      evolvesTo: node ? node.children.map((c) => c.id) : [],
      evolutionChainId: chain ? chain.id : null,
      forms,
      spriteId: def ? def.formId : s.id,
      assets: def
        ? {
            front: `pokemon/sprites/${s.id}.png`,
            portrait: `pokemon/portraits/${s.id}.png`,
            shiny: `pokemon/shiny/${s.id}.png`,
            icon: `pokemon/icons/${s.id}.png`,
            animated: `pokemon/animated/${s.id}.gif`,
            frontSource: def.sprites.front,
            portraitSource: def.sprites.official,
            shinySource: def.sprites.frontShiny,
            iconSource: def.sprites.genVIcon,
            animatedSource: def.sprites.showdown,
            animatedFallbackSource: def.sprites.genVAnimated,
          }
        : null,
      assetStatus: { static: 'pending', animated: 'pending', portrait: 'pending', shiny: 'pending' },
    };
  }

  /* ---------------- 输出 ---------------- */
  const outDex = path.join(DATA_DIR, 'pokemon', 'pokedex.json');
  await writeJson(outDex, dex);

  const chainsOut = {};
  for (const c of chains) chainsOut[c.id] = serializeNode(c.root);
  await writeJson(path.join(DATA_DIR, 'pokemon', 'evolution-chains.json'), chainsOut);

  const counts = Object.values(dex);
  const stats = {
    generatedAt: new Date().toISOString(),
    source: SOURCES.pokeapi,
    speciesCount: counts.length,
    formCount: counts.reduce((a, e) => a + e.forms.length, 0),
    missingForms,
    generationBreakdown: tallyBy(counts, (e) => e.generationName),
    typeBreakdown: counts.reduce((acc, e) => {
      for (const t of e.types) acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {}),
    rarityBreakdown: tallyBy(counts, (e) => e.rarity),
    speciesWithEvolution: counts.filter((e) => e.evolvesTo.length).length,
    evolutionChains: chains.length,
    license: LICENSE_NOTES['PokeAPI/api-data'],
  };
  await writeJson(path.join(DATA_DIR, 'pokemon', 'pokedex-meta.json'), stats);

  runLog.info('图鉴同步完成', { speciesCount: counts.length, chains: chains.length });
  const logFile = await runLog.flush();
  log(`✔ 图鉴同步完成：${counts.length} 种 / ${chains.length} 条进化链`);
  log(`  → ${outDex}`);
  log(`  → 日志 ${logFile}`);
  return { species, chains, dex };
}

function maxStage(node, depth = 1) {
  let best = depth;
  for (const c of node.children) best = Math.max(best, maxStage(c, depth + 1));
  return best;
}

function tallyBy(items, keyFn) {
  const acc = {};
  for (const i of items) {
    const k = keyFn(i);
    acc[k] = (acc[k] || 0) + 1;
  }
  return acc;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncPokedex().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
