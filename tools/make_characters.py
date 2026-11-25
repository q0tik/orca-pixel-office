"""Draws the character skins (robots, furries, costumes) and writes their skin packs:
plugin/office/skins/robots.json, furries.json, costumes.json.

The packs are data: anyone can edit the rows by hand or write a new pack without this script (see
docs/characters.md). This only keeps the shipped art reproducible.   python3 tools/make_characters.py

A head is 12 × 12 pixels and sits at x 2, y 0 of the 16 × 26 figure; the figure's own face is
x 4..11, y 4..11, its eyes at x 6 and 9 (head columns 4 and 7), rows 7..8. Front and back heads are
drawn as their left half (6 columns) and mirrored. Row 0 is cut off while walking (the figure bobs
up a pixel), so ear tips and antlers start on row 1. The trainee's head is 10 × 7 (left half 5).
"""
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'plugin', 'office', 'skins')
EYE_ROW = 8


def mirror(half):
    """Left half rows → full rows, mirrored around the middle."""
    return [r + r[::-1] for r in half]


def check(name, rows, w, h):
    assert len(rows) == h, f'{name}: {len(rows)} rows, want {h}'
    for i, r in enumerate(rows):
        assert len(r) == w, f'{name}[{i}] = {r!r}: {len(r)} wide, want {w}'
    return rows


def sleep_of(front, eyes, face, closed):
    """The front head with the eyes shut: each eye becomes a short line on its lowest row, one
    pixel wider outwards (like the people's). `closed` None just swaps the eyes for `face`."""
    g = [list(r) for r in front]
    spots = [(x, y) for y, r in enumerate(g) for x, c in enumerate(r) if c in eyes]
    for x, y in spots:
        g[y][x] = face
    if closed:
        for side in (lambda x: x < 6, lambda x: x >= 6):
            mine = [(x, y) for x, y in spots if side(x)]
            if not mine:
                continue
            row = max(y for _, y in mine)
            cols = sorted({x for x, _ in mine})
            out = cols[0] - 1 if cols[0] < 6 else cols[-1] + 1
            for x in cols + [out]:
                if 0 <= x < 12 and g[row][x] != '.':
                    g[row][x] = closed
    return [''.join(r) for r in g]


def part(x, y, rows):
    return {'x': x, 'y': y, 'rows': rows}


def character(cid, name, group, legend, coats, body, front, back, side, mini, tail=None, chest=None, eyes='e', face='f', closed='e', sleep=None):
    front = check(f'{cid}.front', front, 12, 12)
    back = check(f'{cid}.back', back, 12, 12)
    side = check(f'{cid}.side', side, 12, 12)
    mini = check(f'{cid}.mini', mini, 10, 7)
    out = {
        'id': cid,
        'name': name,
        'group': group,
        'coats': coats,
        'legend': legend,
        'body': body,
        'head': {'front': front, 'back': back, 'side': side, 'sleep': sleep or sleep_of(front, eyes, face, closed)},
        'mini': mini,
    }
    if tail:
        out['tail'] = tail
    if chest:
        out['chest'] = chest
    for ch in ''.join(front + back + side + mini + out['head']['sleep']):
        assert ch == '.' or ch in legend, f'{cid}: «{ch}» is not in the legend'
    return out


def coat(cid, name, **colors):
    return {'id': cid, 'name': name, 'colors': colors}


FURRY_BODY = {'hands': '$fur', 'shoes': '$furDark'}

# ── Robots ───────────────────────────────────────────────────────────────────────────────

retro = character(
    'retro-robot', 'Ретро-робот', 'Роботы',
    {'m': '$metal', 'h': '$metalHi', 'd': '$metalDark', 'l': '$led', 'b': '$led', 'k': '@ink', 'r': '#e0503c'},
    [
        coat('tin', 'Жестяной', body='#8f98a6', bodyDark='#6b7380', metal='#c3c9d2', metalHi='#e9ecf0', metalDark='#58606c', led='#7fe3ff'),
        coat('red', 'Красный', body='#c8483f', bodyDark='#93302a', metal='#d0d4da', metalHi='#f2f3f5', metalDark='#5d626c', led='#ffd54a'),
        coat('teal', 'Бирюзовый', body='#3f9e95', bodyDark='#2b7370', metal='#c9d3d6', metalHi='#eef3f4', metalDark='#4d5d62', led='#ff9a4a'),
    ],
    {'hands': '$metal', 'shirt': '$body', 'shade': '$bodyDark', 'pants': '$metalDark', 'shoes': '$metalDark'},
    front=mirror([
        '......',
        '.....b',
        '.....d',
        '.....d',
        '.ddddd',
        '.dhhhh',
        '.dmmmm',
        'ddmllm',
        'ddmllm',
        '.dmmmm',
        '.dmkmk',
        '.ddddd',
    ]),
    back=mirror([
        '......',
        '.....b',
        '.....d',
        '.....d',
        '.ddddd',
        '.dhhhh',
        '.dmmmm',
        'ddmkkk',
        'ddmmmm',
        '.dmkkk',
        '.dmmmm',
        '.ddddd',
    ]),
    side=[
        '............',
        '......b.....',
        '......d.....',
        '......d.....',
        '..ddddddddd.',
        '..dhhhhhhhd.',
        '..dmmmmmmmd.',
        '..dmmdmmmlld',
        '..dmdkdmmlld',
        '..dmmdmmmmmd',
        '..dmmmmmkmkd',
        '..ddddddddd.',
    ],
    mini=mirror([
        '....b',
        '....d',
        '.dddd',
        '.dhhh',
        'ddmlm',
        '.dmmk',
        '.dddd',
    ]),
    chest=part(5, 13, ['dddddd', 'dldrdd', 'dddddd']),
    eyes='l', face='m', closed='d',
)

