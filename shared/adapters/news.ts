import { HALF_LIFE_H } from '../escalation'
import type { EscalationLevel, NewsItem } from '../feeds'

type Lang = NewsItem['lang']

/** One feed the headlines are read from, and what the scorer needs to know about who publishes it. */
export interface NewsSource {
  id: string
  url: string
  /** The name shown next to a headline. */
  publisher: string
  /** Outlets under one roof (every LSM edition, one country's ministries) count as one voice when stories are compared. */
  group: string
  lang: Lang
  /** Whose news it is, or INT for an outlet that covers the wider region. */
  country: 'LV' | 'LT' | 'EE' | 'INT'
  kind: 'media' | 'official' | 'analysis'
  /** 0 to 1: how much the publisher's word counts. */
  weight: number
  ai: NewsItem['ai']
  /** A home-language outlet: its stories are about its own country unless they say otherwise. */
  native?: boolean
  /** Where its stories live, when that is not the feed's own site. A site's own parts (kultuur.err.ee for err.ee) come with it. */
  links?: readonly string[]
}

/** One story as its feed gives it. The description is for scoring only and never leaves the server. */
export interface RawNews {
  title: string
  link: string
  /** Epoch ms. */
  at: number
  desc: string
  /** Filed under world news by its publisher. */
  foreign: boolean
}

export interface NewsEntry {
  item: RawNews
  source: NewsSource
}

const HOUR = 3600 * 1000

// ---- Reading a feed -------------------------------------------------------------------------

/** The named entities the feeds really use; numeric ones are worked out. */
const ENTITIES = new Map(
  Object.entries({
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€',
    ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
    lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
    scaron: 'š', Scaron: 'Š', zcaron: 'ž', Zcaron: 'Ž',
    auml: 'ä', Auml: 'Ä', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', otilde: 'õ', Otilde: 'Õ',
  }),
)

function decode(whole: string, name: string): string {
  if (name[0] !== '#') return ENTITIES.get(name) ?? whole
  const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
  return code <= 0x10ffff ? String.fromCodePoint(code) : ''
}