android = character(
    'android', 'Андроид', 'Роботы',
    {'m': '$metal', 'h': '$metalHi', 'd': '$metalDark', 'v': '$visor', 'l': '$led'},
    [
        coat('white', 'Белый', body='#e3e7ee', bodyDark='#b7bdc8', metal='#eef1f5', metalHi='#ffffff', metalDark='#9aa1ad', visor='#27303d', led='#5ef0ff'),
        coat('black', 'Чёрный', body='#3a3f4a', bodyDark='#262a32', metal='#4a505c', metalHi='#7a8394', metalDark='#22262e', visor='#0e1116', led='#ff4f6d'),
        coat('chrome', 'Хром', body='#a9b2bf', bodyDark='#7d8796', metal='#c3ccd8', metalHi='#f2f6fa', metalDark='#6c7684', visor='#2a2f3a', led='#9dff6e'),
    ],
    {'hands': '$metal', 'shirt': '$body', 'shade': '$bodyDark', 'pants': '$bodyDark', 'shoes': '$metalDark'},
    front=mirror([
        '......',
        '......',
        '...mmm',
        '..mhhm',
        '.mmhmm',
        '.mmmmm',
        '.vvvvv',
        '.vllll',
        '.vvvvv',
        '.mmmmm',
        '..mmmm',
        '...ddd',
    ]),
    back=mirror([
        '......',
        '......',
        '...mmm',
        '..mmhh',
        '.mmmhm',
        '.mmmmm',
        '.mmmmm',
        '.dmmmm',
        '.mmmmm',
        '.mmmmm',
        '..mmmm',
        '...ddd',
    ]),
    side=[
        '............',
        '............',
        '.....mmmm...',
        '...mmmhhmm..',
        '..mmmmmhmmm.',
        '..mmmmmmmmm.',
        '..mmmmvvvvvv',
        '..mdmmvlllll',
        '..mmmmvvvvvv',
        '..mmmmmmmmm.',
        '...mmmmmmm..',
        '....ddd.....',
    ],
    mini=mirror([
        '.....',
        '..mmm',
        '.mmhm',
        '.vvvv',
        '.vlll',
        '.mmmm',
        '..mmm',
    ]),
    chest=part(7, 14, ['ll', 'll']),
    sleep=None, eyes='l', face='v', closed=None,
)

# ── Furries ──────────────────────────────────────────────────────────────────────────────

cat = character(
    'cat', 'Кошка', 'Фурри',
    {'f': '$fur', 'd': '$furDark', 'w': '$belly', 'p': '#e89aa8', 'n': '#d0667a', 'e': '$eye', 'k': '@ink'},
    [
        coat('ginger', 'Рыжая', fur='#e0893a', furDark='#a95b22', belly='#f7e6cc', eye='#2b2622'),
        coat('grey', 'Серая', fur='#9d9fab', furDark='#676977', belly='#e9e9ef', eye='#2b2622'),
        coat('black', 'Чёрная', fur='#3b3742', furDark='#232027', belly='#d9d3cc', eye='#c8e05a'),
    ],
    FURRY_BODY,
    front=mirror([
        '......',
        '..d...',
        '..dd..',
        '..dpd.',
        '..ffff',
        '..ffff',
        '..ffff',
        '..ffef',
        '..ffef',
        '..fwwn',
        '.kfwww',
        '...fww',
    ]),
    back=mirror([
        '......',
        '..d...',
        '..dd..',
        '..ddd.',
        '..ffff',
        '..fffd',
        '..ffff',
        '..fffd',
        '..ffff',
        '..ffff',
        '..ffff',
        '...fff',
    ]),
    side=[
        '............',
        '.....d......',
        '.....dd.....',
        '.....dpd....',
        '...ffffff...',
        '...dffffff..',
        '...fffffff..',
        '...dffffef..',
        '...fffffeww.',
        '...ffffwwwn.',
        '...fffwwwwk.',
        '....ffwww...',
    ],
    mini=mirror([
        '..d..',
        '..ddf',
        '..fff',
        '..fef',
        '..fwn',
        '..fww',
        '...ff',
    ]),
    tail={
        'side': part(1, 10, ['dd...', 'fd...', 'f....', 'f....', 'ff...', '.f...', '.ff..', '..fff']),
        'back': part(2, 17, ['...ff', '..ff.', '.ff..', '.f...', 'f....', 'f....', 'fd...', '.d...']),
        'front': part(12, 15, ['.d', '.f', 'f.', 'f.', 'f.']),
    },
)

fox = character(
    'fox', 'Лиса', 'Фурри',
    {'f': '$fur', 'd': '$furDark', 'w': '$belly', 'k': '@ink', 'e': '@eye'},
    [
        coat('red', 'Рыжая', fur='#e0702a', furDark='#a84e1c', belly='#f6efe4'),
        coat('arctic', 'Песец', fur='#e9edf2', furDark='#b9c0cc', belly='#ffffff'),
        coat('silver', 'Чернобурка', fur='#4a4650', furDark='#2c2930', belly='#d8d8de'),
    ],
    FURRY_BODY,
    front=mirror([
        '......',
        '.k....',
        '.kd...',
        '.dwd..',
        '..ffff',
        '..ffff',
        '.fffff',
        '.wffef',
        '.wwfef',
        '..wwww',
        '...wwk',
        '....ww',
    ]),
    back=mirror([
        '......',
        '.k....',
        '.kd...',
        '.ddd..',
        '..ffff',
        '..ffff',
        '.fffff',
        '.fffff',
        '.fffff',
        '..ffff',
        '..ffff',
        '...fff',
    ]),
    side=[
        '............',
        '....k.......',
        '....kd......',
        '....dwd.....',
        '...ffffff...',
        '...fffffff..',
        '...ffffffff.',
        '...ffffeff..',
        '...fffffwwww',
        '...wwwwwwwwk',
        '....wwwww...',
        '....www.....',
    ],
    mini=mirror([
        '.k...',
        '.df..',
        '..fff',
        '.wfef',
        '..wwk',
        '...ww',
        '.....',
    ]),
    tail={
        'side': part(0, 9, ['.ww..', 'wwf..', 'wff..', 'fff..', 'fff..', 'ffff.', '.fff.', '..fff', '...ff']),
        'back': part(1, 16, ['....ff', '...fff', '..fff.', '.fff..', 'ffff..', 'fff...', 'fff...', 'ww....', 'w.....']),
        'front': part(12, 13, ['.w', 'wf', 'ff', 'ff', 'f.', 'f.', 'f.']),
    },
)

deer = character(
    'deer', 'Олень', 'Фурри',
    {'f': '$fur', 'd': '$furDark', 'w': '$belly', 'a': '$antler', 'k': '@ink', 'e': '@eye'},
    [
        coat('brown', 'Благородный', fur='#a86b3c', furDark='#7a4a26', belly='#f1dfc0', antler='#e8d5a8'),
        coat('red', 'Пятнистый', fur='#b5643a', furDark='#874424', belly='#f4e6cc', antler='#ead8b0'),
        coat('reindeer', 'Северный', fur='#9a8a7a', furDark='#6b5e52', belly='#f2efe8', antler='#cbb79a'),
    ],
    FURRY_BODY,
    front=mirror([
        '......',
        'a..a..',
        '.a.a..',
        '..aa..',
        '..ffff',
        'ddffff',
        '.dffff',
        '..ffef',
        '..ffef',
        '...fww',
        '...wwk',
        '....ww',
    ]),
    back=mirror([
        '......',
        'a..a..',
        '.a.a..',
        '..aa..',
        '..ffff',
        'ddffff',
        '.dffff',
        '..ffff',
        '..fffd',
        '..ffff',
        '..ffff',
        '...fff',
    ]),
    side=[
        '............',
        '.....a.a....',
        '.....aa.....',
        '......a.....',
        '...ffffff...',
        '.ddffffff...',
        '...fffffff..',
        '...ffffeff..',
        '...ffffffwww',
        '...fffffwwwk',
        '....fffwww..',
        '....fff.....',
    ],
    mini=mirror([
        '.a.a.',
        '..aff',
        'ddfff',
        '..fef',
        '..fwk',
        '...ww',
        '.....',
    ]),
    tail={
        'side': part(3, 15, ['ww', '.w']),
        'back': part(7, 17, ['ww', 'ww']),
    },
)