/** Stops at the next "<", so a run of tags that never close is passed over once and not once per tag. */
const MARKUP = /<\/?[a-z][^<>]*>/gi
const ENTITY = /&(#x?[0-9a-f]+|\w+);/gi

/** Feed text as plain text: no markup survives, so nothing from a feed is ever rendered as HTML. */
function plain(xml = ''): string {
  return xml
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(MARKUP, ' ')
    // Twice: LSM and the Lithuanian ministries escape their entities a second time ("&amp;scaron;").
    .replace(ENTITY, decode)
    .replace(ENTITY, decode)
    // Government feeds escape their markup, so it only turns into tags once the entities are read.
    .replace(MARKUP, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * What is inside every <name> element, in order. Found by plain searching: a pattern that looks
 * for the closing tag starts over at every opening one, and on a megabyte of tags that never
 * close that is minutes of work nothing can interrupt.
 */
function elements(xml: string, name: string): string[] {
  const open = `<${name}`
  const close = `</${name}>`
  const found: string[] = []
  for (let at = xml.indexOf(open); at >= 0; at = xml.indexOf(open, at)) {
    at += open.length
    // <items> is another element.
    if (!/[\s>]/.test(xml.charAt(at))) continue
    const start = xml.indexOf('>', at) + 1
    const end = xml.indexOf(close, start)
    if (start === 0 || end < 0) break
    found.push(xml.slice(start, end))
    at = end + close.length
  }
  return found
}

const FULL_TEXT = '<content:encoded'
const FULL_TEXT_END = '</content:encoded>'

/** An item without the whole article several publishers ship inside it. One that never closes takes the rest of the item with it. */
const withoutFullText = (item: string) =>
  item
    .split(FULL_TEXT)
    .map((piece, index) => {
      if (index === 0) return piece
      const end = piece.indexOf(FULL_TEXT_END)
      return end < 0 ? '' : piece.slice(end + FULL_TEXT_END.length)
    })
    .join('')

/** The EU Council dates its items with a10:updated and nothing else. */
const DATES = ['pubDate', 'a10:updated', 'dc:date']

/** Lower case, no accents, no quote marks: "Rīgā" and "riga" are the same word, and so are "ё" and "е". */
export const norm = (text: string) =>
  text.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[«»“”„"'’`]/g, ' ').replace(/\s+/g, ' ')

/** Section names, in a link or among the categories, that mark a story as world news. */
const ABROAD = /arzemes|arvalst|pasaul|uzsien|valismaa|maailm|world|abroad|zarubezh|foreign|за рубежом|в мире/

/** The sites a feed's stories may link to: its own, unless it says otherwise. */
export const linksOf = (source: Pick<NewsSource, 'url' | 'links'>): readonly string[] =>
  source.links ?? [`${new URL(source.url).origin}/`]

/** Every dated story in an RSS document whose link leads to the publisher's own site. */
export function parseFeed(xml: string, source: Pick<NewsSource, 'url' | 'links'>): RawNews[] {
  const sites = linksOf(source).map((site) => new URL(site).host)
  const items: RawNews[] = []
  for (const block of elements(xml, 'item')) {
    // The article goes before anything is read: a headline and a description are all that is ever looked at.
    const item = withoutFullText(block)
    const field = (name: string) => plain(elements(item, name)[0])
    const title = field('title').slice(0, 300)
    // Tracking parameters add nothing for the reader.
    const link = field('link').split('?')[0]
    const at = Date.parse(DATES.map(field).find(Boolean) ?? '')
    // The site itself or a part of it: ERR files its stories under kultuur.err.ee, novaator.err.ee and more.
    const host = link.startsWith('https://') && URL.canParse(link) ? new URL(link).host : ''
    if (!title || !Number.isFinite(at) || !sites.some((site) => host === site || host.endsWith(`.${site}`))) continue
    const topics = elements(item, 'category').map(plain).join(' ')
    items.push({ title, link, at, desc: field('description').slice(0, 400), foreign: ABROAD.test(norm(`${link} ${topics}`)) })
  }
  return items
}

// ---- Word lists ------------------------------------------------------------------------------

/**
 * Patterns, written the way the words are spelled and separated by ';'. To teach the scorer a
 * new phrase, add it to the line of its language.
 *
 *   *  the rest of the word       ~  up to five words in between       >  the word ends here
 *
 * A pattern starts at the start of a word and, unless it ends in '>', matches any ending, so one
 * stem covers every inflected form. The words in between may carry a comma, a colon or a dash
 * ("Drone, believed to be Russian, crashes"). Everything else means what it does in a regular
 * expression: brackets, '|', '?', '{0,2}' and '(?!...)' for what must not follow. Text and
 * patterns both go through norm(), and every language is tried on every text: headlines quote
 * each other's place names all the time.
 *
 * The higher the level, the more a pattern has to say that something happened, and to whom:
 * "mobilisation" and "invasion" by themselves are everyday words in this region's news.
 */
type Words = Partial<Record<Lang, string>>
type Row<V> = readonly [id: string, value: V, words: Words]

/** What ' ~' stands for. A word here may be a dash standing alone, or two words joined by one. */
const WORDS_BETWEEN = '[,:;]? (?:[\\p{L}\\p{N}\\p{Pd}]+[,:;]? ){0,5}'

function compile(words: Words): RegExp {
  const patterns = Object.values(words)
    .flatMap((line) => norm(line).split(';'))
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => pattern.replace(/\*/g, '\\p{L}*').replace(/ ~/g, WORDS_BETWEEN).replace(/>/g, '(?![\\p{L}\\p{N}])'))
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${patterns.join('|')})`, 'u')
}

/**
 * What a story can be about, and the level that alone puts it at:
 * 5 armed attack, 4 crisis, 3 serious incident in the Baltics, 2 hybrid pressure, 1 posture.
 */
const CONCEPTS = (
  [
    [
      'armed_attack',
      5,
      // An invasion or an attack only with one of these countries or NATO on the receiving end: without that
      // the words are about Ukraine, about 1940, or about slugs in the garden.
      {
        en: 'armed attack; (invasion of|invade[sd]>) ([a-z-]+ ){0,2}(latvia|lithuania|estonia|baltic|nato|poland|finland); (russia|belarus) (has )?attack(s|ed) (latvia|lithuania|estonia|nato)>; declares war; declared war; declaration of war',
        lv: 'bruņot* uzbrukum; iebruk* (latvij|lietuv|igaunij|baltij|nato|polij|somij); (krievija|baltkrievija) uzbru* (latvijai|lietuvai|igaunijai|nato); piesaka karu; pieteic* karu',
        lt: 'ginkluot* užpuolim; (įsiverž|invazij)* (į )?(lietuv|latvij|estij|baltij|nato|lenkij|suomij); (rusija|baltarusija) užpuol* (lietuv|latvij|estij|nato); paskelbė karą',
        // "Into Estonia", spelled out: "tungisid Eesti õhuruumi" is an airspace violation.
        et: 'relvastatud rünnak; (sissetung|tungi)* (sisse )?(eestisse|lätisse|leetu|leedusse|balti|nato|poolasse|soome>); (venemaa|valgevene) ründa* (eestit|lätit|leedut|nato); kuulutas sõja',
        ru: 'вооруженн* нападени; (вторжени|вторг)* в (латви|литв|эстони|прибалтик|страны балтии|нато|польш|финлянд); (россия|беларусь) напала на (латви|литв|эстони|нато); объявил* войну',
      },
    ],
    [
      'article_5_invoked',
      5,
      {
        en: 'invok* ~article 5; trigger* ~article 5; activat* ~article 5; article 5 ~(invoked|triggered|activated)',
        lv: 'iedarbin* ~5. pant; aktiviz* ~5. pant; piemēro* ~5. pant',
        lt: 'aktyvuo* ~5 straipsn; aktyvuo* ~5-ąjį straipsn',
        et: 'käivita* ~artik* 5; rakenda* ~artik* 5',
        ru: 'задейств* ~стать* 5; задейств* ~5-ю статью; применени* ~стать* 5',
      },
    ],
    [
      'martial_law',
      5,
      { en: 'martial law; state of war', lv: 'kara stāvokl', lt: 'karo padėt', et: 'sõjaseisukor', ru: 'военн* положени' },
    ],
    [
      'general_mobilisation',
      5,
      {
        en: 'general mobili[sz]ation; full mobili[sz]ation',
        lv: 'vispārēj* mobilizācij',
        lt: 'visuotin* mobilizacij',
        et: 'üldmobilisatsioon',
        ru: 'всеобщ* мобилизаци',
      },
    ],

    [
      'mobilisation',
      4,
      // Declared, not discussed: the word alone is in every plan, law and budget, and is posture (see "defence").
      {
        en: '(declares?|declared|announces?|announced|orders?|ordered) ~mobili[sz]ation; mobili[sz]ation ~(declared|announced|ordered); reservists ~called up; call-up of reserv',
        lv: 'izsludin* ~mobilizācij; mobilizācij* ~izsludin; rezervist* ~iesauk',
        lt: 'paskelb* ~mobilizacij; mobilizacij* ~paskelb; rezervist* ~šauk',
        et: 'kuuluta* ~mobilisatsioon; mobilisatsioon* ~kuuluta; reservväelas* ~kutsu',
        ru: 'объяв* ~мобилизаци; мобилизаци* ~объяв; призыв* резервист',
      },
    ],
    [
      'article_4',
      4,
      {
        en: 'article 4 consult; invok* ~article 4; trigger* ~article 4',
        lv: '4. pant* konsultācij; iedarbin* ~4. pant; konsultācij* ~4. pant',
        lt: '4 straipsn* konsultacij; aktyvuo* ~4 straipsn',
        et: 'artik* 4 konsultatsioon; käivita* ~artik* 4',
        ru: 'консультаци* ~стать* 4; задейств* ~стать* 4',
      },
    ],
    [
      'armed_clash',
      4,
      {
        // Fire opened by or on soldiers and border guards. A gunman in a shopping centre is another kind of news.
        en: 'armed clash; armed incident; exchange of fire; (troops|soldiers|forces|army|border guards?) ~open(s|ed)? fire; open(s|ed)? fire ~(border|troops|soldiers|guards); shots fired ~(border|troops|soldiers|guards)',
        lv: 'bruņot* sadursm; bruņot* incident; apšaud* ~robež',
        lt: 'ginkluot* susirėmim; ginkluot* incident; apšaud* ~pasien',
        et: 'relvastatud kokkupõr; relvastatud intsiden; tulevahetus',
        ru: 'вооруженн* столкновени; вооруженн* инцидент; перестрелк* ~границ',
      },
    ],
    [
      'strike',
      4,
      // The verb right after the weapon: with words in between, "drone makers hit by export ban" is a strike too.
      {
        en: 'missile strike; missile attack; air ?strike; drone strike; drone attack; shelling; (drone|missile)s? (strikes?|struck|hits?|attacks?|attacked)>',
        lv: 'raķešu trieci; raķešu uzbrukum; gaisa trieci; dronu trieci; dronu uzbrukum; (dron|raķet)* (trāpīj|uzbruk)',
        lt: 'raketų smūg; raketų atak; oro smūg; dronų atak; dronų smūg; (dron|raket)* (smog|atakav|pataik)',
        et: 'raketirünnak; õhurünnak; droonirünnak; (droon|rakett)* (ründas|tabas)',
        ru: 'ракетн* удар; ракетн* атак; авиаудар; удар* дрон; атак* дрон; атак* беспилотник; удар* беспилотник; обстрел; (дрон|беспилотник|ракет)* (атаков|ударил|попал)',
      },
    ],
    [
      'blockade',
      4,
      // At sea only: on land the word belongs to farmers and their tractors.
      { en: 'naval blockade; sea blockade', lv: 'jūras blokād', lt: 'jūrų blokad', et: 'mereblokaad', ru: 'морск* блокад' },
    ],

    [
      'airspace_violation',
      3,
      {
        en: 'airspace violation; violat* ~airspace; airspace ~violat; enter(s|ed|ing)? ~airspace; airspace incursion; breach* ~airspace',
        lv: 'gaisa telp* pārkāp; pārkāp* ~gaisa telp; ielidoj* ~gaisa telp; gaisa telp* ~(ielidoj|pārkāp)',
        lt: 'oro erdv* pažeid; pažeid* ~oro erdv; įskrid* ~oro erdv; oro erdv* ~(įskrid|pažeid)',
        et: 'õhuruumi rikkum; õhupiiri rikkum; rikku* ~õhuruum; rikku* ~õhupiir; (sisenes|tungi)* ~õhuruum; õhuruum* ~(rikku|sisenes)',
        ru: 'нарушени* воздушн* (пространств|границ); нарушил* воздушн* (пространств|границ); вторг* в воздушн* пространств; воздушн* пространств* ~(нарушен|нарушил|вторг)',
      },
    ],
    [
      'airspace_closed',
      3,
      {
        en: 'airspace ~(closed|closes|closure|closing); (closes?|closed|closing|closure of) ~airspace',
        lv: 'slēdz* ~gaisa telp; gaisa telp* ~slēg',
        lt: 'uždar* ~oro erdv; oro erdv* ~uždar',
        et: 'sulg* ~õhuruum; õhuruum* ~sule',
        ru: 'закры* воздушн* пространств; воздушн* пространств* ~закры',
      },
    ],
    [
      'drone_incursion',
      3,
      {
        // A drone that crashed or was shot down somewhere, or entered a country by name. A drone maker enters a
        // market, its shares crash, and drones that shot down something else are doing well.
        en: 'drone incursion; drones? ~(violat|intrud); drones? ~crash(es|ed)? (in|into|near|on|at|over|inside|outside)>; drones? ~(shot down|downed) (in|near|over|above|at|on|inside|by)>; drones? ~(entered|enters?|flew into|strayed into|crossed into) (latvia|lithuania|estonia)>; (shot|shoots|shooting) down ~drone; unidentified drone; (crashed|downed|intruding) ~drone',
        // "Notriec" and "notriekts" are one verb.
        lv: 'dron* ~(ielidoj|nokrit|notrie[ck]|iekļuv); bezpilota lidaparāt* ~(ielidoj|nokrit|notrie[ck]); neidentificēt* dron; (ielidoj|nokrit|notrie[ck])* ~(dron|bezpilota)',
        lt: 'dron* ~(įskrid|nukrit|numuš|pažeid); numuš* ~dron; bepiloči* ~(įskrid|nukrit|numuš); neatpažint* dron; (įskrid|nukrit|numuš)* ~(dron|bepiloč)',
        et: 'droon* ~(sisenes|kukkus|tulistati alla|rikkus); tulista* alla ~droon; tundmatu* droon; (sisenes|kukkus)* ~droon',
        ru: '(беспилотник|дрон|бпла)* ~(упал|залетел|сбит|нарушил|вторг); сбил* ~(дрон|беспилотник|бпла); неопознанн* (дрон|беспилотник); (упал|залетел|сбит|вторг)* ~(дрон|беспилотник|бпла)',
      },
    ],
    [
      'sabotage',
      3,
      {
        en: 'sabotage; saboteur',
        lv: 'sabotāž; diversij; diversant',
        lt: 'sabotaž',
        et: 'sabotaaž; diversioon',
        ru: 'саботаж; диверси; диверсант',
      },
    ],
    [
      'cable_cut',
      3,
      {
        en: '(cable|pipeline)s? ~(cut|damag|sever|ruptur|broken); (cut|damag|sever)* ~(undersea|subsea|submarine|underwater) (cable|pipeline); anchor drag',
        lv: 'kabe* ~(bojāt|pārrau|pārtrūk|bojājum); (bojāt|bojājum)* ~(jūras|zemūdens) kabe; gāzesvad* ~bojā',
        lt: 'kabel* ~(pažeist|nutrauk|nutrūk|sugadint); (pažeist|nutrauk)* ~kabel; dujotiek* ~pažeist',
        et: '(mere|side|elektri)?kaab(el|l)* ~(kahjust|katkes|purune|rike); (kahjust|katkes|purune)* ~(mere|side|elektri)?kaab; gaasitoru* ~kahjust',
        ru: 'кабел* ~(поврежд|обрыв|перерез|разрыв); (поврежд|обрыв|перерез)* ~кабел; газопровод* ~поврежд',
      },
    ],
    [
      'major_cyberattack',
      3,
      {
        en: '(massive|large-scale|major) cyber ?attack; cyber ?attack* ~(grid|energy|bank|hospital|government|critical)',
        lv: '(plaš|masveid|vērienīg)* kiberuzbrukum; kiberuzbrukum* ~(kritisk|enerģ|bank|slimnīc|valsts)',
        lt: '(didel|masin|plataus masto)* kibernetin* atak; kibernetin* atak* ~(kritin|energet|bank|ligonin|valstyb)',
        et: '(ulatuslik|suur)* küberrünnak; küberrünnak* ~(elutäht|energia|pank|haigla|riigi)',
        ru: '(масштабн|массирован|крупн)* (кибератак|хакерск* атак); кибератак* ~(критическ|энерг|банк|больниц|государств)',
      },
    ],
    [
      'border_closed',
      3,
      // The border itself. One crossing closed, for the night or for repairs, is border_crossing_closed below.
      {
        en: 'borders?>(?! crossing| checkpoint| guard| post| point| control) ~(closed|closes|closure|closing|shut>|sealed); (closes?|closed|closing|closure of|shuts?|seals?|sealed) ~borders?>(?! crossing| checkpoint| guard| post| point| control)',
        lv: 'slēdz* ~robež(u|as)>; slēg* ~robež(u|as)>; robež(a|u|as)> ~slēgt; robež(a|u|as)> ~slēgšan',
        lt: 'uždar* ~sieną; sien* ~uždar',
        et: 'sulg* ~piiri>; piir(i|id)?> ~(sulge|sule)',
        ru: 'закры* ~границу; границ* ~закры; закрыти* границ',
      },
    ],
    [
      'troop_buildup',
      3,
      {
        en: 'troops? ~(mass|amass)* ~border; (mass|amass)(es|ed|ing)? ~(troops|forces) ~border; troop build-?up; military build-?up',
        lv: '(karaspēk|spēku)* koncentr* ~robež; koncentr* ~karaspēk* ~robež; savelk* ~karaspēk',
        lt: '(kariuomen|pajėg)* telki* ~sien; telki* ~(kariuomen|pajėg)* ~sien',
        et: 'vägede koondami* ~piir; koonda* ~väg* ~piir',
        ru: 'стягива* ~войск; (концентраци|скоплени)* войск',
      },
    ],

    [
      'cyberattack',
      2,
      {
        en: 'cyber ?attack; ddos; hack(ed|ers|ing)>; ransomware',
        lv: 'kiberuzbrukum; hakeri; izspiedējvīrus',
        lt: 'kibernetin* atak; kiberatak; programiš',
        et: 'küberrünnak; häkker; lunavara',
        ru: 'кибератак; хакер; вирус-вымогател',
      },
    ],
    [
      'explosion',
      2,
      {
        // A blast at or in a place, or one that does harm: not an Arctic one, and not one team blasting another.
        en: 'explosion; blasts? (at|in|near|heard|rocks?|kills?|injures?|damages?)>; explod; detonat',
        lv: 'sprādzien; eksplozij; uzsprāg',
        lt: 'sprogim; susprog',
        et: 'plahvatus; plahvata',
        ru: 'взрыв; взорва',
      },
    ],
    [
      'troop_movement',
      2,
      {
        en: 'mov(es|ed|ing) ~(troops|units|forces) ~border; troops? ~(moved?|moves|deploy)* ~border',
        lv: 'pārvieto* ~karaspēk; karaspēk* ~robež',
        lt: 'perkel* ~(kariuomen|pajėg|kari); kariuomen* ~(prie|link) ~sien',
        et: 'väge* ~piiri äär; viib ~väe',
        ru: 'переброс* ~войск; перевод* ~войск; войск* ~к границ',
      },
    ],
    [
      'hybrid',
      2,
      {
        en: 'hybrid (attack|operation); hybrid (warfare|threat|war>); instrumentali[sz]ed migra; weaponi[sz]ed migra',
        lv: 'hibrīduzbrukum; hibrīdoperācij; hibrīdkar; hibrīdapdraud',
        lt: 'hibridin* (atak|operacij); hibridin* (kar|grėsm)',
        et: 'hübriidrünnak; hübriidoperatsioon; hübriid(sõda|sõja|oht|ohu)',
        ru: 'гибридн* (атак|операци); гибридн* (войн|угроз)',
      },
    ],
    [
      'gps_jamming',
      2,
      {
        en: '(gps|gnss) (jamming|interference|spoofing); jamming',
        lv: 'gps ~traucē',
        lt: 'gps ~trikd; gps ~trukd',
        et: 'gps ~(häir|segam)',
        ru: '(глушени|помех|подавлени)* ~gps; gps-помех',
      },
    ],
    [
      'border_crossing_closed',
      2,
      {
        en: '(border crossing|checkpoint)* ~(clos|shut); (closes?|closed|closing|shuts?) ~(border crossing|checkpoint)',
        lv: '(robežšķērsošanas viet|robežpārejas punkt|robežkontroles punkt)* ~slēg; slēdz* ~(robežšķērsošanas viet|robežpārejas punkt|robežkontroles punkt)',
        lt: 'pasienio (kontrolės )?punkt* ~uždar; uždar* ~pasienio (kontrolės )?punkt',
        et: 'piiripunkt* ~sule; sulg* ~piiripunkt',
        ru: 'пункт* пропуска ~закры; (погранпереход|кпп)* ~закры',
      },
    ],
    [
      'airport_disrupted',
      2,
      {
        en: 'airport ~(closed|suspended|halted|shut); flights ~(suspended|diverted|halted)',
        lv: 'lidost* ~(slēg|aptur); lidojum* ~(aptur|novirz)',
        lt: 'oro uost* ~(uždar|sustabd); skrydži* ~(sustabd|nukreip)',
        et: 'lennujaam* ~(sule|peata); lennu* ~(peatat|suunat)',
        ru: 'аэропорт* ~(закры|приостанов); рейс* ~(отмен|перенаправ)',
      },
    ],
    [
      'balloons',
      2,
      {
        en: 'smuggling balloon; balloons? ~belarus; (weather|meteorological) balloon',
        lv: 'kontrabandas balon; meteobalon; meteoroloģisk* balon',
        lt: 'kontrabandin* balion; meteorologini* balion',
        et: 'salakauba ?õhupall',
        ru: 'метеозонд; контрабандн* шар; воздушн* шар* ~(беларус|белорус)',
      },
    ],
    [
      'shadow_fleet',
      2,
      {
        en: 'shadow fleet; tanker ~(detain|board|seiz|inspect)',
        lv: 'ēnu flot',
        lt: 'šešėlin* laivyn',
        et: 'varilaevasti; varitanker',
        ru: 'тенев* флот',
      },
    ],
    [
      'nuclear',
      2,
      {
        en: 'nuclear (weapon|arms|threat|strike|test|alert); tactical nuclear; radiation leak',
        lv: 'kodolieroč; kodoldraud; kodoltrieci; radiācijas noplūd',
        lt: 'branduolin* (ginkl|grėsm|smūg)',
        et: 'tuumarelv; tuumaoht; tuumalöö; kiirgusleke',
        ru: 'ядерн* (оружи|угроз|удар|испытани); утечк* радиаци',
      },
    ],
    [
      'diplomatic_rupture',
      2,
      {
        en: 'expel* ~diplomat; diplomats? ~expel; persona non grata; recall* ~ambassador; ambassador ~(summoned|expelled|recalled)',
        lv: 'izraid* ~diplomāt; atsauc* ~vēstniek; izsauc* ~vēstniek',
        lt: 'išsiun* ~diplomat; atšauk* ~ambasador; iškvie* ~ambasador',
        et: 'saad* välja ~diplomaa; kutsu* ~suursaadik',
        ru: 'высыл* ~дипломат; выслал* ~дипломат; персона нон грата; отозва* ~посла; вызва* ~посла',
      },
    ],
    [
      'undersea_cable',
      2,
      {
        en: 'undersea cable; subsea cable; submarine cable',
        lv: 'zemūdens kabe; jūras kabe',
        lt: 'povandenin* kabel; jūrin* kabel',
        et: 'merekaab; merealu* kaab; estlink; balticconnector',
        ru: 'подводн* кабел',
      },
    ],
    [
      'arson_attack',
      2,
      {
        en: 'arson attack',
        lv: 'ļaunprātīg* dedzināšan',
        lt: 'tyčin* padegim',
        et: 'tahtlik* süütami',
        ru: 'умышленн* поджог',
      },
    ],

    [
      'espionage',
      1,
      {
        en: 'espionage; spy>; spies>; spying; treason',
        lv: 'spiegošan; spiegs>; spiegu>; valsts nodevīb',
        lt: 'šnipinėj; šnip(as|ai|ų)>; valstybės išdavyst',
        et: 'spionaaž; spioon; riigireetmi',
        ru: 'шпионаж; шпион; госизмен; государственн* измен',
      },
    ],
    [
      'exercise',
      1,
      {
        en: 'military exercise; exercise>; drills?>; war ?games?>; manoeuvres; maneuvers; zapad',
        lv: 'militār* mācīb; mācīb* ~(namejs|zapad); zemessar* ~mācīb; mācīb* ~poligon',
        lt: 'karin* pratyb; pratyb',
        et: 'õppus; kevadtorm',
        ru: 'военн* учени; учени* нато; маневр',
      },
    ],
    [
      'illegal_migration',
      1,
      {
        en: 'illegal (border )?crossing; irregular migra; illegal migra; border violator',
        lv: 'nelegāl* robežšķērso; robežpārkāpēj; nelegāl* migr',
        lt: 'neteisėt* migra; neteisėt* ~kirt',
        et: 'ebaseadusl* (piiriület|ränne|rände|migra); illegaal* (piiriület|migra)',
        ru: 'нелегальн* мигра; незаконн* пересечени; нарушител* границ',
      },
    ],
    [
      'article_5',
      1,
      {
        en: 'article 5>; article five',
        lv: '5. pant; piekt* pant',
        lt: '5 straipsn; 5-asis straipsn; penkt* straipsn',
        et: 'artikkel 5>; artikli 5>',
        ru: 'стать* 5>; 5-я статья; 5-й статьи; пят* стать',
      },
    ],
    [
      'drone',
      1,
      {
        en: 'drones?>; uav>',
        lv: 'dron(s|i|u|us|iem|a|am)>; bezpilota lidaparāt',
        lt: 'dron(as|ai|ų|us|ams)>; bepiloči',
        et: 'droon',
        ru: 'дрон; беспилотник; бпла>',
      },
    ],
    [
      'defence',
      1,
      {
        en: 'nato>; defen[cs]e (budget|spending|minister|ministry|forces|industry); armed forces; troops>; brigade; battalion; air policing; air defen[cs]e; conscript; mobili[sz]ation; ammunition; sanctions; disinformation; propaganda',
        // Not the bare "aizsardzīb": "tiesiskās aizsardzības process" is an insolvency, not defence.
        lv: 'valsts aizsardzīb; aizsardzības (ministr|nozar|budžet|spēj|industr|spēk); bruņot* spēk; nbs>; zemessar; karavīr; brigād; bataljon; pretgaisa; iesaukum; mobilizācij; munīcij; sankcij; dezinformācij; propagand; drošības dienest; vdd>; midd>',
        lt: 'krašto apsaug; gynybos (biudžet|pramon|ministr|pajėg|išlaid); kariuomen; kari(ai|ų|ams|us)>; batalion; oro gynyb; šauktin; šauli; mobilizacij; amunicij; dezinformacij; vsd>',
        et: 'kaitsevä; kaitseliit; kaitseminist; riigikaitse; õhutõrje; brigaad; pataljon; ajateeni; mobilisatsioon; laskemoon; sanktsioon; desinformatsioon; kapo>; kaitsepolitsei; välisluure',
        ru: 'нато>; оборон; вооруженн* сил; арми(я|и|ю|ей)>; военн; бригад; батальон; пво>; мобилизаци; боеприпас; санкци; дезинформаци; пропаганд',
      },
    ],
  ] satisfies Row<EscalationLevel>[]
).map(([id, level, words]) => ({ id, level, re: compile(words) }))

/** Things that matter without being a security event. They add importance points, never a level. */
const IMPACTS = (
  [
    [
      'emergency_declared',
      50,
      {
        en: 'state of emergency; emergency situation; state of exception',
        lv: 'ārkārtēj* situācij; izņēmuma stāvokl',
        lt: 'nepaprastoj* padėt; ekstremali* situacij; ekstremali* padėt',
        et: 'eriolukor; erakorrali* seisukor; hädaolukor',
        ru: 'чрезвычайн* (положени|ситуаци); режим* чс>',
      },
    ],
    [
      'blackout',
      38,
      {
        en: 'blackout; power (outage|cut); without (electricity|power); internet outage; network outage',
        lv: 'elektr* ~(traucējum|pārtrauk|atslēg); bez elektrīb; sakaru traucējum',
        lt: 'be elektros; elektr* tiekim* ~(sutrik|nutrūk); ryšio sutrik',
        et: 'elektrikatkest; elektrita>; siderike',
        ru: 'блэкаут; отключени* (электр|свет); без (электричеств|света); сбо* связи',
      },
    ],
    [
      'government_fall',
      35,
      {
        en: 'government ~(resign|collapse|falls); no-confidence; prime minister ~resign',
        lv: 'valdīb* ~(krīt|krit|demisij); demisij; neuzticīb',
        lt: 'vyriausyb* ~(griuv|atsistatyd); nepasitikėjim',
        et: 'valitsus* ~(kukku|lahku); umbusald',
        ru: 'правительств* ~(отставк|ушло); вотум* недовери',
      },
    ],
    ['evacuation', 35, { en: 'evacuat', lv: 'evaku', et: 'evakue', ru: 'эвакуац; эвакуир' }],
    [
      'casualties',
      25,
      {
        en: 'killed>; dead>; deaths?>; casualt; fatal',
        lv: 'gāj* bojā; bojā gāj; bojāgājuš; upur(i|u|iem)>',
        lt: 'žuvo>; žuvus; auk(os|ų)>',
        et: 'hukkus; hukkunu; surma sai',
        ru: 'погиб; жертв',
      },
    ],
    // Not the Latvian "mēra" or the Lithuanian "maras": both are everyday words as well.
    ['epidemic', 20, { en: 'outbreak; epidemi; pandemi; plague', lv: 'uzliesmojum', lt: 'protrūk', et: 'puhang', ru: 'вспышк; чум(а|ы|е)>' }],
    ['election', 15, { en: 'elections?>', lv: 'vēlēšan', lt: 'rinkim', et: 'valimi(sed|ste|stel)>', ru: 'выбор(ы|ов|ах)>' }],
    [
      'critical_infrastructure',
      15,
      {
        en: 'critical infrastructure; power (grid|plant); substation; lng terminal; rail baltica',
        lv: 'kritisk* infrastruktūr; elektrotīkl; apakšstacij',
        lt: 'kritin* infrastruktūr; elektros tinkl',
        et: 'elutäht; elektrivõr; alajaam',
        ru: 'критическ* инфраструктур; электросет; подстанци',
      },
    ],
    [
      'disaster',
      15,
      {
        en: 'storm>; floods?>; flooding; wildfire',
        lv: 'vētr(a|as|ā|u)>; plūd(i|u|os)>; ugunsgrēk',
        lt: 'audr(a|os|ą)>; potvyn; gaisr(as|o|ą|ai)>',
        et: 'torm(i|is)?>; üleujutus; tulekahju; põleng',
        ru: 'шторм; наводнени; пожар',
      },
    ],
  ] satisfies Row<number>[]
).map(([id, points, words]) => ({ id, points, re: compile(words) }))

/** Where a story happens and how close to home that is: 1 Latvia, 0.8 the rest of the Baltics, 0.5 the neighbours, 0 elsewhere. */
const PLACES = (
  [
    [
      'LV',
      1,
      {
        en: 'latvia; riga>; daugavpils; liepaja; ventspils; rezekne; latgale; adazi',
        lv: 'latvij; rīg(a|as|ā|u)>; liepāj; rēzekn; latgal; kurzem; vidzem; zemgal; ādaž; lielvārd; sēlij; lāčusil',
        et: 'läti>; lätis; riia>',
        ru: 'латви; риг(а|и|е|у)>; рижск; даугавпилс; лиепа; резекн',
      },
    ],
    [
      'LT',
      0.8,
      {
        en: 'lithuania; vilnius; kaunas; klaipeda; suwalki',
        lv: 'lietuv; viļņ',
        lt: 'vilni; klaipėd; šiauli; rūdnink; suvalk',
        et: 'leedu',
        ru: 'литв; литов; вильнюс; каунас; клайпед; сувалк',
      },
    ],
    [
      'EE',
      0.8,
      {
        // The base at Tapa only by name with what it is: in Latvian "tapa" is an everyday verb.
        en: 'estonia; tallinn; tartu>; narva; tapa (army|military|base)',
        lv: 'igaunij; tallin; narv(a|as|ā)>',
        lt: 'estij',
        et: 'eesti; tapa linnak; ämari',
        ru: 'эстони; таллин; тарту; нарв',
      },
    ],
    [
      'BALTIC',
      0.8,
      {
        en: 'baltic; kaliningrad; gulf of finland',
        lv: 'baltij; kaļiņingrad; somu līc',
        lt: 'karaliauči',
        et: 'läänemer; balti>; baltimaa; soome lah',
        ru: 'балти; калининград; финск* залив',
      },
    ],
    [
      'RU',
      0.5,
      {
        en: 'russia; moscow; kremlin; pskov',
        lv: 'krievij; maskav; kreml; pleskav',
        lt: 'rusij',
        et: 'venemaa; vene>; moskva; pihkva',
        ru: 'росси; москв; кремл; псков',
      },
    ],
    ['BY', 0.5, { en: 'belarus', lv: 'baltkriev', lt: 'baltarus', et: 'valgevene', ru: 'беларус; белорус' }],
    ['PL', 0.5, { en: 'poland', lv: 'polij', lt: 'lenkij', et: 'poola>', ru: 'польш' }],
    ['FI', 0.5, { en: 'finland', lv: 'somij', lt: 'suomij', et: 'soome>', ru: 'финлянд' }],
    [
      'UA',
      0,
      {
        en: 'ukrain; kyiv; kharkiv; odesa; crimea; black sea',
        // Crimea with its endings spelled out: "krim" alone is also how "kriminālpolicija" starts.
        lv: 'kijiv; harkiv; krim(a|as|ā|u)>; melnā* jūr',
        lt: 'kijev; charkiv; krym; juodo* jūr',
        et: 'kiiev; krimm; musta* mere',
        ru: 'украин; киев; харьков; одесс; крым; черн* мор',
      },
    ],
    [
      'FAR',
      0,
      {
        en: 'gaza; israel; iran; syria; yemen; taiwan; china; korea; sudan; ethiopia',
        lv: 'izraēl; irān; ķīn',
        lt: 'izrael; kinij',
        et: 'iisrael; iraan; hiina',
        ru: 'израил; иран; сири; кита',
      },
    ],
  ] satisfies Row<number>[]
).map(([id, tier, words]) => ({ id, tier, re: compile(words) }))

/**
 * Context that says the words are not a live event here. Each one holds the level at or below its
 * cap, and each is looked for in the headline alone: a description that says "the biggest in
 * history" or "acting in concert with allies" is ordinary reporting.
 */
const DAMPENERS = (
  [
    [
      'history',
      1,
      // A year of the last century is history in any language. Not "history" itself ("the biggest attack in Latvia's
      // history") and not memorials, which are places things happen near.
      {
        en: 'anniversar; commemorat; remembrance; world war; wwii; soviet (occupation|era|times|invasion); 19[0-9][0-9]>; museum',
        lv: 'gadadien; piemiņ; atcer; pasaules kar; okupācij; muzej; barikā',
        lt: 'metin(ės|ių)>; minėjim; atminim; pasaulin* kar; okupacij; muziej',
        et: 'aastapäev; mälestus; maailmasõ; okupatsioon; muuseum',
        ru: 'годовщин; памят(ь|и)>; миров* войн; оккупаци; музе',
      },
    ],
    [
      'entertainment',
      0,
      // Words that only sport and the stage use: "match" and "spēlē" are also verbs, and "concerted" is not a concert.
      {
        en: 'film>; movie; tv series; video game; premiere; concerts?>; tournament; championship; league>; basketball; football; hockey; eurobasket; olympi; [0-9]+ points',
        lv: 'filma; seriāl; teātr; pirmizrād; koncert; hokej; basketbol; futbol; čempionāt',
        lt: 'filmas>; serial; teatr; spektakl; krepšin; čempionat; rungtyn',
        et: 'seriaal; teat(er|ri)>; lavastus; kontsert; jalgpall; korvpall; meistrivõistlus',
        ru: 'фильм; сериал; театр; спектакл; хоккей; футбол; баскетбол; чемпионат; матч',
      },
    ],
    [
      'hypothetical',
      2,
      // Plans and laws belong here too: a mobilisation plan or a bill on martial law provides for the day, it is not the day.
      {
        en: 'could>; would>; might>; what if; scenario; simulation; war ?game; opinion; editorial; commentary; interview; analysis; warns?>; warned>; fears?>; prepar* for; in case of; plans?>; planned; planning; draft law; bill>; legislation',
        // The law by its endings: "likumsargi" are the police.
        lv: 'varētu; scenārij; simulācij; viedokl; intervij; komentār; brīdin; gadījumā; plān; likum(s|u|a|am|i|os|projekt*)>',
        lt: 'galėtų; scenarij; simuliacij; nuomon; interviu; komentar; įspėj; atveju; planuoj; plan(as|ą|o|ų|us|ai)>; įstatym',
        et: 'võiks; võib>; stsenaarium; simulatsioon; arvamus; intervjuu; kommentaar; hoiata; korral>; plaan; kava>; kavatse; seadus; eelnõu',
        ru: 'может>; мог* бы; сценари; симуляци; мнени; интервью; комментари; предупре; в случае; план(ы|а|у|ом|ов|ах)?>; планир; закон',
      },
    ],
    [
      'denied',
      2,
      {
        en: 'false alarm; denie[sd]>; refute; not confirmed; no threat; hoax',
        lv: 'viltus trauksm; nolie(dz|dza)>; atspēko; nav apstiprin; draud* nav',
        lt: 'netikr* pavoj; paneig; nepatvirtin; grėsmės nėra',
        et: 'valehäire; eitab>; lükkas ümber; ei kinnita; ohtu ei ole',
        ru: 'ложн* тревог; опроверг; не подтвержд; угрозы нет',
      },
    ],
  ] satisfies Row<number>[]
).map(([id, cap, words]) => ({ id, cap, re: compile(words) }))

/**
 * These two speak about an event only from before it or from the same clause ("invasion is not
 * planned"). After a comma they are somebody's reaction: "Drone crashes in Latvia, army warns residents".
 */
const ABOUT_THE_EVENT = new Set(['hypothetical', 'denied'])
const CLAUSE_END = /[,;:.?!]| \p{Pd} /u

/** Somebody held to account: turns talk of spying into a case. */
const LEGAL = compile({
  en: 'arrest; detain; charged; convict; sentenced',
  lv: 'aizturē; apsūdz; notiesā',
  lt: 'sulaik; kaltinam; nuteis',
  et: 'peeti kinni; vahista; süüdista; mõisteti',
  ru: 'задержа; арестова; обвин; осужд; приговор',
})

/** What an explosion has to be near to count as an attack on infrastructure. */
const INFRASTRUCTURE = compile({
  en: 'military; base>; depot; barracks; railway; pipeline; substation; power plant; port>',
  lv: 'militār; bāz(e|es|ē)>; noliktav; dzelzceļ; cauruļvad; apakšstacij; ost(a|as|ā)>',
  lt: 'karin; baz(ė|ės|ėje)>; sandėl; geležinkel; vamzdyn; pastot; uost(as|o|e)>',
  et: 'sõjaväe; baas; ladu>; lao>; raudtee; torujuh; alajaam; sadam',
  ru: 'военн; баз(а|ы|е|у)>; склад; железн* дорог; трубопровод; подстанци; порт(а|у|е)?>',
})

const EMERGENCY = IMPACTS.find((impact) => impact.id === 'emergency_declared')!.re
const BALTICS = ['LV', 'LT', 'EE']
/** Places precise enough to tell one story from another. */
const STORY_PLACES = new Set([...BALTICS, 'BALTIC'])
const ELSEWHERE = new Set(['UA', 'FAR'])
const naming = (ids: ReadonlySet<string>) => new RegExp(PLACES.filter((place) => ids.has(place.id)).map((place) => place.re.source).join('|'), 'u')
const HERE = naming(STORY_PLACES)
const AWAY = naming(ELSEWHERE)
/** Level 2 and up: what a story has to be about before it is compared with other publishers' stories. */
const STORY_CONCEPTS = new Set(CONCEPTS.filter((concept) => concept.level >= 2).map((concept) => concept.id))
/** An exercise that turns into one of these is no longer an exercise. */
const REAL_INCIDENTS = ['airspace_violation', 'drone_incursion', 'sabotage', 'cable_cut']

/** Importance points for the level reached. */
const LEVEL_POINTS = [0, 22, 40, 58, 74, 88]

// ---- Scoring ---------------------------------------------------------------------------------

/** Who else carries the story: how many independent publishers in all, and whether an official body is one of them. */
export interface Cluster {
  groups: number
  official: boolean
}

export interface Score {
  /** 0 to 100. */
  importance: number
  escalation: EscalationLevel
  /** What had a say: the concepts and impacts found, then whatever held the level down. */
  tags: string[]
  countries: string[]
  /** "concept@place" for each thing the story is about that is serious and local enough to look for in other feeds. */
  keys: string[]
}

/**
 * Whether a headline puts what was found in it somewhere else. The clause the words stand in
 * decides, and in it the first place named from those words on: "Latvia condemns the missile
 * strike on Kyiv" and "Kyiv hit by missile strike, Latvia condemns" are both about Kyiv, while
 * "Ukrainian drone crashes in Latvia" is about Latvia.
 *
 * ponytail: word order, not grammar. A Baltic name ahead of the words and a far one after them
 * reads as far away ("Lithuanians hurt in drone attack near Kyiv" rightly, "Riga hit by drone
 * attack like Kyiv's" wrongly), and only the first place a concept is found is looked at. A
 * language model is what does this properly, and the brief's ratings replace these where there is one.
 */
function elsewhere(title: string, found: RegExpExecArray): boolean {
  const before = title.slice(0, found.index).split(CLAUSE_END).at(-1) ?? ''
  const onward = found[0] + title.slice(found.index + found[0].length).split(CLAUSE_END)[0]
  // A Baltic name right before the words is where it happened: "Latvian airspace violated during the attack on Ukraine".
  if (HERE.test(before.trimEnd().split(' ').at(-1) ?? '')) return false
  const away = AWAY.exec(onward)?.index ?? Infinity
  const here = HERE.exec(onward)?.index ?? Infinity
  // No place from the words on: one named ahead of them, in the same clause, is all there is to go by.
  return away === here ? AWAY.test(before) && !HERE.test(before) : away < here
}

/**
 * Rates one story from its headline and description alone, without a language model.
 *
 * Level: the highest concept found counts in full when it is in the headline, and one lower
 * (2 at most) when only the description has it. Then the caps: a level of 3 or more needs the
 * Baltics, an event elsewhere is posture at most, history, fiction, speculation and denials are
 * held down, and a level of 4 or 5 needs an official source or a second publisher.
 *
 * Importance: points for the level (or for the biggest non-security impact), for how close to
 * home it is, for the publisher's weight and for every other publisher carrying it, fading with
 * age. A fresh single-source story comes out near 12 at level 0, 46 at 1, 64 at 2 and 82 at 3.
 */
export function score(item: RawNews, source: NewsSource, now: number, cluster: Cluster = { groups: 1, official: false }): Score {
  const title = norm(item.title)
  const text = `${title} . ${norm(item.desc)}`
  const official = source.kind === 'official'

  let level = 0
  /** What the level would be if everything in the headline had happened here. */
  let anywhere = 0
  /** Where in the headline the words that set the level end. Nowhere, when only the description has them. */
  let said = Infinity
  const concepts: string[] = []
  const local: string[] = []
  for (const concept of CONCEPTS) {
    const found = concept.re.exec(title)
    if (!found && !concept.re.test(text)) continue
    concepts.push(concept.id)
    const full = found ? concept.level : Math.min(2, Math.max(1, concept.level - 1))
    const away = found !== null && full >= 2 && elsewhere(title, found)
    const worth = away ? 1 : full
    anywhere = Math.max(anywhere, full)
    if (!away) local.push(concept.id)
    if (worth > level) {
      level = worth
      said = found ? found.index + found[0].length : Infinity
    }
  }
  const held = anywhere > level ? ['event_elsewhere'] : []
  if (level === 2 && concepts.includes('explosion') && INFRASTRUCTURE.test(text)) level = 3
  if (level < 2 && concepts.includes('espionage') && LEGAL.test(title)) level = 2
  // An emergency declared over a security event is a crisis; over a flood it is not.
  if (level >= 2 && level < 4 && EMERGENCY.test(title)) level = 4

  const places = PLACES.filter((place) => place.re.test(text))
  const atHome =
    source.country !== 'INT' &&
    (official || (source.native === true && !item.foreign && places.every((place) => place.id === source.country)))
  const homeTier = PLACES.find((place) => place.id === source.country)?.tier ?? 0
  const geo = Math.max(0, ...places.map((place) => place.tier), atHome ? homeTier : 0)

  const caps: [string, number][] = []
  if (level >= 3 && geo < 0.8) caps.push(['outside_baltics', 2])
  // For a headline that does not say where: a far place somewhere in the text and no Baltic one in the headline.
  if (level >= 2 && places.some((place) => ELSEWHERE.has(place.id)) && !HERE.test(title)) caps.push(['event_elsewhere', 1])
  for (const dampener of DAMPENERS) {
    const found = level > dampener.cap ? dampener.re.exec(title) : null
    if (!found) continue
    const later = found.index > said && CLAUSE_END.test(title.slice(said, found.index))
    if (!later || !ABOUT_THE_EVENT.has(dampener.id)) caps.push([dampener.id, dampener.cap])
  }
  if (level >= 3 && concepts.includes('exercise') && !concepts.some((id) => REAL_INCIDENTS.includes(id))) caps.push(['exercise_scenario', 1])
  if (level >= 4 && !official && !cluster.official && cluster.groups < 2) caps.push(['unconfirmed', 3])
  for (const [name, cap] of caps) {
    if (level <= cap) continue
    level = cap
    if (!held.includes(name)) held.push(name)
  }

  const impacts = IMPACTS.filter((impact) => impact.re.test(text))
  const words = Math.max(LEVEL_POINTS[level], ...impacts.map((impact) => impact.points)) + Math.min(10, 4 * Math.max(0, impacts.length + concepts.length - 1))
  const near = Math.round(15 * geo)
  const trust = Math.round(10 * source.weight)
  const echoed = Math.min(15, 6 * (cluster.groups - 1)) + (cluster.official && !official ? 3 : 0)
  // A story about nothing on any list still ranks a little, by where it is and who says so.
  const base = level > 0 || impacts.length > 0 ? Math.min(100, words + near + trust + echoed) : Math.round((near + trust) / 2)
  const ageHours = Math.max(0, now - item.at) / HOUR
  const decay = 0.5 ** (ageHours / HALF_LIFE_H[level])

  const countries = new Set(places.flatMap((place) => (place.id === 'BALTIC' ? BALTICS : place.id === 'FAR' ? [] : [place.id])))
  if (atHome) countries.add(source.country)
  // A newsroom writing at home seldom names its own country ("Seimas", "valdība"), so it stands in when no place is named.
  const place = places.map((one) => one.id).filter((id) => STORY_PLACES.has(id)).sort()[0] ?? (atHome ? source.country : undefined)

  return {
    importance: Math.round(base * (0.3 + 0.7 * decay)),
    escalation: level as EscalationLevel,
    tags: [...concepts, ...impacts.map((impact) => impact.id), ...held],
    countries: [...countries],
    // Not for a story held below 2, nor for what its headline puts elsewhere: an anniversary piece confirms no
    // invasion, and a statement on a strike on Kyiv no strike here.
    keys: place && level >= 2 ? local.filter((id) => STORY_CONCEPTS.has(id)).map((id) => `${id}@${place}`) : [],
  }
}

/** Two stories that share a key count as the same story when they are no further apart than this. */
const SAME_STORY_MS = 12 * HOUR
/** And as one article in two languages when they come from one newsroom no further apart than this. */
const SAME_ARTICLE_MS = 3 * HOUR

/**
 * Scores every story, twice where it matters: once by itself, to learn what it is about, and
 * once more knowing who else carries it. Most important first.
 *
 * ponytail: "the same story" is the same concept in the same place within 12 hours, which needs
 * no translation but merges two incidents of one kind in one country on one day, and cannot pair
 * up routine stories at all. Compare the publishers' own cross-links, or embeddings, to do better.
 */
export function rank(entries: readonly NewsEntry[], now: number): NewsItem[] {
  const scored = entries.map((entry) => ({ ...entry, alone: score(entry.item, entry.source, now) }))
  const stories = new Map<string, typeof scored>()
  for (const one of scored) for (const key of one.alone.keys) stories.set(key, [...(stories.get(key) ?? []), one])

  return scored
    .flatMap((one) => {
      const { item, source, alone } = one
      const apart = (other: NewsEntry) => Math.abs(other.item.at - item.at)
      // Publishers word one event differently ("violates airspace", "crashes"), so sharing any one key is enough.
      const peers = [...new Set([one, ...alone.keys.flatMap((key) => stories.get(key)!)])].filter((other) => apart(other) < SAME_STORY_MS)
      // A newsroom's other language edition tells the story again: it is listed once, in English. Delfi is two newsrooms.
      const retold = (other: NewsEntry) =>
        other.source.lang === 'en' && other.source.publisher === source.publisher && other.source.country === source.country && apart(other) < SAME_ARTICLE_MS
      if (source.lang !== 'en' && peers.some(retold)) return []
      const groups = new Set(peers.map((other) => other.source.group)).size
      // One story from each other voice, an official body's word before a newsroom's.
      const voices = new Map<string, NewsEntry>()
      for (const other of peers.toSorted((a, b) => Number(b.source.kind === 'official') - Number(a.source.kind === 'official'))) {
        if (other.source.group !== source.group && !voices.has(other.source.group)) voices.set(other.source.group, other)
      }
      const confirmedBy = [...voices.values()].slice(0, 5).map((other) => ({
        publisher: other.source.publisher,
        link: other.item.link,
        official: other.source.kind === 'official',
      }))
      const { importance, escalation, tags, countries } =
        peers.length > 1 ? score(item, source, now, { groups, official: peers.some((other) => other.source.kind === 'official') }) : alone
      return [
        {
          title: item.title,
          link: item.link,
          at: item.at,
          source: source.id,
          publisher: source.publisher,
          lang: source.lang,
          countries,
          importance,
          escalation,
          tags,
          corroboration: groups - 1,
          ...(confirmedBy.length > 0 && { confirmedBy }),
          ai: source.ai,
        },
      ]
    })
    .sort((a, b) => b.importance - a.importance || b.at - a.at)
}