wolf = character(
    'wolf', 'Волк', 'Фурри',
    {'f': '$fur', 'd': '$furDark', 'w': '$belly', 'k': '@ink', 'e': '$eye'},
    [
        coat('grey', 'Серый', fur='#8d8f98', furDark='#5b5d68', belly='#e4e4ea', eye='#e2b43a'),
        coat('black', 'Чёрный', fur='#3c3a40', furDark='#242226', belly='#8a8890', eye='#e2b43a'),
        coat('arctic', 'Полярный', fur='#e4e6ee', furDark='#b7bac6', belly='#ffffff', eye='#3f86c8'),
    ],
    FURRY_BODY,
    front=mirror([
        '......',
        '.d....',
        '.dd...',
        '.dfd..',
        '..ffdd',
        '.fffff',
        '.fffff',
        '..ffef',
        '.wffef',
        '..wwwk',
        '...www',
        '...www',
    ]),
    back=mirror([
        '......',
        '.d....',
        '.dd...',
        '.ddd..',
        '..ffdd',
        '.fffdd',
        '.ffffd',
        '.fffff',
        '.fffff',
        '..ffff',
        '..ffff',
        '...fff',
    ]),
    side=[
        '............',
        '.....d......',
        '.....dd.....',
        '....ddfd....',
        '...fffffd...',
        '...ffffffd..',
        '...ffffffff.',
        '...fffffeff.',
        '..wffffffwww',
        '..wwffffwwwk',
        '..wwwfwww...',
        '...www......',
    ],
    mini=mirror([
        '.d...',
        '.ddf.',
        '..ffd',
        '.ffef',
        '..wwk',
        '...ww',
        '.....',
    ]),
    tail={
        'side': part(0, 10, ['dd...', 'dff..', 'fff..', 'fff..', 'ffff.', '.fff.', '..fff', '...ff']),
        'back': part(1, 16, ['....ff', '...fff', '..fff.', '.fff..', 'fff...', 'fff...', 'dd....', 'd.....']),
        'front': part(12, 14, ['.d', 'df', 'ff', 'f.', 'f.', 'f.']),
    },
)

raccoon = character(
    'raccoon', 'Енот', 'Фурри',
    {'f': '$fur', 'd': '$furDark', 'w': '$belly', 'k': '$mask', 'e': '#f4f0e6', 'n': '@ink'},
    [
        coat('classic', 'Полосатый', fur='#8e8a86', furDark='#5a5653', belly='#f0ece6', mask='#2a2729'),
        coat('rusty', 'Рыжеватый', fur='#9b8068', furDark='#6a523f', belly='#f2e6d6', mask='#2e2420'),
    ],
    FURRY_BODY,
    front=mirror([
        '......',
        '......',
        '.ww...',
        '.wdf..',
        '..ffff',
        '..wwff',
        '.kkkkf',
        '.kkkef',
        '.kkkkf',
        '..wwww',
        '...wwn',
        '....ww',
    ]),
    back=mirror([
        '......',
        '......',
        '.ww...',
        '.wdd..',
        '..ffff',
        '..ffff',
        '.fffff',
        '.ffffd',
        '.fffff',
        '..ffff',
        '..ffff',
        '...fff',
    ]),
    side=[
        '............',
        '............',
        '.....ww.....',
        '.....wdf....',
        '...ffffff...',
        '...fffwwf...',
        '...ffkkkkk..',
        '...fkkkekk..',
        '...fkkkkkwww',
        '...ffffwwwwn',
        '....fffwww..',
        '....ffww....',
    ],
    mini=mirror([
        '.....',
        '.ww..',
        '..fff',
        '.kkek',
        '..wwn',
        '...ww',
        '.....',
    ]),
    tail={
        'side': part(0, 10, ['kk...', 'ff...', 'kkf..', 'fff..', '.kkk.', '.fff.', '..kkf', '...ff']),
        'back': part(1, 16, ['....ff', '...kkk', '..fff.', '.kkk..', 'fff...', 'kkk...', 'ff....', 'k.....']),
        'front': part(12, 14, ['.k', 'kf', 'ff', 'k.', 'f.', 'k.']),
    },
    eyes='e', face='k', closed=None,
)

rabbit = character(
    'rabbit', 'Кролик', 'Фурри',
    {'f': '$fur', 'd': '$furDark', 'w': '$belly', 'p': '#f0a5b4', 'n': '#e07a90', 'e': '@eye'},
    [
        coat('white', 'Белый', fur='#f2f0f4', furDark='#c9c6d0', belly='#ffffff'),
        coat('chocolate', 'Шоколадный', fur='#6e4a34', furDark='#4a301f', belly='#ecd8c0'),
        coat('grey', 'Серый', fur='#a9a7ad', furDark='#77757c', belly='#ecebef'),
    ],
    {'hands': '$fur', 'shoes': '$furDark'},
    front=mirror([
        '......',
        '..ff..',
        '..fp..',
        '..fp..',
        '..ffff',
        '..ffff',
        '.fffff',
        '.fffef',
        '.fffef',
        '.pfwwn',
        '..fwww',
        '...fff',
    ]),
    back=mirror([
        '......',
        '..ff..',
        '..ff..',
        '..fd..',
        '..ffff',
        '..ffff',
        '.fffff',
        '.fffff',
        '.fffff',
        '.fffff',
        '..ffff',
        '...fff',
    ]),
    side=[
        '............',
        '..ffff......',
        '.fppff......',
        '...fffff....',
        '...ffffff...',
        '...fffffff..',
        '...fffffff..',
        '...ffffefff.',
        '...ffffefww.',
        '...pfffwwwn.',
        '....fffwww..',
        '....fff.....',
    ],
    mini=mirror([
        '..f..',
        '..fp.',
        '..fff',
        '..fef',
        '..fwn',
        '...ff',
        '.....',
    ]),
    tail={
        'side': part(3, 16, ['.w', 'ww']),
        'back': part(7, 17, ['ww', 'ww']),
    },
)

bear = character(
    'bear', 'Медведь', 'Фурри',
    {'f': '$fur', 'd': '$furDark', 'w': '$belly', 'k': '@ink', 'e': '@eye'},
    [
        coat('brown', 'Бурый', fur='#7b5134', furDark='#55361f', belly='#c49a6c'),
        coat('polar', 'Белый', fur='#f1efe8', furDark='#cfcabc', belly='#ffffff'),
        coat('black', 'Гималайский', fur='#2f2b2a', furDark='#1d1a19', belly='#a88a6a'),
    ],
    FURRY_BODY,
    front=mirror([
        '......',
        '......',
        '.dd...',
        '.dwd..',
        '.fffff',
        '.fffff',
        '.fffff',
        '.fffef',
        '.fffef',
        '.ffwww',
        '.ffwwk',
        '..fwww',
    ]),
    back=mirror([
        '......',
        '......',
        '.dd...',
        '.ddd..',
        '.fffff',
        '.fffff',
        '.fffff',
        '.fffff',
        '.fffff',
        '.fffff',
        '.fffff',
        '..ffff',
    ]),
    side=[
        '............',
        '............',
        '.....dd.....',
        '.....dwd....',
        '...ffffff...',
        '..fffffff...',
        '..ffffffff..',
        '..fffffefff.',
        '..ffffffwwww',
        '..ffffffwwwk',
        '..fffffwww..',
        '...fffff....',
    ],
    mini=mirror([
        '.....',
        '.dd..',
        '.ffff',
        '.ffef',
        '.fwwk',
        '..fww',
        '.....',
    ]),
    tail={'back': part(7, 17, ['ff', 'ff'])},
)

panda = character(
    'panda', 'Панда', 'Фурри',
    {'f': '$fur', 'k': '$patch', 'w': '$fur', 'e': '#f4f4f8', 'n': '@ink'},
    [coat('classic', 'Бамбуковая', fur='#f3f2ee', patch='#26242a')],
    {'hands': '$patch', 'shoes': '$patch'},
    front=mirror([
        '......',
        '......',
        '.kk...',
        '.kkk..',
        '.fffff',
        '.fffff',
        '.ffkkf',
        '.ffkef',
        '.ffkkf',
        '.ffwww',
        '.fffwn',
        '..ffff',
    ]),
    back=mirror([
        '......',
        '......',
        '.kk...',
        '.kkk..',
        '.fffff',
        '.fffff',
        '.fffff',
        '.fffff',
        '.fffff',
        '.fffff',
        '.fffff',
        '..ffff',
    ]),
    side=[
        '............',
        '............',
        '.....kk.....',
        '.....kkk....',
        '...ffffff...',
        '..fffffff...',
        '..fffffkkf..',
        '..ffffkkekf.',
        '..ffffffkkff',
        '..ffffffffwn',
        '..fffffffw..',
        '...fffff....',
    ],
    mini=mirror([
        '.....',
        '.kk..',
        '.ffff',
        '.fkef',
        '.ffwn',
        '..fff',
        '.....',
    ]),
    eyes='e', face='k', closed=None,
)

# ── Costumes ─────────────────────────────────────────────────────────────────────────────

astronaut = character(
    'astronaut', 'Астронавт', 'Костюмы',
    {'w': '$suit', 's': '$suitDark', 'v': '$visor', 'h': '$visorHi', 'd': '$metalDark', 'l': '#6fd36f', 'r': '#e05050'},
    [
        coat('white', 'Белый скафандр', suit='#eef0f4', suitDark='#b9bec9', visor='#d9a63a', visorHi='#fff1c2', metalDark='#6b7280'),
        coat('orange', 'Оранжевый скафандр', suit='#f08a3a', suitDark='#b9612a', visor='#2b3550', visorHi='#9bb7ff', metalDark='#5b6270'),
    ],
    {'hands': '$suit', 'shirt': '$suit', 'shade': '$suitDark', 'pants': '$suit', 'shoes': '$metalDark'},
    front=mirror([
        '......',
        '...www',
        '..wwww',
        '.wwwww',
        '.wvvvv',
        '.wvhvv',
        '.wvvvv',
        '.wvvvv',
        '.wwvvv',
        '.wwwww',
        '..swww',
        '.ddddd',
    ]),
    back=mirror([
        '......',
        '...www',
        '..wwww',
        '.wwwww',
        '.wwwww',
        '.wwwww',
        '.swwww',
        '.swwww',
        '.swwww',
        '.wwwww',
        '..swww',
        '.ddddd',
    ]),
    side=[
        '............',
        '....wwwww...',
        '...wwwwwww..',
        '..wwwwwwwww.',
        '..wwwwwvvvv.',
        '..wwwwvvhvvw',
        '..swwwvvvvvw',
        '..swwwvvvvvw',
        '..swwwwvvvw.',
        '..wwwwwwwww.',
        '...swwwwww..',
        '...ddddddd..',
    ],
    mini=mirror([
        '..www',
        '.wwww',
        '.wvvv',
        '.wvhv',
        '.wwvv',
        '.wwww',
        '.dddd',
    ]),
    tail={
        'back': part(4, 12, ['dddddddd', 'dssssssd', 'dswwwwsd', 'dswwwwsd', 'dssssssd', 'dddddddd']),
        'side': part(2, 12, ['dd', 'sd', 'sd', 'sd', 'dd']),
    },
    chest=part(6, 13, ['dddd', 'dlrd', 'dddd']),
    eyes='', face='v', closed=None,
)

knight = character(
    'knight', 'Рыцарь', 'Костюмы',
    {'m': '$metal', 'h': '$metalHi', 'd': '$metalDark', 'p': '$plume', 'k': '@ink', 'e': '$emblem'},
    [
        coat('steel', 'Стальной', metal='#b6bcc6', metalHi='#e6e9ee', metalDark='#6d737d', plume='#c83c3c', tabard='#3a5fb0', tabardDark='#2a4682', emblem='#f0d060'),
        coat('gold', 'Золотой', metal='#d8b44a', metalHi='#f6e39a', metalDark='#8f6f22', plume='#ffffff', tabard='#8a2c2c', tabardDark='#651f1f', emblem='#f6e39a'),
        coat('black', 'Чёрный', metal='#4a4e57', metalHi='#7b818c', metalDark='#2a2d33', plume='#8e4fc0', tabard='#1f1f24', tabardDark='#121215', emblem='#b8b8c0'),
    ],
    {'hands': '$metal', 'shirt': '$tabard', 'shade': '$tabardDark', 'pants': '$metalDark', 'shoes': '$metalDark'},
    front=mirror([
        '......',
        '....pp',
        '.....p',
        '..mmmm',
        '.mhmmm',
        '.mmmmm',
        '.mmmmm',
        '.kkkkk',
        '.mmmmm',
        '.mmkmk',
        '.mmmmm',
        '..dddd',
    ]),
    back=mirror([
        '......',
        '....pp',
        '...ppp',
        '..mmmm',
        '.mmmhm',
        '.mmmmm',
        '.mmmmm',
        '.mmmmm',
        '.dmmmm',
        '.mmmmm',
        '.mmmmm',
        '..dddd',
    ]),
    side=[
        '............',
        '...ppp......',
        '..pp.pp.....',
        '....mmmmm...',
        '...mmmhmmm..',
        '..mmmmmmmmm.',
        '..mmmmmmmmm.',
        '..mmmmkkkkkk',
        '..mmmmmmmmm.',
        '..mmmmmkmkm.',
        '..mmmmmmmmm.',
        '...ddddddd..',
    ],
    mini=mirror([
        '...pp',
        '..mmm',
        '.mhmm',
        '.kkkk',
        '.mmmm',
        '.mmkm',
        '..ddd',
    ]),
    chest=part(6, 13, ['.ee.', 'eeee', '.ee.', '.ee.']),
    eyes='', face='m', closed=None,
)

ninja = character(
    'ninja', 'Ниндзя', 'Костюмы',
    {'c': '$cloth', 'd': '$clothDark', 'b': '$band', 's': '%skin', 'e': '@eye'},
    [
        coat('black', 'Чёрный', cloth='#2b2a33', clothDark='#1a1920', band='#c83c3c'),
        coat('navy', 'Ночной', cloth='#26304a', clothDark='#171d2e', band='#e0b040'),
        coat('red', 'Алый', cloth='#7a2230', clothDark='#4e1520', band='#e8e8e8'),
    ],
    {'hands': '$clothDark', 'shirt': '$cloth', 'shade': '$clothDark', 'pants': '$cloth', 'shoes': '$clothDark'},
    front=mirror([
        '......',
        '......',
        '..cccc',
        '.ccccc',
        '.ccccc',
        '.bbbbb',
        '.ccccc',
        '.cssse',
        '.cssss',
        '.ccccc',
        '.ccccc',
        '..cccc',
    ]),
    back=mirror([
        '......',
        '......',
        '..cccc',
        '.ccccc',
        '.ccccc',
        '.bbbbb',
        '.cccbb',
        '.ccccb',
        '.cccdc',
        '.ccccc',
        '.ccccc',
        '..cccc',
    ]),
    side=[
        '............',
        '............',
        '....ccccc...',
        '...ccccccc..',
        '..ccccccccc.',
        'bbbbbbbbbbb.',
        '.bbcccccccc.',
        '..bcccsssec.',
        '...ccccssss.',
        '..cccccccccc',
        '..ccccccccc.',
        '...cccccc...',
    ],
    mini=mirror([
        '.....',
        '..ccc',
        '.cccc',
        '.bbbb',
        '.csse',
        '.cccc',
        '..ccc',
    ]),
    face='s', closed='e',
)

skeleton = character(
    'skeleton', 'Скелет', 'Костюмы',
    {'b': '$bone', 'd': '$boneDark', 'k': '@ink'},
    [
        coat('bone', 'Костяной', bone='#efe9d8', boneDark='#b9b29a'),
        coat('old', 'Древний', bone='#d8cfae', boneDark='#a39874'),
    ],
    {'hands': '$bone', 'shoes': '$boneDark'},
    front=mirror([
        '......',
        '......',
        '...bbb',
        '..bbbb',
        '.bbbbb',
        '.bbbbb',
        '.bbkkb',
        '.bbkkb',
        '.dbbbb',
        '..bbbk',
        '..bkbk',
        '...bbb',
    ]),
    back=mirror([
        '......',
        '......',
        '...bbb',
        '..bbbb',
        '.bbbbb',
        '.bbbbb',
        '.bbbbb',
        '.dbbbb',
        '.dbbbb',
        '..bbbb',
        '..dbbb',
        '...bbb',
    ]),
    side=[
        '............',
        '............',
        '....bbbbb...',
        '...bbbbbbb..',
        '..bbbbbbbbb.',
        '..bbbbbbbbb.',
        '..dbbbbbkkb.',
        '..dbbbbbkkb.',
        '..dbbbbbbbbb',
        '...bbbbbbbk.',
        '....bbbkbkb.',
        '.....bbbbb..',
    ],
    mini=mirror([
        '.....',
        '..bbb',
        '.bbbb',
        '.bkkb',
        '.bbbk',
        '..bkb',
        '...bb',
    ]),
    chest=part(5, 13, ['.bbbb.', 'b.bb.b', '.bbbb.', 'b.bb.b']),
    eyes='', face='b', closed=None,
)

alien = character(
    'alien', 'Пришелец', 'Костюмы',
    {'s': '$skin', 'd': '$skinDark', 'k': '#141418', 'h': '#ffffff', 'm': '$skinDark'},
    [
        coat('green', 'Зелёный', skin='#7cc95a', skinDark='#4f9a3a'),
        coat('grey', 'Серый', skin='#b4b8c2', skinDark='#858a96'),
        coat('purple', 'Фиолетовый', skin='#a47ad6', skinDark='#7552a8'),
    ],
    {'hands': '$skin'},
    front=mirror([
        '......',
        '...sss',
        '.sssss',
        'ssssss',
        'ssssss',
        '.sssss',
        '.skhks',
        '.kkkss',
        '..ssss',
        '...sss',
        '....sm',
        '....ss',
    ]),
    back=mirror([
        '......',
        '...sss',
        '.sssss',
        'ssssss',
        'ssssss',
        'dsssss',
        '.sssss',
        '.dssss',
        '..ssss',
        '...sss',
        '....ss',
        '....ss',
    ]),
    side=[
        '............',
        '...ssss.....',
        '..ssssssss..',
        '.ssssssssss.',
        '.ssssssssss.',
        '.dsssssssss.',
        '..ssssskkhs.',
        '..dssssskks.',
        '...sssssss..',
        '....ssssss..',
        '.....sssm...',
        '.....sss....',
    ],
    mini=mirror([
        '..sss',
        '.ssss',
        'sssss',
        '.kkhs',
        '..sss',
        '...sm',
        '....s',
    ]),
    eyes='kh', face='s', closed='k',
)

pirate = character(
    'pirate', 'Пират', 'Костюмы',
    {'t': '$hat', 'y': '$trim', 's': '%skin', 'h': '%hair', 'k': '@ink', 'e': '@eye', 'w': '#f4f0e6'},
    [
        coat('red', 'Красный камзол', hat='#2a2530', trim='#e0b040', coat='#a8323a', coatDark='#7a2229', boots='#3a2a20'),
        coat('blue', 'Синий камзол', hat='#2a2530', trim='#e0b040', coat='#2f4f8f', coatDark='#213866', boots='#3a2a20'),
        coat('black', 'Чёрный камзол', hat='#5a3a24', trim='#e0b040', coat='#2f2b33', coatDark='#1d1a20', boots='#2a1d16'),
    ],
    {'hands': '%skin', 'shirt': '$coat', 'shade': '$coatDark', 'shoes': '$boots'},
    front=[
        '............',
        '...tttttt...',
        '..twwttwwt..',
        '.tyyyyyyyyt.',
        'tttttttttttt',
        '.hssssssssh.',
        '.hsssssskkh.',
        '.hssesskkkh.',
        '.hssesskkkh.',
        '.hsssssssh..',
        '..hhhhhhhh..',
        '...hhhhhh...',
    ],
    back=[
        '............',
        '...tttttt...',
        '..tttttttt..',
        '.tyyyyyyyyt.',
        'tttttttttttt',
        '.hhhhhhhhhh.',
        '.hhhhhkhhhh.',
        '.hhhhhkhhhh.',
        '.hhhhhhhhhh.',
        '.hhhhhhhhhh.',
        '..hhhhhhhh..',
        '...hhhhhh...',
    ],
    side=[
        '............',
        '....tttttt..',
        '...twwtttt..',
        '..yyyyyyyyy.',
        'ttttttttttt.',
        '..hhssssss..',
        '..hhssssskk.',
        '..hhsssskkks',
        '..hhssssssss',
        '..hhhssshhh.',
        '...hhhhhhh..',
        '....hhhh....',
    ],
    mini=[
        '..tttttt..',
        '.tyyyyyyt.',
        'tttttttttt',
        '.hsessskh.',
        '.hssssssh.',
        '..hhhhhh..',
        '...hhhh...',
    ],
    eyes='e', face='s', closed='e',
)

hooded = character(
    'hooded', 'Человек в капюшоне', 'Костюмы',
    {'h': '$hood', 'd': '$hoodDark', 's': '%skin', 'e': '@eye'},
    [
        coat('grey', 'Серый', hood='#6e7280', hoodDark='#4a4e5a'),
        coat('green', 'Лесной', hood='#4d6b3c', hoodDark='#34492a'),
        coat('crimson', 'Багровый', hood='#7a2834', hoodDark='#521a23'),
        coat('black', 'Чёрный', hood='#2f2f38', hoodDark='#1b1b20'),
    ],
    {'shirt': '$hood', 'shade': '$hoodDark'},
    front=mirror([
        '......',
        '...hhh',
        '..hhhh',
        '.hhhhh',
        '.hhhhh',
        '.hhddd',
        '.hdsss',
        '.hdses',
        '.hdses',
        '.hhsss',
        '.hhhss',
        '.hhhhh',
    ]),
    back=mirror([
        '......',
        '...hhh',
        '..hhhh',
        '.hhhhh',
        '.hhhhh',
        '.hhhhh',
        '.hhhhd',
        '.hhhhh',
        '.hhhhh',
        '.hhhhh',
        '.hhhhh',
        '.hhhhh',
    ]),
    side=[
        '............',
        '....hhhh....',
        '...hhhhhh...',
        '..hhhhhhhh..',
        '.hhhhhhhhhd.',
        '.hhhhhhhddd.',
        '..hhhhhdsss.',
        '..hhhhhdsses',
        '..hhhhhdsss.',
        '..hhhhhhsss.',
        '..hhhhhhhss.',
        '..hhhhhhhh..',
    ],
    mini=mirror([
        '..hhh',
        '.hhhh',
        '.hddd',
        '.hdse',
        '.hdss',
        '.hhhs',
        '.hhhh',
    ]),
    face='s', closed='e',
)


def pack(pid, name, description, characters):
    return {
        'format': 1,
        'id': pid,
        'name': name,
        'author': 'Pixel Office contributors',
        'license': 'MIT',
        'description': description,
        'characters': characters,
    }


PACKS = {
    'robots.json': pack('robots', 'Роботы', 'Ретро-робот с антенной и гладкий андроид, по три окраса.', [retro, android]),
    'furries.json': pack('furries', 'Фурри', 'Кошка, лиса, олень, волк, енот, кролик, медведь и панда: уши, морды, хвосты, окрасы.', [cat, fox, deer, wolf, raccoon, rabbit, bear, panda]),
    'costumes.json': pack('costumes', 'Костюмы', 'Астронавт, рыцарь, ниндзя, скелет, пришелец, пират и человек в капюшоне.', [astronaut, knight, ninja, skeleton, alien, pirate, hooded]),
}


def compact(obj):
    """JSON with one sprite row per line, so the art can be read and edited by hand."""
    text = json.dumps(obj, ensure_ascii=False, indent=2)
    return text + '\n'


def main():
    for name, data in PACKS.items():
        with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
            f.write(compact(data))
    index_path = os.path.join(OUT, 'index.json')
    with open(index_path, encoding='utf-8') as f:
        index = json.load(f)
    for name in PACKS:
        if name not in index:
            index.append(name)
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(json.dumps(index) + '\n')
    print('wrote', ', '.join(PACKS), 'and index.json')


if __name__ == '__main__':
    main()
